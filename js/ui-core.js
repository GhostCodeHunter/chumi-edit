/* Chumi.edit UI core: DOM helpers, dialogs, commands, menus, command palette, keyboard, file operations. */
(function () {
  'use strict';
  const L = window.Chumi, A = L.Adjust, F = L.Filters;
  const ui = (L.ui = {});
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /* ------------------------------------------------------------ helpers */
  function h(tag, props) {
    const e = document.createElement(tag);
    props = props || {};
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }
  function ic(name, size) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ic'); s.setAttribute('width', size || 18); s.setAttribute('height', size || 18); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + name); s.appendChild(u);
    return s;
  }
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  ui.h = h; ui.ic = ic; ui.$ = $; ui.MAC = MAC;
  /* keeps the filled part of any range slider in step with its value */
  ui.fillRange = function (r) { const mn = +r.min || 0, mx = r.max === '' ? 100 : +r.max; r.style.setProperty('--fill', ((r.value - mn) / (mx - mn || 1)) * 100 + '%'); };
  document.addEventListener('input', function (e) { if (e.target && e.target.type === 'range') ui.fillRange(e.target); }, true);

  const KEYNAMES = { mod: MAC ? '⌘' : 'Ctrl', shift: MAC ? '⇧' : 'Shift', alt: MAC ? '⌥' : 'Alt', plus: '+', minus: '-', backspace: MAC ? '⌫' : 'Backspace', delete: 'Del', enter: 'Enter', escape: 'Esc' };
  ui.fmtKey = function (spec) {
    if (!spec) return '';
    return spec.split('+').map(function (p) { return KEYNAMES[p] || p.toUpperCase(); }).join(MAC ? '' : '+');
  };

  /* ------------------------------------------------------------ toast */
  L.on('toast', function (t) {
    const box = $('#toasts'); if (!box) return;
    const el = h('div', { class: 'toast ' + t.kind, role: t.kind === 'error' ? 'alert' : 'status' }, t.msg);
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 250); }, t.kind === 'error' ? 6000 : 3600);
  });

  /* ------------------------------------------------------------ dialogs */
  ui.dialog = function (o) {
    const d = h('dialog', { class: 'dlg' + (o.wide ? ' wide' : '') + (o.cls ? ' ' + o.cls : ''), 'aria-label': o.title });
    const head = h('div', { class: 'dlg-head' }, h('h2', { text: o.title }), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: function () { d.close(); } }, ic('i-x', 16)));
    const body = h('div', { class: 'dlg-body' });
    if (o.body) body.appendChild(o.body);
    d.appendChild(head); d.appendChild(body);
    if (o.actions && o.actions.length) {
      const foot = h('div', { class: 'dlg-foot' });
      o.actions.forEach(function (a) {
        const b = h('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), type: 'button', text: a.label, onclick: function () { const r = a.onClick ? a.onClick(d) : undefined; if (r !== false) d.close(); } });
        if (a.align === 'left') b.style.marginRight = 'auto';
        foot.appendChild(b); a._el = b;
      });
      d.appendChild(foot);
    }
    d.addEventListener('close', function () { d.remove(); if (o.onClose) o.onClose(); });
    d.addEventListener('mousedown', function (e) { if (e.target === d) d._down = true; });
    d.addEventListener('click', function (e) { if (e.target === d && d._down) d.close(); d._down = false; });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' && o.actions) {
        const p = o.actions.filter(function (a) { return a.primary; })[0]; if (p && p._el) { e.preventDefault(); p._el.click(); }
      }
    });
    document.body.appendChild(d);
    d.showModal();
    d.querySelectorAll('input[type=range]').forEach(ui.fillRange);
    const f = d.querySelector('input:not([type=range]):not([type=checkbox]), select') || d.querySelector('.btn.primary');
    if (f) f.focus();
    return d;
  };
  ui.confirm = function (title, msg, label, danger) {
    return new Promise(function (res) {
      let done = false;
      ui.dialog({ title: title, body: h('p', { class: 'dlg-text', text: msg }), actions: [{ label: 'Cancel', onClick: function () { } }, { label: label || 'Continue', primary: !danger, danger: !!danger, onClick: function () { done = true; } }], onClose: function () { res(done); } });
    });
  };

  /* small form builders used by dialogs */
  function field(label, input, note) { return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input, note ? h('span', { class: 'field-note', text: note }) : null); }
  function numInput(v, min, max, id) { return h('input', { type: 'number', class: 'input', value: v, min: min, max: max, id: id, inputmode: 'numeric' }); }
  ui.field = field; ui.numInput = numInput;

  /* ------------------------------------------------------------ commands */
  const CMDS = (ui.commands = []);
  function cmd(menu, label, keys, fn, o) { const c = Object.assign({ menu: menu, label: label, keys: keys, fn: fn, doc: true }, o || {}); CMDS.push(c); return c; }
  function sep(menu) { CMDS.push({ menu: menu, sep: true }); }
  ui.cmd = cmd;

  const SAMPLES = [
    { id: 'golden-lake', title: 'Golden lake' }, { id: 'neon-city', title: 'Neon city' }, { id: 'desert-walk', title: 'Desert walk' },
    { id: 'pine-fog', title: 'Pine fog' }, { id: 'sunrise-coast', title: 'Sunrise coast' }
  ];
  ui.SAMPLES = SAMPLES;
  ui.openSample = function (id, asLayer) {
    L.toast('Developing the sample…');
    setTimeout(function () {
      const c = window.Samples.render(id, 1600, 1067), meta = SAMPLES.filter(function (s) { return s.id === id; })[0];
      if (asLayer && L.doc) L.addImageLayer(c, meta.title); else L.openImageAsDoc(c, meta.title);
    }, 30);
  };

  function pickFiles(accept, multiple, cb) {
    const inp = h('input', { type: 'file', accept: accept, multiple: !!multiple, style: 'position:fixed;left:-9999px' });
    inp.addEventListener('change', function () { if (inp.files && inp.files.length) cb(inp.files); inp.remove(); });
    document.body.appendChild(inp); inp.click();
  }
  ui.openFileDialog = function (asLayer) {
    pickFiles('image/*,.json,.chumi', true, function (files) { L.openFiles(files, asLayer); });
  };

  /* File */
  cmd('File', 'New…', 'mod+alt+n', function () { ui.newDialog(); }, { doc: false });
  cmd('File', 'Open photo…', 'mod+o', function () { ui.openFileDialog(false); }, { doc: false });
  cmd('File', 'Place photo as layer…', 'mod+shift+o', function () { ui.openFileDialog(true); });
  cmd('File', 'Open sample photo', null, null, { doc: false, children: SAMPLES.map(function (s) { return { label: s.title, fn: function () { ui.openSample(s.id); } }; }) });
  sep('File');
  cmd('File', 'Save project', 'mod+s', function () { ui.saveProject(); });
  cmd('File', 'Export image…', 'mod+shift+e', function () { ui.exportDialog(); });
  /* Edit */
  cmd('Edit', 'Undo', 'mod+z', function () { L.undo(); }, { dyn: function () { return L.history.idx > 0; } });
  cmd('Edit', 'Redo', 'mod+shift+z', function () { L.redo(); }, { alt: 'mod+y', dyn: function () { return L.history.idx < L.history.stack.length - 1; } });
  sep('Edit');
  cmd('Edit', 'Cut', 'mod+x', function () { L.copy(true); });
  cmd('Edit', 'Copy', 'mod+c', function () { L.copy(false); });
  cmd('Edit', 'Paste', 'mod+v', function () { ui.pasteFromMenu(); }, { doc: false, noKey: true });
  cmd('Edit', 'Clear', 'delete', function () { L.clearLayer(); }, { alt: 'backspace' });
  cmd('Edit', 'Fill with front color', 'alt+backspace', function () { L.fillLayer(L.fg); });
  cmd('Edit', 'Fill with back color', 'mod+backspace', function () { L.fillLayer(L.bg); });
  sep('Edit');
  cmd('Edit', 'Select all', 'mod+a', function () { L.selectAll(); });
  cmd('Edit', 'Deselect', 'mod+d', function () { L.deselect(); });
  cmd('Edit', 'Invert selection', 'mod+shift+i', function () { L.invertSel(); });
  cmd('Edit', 'Soften selection edge…', null, function () { ui.numberPrompt('Soften selection', 'Radius', 8, 1, 200, 'px', function (v) { L.featherSel(v); }); }, { dyn: function () { return !!L.sel; } });
  cmd('Edit', 'Grow selection…', null, function () { ui.numberPrompt('Grow selection', 'Amount', 4, 1, 200, 'px', function (v) { L.growSel(v); }); }, { dyn: function () { return !!L.sel; } });
  cmd('Edit', 'Shrink selection…', null, function () { ui.numberPrompt('Shrink selection', 'Amount', 4, 1, 200, 'px', function (v) { L.growSel(-v); }); }, { dyn: function () { return !!L.sel; } });
  /* Image */
  cmd('Image', 'Auto enhance', null, function () { ui.autoEnhance(); });
  sep('Image');
  cmd('Image', 'Canvas size…', 'mod+alt+c', function () { ui.canvasSizeDialog(); });
  cmd('Image', 'Image size…', 'mod+alt+i', function () { ui.imageSizeDialog(); });
  cmd('Image', 'Crop to selection', null, function () { L.cropToSelection(); }, { dyn: function () { return !!L.sel; } });
  sep('Image');
  cmd('Image', 'Rotate 90° clockwise', null, function () { L.rotateCanvas(90); });
  cmd('Image', 'Rotate 90° counter-clockwise', null, function () { L.rotateCanvas(-90); });
  cmd('Image', 'Rotate 180°', null, function () { L.rotateCanvas(180); });
  cmd('Image', 'Flip canvas horizontally', null, function () { L.flipCanvas('h'); });
  cmd('Image', 'Flip canvas vertically', null, function () { L.flipCanvas('v'); });
  /* Layer */
  cmd('Layer', 'New layer', 'mod+shift+n', function () { L.addLayer(); });
  cmd('Layer', 'Duplicate layer', 'mod+j', function () { L.dupLayer(); });
  cmd('Layer', 'Delete layer', null, function () { L.delLayer(); });
  sep('Layer');
  cmd('Layer', 'Merge down', 'mod+e', function () { L.mergeDown(); });
  cmd('Layer', 'Flatten image', null, function () { L.flatten(); });
  cmd('Layer', 'Convert to pixels', null, function () { L.rasterize(); });
  cmd('Layer', 'Apply adjustments to pixels', null, function () { L.bakeAdjustments(); });
  sep('Layer');
  cmd('Layer', 'Bring to front', 'mod+shift+]', function () { L.arrange('front'); });
  cmd('Layer', 'Bring forward', 'mod+]', function () { L.arrange('forward'); });
  cmd('Layer', 'Send backward', 'mod+[', function () { L.arrange('backward'); });
  cmd('Layer', 'Send to back', 'mod+shift+[', function () { L.arrange('back'); });
  sep('Layer');
  cmd('Layer', 'Flip layer horizontally', null, function () { L.flipLayer('h'); });
  cmd('Layer', 'Flip layer vertically', null, function () { L.flipLayer('v'); });
  cmd('Layer', 'Rotate layer 90°', null, function () { L.rotateLayer(90); });
  /* Filter */
  let lastGroup = '';
  F.list.forEach(function (f) {
    if (f.group !== lastGroup) { if (lastGroup) sep('Filter'); lastGroup = f.group; }
    cmd('Filter', f.label + (f.params.length ? '…' : ''), null, function () { ui.filterDialog(f); }, { group: f.group });
  });
  /* View */
  cmd('View', 'Zoom in', 'mod+plus', function () { L.setZoom(L.view.zoom * 1.25); });
  cmd('View', 'Zoom out', 'mod+minus', function () { L.setZoom(L.view.zoom / 1.25); });
  cmd('View', 'Fit on screen', 'mod+0', function () { L.fit(); });
  cmd('View', 'Actual pixels (100%)', 'mod+1', function () { L.setZoom(1); });
  sep('View');
  cmd('View', 'Show grid', "mod+'", function () { L.showGrid = !L.showGrid; L.invalidateOverlay(); }, { check: function () { return L.showGrid; }, doc: false });
  cmd('View', 'Compact panels', null, function () { document.body.classList.toggle('panels-hidden'); setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 30); }, { check: function () { return document.body.classList.contains('panels-hidden'); }, doc: false });
  /* Help */
  cmd('Help', 'Quick tour', null, function () { ui.startTour(); }, { doc: false });
  cmd('Help', 'Keyboard shortcuts', '?', function () { ui.shortcutsDialog(); }, { doc: false, noKey: true });
  cmd('Help', 'Search commands…', 'mod+k', function () { ui.palette(); }, { doc: false });
  cmd('Help', 'About Chumi.edit', null, function () { ui.aboutDialog(); }, { doc: false });

  function runCmd(c) {
    if (c.doc && !L.doc) { L.toast('Open a photo or create a canvas first.'); return; }
    if (c.fn) c.fn();
  }
  ui.runCmd = runCmd;

  /* ------------------------------------------------------------ menu bar */
  const MENUS = ['File', 'Edit', 'Image', 'Layer', 'Filter', 'View', 'Help'];
  let openName = null, closeOutside = null;
  function closeMenus() {
    document.querySelectorAll('.menu-pop').forEach(function (m) { m.remove(); });
    document.querySelectorAll('.menu-btn[aria-expanded=true]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    openName = null;
    if (closeOutside) { document.removeEventListener('pointerdown', closeOutside, true); closeOutside = null; }
  }
  function itemEl(c, isSub) {
    const disabled = (c.doc && !L.doc) || (c.dyn && !c.dyn());
    const checked = c.check && c.check();
    const b = h('button', { class: 'menu-item', role: c.check ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': c.check ? String(!!checked) : null, disabled: disabled, type: 'button', tabindex: '-1' },
      h('span', { class: 'mi-check' }, checked ? ic('i-check', 14) : null),
      h('span', { class: 'mi-label', text: c.label }),
      c.children ? h('span', { class: 'mi-sub' }, ic('i-chev-right', 14)) : h('kbd', { text: ui.fmtKey(c.keys) }));
    if (c.children) {
      let sub = null;
      const open = function () {
        if (sub) return;
        sub = h('div', { class: 'menu-pop sub', role: 'menu' });
        c.children.forEach(function (ch) { sub.appendChild(h('button', { class: 'menu-item', role: 'menuitem', type: 'button', tabindex: '-1', onclick: function () { closeMenus(); ch.fn(); } }, h('span', { class: 'mi-check' }), h('span', { class: 'mi-label', text: ch.label }))); });
        const r = b.getBoundingClientRect(); sub.style.left = r.right - 4 + 'px'; sub.style.top = r.top - 5 + 'px';
        document.body.appendChild(sub);
      };
      b.addEventListener('mouseenter', open); b.addEventListener('click', open);
      b.addEventListener('mouseleave', function (e) { setTimeout(function () { if (sub && !sub.matches(':hover') && !b.matches(':hover')) { sub.remove(); sub = null; } }, 160); });
    } else b.addEventListener('click', function () { closeMenus(); runCmd(c); });
    return b;
  }
  function openMenu(name, btn) {
    closeMenus();
    openName = name; btn.setAttribute('aria-expanded', 'true');
    const pop = h('div', { class: 'menu-pop', role: 'menu', 'aria-label': name });
    CMDS.filter(function (c) { return c.menu === name; }).forEach(function (c) { pop.appendChild(c.sep ? h('div', { class: 'menu-sep', role: 'separator' }) : itemEl(c)); });
    const r = btn.getBoundingClientRect(); pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 4 + 'px';
    document.body.appendChild(pop);
    const items = Array.from(pop.querySelectorAll('.menu-item:not(:disabled)'));
    if (items[0]) items[0].focus();
    pop.addEventListener('keydown', function (e) {
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[(i + 1) % items.length] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[(i - 1 + items.length) % items.length] || items[0]).focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenus(); btn.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); const k = MENUS.indexOf(name) + (e.key === 'ArrowRight' ? 1 : -1), n = MENUS[(k + MENUS.length) % MENUS.length];
        const nb = document.querySelector('.menu-btn[data-menu="' + n + '"]'); openMenu(n, nb);
      }
    });
    closeOutside = function (e) { if (!e.target.closest('.menu-pop') && !e.target.closest('.menu-btn')) closeMenus(); };
    document.addEventListener('pointerdown', closeOutside, true);
  }
  ui.buildMenus = function () {
    const bar = $('#menubar'); bar.innerHTML = '';
    MENUS.forEach(function (name) {
      const b = h('button', { class: 'menu-btn', 'data-menu': name, 'aria-haspopup': 'menu', 'aria-expanded': 'false', type: 'button', text: name,
        onclick: function () { if (openName === name) closeMenus(); else openMenu(name, b); },
        onmouseenter: function () { if (openName && openName !== name) openMenu(name, b); } });
      bar.appendChild(b);
    });
  };

  /* ------------------------------------------------------------ command palette */
  ui.palette = function () {
    const all = [];
    CMDS.forEach(function (c) {
      if (c.sep) return;
      if (c.children) c.children.forEach(function (ch) { all.push({ label: 'Open sample: ' + ch.label, menu: 'File', keys: null, fn: ch.fn, doc: false }); });
      else all.push(c);
    });
    L.TOOL_ORDER.forEach(function (id) { if (id === '-') return; const t = L.tools[id]; all.push({ label: 'Tool: ' + t.name, menu: 'Tools', keys: t.key.toLowerCase(), fn: function () { L.setTool(id); }, doc: false }); });
    A.presets.forEach(function (p) { all.push({ label: 'Look: ' + p.name, menu: 'Adjust', keys: null, fn: function () { ui.applyPreset(p); } }); });
    const input = h('input', { class: 'palette-input', type: 'text', placeholder: 'Search commands, tools and filters', 'aria-label': 'Search commands', autocomplete: 'off', spellcheck: 'false' });
    const list = h('div', { class: 'palette-list', role: 'listbox' });
    let sel = 0, shown = [];
    function render() {
      const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      shown = all.filter(function (c) { const t = (c.menu + ' ' + c.label).toLowerCase(); return q.every(function (w) { return t.indexOf(w) >= 0; }); }).slice(0, 40);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      if (!shown.length) list.appendChild(h('div', { class: 'palette-empty', text: 'No command matches “' + input.value + '”.' }));
      shown.forEach(function (c, i) {
        const dis = c.doc && !L.doc;
        list.appendChild(h('button', { class: 'palette-item' + (i === sel ? ' sel' : ''), role: 'option', type: 'button', 'aria-selected': String(i === sel), 'aria-disabled': dis ? 'true' : null, tabindex: '-1',
          onclick: function () { dlg.close(); runCmd(c); } },
          h('span', { class: 'pi-menu', text: c.menu }), h('span', { class: 'pi-label', text: c.label }), h('kbd', { text: ui.fmtKey(c.keys) })));
      });
      const s = list.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    const dlg = ui.dialog({ title: 'Search commands', cls: 'palette', body: h('div', {}, input, list) });
    dlg.querySelector('.dlg-head').style.display = 'none';
    input.addEventListener('input', function () { sel = 0; render(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); const c = shown[sel]; if (c) { dlg.close(); runCmd(c); } }
    });
    render(); input.focus();
  };

  /* ------------------------------------------------------------ keyboard */
  const CODES = { '[': 'BracketLeft', ']': 'BracketRight', plus: 'Equal', minus: 'Minus', '0': 'Digit0', '1': 'Digit1', "'": 'Quote' };
  function parseSpec(s) { const p = s.toLowerCase().split('+'); const key = p.pop() || '+'; return { mod: p.indexOf('mod') >= 0, shift: p.indexOf('shift') >= 0, alt: p.indexOf('alt') >= 0, key: key }; }
  function match(e, spec) {
    const sp = parseSpec(spec), mod = e.ctrlKey || e.metaKey;
    if (sp.mod !== mod || sp.shift !== e.shiftKey || sp.alt !== e.altKey) return false;
    if (CODES[sp.key]) return e.code === CODES[sp.key] || (sp.key === 'plus' && e.code === 'NumpadAdd') || (sp.key === 'minus' && e.code === 'NumpadSubtract');
    return e.key.toLowerCase() === sp.key;
  }
  function isTyping(e) { const t = e.target; return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) && !(t.type === 'range'); }

  ui.initKeyboard = function () {
    document.addEventListener('keydown', function (e) {
      if (document.querySelector('dialog[open]')) return;
      if (isTyping(e)) return;
      if (e.key === ' ' && !e.repeat) {
        if (document.activeElement && /BUTTON|A/.test(document.activeElement.tagName) && document.activeElement.closest('#menubar, #toolbar, #panels, #optbar, #topbar')) return;
        L.spaceDown = true; L.syncCursor(); e.preventDefault(); return;
      }
      if (e.key === ' ') { e.preventDefault(); return; }
      const mod = e.ctrlKey || e.metaKey;
      // commands
      for (let i = 0; i < CMDS.length; i++) {
        const c = CMDS[i]; if (c.sep || c.noKey && !c.keys) continue;
        const specs = [c.keys, c.alt].filter(Boolean);
        for (let j = 0; j < specs.length; j++) {
          if (c.noKey && j === 0 && c.label === 'Paste') continue;
          if (match(e, specs[j])) { e.preventDefault(); runCmd(c); return; }
        }
      }
      if (e.key === '?' && !mod) { e.preventDefault(); ui.shortcutsDialog(); return; }
      if (!L.doc) return;
      if (!mod && !e.altKey) {
        // tools
        const k = e.key.toLowerCase();
        if (k.length === 1 && /[a-z]/.test(k)) {
          for (let i = 0; i < L.TOOL_ORDER.length; i++) { const id = L.TOOL_ORDER[i]; if (id !== '-' && L.tools[id].key.toLowerCase() === k) { e.preventDefault(); L.setTool(id); return; } }
          if (k === 'x') { const f = L.fg; L.setColor('fg', L.bg); L.setColor('bg', f); return; }
          if (k === 'd') { L.setColor('fg', '#101114'); L.setColor('bg', '#ffffff'); return; }
        }
        if (e.key === '[' || e.key === ']') {
          const o = L.opts[L.tool]; if (o && o.size) { const f = e.key === ']' ? 1 : -1, s = o.size; o.size = L.clamp(Math.round(s + f * Math.max(1, s * 0.12)), 1, 500); L.emit('opts'); L.invalidateOverlay(); }
          return;
        }
        if (/^[0-9]$/.test(e.key) && L.active() && L.tool !== 'text') { const l = L.active(); l.opacity = e.key === '0' ? 1 : +e.key / 10; L.invalidate(); L.emit('active'); clearTimeout(ui._opT); ui._opT = setTimeout(function () { L.commit('Layer opacity'); }, 400); return; }
        if (e.key.indexOf('Arrow') === 0 && L.tool === 'move' && L.tools.move.nudge) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; L.tools.move.nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0); return; }
      }
      if (e.key === 'Enter') { if (L.toolKey('enter', e)) e.preventDefault(); }
      else if (e.key === 'Escape') { if (L.toolKey('escape', e)) e.preventDefault(); else if (L.sel) { L.deselect(); } }
    });
    document.addEventListener('keyup', function (e) { if (e.key === ' ') { L.spaceDown = false; L.syncCursor(); } });
    window.addEventListener('blur', function () { L.spaceDown = false; L.syncCursor(); });
    document.addEventListener('paste', function (e) {
      if (isTyping(e)) return;
      const files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); L.openFiles(files, true); return; }
      e.preventDefault(); L.paste();
    });
    window.addEventListener('beforeunload', function (e) { if (L.doc && L.doc.dirty) { e.preventDefault(); e.returnValue = ''; } });
  };
  ui.pasteFromMenu = async function () {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) { const t = it.types.filter(function (x) { return /^image\//.test(x); })[0]; if (t) { const blob = await it.getType(t); const f = new File([blob], 'Pasted image.png', { type: blob.type }); L.openFiles([f], true); return; } }
      }
    } catch (e) { /* permission denied: fall back to the internal clipboard */ }
    L.paste();
  };

  /* ------------------------------------------------------------ drag and drop */
  ui.initDrop = function () {
    const stage = $('#stage'), tip = $('#dropTip');
    let depth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
    stage.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; stage.classList.add('dragging'); tip.textContent = L.doc ? 'Drop to place as a new layer' : 'Drop a photo to start editing'; });
    stage.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    stage.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) stage.classList.remove('dragging'); });
    stage.addEventListener('drop', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; stage.classList.remove('dragging'); L.openFiles(e.dataTransfer.files, !!L.doc); });
  };

  /* ------------------------------------------------------------ dialogs: new / sizes / export / filters */
  const PRESETS = [
    { n: 'Square post', w: 1080, h: 1080 }, { n: 'Portrait post', w: 1080, h: 1350 }, { n: 'Story', w: 1080, h: 1920 },
    { n: 'HD 1080p', w: 1920, h: 1080 }, { n: 'Thumbnail', w: 1280, h: 720 }, { n: 'Banner', w: 1500, h: 500 },
    { n: 'A4 at 300 dpi', w: 2480, h: 3508 }, { n: '4K', w: 3840, h: 2160 }
  ];
  ui.newDialog = function () {
    let w = 1920, h = 1080, bgMode = 'white';
    const wi = numInput(w, 1, L.MAX_SIDE, 'nw'), hi = numInput(h, 1, L.MAX_SIDE, 'nh'), name = h('input', { class: 'input', value: 'Untitled', type: 'text' });
    wi.addEventListener('input', function () { w = +wi.value; }); hi.addEventListener('input', function () { h = +hi.value; });
    const grid = h('div', { class: 'preset-grid' });
    PRESETS.forEach(function (p) {
      const ar = p.w / p.h, bw = ar >= 1 ? 40 : 40 * ar, bh = ar >= 1 ? 40 / ar : 40;
      grid.appendChild(h('button', { class: 'preset', type: 'button', onclick: function () { wi.value = w = p.w; hi.value = h = p.h; name.value = p.n; } },
        h('span', { class: 'preset-box' }, h('span', { style: 'width:' + bw + 'px;height:' + bh + 'px' })), h('span', { class: 'preset-name', text: p.n }), h('span', { class: 'preset-dim', text: p.w + ' × ' + p.h })));
    });
    const bgSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Background' });
    [['white', 'White'], ['transparent', 'Transparent'], ['black', 'Black'], ['bg', 'Back color']].forEach(function (o) {
      const b = h('button', { class: 'seg-btn' + (o[0] === bgMode ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(o[0] === bgMode), text: o[1], onclick: function () { bgMode = o[0]; Array.prototype.forEach.call(bgSeg.children, function (c) { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); }); b.classList.add('on'); b.setAttribute('aria-checked', 'true'); } });
      bgSeg.appendChild(b);
    });
    const body = h('div', { class: 'form' }, h('p', { class: 'dlg-text', text: 'Start from a size that fits where the picture is going, or type your own.' }), grid,
      h('div', { class: 'row2' }, field('Width (px)', wi), field('Height (px)', hi)), field('Name', name), h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Background' }), bgSeg));
    ui.dialog({
      title: 'New canvas', body: body, wide: true,
      actions: [{ label: 'Cancel' }, {
        label: 'Create canvas', primary: true, onClick: function () {
          w = +wi.value; h = +hi.value;
          if (!(w >= 1 && h >= 1)) { L.toast('Enter a width and height of at least 1 pixel.', 'error'); return false; }
          if (w > L.MAX_SIDE || h > L.MAX_SIDE) { L.toast('Canvases can be up to ' + L.MAX_SIDE + ' px on a side.', 'error'); return false; }
          L.newDoc(w, h, { name: name.value || 'Untitled', fill: bgMode === 'white' ? '#ffffff' : bgMode === 'black' ? '#000000' : bgMode === 'bg' ? L.bg : null });
        }
      }]
    });
  };

  ui.numberPrompt = function (title, label, val, min, max, unit, cb) {
    const inp = numInput(val, min, max);
    ui.dialog({ title: title, body: h('div', { class: 'form' }, field(label + (unit ? ' (' + unit + ')' : ''), inp)), actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: function () { const v = +inp.value; if (!(v >= min && v <= max)) { L.toast('Enter a number from ' + min + ' to ' + max + '.', 'error'); return false; } cb(v); } }] });
  };

  ui.canvasSizeDialog = function () {
    const d = L.doc, wi = numInput(d.w, 1, L.MAX_SIDE), hi = numInput(d.h, 1, L.MAX_SIDE);
    let ax = 0.5, ay = 0.5;
    const grid = h('div', { class: 'anchor', role: 'radiogroup', 'aria-label': 'Anchor' });
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      (function (x, y) {
        const b = h('button', { class: 'anchor-cell' + (x === 1 && y === 1 ? ' on' : ''), type: 'button', role: 'radio', 'aria-label': ['top', 'middle', 'bottom'][y] + ' ' + ['left', 'center', 'right'][x], onclick: function () { ax = x / 2; ay = y / 2; Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove('on'); }); b.classList.add('on'); } });
        grid.appendChild(b);
      })(x, y);
    }
    ui.dialog({
      title: 'Canvas size', body: h('div', { class: 'form' }, h('p', { class: 'dlg-text', text: 'Change the size of the working area. Your layers stay as they are; the anchor decides which side grows or shrinks.' }),
        h('div', { class: 'row2' }, field('Width (px)', wi), field('Height (px)', hi)), h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Anchor' }), grid)),
      actions: [{ label: 'Cancel' }, { label: 'Resize canvas', primary: true, onClick: function () { if (!(+wi.value >= 1 && +hi.value >= 1)) { L.toast('Enter a width and height of at least 1 pixel.', 'error'); return false; } L.resizeCanvas(+wi.value, +hi.value, ax, ay); } }]
    });
  };
  ui.imageSizeDialog = function () {
    const d = L.doc, wi = numInput(d.w, 1, L.MAX_SIDE), hi = numInput(d.h, 1, L.MAX_SIDE), lock = h('input', { type: 'checkbox', checked: true, id: 'lockAR' });
    const ar = d.w / d.h;
    wi.addEventListener('input', function () { if (lock.checked) hi.value = Math.max(1, Math.round(wi.value / ar)); });
    hi.addEventListener('input', function () { if (lock.checked) wi.value = Math.max(1, Math.round(hi.value * ar)); });
    ui.dialog({
      title: 'Image size', body: h('div', { class: 'form' }, h('p', { class: 'dlg-text', text: 'Scale the whole picture, every layer included. Making it larger cannot add detail that was not there.' }),
        h('div', { class: 'row2' }, field('Width (px)', wi), field('Height (px)', hi)), h('label', { class: 'check' }, lock, h('span', { text: 'Keep proportions' }))),
      actions: [{ label: 'Cancel' }, { label: 'Resize image', primary: true, onClick: function () { if (!(+wi.value >= 1 && +hi.value >= 1)) { L.toast('Enter a width and height of at least 1 pixel.', 'error'); return false; } L.resizeImage(+wi.value, +hi.value); } }]
    });
  };

  /* ---- export ---- */
  ui.exportDialog = function () {
    const d = L.doc; let fmt = 'png', q = 0.9, scale = 1;
    const name = h('input', { class: 'input', type: 'text', value: (d.name || 'Untitled').replace(/\.[a-z0-9]+$/i, '') });
    const info = h('div', { class: 'export-info', text: '' });
    const qRow = h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Quality' }));
    const qIn = h('input', { type: 'range', min: 40, max: 100, value: 90, 'aria-label': 'Quality' }), qOut = h('output', { text: '90%' });
    qRow.appendChild(h('div', { class: 'slider-row' }, qIn, qOut));
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Format' });
    const fmts = [['png', 'PNG', 'Lossless, keeps transparency'], ['jpeg', 'JPG', 'Small files for photos'], ['webp', 'WebP', 'Small, keeps transparency']];
    const note = h('div', { class: 'field-note' });
    function refreshNote() { note.textContent = fmts.filter(function (f) { return f[0] === fmt; })[0][2]; qRow.style.display = fmt === 'png' ? 'none' : ''; }
    fmts.forEach(function (f) { const b = h('button', { class: 'seg-btn' + (f[0] === fmt ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(f[0] === fmt), text: f[1], onclick: function () { fmt = f[0]; Array.prototype.forEach.call(seg.children, function (c) { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); }); b.classList.add('on'); b.setAttribute('aria-checked', 'true'); refreshNote(); estimate(); } }); seg.appendChild(b); });
    const sc = h('select', { class: 'input', 'aria-label': 'Scale' }); [[0.5, '50%'], [1, '100% (original)'], [2, '200%']].forEach(function (o) { sc.appendChild(h('option', { value: o[0], text: o[1], selected: o[0] === 1 })); });
    sc.addEventListener('change', function () { scale = +sc.value; estimate(); });
    qIn.addEventListener('input', function () { q = qIn.value / 100; qOut.textContent = qIn.value + '%'; estimate(); });
    let t = 0;
    function mime() { return 'image/' + fmt; }
    function estimate() {
      clearTimeout(t);
      info.textContent = 'Estimating size…';
      t = setTimeout(async function () {
        try { const b = await L.exportBlob(mime(), q, scale); info.textContent = Math.round(d.w * scale) + ' × ' + Math.round(d.h * scale) + ' px, about ' + (b.size > 1048576 ? (b.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b.size / 1024)) + ' KB'); }
        catch (e) { info.textContent = ''; }
      }, 250);
    }
    const body = h('div', { class: 'form' }, field('File name', name), h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Format' }), seg, note), qRow, field('Size', sc), info);
    refreshNote(); estimate();
    ui.dialog({
      title: 'Export image', body: body,
      actions: [
        { label: 'Copy to clipboard', align: 'left', onClick: async function () { try { const b = await L.exportBlob('image/png', 1, scale); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); L.toast('Copied as PNG.'); } catch (e) { L.toast('Your browser would not let Chumi.edit use the clipboard here. Download the file instead.', 'error'); } return false; } },
        { label: 'Cancel' },
        { label: 'Download', primary: true, onClick: async function () {
          try {
            const b = await L.exportBlob(mime(), q, scale), ext = fmt === 'jpeg' ? 'jpg' : fmt;
            const r = await L.saveBlob(b, (name.value || 'Untitled') + '.' + ext);
            if (r === 'saved') L.toast('Exported ' + (name.value || 'Untitled') + '.' + ext);
            else return false;
          } catch (e) { L.toast('Export failed. Try a smaller size.', 'error'); return false; }
        } }
      ]
    });
  };
  ui.saveProject = async function () {
    if (!L.doc) return;
    L.toast('Saving project…');
    try {
      const data = await L.serialize();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const r = await L.saveBlob(blob, (L.doc.name || 'Untitled').replace(/\.[a-z0-9]+$/i, '') + '.chumi.json');
      if (r === 'saved') { L.doc.dirty = false; L.toast('Project saved. Open it again from File, Open photo.'); }
    } catch (e) { L.toast('The project could not be saved.', 'error'); }
  };

  /* ---- filter dialog with a 1:1 preview of the middle of the picture ---- */
  ui.filterDialog = function (f) {
    const l = L.active(); if (!l) { L.toast('Open a photo first.'); return; }
    if (l.locked) { L.toast('This layer is locked.'); return; }
    if (!f.params.length) { ui.applyFilter(f, {}); return; }
    const d = L.doc, vals = {};
    f.params.forEach(function (p) { vals[p.id] = p.value; });
    const base = L.mkCanvas(d.w, d.h); L.drawBitmap(base.getContext('2d'), l);
    const b = L.sel ? L.sel.bounds : { x: 0, y: 0, w: d.w, h: d.h };
    const rw = Math.min(520, b.w), rh = Math.min(340, b.h), rx = Math.round(b.x + (b.w - rw) / 2), ry = Math.round(b.y + (b.h - rh) / 2);
    const region = L.mkCanvas(rw, rh); region.getContext('2d').drawImage(base, rx, ry, rw, rh, 0, 0, rw, rh);
    const work = L.mkCanvas(rw, rh), shown = L.mkCanvas(rw, rh);
    shown.className = 'filter-preview'; shown.style.maxWidth = '100%';
    let showOrig = false, tm = 0;
    function run() {
      const c = work.getContext('2d'); c.clearRect(0, 0, rw, rh); c.drawImage(region, 0, 0);
      try { f.run(work, vals, { fullW: d.w, fullH: d.h, ox: rx, oy: ry }); } catch (e) { console.error(e); }
      paint();
    }
    function paint() { const c = shown.getContext('2d'); c.clearRect(0, 0, rw, rh); c.drawImage(showOrig ? region : work, 0, 0); }
    const rows = f.params.map(function (p) {
      if (p.type === 'check') {
        const cb = h('input', { type: 'checkbox', checked: !!p.value, id: 'fp-' + p.id });
        cb.addEventListener('change', function () { vals[p.id] = cb.checked; clearTimeout(tm); tm = setTimeout(run, 20); });
        return h('label', { class: 'check' }, cb, h('span', { text: p.label }));
      }
      const r = h('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: p.value, id: 'fp-' + p.id, 'aria-label': p.label });
      const o = h('output', { text: p.value + (p.unit || '') });
      r.addEventListener('input', function () { vals[p.id] = +r.value; o.textContent = r.value + (p.unit || ''); clearTimeout(tm); tm = setTimeout(run, 30); });
      return h('div', { class: 'param' }, h('label', { for: 'fp-' + p.id, text: p.label }), h('div', { class: 'slider-row' }, r, o));
    });
    const cmp = h('button', { class: 'btn small', type: 'button', text: 'Hold to see the original' });
    ['pointerdown'].forEach(function (ev) { cmp.addEventListener(ev, function () { showOrig = true; paint(); }); });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (ev) { cmp.addEventListener(ev, function () { if (showOrig) { showOrig = false; paint(); } }); });
    const body = h('div', { class: 'form filter-form' }, h('div', { class: 'filter-stage' }, shown, h('div', { class: 'filter-cap' }, 'Preview of the middle of the picture at full size', cmp)), h('div', { class: 'params' }, rows));
    run();
    ui.dialog({ title: f.label, body: body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: function () { ui.applyFilter(f, vals); } }] });
  };
  ui.applyFilter = function (f, vals) {
    const l = L.paintTarget(); if (!l) return;
    L.emit('busy', true);
    setTimeout(function () {
      try {
        const out = L.mkCanvas(l.canvas.width, l.canvas.height); out.getContext('2d').drawImage(l.canvas, 0, 0);
        f.run(out, vals, { fullW: out.width, fullH: out.height, ox: 0, oy: 0 });
        L.replaceThroughSel(l, out); L.touch(l); L.commit(f.label.replace(/…$/, ''));
      } catch (e) { console.error(e); L.toast('That filter could not be applied to this layer.', 'error'); }
      L.emit('busy', false);
    }, 20);
  };

  ui.autoEnhance = function () {
    const l = L.active(); if (!l) return;
    l.adj = A.auto(l.canvas); L.invalidate(); L.commit('Auto enhance'); L.emit('active');
    L.toast('Tone and color adjusted. Fine-tune it in the Adjust tab.');
  };
  ui.applyPreset = function (p) {
    const l = L.active(); if (!l) { L.toast('Select a layer first.'); return; }
    l.adj = Object.assign(A.defaults(), p.adj); L.invalidate(); L.commit('Look: ' + p.name); L.emit('active');
  };

  /* ---- help ---- */
  ui.shortcutsDialog = function () {
    const groups = [
      ['Tools', L.TOOL_ORDER.filter(function (i) { return i !== '-'; }).map(function (i) { return [L.tools[i].name, L.tools[i].key.toLowerCase()]; })],
      ['Edit', [['Undo', 'mod+z'], ['Redo', 'mod+shift+z'], ['Copy / Cut / Paste', 'mod+c'], ['Select all', 'mod+a'], ['Deselect', 'mod+d'], ['Invert selection', 'mod+shift+i'], ['Clear selection', 'delete'], ['Fill with front color', 'alt+backspace']]],
      ['Layers', [['New layer', 'mod+shift+n'], ['Duplicate', 'mod+j'], ['Merge down', 'mod+e'], ['Forward / backward', 'mod+]'], ['Opacity 10% to 100%', '1'], ['Nudge one pixel', 'ArrowKeys']]],
      ['View', [['Zoom in / out', 'mod+plus'], ['Fit on screen', 'mod+0'], ['Actual pixels', 'mod+1'], ['Pan while dragging', 'Space'], ['Zoom with the mouse', 'Scroll'], ['Search commands', 'mod+k']]],
      ['Painting', [['Smaller / larger brush', '['], ['Swap front and back color', 'x'], ['Default colors', 'd'], ['Straight line', 'shift'], ['Pick color while painting', 'alt']]]
    ];
    const body = h('div', { class: 'shortcut-grid' });
    groups.forEach(function (g) {
      const col = h('section', { class: 'sc-col' }, h('h3', { text: g[0] }));
      g[1].forEach(function (r) { col.appendChild(h('div', { class: 'sc-row' }, h('span', { text: r[0] }), h('kbd', { text: r[1] === 'ArrowKeys' ? 'Arrows' : r[1] === 'Space' ? 'Space' : r[1] === 'Scroll' ? 'Wheel' : r[1] === 'shift' ? 'Shift' : r[1] === 'alt' ? 'Alt' : ui.fmtKey(r[1]) }))); });
      body.appendChild(col);
    });
    ui.dialog({ title: 'Keyboard shortcuts', body: body, wide: true, actions: [{ label: 'Done', primary: true }] });
  };
  ui.aboutDialog = function () {
    ui.dialog({
      title: 'About Chumi.edit', body: h('div', { class: 'form' },
        h('p', { class: 'dlg-text', text: 'Chumi.edit is a photo editor that runs entirely in your browser. Your pictures are never uploaded anywhere; editing happens on your own device.' }),
        h('p', { class: 'dlg-text', text: 'It works with layers, selections, brushes, text, shapes, color adjustments and filters, and it exports PNG, JPG and WebP. It does not open or save PSD files.' }),
        h('p', { class: 'dlg-text', text: 'The sample photographs are drawn in code, so you can practice without opening one of your own.' })),
      actions: [{ label: 'Close', primary: true }]
    });
  };

  /* ---- tour ---- */
  ui.startTour = function () {
    const steps = [
      { sel: '#toolbar', title: 'Pick a tool', text: 'Everything you can do to a picture starts here. Hover a tool to see its shortcut.', side: 'right' },
      { sel: '#optbar', title: 'Fine-tune it', text: 'Each tool puts its own settings in this bar, such as brush size or selection mode.', side: 'bottom' },
      { sel: '#stage', title: 'Work on the canvas', text: 'Scroll to zoom. Hold Space and drag to move around. Drop more photos here to add them as layers.', side: 'center' },
      { sel: '#layersPanel', title: 'Think in layers', text: 'Each photo, shape and piece of text sits on its own layer. Reorder, hide or blend them without losing anything.', side: 'left' },
      { sel: '#panelTabs', title: 'Adjust the look', text: 'Adjust changes color and tone without touching the pixels. Properties edits the selected text, shape or position.', side: 'left' },
      { sel: '#cmdBtn', title: 'Find anything fast', text: 'Press ' + ui.fmtKey('mod+k') + ' and type what you want to do. Every command and filter is in there.', side: 'bottom' }
    ];
    let i = 0;
    const ring = h('div', { class: 'tour-ring' }), card = h('div', { class: 'tour-card', role: 'dialog', 'aria-label': 'Quick tour' });
    document.body.appendChild(ring); document.body.appendChild(card);
    function end() { ring.remove(); card.remove(); window.removeEventListener('resize', place); document.removeEventListener('keydown', key, true); try { localStorage.setItem('chumi-toured', '1'); } catch (e) { /* storage unavailable */ } }
    function key(e) { if (e.key === 'Escape') { e.stopPropagation(); end(); } }
    function place() {
      const s = steps[i], el = $(s.sel); if (!el) { next(); return; }
      const r = el.getBoundingClientRect();
      const small = s.sel === '#stage';
      ring.style.cssText = small ? 'left:' + (r.left + r.width / 2 - 140) + 'px;top:' + (r.top + r.height / 2 - 90) + 'px;width:280px;height:180px;opacity:0' : 'left:' + (r.left - 4) + 'px;top:' + (r.top - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px';
      card.innerHTML = '';
      card.appendChild(h('div', { class: 'tour-step', text: 'Step ' + (i + 1) + ' of ' + steps.length }));
      card.appendChild(h('h3', { text: s.title })); card.appendChild(h('p', { text: s.text }));
      card.appendChild(h('div', { class: 'tour-actions' }, h('button', { class: 'btn small', type: 'button', text: 'Skip tour', onclick: end }), h('button', { class: 'btn small primary', type: 'button', text: i === steps.length - 1 ? 'Start editing' : 'Next', onclick: next })));
      const cw = 300, ch = card.offsetHeight || 150, vw = window.innerWidth, vh = window.innerHeight;
      let x, y;
      if (s.side === 'right') { x = r.right + 14; y = r.top + 20; } else if (s.side === 'left') { x = r.left - cw - 14; y = r.top + 20; }
      else if (s.side === 'bottom') { x = Math.min(vw - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2)); y = r.bottom + 14; }
      else { x = r.left + r.width / 2 - cw / 2; y = r.top + r.height / 2 - ch / 2; }
      card.style.left = Math.max(12, Math.min(vw - cw - 12, x)) + 'px'; card.style.top = Math.max(12, Math.min(vh - ch - 12, y)) + 'px';
      const b = card.querySelector('.primary'); if (b) b.focus();
    }
    function next() { i++; if (i >= steps.length) end(); else place(); }
    window.addEventListener('resize', place); document.addEventListener('keydown', key, true);
    place();
  };
})();
