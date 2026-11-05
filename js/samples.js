/* Chumi.edit sample photographs.
   Drawn in code (canvas 2D) so the editor can offer practice images with no network access,
   and so the landing page stills can be rendered from the very same functions.
   Samples.render(name, width, height) -> HTMLCanvasElement */
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(rnd) {
    const N = 1024, v = new Float32Array(N);
    for (let i = 0; i < N; i++) v[i] = rnd();
    const sm = (t) => t * t * (3 - 2 * t);
    function n1(x) {
      const i = Math.floor(x), f = x - i;
      const a = v[((i % N) + N) % N], b = v[(((i + 1) % N) + N) % N];
      return a + (b - a) * sm(f);
    }
    function fbm(x, oct, gain) {
      oct = oct || 4; gain = gain || 0.5;
      let s = 0, a = 1, f = 1, norm = 0;
      for (let o = 0; o < oct; o++) { s += n1(x * f + o * 17.3) * a; norm += a; a *= gain; f *= 2.03; }
      return s / norm;
    }
    return { n1: n1, fbm: fbm };
  }

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    if (typeof a === 'string') a = hexToRgb(a);
    if (typeof b === 'string') b = hexToRgb(b);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function css(c, a) {
    if (typeof c === 'string') c = hexToRgb(c);
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')';
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function vgrad(ctx, y0, y1, stops) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }
  function glow(ctx, x, y, r, stops) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function soft(ctx, x, y, rx, ry, rgb, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function vignette(ctx, w, h, strength, tint) {
    const d = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h * 0.48, d * 0.28, w / 2, h * 0.5, d * 1.02);
    g.addColorStop(0, 'rgba(' + tint + ',0)');
    g.addColorStop(1, 'rgba(' + tint + ',' + strength + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function grain(ctx, w, h, amount, rnd) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() + rnd() - 1) * amount;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Mirror the top part of the picture into water, strip by strip, with ripples. */
  function reflect(ctx, w, h, hz, rnd, strength, dark) {
    const src = newCanvas(w, Math.ceil(hz));
    src.getContext('2d').drawImage(ctx.canvas, 0, 0, w, hz, 0, 0, w, hz);
    const depth = h - hz;
    const step = Math.max(2, Math.round(h / 520));
    for (let y = 0; y < depth; y += step) {
      const t = y / depth;
      const sy = hz - 1 - y * (hz / depth) * 0.78;
      if (sy < 0) break;
      const off = Math.sin(y * 0.55 + rnd() * 0.8) * strength * (0.25 + t * 1.4) + (rnd() - 0.5) * strength * 0.5 * t;
      ctx.globalAlpha = clamp(0.92 - t * 0.35, 0.4, 1);
      ctx.drawImage(src, 0, sy, w, step * (hz / depth) * 0.78 + 1, off, hz + y, w, step + 1);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = vgrad(ctx, hz, h, [[0, 'rgba(' + dark + ',0.18)'], [1, 'rgba(' + dark + ',0.62)']]);
    ctx.fillRect(0, hz, w, h - hz);
  }

  function pine(ctx, x, base, hgt, col) {
    const tiers = 6, tw = hgt * 0.17;
    ctx.fillStyle = col;
    ctx.fillRect(x - hgt * 0.012, base - hgt * 0.1, hgt * 0.024, hgt * 0.1);
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const top = base - hgt * (0.1 + 0.9 * (1 - 0) * ((i + 1) / tiers)) ;
      const y1 = base - hgt * (0.06 + 0.94 * (i / tiers));
      const y0 = base - hgt * (0.16 + 0.84 * ((i + 1) / tiers));
      const half = tw * (1 - t * 0.78) * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y0 - hgt * 0.06);
      ctx.lineTo(x + half, y1);
      ctx.lineTo(x - half, y1);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ---------------------------------------------------------------- scenes */

  function dusk(ctx, w, h, rnd, N) {
    const hz = h * 0.6;
    ctx.fillStyle = vgrad(ctx, 0, hz, [[0, '#16254a'], [0.35, '#4b4f86'], [0.62, '#c0708a'], [0.84, '#f2a06e'], [1, '#ffd9a0']]);
    ctx.fillRect(0, 0, w, hz + 2);
    const sx = w * 0.66, sy = hz - h * 0.03;
    // stars
    for (let i = 0; i < 90; i++) {
      const y = rnd() * hz * 0.45;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + rnd() * 0.5) + ')';
      ctx.fillRect(rnd() * w, y, Math.max(1, w / 1600), Math.max(1, w / 1600));
    }
    glow(ctx, sx, sy, w * 0.6, [[0, 'rgba(255,238,195,0.95)'], [0.1, 'rgba(255,204,140,0.7)'], [0.38, 'rgba(255,142,104,0.26)'], [1, 'rgba(255,120,100,0)']]);
    for (let i = 0; i < 34; i++) {
      const x = rnd() * w, y = hz * (0.1 + rnd() * 0.7);
      const near = clamp(1 - Math.hypot(x - sx, (y - sy) * 2) / (w * 0.7), 0, 1);
      const rgb = near > 0.4 ? '255,170,120' : '170,120,170';
      soft(ctx, x, y, w * (0.07 + rnd() * 0.2), h * (0.012 + rnd() * 0.03), rgb, 0.1 + near * 0.35 * rnd());
    }
    soft(ctx, sx, sy, h * 0.05, h * 0.05, '255,247,225', 1);
    const ridges = [
      { base: hz - h * 0.01, amp: h * 0.16, f: 1.7, c: '#a98aa8', s: 3 },
      { base: hz + h * 0.0, amp: h * 0.14, f: 2.6, c: '#7d6490', s: 11 },
      { base: hz + h * 0.01, amp: h * 0.1, f: 3.6, c: '#4a4467', s: 23 },
      { base: hz + h * 0.012, amp: h * 0.07, f: 5.2, c: '#252b47', s: 31 }
    ];
    ridges.forEach(function (r, k) {
      ctx.beginPath();
      ctx.moveTo(0, hz + 4);
      for (let x = 0; x <= w; x += 3) {
        const n = N.fbm(x / w * r.f + r.s, 5, 0.52);
        const ridged = 1 - Math.abs(2 * n - 1);
        ctx.lineTo(x, r.base - r.amp * (0.25 + 0.75 * Math.pow(ridged, 1.3)) * (0.55 + 0.45 * n));
      }
      ctx.lineTo(w, hz + 4); ctx.closePath();
      ctx.fillStyle = r.c; ctx.fill();
      ctx.fillStyle = vgrad(ctx, hz - r.amp, hz, [[0, 'rgba(255,190,150,0)'], [1, 'rgba(255,196,150,' + (0.34 - k * 0.07) + ')']]);
      ctx.fill();
    });
    reflect(ctx, w, h, hz, rnd, w / 120, '10,16,40');
    for (let i = 0; i < 360; i++) {
      const t = Math.pow(rnd(), 1.5);
      const y = hz + t * (h - hz);
      const spread = w * (0.02 + t * 0.12);
      const x = sx + (rnd() + rnd() - 1) * spread;
      ctx.fillStyle = 'rgba(255,226,172,' + (0.07 + rnd() * 0.26 * (1 - t * 0.5)) + ')';
      ctx.fillRect(x, y, w * (0.004 + rnd() * 0.03), Math.max(1, h * 0.0018));
    }
    // foreground pines
    const dark = '#0a1020';
    for (let i = 0; i < 7; i++) pine(ctx, -w * 0.02 + i * w * 0.034 + rnd() * w * 0.01, h * 1.02, h * (0.3 + rnd() * 0.3), dark);
    for (let i = 0; i < 5; i++) pine(ctx, w * 1.02 - i * w * 0.03 - rnd() * w * 0.01, h * 1.02, h * (0.18 + rnd() * 0.24), dark);
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * 0.93); ctx.quadraticCurveTo(w * 0.12, h * 0.9, w * 0.3, h * 0.98); ctx.lineTo(w * 0.34, h); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w, h); ctx.lineTo(w, h * 0.94); ctx.quadraticCurveTo(w * 0.9, h * 0.93, w * 0.78, h * 0.99); ctx.lineTo(w * 0.76, h); ctx.fill();
    vignette(ctx, w, h, 0.5, '4,8,22');
  }

  function city(ctx, w, h, rnd) {
    const hz = h * 0.62;
    ctx.fillStyle = vgrad(ctx, 0, hz, [[0, '#050814'], [0.45, '#141a3c'], [0.78, '#5a2a5c'], [1, '#d9605f']]);
    ctx.fillRect(0, 0, w, hz + 2);
    glow(ctx, w * 0.5, hz, w * 0.5, [[0, 'rgba(255,170,120,0.55)'], [1, 'rgba(255,120,110,0)']]);
    const layers = [
      { col: '#2c2450', win: 0.04, minH: 0.12, maxH: 0.34, minW: 0.03, maxW: 0.07 },
      { col: '#171533', win: 0.12, minH: 0.12, maxH: 0.44, minW: 0.03, maxW: 0.08 },
      { col: '#0a091b', win: 0.22, minH: 0.1, maxH: 0.5, minW: 0.035, maxW: 0.09 }
    ];
    layers.forEach(function (L) {
      let x = -w * 0.02;
      while (x < w) {
        const bw = w * (L.minW + rnd() * (L.maxW - L.minW));
        const bh = h * (L.minH + Math.pow(rnd(), 1.4) * (L.maxH - L.minH));
        ctx.fillStyle = L.col;
        ctx.fillRect(x, hz - bh, bw, bh + 2);
        if (rnd() < 0.3) ctx.fillRect(x + bw * 0.45, hz - bh - h * (0.02 + rnd() * 0.07), Math.max(2, bw * 0.04), h * 0.09);
        const cw = Math.max(3, w * 0.0058), ch = cw * 1.5;
        for (let yy = hz - bh + ch; yy < hz - ch; yy += ch * 2) {
          for (let xx = x + cw; xx < x + bw - cw; xx += cw * 2) {
            if (rnd() < L.win) {
              ctx.fillStyle = rnd() < 0.78 ? 'rgba(255,207,122,' + (0.5 + rnd() * 0.5) + ')' : 'rgba(143,227,255,' + (0.5 + rnd() * 0.5) + ')';
              ctx.fillRect(xx, yy, cw, ch);
            }
          }
        }
        x += bw + w * 0.002;
      }
    });
    // wet street
    reflect(ctx, w, h, hz, rnd, w / 80, '6,6,16');
    ctx.fillStyle = 'rgba(8,8,20,0.45)';
    ctx.fillRect(0, hz, w, h - hz);
    // light trails toward vanishing point
    ctx.globalCompositeOperation = 'lighter';
    const vx = w * 0.5;
    for (let i = 0; i < 46; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const ex = vx + side * w * (0.05 + rnd() * 0.6);
      const red = side > 0;
      const col = red ? '255,70,90' : '255,225,170';
      const g = ctx.createLinearGradient(vx, hz, ex, h);
      g.addColorStop(0, 'rgba(' + col + ',0)');
      g.addColorStop(0.35, 'rgba(' + col + ',' + (0.25 + rnd() * 0.4) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0.05)');
      ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, w * 0.0016 * (0.6 + rnd() * 2.4));
      ctx.beginPath(); ctx.moveTo(vx + (rnd() - 0.5) * w * 0.02, hz + 2); ctx.lineTo(ex, h); ctx.stroke();
    }
    // bokeh
    const cols = ['255,77,109', '255,179,71', '77,208,225', '255,209,220', '255,236,170'];
    for (let i = 0; i < 44; i++) {
      const x = rnd() * w, y = h * (0.3 + rnd() * 0.5);
      const r = w * (0.01 + Math.pow(rnd(), 2.4) * 0.05);
      const c = cols[(rnd() * cols.length) | 0];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + c + ',0.05)'); g.addColorStop(0.8, 'rgba(' + c + ',0.1)'); g.addColorStop(0.94, 'rgba(' + c + ',0.18)'); g.addColorStop(1, 'rgba(' + c + ',0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    vignette(ctx, w, h, 0.62, '2,2,10');
  }

  function dunes(ctx, w, h, rnd, N) {
    ctx.fillStyle = vgrad(ctx, 0, h * 0.62, [[0, '#4f8cc8'], [0.55, '#b9d3e6'], [1, '#fbe3c6']]);
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.2, h * 0.3, w * 0.55, [[0, 'rgba(255,244,215,0.95)'], [0.2, 'rgba(255,230,190,0.5)'], [1, 'rgba(255,220,180,0)']]);
    for (let i = 0; i < 6; i++) soft(ctx, rnd() * w, h * (0.05 + rnd() * 0.25), w * (0.1 + rnd() * 0.18), h * 0.012, '255,255,255', 0.16);
    const n = 6;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const base = h * (0.46 + t * 0.4), amp = h * (0.05 + t * 0.09), f = 1.3 + t * 0.7, s = 7 + k * 13;
      const lit = mix('#f6cf9d', '#e19a56', t), shade = mix('#c07a4a', '#7e3f27', t);
      const ys = new Float32Array(w + 2);
      for (let x = 0; x <= w + 1; x++) {
        const nn = N.fbm(x / w * f * 2 + s, 3, 0.5);
        const sharp = 1 - Math.pow(Math.abs(Math.sin((x / w * f * 2.3 + nn * 1.1 + s) * 1.7)), 0.85);
        ys[x] = base - amp * (0.15 + 0.85 * sharp) * (0.6 + 0.8 * nn);
      }
      for (let x = 0; x < w; x++) {
        const slope = ys[x + 1] - ys[Math.max(0, x - 1)];
        const sh = clamp(slope * (6 / (1 + t * 3)) / (h * 0.01) * 0.5 + 0.25, 0, 1);
        const c = mix(lit, shade, Math.pow(sh, 1.2));
        ctx.fillStyle = css(c);
        ctx.fillRect(x, ys[x], 1.5, h - ys[x]);
      }
      ctx.strokeStyle = 'rgba(255,240,210,' + (0.5 - t * 0.25) + ')';
      ctx.lineWidth = Math.max(1, w / 1500);
      ctx.beginPath();
      for (let x = 0; x < w; x += 2) { const y = ys[x] - 0.5; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      for (let i = 0; i < 70; i++) {
        const x0 = rnd() * w, y0 = ys[Math.floor(x0)] + rnd() * (h - ys[Math.floor(x0)]) * 0.35;
        ctx.strokeStyle = 'rgba(255,236,205,' + (0.06 + rnd() * 0.12) + ')';
        ctx.lineWidth = Math.max(1, w / 2200);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + w * 0.02, y0 - h * 0.004, x0 + w * 0.045, y0); ctx.stroke();
      }
      if (k < n - 1) { ctx.fillStyle = 'rgba(250,224,196,' + (0.16 - t * 0.12) + ')'; ctx.fillRect(0, base - amp, w, h); }
      if (k === 3) {
        // lone walker and long shadow
        const fx = w * 0.62, fy = ys[Math.floor(fx)];
        const fh = h * 0.05;
        ctx.fillStyle = 'rgba(80,36,24,0.55)';
        ctx.beginPath(); ctx.ellipse(fx + fh * 1.5, fy + fh * 0.08, fh * 1.7, fh * 0.07, 0.04, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#2a1713';
        ctx.beginPath(); ctx.arc(fx, fy - fh * 0.92, fh * 0.11, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.moveTo(fx - fh * 0.12, fy - fh * 0.8); ctx.lineTo(fx + fh * 0.12, fy - fh * 0.8); ctx.lineTo(fx + fh * 0.16, fy); ctx.lineTo(fx - fh * 0.16, fy); ctx.closePath(); ctx.fill();
      }
    }
    vignette(ctx, w, h, 0.32, '60,24,10');
  }

  function pines(ctx, w, h, rnd) {
    ctx.fillStyle = vgrad(ctx, 0, h, [[0, '#a9bcba'], [0.5, '#e0e8e4'], [1, '#a2b6b0']]);
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.3, h * 0.16, w * 0.55, [[0, 'rgba(255,250,228,0.95)'], [0.3, 'rgba(255,246,220,0.45)'], [1, 'rgba(255,246,220,0)']]);
    const L = 8, fog = [214, 226, 222];
    for (let i = 0; i < L; i++) {
      const t = i / (L - 1);
      const base = h * (0.56 + t * 0.4);
      const hgt = h * (0.1 + t * t * 0.4);
      const gap = hgt * (0.4 - t * 0.1);
      const col = css(mix(fog, [13, 30, 26], Math.pow(t, 0.8) * 0.97));
      for (let x = -gap; x < w + gap; x += gap * (0.7 + rnd() * 0.7)) {
        pine(ctx, x, base + rnd() * h * 0.02, hgt * (0.7 + rnd() * 0.5), col);
      }
      ctx.fillStyle = vgrad(ctx, base - hgt, base + h * 0.1, [[0, 'rgba(222,232,228,0)'], [0.7, 'rgba(222,232,228,' + (0.52 - t * 0.2) + ')'], [1, 'rgba(222,232,228,0.2)']]);
      ctx.fillRect(0, base - hgt, w, hgt + h * 0.1);
      if (i === 3) {
        ctx.globalCompositeOperation = 'lighter';
        for (let r = 0; r < 7; r++) {
          const a = 0.35 + r * 0.17, wd = 0.04 + rnd() * 0.05;
          ctx.fillStyle = 'rgba(255,250,222,' + (0.035 + rnd() * 0.04) + ')';
          ctx.beginPath(); ctx.moveTo(w * 0.3, -h * 0.1);
          ctx.lineTo(w * 0.3 + Math.cos(a) * w * 1.3 - w * wd, h * 1.1);
          ctx.lineTo(w * 0.3 + Math.cos(a) * w * 1.3 + w * wd, h * 1.1); ctx.closePath(); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    vignette(ctx, w, h, 0.28, '12,26,22');
  }

  function coast(ctx, w, h, rnd, N) {
    const hz = h * 0.5, sx = w * 0.5;
    ctx.fillStyle = vgrad(ctx, 0, hz, [[0, '#34457a'], [0.45, '#c98aa0'], [0.8, '#ffbf93'], [1, '#ffe3b8']]);
    ctx.fillRect(0, 0, w, hz + 1);
    glow(ctx, sx, hz, w * 0.62, [[0, 'rgba(255,240,200,0.95)'], [0.15, 'rgba(255,214,160,0.6)'], [0.5, 'rgba(255,170,130,0.2)'], [1, 'rgba(255,160,130,0)']]);
    for (let i = 0; i < 18; i++) soft(ctx, rnd() * w, hz * (0.15 + rnd() * 0.65), w * (0.08 + rnd() * 0.2), h * (0.01 + rnd() * 0.02), '255,190,160', 0.1 + rnd() * 0.18);
    soft(ctx, sx, hz - h * 0.012, h * 0.045, h * 0.045, '255,250,230', 1);
    ctx.fillStyle = vgrad(ctx, hz, h, [[0, '#f1b98d'], [0.22, '#7690aa'], [1, '#0e2e48']]);
    ctx.fillRect(0, hz, w, h - hz);
    for (let i = 0; i < 1100; i++) {
      const t = Math.pow(rnd(), 1.7), y = hz + 2 + t * (h - hz);
      const len = w * (0.01 + t * 0.09) * (0.4 + rnd());
      const x = rnd() * w;
      const nearSun = Math.exp(-Math.pow((x - sx) / (w * (0.04 + t * 0.2)), 2));
      const lightC = rnd() < nearSun * 0.9;
      ctx.fillStyle = lightC ? 'rgba(255,232,190,' + (0.12 + rnd() * 0.4) + ')' : 'rgba(8,30,50,' + (0.08 + rnd() * 0.22) + ')';
      ctx.fillRect(x, y, len, Math.max(1, h * (0.0012 + t * 0.003)));
    }
    // headland and lighthouse
    ctx.fillStyle = '#1c2840';
    ctx.beginPath(); ctx.moveTo(w, hz + 2); ctx.lineTo(w, hz - h * 0.05);
    for (let x = w; x > w * 0.7; x -= 4) ctx.lineTo(x, hz - h * 0.03 - N.fbm(x / w * 6, 3) * h * 0.04 * ((x - w * 0.7) / (w * 0.3)));
    ctx.lineTo(w * 0.7, hz + 2); ctx.closePath(); ctx.fill();
    const lx = w * 0.9, ly = hz - h * 0.036;
    ctx.fillStyle = '#e9dccb';
    ctx.beginPath(); ctx.moveTo(lx - h * 0.008, ly); ctx.lineTo(lx + h * 0.008, ly); ctx.lineTo(lx + h * 0.0055, ly - h * 0.07); ctx.lineTo(lx - h * 0.0055, ly - h * 0.07); ctx.fill();
    ctx.fillStyle = '#c4473b'; ctx.fillRect(lx - h * 0.0066, ly - h * 0.045, h * 0.0132, h * 0.012);
    ctx.fillStyle = '#1b2236'; ctx.fillRect(lx - h * 0.008, ly - h * 0.082, h * 0.016, h * 0.012);
    // foreground rocks
    function rocks(x0, x1, top, seed, col, rim) {
      ctx.beginPath(); ctx.moveTo(x0, h + 2);
      const pts = [];
      for (let x = x0; x <= x1; x += 3) {
        const n = N.fbm(x / w * 5 + seed, 4);
        const y = h - top * (0.2 + 1.1 * Math.pow(1 - Math.abs((x - x0) / (x1 - x0) * 2 - 1), 0.6)) * (0.5 + n);
        pts.push([x, y]); ctx.lineTo(x, y);
      }
      ctx.lineTo(x1, h + 2); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1.5, w / 900);
      ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1] - 1); else ctx.moveTo(p[0], p[1] - 1); }); ctx.stroke();
    }
    rocks(-w * 0.05, w * 0.42, h * 0.3, 2.3, '#0b141c', 'rgba(255,196,150,0.55)');
    rocks(w * 0.62, w * 1.05, h * 0.16, 9.1, '#0a1218', 'rgba(255,196,150,0.4)');
    ctx.strokeStyle = 'rgba(20,20,30,0.7)'; ctx.lineWidth = Math.max(1.5, w / 700); ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const bx = w * (0.2 + rnd() * 0.5), by = hz * (0.2 + rnd() * 0.4), s = w * (0.006 + rnd() * 0.006);
      ctx.beginPath(); ctx.moveTo(bx - s, by + s * 0.4); ctx.quadraticCurveTo(bx - s * 0.3, by - s * 0.3, bx, by); ctx.quadraticCurveTo(bx + s * 0.3, by - s * 0.3, bx + s, by + s * 0.4); ctx.stroke();
    }
    vignette(ctx, w, h, 0.42, '6,12,28');
  }

  const SCENES = {
    'golden-lake': { fn: dusk, seed: 11, grain: 9, title: 'Golden lake' },
    'neon-city': { fn: city, seed: 29, grain: 10, title: 'Neon city' },
    'desert-walk': { fn: dunes, seed: 5, grain: 8, title: 'Desert walk' },
    'pine-fog': { fn: pines, seed: 17, grain: 7, title: 'Pine fog' },
    'sunrise-coast': { fn: coast, seed: 41, grain: 8, title: 'Sunrise coast' }
  };

  function render(name, w, h) {
    const sc = SCENES[name];
    if (!sc) throw new Error('Unknown sample: ' + name);
    w = w || 1600; h = h || 1000;
    const c = newCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
    const rnd = mulberry32(sc.seed), N = makeNoise(mulberry32(sc.seed * 7 + 1));
    sc.fn(ctx, w, h, rnd, N);
    grain(ctx, w, h, sc.grain, rnd);
    return c;
  }

  root.Samples = { render: render, scenes: SCENES, names: Object.keys(SCENES) };
})(typeof window !== 'undefined' ? window : this);
