/* Chumi.edit smart tools, interface side: the AI menu, the progress card, the Remove brush, the quick-action bar
   and the Generative fill dialog. The engines live in ai.js, inpaint-core.js, ai-matte.js and genfill.js. */
(function () {
  'use strict';
  const L = window.Chumi, ui = L.ui, AI = L.AI, G = L.GenFill, h = ui.h, ic = ui.ic, $ = ui.$;
  const mk = L.mkCanvas, clamp = L.clamp;
  const ai = (ui.ai = {});

  /* ------------------------------------------------------------ progress card */
  /* A modal "working" card. It appears after `delay` ms so quick jobs do not flash it. While it is up the picture
     cannot be edited, so what finishes is always what was started. Esc or Cancel stops the job. */
  ui.locked = false;
  ui.working = function (title, o) {
    o = o || {};
    const token = { stop: false, cancel: null }, ctl = new AbortController();
    const fill = h('div', { class: 'work-fill indet' }), text = h('div', { class: 'work-text', role: 'status', 'aria-live': 'polite', text: 'Getting started' });
    const track = h('div', { class: 'work-track', role: 'progressbar', 'aria-label': title, 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
    const cancelBtn = h('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: function () { cancel(); } });
    const card = h('div', { class: 'work-card', role: 'group', 'aria-label': title, hidden: true }, h('h3', { text: title }), text, track, h('div', { class: 'work-actions' }, cancelBtn));
    const scrim = h('div', { class: 'work-scrim' }, card);
    document.body.appendChild(scrim);
    ui.locked = true; L.emit('busy', true);
    const t = setTimeout(function () { card.hidden = false; cancelBtn.focus(); }, o.delay == null ? 400 : o.delay);
    let over = false;
    function cancel() {
      if (over) return;
      token.stop = true; ctl.abort();
      if (token.cancel) token.cancel();
      text.textContent = 'Stopping';
    }
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (e.key === 'Tab') return;
      e.stopPropagation(); if (e.target === document.body || !card.contains(e.target)) e.preventDefault();
    }
    document.addEventListener('keydown', key, true);
    return {
      token: token, signal: ctl.signal,
      status: function (msg, frac) {
        if (over) return;
        if (msg) text.textContent = msg;
        if (typeof frac === 'number') { fill.classList.remove('indet'); const p = Math.round(clamp(frac, 0, 1) * 100); fill.style.width = p + '%'; track.setAttribute('aria-valuenow', String(p)); }
      },
      done: function () {
        if (over) return; over = true;
        clearTimeout(t); document.removeEventListener('keydown', key, true);
        scrim.remove(); ui.locked = false; L.emit('busy', false);
      }
    };
  };
  /* runs fn(work) behind the card; returns its value, or null after showing why nothing happened */
  async function guarded(title, fn, o) {
    const w = ui.working(title, o);
    try { return await fn(w); }
    catch (e) {
      if (e && (e.cancelled || e.name === 'AbortError')) { L.toast('Cancelled. Nothing was changed.'); return null; }
      console.error(e); L.toast((e && e.message) || 'That did not work. Nothing was changed.', 'error'); return null;
    } finally { w.done(); }
  }
  ai.guarded = guarded;

  function coverage(alpha) { let n = 0; for (let i = 0; i < alpha.length; i++) if (alpha[i] > 0.5) n++; return n / alpha.length; }
  const FALLBACK_NOTE = 'The on-device AI could not be loaded, so Chumi.edit used the plain-color method instead. It works best on a simple background. Check your connection and try again for busier photos.';

  /* ------------------------------------------------------------ remove background / select subject / blur */
  ai.removeBackground = async function () {
    if (!L.doc) { L.toast('Open a photo first.'); return; }
    const l = L.paintTarget(); if (!l) return;
    const det = await guarded('Removing the background', function (w) { return AI.detectSubject(l.canvas, w.status, w.token); });
    if (!det) return;
    const c = coverage(det.alpha);
    if (c < 0.004) { L.toast('No clear subject found in this layer, so nothing was removed.'); return; }
    if (c > 0.995) { L.toast('The whole picture looks like the subject, so there is no background to remove.'); return; }
    L.own(l); AI.applyCutout(l, det);
    if (l.name === 'Background') l.name = 'Cutout';
    L.touch(l); L.commit('Remove background'); L.emit('active');
    L.toast(det.mode === 'plain' ? FALLBACK_NOTE : 'Background removed. Use Undo, or the Eraser, to fine-tune the edge.');
  };

  ai.selectSubject = async function () {
    if (!L.doc) { L.toast('Open a photo first.'); return; }
    const src = L.flatCanvas();
    const det = await guarded('Finding the subject', function (w) { return AI.detectSubject(src, w.status, w.token); });
    if (!det) return;
    const mask = AI.alphaToMask(det.alpha, det.W, det.H);
    if (coverage(det.alpha) < 0.004 || !AI.maskBounds(mask)) { L.toast('No clear subject found. Try the Lasso or Magic wand instead.'); return; }
    L.selectCombine(mask, 'new');
    L.toast(det.mode === 'plain' ? FALLBACK_NOTE : 'Subject selected. Refine it with the selection tools, or remove the background.');
  };

  ai.blurBackground = async function (radius) {
    const l = L.paintTarget(); if (!l) return;
    const det = await guarded('Blurring the background', function (w) { return AI.detectSubject(l.canvas, w.status, w.token); });
    if (!det) return;
    const c = coverage(det.alpha);
    if (c < 0.004 || c > 0.995) { L.toast('Could not tell the subject from the background in this picture, so nothing was blurred.'); return; }
    AI.blurBackground(l, det, radius);
    L.touch(l); L.commit('Blur background'); L.emit('active'); L.invalidate();
    L.toast(det.mode === 'plain' ? FALLBACK_NOTE : 'Done. The sharp subject and the blurred background are separate layers.');
  };
  ai.blurDialog = function () {
    if (!L.doc) { L.toast('Open a photo first.'); return; }
    const def = clamp(Math.round(Math.max(L.doc.w, L.doc.h) * 0.01), 4, 40);
    const r = h('input', { type: 'range', min: 2, max: 100, step: 1, value: def, id: 'bgBlur', 'aria-label': 'Blur amount' }), out = h('output', { text: def + ' px', for: 'bgBlur' });
    r.addEventListener('input', function () { out.textContent = r.value + ' px'; });
    ui.dialog({
      title: 'Blur background',
      body: h('div', { class: 'form' },
        h('p', { class: 'dlg-text', text: 'Keeps the main subject sharp and softens everything behind it. The subject and the blurred background end up on separate layers, so you can adjust either one afterwards.' }),
        h('div', { class: 'param' }, h('label', { for: 'bgBlur', text: 'Blur amount' }), h('div', { class: 'slider-row' }, r, out))),
      actions: [{ label: 'Cancel' }, { label: 'Blur background', primary: true, onClick: function () { const v = +r.value; setTimeout(function () { ai.blurBackground(v); }, 0); } }]
    });
  };

  /* ------------------------------------------------------------ content-aware fill */
  /* Fill `mask` (document-sized canvas, alpha = area to replace) from the picture around it. */
  ai.fillMask = async function (mask, bounds, o) {
    o = o || {};
    if (!L.doc) return false;
    const all = o.sample === 'all';
    let l;
    if (all) { l = L.active(); if (!l) { L.toast('Open a photo first.'); return false; } } else { l = L.paintTarget(); if (!l) return false; }
    const src = all ? L.flatCanvas() : AI.bake(l);
    const patch = await guarded('Filling in', function (w) {
      return AI.fillRegion(src, mask, bounds, { token: w.token, onProgress: function (f) { w.status('Filling in from the picture around it', 0.04 + f * 0.9); } });
    });
    if (!patch) return false;
    const target = AI.placePatch(l, patch, all, 'Removed');
    L.touch(target); L.commit(o.label || 'Content-aware fill'); L.emit('active'); L.invalidate();
    return true;
  };
  ai.contentFill = function () {
    if (!L.doc) { L.toast('Open a photo first.'); return; }
    if (!L.sel) { L.toast('Select what you want gone first. Or use the Remove brush (J) and just paint over it.'); return; }
    return ai.fillMask(L.sel.mask, L.sel.bounds, { label: 'Content-aware fill', sample: 'layer' });
  };

  /* ------------------------------------------------------------ Remove brush */
  L.opts.remove = { size: 40, sample: 'layer' };
  const T = L.tools;
  let rs = null;
  T.remove = {
    name: 'Remove', key: 'J', icon: 'i-remove', cursor: 'crosshair',
    hint: 'Paint over something you want gone. When you let go, the picture around it fills the gap.',
    options: [
      { type: 'range', label: 'Size', opt: 'remove', key: 'size', min: 4, max: 300, step: 1, unit: 'px', log: true },
      { type: 'segment', label: 'Fill from', opt: 'remove', key: 'sample', items: [{ v: 'layer', label: 'Layer' }, { v: 'all', label: 'Image' }] }
    ],
    down: function (p) {
      if (ui.locked) return false;
      const l = L.paintTarget(); if (!l) return false;
      const o = L.opts.remove, buf = mk(L.doc.w, L.doc.h), c = buf.getContext('2d');
      c.fillStyle = c.strokeStyle = '#ff3d5a'; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = o.size;
      c.beginPath(); c.arc(p.x, p.y, o.size / 2, 0, 6.2832); c.fill();
      rs = { buf: buf, c: c, last: { x: p.x, y: p.y }, x0: p.x, y0: p.y, x1: p.x, y1: p.y, size: o.size };
      L.preview = { layerId: l.id, buf: buf, op: 'over', alpha: 0.62 };
      L.invalidate(); return true;
    },
    move: function (p) {
      if (!rs) return;
      rs.c.beginPath(); rs.c.moveTo(rs.last.x, rs.last.y); rs.c.lineTo(p.x, p.y); rs.c.stroke();
      rs.last = { x: p.x, y: p.y };
      rs.x0 = Math.min(rs.x0, p.x); rs.y0 = Math.min(rs.y0, p.y); rs.x1 = Math.max(rs.x1, p.x); rs.y1 = Math.max(rs.y1, p.y);
      L.invalidate();
    },
    up: function () {
      if (!rs) return;
      const s = rs, d = L.doc; rs = null;
      const r = s.size / 2 + 2;
      let x0 = Math.max(0, Math.floor(s.x0 - r)), y0 = Math.max(0, Math.floor(s.y0 - r)), x1 = Math.min(d.w, Math.ceil(s.x1 + r)), y1 = Math.min(d.h, Math.ceil(s.y1 + r));
      let mask = s.buf;
      if (L.sel) {
        mask = mk(d.w, d.h); const mc = mask.getContext('2d');
        mc.drawImage(s.buf, 0, 0); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(L.sel.mask, 0, 0);
        const b = L.sel.bounds; x0 = Math.max(x0, b.x); y0 = Math.max(y0, b.y); x1 = Math.min(x1, b.x + b.w); y1 = Math.min(y1, b.y + b.h);
      }
      const clear = function () { L.preview = null; L.invalidate(); };
      if (x1 - x0 < 1 || y1 - y0 < 1) { clear(); return; }
      ai.fillMask(mask, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { sample: L.opts.remove.sample, label: 'Remove' }).then(clear, clear);
    },
    cancel: function () { if (rs) { rs = null; L.preview = null; L.invalidate(); } },
    overlay: function (ctx, z) {
      if (!L.mouse.inside) return;
      const r = Math.max(2, L.opts.remove.size / 2 * z);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.arc(L.mouse.sx, L.mouse.sy, r + 0.5, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(L.mouse.sx, L.mouse.sy, r - 0.5, 0, 6.2832); ctx.stroke();
      if (r < 6) { ctx.beginPath(); ctx.moveTo(L.mouse.sx - 4, L.mouse.sy); ctx.lineTo(L.mouse.sx + 4, L.mouse.sy); ctx.moveTo(L.mouse.sx, L.mouse.sy - 4); ctx.lineTo(L.mouse.sx, L.mouse.sy + 4); ctx.stroke(); }
    }
  };
  L.TOOL_ORDER.splice(L.TOOL_ORDER.indexOf('clone') + 1, 0, 'remove');

  /* ------------------------------------------------------------ generative fill */
  function segControl(label, items, get, set) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const btns = items.map(function (it) {
      return h('button', { class: 'seg-btn', type: 'button', role: 'radio', text: it.label, onclick: function () { set(it.v); sync(); } });
    });
    btns.forEach(function (b) { wrap.appendChild(b); });
    function sync() { items.forEach(function (it, i) { const on = get() === it.v; btns[i].classList.toggle('on', on); btns[i].setAttribute('aria-checked', String(on)); }); }
    wrap.sync = sync; sync();
    return wrap;
  }
  ai.generativeFillDialog = function () {
    if (!L.doc) { L.toast('Open a photo first.'); return; }
    if (!L.sel) { L.toast('Select the area first. Draw around where you want something new, then choose Generative fill.'); L.setTool('lasso'); return; }
    const S = G.settings, O = S.openai;
    const prompt = h('textarea', { class: 'input textarea', id: 'gfPrompt', rows: 3, maxlength: 400, placeholder: 'For example: a small red sailboat' });
    const provSeg = segControl('Service', [{ v: 'horde', label: 'Free community service' }, { v: 'openai', label: 'My own key' }], function () { return S.provider; }, function (v) { S.provider = v; if (v === 'openai' && S.n > 1) S.n = 1; if (v === 'horde' && S.n < 2) S.n = 2; countSeg.sync(); refresh(); });
    const countSeg = segControl('Variations', [{ v: 1, label: '1' }, { v: 2, label: '2' }, { v: 3, label: '3' }], function () { return S.n; }, function (v) { S.n = v; });
    const notice = h('p', { class: 'gf-notice' });
    const keyIn = h('input', { class: 'input', type: 'password', id: 'gfKey', autocomplete: 'off', spellcheck: 'false', value: O.key });
    const baseIn = h('input', { class: 'input', type: 'text', id: 'gfBase', spellcheck: 'false', value: O.base });
    const modelIn = h('input', { class: 'input', type: 'text', id: 'gfModel', spellcheck: 'false', value: O.model });
    const remember = h('input', { type: 'checkbox', id: 'gfRemember', checked: !!O.remember });
    const own = h('div', { class: 'gf-own' },
      ui.field('API key', keyIn, 'Used only to ask the service for the picture. It is not sent anywhere else.'),
      h('div', { class: 'row2' }, ui.field('Service address', baseIn), ui.field('Model', modelIn)),
      h('label', { class: 'check' }, remember, h('span', { text: 'Remember the key on this device' })));
    const consent = h('input', { type: 'checkbox', id: 'gfConsent' });
    const consentRow = h('label', { class: 'check gf-consent' }, consent, h('span', { text: 'I understand this leaves my device' }));

    function refresh() {
      const empty = !prompt.value.trim(), pid = S.provider;
      provSeg.sync();
      own.hidden = empty || pid !== 'openai';
      provSeg.parentNode.hidden = empty; countSeg.parentNode.hidden = empty;
      notice.hidden = empty;
      if (pid === 'horde') notice.textContent = 'Sends ' + G.providers.horde.sends + ' to the AI Horde (aihorde.net), a free service run by volunteers. Their computers do the painting, so other people could see what you send. It can take a minute or more. Do not use pictures that are private.';
      else {
        const host = (G.cleanBase(baseIn.value) || 'the service').replace(/^https?:\/\//, '').split('/')[0];
        notice.textContent = 'Sends ' + G.providers.openai.sends + ' to ' + host + '. You pay that service for each picture.';
      }
      consentRow.hidden = empty || !!S.consent[pid];
      go.textContent = empty ? 'Remove selection' : 'Generate';
      go.disabled = !empty && !S.consent[pid] && !consent.checked;
    }
    prompt.addEventListener('input', refresh); consent.addEventListener('change', refresh); baseIn.addEventListener('input', refresh);

    const actions = [{ label: 'Cancel' }, {
      label: 'Generate', primary: true, onClick: function () {
        const text = prompt.value.trim(), pid = S.provider;
        if (!text) { setTimeout(function () { ai.contentFill(); }, 0); return; }
        if (pid === 'openai') {
          if (!keyIn.value.trim()) { L.toast('Enter your API key first.', 'error'); keyIn.focus(); return false; }
          if (!G.cleanBase(baseIn.value)) { L.toast('The service address must start with https://', 'error'); baseIn.focus(); return false; }
          O.key = keyIn.value.trim(); O.base = G.cleanBase(baseIn.value); O.model = modelIn.value.trim() || 'gpt-image-1'; O.remember = remember.checked;
        }
        if (!S.consent[pid]) { if (!consent.checked) return false; S.consent[pid] = true; }
        G.saveSettings();
        setTimeout(function () { ai.generate(text); }, 0);
      }
    }];
    const body = h('div', { class: 'form' },
      ui.field('What should appear here?', prompt, 'Leave this empty to remove what is selected instead. That is done on your device and sends nothing.'),
      h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Service' }), provSeg),
      h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'Variations' }), countSeg),
      notice, own, consentRow);
    const dlg = ui.dialog({ title: 'Generative fill', body: body, actions: actions });
    const go = actions[1]._el;
    refresh(); prompt.focus();
    return dlg;
  };

  ai.generate = async function (text) {
    if (!L.doc || !L.sel) return;
    const S = G.settings, pid = S.provider, prov = G.providers[pid];
    const mask = L.sel.mask, bounds = L.sel.bounds, src = L.flatCanvas();
    let job;
    try { job = G.prepareFor(pid, src, mask, bounds); } catch (e) { console.error(e); L.toast('That selection could not be prepared.', 'error'); return; }
    const n = pid === 'openai' ? Math.min(S.n, 3) : S.n;
    const w = ui.working('Generative fill', { delay: 0 });
    let patches = null;
    try {
      const outs = await prov.run(job, { prompt: text, n: n }, { status: w.status, signal: w.signal });
      if (w.token.stop) throw AI.cancelled();
      w.status('Blending it into your picture', 0.97); await AI.tick();
      patches = outs.map(function (c) { return G.compose(job, c); });
    } catch (e) {
      if (e && (e.cancelled || e.name === 'AbortError')) L.toast('Cancelled. Nothing was changed.');
      else { console.error(e); L.toast((e && e.message) || 'Generative fill did not work. Nothing was changed.', 'error'); }
    } finally { w.done(); }
    if (patches && patches.length) ai.chooseResult(job, patches, src, function () { ai.generate(text); });
  };

  ai.chooseResult = function (job, patches, src, again) {
    let sel = 0, showOrig = false;
    const k = Math.min(560 / job.w, 340 / job.h, 1), pw = Math.max(1, Math.round(job.w * k)), ph = Math.max(1, Math.round(job.h * k));
    const view = mk(pw, ph); view.className = 'filter-preview'; view.setAttribute('role', 'img'); view.setAttribute('aria-label', 'Preview of the result');
    function paint() {
      const c = view.getContext('2d'); c.clearRect(0, 0, pw, ph);
      c.drawImage(src, job.x, job.y, job.w, job.h, 0, 0, pw, ph);
      if (!showOrig) c.drawImage(patches[sel].canvas, 0, 0, job.w, job.h, 0, 0, pw, ph);
    }
    const cmp = h('button', { class: 'btn small', type: 'button', text: 'Hold to see the original' });
    cmp.addEventListener('pointerdown', function () { showOrig = true; paint(); });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (ev) { cmp.addEventListener(ev, function () { if (showOrig) { showOrig = false; paint(); } }); });
    const strip = h('div', { class: 'gf-thumbs', role: 'radiogroup', 'aria-label': 'Results' });
    const btns = patches.map(function (p, i) {
      const t = G.thumb(job, p, src, 132, 96);
      const b = h('button', { class: 'gf-thumb', type: 'button', role: 'radio', 'aria-label': 'Result ' + (i + 1) + ' of ' + patches.length, onclick: function () { sel = i; sync(); paint(); } }, t);
      strip.appendChild(b); return b;
    });
    function sync() { btns.forEach(function (b, i) { b.classList.toggle('on', i === sel); b.setAttribute('aria-checked', String(i === sel)); }); }
    sync(); paint();
    const body = h('div', { class: 'form filter-form gf-result' },
      h('div', { class: 'filter-stage' }, view, h('div', { class: 'filter-cap' }, patches.length > 1 ? 'Pick the one you like best' : 'Here is what was made', cmp)),
      patches.length > 1 ? strip : null);
    ui.dialog({
      title: 'Generative fill', body: body, wide: true,
      actions: [
        { label: 'Try again', align: 'left', onClick: function () { setTimeout(again, 0); } },
        { label: 'Cancel' },
        { label: 'Use this one', primary: true, onClick: function () {
          const d = L.doc, base = L.active() || d.layers[d.layers.length - 1];
          AI.placePatch(base, patches[sel], true, 'Generative fill');
          L.commit('Generative fill'); L.emit('active'); L.invalidate();
          L.toast('Added as its own layer, so you can hide, move or delete it any time.');
        } }
      ]
    });
  };

  /* ------------------------------------------------------------ menu + commands */
  const C = ui.cmd;
  C('AI', 'Remove background', null, ai.removeBackground);
  C('AI', 'Select subject', null, ai.selectSubject);
  C('AI', 'Blur background…', null, ai.blurDialog);
  ui.commands.push({ menu: 'AI', sep: true });
  C('AI', 'Generative fill…', null, ai.generativeFillDialog);
  C('AI', 'Content-aware fill', null, ai.contentFill, { dyn: function () { return !!L.sel; } });
  C('AI', 'Remove brush', 'j', function () { L.setTool('remove'); });

  /* ------------------------------------------------------------ quick-action bar */
  let barOn = true;
  try { barOn = localStorage.getItem('chumi-bar') !== '0'; } catch (e) { barOn = true; }
  C('View', 'Show quick actions', null, function () {
    barOn = !barOn; try { localStorage.setItem('chumi-bar', barOn ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    renderBar();
  }, { check: function () { return barOn; }, doc: false });

  const bar = h('div', { id: 'aiBar', class: 'ai-bar', role: 'toolbar', 'aria-label': 'Quick actions', hidden: true });
  const wrap = $('#stageWrap'); if (wrap) wrap.appendChild(bar);
  function barBtn(label, icon, fn, primary) {
    return h('button', { class: 'btn small' + (primary ? ' primary' : ''), type: 'button', onclick: function () { if (!ui.locked) fn(); } }, ic(icon, 16), h('span', { text: label }));
  }
  function renderBar() {
    bar.innerHTML = '';
    document.body.classList.toggle('has-aibar', !!L.doc && barOn);
    if (!L.doc || !barOn) { bar.hidden = true; return; }
    bar.hidden = false;
    if (L.sel) {
      bar.appendChild(barBtn('Generative fill', 'i-sparkle', ai.generativeFillDialog, true));
      bar.appendChild(barBtn('Remove', 'i-remove', ai.contentFill));
      bar.appendChild(barBtn('Invert', 'i-invert', function () { L.invertSel(); }));
    } else {
      bar.appendChild(barBtn('Select subject', 'i-subject', ai.selectSubject));
      bar.appendChild(barBtn('Remove background', 'i-cutout', ai.removeBackground));
      bar.appendChild(barBtn('Blur background', 'i-blur-bg', ai.blurDialog));
    }
    bar.appendChild(h('span', { class: 'ai-sep', 'aria-hidden': 'true' }));
    bar.appendChild(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Hide quick actions', 'data-tip': 'Hide quick actions', onclick: function () {
      barOn = false; try { localStorage.setItem('chumi-bar', '0'); } catch (e) { /* storage unavailable */ }
      renderBar(); L.toast('Quick actions hidden. Bring them back from View, Show quick actions.');
    } }, ic('i-x', 14)));
  }
  L.on('doc', renderBar); L.on('selection', renderBar);
  renderBar();

  /* test hook: lets the automated tests inspect and drive the smart tools */
  ai._test = { coverage: coverage };
})();
