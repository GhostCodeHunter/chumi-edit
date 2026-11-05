/* Chumi.edit tools: pointer plumbing and every tool on the left rail. */
(function () {
  'use strict';
  const L = window.Chumi, A = L.Adjust, F = L.Filters;
  const mk = L.mkCanvas, clamp = L.clamp;

  /* ------------------------------------------------------------ options (shared with the options bar) */
  L.opts = {
    move: { auto: true, controls: true },
    marquee: { shape: 'rect', mode: 'new' },
    lasso: { mode: 'new', poly: false },
    wand: { tol: 32, contig: true, sample: 'layer', mode: 'new' },
    crop: { ratio: 'free' },
    eyedropper: { sample: 'all' },
    brush: { size: 40, hardness: 70, opacity: 100, flow: 100, smooth: 20, pressure: true },
    eraser: { size: 50, hardness: 80, opacity: 100, smooth: 10 },
    clone: { size: 60, hardness: 60, opacity: 100 },
    bucket: { tol: 32, contig: true, sample: 'layer' },
    gradient: { kind: 'linear', preset: 'fgbg', opacity: 100, reverse: false },
    text: { font: 'Bricolage Grotesque', size: 96, weight: 700, italic: false, align: 'left' },
    shape: { type: 'rect', fillOn: true, strokeOn: false, strokeW: 6, radius: 0, sides: 5 }
  };
  L.FONTS = ['Bricolage Grotesque', 'Geist', 'Playfair Display', 'Merriweather', 'Bebas Neue', 'Oswald', 'Pacifico', 'Dancing Script', 'Caveat', 'Permanent Marker', 'Lobster', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Impact'];

  L.setColor = function (which, hex) {
    if (which === 'fg') L.fg = hex; else L.bg = hex;
    L.emit('colors');
  };

  /* ------------------------------------------------------------ helpers */
  const st = { pointers: new Map(), pan: null, pinch: null, op: null };
  L.mouse = { x: 0, y: 0, sx: 0, sy: 0, inside: false };
  L.spaceDown = false;

  function evPt(e) {
    const r = L.dom.stage.getBoundingClientRect(), d = L.toDoc(e.clientX, e.clientY);
    return { x: d.x, y: d.y, sx: e.clientX - r.left, sy: e.clientY - r.top, pressure: e.pointerType === 'pen' ? (e.pressure || 0.5) : 1, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, type: e.pointerType };
  }
  function dashedRect(ctx, x, y, w, h) {
    ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#000'; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 4; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
  function docBakedCanvas(l) {
    const c = mk(L.doc.w, L.doc.h); L.drawBitmap(c.getContext('2d'), l); return c;
  }
  function hexOf(r, g, b) { return '#' + [r, g, b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); }

  /* ------------------------------------------------------------ brush engine */
  let strokeBuf = null;
  function getBuf() {
    const d = L.doc;
    if (!strokeBuf || strokeBuf.width !== d.w || strokeBuf.height !== d.h) strokeBuf = mk(d.w, d.h);
    else strokeBuf.getContext('2d').clearRect(0, 0, d.w, d.h);
    return strokeBuf;
  }
  function makeTip(size, hardness, color) {
    const r = Math.max(0.5, size / 2), d = Math.ceil(size) + 2, c = mk(d, d), ctx = c.getContext('2d');
    const cx = d / 2, cy = d / 2;
    if (hardness >= 98 || r < 1.5) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    } else {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r), h = hardness / 100;
      const rgb = L.rgba(color, 1), rgb0 = L.rgba(color, 0);
      g.addColorStop(0, rgb); g.addColorStop(Math.max(0.01, h * 0.98), rgb);
      g.addColorStop(1, rgb0);
      ctx.fillStyle = g; ctx.fillRect(0, 0, d, d);
    }
    return c;
  }
  function Stroke(kind) { this.kind = kind; }
  Stroke.prototype.begin = function (layer, o, p, isClone) {
    this.layer = layer; this.o = o; this.buf = getBuf(); this.ctx = this.buf.getContext('2d');
    this.color = kind2color(this.kind);
    this.baseSize = o.size;
    this.tip = null; this.tipSize = -1;
    this.pos = { x: p.x, y: p.y }; this.last = null; this.dist = 0;
    this.clone = isClone || null;
    L.preview = { layerId: layer.id, buf: this.buf, op: this.kind === 'eraser' ? 'erase' : 'over', alpha: o.opacity / 100 };
    this.stampAt(p.x, p.y, p.pressure);
    this.last = { x: p.x, y: p.y, pr: p.pressure };
    L.invalidate();
  };
  function kind2color(kind) { return kind === 'eraser' ? '#000000' : L.fg; }
  Stroke.prototype.stampAt = function (x, y, pr) {
    const o = this.o, size = this.baseSize * (this.kind === 'brush' && o.pressure && pr < 1 ? 0.15 + 0.85 * pr : 1);
    const sz = Math.max(1, Math.round(size));
    if (!this.tip || this.tipSize !== sz) { this.tip = makeTip(sz, o.hardness, this.color); this.tipSize = sz; }
    const t = this.tip, ctx = this.ctx;
    ctx.globalAlpha = this.kind === 'brush' ? o.flow / 100 : 1;
    if (this.clone) {
      const sx = x + this.clone.dx, sy = y + this.clone.dy;
      const tmp = this.tmp || (this.tmp = mk(t.width, t.height)), tc = tmp.getContext('2d');
      if (tmp.width !== t.width) { tmp.width = t.width; tmp.height = t.height; }
      tc.globalCompositeOperation = 'source-over'; tc.clearRect(0, 0, tmp.width, tmp.height);
      tc.drawImage(this.layer.canvas, sx - t.width / 2, sy - t.height / 2, t.width, t.height, 0, 0, t.width, t.height);
      tc.globalCompositeOperation = 'destination-in'; tc.drawImage(t, 0, 0);
      ctx.drawImage(tmp, x - t.width / 2, y - t.height / 2);
    } else {
      ctx.drawImage(t, x - t.width / 2, y - t.height / 2);
    }
    ctx.globalAlpha = 1;
  };
  Stroke.prototype.to = function (p, smooth) {
    const k = 1 - clamp(smooth, 0, 95) / 100 * 0.9;
    this.pos.x += (p.x - this.pos.x) * k; this.pos.y += (p.y - this.pos.y) * k;
    const nx = this.pos.x, ny = this.pos.y, pr = p.pressure;
    const lx = this.last.x, ly = this.last.y, dx = nx - lx, dy = ny - ly, dist = Math.hypot(dx, dy);
    const step = Math.max(1, this.baseSize * (this.o.hardness > 90 ? 0.1 : 0.14));
    if (dist < step) return;
    const n = Math.floor(dist / step);
    for (let i = 1; i <= n; i++) {
      const t = i * step / dist;
      this.stampAt(lx + dx * t, ly + dy * t, this.last.pr + (pr - this.last.pr) * t);
    }
    const t = n * step / dist;
    this.last = { x: lx + dx * t, y: ly + dy * t, pr: pr };
    L.invalidate();
  };
  Stroke.prototype.line = function (p) { this.pos = { x: this.last.x, y: this.last.y }; this.to(p, 0); };
  Stroke.prototype.end = function (label) {
    const l = this.layer;
    L.paintThroughSel(l, this.buf, this.kind === 'eraser' ? 'erase' : 'over', this.o.opacity / 100);
    L.preview = null; L.touch(l); L.commit(label);
    this.layer = null;
  };

  function brushTool(kind, label) {
    let s = null, lastEnd = null;
    return {
      down: function (p) {
        if (p.alt && kind === 'brush') { L.tools.eyedropper.pick(p, 'fg', true); return false; }
        const l = L.paintTarget(); if (!l) return false;
        const o = L.opts[kind];
        s = new Stroke(kind);
        if (p.shift && lastEnd && lastEnd.id === l.id) { s.begin(l, o, lastEnd, null); s.line(p); }
        else s.begin(l, o, p, null);
        return true;
      },
      move: function (p) { if (s) s.to(p, L.opts[kind].smooth); },
      up: function (p) { if (!s) return; const l = s.layer; lastEnd = { id: l.id, x: s.last.x, y: s.last.y, pressure: 1 }; s.end(label); s = null; },
      cancel: function () { if (s) { L.preview = null; s.layer = null; s = null; L.invalidate(); } },
      overlay: ringOverlay(kind)
    };
  }
  function ringOverlay(kind) {
    return function (ctx, z) {
      if (!L.mouse.inside) return;
      const o = L.opts[kind], r = Math.max(2, o.size / 2 * z);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.arc(L.mouse.sx, L.mouse.sy, r + 0.5, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(L.mouse.sx, L.mouse.sy, r - 0.5, 0, 6.2832); ctx.stroke();
      if (r < 6) { ctx.beginPath(); ctx.moveTo(L.mouse.sx - 4, L.mouse.sy); ctx.lineTo(L.mouse.sx + 4, L.mouse.sy); ctx.moveTo(L.mouse.sx, L.mouse.sy - 4); ctx.lineTo(L.mouse.sx, L.mouse.sy + 4); ctx.stroke(); }
    };
  }

  /* ------------------------------------------------------------ tool registry */
  const T = (L.tools = {});

  /* ---- Move + free transform ---- */
  const HANDLE_R = 9;
  function handlePoints(l) {
    const c = L.layerCorners(l);
    const mid = function (a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const top = mid(c[0], c[1]);
    const ux = c[1].x - c[0].x, uy = c[1].y - c[0].y, ul = Math.hypot(ux, uy) || 1;
    // rotate handle sits above the top edge, perpendicular to it
    const nx = (c[3].x - c[0].x), ny = (c[3].y - c[0].y), nl = Math.hypot(nx, ny) || 1;
    const off = 30 / L.view.zoom;
    const rot = { x: top.x - nx / nl * off, y: top.y - ny / nl * off };
    return [c[0], c[1], c[2], c[3], top, mid(c[1], c[2]), mid(c[2], c[3]), mid(c[3], c[0]), rot];
  }
  function inQuad(l, p) {
    const q = L.toLocal(l, p.x, p.y);
    return q.x >= 0 && q.y >= 0 && q.x <= l.canvas.width && q.y <= l.canvas.height;
  }
  let mv = null;
  T.move = {
    name: 'Move', key: 'V', icon: 'i-move', cursor: 'default',
    hint: 'Drag to move a layer. Drag a corner to resize, the round handle to rotate. Arrow keys nudge.',
    options: [
      { type: 'toggle', label: 'Pick layer on click', opt: 'move', key: 'auto' },
      { type: 'toggle', label: 'Transform handles', opt: 'move', key: 'controls' }
    ],
    down: function (p) {
      let l = L.active();
      if (!L.doc) return false;
      let handle = -1;
      if (l && L.opts.move.controls && l.visible && !l.locked) {
        const hp = handlePoints(l);
        for (let i = 8; i >= 0; i--) {
          const s = L.toScreen(hp[i].x, hp[i].y);
          if (Math.hypot(s.x - p.sx, s.y - p.sy) <= HANDLE_R) { handle = i; break; }
        }
      }
      if (handle < 0) {
        const hit = L.hitTest(p.x, p.y);
        if (L.opts.move.auto && hit) { if (!l || hit.id !== l.id) { L.setActive(hit.id); l = hit; } }
        else if (!l || !inQuad(l, p)) { if (hit) { L.setActive(hit.id); l = hit; } else return false; }
      }
      if (!l) return false;
      if (l.locked) { L.toast('This layer is locked. Unlock it in the Layers panel to move it.'); return false; }
      mv = { l: l, handle: handle, start: p, c0: { cx: l.cx, cy: l.cy, sx: l.sx, sy: l.sy, rot: l.rot }, moved: false };
      if (handle >= 0 && handle < 8) {
        const hp = handlePoints(l);
        const opp = handle < 4 ? (handle + 2) % 4 : 4 + (handle - 4 + 2) % 4;
        mv.anchor = hp[opp]; mv.h0 = hp[handle];
      }
      return true;
    },
    move: function (p) {
      if (!mv) return;
      const l = mv.l, c0 = mv.c0;
      mv.moved = true;
      if (mv.handle < 0) {
        let dx = p.x - mv.start.x, dy = p.y - mv.start.y;
        if (p.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        l.cx = c0.cx + dx; l.cy = c0.cy + dy;
      } else if (mv.handle === 8) {
        const a0 = Math.atan2(mv.start.y - c0.cy, mv.start.x - c0.cx), a1 = Math.atan2(p.y - c0.cy, p.x - c0.cx);
        let r = c0.rot + (a1 - a0);
        if (p.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
        l.rot = r;
      } else {
        const A0 = mv.anchor, H0 = mv.h0;
        const v0x = H0.x - A0.x, v0y = H0.y - A0.y, vx = p.x - A0.x, vy = p.y - A0.y;
        const corner = mv.handle < 4;
        const uniform = corner || l.kind === 'text';
        if (uniform) {
          let s = (vx * v0x + vy * v0y) / (v0x * v0x + v0y * v0y);
          if (Math.abs(s) < 0.01) return;
          l.sx = c0.sx * s; l.sy = c0.sy * s;
          l.cx = A0.x + (c0.cx - A0.x) * s; l.cy = A0.y + (c0.cy - A0.y) * s;
        } else {
          const horizontal = mv.handle === 5 || mv.handle === 7;
          const ex = horizontal ? Math.cos(c0.rot) : -Math.sin(c0.rot), ey = horizontal ? Math.sin(c0.rot) : Math.cos(c0.rot);
          const d0 = v0x * ex + v0y * ey;
          if (Math.abs(d0) < 1e-6) return;
          const s = (vx * ex + vy * ey) / d0;
          if (Math.abs(s) < 0.01) return;
          if (horizontal) l.sx = c0.sx * s; else l.sy = c0.sy * s;
          const shift = (s - 1) * ((c0.cx - A0.x) * ex + (c0.cy - A0.y) * ey);
          l.cx = c0.cx + ex * shift; l.cy = c0.cy + ey * shift;
        }
      }
      L.invalidate(); L.emit('transform');
    },
    up: function () {
      if (!mv) return;
      const l = mv.l, moved = mv.moved, h = mv.handle;
      mv = null;
      if (!moved) return;
      L.bakeTransform(l);
      L.commit(h < 0 ? 'Move layer' : h === 8 ? 'Rotate layer' : 'Resize layer');
      L.emit('active'); L.invalidate();
    },
    cancel: function () { mv = null; },
    nudge: function (dx, dy) {
      const l = L.active(); if (!l || l.locked) return;
      l.cx += dx; l.cy += dy; L.invalidate(); L.emit('transform');
      clearTimeout(T.move._nt); T.move._nt = setTimeout(function () { L.commit('Nudge layer'); }, 350);
    },
    dbl: function (p) {
      const l = L.hitTest(p.x, p.y); if (l && l.kind === 'text') { L.setActive(l.id); L.editText(l); }
    },
    overlay: function (ctx) {
      const l = L.active();
      if (!l || !l.visible || !L.opts.move.controls) return;
      const hp = handlePoints(l).map(function (q) { return L.toScreen(q.x, q.y); });
      ctx.lineWidth = 1; ctx.strokeStyle = '#ff5533';
      ctx.beginPath(); ctx.moveTo(hp[0].x, hp[0].y); [1, 2, 3].forEach(function (i) { ctx.lineTo(hp[i].x, hp[i].y); }); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hp[4].x, hp[4].y); ctx.lineTo(hp[8].x, hp[8].y); ctx.stroke();
      if (l.locked) return;
      hp.forEach(function (q, i) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff5533';
        if (i === 8) { ctx.beginPath(); ctx.arc(q.x, q.y, 5.5, 0, 6.2832); ctx.fill(); ctx.stroke(); }
        else { ctx.fillRect(q.x - 4, q.y - 4, 8, 8); ctx.strokeRect(q.x - 4.5, q.y - 4.5, 9, 9); }
      });
    }
  };

  /* ---- Marquee ---- */
  const MODES = [{ v: 'new', label: 'New' }, { v: 'add', label: 'Add' }, { v: 'sub', label: 'Subtract' }, { v: 'int', label: 'Intersect' }];
  let mq = null;
  function mqRect(a, b, p) {
    let w = b.x - a.x, h = b.y - a.y, x0 = a.x, y0 = a.y;
    if (p.shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = (w < 0 ? -1 : 1) * m; h = (h < 0 ? -1 : 1) * m; }
    if (p.alt) { x0 = a.x - w; y0 = a.y - h; w *= 2; h *= 2; }
    return { x: Math.round(Math.min(x0, x0 + w)), y: Math.round(Math.min(y0, y0 + h)), w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)) };
  }
  T.marquee = {
    name: 'Marquee', key: 'M', icon: 'i-marquee', cursor: 'crosshair',
    hint: 'Drag to select an area. Hold Shift for a square or circle, Alt to draw from the center. Click once to deselect.',
    options: [
      { type: 'segment', opt: 'marquee', key: 'shape', items: [{ v: 'rect', label: 'Rectangle', icon: 'i-marquee' }, { v: 'ellipse', label: 'Ellipse', icon: 'i-ellipse-sel' }] },
      { type: 'segment', label: 'Mode', opt: 'marquee', key: 'mode', items: MODES }
    ],
    down: function (p) { if (!L.doc) return false; mq = { a: p, b: p, p: p }; return true; },
    move: function (p) { if (mq) { mq.b = p; mq.p = p; L.invalidateOverlay(); } },
    up: function (p) {
      if (!mq) return;
      const r = mqRect(mq.a, mq.b, p), shape = L.opts.marquee.shape; mq = null;
      if (r.w < 2 && r.h < 2) { L.deselect(); return; }
      L.selectShape(function (c) {
        if (shape === 'ellipse') { c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, 6.2832); c.fill(); } else c.fillRect(r.x, r.y, r.w, r.h);
      }, L.opts.marquee.mode);
      L.invalidateOverlay();
    },
    cancel: function () { mq = null; },
    overlay: function (ctx) {
      if (!mq) return;
      const r = mqRect(mq.a, mq.b, mq.p), s0 = L.toScreen(r.x, r.y), z = L.view.zoom;
      if (L.opts.marquee.shape === 'ellipse') {
        ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        [['#000', 0], ['#fff', 4]].forEach(function (a) { ctx.strokeStyle = a[0]; ctx.lineDashOffset = a[1]; ctx.beginPath(); ctx.ellipse(s0.x + r.w * z / 2, s0.y + r.h * z / 2, Math.max(0.1, r.w * z / 2), Math.max(0.1, r.h * z / 2), 0, 0, 6.2832); ctx.stroke(); });
        ctx.setLineDash([]);
      } else dashedRect(ctx, s0.x, s0.y, r.w * z, r.h * z);
      readout(ctx, s0.x + r.w * z + 8, s0.y + r.h * z + 8, r.w + ' × ' + r.h);
    }
  };
  function readout(ctx, x, y, text) {
    ctx.font = '11px Geist, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(15,16,18,0.88)'; ctx.fillRect(x, y, w, 20);
    ctx.fillStyle = '#f0eee8'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 6, y + 10);
  }

  /* ---- Lasso ---- */
  let ls = null;
  function lassoCommit() {
    if (!ls || ls.pts.length < 3) { ls = null; L.invalidateOverlay(); return; }
    const pts = ls.pts; ls = null;
    L.selectShape(function (c) { c.beginPath(); pts.forEach(function (q, i) { if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }); c.closePath(); c.fill(); }, L.opts.lasso.mode);
    L.invalidateOverlay();
  }
  T.lasso = {
    name: 'Lasso', key: 'L', icon: 'i-lasso', cursor: 'crosshair',
    hint: 'Draw freely around what you want. In Polygon mode, click corners and double-click to finish.',
    options: [
      { type: 'segment', opt: 'lasso', key: 'poly', items: [{ v: false, label: 'Freehand' }, { v: true, label: 'Polygon' }] },
      { type: 'segment', label: 'Mode', opt: 'lasso', key: 'mode', items: MODES }
    ],
    down: function (p) {
      if (!L.doc) return false;
      if (L.opts.lasso.poly) {
        if (!ls) ls = { pts: [], poly: true };
        const f = ls.pts[0];
        if (f && ls.pts.length > 2 && Math.hypot((f.x - p.x) * L.view.zoom, (f.y - p.y) * L.view.zoom) < 9) { lassoCommit(); return false; }
        ls.pts.push({ x: p.x, y: p.y }); ls.cur = p; L.invalidateOverlay(); return false;
      }
      ls = { pts: [{ x: p.x, y: p.y }] }; return true;
    },
    move: function (p) { if (ls && !ls.poly) { const q = ls.pts[ls.pts.length - 1]; if (Math.hypot(q.x - p.x, q.y - p.y) * L.view.zoom > 2) { ls.pts.push({ x: p.x, y: p.y }); L.invalidateOverlay(); } } },
    hover: function (p) { if (ls && ls.poly) { ls.cur = p; L.invalidateOverlay(); } },
    up: function () { if (ls && !ls.poly) lassoCommit(); },
    dbl: function () { if (ls && ls.poly) lassoCommit(); },
    enter: function () { if (ls && ls.poly) lassoCommit(); },
    cancel: function () { ls = null; L.invalidateOverlay(); },
    deactivate: function () { ls = null; },
    overlay: function (ctx) {
      if (!ls || !ls.pts.length) return;
      const pts = ls.pts.map(function (q) { return L.toScreen(q.x, q.y); });
      if (ls.cur && ls.poly) pts.push(L.toScreen(ls.cur.x, ls.cur.y));
      ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      [['#000', 0], ['#fff', 4]].forEach(function (a) { ctx.strokeStyle = a[0]; ctx.lineDashOffset = a[1]; ctx.beginPath(); pts.forEach(function (q, i) { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); });
      ctx.setLineDash([]);
      if (ls.poly) { ctx.fillStyle = '#ff5533'; pts.slice(0, ls.pts.length).forEach(function (q) { ctx.fillRect(q.x - 2.5, q.y - 2.5, 5, 5); }); }
    }
  };

  /* ---- Magic wand ---- */
  T.wand = {
    name: 'Magic wand', key: 'W', icon: 'i-wand', cursor: 'crosshair',
    hint: 'Click a color to select everything similar. Raise Tolerance to catch more shades.',
    options: [
      { type: 'range', label: 'Tolerance', opt: 'wand', key: 'tol', min: 0, max: 128, step: 1 },
      { type: 'toggle', label: 'Touching only', opt: 'wand', key: 'contig' },
      { type: 'segment', label: 'Look at', opt: 'wand', key: 'sample', items: [{ v: 'layer', label: 'Layer' }, { v: 'all', label: 'Image' }] },
      { type: 'segment', label: 'Mode', opt: 'wand', key: 'mode', items: MODES }
    ],
    down: function (p) {
      const l = L.active(); if (!l) return false;
      const o = L.opts.wand;
      const src = o.sample === 'all' ? L.composite() : docBakedCanvas(l);
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= L.doc.w || y >= L.doc.h) return false;
      const img = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height);
      const mask = F.floodMask(img, x, y, o.tol, o.contig);
      L.selFromMaskData(mask, src.width, src.height, o.mode);
      return false;
    }
  };

  /* ---- Crop ---- */
  let cr = null;
  const RATIOS = [{ v: 'free', label: 'Free' }, { v: 'orig', label: 'Original' }, { v: '1:1', label: '1:1' }, { v: '4:3', label: '4:3' }, { v: '3:2', label: '3:2' }, { v: '16:9', label: '16:9' }, { v: '9:16', label: '9:16' }, { v: '4:5', label: '4:5' }];
  function ratioVal() {
    const r = L.opts.crop.ratio;
    if (r === 'free') return 0;
    if (r === 'orig') return L.doc.w / L.doc.h;
    const a = r.split(':'); return a[0] / a[1];
  }
  function cropHandles(r) {
    const z = L.view.zoom, tl = L.toScreen(r.x, r.y), w = r.w * z, h = r.h * z;
    return [
      [tl.x, tl.y, 'nw'], [tl.x + w / 2, tl.y, 'n'], [tl.x + w, tl.y, 'ne'], [tl.x + w, tl.y + h / 2, 'e'],
      [tl.x + w, tl.y + h, 'se'], [tl.x + w / 2, tl.y + h, 's'], [tl.x, tl.y + h, 'sw'], [tl.x, tl.y + h / 2, 'w']
    ];
  }
  T.crop = {
    name: 'Crop', key: 'C', icon: 'i-crop', cursor: 'crosshair',
    hint: 'Drag the edges to frame your picture, then press Enter or Apply crop. Esc starts over.',
    options: [
      { type: 'select', label: 'Shape', opt: 'crop', key: 'ratio', items: RATIOS },
      { type: 'button', label: 'Apply crop', action: 'apply', primary: true },
      { type: 'button', label: 'Reset', action: 'reset' }
    ],
    activate: function () { if (L.doc) this.reset(); },
    onOption: function () { if (!L.doc || !cr) return; const rv = ratioVal(); if (rv) this.fit(rv); L.invalidateOverlay(); },
    fit: function (rv) {
      const r = cr.rect, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let w = r.w, h = w / rv;
      if (h > L.doc.h) { h = L.doc.h; w = h * rv; }
      if (w > L.doc.w) { w = L.doc.w; h = w / rv; }
      cr.rect = { x: clamp(cx - w / 2, 0, L.doc.w - w), y: clamp(cy - h / 2, 0, L.doc.h - h), w: w, h: h };
    },
    reset: function () { if (!L.doc) return; cr = { rect: { x: 0, y: 0, w: L.doc.w, h: L.doc.h }, drag: null }; const rv = ratioVal(); if (rv) this.fit(rv); L.invalidateOverlay(); },
    apply: function () {
      if (!cr || !L.doc) return;
      const r = cr.rect;
      if (r.w >= L.doc.w - 0.5 && r.h >= L.doc.h - 0.5) { L.toast('Drag the crop box smaller first.'); return; }
      L.cropTo(r.x, r.y, r.w, r.h); this.reset();
    },
    enter: function () { this.apply(); },
    escape: function () { this.reset(); },
    down: function (p) {
      if (!L.doc) return false;
      if (!cr) this.reset();
      const hs = cropHandles(cr.rect);
      for (let i = 0; i < hs.length; i++) {
        if (Math.hypot(hs[i][0] - p.sx, hs[i][1] - p.sy) <= 10) { cr.drag = { mode: hs[i][2], start: p, r0: Object.assign({}, cr.rect) }; return true; }
      }
      const r = cr.rect, whole = r.w >= L.doc.w - 0.5 && r.h >= L.doc.h - 0.5;
      if (!whole && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { cr.drag = { mode: 'move', start: p, r0: Object.assign({}, r) }; return true; }
      cr.drag = { mode: 'new', start: p, r0: { x: p.x, y: p.y, w: 0, h: 0 } }; cr.rect = { x: clamp(p.x, 0, L.doc.w), y: clamp(p.y, 0, L.doc.h), w: 0, h: 0 };
      return true;
    },
    move: function (p) {
      if (!cr || !cr.drag) return;
      const d = cr.drag, r0 = d.r0, W = L.doc.w, H = L.doc.h, rv = ratioVal(), mode = d.mode;
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (mode === 'move') {
        cr.rect = { x: clamp(r0.x + dx, 0, W - r0.w), y: clamp(r0.y + dy, 0, H - r0.h), w: r0.w, h: r0.h };
        L.invalidateOverlay(); return;
      }
      let x0 = r0.x, x1 = r0.x + r0.w, y0 = r0.y, y1 = r0.y + r0.h;
      if (mode === 'new') { x0 = d.start.x; y0 = d.start.y; x1 = p.x; y1 = p.y; }
      else {
        if (mode.indexOf('w') >= 0) x0 += dx;
        if (mode.indexOf('e') >= 0) x1 += dx;
        if (mode.indexOf('n') >= 0) y0 += dy;
        if (mode.indexOf('s') >= 0) y1 += dy;
      }
      let ax = clamp(Math.min(x0, x1), 0, W), bx = clamp(Math.max(x0, x1), 0, W);
      let ay = clamp(Math.min(y0, y1), 0, H), by = clamp(Math.max(y0, y1), 0, H);
      if (rv) {
        const movingUp = mode === 'new' ? p.y < d.start.y : mode.indexOf('n') >= 0;
        const movingLeft = mode === 'new' ? p.x < d.start.x : mode.indexOf('w') >= 0;
        if (mode === 'n' || mode === 's') {
          const h = by - ay, w = h * rv, cx = r0.x + r0.w / 2; ax = cx - w / 2; bx = cx + w / 2;
        } else if (mode === 'e' || mode === 'w') {
          const w = bx - ax, h = w / rv, cy = r0.y + r0.h / 2; ay = cy - h / 2; by = cy + h / 2;
        } else {
          const h = (bx - ax) / rv;
          if (movingUp) ay = by - h; else by = ay + h;
        }
        // keep inside the picture, shrinking toward the fixed side
        if (ax < 0) { bx += 0 - ax; ax = 0; } if (bx > W) { ax -= bx - W; bx = W; }
        ax = Math.max(0, ax); ay = Math.max(0, ay);
        let w = bx - ax, h = by - ay;
        if (by > H || ay < 0) { h = Math.min(h, H); }
        if (w / h > rv) w = h * rv; else h = w / rv;
        if (movingLeft && mode !== 'n' && mode !== 's') ax = bx - w; else bx = ax + w;
        if (movingUp && mode !== 'e' && mode !== 'w') ay = by - h; else by = ay + h;
        if (by > H) { by = H; ay = by - h; } if (ay < 0) { ay = 0; by = h; }
      }
      cr.rect = { x: ax, y: ay, w: Math.max(0, bx - ax), h: Math.max(0, by - ay) };
      L.invalidateOverlay();
    },
    up: function () { if (cr) { cr.drag = null; if (cr.rect.w < 4 || cr.rect.h < 4) this.reset(); } },
    overlay: function (ctx, z) {
      if (!cr || !L.doc) return;
      const r = cr.rect, tl = L.toScreen(r.x, r.y), w = r.w * z, h = r.h * z, d0 = L.toScreen(0, 0), dw = L.doc.w * z, dh = L.doc.h * z;
      ctx.fillStyle = 'rgba(8,9,11,0.62)';
      ctx.beginPath(); ctx.rect(d0.x, d0.y, dw, dh); ctx.rect(tl.x, tl.y, w, h); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(tl.x, tl.y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 1; i < 3; i++) { ctx.moveTo(tl.x + w * i / 3, tl.y); ctx.lineTo(tl.x + w * i / 3, tl.y + h); ctx.moveTo(tl.x, tl.y + h * i / 3); ctx.lineTo(tl.x + w, tl.y + h * i / 3); }
      ctx.stroke();
      ctx.fillStyle = '#fff';
      cropHandles(r).forEach(function (q) { ctx.fillRect(q[0] - 4, q[1] - 4, 8, 8); });
      readout(ctx, tl.x + 8, tl.y + h + 8 > L.stageSize().h - 30 ? tl.y + h - 28 : tl.y + h + 8, Math.round(r.w) + ' × ' + Math.round(r.h));
    }
  };

  L.on('doc', function () { cr = null; if (L.tool === 'crop' && L.doc) T.crop.reset(); });

  /* ---- Eyedropper ---- */
  T.eyedropper = {
    name: 'Eyedropper', key: 'I', icon: 'i-dropper', cursor: 'crosshair',
    hint: 'Click to pick a color from the picture. Alt-click picks the background color.',
    options: [{ type: 'segment', label: 'Pick from', opt: 'eyedropper', key: 'sample', items: [{ v: 'all', label: 'Image' }, { v: 'layer', label: 'Layer' }] }],
    src: null,
    pick: function (p, which, alt) {
      const l = L.active(); if (!l) return;
      if (!this.src) this.src = L.opts.eyedropper.sample === 'layer' ? docBakedCanvas(l) : L.composite();
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= this.src.width || y >= this.src.height) return;
      const d = this.src.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
      if (d[3] < 8) return;
      L.setColor(which || (p.alt ? 'bg' : 'fg'), hexOf(d[0], d[1], d[2]));
    },
    down: function (p) { this.src = null; this.pick(p); return true; },
    move: function (p) { this.pick(p); },
    up: function () { this.src = null; },
    overlay: ringOverlay('brush') && function (ctx) {
      if (!L.mouse.inside) return;
      ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.strokeRect(L.mouse.sx + 10.5, L.mouse.sy - 24.5, 14, 14);
      ctx.fillStyle = L.fg; ctx.fillRect(L.mouse.sx + 11, L.mouse.sy - 24, 13, 13);
    }
  };
  const origPick = T.eyedropper.pick;
  T.eyedropper.pick = function (p, which, quick) {
    if (quick) { this.src = L.composite(); origPick.call(this, p, which); this.src = null; return; }
    origPick.call(this, p, which);
  };

  /* ---- Brush, Eraser, Clone ---- */
  const brushOpts = function (k, extra) {
    return [
      { type: 'range', label: 'Size', opt: k, key: 'size', min: 1, max: 500, step: 1, unit: 'px', log: true },
      { type: 'range', label: 'Hardness', opt: k, key: 'hardness', min: 0, max: 100, step: 1, unit: '%' },
      { type: 'range', label: 'Opacity', opt: k, key: 'opacity', min: 1, max: 100, step: 1, unit: '%' }
    ].concat(extra || []);
  };
  Object.assign(T, {
    brush: Object.assign(brushTool('brush', 'Brush stroke'), {
      name: 'Brush', key: 'B', icon: 'i-brush', cursor: 'crosshair',
      hint: 'Paint with the front color. Shift-click draws a straight line. [ and ] change size. Alt picks a color.',
      options: brushOpts('brush', [
        { type: 'range', label: 'Flow', opt: 'brush', key: 'flow', min: 1, max: 100, step: 1, unit: '%' },
        { type: 'range', label: 'Smoothing', opt: 'brush', key: 'smooth', min: 0, max: 90, step: 1, unit: '%' },
        { type: 'toggle', label: 'Pen pressure', opt: 'brush', key: 'pressure' }
      ])
    }),
    eraser: Object.assign(brushTool('eraser', 'Erase'), {
      name: 'Eraser', key: 'E', icon: 'i-eraser', cursor: 'crosshair',
      hint: 'Erase to transparency. A selection protects everything outside it.',
      options: brushOpts('eraser')
    })
  });
  (function () {
    let s = null, src = null, off = null;
    T.clone = {
      name: 'Clone stamp', key: 'S', icon: 'i-stamp', cursor: 'crosshair',
      hint: 'Alt-click to choose the area to copy, then paint over what you want to hide.',
      options: brushOpts('clone'),
      down: function (p) {
        if (p.alt) { src = { x: p.x, y: p.y }; off = null; L.toast('Source set. Now paint where you want the copy.'); L.invalidateOverlay(); return false; }
        if (!src) { L.toast('Alt-click first to choose the area you want to copy.'); return false; }
        const l = L.paintTarget(); if (!l) return false;
        if (!off) off = { dx: src.x - p.x, dy: src.y - p.y };
        s = new Stroke('clone'); s.begin(l, L.opts.clone, p, off);
        return true;
      },
      move: function (p) { if (s) s.to(p, 0); },
      up: function () { if (s) { s.end('Clone stamp'); s = null; } },
      cancel: function () { if (s) { L.preview = null; s = null; } },
      overlay: function (ctx, z) {
        ringOverlay('clone')(ctx, z);
        if (!src) return;
        let p = src;
        if (off && L.mouse.inside) { const m = L.toDoc(L.mouse.sx + L.dom.stage.getBoundingClientRect().left, L.mouse.sy + L.dom.stage.getBoundingClientRect().top); p = { x: m.x + off.dx, y: m.y + off.dy }; }
        const q = L.toScreen(p.x, p.y);
        ctx.strokeStyle = '#ff5533'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(q.x - 7, q.y); ctx.lineTo(q.x + 7, q.y); ctx.moveTo(q.x, q.y - 7); ctx.lineTo(q.x, q.y + 7); ctx.stroke();
      },
      deactivate: function () { }
    };
  })();

  /* ---- Paint bucket ---- */
  T.bucket = {
    name: 'Paint bucket', key: 'K', icon: 'i-bucket', cursor: 'crosshair',
    hint: 'Click to fill an area of similar color with the front color. Raise Tolerance to fill past soft edges.',
    options: [
      { type: 'range', label: 'Tolerance', opt: 'bucket', key: 'tol', min: 0, max: 128, step: 1 },
      { type: 'toggle', label: 'Touching only', opt: 'bucket', key: 'contig' },
      { type: 'segment', label: 'Look at', opt: 'bucket', key: 'sample', items: [{ v: 'layer', label: 'Layer' }, { v: 'all', label: 'Image' }] }
    ],
    down: function (p) {
      const l = L.paintTarget(); if (!l) return false;
      const o = L.opts.bucket, x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= l.canvas.width || y >= l.canvas.height) return false;
      const src = o.sample === 'all' ? L.composite() : l.canvas;
      const img = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height);
      const mask = F.floodMask(img, x, y, o.tol, o.contig);
      const buf = mk(l.canvas.width, l.canvas.height), bc = buf.getContext('2d'), out = bc.createImageData(buf.width, buf.height);
      const hex = L.fg.replace('#', ''), n = parseInt(hex.length === 3 ? hex.split('').map(function (c) { return c + c; }).join('') : hex, 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      for (let i = 0; i < mask.length; i++) if (mask[i]) { out.data[i * 4] = r; out.data[i * 4 + 1] = g; out.data[i * 4 + 2] = b; out.data[i * 4 + 3] = 255; }
      bc.putImageData(out, 0, 0);
      // grow the fill a hair so anti-aliased edges are covered
      const grown = mk(buf.width, buf.height), gc = grown.getContext('2d');
      gc.drawImage(buf, 0, 0); gc.drawImage(buf, 1, 0); gc.drawImage(buf, -1, 0); gc.drawImage(buf, 0, 1); gc.drawImage(buf, 0, -1);
      L.paintThroughSel(l, grown, 'over', 1);
      L.touch(l); L.commit('Paint bucket');
      return false;
    }
  };

  /* ---- Gradient ---- */
  const PRESETS = {
    fgbg: { name: 'Front to back', stops: function () { return [[0, L.fg], [1, L.bg]]; } },
    fgtrans: { name: 'Front to clear', stops: function () { return [[0, L.fg], [1, L.rgba(L.fg, 0)]]; } },
    bw: { name: 'Black to white', stops: function () { return [[0, '#000000'], [1, '#ffffff']]; } },
    sunset: { name: 'Sunset', stops: function () { return [[0, '#1b1e4b'], [0.4, '#a8325e'], [0.7, '#ff7a3d'], [1, '#ffd37a']]; } },
    ocean: { name: 'Ocean', stops: function () { return [[0, '#021b4a'], [0.5, '#0a6fb0'], [1, '#8ef0e6']]; } },
    rainbow: { name: 'Rainbow', stops: function () { return [[0, '#ff4d4d'], [0.2, '#ffb347'], [0.4, '#ffe94d'], [0.6, '#5be07d'], [0.8, '#4da3ff'], [1, '#b36bff']]; } }
  };
  L.GRADIENT_PRESETS = PRESETS;
  let gr = null;
  function paintGradient(ctx, w, h, a, b, kind, stops) {
    let g;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (kind === 'radial') g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(0.5, Math.hypot(dx, dy)));
    else if (kind === 'angle' && ctx.createConicGradient) g = ctx.createConicGradient(Math.atan2(dy, dx), a.x, a.y);
    else g = ctx.createLinearGradient(kind === 'reflected' ? a.x - dx : a.x, kind === 'reflected' ? a.y - dy : a.y, b.x, b.y);
    stops.forEach(function (s) {
      if (kind === 'reflected') { g.addColorStop(0.5 + s[0] / 2, s[1]); g.addColorStop(0.5 - s[0] / 2, s[1]); }
      else g.addColorStop(s[0], s[1]);
    });
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  function gradStops() {
    const o = L.opts.gradient; let s = PRESETS[o.preset].stops();
    if (o.reverse) s = s.slice().reverse().map(function (e, i, arr) { return [1 - e[0], e[1]]; });
    return s;
  }
  T.gradient = {
    name: 'Gradient', key: 'G', icon: 'i-gradient', cursor: 'crosshair',
    hint: 'Drag from where the color should start to where it should end. Hold Shift for a straight 45° line.',
    options: [
      { type: 'select', label: 'Colors', opt: 'gradient', key: 'preset', items: Object.keys(PRESETS).map(function (k) { return { v: k, label: PRESETS[k].name }; }) },
      { type: 'segment', opt: 'gradient', key: 'kind', items: [{ v: 'linear', label: 'Linear' }, { v: 'radial', label: 'Radial' }, { v: 'reflected', label: 'Mirror' }, { v: 'angle', label: 'Angle' }] },
      { type: 'toggle', label: 'Reverse', opt: 'gradient', key: 'reverse' },
      { type: 'range', label: 'Opacity', opt: 'gradient', key: 'opacity', min: 1, max: 100, step: 1, unit: '%' }
    ],
    down: function (p) {
      const l = L.paintTarget(); if (!l) return false;
      gr = { l: l, a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, buf: mk(l.canvas.width, l.canvas.height) };
      L.preview = { layerId: l.id, buf: gr.buf, op: 'over', alpha: L.opts.gradient.opacity / 100 };
      return true;
    },
    move: function (p) {
      if (!gr) return;
      let q = { x: p.x, y: p.y };
      if (p.shift) { const dx = q.x - gr.a.x, dy = q.y - gr.a.y, ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(dx, dy); q = { x: gr.a.x + Math.cos(ang) * len, y: gr.a.y + Math.sin(ang) * len }; }
      gr.b = q;
      const c = gr.buf.getContext('2d'); c.clearRect(0, 0, gr.buf.width, gr.buf.height);
      paintGradient(c, gr.buf.width, gr.buf.height, gr.a, gr.b, L.opts.gradient.kind, gradStops());
      L.invalidate();
    },
    up: function () {
      if (!gr) return;
      const g = gr; gr = null;
      if (Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) < 2) { L.preview = null; L.invalidate(); return; }
      L.paintThroughSel(g.l, g.buf, 'over', L.opts.gradient.opacity / 100);
      L.preview = null; L.touch(g.l); L.commit('Gradient');
    },
    cancel: function () { gr = null; L.preview = null; L.invalidate(); },
    overlay: function () {
      if (!gr) return;
    }
  };
  T.gradient.overlay = function (ctx) {
    if (!gr) return;
    const a = L.toScreen(gr.a.x, gr.a.y), b = L.toScreen(gr.b.x, gr.b.y);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.fillStyle = '#ff5533'; ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, 6.2832); ctx.fill(); ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, 6.2832); ctx.fill();
  };

  /* ---- Text ---- */
  let te = null;
  function textPad(Tx) { return Math.ceil(Tx.size * 0.12 + (Tx.strokeOn ? Tx.strokeW : 0) + 4); }
  function placeEditor() {
    if (!te) return;
    const l = te.l, Tx = l.text, z = L.view.zoom, ta = te.ta;
    const tl = L.toScreen(l.cx - l.canvas.width * Math.abs(l.sx) / 2, l.cy - l.canvas.height * Math.abs(l.sy) / 2);
    const pad = textPad(Tx) * z;
    ta.style.left = tl.x + 'px'; ta.style.top = tl.y + 'px';
    ta.style.width = l.canvas.width * z + 'px'; ta.style.height = l.canvas.height * z + 'px';
    ta.style.padding = pad + 'px';
    ta.style.font = (Tx.italic ? 'italic ' : '') + Tx.weight + ' ' + Tx.size * z + 'px "' + Tx.font + '", sans-serif';
    ta.style.lineHeight = Tx.size * Tx.lineHeight * z + 'px';
    ta.style.letterSpacing = Tx.spacing * z + 'px';
    ta.style.textAlign = Tx.align;
  }
  function closeEditor() {
    if (!te) return;
    const e = te; te = null;
    e.ta.removeEventListener('blur', e.onBlur);
    e.ta.remove();
    const empty = !String(e.l.text.text).trim();
    if (empty && e.isNew) {
      const i = L.doc.layers.indexOf(e.l);
      if (i >= 0) { L.doc.layers.splice(i, 1); L.doc.activeId = L.doc.layers[Math.max(0, i - 1)].id; L.emit('active'); L.emit('layers'); L.invalidate(); }
    } else if (e.changed || e.isNew) L.commit(e.isNew ? 'Add text' : 'Edit text');
  }
  L.closeTextEditor = closeEditor;
  L.editText = function (l, isNew) {
    closeEditor();
    if (!l || l.kind !== 'text') return;
    const ta = document.createElement('textarea');
    ta.className = 'text-editor'; ta.spellcheck = false; ta.value = l.text.text; ta.setAttribute('aria-label', 'Edit text');
    te = { ta: ta, l: l, isNew: !!isNew, changed: false };
    L.dom.stage.appendChild(ta); placeEditor();
    ta.addEventListener('input', function () { te.changed = true; L.updateText(l, { text: ta.value }); placeEditor(); });
    ta.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Escape') closeEditor(); });
    te.onBlur = function () { closeEditor(); };
    ta.addEventListener('blur', te.onBlur);
    ta.focus(); ta.select();
  };
  L.on('view', function () { placeEditor(); });
  L.on('composite', function () { placeEditor(); });
  T.text = {
    name: 'Text', key: 'T', icon: 'i-text', cursor: 'text',
    hint: 'Click on the picture and start typing. Click existing text to edit it. Esc finishes.',
    options: [
      { type: 'select', label: 'Font', opt: 'text', key: 'font', items: L.FONTS.map(function (f) { return { v: f, label: f }; }), wide: true },
      { type: 'number', label: 'Size', opt: 'text', key: 'size', min: 4, max: 800, step: 1, unit: 'px' },
      { type: 'toggle', label: 'Bold', opt: 'text', key: 'weight', on: 700, off: 400 },
      { type: 'toggle', label: 'Italic', opt: 'text', key: 'italic' },
      { type: 'segment', opt: 'text', key: 'align', items: [{ v: 'left', label: 'Left' }, { v: 'center', label: 'Center' }, { v: 'right', label: 'Right' }] }
    ],
    onOption: function (key, val) {
      const l = L.active();
      if (l && l.kind === 'text') { const patch = {}; patch[key] = val; L.updateText(l, patch, 'Change text ' + key); placeEditor(); }
    },
    down: function (p) {
      if (!L.doc) return false;
      const hit = L.hitTest(p.x, p.y);
      if (hit && hit.kind === 'text') { L.setActive(hit.id); L.editText(hit); return false; }
      const o = L.opts.text;
      const l = L.createTextLayer(p.x, p.y, { font: o.font, size: o.size, weight: o.weight, italic: o.italic, align: o.align, color: L.fg, text: '' });
      L.editText(l, true);
      return false;
    },
    deactivate: function () { closeEditor(); }
  };

  /* ---- Shape ---- */
  let sh = null;
  function shRect(a, b, p) {
    let w = b.x - a.x, h = b.y - a.y;
    if (p.shift && L.opts.shape.type !== 'line') { const m = Math.max(Math.abs(w), Math.abs(h)); w = (w < 0 ? -1 : 1) * m; h = (h < 0 ? -1 : 1) * m; }
    if (p.shift && L.opts.shape.type === 'line') { const ang = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(w, h); w = Math.cos(ang) * len; h = Math.sin(ang) * len; }
    return { x: a.x, y: a.y, w: w, h: h };
  }
  T.shape = {
    name: 'Shape', key: 'U', icon: 'i-shape', cursor: 'crosshair',
    hint: 'Drag to draw. Hold Shift for a perfect square or circle. Change the look in the Properties panel afterwards.',
    options: [
      { type: 'segment', opt: 'shape', key: 'type', items: [{ v: 'rect', label: 'Rectangle', icon: 'i-rect' }, { v: 'ellipse', label: 'Ellipse', icon: 'i-circle' }, { v: 'triangle', label: 'Triangle', icon: 'i-triangle' }, { v: 'star', label: 'Star', icon: 'i-star' }, { v: 'polygon', label: 'Polygon', icon: 'i-polygon' }, { v: 'line', label: 'Line', icon: 'i-line' }] },
      { type: 'toggle', label: 'Fill', opt: 'shape', key: 'fillOn' },
      { type: 'toggle', label: 'Outline', opt: 'shape', key: 'strokeOn' },
      { type: 'range', label: 'Corner radius', opt: 'shape', key: 'radius', min: 0, max: 300, step: 1, unit: 'px' }
    ],
    down: function (p) { if (!L.doc) return false; sh = { a: { x: p.x, y: p.y }, b: p, p: p }; return true; },
    move: function (p) { if (sh) { sh.b = { x: p.x, y: p.y }; sh.p = p; L.invalidateOverlay(); } },
    up: function (p) {
      if (!sh) return;
      let r = shRect(sh.a, sh.b, p); sh = null;
      const o = L.opts.shape;
      if (Math.abs(r.w) < 4 && Math.abs(r.h) < 4) r = { x: p.x - 100, y: p.y - 100, w: 200, h: o.type === 'line' ? 0 : 200 };
      if (o.type === 'line' && Math.abs(r.h) < 1) r.h = 0.01;
      L.createShapeLayer(r.x, r.y, r.w, r.h, { type: o.type, fillOn: o.fillOn, fill: L.fg, strokeOn: o.strokeOn, stroke: o.strokeOn ? L.bg : '#000000', strokeW: o.strokeW, radius: o.radius, sides: o.sides });
    },
    cancel: function () { sh = null; L.invalidateOverlay(); },
    overlay: function (ctx, z) {
      if (!sh) return;
      const r = shRect(sh.a, sh.b, sh.p), a = L.toScreen(r.x, r.y);
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#ff5533';
      if (L.opts.shape.type === 'line') { const b = L.toScreen(r.x + r.w, r.y + r.h); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      else if (L.opts.shape.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(a.x + r.w * z / 2, a.y + r.h * z / 2, Math.abs(r.w * z / 2), Math.abs(r.h * z / 2), 0, 0, 6.2832); ctx.stroke(); }
      else ctx.strokeRect(Math.min(a.x, a.x + r.w * z), Math.min(a.y, a.y + r.h * z), Math.abs(r.w * z), Math.abs(r.h * z));
      readout(ctx, Math.max(a.x, a.x + r.w * z) + 8, Math.max(a.y, a.y + r.h * z) + 8, Math.round(Math.abs(r.w)) + ' × ' + Math.round(Math.abs(r.h)));
    }
  };

  /* ---- Hand and Zoom ---- */
  T.hand = { name: 'Hand', key: 'H', icon: 'i-hand', cursor: 'grab', hint: 'Drag to move around the picture. Hold Space to use this from any tool.', options: [] };
  T.zoom = {
    name: 'Zoom', key: 'Z', icon: 'i-zoom', cursor: 'zoom-in',
    hint: 'Click to zoom in. Alt-click to zoom out. Or scroll the mouse wheel anywhere.',
    options: [
      { type: 'button', label: 'Fit', action: 'fit' }, { type: 'button', label: '100%', action: 'actual' }
    ],
    fit: function () { L.fit(); }, actual: function () { L.setZoom(1); },
    down: function (p) { L.setZoom(L.view.zoom * (p.alt || p.shift ? 1 / 1.6 : 1.6), p.sx, p.sy); return false; }
  };

  L.TOOL_ORDER = ['move', 'marquee', 'lasso', 'wand', 'crop', 'eyedropper', '-', 'brush', 'eraser', 'clone', 'bucket', 'gradient', '-', 'text', 'shape', '-', 'hand', 'zoom'];

  L.setTool = function (id) {
    if (!T[id] || L.tool === id) return;
    const prev = T[L.tool];
    if (prev && prev.cancel) prev.cancel();
    if (prev && prev.deactivate) prev.deactivate();
    L.tool = id;
    if (T[id].activate) T[id].activate();
    syncCursor(); L.emit('tool'); L.invalidateOverlay();
  };
  function syncCursor() {
    if (!L.dom.stage) return;
    L.dom.stage.style.cursor = (L.spaceDown || L.tool === 'hand') ? 'grab' : (T[L.tool].cursor || 'default');
  }
  L.syncCursor = syncCursor;

  /* ------------------------------------------------------------ pointer plumbing */
  L.initTools = function () {
    const stage = L.dom.stage;
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('pointerleave', function () { L.mouse.inside = false; L.invalidateOverlay(); L.emit('mouse'); });
    stage.addEventListener('dblclick', function (e) { const t = T[L.tool]; if (t && t.dbl && L.doc) t.dbl(evPt(e)); });
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    syncCursor();
  };
  function cancelOp() { if (st.op && st.op.cancel) st.op.cancel(); st.op = null; }
  function onDown(e) {
    if (e.target.closest && e.target.closest('.text-editor')) return;
    if (te) closeEditor();
    try { L.dom.stage.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pointers.size === 2) { cancelOp(); st.pan = null; const a = Array.from(st.pointers.values()); st.pinch = { d0: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, z0: L.view.zoom, mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2, vx: L.view.x, vy: L.view.y }; return; }
    if (!L.doc) return;
    const panNow = e.button === 1 || e.button === 2 || L.spaceDown || L.tool === 'hand';
    if (panNow) { st.pan = { x: e.clientX, y: e.clientY, vx: L.view.x, vy: L.view.y }; L.dom.stage.classList.add('panning'); e.preventDefault(); return; }
    if (e.button !== 0) return;
    const t = T[L.tool], pt = evPt(e);
    if (t && t.down && t.down(pt)) st.op = t;
    e.preventDefault();
  }
  function onMove(e) {
    const r = L.dom.stage.getBoundingClientRect();
    L.mouse.sx = e.clientX - r.left; L.mouse.sy = e.clientY - r.top; L.mouse.inside = true;
    if (L.doc) { const d = L.toDoc(e.clientX, e.clientY); L.mouse.x = d.x; L.mouse.y = d.y; }
    if (st.pointers.has(e.pointerId)) st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pinch && st.pointers.size >= 2) {
      const a = Array.from(st.pointers.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
      const mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2, p0 = st.pinch;
      const z = clamp(p0.z0 * d / p0.d0, 0.02, 64), k = z / p0.z0, sr = r;
      const ox = p0.mx - sr.left, oy = p0.my - sr.top;
      L.view.zoom = z; L.view.x = (mx - sr.left) - (ox - p0.vx) * k; L.view.y = (my - sr.top) - (oy - p0.vy) * k;
      L.autoFit = false; L.emit('view'); L.invalidate(); return;
    }
    if (st.pan) { L.view.x = st.pan.vx + e.clientX - st.pan.x; L.view.y = st.pan.vy + e.clientY - st.pan.y; L.autoFit = false; L.invalidate(); return; }
    if (st.op && e.buttons) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      (evs && evs.length ? evs : [e]).forEach(function (ev) { st.op.move(evPt(ev)); });
    } else {
      const t = T[L.tool];
      if (t && t.hover && L.doc) t.hover(evPt(e));
      if (t && t.overlay && L.doc) L.invalidateOverlay();
    }
    L.emit('mouse');
  }
  function onUp(e) {
    st.pointers.delete(e.pointerId);
    if (st.pinch) { if (st.pointers.size < 2) st.pinch = null; return; }
    if (st.pan) { st.pan = null; L.dom.stage.classList.remove('panning'); return; }
    if (st.op) { const op = st.op; st.op = null; op.up(evPt(e)); }
  }
  function onWheel(e) {
    e.preventDefault();
    if (!L.doc) return;
    const r = L.dom.stage.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const mouseLike = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || e.altKey || mouseLike) {
      const k = e.ctrlKey ? 0.01 : mouseLike ? 0.0015 : 0.006;
      L.setZoom(L.view.zoom * Math.exp(-e.deltaY * k * (e.deltaMode === 1 ? 33 : 1)), sx, sy);
    } else L.panBy(-e.deltaX, -e.deltaY);
  }

  /* arrow keys, Enter, Esc go to the active tool */
  L.toolKey = function (name, e) {
    const t = T[L.tool];
    if (name === 'enter' && t && t.enter) { t.enter(); return true; }
    if (name === 'escape' && t) { if (t.escape) { t.escape(); return true; } if (t.cancel) { t.cancel(); return true; } }
    return false;
  };
})();
