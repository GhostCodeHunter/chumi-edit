/* Chumi.edit smart tools, engine side: subject detection, background removal, content-aware fill.
   Everything runs on the device. The only download is the small cut-out model (bundled in assets/models)
   and the ONNX runtime that executes it, which is fetched from a public CDN the first time it is needed. */
(function () {
  'use strict';
  const L = window.Chumi, M = window.ChumiMatte;
  const mk = L.mkCanvas, clamp = L.clamp;
  const AI = (L.AI = {});

  AI.MODEL_URL = 'assets/models/u2netp.onnx';
  /* the runtime is tried from each mirror in turn; the model file always comes from this site */
  AI.ORT_BASES = [
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',
    'https://unpkg.com/onnxruntime-web@1.20.1/dist/',
    'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.20.0-dev.20240818-c4ade796d6/'
  ];

  const tick = function () { return new Promise(function (r) { setTimeout(r, 16); }); };
  AI.tick = tick;
  const cancelled = function () { const e = new Error('cancelled'); e.cancelled = true; return e; };
  AI.cancelled = cancelled;

  /* ------------------------------------------------------------ runtime + model */
  function loadScript(url) {
    return new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = url; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = function () { res(); };
      s.onerror = function () { s.remove(); rej(new Error('Could not load ' + url)); };
      document.head.appendChild(s);
    });
  }
  async function fetchBytes(url, onFrac) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Model download failed (' + r.status + ')');
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !r.body.getReader || !total) { const b = await r.arrayBuffer(); if (onFrac) onFrac(1); return new Uint8Array(b); }
    const rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const c = await rd.read(); if (c.done) break; parts.push(c.value); got += c.value.length; if (onFrac) onFrac(got / total); }
    const out = new Uint8Array(got); let o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  /* tests can hand in a stand-in runtime */
  AI.useRuntime = function (ort) { AI._testOrt = ort; AI._sessP = null; AI._session = null; };

  AI.loadModel = function (status) {
    status = status || function () {};
    if (AI._sessP) return AI._sessP;
    const p = (async function () {
      status('Downloading the cut-out model (4.6 MB, once)', 0.02);
      const bytes = await fetchBytes(AI.MODEL_URL, function (f) { status('Downloading the cut-out model (4.6 MB, once)', 0.02 + f * 0.25); });
      if (AI._testOrt) { const s = await AI._testOrt.InferenceSession.create(bytes); return { ort: AI._testOrt, session: s }; }
      let lastErr = null;
      for (let i = 0; i < AI.ORT_BASES.length; i++) {
        const base = AI.ORT_BASES[i];
        try {
          status('Loading the on-device AI engine', 0.3 + i * 0.03);
          delete window.ort;
          await loadScript(base + 'ort.wasm.min.js');
          const ort = window.ort; if (!ort || !ort.InferenceSession) throw new Error('Runtime missing after load');
          ort.env.wasm.wasmPaths = base; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
          status('Starting the model', 0.5);
          const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
          return { ort: ort, session: session };
        } catch (e) { lastErr = e; console.warn('[chumi:ai] runtime from ' + base + ' failed:', e); }
      }
      throw lastErr || new Error('The AI engine could not be loaded.');
    })();
    AI._sessP = p;
    p.catch(function () { AI._sessP = null; });
    return p;
  };

  /* ------------------------------------------------------------ subject detection */
  /* canvas -> { alpha: Float32Array(W*H) 0..1, rgba, mode: 'ai' | 'plain' } */
  AI.detectSubject = async function (canvas, status, token) {
    status = status || function () {};
    const W = canvas.width, H = canvas.height;
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    /* the model wants an opaque picture: flatten any transparency onto white */
    let seeThrough = false; const flat = new Uint8ClampedArray(data);
    for (let i = 0; i < W * H; i++) {
      const a = data[i * 4 + 3];
      if (a < 255) { seeThrough = true; const k = a / 255; for (let c = 0; c < 3; c++) flat[i * 4 + c] = data[i * 4 + c] * k + 255 * (1 - k); flat[i * 4 + 3] = 255; }
    }
    let prob, pw = M.NET, ph = M.NET, mode = 'ai';
    try {
      const rt = await AI.loadModel(status);
      if (token && token.stop) throw cancelled();
      status('Finding the subject', 0.62); await tick();
      const input = M.toInput(flat, W, H);
      const tensor = new rt.ort.Tensor('float32', input, [1, 3, M.NET, M.NET]);
      const feeds = {}; feeds[rt.session.inputNames[0]] = tensor;
      const out = await rt.session.run(feeds);
      if (token && token.stop) throw cancelled();
      prob = M.prepareProb(out[rt.session.outputNames[0]].data);
    } catch (e) {
      if (e && e.cancelled) throw e;
      console.warn('[chumi:ai] model path failed, using the colour method:', e);
      status('The AI engine is not available here, trying the colour method', 0.62); await tick();
      const c = M.classicProb(flat, W, H); prob = c.data; pw = c.w; ph = c.h; mode = 'plain';
    }
    status('Refining the edges', 0.82); await tick();
    const alpha = M.refine(flat, W, H, prob, pw, ph, mode === 'plain' ? { lo: 0.4, hi: 0.6 } : {});
    if (seeThrough) for (let i = 0; i < alpha.length; i++) alpha[i] *= data[i * 4 + 3] / 255;
    return { alpha: alpha, rgba: data, mode: mode, W: W, H: H };
  };

  /* soft selection mask canvas (white, alpha = subject) from an alpha map */
  AI.alphaToMask = function (alpha, W, H) {
    const c = mk(W, H), x = c.getContext('2d', { willReadFrequently: true }), img = x.createImageData(W, H), d = img.data;
    for (let i = 0; i < alpha.length; i++) { const a = Math.round(alpha[i] * 255); d[i * 4] = 255; d[i * 4 + 1] = 255; d[i * 4 + 2] = 255; d[i * 4 + 3] = a; }
    x.putImageData(img, 0, 0); return c;
  };

  /* write the cut-out into a layer: pixels outside the subject become transparent, edges are colour-cleaned */
  AI.applyCutout = function (layer, det, o) {
    o = o || {};
    const W = det.W, H = det.H, rgba = det.rgba;
    const colors = (o.clean !== false && W * H <= 14e6) ? M.decontaminate(rgba, det.alpha, W, H) : rgba;
    const ctx = layer.canvas.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
    for (let i = 0; i < W * H; i++) {
      d[i * 4] = colors[i * 4]; d[i * 4 + 1] = colors[i * 4 + 1]; d[i * 4 + 2] = colors[i * 4 + 2];
      d[i * 4 + 3] = Math.round(det.alpha[i] * 255);
    }
    ctx.putImageData(img, 0, 0);
  };

  /* ------------------------------------------------------------ content-aware fill */
  function runInpaint(job, onProgress, token) {
    return new Promise(function (resolve, reject) {
      const inline = function () {
        setTimeout(function () {
          try { resolve(window.ChumiInpaint.inpaint(job.rgba, job.w, job.h, job.hole, job.opts, onProgress)); } catch (e) { reject(e); }
        }, 20);
      };
      let w = null;
      try { w = new Worker('js/inpaint-worker.js'); } catch (e) { w = null; }
      if (!w) { inline(); return; }
      let finished = false;
      if (token) token.cancel = function () { if (finished) return; finished = true; w.terminate(); reject(cancelled()); };
      w.onmessage = function (ev) {
        const m = ev.data;
        if (m.type === 'progress') onProgress(m.f);
        else if (m.type === 'done') { finished = true; w.terminate(); resolve(m.ok ? m.rgba : null); }
        else if (m.type === 'error') { finished = true; w.terminate(); reject(new Error(m.message)); }
      };
      w.onerror = function () { if (finished) return; finished = true; w.terminate(); inline(); };
      w.postMessage(job);
    });
  }

  /* Invents pixels for the white area of `mask` using the rest of `src`.
     src, mask: document sized canvases. bounds: { x, y, w, h } of the mask.
     Returns { x, y, canvas } where canvas holds only the new pixels, softly edged. */
  AI.fillRegion = async function (src, mask, bounds, o) {
    o = o || {};
    const DW = src.width, DH = src.height;
    const grow = o.grow != null ? o.grow : clamp(Math.round(Math.min(bounds.w, bounds.h) * 0.03), 2, 10);
    const margin = clamp(Math.round(Math.max(bounds.w, bounds.h) * 0.9), 48, 520);
    const cx0 = Math.max(0, bounds.x - margin - grow), cy0 = Math.max(0, bounds.y - margin - grow);
    const cx1 = Math.min(DW, bounds.x + bounds.w + margin + grow), cy1 = Math.min(DH, bounds.y + bounds.h + margin + grow);
    const cw = cx1 - cx0, ch = cy1 - cy0;
    const s = Math.min(1, (o.maxSide || 1280) / Math.max(cw, ch));
    const ww = Math.max(16, Math.round(cw * s)), wh = Math.max(16, Math.round(ch * s));

    const wsrc = mk(ww, wh), sx = wsrc.getContext('2d', { willReadFrequently: true });
    sx.imageSmoothingQuality = 'high'; sx.drawImage(src, cx0, cy0, cw, ch, 0, 0, ww, wh);
    const wmask = mk(ww, wh), mx = wmask.getContext('2d', { willReadFrequently: true });
    mx.imageSmoothingQuality = 'high'; mx.drawImage(mask, cx0, cy0, cw, ch, 0, 0, ww, wh);
    const sd = sx.getImageData(0, 0, ww, wh), md = mx.getImageData(0, 0, ww, wh).data;
    const hole0 = new Uint8Array(ww * wh);
    for (let i = 0; i < hole0.length; i++) if (md[i * 4 + 3] >= 100) hole0[i] = 1;
    const hole = window.ChumiInpaint.dilate(hole0, ww, wh, Math.max(1, Math.round(grow * s)));

    const prog = o.onProgress || function () {};
    const res = await runInpaint({ rgba: sd.data, w: ww, h: wh, hole: hole, opts: { quality: o.quality || 1, seed: 11 } }, prog, o.token);
    if (!res) throw new Error('There is not enough picture around that area to copy from. Try a smaller area.');

    const rc = mk(ww, wh); rc.getContext('2d').putImageData(new ImageData(res, ww, wh), 0, 0);
    let full = rc;
    if (ww !== cw || wh !== ch) { full = mk(cw, ch); const fx = full.getContext('2d'); fx.imageSmoothingQuality = 'high'; fx.drawImage(rc, 0, 0, cw, ch); }

    /* full-size soft edge: the hole, grown a little, then blurred */
    const fm = AI.softMask(mask, { x: cx0, y: cy0, w: cw, h: ch }, grow);

    const out = mk(cw, ch), ox = out.getContext('2d');
    ox.drawImage(full, 0, 0); ox.globalCompositeOperation = 'destination-in'; ox.drawImage(fm, 0, 0);
    return { x: cx0, y: cy0, canvas: out };
  };

  /* The part of `mask` inside `crop`, grown by `grow` px and blurred a little: a white canvas whose alpha is the soft edge
     new pixels are blended with. */
  AI.softMask = function (mask, crop, grow) {
    const cw = crop.w, ch = crop.h;
    const fm = mk(cw, ch), fmx = fm.getContext('2d', { willReadFrequently: true });
    fmx.drawImage(mask, crop.x, crop.y, cw, ch, 0, 0, cw, ch);
    const fd = fmx.getImageData(0, 0, cw, ch), fh = new Uint8Array(cw * ch);
    for (let i = 0; i < fh.length; i++) if (fd.data[i * 4 + 3] >= 100) fh[i] = 1;
    const fg = window.ChumiInpaint.dilate(fh, cw, ch, grow);
    for (let i = 0; i < fg.length; i++) { fd.data[i * 4] = 255; fd.data[i * 4 + 1] = 255; fd.data[i * 4 + 2] = 255; fd.data[i * 4 + 3] = fg[i] ? 255 : 0; }
    fmx.putImageData(fd, 0, 0);
    L.Filters.gaussian(fm, Math.max(0.8, grow * 0.35));
    return fm;
  };

  /* the layer's pixels as a document sized canvas */
  AI.bake = function (layer) {
    const c = mk(L.doc.w, L.doc.h); L.drawBitmap(c.getContext('2d'), layer); return c;
  };
  /* bounding box of the visible part of a mask canvas, or null when it is empty */
  AI.maskBounds = function (mask) {
    const W = mask.width, H = mask.height, d = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] >= 100) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  /* Blur everything but the subject. The sharp subject and the blurred picture end up on their own layers.
     The background is blurred without the subject's pixels, so no halo of subject colour spreads into it. */
  AI.blurBackground = function (layer, det, radius) {
    const d = L.doc, W = d.w, H = d.h;
    const bgOnly = mk(W, H), bx = bgOnly.getContext('2d');
    bx.drawImage(layer.canvas, 0, 0);
    bx.globalCompositeOperation = 'destination-out';
    bx.drawImage(AI.alphaToMask(det.alpha, W, H), 0, 0);
    L.Filters.gaussian(bgOnly, radius);
    /* the space the subject covered is filled from the blurred picture around it, so nothing see-through is left behind it */
    const blurred = AI.pushPull(bgOnly), kx = blurred.getContext('2d');
    kx.globalCompositeOperation = 'destination-in'; kx.drawImage(layer.canvas, 0, 0); /* keep the layer's own see-through areas */
    const base = layer.name.replace(/ \((subject|blurred)\)$/, '');
    const under = L.createLayer({ name: base + ' (blurred)', canvas: blurred, cx: W / 2, cy: H / 2, opacity: layer.opacity, blend: layer.blend });
    under.adj = Object.assign({}, layer.adj);
    L.own(layer); AI.applyCutout(layer, det, { clean: true }); layer.name = base + ' (subject)';
    const i = d.layers.indexOf(layer); d.layers.splice(i, 0, under);
    return under;
  };

  /* Fills every see-through pixel of `src` from what is around it, smoothly: shrink in steps until there are no gaps,
     then grow back up, each size showing through where the next size up has nothing. */
  AI.pushPull = function (src) {
    const levels = [src]; let c = src;
    while (Math.max(c.width, c.height) > 1) {
      const n = mk(Math.max(1, c.width >> 1), Math.max(1, c.height >> 1)), x = n.getContext('2d');
      x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height); levels.push(n); c = n;
    }
    let acc = levels[levels.length - 1];
    const ax = acc.getContext('2d', { willReadFrequently: true }), ad = ax.getImageData(0, 0, acc.width, acc.height);
    for (let i = 3; i < ad.data.length; i += 4) if (ad.data[i] > 0) ad.data[i] = 255;
    ax.putImageData(ad, 0, 0);
    for (let k = levels.length - 2; k >= 0; k--) {
      const up = mk(levels[k].width, levels[k].height), ux = up.getContext('2d');
      ux.imageSmoothingQuality = 'high'; ux.drawImage(acc, 0, 0, up.width, up.height); ux.drawImage(levels[k], 0, 0); acc = up;
    }
    return acc;
  };

  /* Write new pixels (from fillRegion) into a layer, or onto a fresh layer above it. */
  AI.placePatch = function (layer, patch, asNewLayer, name) {
    const d = L.doc;
    if (asNewLayer) {
      const c = mk(d.w, d.h); c.getContext('2d').drawImage(patch.canvas, patch.x, patch.y);
      const nl = L.createLayer({ name: name || 'Fill', canvas: c, cx: d.w / 2, cy: d.h / 2 });
      const i = d.layers.indexOf(layer); d.layers.splice(i + 1, 0, nl); d.activeId = nl.id;
      return nl;
    }
    L.own(layer); layer.canvas.getContext('2d').drawImage(patch.canvas, patch.x, patch.y);
    return layer;
  };
})();
