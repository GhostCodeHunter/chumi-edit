/* Chumi.edit UI panels: toolbar, options bar, side panels, status bar, welcome screen, boot. */
(function () {
  'use strict';
  const L = window.Chumi, A = L.Adjust, ui = L.ui, h = ui.h, ic = ui.ic, $ = ui.$;

  /* ------------------------------------------------------------ small helpers */
  function raf(fn) { let q = 0; return function () { if (q) return; q = requestAnimationFrame(function () { q = 0; fn(); }); }; }
  function debounce(fn, ms) { let t = 0; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function iconBtn(icon, label, onclick, extra) {
    return h('button', Object.assign({ class: 'icon-btn', type: 'button', 'aria-label': label, 'data-tip': label, onclick: onclick }, extra || {}), ic(icon, 18));
  }
  function empty(text) { return h('div', { class: 'pane-empty' }, h('p', { text: text })); }
  function section(title, body, cls) { return h('section', { class: 'psec' + (cls ? ' ' + cls : '') }, title ? h('h3', { class: 'psec-title', text: title }) : null, body); }
  ui.iconBtn = iconBtn;

  /* One slider row: label, range, live readout. live() runs while dragging, done() when released. */
  function sliderRow(o) {
    const id = 'sl' + Math.random().toString(36).slice(2, 8);
    const r = h('input', { type: 'range', id: id, min: o.min, max: o.max, step: o.step || 1, value: o.value(), 'aria-label': o.label });
    const out = h('output', { for: id, text: '' });
    const fmt = function (v) { return (o.fmt ? o.fmt(v) : v) + (o.unit || ''); };
    const paint = function () { out.textContent = fmt(+r.value); const p = (r.value - o.min) / (o.max - o.min); r.style.setProperty('--fill', (p * 100) + '%'); if (o.center) { const z = (0 - o.min) / (o.max - o.min); r.style.setProperty('--zero', (z * 100) + '%'); } };
    r.addEventListener('input', function () { paint(); o.live(+r.value); });
    r.addEventListener('change', function () { if (o.done) o.done(+r.value); });
    const lab = h('label', { for: id, text: o.label, title: o.reset !== undefined ? 'Double-click to reset' : null });
    if (o.reset !== undefined) lab.addEventListener('dblclick', function () { r.value = o.reset; paint(); o.live(o.reset); if (o.done) o.done(o.reset); });
    const row = h('div', { class: 'srow' + (o.center ? ' center' : '') }, lab, r, out);
    row.sync = function () { if (document.activeElement !== r) r.value = o.value(); paint(); };
    paint();
    return row;
  }
  function checkRow(label, get, set) {
    const c = h('input', { type: 'checkbox', checked: !!get() });
    c.addEventListener('change', function () { set(c.checked); });
    const row = h('label', { class: 'check' }, c, h('span', { text: label }));
    row.sync = function () { c.checked = !!get(); };
    return row;
  }
  function colorRow(label, get, live, done) {
    const c = h('input', { type: 'color', value: get(), 'aria-label': label });
    c.addEventListener('input', function () { live(c.value); });
    c.addEventListener('change', function () { if (done) done(c.value); });
    const row = h('label', { class: 'crow' }, h('span', { text: label }), c);
    row.sync = function () { c.value = get(); };
    return row;
  }
  function segRow(label, items, get, set) {
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const btns = items.map(function (it) {
      const b = h('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-label': it.label, 'data-tip': it.icon ? it.label : null, onclick: function () { set(it.v); } }, it.icon ? ic(it.icon, 16) : document.createTextNode(it.label));
      seg.appendChild(b); return b;
    });
    const sync = function () { items.forEach(function (it, i) { const on = get() === it.v; btns[i].classList.toggle('on', on); btns[i].setAttribute('aria-checked', String(on)); }); };
    sync();
    const row = h('div', { class: 'field inline' }, h('span', { class: 'field-label', text: label }), seg);
    row.sync = sync;
    return row;
  }
  function numberRow(label, get, min, max, set, unit) {
    const i = h('input', { type: 'number', class: 'input num', min: min, max: max, value: get(), 'aria-label': label, inputmode: 'decimal' });
    i.addEventListener('change', function () { const v = parseFloat(i.value); if (isFinite(v)) set(L.clamp(v, min, max)); else i.value = get(); });
    i.addEventListener('keydown', function (e) { if (e.key === 'Enter') i.blur(); });
    const row = h('label', { class: 'nrow' }, h('span', { text: label }), i, unit ? h('em', { text: unit }) : null);
    row.sync = function () { if (document.activeElement !== i) i.value = get(); };
    return row;
  }

  /* tab strips */
  function tabs(host, list, onChange) {
    const strip = h('div', { class: 'tabs', role: 'tablist' });
    const btns = list.map(function (t) {
      const b = h('button', { class: 'tab', type: 'button', role: 'tab', id: 'tab-' + t.id, 'aria-controls': 'pane-' + t.id, text: t.label, onclick: function () { select(t.id); } });
      strip.appendChild(b); return b;
    });
    function select(id) {
      list.forEach(function (t, i) {
        const on = t.id === id; btns[i].classList.toggle('on', on); btns[i].setAttribute('aria-selected', String(on)); btns[i].tabIndex = on ? 0 : -1;
        t.pane.hidden = !on;
      });
      if (onChange) onChange(id);
    }
    strip.addEventListener('keydown', function (e) {
      const i = btns.indexOf(document.activeElement); if (i < 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length; select(list[n].id); btns[n].focus(); }
    });
    host.appendChild(strip);
    list.forEach(function (t) { t.pane.setAttribute('role', 'tabpanel'); t.pane.id = 'pane-' + t.id; t.pane.setAttribute('aria-labelledby', 'tab-' + t.id); host.appendChild(t.pane); });
    select(list[0].id);
    return { select: select, strip: strip };
  }

  /* ------------------------------------------------------------ toolbar and colors */
  function colorPair() {
    const fgIn = h('input', { type: 'color', value: L.fg, 'aria-label': 'Front color' }), bgIn = h('input', { type: 'color', value: L.bg, 'aria-label': 'Back color' });
    fgIn.addEventListener('input', function () { L.setColor('fg', fgIn.value); });
    bgIn.addEventListener('input', function () { L.setColor('bg', bgIn.value); });
    const fg = h('span', { class: 'sw sw-fg', 'data-tip': 'Front color' }, fgIn), bg = h('span', { class: 'sw sw-bg', 'data-tip': 'Back color' }, bgIn);
    const swap = h('button', { class: 'sw-swap', type: 'button', 'aria-label': 'Swap colors', 'data-tip': 'Swap colors  X', onclick: function () { const f = L.fg; L.setColor('fg', L.bg); L.setColor('bg', f); } }, ic('i-swap', 12));
    const reset = h('button', { class: 'sw-reset', type: 'button', 'aria-label': 'Default colors', 'data-tip': 'Default colors  D', onclick: function () { L.setColor('fg', '#101114'); L.setColor('bg', '#ffffff'); } }, ic('i-reset', 12));
    const el = h('div', { class: 'cpair' }, bg, fg, swap, reset);
    const sync = function () { fgIn.value = L.fg; bgIn.value = L.bg; fg.style.background = L.fg; bg.style.background = L.bg; };
    sync(); L.on('colors', sync);
    return el;
  }

  ui.buildToolbar = function () {
    const bar = $('#toolbar'); bar.innerHTML = '';
    const tools = h('div', { class: 'tool-list', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
    L.TOOL_ORDER.forEach(function (id) {
      if (id === '-') { tools.appendChild(h('div', { class: 'tb-sep', role: 'separator' })); return; }
      const t = L.tools[id];
      tools.appendChild(h('button', { class: 'tool-btn', type: 'button', 'data-tool': id, 'aria-label': t.name, 'aria-keyshortcuts': t.key, 'data-tip': t.name + '  ' + t.key, onclick: function () { L.setTool(id); } }, ic(t.icon, 20)));
    });
    bar.appendChild(tools); bar.appendChild(colorPair());
    tools.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const b = Array.from(tools.querySelectorAll('.tool-btn')), i = b.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus();
    });
    const sync = function () { tools.querySelectorAll('.tool-btn').forEach(function (b) { const on = b.dataset.tool === L.tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); };
    L.on('tool', sync); sync();
  };

  /* ------------------------------------------------------------ options bar */
  let optSyncs = [];
  ui.buildOptions = function () {
    const bar = $('#optbar'); bar.innerHTML = ''; optSyncs = [];
    const t = L.tools[L.tool]; if (!t) return;
    bar.appendChild(h('div', { class: 'opt-title' }, ic(t.icon, 16), h('span', { text: t.name })));
    const set = function (d, v) {
      L.opts[d.opt][d.key] = v; L.emit('opts');
      if (t.onOption) t.onOption(d.key, v);
      L.invalidateOverlay();
    };
    const host = h('div', { class: 'opt-list' });
    (t.options || []).forEach(function (d) {
      const o = L.opts[d.opt], el = (function () {
        if (d.type === 'range') {
          const id = 'o-' + d.opt + '-' + d.key;
          const toPos = function (v) { return d.log ? Math.round(Math.log(Math.max(d.min, v) / d.min) / Math.log(d.max / d.min) * 1000) : v; };
          const fromPos = function (p) { return d.log ? Math.round(d.min * Math.pow(d.max / d.min, p / 1000)) : +p; };
          const r = h('input', { type: 'range', id: id, min: d.log ? 0 : d.min, max: d.log ? 1000 : d.max, step: d.log ? 1 : d.step, 'aria-label': d.label });
          const out = h('output', { for: id });
          const sync = function () { if (document.activeElement !== r) r.value = toPos(o[d.key]); out.textContent = o[d.key] + (d.unit || ''); const p = (r.value - r.min) / (r.max - r.min); r.style.setProperty('--fill', p * 100 + '%'); };
          r.addEventListener('input', function () { const v = fromPos(r.value); set(d, v); out.textContent = v + (d.unit || ''); const p = (r.value - r.min) / (r.max - r.min); r.style.setProperty('--fill', p * 100 + '%'); });
          optSyncs.push(sync); sync();
          return h('div', { class: 'opt' }, h('label', { for: id, text: d.label }), r, out);
        }
        if (d.type === 'segment') {
          const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': d.label || d.key });
          const btns = d.items.map(function (it) {
            const b = h('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-label': it.label, 'data-tip': it.icon ? it.label : null, onclick: function () { set(d, it.v); } }, it.icon ? ic(it.icon, 16) : document.createTextNode(it.label));
            seg.appendChild(b); return b;
          });
          const sync = function () { d.items.forEach(function (it, i) { const on = o[d.key] === it.v; btns[i].classList.toggle('on', on); btns[i].setAttribute('aria-checked', String(on)); }); };
          optSyncs.push(sync); sync();
          return h('div', { class: 'opt' }, d.label ? h('span', { class: 'opt-label', text: d.label }) : null, seg);
        }
        if (d.type === 'toggle') {
          const c = h('input', { type: 'checkbox' });
          const isOn = function () { return d.on !== undefined ? o[d.key] === d.on : !!o[d.key]; };
          const sync = function () { c.checked = isOn(); };
          c.addEventListener('change', function () { set(d, d.on !== undefined ? (c.checked ? d.on : d.off) : c.checked); });
          optSyncs.push(sync); sync();
          return h('label', { class: 'opt check' }, c, h('span', { text: d.label }));
        }
        if (d.type === 'select') {
          const s = h('select', { class: 'input' + (d.wide ? ' wide' : ''), 'aria-label': d.label });
          d.items.forEach(function (it) { s.appendChild(h('option', { value: String(it.v), text: it.label })); });
          const sync = function () { s.value = String(o[d.key]); };
          s.addEventListener('change', function () { const raw = s.value, it = d.items.filter(function (x) { return String(x.v) === raw; })[0]; set(d, it ? it.v : raw); });
          optSyncs.push(sync); sync();
          return h('div', { class: 'opt' }, h('span', { class: 'opt-label', text: d.label }), s);
        }
        if (d.type === 'number') {
          const i = h('input', { type: 'number', class: 'input num', min: d.min, max: d.max, step: d.step || 1, 'aria-label': d.label });
          const sync = function () { if (document.activeElement !== i) i.value = o[d.key]; };
          i.addEventListener('input', function () { const v = parseFloat(i.value); if (isFinite(v) && v >= d.min && v <= d.max) set(d, v); });
          i.addEventListener('blur', function () { i.value = o[d.key]; });
          optSyncs.push(sync); sync();
          return h('label', { class: 'opt' }, h('span', { class: 'opt-label', text: d.label }), i, d.unit ? h('em', { class: 'unit', text: d.unit }) : null);
        }
        if (d.type === 'button') {
          return h('button', { class: 'btn small' + (d.primary ? ' primary' : ''), type: 'button', text: d.label, onclick: function () { const tl = L.tools[L.tool]; if (tl[d.action]) tl[d.action](); } });
        }
        return null;
      })();
      if (el) host.appendChild(el);
    });
    if (!(t.options || []).length) host.appendChild(h('p', { class: 'opt-hint', text: t.hint }));
    bar.appendChild(host);
  };
  L.on('tool', function () { ui.buildOptions(); });
  L.on('opts', function () { optSyncs.forEach(function (f) { f(); }); });
  /* choosing a text layer shows its settings in the bar */
  L.on('active', function () {
    const l = L.active();
    if (L.tool === 'text' && l && l.kind === 'text') {
      const o = L.opts.text; ['font', 'size', 'weight', 'italic', 'align'].forEach(function (k) { o[k] = l.text[k]; }); L.emit('opts');
    }
  });

  /* ------------------------------------------------------------ top bar */
  ui.buildTop = function () {
    const act = $('#topActions'); act.innerHTML = '';
    const undo = iconBtn('i-undo', 'Undo  ' + ui.fmtKey('mod+z'), function () { L.undo(); }, { id: 'undoBtn' });
    const redo = iconBtn('i-redo', 'Redo  ' + ui.fmtKey('mod+shift+z'), function () { L.redo(); }, { id: 'redoBtn' });
    const cmdBtn = h('button', { class: 'btn ghost cmd-btn', id: 'cmdBtn', type: 'button', 'aria-label': 'Search commands', onclick: function () { ui.palette(); } }, ic('i-search', 16), h('span', { class: 'cmd-text', text: 'Search' }), h('kbd', { text: ui.fmtKey('mod+k') }));
    const open = h('button', { class: 'btn', type: 'button', onclick: function () { ui.openFileDialog(false); } }, ic('i-open', 16), h('span', { text: 'Open' }));
    const exp = h('button', { class: 'btn primary', id: 'exportBtn', type: 'button', onclick: function () { if (!L.doc) { L.toast('Open a photo first, then export it.'); return; } ui.exportDialog(); } }, ic('i-export', 16), h('span', { text: 'Export' }));
    const pb = iconBtn('i-panels', 'Panels', function () { if (window.matchMedia('(max-width: 900px)').matches) document.body.classList.toggle('panels-open'); else { document.body.classList.toggle('panels-hidden'); setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 30); } }, { id: 'panelsBtn' });
    act.appendChild(undo); act.appendChild(redo); act.appendChild(cmdBtn); act.appendChild(open); act.appendChild(exp); act.appendChild(pb);
    const name = $('#docName');
    name.addEventListener('change', function () { if (L.doc) { L.doc.name = name.value.trim() || 'Untitled'; name.value = L.doc.name; titleSync(); } });
    name.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') name.blur(); });
    const sync = function () {
      undo.disabled = !(L.history.idx > 0); redo.disabled = !(L.history.idx < L.history.stack.length - 1);
      if (document.activeElement !== name) name.value = L.doc ? L.doc.name : '';
      name.disabled = !L.doc; name.placeholder = 'No picture open';
      titleSync();
    };
    ['history', 'doc'].forEach(function (e) { L.on(e, sync); });
    sync();
  };
  function titleSync() { document.title = (L.doc ? L.doc.name + (L.doc.dirty ? ' •' : '') + ' · ' : '') + 'Chumi.edit photo editor'; }
  L.on('busy', function (b) { document.body.classList.toggle('busy', !!b); });
  L.on('doc', function () { document.body.classList.toggle('has-doc', !!L.doc); });

  /* ------------------------------------------------------------ status bar */
  ui.buildStatus = function () {
    const bar = $('#statusbar'); bar.innerHTML = '';
    const hint = h('div', { class: 'st-hint', id: 'hint' });
    const pos = h('span', { class: 'st-item st-pos', text: '' });
    const sel = h('span', { class: 'st-item st-sel', text: '' });
    const size = h('span', { class: 'st-item st-size', text: '' });
    const zoomOut = iconBtn('i-minus', 'Zoom out', function () { L.setZoom(L.view.zoom / 1.25); });
    const zoomIn = iconBtn('i-plus', 'Zoom in', function () { L.setZoom(L.view.zoom * 1.25); });
    const zv = h('button', { class: 'zoom-val', type: 'button', 'aria-label': 'Zoom level, press for actual size', 'data-tip': 'Actual size', onclick: function () { L.setZoom(1); } }, '100%');
    const fit = h('button', { class: 'btn small ghost', type: 'button', text: 'Fit', onclick: function () { L.fit(); } });
    bar.appendChild(hint); bar.appendChild(h('div', { class: 'st-right' }, sel, pos, size, h('div', { class: 'zoom' }, zoomOut, zv, zoomIn, fit)));
    const tool = function () { hint.textContent = L.tools[L.tool] ? L.tools[L.tool].hint : ''; };
    const doc = function () { size.textContent = L.doc ? L.doc.w + ' × ' + L.doc.h + ' px' : ''; zoomOut.disabled = zoomIn.disabled = fit.disabled = zv.disabled = !L.doc; };
    const view = function () { zv.textContent = Math.round(L.view.zoom * 100) + '%'; };
    const mouse = function () { pos.textContent = L.doc && L.mouse.inside ? Math.floor(L.mouse.x) + ', ' + Math.floor(L.mouse.y) + ' px' : ''; };
    const selection = function () { const b = L.sel && L.sel.bounds; sel.textContent = b ? 'Selection ' + b.w + ' × ' + b.h : ''; };
    L.on('tool', tool); L.on('doc', function () { doc(); view(); }); L.on('view', view); L.on('mouse', mouse); L.on('selection', selection);
    tool(); doc(); view();
  };

  /* ------------------------------------------------------------ right panels */
  const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];
  const PALETTE = ['#101114', '#3a3d44', '#6b6f78', '#a4a7ae', '#d9dbe0', '#ffffff', '#ff5533', '#ff8a3d', '#ffc233', '#f2e255', '#9bd34a', '#34b86b', '#1fb5a8', '#2da3e8', '#3b6fe0', '#6c52d9', '#b04fd1', '#e5499b', '#e8384f', '#7a3b24', '#c9a27a', '#f1d7b5', '#1c3d2e', '#13294b'];
  let recents = []; try { recents = JSON.parse(localStorage.getItem('chumi-recents') || '[]').filter(function (c) { return /^#[0-9a-f]{6}$/i.test(c); }).slice(0, 12); } catch (e) { recents = []; }

  /* ---- Adjust ---- */
  function buildAdjust(pane) {
    pane.innerHTML = '';
    const state = { rows: [], thumbs: [], histKey: '' };
    const noLayer = empty('Open a picture to adjust its light and color.');
    const body = h('div', { class: 'pbody' });
    pane.appendChild(noLayer); pane.appendChild(body);

    const hist = h('canvas', { class: 'hist', width: 256, height: 72, role: 'img', 'aria-label': 'Brightness histogram of the selected layer' });
    const hnote = h('p', { class: 'hist-note', text: 'Shadows on the left, highlights on the right.' });
    body.appendChild(section('Tone', h('div', {}, hist, hnote)));

    const groups = [
      ['Light', [['exposure', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100]]],
      ['Color', [['saturation', 'Saturation', -100, 100], ['temperature', 'Warmth', -100, 100], ['tint', 'Tint', -100, 100], ['hue', 'Hue shift', -180, 180]]],
      ['Effects', [['grayscale', 'Black and white', 0, 100], ['sepia', 'Sepia', 0, 100], ['invert', 'Invert', 0, 100]]]
    ];
    const redrawHist = debounce(drawHist, 90);
    groups.forEach(function (g) {
      const box = h('div', { class: 'srows' });
      g[1].forEach(function (k) {
        const row = sliderRow({
          label: k[1], min: k[2], max: k[3], reset: 0, center: k[2] < 0,
          value: function () { const l = L.active(); return l ? l.adj[k[0]] || 0 : 0; },
          live: function (v) { const l = L.active(); if (!l) return; l.adj[k[0]] = v; L.invalidate(); redrawHist(); },
          done: function () { L.commit('Adjust ' + k[1].toLowerCase()); L.emit('active'); }
        });
        state.rows.push(row); box.appendChild(row);
      });
      body.appendChild(section(g[0], box));
    });
    const btns = h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', type: 'button', text: 'Auto enhance', onclick: function () { ui.autoEnhance(); } }),
      h('button', { class: 'btn small', type: 'button', text: 'Reset', onclick: function () { const l = L.active(); if (!l || A.isNeutral(l.adj)) return; l.adj = A.defaults(); L.invalidate(); L.commit('Reset adjustments'); L.emit('active'); } }),
      h('button', { class: 'btn small', type: 'button', text: 'Apply to pixels', 'data-tip': 'Make the adjustments permanent on this layer', onclick: function () { L.bakeAdjustments(); } }));
    body.appendChild(btns);

    /* looks: thumbnails of the active layer */
    const grid = h('div', { class: 'looks' });
    A.presets.forEach(function (p) {
      const cv = h('canvas', { width: 84, height: 60 });
      const b = h('button', { class: 'look', type: 'button', 'aria-label': 'Apply look: ' + p.name, onclick: function () { ui.applyPreset(p); } }, cv, h('span', { text: p.name }));
      state.thumbs.push({ cv: cv, p: p }); grid.appendChild(b);
    });
    body.insertBefore(section('Looks', grid), body.children[1]);

    /* shadow */
    const sh = function () { const l = L.active(); return l ? l.shadow : { on: false, color: '#000000', blur: 14, x: 0, y: 8, opacity: 0.45 }; };
    const shRows = [];
    const shBody = h('div', { class: 'srows' });
    const on = checkRow('Drop shadow', function () { return sh().on; }, function (v) { const l = L.active(); if (!l) return; l.shadow.on = v; L.invalidate(); L.commit(v ? 'Add shadow' : 'Remove shadow'); L.emit('active'); });
    shRows.push(on);
    [['blur', 'Softness', 0, 80, 1, ''], ['x', 'Across', -100, 100, 1, ''], ['y', 'Down', -100, 100, 1, '']].forEach(function (k) {
      const r = sliderRow({ label: k[1], min: k[2], max: k[3], center: k[2] < 0, value: function () { return sh()[k[0]]; }, live: function (v) { const l = L.active(); if (l) { l.shadow[k[0]] = v; L.invalidate(); } }, done: function () { L.commit('Change shadow'); } });
      shRows.push(r); shBody.appendChild(r);
    });
    const op = sliderRow({ label: 'Strength', min: 0, max: 100, unit: '%', value: function () { return Math.round(sh().opacity * 100); }, live: function (v) { const l = L.active(); if (l) { l.shadow.opacity = v / 100; L.invalidate(); } }, done: function () { L.commit('Change shadow'); } });
    shRows.push(op); shBody.appendChild(op);
    const col = colorRow('Shadow color', function () { return sh().color; }, function (v) { const l = L.active(); if (l) { l.shadow.color = v; L.invalidate(); } }, function () { L.commit('Change shadow'); });
    shRows.push(col); shBody.appendChild(col);
    body.appendChild(section('Shadow', h('div', {}, on, shBody)));

    function drawHist() {
      const l = L.active(); if (!l || !l.canvas) return;
      const s = Math.min(1, 192 / Math.max(l.canvas.width, l.canvas.height)), w = Math.max(1, Math.round(l.canvas.width * s)), hh = Math.max(1, Math.round(l.canvas.height * s));
      const c = L.mkCanvas(w, hh), x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(l.canvas, 0, 0, w, hh);
      const img = x.getImageData(0, 0, w, hh); A.applyToImageData(img, l.adj); x.putImageData(img, 0, 0);
      const H = A.histogram(c, 192), ctx = hist.getContext('2d'), W = hist.width, HH = hist.height;
      ctx.clearRect(0, 0, W, HH);
      let max = 1; for (let i = 1; i < 255; i++) max = Math.max(max, H.r[i], H.g[i], H.b[i], H.l[i]);
      const plot = function (arr, color, a) {
        ctx.fillStyle = color; ctx.globalAlpha = a; ctx.beginPath(); ctx.moveTo(0, HH);
        for (let i = 0; i < 256; i++) { const v = Math.min(1, arr[i] / max); ctx.lineTo(i * W / 255, HH - v * (HH - 2)); }
        ctx.lineTo(W, HH); ctx.closePath(); ctx.fill();
      };
      ctx.globalCompositeOperation = 'source-over'; plot(H.l, '#9a9ca3', 0.35);
      ctx.globalCompositeOperation = 'screen';
      plot(H.r, '#ff4d3d', 0.7); plot(H.g, '#3ddc6a', 0.7); plot(H.b, '#3d7bff', 0.7);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    let thumbKey = '';
    function drawThumbs() {
      const l = L.active(); if (!l || !l.canvas) return;
      const k = l.id + ':' + l.rev; if (k === thumbKey) return; thumbKey = k;
      const src = L.mkCanvas(84, 60), sx = src.getContext('2d'), cw = l.canvas.width, ch = l.canvas.height, sc = Math.max(84 / cw, 60 / ch);
      sx.drawImage(l.canvas, (84 - cw * sc) / 2, (60 - ch * sc) / 2, cw * sc, ch * sc);
      state.thumbs.forEach(function (t) { A.render(src, Object.assign(A.defaults(), t.p.adj), t.cv); });
    }
    const sync = function () {
      const l = L.active();
      noLayer.hidden = !!l; body.hidden = !l; if (!l) return;
      state.rows.forEach(function (r) { r.sync(); }); shRows.forEach(function (r) { r.sync(); });
      drawHist();
    };
    L.on('active', function () { sync(); drawThumbsSoon(); });
    L.on('history', function () { sync(); });
    const drawThumbsSoon = debounce(drawThumbs, 140);
    L.on('composite', drawThumbsSoon);
    L.on('doc', function () { thumbKey = ''; sync(); drawThumbsSoon(); });
    sync();
  }

  /* ---- Color ---- */
  function buildColor(pane) {
    pane.innerHTML = '';
    const big = colorPair(); big.classList.add('big');
    const fgHex = h('input', { class: 'input hex', type: 'text', maxlength: 7, 'aria-label': 'Front color hex', spellcheck: 'false' });
    const bgHex = h('input', { class: 'input hex', type: 'text', maxlength: 7, 'aria-label': 'Back color hex', spellcheck: 'false' });
    const hexSet = function (which, el) { el.addEventListener('change', function () { let v = el.value.trim(); if (v[0] !== '#') v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) L.setColor(which, v.toLowerCase()); else if (/^#[0-9a-f]{3}$/i.test(v)) L.setColor(which, '#' + v.slice(1).split('').map(function (c) { return c + c; }).join('').toLowerCase()); else { L.toast('Use a six digit color like #ff5533.', 'error'); } sync(); }); el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.blur(); }); };
    hexSet('fg', fgHex); hexSet('bg', bgHex);
    pane.appendChild(section('Painting colors', h('div', { class: 'cols' }, big,
      h('div', { class: 'hexes' }, h('label', { class: 'nrow' }, h('span', { text: 'Front' }), fgHex), h('label', { class: 'nrow' }, h('span', { text: 'Back' }), bgHex)))));
    pane.appendChild(h('p', { class: 'pane-note', text: 'Click a swatch for the front color. Shift-click for the back color.' }));
    const pick = function (c, e) { L.setColor(e.shiftKey || e.altKey ? 'bg' : 'fg', c); };
    const pal = h('div', { class: 'palette' });
    PALETTE.forEach(function (c) { pal.appendChild(h('button', { class: 'chip', type: 'button', style: 'background:' + c, 'aria-label': c, 'data-tip': c, onclick: function (e) { pick(c, e); }, oncontextmenu: function (e) { e.preventDefault(); L.setColor('bg', c); } })); });
    pane.appendChild(section('Swatches', pal));
    const rec = h('div', { class: 'palette' });
    const recSec = section('Recent', rec);
    pane.appendChild(recSec);
    pane.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', type: 'button', text: 'Pick from the picture', onclick: function () { L.setTool('eyedropper'); } })));
    function drawRecents() {
      rec.innerHTML = ''; recSec.hidden = !recents.length;
      recents.forEach(function (c) { rec.appendChild(h('button', { class: 'chip', type: 'button', style: 'background:' + c, 'aria-label': c, 'data-tip': c, onclick: function (e) { pick(c, e); } })); });
    }
    const remember = debounce(function () {
      [L.fg, L.bg].forEach(function (c) { c = c.toLowerCase(); if (PALETTE.indexOf(c) < 0 || true) { recents = recents.filter(function (x) { return x !== c; }); recents.unshift(c); } });
      recents = recents.slice(0, 12); try { localStorage.setItem('chumi-recents', JSON.stringify(recents)); } catch (e) { /* storage unavailable */ }
      drawRecents();
    }, 900);
    function sync() { if (document.activeElement !== fgHex) fgHex.value = L.fg; if (document.activeElement !== bgHex) bgHex.value = L.bg; }
    L.on('colors', function () { sync(); remember(); });
    sync(); drawRecents();
  }

  /* ---- Properties ---- */
  function buildProps(pane) {
    pane.innerHTML = '';
    const host = h('div', { class: 'pbody' }); pane.appendChild(host);
    let key = '', syncs = [];
    const bounds = function (l) { const c = L.layerCorners(l); const xs = c.map(function (p) { return p.x; }), ys = c.map(function (p) { return p.y; }); return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), r: Math.max.apply(null, xs), b: Math.max.apply(null, ys) }; };
    const cur = function () { return L.active(); };
    const done = function (label) { L.commit(label); L.emit('active'); };
    const sync = function () { syncs.forEach(function (s) { if (s.sync) s.sync(); }); };

    function build() {
      host.innerHTML = ''; syncs = [];
      const l = cur();
      if (!l) { host.appendChild(empty('Select a layer to edit its size, position and settings.')); return; }
      const add = function (el) { syncs.push(el); return el; };
      let lockAR = true;

      /* position and size */
      const xr = add(numberRow('X', function () { const b = bounds(cur()); return Math.round(b.x * 10) / 10; }, -20000, 20000, function (v) { const q = cur(), b = bounds(q); q.cx += v - b.x; L.invalidate(); done('Move layer'); }, 'px'));
      const yr = add(numberRow('Y', function () { const b = bounds(cur()); return Math.round(b.y * 10) / 10; }, -20000, 20000, function (v) { const q = cur(), b = bounds(q); q.cy += v - b.y; L.invalidate(); done('Move layer'); }, 'px'));
      const resize = function (axis, v) {
        const q = cur(), ow = q.canvas.width * Math.abs(q.sx), oh = q.canvas.height * Math.abs(q.sy);
        let nsx = Math.abs(q.sx), nsy = Math.abs(q.sy);
        if (axis === 'w') { nsx = v / q.canvas.width; if (lockAR) nsy = nsx * (Math.abs(q.sy) / Math.abs(q.sx)); }
        else { nsy = v / q.canvas.height; if (lockAR) nsx = nsy * (Math.abs(q.sx) / Math.abs(q.sy)); }
        q.sx = (q.sx < 0 ? -1 : 1) * nsx; q.sy = (q.sy < 0 ? -1 : 1) * nsy;
        if (q.kind !== 'raster') L.bakeTransform(q);
        L.invalidate(); done('Resize layer');
      };
      const wr = add(numberRow('W', function () { const q = cur(); return Math.round(q.canvas.width * Math.abs(q.sx) * 10) / 10; }, 1, 20000, function (v) { resize('w', v); }, 'px'));
      const hr = add(numberRow('H', function () { const q = cur(); return Math.round(q.canvas.height * Math.abs(q.sy) * 10) / 10; }, 1, 20000, function (v) { resize('h', v); }, 'px'));
      const rr = add(numberRow('Angle', function () { let d = cur().rot * 180 / Math.PI; d = ((d + 180) % 360 + 360) % 360 - 180; return Math.round(d * 10) / 10; }, -360, 360, function (v) { cur().rot = v * Math.PI / 180; L.invalidate(); done('Rotate layer'); }, '°'));
      const lock = checkRow('Keep proportions', function () { return lockAR; }, function (v) { lockAR = v; });
      host.appendChild(section('Position and size', h('div', { class: 'grid2' }, xr, yr, wr, hr, rr, h('div'), lock)));

      const alignTo = function (how) {
        const q = cur(), b = bounds(q), d = L.doc;
        if (how === 'l') q.cx -= b.x; else if (how === 'r') q.cx += d.w - b.r; else if (how === 'c') q.cx += d.w / 2 - (b.x + b.r) / 2;
        else if (how === 't') q.cy -= b.y; else if (how === 'b') q.cy += d.h - b.b; else q.cy += d.h / 2 - (b.y + b.b) / 2;
        L.invalidate(); done('Align layer');
      };
      const fitTo = function (cover) {
        const q = cur(), d = L.doc, s = (cover ? Math.max : Math.min)(d.w / q.canvas.width, d.h / q.canvas.height);
        q.sx = (q.sx < 0 ? -1 : 1) * s; q.sy = (q.sy < 0 ? -1 : 1) * s; q.rot = 0; q.cx = d.w / 2; q.cy = d.h / 2;
        if (q.kind !== 'raster') L.bakeTransform(q);
        L.invalidate(); done(cover ? 'Fill canvas' : 'Fit to canvas');
      };
      const al = h('div', { class: 'icon-row' },
        iconBtn('i-al-left', 'Align left', function () { alignTo('l'); }), iconBtn('i-al-hcenter', 'Center across', function () { alignTo('c'); }), iconBtn('i-al-right', 'Align right', function () { alignTo('r'); }),
        iconBtn('i-al-top', 'Align top', function () { alignTo('t'); }), iconBtn('i-al-vcenter', 'Center down', function () { alignTo('m'); }), iconBtn('i-al-bottom', 'Align bottom', function () { alignTo('b'); }));
      const fl = h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', type: 'button', text: 'Fit canvas', onclick: function () { fitTo(false); } }),
        h('button', { class: 'btn small', type: 'button', text: 'Fill canvas', onclick: function () { fitTo(true); } }),
        iconBtn('i-flip-h', 'Flip horizontally', function () { L.flipLayer('h'); }), iconBtn('i-flip-v', 'Flip vertically', function () { L.flipLayer('v'); }), iconBtn('i-rotate', 'Rotate 90°', function () { L.rotateLayer(90); }));
      host.appendChild(section('Arrange', h('div', {}, al, fl)));

      if (l.kind === 'text') {
        const T = function () { return cur().text; };
        const upd = function (patch, label) { L.updateText(cur(), patch, label); };
        const ta = h('textarea', { class: 'input textarea', rows: 3, 'aria-label': 'Text', spellcheck: 'false' });
        ta.value = T().text;
        ta.addEventListener('input', function () { upd({ text: ta.value }); });
        ta.addEventListener('change', function () { L.commit('Edit text'); });
        ta.sync = function () { if (document.activeElement !== ta) ta.value = T().text; };
        syncs.push(ta);
        const font = h('select', { class: 'input', 'aria-label': 'Font' });
        L.FONTS.forEach(function (f) { font.appendChild(h('option', { value: f, text: f })); });
        font.value = T().font; font.addEventListener('change', function () { upd({ font: font.value }, 'Change font'); });
        font.sync = function () { font.value = T().font; }; syncs.push(font);
        const size = add(numberRow('Size', function () { return Math.round(T().size * 10) / 10; }, 4, 800, function (v) { const q = cur(); q.sx = Math.sign(q.sx) || 1; q.sy = Math.sign(q.sy) || 1; upd({ size: v }, 'Change text size'); }, 'px'));
        const style = add(segRow('Style', [{ v: 'b', label: 'Bold' }, { v: 'i', label: 'Italic' }], function () { return null; }, function (v) { if (v === 'b') upd({ weight: T().weight >= 700 ? 400 : 700 }, 'Toggle bold'); else upd({ italic: !T().italic }, 'Toggle italic'); }));
        style.sync = function () { const bs = style.querySelectorAll('.seg-btn'); bs[0].classList.toggle('on', T().weight >= 700); bs[1].classList.toggle('on', !!T().italic); };
        const align = add(segRow('Align', [{ v: 'left', label: 'Left' }, { v: 'center', label: 'Center' }, { v: 'right', label: 'Right' }], function () { return T().align; }, function (v) { upd({ align: v }, 'Align text'); }));
        const color = add(colorRow('Color', function () { return T().color; }, function (v) { upd({ color: v }); }, function () { L.commit('Text color'); }));
        const lh = add(sliderRow({ label: 'Line spacing', min: 0.8, max: 2.5, step: 0.05, value: function () { return T().lineHeight; }, live: function (v) { upd({ lineHeight: v }); }, done: function () { L.commit('Line spacing'); } }));
        const ls = add(sliderRow({ label: 'Letter spacing', min: -10, max: 40, center: true, value: function () { return T().spacing; }, live: function (v) { upd({ spacing: v }); }, done: function () { L.commit('Letter spacing'); } }));
        const so = add(checkRow('Outline', function () { return T().strokeOn; }, function (v) { upd({ strokeOn: v }, 'Text outline'); }));
        const sc = add(colorRow('Outline color', function () { return T().strokeColor; }, function (v) { upd({ strokeColor: v }); }, function () { L.commit('Outline color'); }));
        const sw = add(sliderRow({ label: 'Outline width', min: 1, max: 40, value: function () { return T().strokeW; }, live: function (v) { upd({ strokeW: v }); }, done: function () { L.commit('Outline width'); } }));
        host.appendChild(section('Text', h('div', { class: 'stack' }, ta, h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Font' }), font), size, style, align, color, lh, ls, so, sc, sw)));
      }
      if (l.kind === 'shape') {
        const S = function () { return cur().shape; };
        const upd = function (patch, label) { L.updateShape(cur(), patch, label); };
        const type = add(segRow('Shape', [{ v: 'rect', label: 'Rectangle', icon: 'i-rect' }, { v: 'ellipse', label: 'Ellipse', icon: 'i-circle' }, { v: 'triangle', label: 'Triangle', icon: 'i-triangle' }, { v: 'star', label: 'Star', icon: 'i-star' }, { v: 'polygon', label: 'Polygon', icon: 'i-polygon' }, { v: 'line', label: 'Line', icon: 'i-line' }], function () { return S().type; }, function (v) { const q = cur(); upd({ type: v }, 'Change shape'); q.name = ({ rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', star: 'Star', polygon: 'Polygon', line: 'Line' })[v]; L.emit('layers'); L.emit('active'); }));
        const fo = add(checkRow('Fill', function () { return S().fillOn; }, function (v) { upd({ fillOn: v }, 'Shape fill'); }));
        const fc = add(colorRow('Fill color', function () { return S().fill; }, function (v) { upd({ fill: v }); }, function () { L.commit('Fill color'); }));
        const so = add(checkRow('Outline', function () { return S().strokeOn; }, function (v) { upd({ strokeOn: v }, 'Shape outline'); }));
        const sc = add(colorRow(S().type === 'line' ? 'Line color' : 'Outline color', function () { return S().stroke; }, function (v) { upd({ stroke: v }); }, function () { L.commit('Outline color'); }));
        const sw = add(sliderRow({ label: S().type === 'line' ? 'Line width' : 'Outline width', min: 1, max: 80, value: function () { return S().strokeW; }, live: function (v) { upd({ strokeW: v }); }, done: function () { L.commit('Outline width'); } }));
        const rows = [type];
        if (S().type !== 'line') rows.push(fo, fc, so);
        rows.push(sc, sw);
        if (S().type === 'rect') rows.push(add(sliderRow({ label: 'Corner radius', min: 0, max: 300, value: function () { return S().radius; }, live: function (v) { upd({ radius: v }); }, done: function () { L.commit('Corner radius'); } })));
        if (S().type === 'star' || S().type === 'polygon') rows.push(add(sliderRow({ label: 'Points', min: 3, max: 16, value: function () { return S().sides; }, live: function (v) { upd({ sides: v }); }, done: function () { L.commit('Shape points'); } })));
        host.appendChild(section('Shape', h('div', { class: 'stack' }, rows)));
      }
      if (l.kind === 'raster') host.appendChild(h('p', { class: 'pane-note', text: 'Text and shape layers show their own settings here. Add some with the Text and Shape tools.' }));
    }
    const keyOf = function (l) { return l ? l.id + ':' + l.kind + ':' + (l.shape ? l.shape.type : '') : ''; };
    const refresh = function (force) {
      const k = keyOf(cur());
      if (force || k !== key) { key = k; build(); } else sync();
    };
    L.on('active', function () { refresh(); }); L.on('doc', function () { refresh(true); });
    L.on('history', function () { refresh(!host.contains(document.activeElement)); });
    L.on('transform', function () { refresh(); }); L.on('layers', function () { refresh(); });
    refresh(true);
  }

  /* ---- Layers ---- */
  function buildLayers(pane) {
    pane.innerHTML = '';
    const blend = h('select', { class: 'input', 'aria-label': 'Blend mode' });
    BLENDS.forEach(function (b) { blend.appendChild(h('option', { value: b[0], text: b[1] })); });
    blend.addEventListener('change', function () { const l = L.active(); if (l) { l.blend = blend.value; L.invalidate(); L.commit('Blend mode'); } });
    const op = sliderRow({ label: 'Opacity', min: 0, max: 100, unit: '%', value: function () { const l = L.active(); return l ? Math.round(l.opacity * 100) : 100; }, live: function (v) { const l = L.active(); if (l) { l.opacity = v / 100; L.invalidate(); } }, done: function () { L.commit('Layer opacity'); } });
    const list = h('div', { class: 'layer-list', role: 'listbox', 'aria-label': 'Layers' });
    const foot = h('div', { class: 'layer-foot' },
      iconBtn('i-layer-add', 'New layer  ' + ui.fmtKey('mod+shift+n'), function () { if (L.doc) L.addLayer(); }),
      iconBtn('i-copy', 'Duplicate layer  ' + ui.fmtKey('mod+j'), function () { if (L.doc) L.dupLayer(); }),
      iconBtn('i-merge', 'Merge down  ' + ui.fmtKey('mod+e'), function () { if (L.doc) L.mergeDown(); }),
      iconBtn('i-up', 'Move layer up', function () { if (L.doc) L.arrange('forward'); }),
      iconBtn('i-down', 'Move layer down', function () { if (L.doc) L.arrange('backward'); }),
      iconBtn('i-trash', 'Delete layer', function () { if (L.doc) L.delLayer(); }));
    pane.appendChild(h('div', { class: 'layer-props' }, h('div', { class: 'field inline' }, h('span', { class: 'field-label', text: 'Blend' }), blend), op));
    pane.appendChild(list); pane.appendChild(foot);

    const thumbs = new Map();
    function thumbFor(l) {
      let t = thumbs.get(l.id);
      if (!t || t.rev !== l.rev) {
        const c = L.mkCanvas(44, 44), x = c.getContext('2d'), s = Math.min(44 / l.canvas.width, 44 / l.canvas.height);
        x.imageSmoothingQuality = 'high'; x.drawImage(l.canvas, (44 - l.canvas.width * s) / 2, (44 - l.canvas.height * s) / 2, l.canvas.width * s, l.canvas.height * s);
        t = { rev: l.rev, c: c }; thumbs.set(l.id, t);
      }
      return t.c;
    }
    let renaming = false, dragState = null;

    function startRename(span, l) {
      renaming = true;
      const inp = h('input', { class: 'input rename', type: 'text', value: l.name, 'aria-label': 'Layer name' });
      span.replaceWith(inp); inp.focus(); inp.select();
      const finish = function (ok) {
        if (!renaming) return; renaming = false;
        const v = inp.value.trim();
        if (ok && v && v !== l.name) { l.name = v; L.commit('Rename layer'); } else render();
      };
      inp.addEventListener('blur', function () { finish(true); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } e.stopPropagation(); });
    }
    function rowFor(l) {
      const row = h('div', { class: 'layer-row' + (l.id === L.doc.activeId ? ' on' : '') + (l.visible ? '' : ' off') + (l.locked ? ' locked' : ''), role: 'option', 'aria-selected': String(l.id === L.doc.activeId), tabindex: l.id === L.doc.activeId ? '0' : '-1', 'data-id': l.id });
      const eye = h('button', { class: 'row-btn eye', type: 'button', 'aria-label': l.visible ? 'Hide ' + l.name : 'Show ' + l.name, 'aria-pressed': String(l.visible), 'data-tip': l.visible ? 'Hide' : 'Show', onclick: function (e) { e.stopPropagation(); l.visible = !l.visible; L.invalidate(); L.commit(l.visible ? 'Show layer' : 'Hide layer'); } }, ic(l.visible ? 'i-eye' : 'i-eye-off', 16));
      const th = h('span', { class: 'thumb' }, thumbFor(l));
      const nameWrap = h('span', { class: 'lname', title: 'Double-click to rename' }, l.name);
      const kind = l.kind === 'text' ? ic('i-text', 12) : l.kind === 'shape' ? ic('i-shape', 12) : null;
      const lock = h('button', { class: 'row-btn lock', type: 'button', 'aria-label': l.locked ? 'Unlock ' + l.name : 'Lock ' + l.name, 'aria-pressed': String(l.locked), 'data-tip': l.locked ? 'Unlock' : 'Lock', onclick: function (e) { e.stopPropagation(); l.locked = !l.locked; L.commit(l.locked ? 'Lock layer' : 'Unlock layer'); } }, ic(l.locked ? 'i-lock' : 'i-unlock', 14));
      row.appendChild(eye); row.appendChild(th); row.appendChild(h('span', { class: 'lmeta' }, nameWrap, kind)); row.appendChild(lock);
      row.addEventListener('dblclick', function (e) { if (e.target.closest('.row-btn')) return; startRename(nameWrap, l); });
      row.addEventListener('keydown', function (e) {
        if (renaming) return;
        const arr = L.doc.layers, i = arr.indexOf(l);
        if (e.key === 'ArrowUp' && i < arr.length - 1) { e.preventDefault(); L.setActive(arr[i + 1].id); const n = list.querySelector('[data-id="' + arr[i + 1].id + '"]'); if (n) n.focus(); }
        else if (e.key === 'ArrowDown' && i > 0) { e.preventDefault(); L.setActive(arr[i - 1].id); const n = list.querySelector('[data-id="' + arr[i - 1].id + '"]'); if (n) n.focus(); }
        else if (e.key === 'F2' || (e.key === 'Enter' && e.target === row)) { e.preventDefault(); startRename(nameWrap, l); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === row) { e.preventDefault(); e.stopPropagation(); L.delLayer(l.id); }
      });
      row.addEventListener('pointerdown', function (e) {
        if (e.target.closest('.row-btn, input') || e.button !== 0) return;
        L.setActive(l.id);
        if (e.pointerType === 'touch') return;
        dragState = { id: l.id, y: e.clientY, on: false, row: row, pid: e.pointerId, drop: null };
      });
      return row;
    }
    list.addEventListener('pointermove', function (e) {
      const d = dragState; if (!d) return;
      if (!d.on) { if (Math.abs(e.clientY - d.y) < 5) return; d.on = true; d.row.classList.add('dragging'); try { d.row.setPointerCapture(d.pid); } catch (err) { /* capture unavailable */ } }
      const rows = Array.from(list.children).filter(function (r) { return r !== d.row; });
      let p = 0; rows.forEach(function (r) { const b = r.getBoundingClientRect(); if (e.clientY > b.top + b.height / 2) p++; });
      d.drop = p;
      rows.forEach(function (r, i) { r.classList.toggle('drop-before', i === p); r.classList.toggle('drop-end', p === rows.length && i === rows.length - 1); });
    });
    function endDrag(commit) {
      const d = dragState; dragState = null; if (!d) return;
      d.row.classList.remove('dragging'); Array.from(list.children).forEach(function (r) { r.classList.remove('drop-before', 'drop-end'); });
      if (d.on && commit && d.drop != null) { const n = L.doc.layers.length; L.moveLayer(d.id, n - 1 - d.drop); }
    }
    list.addEventListener('pointerup', function () { endDrag(true); });
    list.addEventListener('pointercancel', function () { endDrag(false); });

    function render() {
      if (renaming) return;
      list.innerHTML = '';
      if (!L.doc) { list.appendChild(empty('Layers appear here once a picture is open.')); blend.disabled = true; return; }
      blend.disabled = false;
      const arr = L.doc.layers;
      for (let i = arr.length - 1; i >= 0; i--) list.appendChild(rowFor(arr[i]));
      const l = L.active(); if (l) { blend.value = l.blend; op.sync(); }
      const act = list.querySelector('.layer-row.on'); if (act && !list.matches(':hover')) act.scrollIntoView({ block: 'nearest' });
      thumbs.forEach(function (v, id) { if (!L.layerById(id)) thumbs.delete(id); });
    }
    list.addEventListener('click', function (e) { const r = e.target.closest('.layer-row'); if (r && !e.target.closest('.row-btn')) L.setActive(r.dataset.id); });
    const draw = raf(render);
    L.on('layers', draw); L.on('active', draw); L.on('doc', draw);
    render();
  }

  /* ---- History ---- */
  function buildHistory(pane) {
    pane.innerHTML = '';
    const list = h('div', { class: 'hist-list', role: 'listbox', 'aria-label': 'History' });
    pane.appendChild(list);
    pane.appendChild(h('p', { class: 'pane-note', text: 'Click a step to go back to it. Up to 70 steps are kept.' }));
    const render = raf(function () {
      list.innerHTML = '';
      const H = L.history;
      if (!H.stack.length) { list.appendChild(empty('Your edits are listed here.')); return; }
      H.stack.forEach(function (s, i) {
        list.appendChild(h('button', { class: 'hist-row' + (i === H.idx ? ' on' : '') + (i > H.idx ? ' future' : ''), type: 'button', role: 'option', 'aria-selected': String(i === H.idx), onclick: function () { L.jumpTo(i); } }, h('span', { text: s.label })));
      });
      const on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    });
    L.on('history', render); L.on('doc', render); render();
  }

  ui.buildPanels = function () {
    const host = $('#panels'); host.innerHTML = '';
    const top = h('div', { class: 'panel top' }), bottom = h('div', { class: 'panel bottom', id: 'layersPanel' });
    const pAdj = h('div', { class: 'pane' }), pCol = h('div', { class: 'pane' }), pPro = h('div', { class: 'pane' });
    const strip = h('div', { class: 'tabs-wrap', id: 'panelTabs' }); top.appendChild(strip);
    const t1 = tabs(strip, [{ id: 'adjust', label: 'Adjust', pane: pAdj }, { id: 'color', label: 'Color', pane: pCol }, { id: 'props', label: 'Properties', pane: pPro }]);
    const pLay = h('div', { class: 'pane' }), pHis = h('div', { class: 'pane' });
    tabs(bottom, [{ id: 'layers', label: 'Layers', pane: pLay }, { id: 'history', label: 'History', pane: pHis }]);
    host.appendChild(top); host.appendChild(bottom);
    /* wrap tab panes so the top panel scrolls on its own */
    const scroller = h('div', { class: 'pane-scroll' }); top.appendChild(scroller); [pAdj, pCol, pPro].forEach(function (p) { scroller.appendChild(p); });
    buildAdjust(pAdj); buildColor(pCol); buildProps(pPro); buildLayers(pLay); buildHistory(pHis);
    /* text and shape tools open the matching settings */
    L.on('tool', function () { if (L.tool === 'text' || L.tool === 'shape') t1.select('props'); });
    ui.selectTab = t1.select;
  };

  /* ------------------------------------------------------------ welcome screen */
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
    const hh = Math.round(m / 60); if (hh < 24) return hh + ' hour' + (hh === 1 ? '' : 's') + ' ago';
    const d = Math.round(hh / 24); return d + ' day' + (d === 1 ? '' : 's') + ' ago';
  }
  ui.buildWelcome = function () {
    const w = $('#welcome'); w.innerHTML = '';
    const samples = h('div', { class: 'wl-samples' });
    ui.SAMPLES.forEach(function (s) {
      samples.appendChild(h('button', { class: 'wl-sample', type: 'button', onclick: function () { ui.openSample(s.id); } }, h('img', { src: 'assets/' + s.id + '.jpg', alt: '', width: 240, height: 160, loading: 'lazy', decoding: 'async' }), h('span', { text: s.title })));
    });
    const cont = h('div', { class: 'wl-continue', hidden: true });
    w.appendChild(h('div', { class: 'wl-inner' },
      h('h1', { class: 'wl-title', text: 'What are we editing?' }),
      h('p', { class: 'wl-lead', text: 'Drop a picture anywhere on this window, or choose one. It stays on your device unless you choose to send it.' }),
      h('div', { class: 'wl-actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: function () { ui.openFileDialog(false); } }, ic('i-open', 18), h('span', { text: 'Open a photo' })),
        h('button', { class: 'btn big', type: 'button', onclick: function () { ui.newDialog(); } }, ic('i-new', 18), h('span', { text: 'New canvas' }))),
      cont,
      h('h2', { class: 'wl-sub', text: 'Or practice on a sample' }), samples,
      h('p', { class: 'wl-tour' }, h('span', { text: 'New to photo editing? ' }), h('button', { class: 'link-btn', type: 'button', text: 'Take the 30 second tour', onclick: function () { ui.startTour(); } }))));
    L.readAutosave().then(function (d) {
      if (!d || !d.layers || L.doc) return;
      cont.hidden = false;
      cont.appendChild(h('button', { class: 'wl-resume', type: 'button', onclick: async function () { try { await L.deserialize(d); } catch (e) { L.toast('The saved project could not be opened.', 'error'); } } },
        d.thumb ? h('img', { src: d.thumb, alt: '', width: 96, height: 64 }) : null,
        h('span', { class: 'wl-resume-text' }, h('strong', { text: 'Continue ' + (d.name || 'Untitled') }), h('span', { text: 'Saved ' + ago(d.savedAt || Date.now()) + ' on this device' }))));
    });
  };

  /* ------------------------------------------------------------ boot */
  ui.init = function () {
    L.attachView($('#stage'), $('#viewCanvas'), $('#overlayCanvas'));
    L.initTools();
    ui.buildMenus(); ui.buildToolbar(); ui.buildTop(); ui.buildStatus(); ui.buildPanels(); ui.buildWelcome();
    ui.initKeyboard(); ui.initDrop();
    L.emit('tool');
    $('#scrim').addEventListener('click', function () { document.body.classList.remove('panels-open'); });
    /* editor.html?sample=golden-lake opens a sample straight away (used by the home page links) */
    try {
      const q = new URLSearchParams(location.search), id = q.get('sample');
      if (id && ui.SAMPLES.some(function (s) { return s.id === id; })) ui.openSample(id);
    } catch (e) { /* ignore a malformed address */ }
    window.addEventListener('resize', debounce(function () { if (L.doc && L.autoFit) L.fit(); }, 120));
    window.chumi = L; /* handy for the console and tests */
    /* tell the loader we are ready once the brand fonts have had a chance to arrive */
    const fonts = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1500); })]) : Promise.resolve();
    fonts.then(function () { if (window.ChumiBoot) window.ChumiBoot.ready(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui.init); else ui.init();
})();
