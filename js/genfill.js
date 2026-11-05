/* Chumi.edit generative fill, engine side: cut a working crop around the selection, ask an image service to paint
   into it, then blend the answer back so it matches the picture around it.

   Nothing here runs unless the person has asked for it and agreed to what is sent (see ai-ui.js).
   There is no Chumi.edit server. Two services can be used, both called straight from the browser:
     horde   AI Horde, a free volunteer-run community service (no account needed, can be slow)
     openai  any OpenAI-compatible /images/edits endpoint, with the person's own key
   Only the small crop around the selection and the description leave the device. */
(function () {
  'use strict';
  const L = window.Chumi, AI = L.AI, mk = L.mkCanvas, clamp = L.clamp;
  const G = (L.GenFill = {});
  const r64 = function (v) { return Math.max(64, Math.round(v / 64) * 64); };

  /* ------------------------------------------------------------ settings */
  const KEY = 'chumi-genfill';
  G.settings = { provider: 'horde', consent: {}, n: 2, openai: { base: 'https://api.openai.com/v1', model: 'gpt-image-1', key: '', remember: false } };
  G.loadSettings = function () {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') {
        if (s.provider === 'horde' || s.provider === 'openai') G.settings.provider = s.provider;
        if (s.consent && typeof s.consent === 'object') G.settings.consent = { horde: !!s.consent.horde, openai: !!s.consent.openai };
        if (s.n >= 1 && s.n <= 4) G.settings.n = s.n | 0;
        if (s.openai) {
          const o = G.settings.openai;
          if (typeof s.openai.base === 'string') o.base = s.openai.base;
          if (typeof s.openai.model === 'string') o.model = s.openai.model;
          if (s.openai.remember && typeof s.openai.key === 'string') { o.key = s.openai.key; o.remember = true; }
        }
      }
    } catch (e) { /* storage unavailable or corrupt: keep the defaults */ }
  };
  G.saveSettings = function () {
    try {
      const s = G.settings, o = s.openai;
      localStorage.setItem(KEY, JSON.stringify({ provider: s.provider, consent: s.consent, n: s.n, openai: { base: o.base, model: o.model, remember: !!o.remember, key: o.remember ? o.key : '' } }));
    } catch (e) { /* storage unavailable: settings last for this visit only */ }
  };
  G.loadSettings();

  /* ------------------------------------------------------------ region preparation */
  /* grow [lo,hi) to `need` long around its middle while staying inside [0,max] */
  function fitAxis(lo, hi, need, max) {
    need = Math.min(need, max);
    const c = (lo + hi) / 2; let a = Math.round(c - need / 2); a = clamp(a, 0, max - need);
    return [a, a + need];
  }
  /* A crop of `src` around the mask, scaled to a size the services accept (multiples of 64).
     src, mask: document sized canvases. bounds: the mask's bounding box.
     o.size forces the working size [w, h]; o.budget is the target pixel count otherwise. */
  G.prepare = function (src, mask, bounds, o) {
    o = o || {};
    const DW = src.width, DH = src.height, ID = window.ChumiInpaint;
    const mg = clamp(Math.round(Math.max(bounds.w, bounds.h) * 0.6), 40, 700);
    let x0 = Math.max(0, bounds.x - mg), y0 = Math.max(0, bounds.y - mg);
    let x1 = Math.min(DW, bounds.x + bounds.w + mg), y1 = Math.min(DH, bounds.y + bounds.h + mg);
    let tw, th;
    if (o.size) { tw = o.size[0]; th = o.size[1]; }
    else {
      const bud = o.budget || 512 * 512, asp = (x1 - x0) / (y1 - y0);
      tw = clamp(r64(Math.sqrt(bud * asp)), 64, 1024); th = clamp(r64(tw / asp), 64, 1024);
      while (tw * th > bud * 1.3 && (tw > 64 || th > 64)) { if (tw >= th) tw -= 64; else th -= 64; }
    }
    const want = tw / th;
    let cw = x1 - x0, ch = y1 - y0;
    if (cw / ch < want) { const a = fitAxis(x0, x1, Math.ceil(ch * want), DW); x0 = a[0]; x1 = a[1]; }
    else { const a = fitAxis(y0, y1, Math.ceil(cw / want), DH); y0 = a[0]; y1 = a[1]; }
    cw = x1 - x0; ch = y1 - y0;
    const sx = tw / cw;

    const base = mk(tw, th), bctx = base.getContext('2d', { willReadFrequently: true });
    bctx.imageSmoothingQuality = 'high'; bctx.drawImage(src, x0, y0, cw, ch, 0, 0, tw, th);
    const mc = mk(tw, th), mctx = mc.getContext('2d', { willReadFrequently: true });
    mctx.imageSmoothingQuality = 'high'; mctx.drawImage(mask, x0, y0, cw, ch, 0, 0, tw, th);
    const md = mctx.getImageData(0, 0, tw, th).data, hole0 = new Uint8Array(tw * th);
    for (let i = 0; i < hole0.length; i++) if (md[i * 4 + 3] >= 100) hole0[i] = 1;
    const g = clamp(Math.round(Math.min(bounds.w, bounds.h) * sx * 0.03), 2, 12);
    const hole = ID.dilate(hole0, tw, th, g);

    /* the same crop with the area to paint made see-through: this is what the services take as "paint here" */
    const cut = mk(tw, th), cctx = cut.getContext('2d');
    const cd = bctx.getImageData(0, 0, tw, th);
    for (let i = 0; i < hole.length; i++) cd.data[i * 4 + 3] = hole[i] ? 0 : 255;
    cctx.putImageData(cd, 0, 0);
    /* the plain crop made fully opaque (the picture may have see-through areas of its own) */
    const flat = mk(tw, th), fctx = flat.getContext('2d');
    fctx.fillStyle = '#ffffff'; fctx.fillRect(0, 0, tw, th); fctx.drawImage(base, 0, 0);
    return { x: x0, y: y0, w: cw, h: ch, tw: tw, th: th, base: base, flat: flat, cut: cut, hole: hole, grow: g, scale: sx, mask: mask, bounds: bounds };
  };

  /* ------------------------------------------------------------ blending the answer back */
  /* The service repaints the whole crop, so its tones drift a little from the real picture. Measure the drift in a
     ring just outside the painted area and subtract a smooth version of it from the new pixels.
     gen, base: RGBA Uint8ClampedArray (gen is changed in place). hole: 1 where new pixels will be used. */
  G.matchSeam = function (gen, base, hole, W, H) {
    const M = window.ChumiMatte, ID = window.ChumiInpaint, n = W * H;
    const r = Math.max(4, Math.round(Math.max(W, H) * 0.02));
    const outer = ID.dilate(hole, W, H, r);
    const ring = new Float32Array(n), ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      if (outer[i] && !hole[i]) { ring[i] = 1; cnt++; for (let c = 0; c < 3; c++) ch[c][i] = base[i * 4 + c] - gen[i * 4 + c]; }
    }
    if (cnt < 24) return false;
    const R = Math.max(6, Math.round(Math.max(W, H) * 0.08));
    const blur2 = function (a) { return M.boxBlur(M.boxBlur(a, W, H, R), W, H, R); };
    const den = blur2(ring), num = ch.map(blur2);
    for (let i = 0; i < n; i++) {
      if (!hole[i] || den[i] < 1e-4) continue;
      for (let c = 0; c < 3; c++) {
        const corr = clamp(num[c][i] / den[i], -56, 56);
        gen[i * 4 + c] = clamp(gen[i * 4 + c] + corr, 0, 255);
      }
    }
    return true;
  };

  /* canvas of what the service painted -> { x, y, canvas } holding only the new pixels, softly edged */
  G.compose = function (job, gen) {
    const g1 = mk(job.tw, job.th), gc = g1.getContext('2d', { willReadFrequently: true });
    gc.imageSmoothingQuality = 'high'; gc.drawImage(gen, 0, 0, job.tw, job.th);
    const gd = gc.getImageData(0, 0, job.tw, job.th), bd = job.base.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, job.tw, job.th);
    G.matchSeam(gd.data, bd.data, job.hole, job.tw, job.th);
    gc.putImageData(gd, 0, 0);
    const full = mk(job.w, job.h), fx = full.getContext('2d');
    fx.imageSmoothingQuality = 'high'; fx.drawImage(g1, 0, 0, job.w, job.h);
    const soft = AI.softMask(job.mask, { x: job.x, y: job.y, w: job.w, h: job.h }, Math.max(1, Math.round(job.grow / job.scale)));
    fx.globalCompositeOperation = 'destination-in'; fx.drawImage(soft, 0, 0);
    return { x: job.x, y: job.y, canvas: full };
  };

  /* small picture of how a result would look in place, for choosing between results */
  G.thumb = function (job, patch, srcCanvas, maxW, maxH) {
    const k = Math.min(maxW / job.w, maxH / job.h, 1), w = Math.max(1, Math.round(job.w * k)), h = Math.max(1, Math.round(job.h * k));
    const c = mk(w, h), x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(srcCanvas, job.x, job.y, job.w, job.h, 0, 0, w, h);
    x.drawImage(patch.canvas, 0, 0, job.w, job.h, 0, 0, w, h);
    return c;
  };

  /* ------------------------------------------------------------ talking to services */
  const sleep = function (ms, signal) {
    return new Promise(function (res, rej) {
      const t = setTimeout(res, ms);
      if (signal) signal.addEventListener('abort', function () { clearTimeout(t); rej(AI.cancelled()); }, { once: true });
    });
  };
  function blobOf(canvas, type, q) {
    return new Promise(function (res, rej) { canvas.toBlob(function (b) { b ? res(b) : rej(new Error('Could not prepare the picture to send.')); }, type, q); });
  }
  function b64Of(canvas, type, q) {
    const url = canvas.toDataURL(type, q);
    return url.slice(url.indexOf(',') + 1);
  }
  function loadImage(src) {
    return new Promise(function (res, rej) {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('A picture came back that could not be read.')); };
      im.src = src;
    });
  }
  async function toCanvas(src) {
    const im = await loadImage(src), c = mk(im.naturalWidth, im.naturalHeight);
    c.getContext('2d').drawImage(im, 0, 0); return c;
  }
  function friendly(status, msg) {
    msg = String(msg || '');
    if (status === 401) return 'The service did not accept the key. Check it and try again.';
    if (status === 402 || status === 403) return 'The service refused the request' + (msg ? ': ' + msg : '.');
    if (status === 429) return 'Too many requests right now. Wait a moment and try again.';
    if (status === 503 || status === 502 || status === 504) return 'The service is busy or down at the moment. Try again in a few minutes.';
    return msg || 'The service returned an error (' + status + ').';
  }
  async function jfetch(url, o, host) {
    let r;
    try { r = await fetch(url, o); }
    catch (e) {
      if (e && e.name === 'AbortError') throw AI.cancelled();
      throw new Error('Could not reach ' + host + '. Check your connection, or try again later.');
    }
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) {
      const m = j && (typeof j.message === 'string' ? j.message : j.error && j.error.message);
      const err = new Error(friendly(r.status, m)); err.status = r.status; throw err;
    }
    return j;
  }

  const HORDE = 'https://aihorde.net/api/v2';
  const horde = {
    id: 'horde', label: 'AI Horde (free, community run)', host: 'aihorde.net',
    sends: 'a small copy of the area around your selection and your description',
    async run(job, p, hooks) {
      const sig = hooks.signal;
      hooks.status('Sending to the AI Horde', 0.03);
      const body = {
        prompt: p.prompt,
        params: { sampler_name: 'k_euler_a', cfg_scale: 7.5, denoising_strength: 1, height: job.th, width: job.tw, steps: 25, n: p.n, karras: true, post_processing: [] },
        nsfw: false, censor_nsfw: true, trusted_workers: false, slow_workers: true, shared: false, r2: true,
        models: ['stable_diffusion_inpainting'],
        source_image: b64Of(job.cut, 'image/webp', 0.98), source_processing: 'inpainting'
      };
      const sub = await jfetch(HORDE + '/generate/async', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: '0000000000' }, body: JSON.stringify(body), signal: sig }, 'aihorde.net');
      const id = sub && sub.id; if (!id) throw new Error('The AI Horde did not accept the request.');
      const t0 = Date.now();
      const abort = function () { try { fetch(HORDE + '/generate/status/' + id, { method: 'DELETE', headers: { apikey: '0000000000' }, keepalive: true }); } catch (e) { /* best effort */ } };
      try {
        for (;;) {
          await sleep(Date.now() - t0 < 8000 ? 2500 : 4000, sig);
          const c = await jfetch(HORDE + '/generate/check/' + id, { signal: sig }, 'aihorde.net');
          if (c.faulted) throw new Error('The AI Horde could not make this picture. Try again, or try a different description.');
          if (c.done) break;
          const wait = c.wait_time > 0 ? ' · about ' + (c.wait_time > 90 ? Math.round(c.wait_time / 60) + ' min' : c.wait_time + ' s') : '';
          if (c.processing > 0) hooks.status('Painting' + wait, 0.35 + 0.5 * Math.min(1, (Date.now() - t0) / 60000));
          else hooks.status('Waiting in line' + (c.queue_position > 0 ? ' (place ' + c.queue_position + ')' : '') + wait, 0.1);
          if (Date.now() - t0 > 15 * 60 * 1000) throw new Error('This is taking too long. The free service may be very busy; try again later.');
        }
      } catch (e) { if (e && e.cancelled) abort(); throw e; }
      hooks.status('Collecting the pictures', 0.92);
      const st = await jfetch(HORDE + '/generate/status/' + id, { signal: sig }, 'aihorde.net');
      const gens = (st.generations || []).filter(function (g) { return g && g.img && !g.censored; });
      if (!gens.length) throw new Error('The AI Horde returned nothing usable. Its safety filter may have blocked it; try a different description.');
      const out = [];
      for (let i = 0; i < gens.length; i++) {
        const img = gens[i].img;
        if (/^https?:/i.test(img)) {
          let r; try { r = await fetch(img, { signal: sig }); } catch (e) { if (e && e.name === 'AbortError') throw AI.cancelled(); throw new Error('The picture was made but could not be downloaded.'); }
          if (!r.ok) throw new Error('The picture was made but could not be downloaded.');
          const u = URL.createObjectURL(await r.blob());
          try { out.push(await toCanvas(u)); } finally { URL.revokeObjectURL(u); }
        } else out.push(await toCanvas('data:image/webp;base64,' + img));
      }
      return out;
    }
  };

  function openaiSize(model, w, h) {
    if (/dall-e-2/i.test(model)) return { size: [1024, 1024], str: '1024x1024' };
    const a = w / h;
    if (a > 1.2) return { size: [1536, 1024], str: '1536x1024' };
    if (a < 0.83) return { size: [1024, 1536], str: '1024x1536' };
    return { size: [1024, 1024], str: '1024x1024' };
  }
  G.cleanBase = function (u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    return /^https:\/\/[^\s/]+/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u) ? u : '';
  };
  const openai = {
    id: 'openai', label: 'OpenAI-compatible, with your own key', host: 'the image service',
    sends: 'a copy of the area around your selection and your description',
    async run(job, p, hooks) {
      const o = G.settings.openai, base = G.cleanBase(o.base);
      if (!base) throw new Error('Enter the service address, starting with https://');
      if (!o.key) throw new Error('Enter your API key first.');
      const sz = openaiSize(o.model, job.tw, job.th);
      hooks.status('Sending to the image service', 0.05);
      const fd = new FormData();
      fd.append('model', o.model || 'gpt-image-1'); fd.append('prompt', p.prompt); fd.append('n', String(p.n)); fd.append('size', sz.str);
      if (/dall-e/i.test(o.model)) fd.append('response_format', 'b64_json');
      fd.append('image', await blobOf(job.flat, 'image/png'), 'image.png');
      fd.append('mask', await blobOf(job.cut, 'image/png'), 'mask.png');
      hooks.status('Waiting for the image service', 0.25);
      const j = await jfetch(base + '/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + o.key }, body: fd, signal: hooks.signal }, base.replace(/^https?:\/\//, '').split('/')[0]);
      const items = (j && j.data) || [];
      if (!items.length) throw new Error('The service returned no pictures.');
      hooks.status('Collecting the pictures', 0.9);
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.b64_json) out.push(await toCanvas('data:image/png;base64,' + it.b64_json));
        else if (it.url) {
          const r = await fetch(it.url, { signal: hooks.signal }), u = URL.createObjectURL(await r.blob());
          try { out.push(await toCanvas(u)); } finally { URL.revokeObjectURL(u); }
        }
      }
      if (!out.length) throw new Error('The service returned no pictures.');
      return out;
    }
  };
  G.providers = { horde: horde, openai: openai };
  /* the crop is cut to suit the chosen service: small and cheap for the free one, an exact size the paid one allows */
  G.prepareFor = function (id, src, mask, bounds) {
    if (id === 'openai') return G.prepare(src, mask, bounds, { size: openaiSize(G.settings.openai.model, bounds.w, bounds.h).size });
    return G.prepare(src, mask, bounds, { budget: 512 * 512 });
  };
})();
