/* Chumi.edit colour adjustments. One affine colour matrix per layer, applied in a single pass.
   Shared by the editor and by the live slider on the landing page. */
(function () {
  'use strict';
  const L = (window.Chumi = window.Chumi || {});

  const KEYS = ['exposure', 'contrast', 'saturation', 'hue', 'temperature', 'tint', 'grayscale', 'sepia', 'invert'];

  function defaults() {
    return { exposure: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, tint: 0, grayscale: 0, sepia: 0, invert: 0 };
  }
  function isNeutral(a) {
    if (!a) return true;
    for (let i = 0; i < KEYS.length; i++) if (a[KEYS[i]]) return false;
    return true;
  }
  function key(a) {
    let s = '';
    for (let i = 0; i < KEYS.length; i++) s += (a[KEYS[i]] || 0) + ',';
    return s;
  }

  function mul(A, B) {
    const R = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) R[i * 4 + j] += A[i * 4 + k] * B[k * 4 + j];
    return R;
  }

  function matrix(a) {
    let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const apply = function (T) { M = mul(T, M); };
    const e = Math.pow(2, (a.exposure || 0) / 100 * 1.3);
    const t = (a.temperature || 0) / 100, ti = (a.tint || 0) / 100;
    apply([e * (1 + t * 0.22), 0, 0, 0, 0, e * (1 - ti * 0.16), 0, 0, 0, 0, e * (1 - t * 0.22), 0, 0, 0, 0, 1]);
    if (a.contrast) {
      const C = a.contrast * 2.55 * 0.9;
      const f = (259 * (C + 255)) / (255 * (259 - C)), off = 128 * (1 - f);
      apply([f, 0, 0, off, 0, f, 0, off, 0, 0, f, off, 0, 0, 0, 1]);
    }
    const lr = 0.2126, lg = 0.7152, lb = 0.0722;
    if (a.saturation) {
      const s = 1 + a.saturation / 100;
      apply([lr * (1 - s) + s, lg * (1 - s), lb * (1 - s), 0, lr * (1 - s), lg * (1 - s) + s, lb * (1 - s), 0, lr * (1 - s), lg * (1 - s), lb * (1 - s) + s, 0, 0, 0, 0, 1]);
    }
    if (a.hue) {
      const r = a.hue * Math.PI / 180, c = Math.cos(r), n = Math.sin(r);
      apply([
        0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928, 0,
        0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283, 0,
        0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072, 0,
        0, 0, 0, 1]);
    }
    if (a.grayscale) {
      const g = a.grayscale / 100, gs = 1 - g;
      apply([lr * g + gs, lg * g, lb * g, 0, lr * g, lg * g + gs, lb * g, 0, lr * g, lg * g, lb * g + gs, 0, 0, 0, 0, 1]);
    }
    if (a.sepia) {
      const s = a.sepia / 100, k = 1 - s;
      apply([0.393 * s + k, 0.769 * s, 0.189 * s, 0, 0.349 * s, 0.686 * s + k, 0.168 * s, 0, 0.272 * s, 0.534 * s, 0.131 * s + k, 0, 0, 0, 0, 1]);
    }
    if (a.invert) {
      const iv = a.invert / 100, sc = 1 - 2 * iv;
      apply([sc, 0, 0, 255 * iv, 0, sc, 0, 255 * iv, 0, 0, sc, 255 * iv, 0, 0, 0, 1]);
    }
    return M;
  }

  function applyToImageData(img, a) {
    const M = matrix(a), d = img.data;
    const m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7], m8 = M[8], m9 = M[9], m10 = M[10], m11 = M[11];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = m0 * r + m1 * g + m2 * b + m3;
      d[i + 1] = m4 * r + m5 * g + m6 * b + m7;
      d[i + 2] = m8 * r + m9 * g + m10 * b + m11;
    }
  }

  /* Returns a new canvas with the adjustment applied (src is untouched). */
  function render(src, a, dst) {
    const w = src.width, h = src.height;
    const out = dst || document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    applyToImageData(img, a);
    ctx.putImageData(img, 0, 0);
    return out;
  }

  function histogram(canvas, size) {
    size = size || 192;
    const s = Math.min(1, size / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * s)), h = Math.max(1, Math.round(canvas.height * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
      l[Math.round(d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722)]++;
    }
    return { r: r, g: g, b: b, l: l };
  }

  /* Heuristic "Auto": stretch the tonal range and nudge saturation. */
  function auto(canvas) {
    const hs = histogram(canvas, 128).l;
    let total = 0, mean = 0;
    for (let i = 0; i < 256; i++) { total += hs[i]; mean += hs[i] * i; }
    if (!total) return defaults();
    mean /= total;
    let acc = 0, p1 = 0, p99 = 255;
    for (let i = 0; i < 256; i++) { acc += hs[i]; if (acc >= total * 0.01) { p1 = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hs[i]; if (acc >= total * 0.01) { p99 = i; break; } }
    const spread = Math.max(40, p99 - p1);
    const a = defaults();
    a.contrast = Math.max(0, Math.min(55, Math.round((255 / spread - 1) * 45)));
    a.exposure = Math.max(-45, Math.min(45, Math.round(Math.log2(122 / Math.max(20, mean)) * 100 / 1.3 * 0.55)));
    a.saturation = 12;
    return a;
  }

  const presets = [
    { id: 'original', name: 'Original', adj: {} },
    { id: 'vivid', name: 'Vivid', adj: { contrast: 14, saturation: 38, exposure: 4 } },
    { id: 'warm', name: 'Warm', adj: { temperature: 34, saturation: 10, contrast: 6, tint: 4 } },
    { id: 'cool', name: 'Cool', adj: { temperature: -32, saturation: 6, contrast: 6 } },
    { id: 'noir', name: 'Noir', adj: { grayscale: 100, contrast: 38, exposure: -6 } },
    { id: 'vintage', name: 'Vintage', adj: { sepia: 45, contrast: -12, saturation: -14, temperature: 14, exposure: 4 } },
    { id: 'fade', name: 'Fade', adj: { contrast: -26, saturation: -22, exposure: 12 } },
    { id: 'drama', name: 'Drama', adj: { contrast: 42, saturation: -10, exposure: -10, temperature: -6 } },
    { id: 'bloom', name: 'Bloom', adj: { exposure: 14, saturation: 18, temperature: 16, contrast: -8, tint: 8 } },
    { id: 'invert', name: 'Negative', adj: { invert: 100 } }
  ];

  L.Adjust = { KEYS: KEYS, defaults: defaults, isNeutral: isNeutral, key: key, matrix: matrix, applyToImageData: applyToImageData, render: render, histogram: histogram, auto: auto, presets: presets };
})();
