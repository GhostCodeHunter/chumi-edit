/* Chumi.edit engine: document, layers, history, selection, rendering, import/export. No UI in here. */
(function () {
  'use strict';
  const L = (window.Chumi = window.Chumi || {});
  const A = L.Adjust;

  /* ------------------------------------------------------------ events */
  const handlers = {};
  L.on = function (e, f) { (handlers[e] = handlers[e] || []).push(f); };
  L.emit = function (e, a) { (handlers[e] || []).forEach(function (f) { try { f(a); } catch (err) { console.error('[chumi:' + e + ']', err); } }); };
  L.toast = function (msg, kind) { L.emit('toast', { msg: msg, kind: kind || 'info' }); };

  /* ------------------------------------------------------------ state */
  L.doc = null;
  L.fg = '#101114';
  L.bg = '#ffffff';
  L.view = { zoom: 1, x: 0, y: 0 };
  L.sel = null;
  L.preview = null;
  L.tool = 'move';
  L.MAX_SIDE = 6000;

  let uid = 1, revCounter = 1;
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  L.mkCanvas = mkCanvas;
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  L.clamp = clamp;
  function rgba(hex, a) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    const n = parseInt(hex, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  L.rgba = rgba;

  /* ------------------------------------------------------------ layers */
  function createLayer(o) {
    const l = {
      id: 'l' + (uid++), name: 'Layer', kind: 'raster', canvas: null,
      cx: 0, cy: 0, sx: 1, sy: 1, rot: 0,
      opacity: 1, blend: 'source-over', visible: true, locked: false,
      adj: A.defaults(), shadow: { on: false, color: '#000000', blur: 14, x: 0, y: 8, opacity: 0.45 },
      text: null, shape: null, frozen: false, rev: revCounter++
    };
    return Object.assign(l, o || {});
  }
  L.createLayer = createLayer;

  function cloneMeta(l) {
    return {
      id: l.id, name: l.name, kind: l.kind, cx: l.cx, cy: l.cy, sx: l.sx, sy: l.sy, rot: l.rot,
      opacity: l.opacity, blend: l.blend, visible: l.visible, locked: l.locked,
      adj: Object.assign({}, l.adj), shadow: Object.assign({}, l.shadow),
      text: l.text ? Object.assign({}, l.text) : null, shape: l.shape ? Object.assign({}, l.shape) : null
    };
  }
  L.cloneMeta = cloneMeta;

  L.active = function () {
    if (!L.doc) return null;
    return L.doc.layers.filter(function (l) { return l.id === L.doc.activeId; })[0] || null;
  };
  L.layerById = function (id) { return L.doc ? L.doc.layers.filter(function (l) { return l.id === id; })[0] : null; };
  L.setActive = function (id) {
    if (!L.doc || L.doc.activeId === id) return;
    L.doc.activeId = id; L.emit('active'); L.invalidateOverlay();
  };

  /* copy-on-write: layer canvases are shared with history snapshots until first edit */
  L.own = function (l) {
    if (l.frozen) {
      const c = mkCanvas(l.canvas.width, l.canvas.height);
      c.getContext('2d').drawImage(l.canvas, 0, 0);
      l.canvas = c; l.frozen = false;
    }
    l.rev = revCounter++;
    return l;
  };
  L.touch = function (l) { l.rev = revCounter++; L.invalidate(); };

  function isIdentityRaster(l) {
    const d = L.doc;
    return l.kind === 'raster' && l.canvas.width === d.w && l.canvas.height === d.h &&
      l.cx === d.w / 2 && l.cy === d.h / 2 && l.sx === 1 && l.sy === 1 && l.rot === 0;
  }
  function drawBitmap(ctx, l) {
    ctx.save();
    ctx.translate(l.cx, l.cy); if (l.rot) ctx.rotate(l.rot); ctx.scale(l.sx, l.sy);
    ctx.drawImage(l.canvas, -l.canvas.width / 2, -l.canvas.height / 2);
    ctx.restore();
  }
  L.drawBitmap = drawBitmap;

  /* Painting needs a plain document-sized bitmap. Anything else is baked into one. */
  L.ensureRaster = function (l) {
    if (isIdentityRaster(l)) { L.own(l); return l; }
    const d = L.doc, c = mkCanvas(d.w, d.h);
    drawBitmap(c.getContext('2d'), l);
    const was = l.kind;
    l.canvas = c; l.frozen = false; l.kind = 'raster';
    l.cx = d.w / 2; l.cy = d.h / 2; l.sx = 1; l.sy = 1; l.rot = 0; l.text = null; l.shape = null;
    l.rev = revCounter++;
    if (was !== 'raster') L.toast('Layer converted to pixels so you can paint on it.');
    L.emit('layers');
    return l;
  };
  /* Used by tools: returns active layer ready to paint on, or null (with a message) */
  L.paintTarget = function () {
    const l = L.active();
    if (!l) { L.toast('Open or create an image first.'); return null; }
    if (l.locked) { L.toast('This layer is locked. Unlock it in the Layers panel.'); return null; }
    if (!l.visible) { L.toast('This layer is hidden. Show it to paint.'); return null; }
    return L.ensureRaster(l);
  };

  /* ------------------------------------------------------------ history */
  const H = (L.history = { stack: [], idx: -1 });
  function snapshot(label) {
    const d = L.doc;
    return {
      label: label, w: d.w, h: d.h, name: d.name, activeId: d.activeId,
      layers: d.layers.map(function (l) { l.frozen = true; return { meta: cloneMeta(l), canvas: l.canvas }; })
    };
  }
  function restore(s) {
    const d = L.doc;
    const dimsChanged = d.w !== s.w || d.h !== s.h;
    d.w = s.w; d.h = s.h; d.activeId = s.activeId;
    d.layers = s.layers.map(function (e) {
      const m = cloneMeta(e.meta);
      return Object.assign(m, { canvas: e.canvas, frozen: true, rev: revCounter++ });
    });
    if (dimsChanged) L.sel = null;
    L.emit('layers'); L.emit('active'); L.emit('doc'); L.emit('selection');
    L.invalidate();
  }
  function trimHistory() {
    const max = 70, budget = 900 * 1024 * 1024;
    while (H.stack.length > max) { H.stack.shift(); H.idx--; }
    for (;;) {
      const seen = new Set(); let bytes = 0;
      H.stack.forEach(function (s) { s.layers.forEach(function (e) { if (!seen.has(e.canvas)) { seen.add(e.canvas); bytes += e.canvas.width * e.canvas.height * 4; } }); });
      if (bytes <= budget || H.stack.length <= 3) break;
      H.stack.shift(); H.idx--;
    }
  }
  L.commit = function (label) {
    if (!L.doc) return;
    H.stack.length = H.idx + 1;
    H.stack.push(snapshot(label || 'Edit'));
    H.idx = H.stack.length - 1;
    trimHistory();
    L.doc.dirty = true;
    L.emit('history'); L.emit('layers');
    L.queueAutosave();
  };
  L.resetHistory = function (label) {
    H.stack = []; H.idx = -1;
    L.commit(label);
    L.doc.dirty = false;
  };
  L.undo = function () { if (H.idx > 0) { H.idx--; restore(H.stack[H.idx]); L.emit('history'); } };
  L.redo = function () { if (H.idx < H.stack.length - 1) { H.idx++; restore(H.stack[H.idx]); L.emit('history'); } };
  L.jumpTo = function (i) { if (i >= 0 && i < H.stack.length && i !== H.idx) { H.idx = i; restore(H.stack[i]); L.emit('history'); } };

  /* ------------------------------------------------------------ document */
  L.newDoc = function (w, h, o) {
    o = o || {};
    w = clamp(Math.round(w), 1, L.MAX_SIDE); h = clamp(Math.round(h), 1, L.MAX_SIDE);
    L.doc = { w: w, h: h, layers: [], activeId: null, name: o.name || 'Untitled', dirty: false };
    L.sel = null; L.preview = null;
    const bgFill = o.fill === undefined ? '#ffffff' : o.fill;
    const base = createLayer({ name: bgFill ? 'Background' : 'Layer 1', canvas: mkCanvas(w, h), cx: w / 2, cy: h / 2 });
    if (bgFill) { const c = base.canvas.getContext('2d'); c.fillStyle = bgFill; c.fillRect(0, 0, w, h); }
    L.doc.layers.push(base); L.doc.activeId = base.id;
    L.resetHistory('New document');
    L.emit('doc'); L.emit('layers'); L.emit('active'); L.emit('selection');
    L.fit(); L.invalidate();
    return L.doc;
  };

  L.fitSize = function (w, h) {
    const s = Math.min(1, L.MAX_SIDE / Math.max(w, h));
    return { w: Math.round(w * s), h: Math.round(h * s), scale: s };
  };

  /* source: ImageBitmap | HTMLImageElement | HTMLCanvasElement */
  function srcToCanvas(src, w, h) {
    const c = mkCanvas(w, h), ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return c;
  }
  L.openImageAsDoc = function (src, name) {
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    const f = L.fitSize(sw, sh);
    L.newDoc(f.w, f.h, { name: name || 'Image', fill: null });
    const l = L.active();
    l.canvas = srcToCanvas(src, f.w, f.h); l.name = (name || 'Image').replace(/\.[a-z0-9]+$/i, ''); l.frozen = false; l.rev = revCounter++;
    L.resetHistory('Open image');
    L.emit('layers'); L.invalidate();
    if (f.scale < 1) L.toast('Large image scaled down to ' + f.w + ' × ' + f.h + ' px to keep editing smooth.');
    return l;
  };
  L.addImageLayer = function (src, name, pos) {
    if (!L.doc) return L.openImageAsDoc(src, name);
    const d = L.doc;
    let sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    let k = 1;
    if (sw > d.w || sh > d.h) k = Math.min(d.w / sw, d.h / sh);
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const l = createLayer({ name: (name || 'Image').replace(/\.[a-z0-9]+$/i, ''), kind: 'image', canvas: srcToCanvas(src, w, h), cx: pos ? pos.x : d.w / 2, cy: pos ? pos.y : d.h / 2 });
    d.layers.push(l); d.activeId = l.id;
    L.commit('Place image'); L.emit('active'); L.invalidate();
    return l;
  };
  L.decodeFile = async function (file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
    }
    return new Promise(function (res, rej) {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('decode')); };
      img.src = url;
    });
  };
  L.openFiles = async function (files, asLayer) {
    files = Array.prototype.slice.call(files || []);
    let first = !asLayer && !L.doc;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (/\.(json|chumi)$/i.test(f.name) || f.type === 'application/json') { try { await L.loadProject(await f.text()); first = false; } catch (e) { L.toast('That project file could not be read.', 'error'); } continue; }
      if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name)) { L.toast('“' + f.name + '” is not an image Chumi.edit can open. Try PNG, JPG, WebP, GIF, BMP or SVG.', 'error'); continue; }
      try {
        const src = await L.decodeFile(f);
        if (first || (!asLayer && i === 0)) { L.openImageAsDoc(src, f.name); first = false; } else L.addImageLayer(src, f.name);
      } catch (e) { L.toast('Could not open “' + f.name + '”. The file may be damaged.', 'error'); }
    }
  };

  /* ------------------------------------------------------------ layer ops */
  function insertIndex() {
    const d = L.doc; let idx = d.layers.findIndex(function (l) { return l.id === d.activeId; });
    return idx < 0 ? d.layers.length : idx + 1;
  }
  L.addLayer = function (name) {
    if (!L.doc) return null;
    const d = L.doc;
    const l = createLayer({ name: name || 'Layer ' + (d.layers.length + 1), canvas: mkCanvas(d.w, d.h), cx: d.w / 2, cy: d.h / 2 });
    d.layers.splice(insertIndex(), 0, l); d.activeId = l.id;
    L.commit('New layer'); L.emit('active'); L.invalidate();
    return l;
  };
  L.dupLayer = function () {
    const l = L.active(); if (!l) return;
    const d = L.doc, n = createLayer(Object.assign(cloneMeta(l), { id: undefined }));
    n.id = 'l' + (uid++); n.canvas = l.canvas; n.frozen = true; l.frozen = true; n.name = l.name + ' copy';
    n.cx += 0; n.cy += 0;
    d.layers.splice(d.layers.indexOf(l) + 1, 0, n); d.activeId = n.id;
    L.commit('Duplicate layer'); L.emit('active'); L.invalidate();
  };
  L.delLayer = function (id) {
    const d = L.doc; if (!d) return;
    const l = id ? L.layerById(id) : L.active(); if (!l) return;
    if (d.layers.length === 1) { L.toast('A document needs at least one layer. Clear it instead.'); return; }
    const i = d.layers.indexOf(l); d.layers.splice(i, 1);
    d.activeId = d.layers[Math.min(i, d.layers.length - 1)].id;
    L.commit('Delete layer'); L.emit('active'); L.invalidate();
  };
  L.moveLayer = function (id, to) {
    const d = L.doc, l = L.layerById(id); if (!l) return;
    const i = d.layers.indexOf(l); to = clamp(to, 0, d.layers.length - 1);
    if (to === i) return;
    d.layers.splice(i, 1); d.layers.splice(to, 0, l);
    L.commit('Reorder layers'); L.invalidate();
  };
  L.arrange = function (how) {
    const d = L.doc, l = L.active(); if (!l) return;
    const i = d.layers.indexOf(l);
    const to = how === 'front' ? d.layers.length - 1 : how === 'back' ? 0 : how === 'forward' ? i + 1 : i - 1;
    L.moveLayer(l.id, to);
  };
  L.setLayerProp = function (id, prop, val, commitLabel) {
    const l = L.layerById(id); if (!l) return;
    l[prop] = val; L.invalidate();
    if (commitLabel) L.commit(commitLabel);
  };

  function renderLayersTo(layers) {
    const d = L.doc, c = mkCanvas(d.w, d.h), ctx = c.getContext('2d');
    layers.forEach(function (l) { drawLayer(ctx, l); });
    return c;
  }
  L.mergeDown = function () {
    const d = L.doc, l = L.active(); if (!l) return;
    const i = d.layers.indexOf(l);
    if (i === 0) { L.toast('There is no layer below to merge into.'); return; }
    const lower = d.layers[i - 1];
    const merged = createLayer({ name: lower.name, canvas: renderLayersTo([lower, l]), cx: d.w / 2, cy: d.h / 2 });
    d.layers.splice(i - 1, 2, merged); d.activeId = merged.id;
    L.commit('Merge down'); L.emit('active'); L.invalidate();
  };
  L.flatten = function () {
    const d = L.doc; if (!d || d.layers.length < 2) return;
    const vis = d.layers.filter(function (l) { return l.visible; });
    const f = createLayer({ name: 'Flattened', canvas: renderLayersTo(vis), cx: d.w / 2, cy: d.h / 2 });
    d.layers = [f]; d.activeId = f.id;
    L.commit('Flatten image'); L.emit('active'); L.invalidate();
  };
  L.rasterize = function () {
    const l = L.active(); if (!l) return;
    if (l.kind === 'raster' && isIdentityRaster(l)) { L.toast('This layer is already pixels.'); return; }
    L.ensureRaster(l); L.commit('Rasterize layer'); L.invalidate();
  };
  L.bakeAdjustments = function () {
    const l = L.active(); if (!l || A.isNeutral(l.adj)) return;
    const baked = A.render(l.canvas, l.adj);
    L.own(l); l.canvas = baked; l.frozen = false; l.adj = A.defaults(); l.rev = revCounter++;
    if (l.kind !== 'raster') { l.kind = l.kind === 'image' ? 'image' : 'raster'; l.text = null; l.shape = null; }
    L.commit('Apply adjustments'); L.emit('active'); L.invalidate();
  };
  L.clearLayer = function () {
    const l = L.paintTarget(); if (!l) return;
    const ctx = l.canvas.getContext('2d');
    if (L.sel) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(L.sel.mask, 0, 0); ctx.restore(); }
    else ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    L.touch(l); L.commit(L.sel ? 'Clear selection' : 'Clear layer');
  };
  L.fillLayer = function (color) {
    const l = L.paintTarget(); if (!l) return;
    const t = mkCanvas(l.canvas.width, l.canvas.height), c = t.getContext('2d');
    c.fillStyle = color; c.fillRect(0, 0, t.width, t.height);
    L.paintThroughSel(l, t, 'source-over', 1);
    L.touch(l); L.commit('Fill');
  };

  /* flips and 90° turns of a single layer */
  L.flipLayer = function (axis) {
    const l = L.active(); if (!l) return;
    if (axis === 'h') { l.sx = -l.sx; l.rot = -l.rot; } else { l.sy = -l.sy; l.rot = -l.rot; }
    L.commit(axis === 'h' ? 'Flip layer horizontally' : 'Flip layer vertically'); L.emit('active'); L.invalidate();
  };
  L.rotateLayer = function (deg) {
    const l = L.active(); if (!l) return;
    l.rot += deg * Math.PI / 180;
    L.commit('Rotate layer'); L.emit('active'); L.invalidate();
  };

  /* ------------------------------------------------------------ text */
  const SERIFS = ['Georgia', 'Times New Roman', 'Playfair Display', 'Merriweather'];
  function fontStr(T) {
    const fb = SERIFS.indexOf(T.font) >= 0 ? 'serif' : T.font === 'Courier New' ? 'monospace' : 'sans-serif';
    return (T.italic ? 'italic ' : '') + T.weight + ' ' + T.size + 'px "' + T.font + '", ' + fb;
  }
  L.fontStr = fontStr;
  const scratch = mkCanvas(2, 2).getContext('2d');
  L.textDefaults = function () {
    return { text: 'Your text', font: 'Bricolage Grotesque', size: 96, weight: 700, italic: false, align: 'left', color: L.fg, lineHeight: 1.15, spacing: 0, strokeOn: false, strokeColor: '#000000', strokeW: 6 };
  };
  function renderText(l) {
    const T = l.text;
    scratch.font = fontStr(T);
    if ('letterSpacing' in scratch) scratch.letterSpacing = T.spacing + 'px';
    const lines = String(T.text || ' ').split('\n');
    const widths = lines.map(function (s) { return scratch.measureText(s || ' ').width; });
    const lh = T.size * T.lineHeight;
    const pad = Math.ceil(T.size * 0.12 + (T.strokeOn ? T.strokeW : 0) + 4);
    const W = Math.ceil(Math.max.apply(null, widths)) + pad * 2, H = Math.ceil(lines.length * lh) + pad * 2;
    const old = l.canvas, ow = old ? old.width : W, oh = old ? old.height : H;
    const c = mkCanvas(Math.min(W, 8192), Math.min(H, 8192)), ctx = c.getContext('2d');
    ctx.font = fontStr(T);
    if ('letterSpacing' in ctx) ctx.letterSpacing = T.spacing + 'px';
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    const ax = T.align === 'center' ? W / 2 : T.align === 'right' ? W - pad : pad;
    ctx.textAlign = T.align;
    lines.forEach(function (s, i) {
      const y = pad + i * lh + lh / 2;
      if (T.strokeOn && T.strokeW > 0) { ctx.strokeStyle = T.strokeColor; ctx.lineWidth = T.strokeW * 2; ctx.strokeText(s, ax, y); }
      ctx.fillStyle = T.color; ctx.fillText(s, ax, y);
    });
    // keep the anchor edge still while the box grows
    if (old && l.rot === 0) {
      const dw = (c.width - ow) * Math.abs(l.sx), dh = (c.height - oh) * Math.abs(l.sy);
      if (T.align === 'left') l.cx += dw / 2; else if (T.align === 'right') l.cx -= dw / 2;
      l.cy += dh / 2;
    }
    l.canvas = c; l.frozen = false; l.rev = revCounter++;
  }
  L.createTextLayer = function (x, y, patch) {
    const d = L.doc; if (!d) return null;
    const l = createLayer({ name: 'Text', kind: 'text', text: Object.assign(L.textDefaults(), patch || {}) });
    renderText(l);
    l.cx = x + l.canvas.width / 2; l.cy = y + l.canvas.height / 2;
    l.name = String(l.text.text).split('\n')[0].slice(0, 24) || 'Text';
    d.layers.splice(insertIndex(), 0, l); d.activeId = l.id;
    L.emit('active'); L.invalidate();
    ensureFont(l);
    return l;
  };
  function ensureFont(l) {
    const spec = fontStr(l.text);
    if (!document.fonts || !document.fonts.load) return;
    document.fonts.load(spec, l.text.text || 'A').then(function () {
      if (l.text && fontStr(l.text) === spec) { renderText(l); L.invalidate(); L.emit('layers'); }
    }).catch(function () { /* font unavailable, system fallback stays */ });
  }
  L.updateText = function (l, patch, label) {
    if (!l || l.kind !== 'text') return;
    Object.assign(l.text, patch);
    renderText(l);
    if (patch.text !== undefined) l.name = String(l.text.text).split('\n')[0].slice(0, 24) || 'Text';
    L.invalidate(); L.emit('layers');
    if (patch.font !== undefined || patch.weight !== undefined || patch.italic !== undefined) ensureFont(l);
    if (label) L.commit(label);
  };

  /* ------------------------------------------------------------ shapes */
  L.shapeDefaults = function () {
    return { type: 'rect', w: 200, h: 200, fillOn: true, fill: L.fg, strokeOn: false, stroke: '#000000', strokeW: 6, radius: 0, sides: 5, flipY: false };
  };
  function shapePath(ctx, S, x, y, w, h) {
    ctx.beginPath();
    const cx = x + w / 2, cy = y + h / 2;
    if (S.type === 'rect') {
      const r = Math.min(S.radius, w / 2, h / 2);
      if (r > 0) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
      else ctx.rect(x, y, w, h);
    } else if (S.type === 'ellipse') {
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (S.type === 'triangle') {
      ctx.moveTo(cx, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
    } else if (S.type === 'line') {
      if (S.flipY) { ctx.moveTo(x, y + h); ctx.lineTo(x + w, y); } else { ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); }
    } else if (S.type === 'star' || S.type === 'polygon') {
      const n = S.type === 'star' ? Math.max(3, S.sides) * 2 : Math.max(3, S.sides);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / n;
        const k = S.type === 'star' && i % 2 ? 0.45 : 1;
        const px = cx + Math.cos(a) * w / 2 * k, py = cy + Math.sin(a) * h / 2 * k;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
    }
  }
  function renderShape(l) {
    const S = l.shape, sw = S.strokeOn || S.type === 'line' ? S.strokeW : 0;
    const pad = Math.ceil(sw / 2) + 2;
    const W = Math.max(1, Math.round(S.w)), H = Math.max(1, Math.round(S.h));
    const c = mkCanvas(W + pad * 2, H + pad * 2), ctx = c.getContext('2d');
    shapePath(ctx, S, pad, pad, W, H);
    if (S.type !== 'line' && S.fillOn) { ctx.fillStyle = S.fill; ctx.fill(); }
    if (S.type === 'line') { ctx.strokeStyle = S.stroke; ctx.lineWidth = Math.max(1, S.strokeW); ctx.lineCap = 'round'; ctx.stroke(); }
    else if (S.strokeOn && S.strokeW > 0) { ctx.strokeStyle = S.stroke; ctx.lineWidth = S.strokeW; ctx.lineJoin = 'round'; ctx.stroke(); }
    l.canvas = c; l.frozen = false; l.rev = revCounter++;
  }
  L.createShapeLayer = function (x, y, w, h, patch) {
    const d = L.doc; if (!d) return null;
    const S = Object.assign(L.shapeDefaults(), patch || {}, { w: Math.max(2, Math.abs(w)), h: Math.max(2, Math.abs(h)) });
    if (S.type === 'line') { S.fillOn = false; S.stroke = S.stroke === '#000000' ? L.fg : S.stroke; S.strokeW = Math.max(2, S.strokeW); S.flipY = (h < 0) !== (w < 0); }
    const names = { rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', line: 'Line', star: 'Star', polygon: 'Polygon' };
    const l = createLayer({ name: names[S.type] || 'Shape', kind: 'shape', shape: S });
    renderShape(l);
    const pad = Math.ceil((S.strokeOn || S.type === 'line' ? S.strokeW : 0) / 2) + 2;
    l.cx = Math.min(x, x + w) + S.w / 2; l.cy = Math.min(y, y + h) + S.h / 2;
    d.layers.splice(insertIndex(), 0, l); d.activeId = l.id;
    L.commit('Draw ' + (names[S.type] || 'shape').toLowerCase()); L.emit('active'); L.invalidate();
    return l;
  };
  L.updateShape = function (l, patch, label) {
    if (!l || l.kind !== 'shape') return;
    const oldW = l.canvas.width, oldH = l.canvas.height;
    Object.assign(l.shape, patch);
    renderShape(l);
    L.invalidate(); L.emit('layers');
    if (label) L.commit(label);
  };
  /* After a free transform, text and shapes re-render crisply at their new size */
  L.bakeTransform = function (l) {
    if (l.kind === 'text') {
      const s = (Math.abs(l.sx) + Math.abs(l.sy)) / 2;
      if (Math.abs(s - 1) > 0.001) { l.text.size = Math.max(4, Math.round(l.text.size * s * 10) / 10); l.sx = Math.sign(l.sx) || 1; l.sy = Math.sign(l.sy) || 1; const cx = l.cx, cy = l.cy; renderText(l); l.cx = cx; l.cy = cy; }
    } else if (l.kind === 'shape') {
      const ax = Math.abs(l.sx), ay = Math.abs(l.sy);
      if (Math.abs(ax - 1) > 0.001 || Math.abs(ay - 1) > 0.001) {
        l.shape.w = Math.max(2, l.shape.w * ax); l.shape.h = Math.max(2, l.shape.h * ay);
        l.sx = Math.sign(l.sx) || 1; l.sy = Math.sign(l.sy) || 1; renderShape(l);
      }
    }
  };

  /* ------------------------------------------------------------ rendering */
  let comp = null, pvTmp = null, pvMask = null;
  function applyPreview(l, pv) {
    if (!pvTmp || pvTmp.width !== l.canvas.width || pvTmp.height !== l.canvas.height) pvTmp = mkCanvas(l.canvas.width, l.canvas.height);
    const ctx = pvTmp.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, pvTmp.width, pvTmp.height);
    ctx.drawImage(l.canvas, 0, 0);
    let buf = pv.buf;
    if (L.sel && !pv.ignoreSel) {
      if (!pvMask || pvMask.width !== buf.width || pvMask.height !== buf.height) pvMask = mkCanvas(buf.width, buf.height);
      const m = pvMask.getContext('2d'); m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, pvMask.width, pvMask.height);
      m.drawImage(buf, 0, 0); m.globalCompositeOperation = 'destination-in'; m.drawImage(L.sel.mask, 0, 0);
      buf = pvMask;
    }
    ctx.globalAlpha = pv.alpha == null ? 1 : pv.alpha;
    ctx.globalCompositeOperation = pv.op === 'erase' ? 'destination-out' : 'source-over';
    ctx.drawImage(buf, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    return pvTmp;
  }
  function layerBitmap(l) {
    let src = l.canvas;
    const pv = L.preview;
    if (pv && pv.layerId === l.id && pv.buf) src = applyPreview(l, pv);
    if (!A.isNeutral(l.adj)) {
      if (src === l.canvas) {
        const k = l.rev + '|' + A.key(l.adj);
        if (l._ac && l._ack === k) return l._ac;
        l._ac = A.render(src, l.adj, l._ac); l._ack = k;
        return l._ac;
      }
      return A.render(src, l.adj);
    }
    return src;
  }
  function drawLayer(ctx, l) {
    const bm = layerBitmap(l);
    ctx.save();
    ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = l.blend;
    if (l.shadow && l.shadow.on) {
      ctx.shadowColor = rgba(l.shadow.color, l.shadow.opacity); ctx.shadowBlur = l.shadow.blur;
      ctx.shadowOffsetX = l.shadow.x; ctx.shadowOffsetY = l.shadow.y;
    }
    ctx.translate(l.cx, l.cy); if (l.rot) ctx.rotate(l.rot); ctx.scale(l.sx, l.sy);
    ctx.drawImage(bm, -bm.width / 2, -bm.height / 2);
    ctx.restore();
  }
  L.drawLayer = drawLayer;

  L.composite = function () {
    const d = L.doc; if (!d) return null;
    if (!comp || comp.width !== d.w || comp.height !== d.h) comp = mkCanvas(d.w, d.h);
    const ctx = comp.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, d.w, d.h);
    d.layers.forEach(function (l) { if (l.visible) drawLayer(ctx, l); });
    return comp;
  };
  L.flatCanvas = function (opts) {
    opts = opts || {};
    const d = L.doc, c = mkCanvas(d.w, d.h), ctx = c.getContext('2d');
    if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fillRect(0, 0, d.w, d.h); }
    d.layers.forEach(function (l) { if (l.visible) drawLayer(ctx, l); });
    return c;
  };

  /* ------------------------------------------------------------ view */
  const dom = (L.dom = { stage: null, view: null, ov: null });
  let dpr = 1, raf = 0, needComp = true, needView = true, needOv = true, checker = null;

  L.attachView = function (stage, view, ov) {
    dom.stage = stage; dom.view = view; dom.ov = ov;
    const ro = new ResizeObserver(function () { sizeCanvases(); });
    ro.observe(stage); sizeCanvases();
  };
  function sizeCanvases() {
    if (!dom.stage) return;
    const r = dom.stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    [dom.view, dom.ov].forEach(function (c) { c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; });
    if (L.doc && L.autoFit) L.fit(); else L.invalidate();
  }
  L.stageSize = function () { const r = dom.stage.getBoundingClientRect(); return { w: r.width, h: r.height }; };
  L.autoFit = true;
  L.fit = function () {
    if (!L.doc || !dom.stage) return;
    const s = L.stageSize(), m = s.w < 700 ? 16 : 56;
    const z = Math.min((s.w - m * 2) / L.doc.w, (s.h - m * 2) / L.doc.h);
    L.view.zoom = clamp(z, 0.02, 32);
    L.view.x = (s.w - L.doc.w * L.view.zoom) / 2; L.view.y = (s.h - L.doc.h * L.view.zoom) / 2;
    L.autoFit = true; L.emit('view'); L.invalidate();
  };
  L.setZoom = function (z, sx, sy) {
    if (!L.doc) return;
    const s = L.stageSize();
    if (sx == null) { sx = s.w / 2; sy = s.h / 2; }
    z = clamp(z, 0.02, 64);
    const dx = (sx - L.view.x) / L.view.zoom, dy = (sy - L.view.y) / L.view.zoom;
    L.view.zoom = z; L.view.x = sx - dx * z; L.view.y = sy - dy * z;
    L.autoFit = false; L.emit('view'); L.invalidate();
  };
  L.panBy = function (dx, dy) { L.view.x += dx; L.view.y += dy; L.autoFit = false; L.invalidate(); };
  L.toDoc = function (cx, cy) {
    const r = dom.stage.getBoundingClientRect();
    return { x: (cx - r.left - L.view.x) / L.view.zoom, y: (cy - r.top - L.view.y) / L.view.zoom };
  };
  L.toScreen = function (x, y) { return { x: x * L.view.zoom + L.view.x, y: y * L.view.zoom + L.view.y }; };

  L.invalidate = function () { needComp = needView = true; schedule(); };
  L.invalidateView = function () { needView = true; schedule(); };
  L.invalidateOverlay = function () { needOv = true; schedule(); };
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0;
    if (!dom.view) return;
    if (needComp) { L.composite(); needComp = false; L.emit('composite'); }
    if (needView) { drawView(); needView = false; needOv = true; }
    if (needOv) { drawOverlay(); needOv = false; }
  }

  function checkerPattern(ctx) {
    if (!checker) {
      const c = mkCanvas(16, 16), x = c.getContext('2d');
      x.fillStyle = '#d4d6da'; x.fillRect(0, 0, 16, 16);
      x.fillStyle = '#eceef0'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
      checker = c;
    }
    return ctx.createPattern(checker, 'repeat');
  }

  function drawView() {
    const c = dom.view, ctx = c.getContext('2d'), d = L.doc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f1012'; ctx.fillRect(0, 0, c.width, c.height);
    if (!d || !comp) return;
    const z = L.view.zoom, x0 = L.view.x, y0 = L.view.y;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // visible part of the document
    const s = L.stageSize();
    const vx0 = Math.max(0, Math.floor(-x0 / z)), vy0 = Math.max(0, Math.floor(-y0 / z));
    const vx1 = Math.min(d.w, Math.ceil((s.w - x0) / z)), vy1 = Math.min(d.h, Math.ceil((s.h - y0) / z));
    if (vx1 <= vx0 || vy1 <= vy0) return;
    const dx = x0 + vx0 * z, dy = y0 + vy0 * z, dw = (vx1 - vx0) * z, dh = (vy1 - vy0) * z;
    ctx.save();
    ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
    ctx.fillStyle = checkerPattern(ctx); ctx.fillRect(dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = z < 2.5; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(comp, vx0, vy0, vx1 - vx0, vy1 - vy0, dx, dy, dw, dh);
    ctx.restore();
    if (z >= 10) {
      ctx.save(); ctx.strokeStyle = 'rgba(128,128,128,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = vx0; x <= vx1; x++) { const px = Math.round(x0 + x * z) + 0.5; ctx.moveTo(px, dy); ctx.lineTo(px, dy + dh); }
      for (let y = vy0; y <= vy1; y++) { const py = Math.round(y0 + y * z) + 0.5; ctx.moveTo(dx, py); ctx.lineTo(dx + dw, py); }
      ctx.stroke(); ctx.restore();
    }
  }

  L.showGrid = false;
  let antOffset = 0;
  setInterval(function () { if (L.sel || (L.tools && L.tools[L.tool] && L.tools[L.tool].animate)) { antOffset = (antOffset + 1) % 16; L.invalidateOverlay(); } }, 110);

  function drawOverlay() {
    const c = dom.ov, ctx = c.getContext('2d'), d = L.doc;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    if (!d) return;
    const z = L.view.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // document edge
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(L.view.x) - 0.5, Math.round(L.view.y) - 0.5, Math.round(d.w * z) + 1, Math.round(d.h * z) + 1);
    if (L.showGrid) {
      const step = L.gridStep(); ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath();
      for (let x = step; x < d.w; x += step) { const px = Math.round(L.view.x + x * z) + 0.5; ctx.moveTo(px, L.view.y); ctx.lineTo(px, L.view.y + d.h * z); }
      for (let y = step; y < d.h; y += step) { const py = Math.round(L.view.y + y * z) + 0.5; ctx.moveTo(L.view.x, py); ctx.lineTo(L.view.x + d.w * z, py); }
      ctx.stroke();
    }
    // selection ants
    if (L.sel && L.sel.path) {
      ctx.save();
      ctx.translate(L.view.x, L.view.y); ctx.scale(z, z);
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.strokeStyle = '#000'; ctx.lineDashOffset = -antOffset / 2 / z; ctx.stroke(L.sel.path);
      ctx.strokeStyle = '#fff'; ctx.lineDashOffset = (-antOffset / 2 + 4) / z; ctx.stroke(L.sel.path);
      ctx.restore();
    }
    const t = L.tools && L.tools[L.tool];
    if (t && t.overlay) { ctx.save(); t.overlay(ctx, z); ctx.restore(); }
  }
  L.gridStep = function () {
    const d = L.doc; const base = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    for (let i = 0; i < base.length; i++) if (base[i] * L.view.zoom >= 36) return base[i];
    return 2000;
  };

  /* ------------------------------------------------------------ selection */
  L.selOutline = function (mask) {
    const w = mask.width, h = mask.height;
    const d = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const path = new Path2D();
    let prev = new Uint8Array(w), row = new Uint8Array(w);
    const openV = new Int32Array(w + 1).fill(-1);
    let segs = 0, minx = w, miny = h, maxx = -1, maxy = -1;
    for (let y = 0; y <= h; y++) {
      if (y < h) {
        const o = y * w * 4;
        for (let x = 0; x < w; x++) {
          const v = d[o + x * 4 + 3] >= 128 ? 1 : 0; row[x] = v;
          if (v) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
        }
      } else row.fill(0);
      let hs = -1;
      for (let x = 0; x <= w; x++) {
        const edge = x < w && row[x] !== prev[x];
        if (edge) { if (hs < 0) hs = x; } else if (hs >= 0) { path.moveTo(hs, y); path.lineTo(x, y); segs++; hs = -1; }
      }
      for (let x = 0; x <= w; x++) {
        const l = x > 0 ? row[x - 1] : 0, r = x < w ? row[x] : 0;
        const edge = l !== r;
        if (edge) { if (openV[x] < 0) openV[x] = y; }
        else if (openV[x] >= 0) { path.moveTo(x, openV[x]); path.lineTo(x, y); segs++; openV[x] = -1; }
      }
      const t = prev; prev = row; row = t;
    }
    if (maxx < 0) return null;
    const bounds = { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
    if (segs > 160000) {
      const p2 = new Path2D(); p2.rect(bounds.x, bounds.y, bounds.w, bounds.h);
      return { path: p2, bounds: bounds, simplified: true };
    }
    return { path: path, bounds: bounds };
  };
  function setSel(mask) {
    const o = mask ? L.selOutline(mask) : null;
    L.sel = o ? { mask: mask, path: o.path, bounds: o.bounds } : null;
    L.emit('selection'); L.invalidateOverlay();
  }
  /* drawFn(ctx) paints the new shape in white on a document-sized canvas */
  L.selectShape = function (drawFn, mode) {
    const d = L.doc; if (!d) return;
    const m = mkCanvas(d.w, d.h), c = m.getContext('2d'); c.fillStyle = '#fff'; drawFn(c);
    L.selectCombine(m, mode);
  };
  L.selectCombine = function (m, mode) {
    if (!L.sel || !mode || mode === 'new') { setSel(m); return; }
    const base = mkCanvas(m.width, m.height), bc = base.getContext('2d');
    bc.drawImage(L.sel.mask, 0, 0);
    if (mode === 'add') bc.drawImage(m, 0, 0);
    else if (mode === 'sub') { bc.globalCompositeOperation = 'destination-out'; bc.drawImage(m, 0, 0); }
    else if (mode === 'int') { bc.globalCompositeOperation = 'destination-in'; bc.drawImage(m, 0, 0); }
    setSel(base);
  };
  L.selectAll = function () { if (!L.doc) return; L.selectShape(function (c) { c.fillRect(0, 0, L.doc.w, L.doc.h); }, 'new'); };
  L.deselect = function () { if (L.sel) { L.sel = null; L.emit('selection'); L.invalidateOverlay(); } };
  L.invertSel = function () {
    if (!L.doc) return;
    if (!L.sel) { L.selectAll(); return; }
    const m = mkCanvas(L.doc.w, L.doc.h), c = m.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, m.width, m.height);
    c.globalCompositeOperation = 'destination-out'; c.drawImage(L.sel.mask, 0, 0);
    setSel(m);
  };
  L.featherSel = function (r) {
    if (!L.sel) return;
    const m = mkCanvas(L.sel.mask.width, L.sel.mask.height); m.getContext('2d').drawImage(L.sel.mask, 0, 0);
    L.Filters.gaussian(m, r / 2);
    setSel(m);
  };
  L.growSel = function (px) {
    if (!L.sel) return;
    const m = mkCanvas(L.sel.mask.width, L.sel.mask.height), c = m.getContext('2d');
    if (px >= 0) { for (let a = 0; a < 16; a++) { c.drawImage(L.sel.mask, Math.cos(a / 16 * 6.2832) * px, Math.sin(a / 16 * 6.2832) * px); } c.drawImage(L.sel.mask, 0, 0); }
    else {
      c.drawImage(L.sel.mask, 0, 0); c.globalCompositeOperation = 'destination-in';
      for (let a = 0; a < 16; a++) c.drawImage(L.sel.mask, Math.cos(a / 16 * 6.2832) * -px, Math.sin(a / 16 * 6.2832) * -px);
    }
    setSel(m);
  };
  L.selFromMaskData = function (maskArr, w, h, mode) {
    const m = mkCanvas(w, h), c = m.getContext('2d'), img = c.createImageData(w, h);
    for (let i = 0; i < maskArr.length; i++) { const v = maskArr[i]; if (v) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = v; } }
    c.putImageData(img, 0, 0);
    L.selectCombine(m, mode);
  };

  /* paint `buf` (document-sized canvas) onto layer l, limited by the selection */
  L.paintThroughSel = function (l, buf, op, alpha) {
    const ctx = l.canvas.getContext('2d');
    let src = buf;
    if (L.sel) {
      src = mkCanvas(buf.width, buf.height);
      const t = src.getContext('2d'); t.drawImage(buf, 0, 0); t.globalCompositeOperation = 'destination-in'; t.drawImage(L.sel.mask, 0, 0);
    }
    ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.globalCompositeOperation = op === 'erase' ? 'destination-out' : 'source-over';
    ctx.drawImage(src, 0, 0); ctx.restore();
  };
  /* replace layer pixels with `result` inside the selection (all of it with no selection) */
  L.replaceThroughSel = function (l, result) {
    const ctx = l.canvas.getContext('2d');
    if (!L.sel) { ctx.save(); ctx.globalCompositeOperation = 'copy'; ctx.drawImage(result, 0, 0); ctx.restore(); return; }
    const t = mkCanvas(result.width, result.height), tc = t.getContext('2d');
    tc.drawImage(result, 0, 0); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(L.sel.mask, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(L.sel.mask, 0, 0); ctx.restore();
    ctx.drawImage(t, 0, 0);
  };

  /* ------------------------------------------------------------ hit testing + transforms */
  L.toLocal = function (l, x, y) {
    let dx = x - l.cx, dy = y - l.cy;
    if (l.rot) { const c = Math.cos(-l.rot), s = Math.sin(-l.rot); const nx = dx * c - dy * s, ny = dx * s + dy * c; dx = nx; dy = ny; }
    return { x: dx / l.sx + l.canvas.width / 2, y: dy / l.sy + l.canvas.height / 2 };
  };
  L.layerCorners = function (l) {
    const w = l.canvas.width * l.sx, h = l.canvas.height * l.sy, c = Math.cos(l.rot), s = Math.sin(l.rot);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(function (p) {
      return { x: l.cx + p[0] * c - p[1] * s, y: l.cy + p[0] * s + p[1] * c };
    });
  };
  const hitCtx = mkCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  L.hitTest = function (x, y) {
    const d = L.doc; if (!d) return null;
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i]; if (!l.visible) continue;
      const p = L.toLocal(l, x, y);
      if (p.x < 0 || p.y < 0 || p.x >= l.canvas.width || p.y >= l.canvas.height) continue;
      hitCtx.clearRect(0, 0, 1, 1);
      hitCtx.drawImage(l.canvas, Math.floor(p.x), Math.floor(p.y), 1, 1, 0, 0, 1, 1);
      if (hitCtx.getImageData(0, 0, 1, 1).data[3] > 12) return l;
    }
    return null;
  };

  /* ------------------------------------------------------------ canvas-level operations */
  L.resizeCanvas = function (nw, nh, ax, ay) {
    const d = L.doc; if (!d) return;
    nw = clamp(Math.round(nw), 1, L.MAX_SIDE); nh = clamp(Math.round(nh), 1, L.MAX_SIDE);
    const ox = (nw - d.w) * (ax == null ? 0.5 : ax), oy = (nh - d.h) * (ay == null ? 0.5 : ay);
    d.layers.forEach(function (l) { l.cx += ox; l.cy += oy; });
    d.w = nw; d.h = nh; L.sel = null;
    L.commit('Canvas size'); L.emit('doc'); L.emit('selection'); L.fit(); L.invalidate();
  };
  L.resizeImage = function (nw, nh) {
    const d = L.doc; if (!d) return;
    nw = clamp(Math.round(nw), 1, L.MAX_SIDE); nh = clamp(Math.round(nh), 1, L.MAX_SIDE);
    const fx = nw / d.w, fy = nh / d.h;
    d.layers.forEach(function (l) {
      l.cx *= fx; l.cy *= fy;
      if (l.kind === 'raster') {
        const c = mkCanvas(Math.max(1, Math.round(l.canvas.width * fx)), Math.max(1, Math.round(l.canvas.height * fy)));
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(l.canvas, 0, 0, c.width, c.height);
        l.canvas = c; l.frozen = false; l.rev = revCounter++;
      } else { l.sx *= fx; l.sy *= fy; }
    });
    d.w = nw; d.h = nh; L.sel = null;
    d.layers.forEach(function (l) { if (l.kind === 'text' || l.kind === 'shape') L.bakeTransform(l); });
    L.commit('Image size'); L.emit('doc'); L.emit('selection'); L.fit(); L.invalidate();
  };
  L.cropTo = function (x, y, w, h) {
    const d = L.doc; if (!d) return;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (w < 1 || h < 1) return;
    d.layers.forEach(function (l) { l.cx -= x; l.cy -= y; });
    d.w = w; d.h = h; L.sel = null;
    L.commit('Crop'); L.emit('doc'); L.emit('selection'); L.fit(); L.invalidate();
  };
  L.cropToSelection = function () {
    if (!L.sel) { L.toast('Make a selection first, then crop to it.'); return; }
    const b = L.sel.bounds; L.cropTo(b.x, b.y, b.w, b.h);
  };
  L.rotateCanvas = function (deg) {
    const d = L.doc; if (!d) return;
    const r = deg * Math.PI / 180, c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r));
    const swap = Math.abs(deg) === 90;
    const nw = swap ? d.h : d.w, nh = swap ? d.w : d.h;
    d.layers.forEach(function (l) {
      const dx = l.cx - d.w / 2, dy = l.cy - d.h / 2;
      l.cx = nw / 2 + (dx * c - dy * s); l.cy = nh / 2 + (dx * s + dy * c); l.rot += r;
    });
    d.w = nw; d.h = nh; L.sel = null;
    L.commit('Rotate canvas'); L.emit('doc'); L.emit('selection'); L.fit(); L.invalidate();
  };
  L.flipCanvas = function (axis) {
    const d = L.doc; if (!d) return;
    d.layers.forEach(function (l) {
      if (axis === 'h') { l.cx = d.w - l.cx; l.sx = -l.sx; } else { l.cy = d.h - l.cy; l.sy = -l.sy; }
      l.rot = -l.rot;
    });
    L.sel = null;
    L.commit(axis === 'h' ? 'Flip canvas horizontally' : 'Flip canvas vertically'); L.emit('selection'); L.invalidate();
  };

  /* ------------------------------------------------------------ clipboard */
  L.clip = null;
  L.copy = function (cut) {
    const l = L.active(); if (!l) return;
    const d = L.doc, full = mkCanvas(d.w, d.h), fc = full.getContext('2d');
    drawBitmap(fc, l);
    let b = { x: 0, y: 0, w: d.w, h: d.h };
    if (L.sel) { fc.globalCompositeOperation = 'destination-in'; fc.drawImage(L.sel.mask, 0, 0); b = L.sel.bounds; }
    const out = mkCanvas(b.w, b.h); out.getContext('2d').drawImage(full, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    L.clip = { canvas: out, x: b.x, y: b.y };
    try {
      out.toBlob(function (blob) { if (blob && navigator.clipboard && window.ClipboardItem) navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(function () {}); });
    } catch (e) { /* clipboard not available */ }
    if (cut) L.clearLayer(); else L.toast('Copied.');
  };
  L.paste = function () {
    if (!L.clip) { L.toast('Nothing to paste yet. Copy something first, or paste an image from another app with Ctrl+V.'); return; }
    if (!L.doc) { L.openImageAsDoc(L.clip.canvas, 'Pasted image'); return; }
    const c = L.clip, l = L.addImageLayer(c.canvas, 'Pasted', { x: c.x + c.canvas.width / 2, y: c.y + c.canvas.height / 2 });
    return l;
  };

  /* ------------------------------------------------------------ export */
  L.exportBlob = function (type, quality, scale) {
    return new Promise(function (res, rej) {
      const d = L.doc; scale = scale || 1;
      const base = L.flatCanvas(type === 'image/jpeg' ? { fill: '#ffffff' } : null);
      let out = base;
      if (scale !== 1) {
        out = mkCanvas(Math.max(1, d.w * scale), Math.max(1, d.h * scale));
        const x = out.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(base, 0, 0, out.width, out.height);
      }
      out.toBlob(function (b) { b ? res(b) : rej(new Error('export')); }, type, quality);
    });
  };

  /* ------------------------------------------------------------ projects */
  L.serialize = async function () {
    const d = L.doc;
    return {
      app: 'chumi-edit', version: 1, name: d.name, w: d.w, h: d.h, active: d.activeId, fg: L.fg, bg: L.bg,
      layers: d.layers.map(function (l) { return { meta: cloneMeta(l), png: l.canvas.toDataURL('image/png') }; })
    };
  };
  L.deserialize = async function (data) {
    if (!data || (data.app !== 'chumi-edit' && data.app !== 'lumo')) throw new Error('not a Chumi.edit project');
    const layers = await Promise.all(data.layers.map(function (e) {
      return new Promise(function (res, rej) {
        const img = new Image();
        img.onload = function () { const c = mkCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); res(Object.assign(cloneMeta(e.meta), { canvas: c, frozen: false, rev: revCounter++ })); };
        img.onerror = rej; img.src = e.png;
      });
    }));
    L.doc = { w: data.w, h: data.h, layers: layers, activeId: data.active, name: data.name || 'Untitled', dirty: false };
    layers.forEach(function (l) { const n = parseInt(String(l.id).slice(1), 10); if (n >= uid) uid = n + 1; });
    L.sel = null; L.preview = null;
    if (data.fg) L.fg = data.fg; if (data.bg) L.bg = data.bg;
    L.resetHistory('Open project');
    L.emit('doc'); L.emit('layers'); L.emit('active'); L.emit('selection'); L.emit('colors');
    L.fit(); L.invalidate();
  };
  L.loadProject = async function (text) { await L.deserialize(typeof text === 'string' ? JSON.parse(text) : text); };

  /* ---- autosave (IndexedDB, best effort) ---- */
  let saveTimer = 0;
  function idb() {
    return new Promise(function (res, rej) {
      try {
        const r = indexedDB.open('chumi-edit', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
  }
  L.queueAutosave = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async function () {
      if (!L.doc) return;
      try {
        const data = await L.serialize(); data.savedAt = Date.now();
        const t = L.flatCanvas(), th = mkCanvas(160, Math.max(1, Math.round(160 * L.doc.h / L.doc.w))); th.getContext('2d').drawImage(t, 0, 0, th.width, th.height);
        data.thumb = th.toDataURL('image/jpeg', 0.7);
        const db = await idb();
        db.transaction('kv', 'readwrite').objectStore('kv').put(data, 'last');
      } catch (e) { /* storage may be unavailable; autosave is optional */ }
    }, 2500);
  };
  L.readAutosave = async function () {
    try {
      const db = await idb();
      return await new Promise(function (res) { const q = db.transaction('kv').objectStore('kv').get('last'); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; });
    } catch (e) { return null; }
  };

  /* ---- saving files: uses the host's download capability when it exists ---- */
  L.saveBlob = async function (blob, filename) {
    try {
      if (window.claude && window.claude.use) {
        const dl = await window.claude.use('downloads');
        if (dl) { await dl.save({ filename: filename, data: blob }); return 'saved'; }
      }
    } catch (e) { if (e && e.code === 'declined') return 'declined'; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return 'saved';
  };
})();
