/* Chumi.edit filters: destructive effects that run on a canvas in place.
   Each filter: { id, label, group, params: [{id,label,min,max,value,step,unit|type:'check'}], run(canvas, p, info) }
   info = { fullW, fullH, ox, oy } tells position-dependent filters (vignette) where this canvas sits in the layer. */
(function () {
  'use strict';
  const L = (window.Chumi = window.Chumi || {});

  function getData(c) { return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); }
  function putData(c, img) { c.getContext('2d').putImageData(img, 0, 0); }
  function clone(c) { const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; o.getContext('2d').drawImage(c, 0, 0); return o; }

  /* ---- blur: three box passes approximate a gaussian ---- */
  function boxPass(src, dst, w, h, r, horizontal) {
    const n = horizontal ? w : h, lines = horizontal ? h : w;
    const stride = horizontal ? 4 : w * 4, lineStride = horizontal ? w * 4 : 4;
    const div = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride;
      for (let c = 0; c < 4; c++) {
        const first = src[base + c];
        let sum = first * r;
        for (let k = 0; k <= r; k++) sum += src[base + Math.min(k, n - 1) * stride + c];
        for (let i = 0; i < n; i++) {
          dst[base + i * stride + c] = sum / div;
          const add = src[base + Math.min(i + r + 1, n - 1) * stride + c];
          const rem = src[base + Math.max(i - r, 0) * stride + c];
          sum += add - rem;
        }
      }
    }
  }
  function boxSizes(sigma, n) {
    const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
    let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal), sizes = [];
    for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }
  function gaussian(canvas, radius) {
    if (radius <= 0.3) return;
    const w = canvas.width, h = canvas.height;
    const img = getData(canvas), d = img.data;
    // premultiply so transparent edges do not bleed dark fringes
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; d[i] *= a; d[i + 1] *= a; d[i + 2] *= a; }
    let a = d, b = new Uint8ClampedArray(d.length);
    const sizes = boxSizes(radius, 3);
    for (let s = 0; s < 3; s++) {
      const r = (sizes[s] - 1) / 2;
      boxPass(a, b, w, h, r, true);
      boxPass(b, a, w, h, r, false);
    }
    for (let i = 0; i < d.length; i += 4) {
      const al = d[i + 3];
      if (al > 0) { const k = 255 / al; d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k); }
    }
    putData(canvas, img);
  }

  function convolve(canvas, k, div, bias) {
    const w = canvas.width, h = canvas.height;
    const img = getData(canvas), s = img.data, out = new Uint8ClampedArray(s.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, ki = 0;
        for (let j = -1; j <= 1; j++) {
          const yy = Math.min(h - 1, Math.max(0, y + j));
          for (let i = -1; i <= 1; i++) {
            const xx = Math.min(w - 1, Math.max(0, x + i));
            const p = (yy * w + xx) * 4, kv = k[ki++];
            r += s[p] * kv; g += s[p + 1] * kv; b += s[p + 2] * kv;
          }
        }
        const o = (y * w + x) * 4;
        out[o] = r / div + bias; out[o + 1] = g / div + bias; out[o + 2] = b / div + bias; out[o + 3] = s[o + 3];
      }
    }
    img.data.set(out);
    putData(canvas, img);
  }

  const F = [];
  function add(f) { F.push(f); }

  add({
    id: 'blur', label: 'Gaussian blur', group: 'Blur',
    params: [{ id: 'radius', label: 'Radius', min: 0, max: 80, value: 8, step: 0.5, unit: 'px' }],
    run: function (c, p) { gaussian(c, p.radius); }
  });
  add({
    id: 'motion', label: 'Motion blur', group: 'Blur',
    params: [
      { id: 'distance', label: 'Distance', min: 1, max: 150, value: 30, step: 1, unit: 'px' },
      { id: 'angle', label: 'Angle', min: -90, max: 90, value: 0, step: 1, unit: '°' }
    ],
    run: function (c, p) {
      const src = clone(c), ctx = c.getContext('2d'), n = Math.min(40, Math.max(2, Math.round(p.distance / 2)));
      const a = p.angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
      ctx.clearRect(0, 0, c.width, c.height);
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * p.distance;
        ctx.globalAlpha = 1 / (i + 1);
        ctx.drawImage(src, dx * t, dy * t);
      }
      ctx.globalAlpha = 1;
    }
  });
  add({
    id: 'sharpen', label: 'Sharpen', group: 'Sharpen',
    params: [
      { id: 'amount', label: 'Amount', min: 0, max: 300, value: 90, step: 1, unit: '%' },
      { id: 'radius', label: 'Radius', min: 0.5, max: 6, value: 1.5, step: 0.1, unit: 'px' }
    ],
    run: function (c, p) {
      const blur = clone(c); gaussian(blur, p.radius);
      const a = getData(c), b = getData(blur).data, d = a.data, k = p.amount / 100;
      for (let i = 0; i < d.length; i += 4) {
        d[i] += (d[i] - b[i]) * k; d[i + 1] += (d[i + 1] - b[i + 1]) * k; d[i + 2] += (d[i + 2] - b[i + 2]) * k;
      }
      putData(c, a);
    }
  });
  add({
    id: 'noise', label: 'Add noise', group: 'Texture',
    params: [
      { id: 'amount', label: 'Amount', min: 0, max: 100, value: 20, step: 1, unit: '%' },
      { id: 'mono', label: 'Monochrome', type: 'check', value: true }
    ],
    run: function (c, p) {
      const img = getData(c), d = img.data, k = p.amount * 1.6;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        if (p.mono) { const n = (Math.random() - 0.5) * k; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
        else { d[i] += (Math.random() - 0.5) * k; d[i + 1] += (Math.random() - 0.5) * k; d[i + 2] += (Math.random() - 0.5) * k; }
      }
      putData(c, img);
    }
  });
  add({
    id: 'pixelate', label: 'Pixelate', group: 'Stylize',
    params: [{ id: 'size', label: 'Cell size', min: 2, max: 120, value: 12, step: 1, unit: 'px' }],
    run: function (c, p) {
      const s = Math.max(2, Math.round(p.size)), w = c.width, h = c.height;
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.ceil(w / s)); small.height = Math.max(1, Math.ceil(h / s));
      const sctx = small.getContext('2d'); sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(c, 0, 0, small.width, small.height);
      const ctx = c.getContext('2d'); ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, small.width * s, small.height * s);
      ctx.imageSmoothingEnabled = true;
    }
  });
  add({
    id: 'vignette', label: 'Vignette', group: 'Stylize',
    params: [
      { id: 'amount', label: 'Amount', min: -100, max: 100, value: 55, step: 1, unit: '%' },
      { id: 'size', label: 'Size', min: 10, max: 100, value: 55, step: 1, unit: '%' },
      { id: 'softness', label: 'Softness', min: 0, max: 100, value: 70, step: 1, unit: '%' }
    ],
    run: function (c, p, info) {
      info = info || { fullW: c.width, fullH: c.height, ox: 0, oy: 0 };
      const ctx = c.getContext('2d');
      const cx = info.fullW / 2 - info.ox, cy = info.fullH / 2 - info.oy;
      const rad = Math.hypot(info.fullW, info.fullH) / 2;
      const inner = rad * (p.size / 100) * (1 - p.softness / 100 * 0.9);
      const outer = rad * (0.45 + p.size / 100 * 0.75);
      const g = ctx.createRadialGradient(cx, cy, Math.min(inner, outer - 1), cx, cy, outer);
      const col = p.amount >= 0 ? '0,0,0' : '255,255,255', a = Math.abs(p.amount) / 100;
      g.addColorStop(0, 'rgba(' + col + ',0)'); g.addColorStop(1, 'rgba(' + col + ',' + a + ')');
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height); ctx.restore();
    }
  });
  add({
    id: 'glow', label: 'Glow', group: 'Stylize',
    params: [
      { id: 'radius', label: 'Radius', min: 2, max: 80, value: 20, step: 1, unit: 'px' },
      { id: 'intensity', label: 'Intensity', min: 0, max: 100, value: 60, step: 1, unit: '%' },
      { id: 'threshold', label: 'Threshold', min: 0, max: 255, value: 150, step: 1 }
    ],
    run: function (c, p) {
      const bright = clone(c), img = getData(bright), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
        if (l < p.threshold) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; }
      }
      putData(bright, img);
      gaussian(bright, p.radius);
      const ctx = c.getContext('2d');
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = p.intensity / 100 * 1.4; ctx.drawImage(bright, 0, 0); ctx.restore();
    }
  });
  add({
    id: 'rgbsplit', label: 'RGB split', group: 'Stylize',
    params: [
      { id: 'amount', label: 'Offset', min: 0, max: 60, value: 8, step: 1, unit: 'px' },
      { id: 'angle', label: 'Angle', min: 0, max: 360, value: 0, step: 1, unit: '°' }
    ],
    run: function (c, p) {
      const img = getData(c), s = img.data, w = c.width, h = c.height, out = new Uint8ClampedArray(s.length);
      const a = p.angle * Math.PI / 180, dx = Math.round(Math.cos(a) * p.amount), dy = Math.round(Math.sin(a) * p.amount);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const rx = Math.min(w - 1, Math.max(0, x - dx)), ry = Math.min(h - 1, Math.max(0, y - dy));
          const bx = Math.min(w - 1, Math.max(0, x + dx)), by = Math.min(h - 1, Math.max(0, y + dy));
          out[o] = s[(ry * w + rx) * 4]; out[o + 1] = s[o + 1]; out[o + 2] = s[(by * w + bx) * 4 + 2];
          out[o + 3] = Math.max(s[o + 3], s[(ry * w + rx) * 4 + 3], s[(by * w + bx) * 4 + 3]);
        }
      }
      img.data.set(out); putData(c, img);
    }
  });
  add({
    id: 'emboss', label: 'Emboss', group: 'Stylize',
    params: [{ id: 'strength', label: 'Strength', min: 1, max: 10, value: 3, step: 0.5 }],
    run: function (c, p) { const s = p.strength; convolve(c, [-2 * s / 3, -s / 3, 0, -s / 3, 1, s / 3, 0, s / 3, 2 * s / 3], 1, 0); }
  });
  add({
    id: 'edges', label: 'Find edges', group: 'Stylize',
    params: [{ id: 'strength', label: 'Strength', min: 1, max: 10, value: 3, step: 0.5 }],
    run: function (c, p) {
      const w = c.width, h = c.height, img = getData(c), s = img.data;
      const lum = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) lum[i] = s[i * 4] * 0.2126 + s[i * 4 + 1] * 0.7152 + s[i * 4 + 2] * 0.0722;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
        const gx = -lum[ym * w + xm] - 2 * lum[y * w + xm] - lum[yp * w + xm] + lum[ym * w + xp] + 2 * lum[y * w + xp] + lum[yp * w + xp];
        const gy = -lum[ym * w + xm] - 2 * lum[ym * w + x] - lum[ym * w + xp] + lum[yp * w + xm] + 2 * lum[yp * w + x] + lum[yp * w + xp];
        const v = 255 - Math.min(255, Math.hypot(gx, gy) * p.strength * 0.5), o = (y * w + x) * 4;
        s[o] = s[o + 1] = s[o + 2] = v;
      }
      putData(c, img);
    }
  });
  add({
    id: 'posterize', label: 'Posterize', group: 'Color',
    params: [{ id: 'levels', label: 'Levels', min: 2, max: 16, value: 5, step: 1 }],
    run: function (c, p) {
      const img = getData(c), d = img.data, n = p.levels - 1;
      for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / 255 * n) / n * 255; d[i + 1] = Math.round(d[i + 1] / 255 * n) / n * 255; d[i + 2] = Math.round(d[i + 2] / 255 * n) / n * 255; }
      putData(c, img);
    }
  });
  add({
    id: 'threshold', label: 'Threshold', group: 'Color',
    params: [{ id: 'level', label: 'Level', min: 0, max: 255, value: 128, step: 1 }],
    run: function (c, p) {
      const img = getData(c), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722 >= p.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
      putData(c, img);
    }
  });
  add({
    id: 'invert', label: 'Invert colors', group: 'Color', params: [],
    run: function (c) { const img = getData(c), d = img.data; for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } putData(c, img); }
  });
  add({
    id: 'desaturate', label: 'Black and white', group: 'Color', params: [],
    run: function (c) { const img = getData(c), d = img.data; for (let i = 0; i < d.length; i += 4) { const v = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; d[i] = d[i + 1] = d[i + 2] = v; } putData(c, img); }
  });

  /* ---- shared pixel helpers used by the tools ---- */
  function floodMask(img, sx, sy, tol, contiguous) {
    const w = img.width, h = img.height, d = img.data;
    const mask = new Uint8Array(w * h);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
    const si = (sy * w + sx) * 4, tr = d[si], tg = d[si + 1], tb = d[si + 2], ta = d[si + 3];
    function match(i) {
      return Math.abs(d[i] - tr) <= tol && Math.abs(d[i + 1] - tg) <= tol && Math.abs(d[i + 2] - tb) <= tol && Math.abs(d[i + 3] - ta) <= tol;
    }
    if (!contiguous) {
      for (let i = 0, p = 0; i < w * h; i++, p += 4) if (match(p)) mask[i] = 255;
      return mask;
    }
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop(), x0 = stack.pop();
      let x = x0;
      while (x >= 0 && !mask[y * w + x] && match((y * w + x) * 4)) x--;
      x++;
      let up = false, down = false;
      while (x < w && !mask[y * w + x] && match((y * w + x) * 4)) {
        mask[y * w + x] = 255;
        if (y > 0) {
          const m = !mask[(y - 1) * w + x] && match(((y - 1) * w + x) * 4);
          if (m && !up) { stack.push(x, y - 1); up = true; } else if (!m) up = false;
        }
        if (y < h - 1) {
          const m = !mask[(y + 1) * w + x] && match(((y + 1) * w + x) * 4);
          if (m && !down) { stack.push(x, y + 1); down = true; } else if (!m) down = false;
        }
        x++;
      }
    }
    return mask;
  }

  L.Filters = { list: F, byId: function (id) { return F.filter(function (f) { return f.id === id; })[0]; }, gaussian: gaussian, floodMask: floodMask, clone: clone };
})();
