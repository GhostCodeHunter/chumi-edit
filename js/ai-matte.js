/* Chumi.edit matting helpers: everything between "the network says where the subject is" and "a clean cut-out".
   Pure typed-array code with no DOM, so it can be tested in Node and runs the same in the browser.

   toInput(rgba, W, H)                       -> Float32Array(3*320*320) network input (rembg style normalisation)
   prepareProb(raw)                          -> Float32Array 0..1 (min/max normalised network output)
   refine(rgba, W, H, prob, pw, ph, opts)    -> Float32Array(W*H) alpha 0..1, edges snapped to the picture with a guided filter
   decontaminate(rgba, alpha, W, H)          -> Uint8ClampedArray copy whose edge colours no longer carry the old background
   classicProb(rgba, W, H)                   -> {data,w,h} colour-distance guess for plain backgrounds (used when the model cannot load) */
(function (root) {
  'use strict';
  const NET = 320;

  /* ---------- resampling ---------- */
  function resizeRGB(rgba, W, H, dw, dh) {
    const sx = W / dw, sy = H / dh, tmp = new Float32Array(H * dw * 3), out = new Float32Array(dw * dh * 3);
    for (let x = 0; x < dw; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx, i0 = Math.floor(x0), i1 = Math.min(W, Math.ceil(x1));
      for (let y = 0; y < H; y++) {
        let r = 0, g = 0, b = 0, ws = 0;
        for (let i = i0; i < i1; i++) {
          const w = Math.min(i + 1, x1) - Math.max(i, x0); if (w <= 0) continue;
          const o = (y * W + i) * 4; r += rgba[o] * w; g += rgba[o + 1] * w; b += rgba[o + 2] * w; ws += w;
        }
        const t = (y * dw + x) * 3; tmp[t] = r / ws; tmp[t + 1] = g / ws; tmp[t + 2] = b / ws;
      }
    }
    for (let y = 0; y < dh; y++) {
      const y0 = y * sy, y1 = (y + 1) * sy, j0 = Math.floor(y0), j1 = Math.min(H, Math.ceil(y1));
      for (let x = 0; x < dw; x++) {
        let r = 0, g = 0, b = 0, ws = 0;
        for (let j = j0; j < j1; j++) {
          const w = Math.min(j + 1, y1) - Math.max(j, y0); if (w <= 0) continue;
          const t = (j * dw + x) * 3; r += tmp[t] * w; g += tmp[t + 1] * w; b += tmp[t + 2] * w; ws += w;
        }
        const o = (y * dw + x) * 3; out[o] = r / ws; out[o + 1] = g / ws; out[o + 2] = b / ws;
      }
    }
    return out;
  }
  function resizeF(src, sw, sh, dw, dh) {
    if (sw === dw && sh === dh) return src;
    const out = new Float32Array(dw * dh), kx = sw / dw, ky = sh / dh;
    for (let y = 0; y < dh; y++) {
      let fy = (y + 0.5) * ky - 0.5; fy = fy < 0 ? 0 : fy > sh - 1 ? sh - 1 : fy;
      const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < dw; x++) {
        let fx = (x + 0.5) * kx - 0.5; fx = fx < 0 ? 0 : fx > sw - 1 ? sw - 1 : fx;
        const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
        const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
        out[y * dw + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      }
    }
    return out;
  }

  /* ---------- network input / output ---------- */
  function toInput(rgba, W, H) {
    const px = resizeRGB(rgba, W, H, NET, NET), n = NET * NET, t = new Float32Array(3 * n);
    let mx = 1e-6; for (let i = 0; i < px.length; i++) if (px[i] > mx) mx = px[i];
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) t[c * n + i] = (px[i * 3 + c] / mx - mean[c]) / std[c];
    return t;
  }
  function prepareProb(raw) {
    let mn = 1e9, mx = -1e9; for (let i = 0; i < raw.length; i++) { if (raw[i] < mn) mn = raw[i]; if (raw[i] > mx) mx = raw[i]; }
    const out = new Float32Array(raw.length), d = mx - mn || 1;
    for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - mn) / d;
    return out;
  }

  /* ---------- guided filter ---------- */
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), pre = new Float64Array(W + 1);
    for (let y = 0; y < H; y++) {
      const o = y * W; pre[0] = 0;
      for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + src[o + x];
      for (let x = 0; x < W; x++) { const a = Math.max(0, x - r), b = Math.min(W - 1, x + r); tmp[o + x] = (pre[b + 1] - pre[a]) / (b - a + 1); }
    }
    const col = new Float64Array(W);
    for (let y = -r; y < H; y++) {
      const add = y + r, rem = y - r - 1;
      if (add < H) { const o = add * W; for (let x = 0; x < W; x++) col[x] += tmp[o + x]; }
      if (rem >= 0) { const o = rem * W; for (let x = 0; x < W; x++) col[x] -= tmp[o + x]; }
      if (y >= 0) {
        const a = Math.max(0, y - r), b = Math.min(H - 1, y + r), inv = 1 / (b - a + 1), o = y * W;
        for (let x = 0; x < W; x++) out[o + x] = col[x] * inv;
      }
    }
    return out;
  }
  function guided(I, p, W, H, r, eps) {
    const n = W * H, Ip = new Float32Array(n), II = new Float32Array(n);
    for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
    const mI = boxBlur(I, W, H, r), mp = boxBlur(p, W, H, r), mIp = boxBlur(Ip, W, H, r), mII = boxBlur(II, W, H, r);
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i]; a[i] = c / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
    const ma = boxBlur(a, W, H, r), mb = boxBlur(b, W, H, r), q = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = ma[i] * I[i] + mb[i]; q[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
    return q;
  }
  function smooth(lo, hi, v) { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); }

  /* prob is the network's low resolution map; returns alpha at the picture's own size */
  function refine(rgba, W, H, prob, pw, ph, o) {
    o = o || {};
    const work = o.work || 1536, k = Math.min(1, work / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const px = k < 1 ? resizeRGB(rgba, W, H, w, h) : null;
    const I = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      I[i] = px ? (0.299 * px[i * 3] + 0.587 * px[i * 3 + 1] + 0.114 * px[i * 3 + 2]) / 255 : (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
    }
    const p = resizeF(prob, pw, ph, w, h);
    const r = Math.max(3, Math.round(Math.max(w, h) * (o.radius || 0.011)));
    const q = o.guide === false ? p : guided(I, p, w, h, r, o.eps || 0.0015);
    const lo = o.lo == null ? 0.28 : o.lo, hi = o.hi == null ? 0.72 : o.hi;
    const a = new Float32Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = smooth(lo, hi, q[i]);
    return k < 1 ? resizeF(a, w, h, W, H) : a;
  }

  /* ---------- colour decontamination at the cut edge ---------- */
  function decontaminate(rgba, alpha, W, H, radius) {
    const n = W * H, r = radius || Math.max(2, Math.round(Math.max(W, H) / 450));
    const out = new Uint8ClampedArray(rgba), wgt = new Float32Array(n), ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    let edge = 0;
    for (let i = 0; i < n; i++) {
      const a = alpha[i];
      if (a > 0.96) { wgt[i] = 1; ch[0][i] = rgba[i * 4]; ch[1][i] = rgba[i * 4 + 1]; ch[2][i] = rgba[i * 4 + 2]; }
      else if (a > 0.003) edge++;
    }
    if (!edge) return out;
    const bw = boxBlur(boxBlur(wgt, W, H, r), W, H, r);
    const bc = ch.map(function (c) { return boxBlur(boxBlur(c, W, H, r), W, H, r); });
    for (let i = 0; i < n; i++) {
      const a = alpha[i]; if (a > 0.96 || a <= 0.003 || bw[i] < 0.02) continue;
      const t = smooth(0.35, 0.97, a);
      for (let c = 0; c < 3; c++) { const f = bc[c][i] / bw[i]; out[i * 4 + c] = f * (1 - t) + rgba[i * 4 + c] * t; }
    }
    return out;
  }

  /* ---------- fallback: plain-background guess ---------- */
  function classicProb(rgba, W, H) {
    const k = Math.min(1, 256 / Math.max(W, H)), w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
    const px = resizeRGB(rgba, W, H, w, h), n = w * h;
    /* background colours from the picture's border, two clusters so a gradient backdrop survives */
    const border = [];
    for (let x = 0; x < w; x++) { border.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { border.push(y * w, y * w + w - 1); }
    let c1 = border[0], c2 = border[0], far = -1;
    for (let b = 0; b < border.length; b++) { const i = border[b]; let d = 0; for (let c = 0; c < 3; c++) d += Math.pow(px[i * 3 + c] - px[c1 * 3 + c], 2); if (d > far) { far = d; c2 = i; } }
    let m1 = [px[c1 * 3], px[c1 * 3 + 1], px[c1 * 3 + 2]], m2 = [px[c2 * 3], px[c2 * 3 + 1], px[c2 * 3 + 2]];
    for (let it = 0; it < 6; it++) {
      const s1 = [0, 0, 0], s2 = [0, 0, 0]; let n1 = 0, n2 = 0;
      for (let b = 0; b < border.length; b++) {
        const i = border[b]; let d1 = 0, d2 = 0;
        for (let c = 0; c < 3; c++) { d1 += Math.pow(px[i * 3 + c] - m1[c], 2); d2 += Math.pow(px[i * 3 + c] - m2[c], 2); }
        if (d1 <= d2) { n1++; for (let c = 0; c < 3; c++) s1[c] += px[i * 3 + c]; } else { n2++; for (let c = 0; c < 3; c++) s2[c] += px[i * 3 + c]; }
      }
      if (n1) m1 = s1.map(function (v) { return v / n1; }); if (n2) m2 = s2.map(function (v) { return v / n2; });
    }
    const dist = new Float32Array(n), hist = new Float64Array(256); let dmax = 1;
    for (let i = 0; i < n; i++) {
      let d1 = 0, d2 = 0; for (let c = 0; c < 3; c++) { d1 += Math.pow(px[i * 3 + c] - m1[c], 2); d2 += Math.pow(px[i * 3 + c] - m2[c], 2); }
      dist[i] = Math.sqrt(Math.min(d1, d2)); if (dist[i] > dmax) dmax = dist[i];
    }
    for (let i = 0; i < n; i++) hist[Math.min(255, Math.floor(dist[i] / dmax * 255))]++;
    /* Otsu threshold */
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let wb = 0, sb = 0, best = 0, thr = 40;
    for (let t = 0; t < 256; t++) { wb += hist[t]; if (!wb) continue; const wf = n - wb; if (!wf) break; sb += t * hist[t]; const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf); if (v > best) { best = v; thr = t; } }
    const cut = Math.max(thr / 255 * dmax, 14), fg = new Uint8Array(n);
    for (let i = 0; i < n; i++) fg[i] = dist[i] > cut ? 1 : 0;
    /* background = what is connected to the border; everything else (including holes) is subject */
    const bg = new Uint8Array(n), stack = [];
    for (let b = 0; b < border.length; b++) { const i = border[b]; if (!fg[i] && !bg[i]) { bg[i] = 1; stack.push(i); } }
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      if (x > 0 && !fg[i - 1] && !bg[i - 1]) { bg[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !fg[i + 1] && !bg[i + 1]) { bg[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !fg[i - w] && !bg[i - w]) { bg[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !fg[i + w] && !bg[i + w]) { bg[i + w] = 1; stack.push(i + w); }
    }
    const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = bg[i] ? 0 : 1;
    return { data: boxBlur(m, w, h, 1), w: w, h: h };
  }

  root.ChumiMatte = { NET: NET, toInput: toInput, prepareProb: prepareProb, refine: refine, decontaminate: decontaminate, classicProb: classicProb, resizeRGB: resizeRGB, resizeF: resizeF, boxBlur: boxBlur };
})(typeof self !== 'undefined' ? self : this);
