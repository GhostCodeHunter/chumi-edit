/* Chumi.edit content-aware fill: multi-scale PatchMatch inpainting.
   Pure computation with no DOM, so it runs inside a worker (js/inpaint-worker.js) and on the main thread alike.

   inpaint(rgba, W, H, hole, opts, progress) -> Uint8ClampedArray (RGBA, hole pixels filled, the rest untouched)
     rgba   Uint8ClampedArray, W*H*4
     hole   Uint8Array, W*H, 1 where pixels must be invented
     opts   { radius: 3, seed: 1, quality: 1 }   quality scales the number of PatchMatch passes
     progress(fraction)  optional
   Returns null when there is no usable picture around the hole to copy from. */
(function (root) {
  'use strict';

  function rng32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* square dilation of a 0/1 mask by r pixels (two separable passes) */
  function dilate(mask, W, H, r) {
    if (r <= 0) return mask;
    const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      let last = -1e9; const o = y * W;
      for (let x = 0; x < W; x++) if (mask[o + x]) last = x, tmp[o + x] = 1; else tmp[o + x] = (x - last <= r) ? 1 : 0;
      last = 1e9;
      for (let x = W - 1; x >= 0; x--) { if (mask[o + x]) last = x; if (last - x <= r) tmp[o + x] = 1; }
    }
    for (let x = 0; x < W; x++) {
      let last = -1e9;
      for (let y = 0; y < H; y++) { const i = y * W + x; if (tmp[i]) last = y, out[i] = 1; else out[i] = (y - last <= r) ? 1 : 0; }
      last = 1e9;
      for (let y = H - 1; y >= 0; y--) { const i = y * W + x; if (tmp[i]) last = y; if (last - y <= r) out[i] = 1; }
    }
    return out;
  }

  /* summed-area table of a 0/1 array, (W+1)*(H+1) */
  function integral(a, W, H) {
    const S = new Int32Array((W + 1) * (H + 1)), W1 = W + 1;
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) { row += a[y * W + x]; S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + row; }
    }
    return S;
  }
  function boxSum(S, W1, x0, y0, x1, y1) { /* inclusive-exclusive */ return S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0]; }

  function makeLevel(W, H, img, hole, bad) { return { W: W, H: H, img: img, hole: hole, bad: bad, nnf: null }; }

  function downLevel(p) {
    const W = p.W >> 1, H = p.H >> 1, img = new Float32Array(W * H * 3), hole = new Uint8Array(W * H), bad = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, n = 0, h = 0, bd = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = (2 * y + dy) * p.W + 2 * x + dx;
          if (p.hole[i]) { h = 1; bd = 1; continue; }
          if (p.bad[i]) bd = 1;
          r += p.img[i * 3]; g += p.img[i * 3 + 1]; b += p.img[i * 3 + 2]; n++;
        }
        const o = y * W + x;
        if (n) { img[o * 3] = r / n; img[o * 3 + 1] = g / n; img[o * 3 + 2] = b / n; }
        hole[o] = h; bad[o] = bd;
      }
    }
    return makeLevel(W, H, img, hole, bad);
  }

  /* start the coarsest level from a smooth guess: relax the hole towards the average of its neighbours */
  function initialFill(lv) {
    const W = lv.W, H = lv.H, img = lv.img, hole = lv.hole;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < W * H; i++) if (!hole[i]) { sr += img[i * 3]; sg += img[i * 3 + 1]; sb += img[i * 3 + 2]; n++; }
    if (!n) return;
    sr /= n; sg /= n; sb /= n;
    const idx = [];
    for (let i = 0; i < W * H; i++) if (hole[i]) { idx.push(i); img[i * 3] = sr; img[i * 3 + 1] = sg; img[i * 3 + 2] = sb; }
    for (let it = 0; it < 220; it++) {
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k], x = i % W, y = (i / W) | 0;
        let r = 0, g = 0, b = 0, c = 0;
        if (x > 0) { const j = i - 1; r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2]; c++; }
        if (x < W - 1) { const j = i + 1; r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2]; c++; }
        if (y > 0) { const j = i - W; r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2]; c++; }
        if (y < H - 1) { const j = i + W; r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2]; c++; }
        img[i * 3] = r / c; img[i * 3 + 1] = g / c; img[i * 3 + 2] = b / c;
      }
    }
  }

  /* fill the hole pixels of a finer level from the (already solved) coarser one, bilinear */
  function upsampleInto(fine, coarse) {
    const W = fine.W, H = fine.H, cw = coarse.W, ch = coarse.H, ci = coarse.img;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x; if (!fine.hole[i]) continue;
        let fx = (x + 0.5) / 2 - 0.5, fy = (y + 0.5) / 2 - 0.5;
        fx = Math.max(0, Math.min(cw - 1, fx)); fy = Math.max(0, Math.min(ch - 1, fy));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(cw - 1, x0 + 1), y1 = Math.min(ch - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
        for (let c = 0; c < 3; c++) {
          const a = ci[(y0 * cw + x0) * 3 + c], b = ci[(y0 * cw + x1) * 3 + c], d = ci[(y1 * cw + x0) * 3 + c], e = ci[(y1 * cw + x1) * 3 + c];
          fine.img[i * 3 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
        }
      }
    }
  }

  function solveLevel(lv, R, iters, rand, tick, opts) {
    const W = lv.W, H = lv.H, img = lv.img, hole = lv.hole, bad = lv.bad, W1 = W + 1;
    const P = 2 * R + 1, holeInt = integral(hole, W, H), badInt = integral(bad, W, H);

    /* target centres: patch inside the picture and touching the hole */
    const tl = [];
    for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
      if (boxSum(holeInt, W1, x - R, y - R, x + R + 1, y + R + 1) > 0) tl.push(y * W + x);
    }
    const tIdx = Int32Array.from(tl);
    if (!tIdx.length) return true;
    /* source centres: whole patch is real picture */
    const sl = [];
    for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
      if (boxSum(badInt, W1, x - R, y - R, x + R + 1, y + R + 1) === 0) sl.push(y * W + x);
    }
    if (!sl.length) return false;
    const sIdx = Int32Array.from(sl);
    /* sources in a ring around the hole, tried first and sampled more often */
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    for (let k = 0; k < tIdx.length; k++) { const x = tIdx[k] % W, y = (tIdx[k] / W) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    const ring = Math.max(16, lv.S * 0.8), nl2 = [];
    for (let k = 0; k < sIdx.length; k++) { const x = sIdx[k] % W, y = (sIdx[k] / W) | 0; if (x >= bx0 - ring && x <= bx1 + ring && y >= by0 - ring && y <= by1 + ring) nl2.push(sIdx[k]); }
    const sNear = nl2.length > 16 ? Int32Array.from(nl2) : sIdx;
    const isSrc = function (x, y) { return x >= R && y >= R && x < W - R && y < H - R && boxSum(badInt, W1, x - R, y - R, x + R + 1, y + R + 1) === 0; };

    /* sources close to the hole are preferred: cost grows with the squared distance between the two patches */
    const lam = P * P * 3 * (opts.near == null ? 40 : opts.near) / (lv.S * lv.S);
    const dist = function (pi, qi, limit) {
      const ddx = (pi % W) - (qi % W), ddy = ((pi / W) | 0) - ((qi / W) | 0);
      let d = lam * (ddx * ddx + ddy * ddy);
      for (let dy = -R; dy <= R; dy++) {
        let a = (pi + dy * W - R) * 3, b = (qi + dy * W - R) * 3;
        for (let dx = 0; dx < P; dx++) {
          const d0 = img[a] - img[b], d1 = img[a + 1] - img[b + 1], d2 = img[a + 2] - img[b + 2];
          d += d0 * d0 + d1 * d1 + d2 * d2; a += 3; b += 3;
        }
        if (d >= limit) return d;
      }
      return d;
    };

    /* NNF: for every target centre, the centre of its best matching source patch */
    let nnf = lv.nnf; const cost = new Float32Array(W * H);
    if (!nnf) nnf = new Int32Array(W * H).fill(-1);
    for (let k = 0; k < tIdx.length; k++) {
      const p = tIdx[k], q = nnf[p];
      if (q < 0 || !isSrc(q % W, (q / W) | 0)) nnf[p] = sNear[(rand() * sNear.length) | 0];
    }
    lv.nnf = nnf;

    const acc = new Float32Array(W * H * 3), wacc = new Float32Array(W * H);
    const maxR = Math.max(W, H);
    const sigma = P * P * 3 * 150;

    /* vote: every hole pixel becomes the weighted mean of what the overlapping source patches say it should be */
    const vote = function () {
      acc.fill(0); wacc.fill(0);
      for (let k = 0; k < tIdx.length; k++) {
        const p = tIdx[k], q = nnf[p], w = Math.exp(-Math.min(cost[p], sigma * 20) / sigma);
        for (let dy = -R; dy <= R; dy++) {
          let pi = p + dy * W - R, qi = q + dy * W - R;
          for (let dx = 0; dx < P; dx++, pi++, qi++) {
            if (!hole[pi]) continue;
            acc[pi * 3] += w * img[qi * 3]; acc[pi * 3 + 1] += w * img[qi * 3 + 1]; acc[pi * 3 + 2] += w * img[qi * 3 + 2]; wacc[pi] += w;
          }
        }
      }
      for (let i = 0; i < W * H; i++) {
        if (hole[i] && wacc[i] > 0) { img[i * 3] = acc[i * 3] / wacc[i]; img[i * 3 + 1] = acc[i * 3 + 1] / wacc[i]; img[i * 3 + 2] = acc[i * 3 + 2] / wacc[i]; }
      }
    };
    /* matches carried down from the coarser level: rebuild this level's hole from sharp source pixels instead of blowing up blurry colours */
    if (lv.carried) { for (let k = 0; k < tIdx.length; k++) { const p = tIdx[k]; cost[p] = dist(p, nnf[p], 1e30); } vote(); }

    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < tIdx.length; k++) { const p = tIdx[k]; cost[p] = dist(p, nnf[p], 1e30); }
      const fwd = (it & 1) === 0;
      for (let kk = 0; kk < tIdx.length; kk++) {
        const k = fwd ? kk : tIdx.length - 1 - kk, p = tIdx[k], px = p % W, py = (p / W) | 0;
        let bq = nnf[p], bc = cost[p];
        /* propagation from the neighbours that were just visited */
        const step = fwd ? -1 : 1;
        if (px + step >= R && px + step < W - R) {
          const nq = nnf[p + step];
          if (nq >= 0) {
            const x2 = (nq % W) - step, y2 = (nq / W) | 0;
            if (isSrc(x2, y2)) { const q = y2 * W + x2; if (q !== bq) { const c = dist(p, q, bc); if (c < bc) { bc = c; bq = q; } } }
          }
        }
        if (py + step >= R && py + step < H - R) {
          const nq = nnf[p + step * W];
          if (nq >= 0) {
            const x2 = nq % W, y2 = ((nq / W) | 0) - step;
            if (isSrc(x2, y2)) { const q = y2 * W + x2; if (q !== bq) { const c = dist(p, q, bc); if (c < bc) { bc = c; bq = q; } } }
          }
        }
        /* random search around the best match, shrinking radius */
        const bqx = bq % W, bqy = (bq / W) | 0;
        for (let rad = maxR; rad >= 1; rad >>= 1) {
          const x2 = bqx + (((rand() * 2 - 1) * rad) | 0), y2 = bqy + (((rand() * 2 - 1) * rad) | 0);
          if (!isSrc(x2, y2)) continue;
          const q = y2 * W + x2; if (q === bq) continue;
          const c = dist(p, q, bc); if (c < bc) { bc = c; bq = q; }
        }
        /* a few fresh guesses from the ring around the hole */
        for (let g = 0; g < 3; g++) {
          const q = sNear[(rand() * sNear.length) | 0]; if (q === bq) continue;
          const c = dist(p, q, bc); if (c < bc) { bc = c; bq = q; }
        }
        nnf[p] = bq; cost[p] = bc;
      }
      vote();
      tick();
    }
    return true;
  }

  function inpaint(rgba, W, H, holeIn, opts, progress) {
    opts = opts || {};
    const R = opts.radius || 3, rand = rng32(opts.seed || 1), q = opts.quality || 1;
    const n = W * H, img0 = new Float32Array(n * 3), hole0 = new Uint8Array(n), bad0 = new Uint8Array(n);
    let any = 0, hx0 = W, hy0 = H, hx1 = -1, hy1 = -1;
    for (let i = 0; i < n; i++) {
      img0[i * 3] = rgba[i * 4]; img0[i * 3 + 1] = rgba[i * 4 + 1]; img0[i * 3 + 2] = rgba[i * 4 + 2];
      if (holeIn[i]) { hole0[i] = 1; bad0[i] = 1; any++; const x = i % W, y = (i / W) | 0; if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (y < hy0) hy0 = y; if (y > hy1) hy1 = y; }
      else if (rgba[i * 4 + 3] < 250) bad0[i] = 1;
    }
    const out = new Uint8ClampedArray(rgba);
    if (!any) return out;
    if (any === n) return null;

    const levels = [makeLevel(W, H, img0, hole0, bad0)], maxHole = Math.max(hx1 - hx0 + 1, hy1 - hy0 + 1);
    while (levels.length < 7) {
      const last = levels[levels.length - 1];
      if (Math.min(last.W >> 1, last.H >> 1) < 40) break;
      if (maxHole / Math.pow(2, levels.length) < 2.5) break;
      levels.push(downLevel(last));
    }
    const nl = levels.length;
    let total = 0; const itersFor = function (k) { return Math.max(2, Math.round((k === 0 ? 3 : k === nl - 1 ? 7 : 4) * q)); };
    for (let k = 0; k < nl; k++) total += itersFor(k) * (levels[k].W * levels[k].H) / (levels[0].W * levels[0].H);
    let done = 0;
    initialFill(levels[nl - 1]);
    for (let k = nl - 1; k >= 0; k--) {
      const lv = levels[k], iters = itersFor(k), w = (lv.W * lv.H) / (levels[0].W * levels[0].H);
      if (k < nl - 1) {
        upsampleInto(lv, levels[k + 1]);
        /* carry the matches down a level: doubled offsets */
        const cn = levels[k + 1].nnf;
        if (cn) {
          const nnf = new Int32Array(lv.W * lv.H).fill(-1);
          for (let y = 0; y < lv.H; y++) for (let x = 0; x < lv.W; x++) {
            const c = ((y >> 1) * levels[k + 1].W) + (x >> 1), qc = cn[c]; if (qc < 0) continue;
            const qx = (qc % levels[k + 1].W) * 2 + (x & 1), qy = ((qc / levels[k + 1].W) | 0) * 2 + (y & 1);
            if (qx < lv.W && qy < lv.H) nnf[y * lv.W + x] = qy * lv.W + qx;
          }
          lv.nnf = nnf; lv.carried = true;
        }
      }
      lv.S = Math.max(24, maxHole * 1.0) / Math.pow(2, k);
      const ok = solveLevel(lv, R, iters, rand, function () { done += w; if (progress) progress(Math.min(0.99, done / total)); }, opts);
      if (!ok) return null;
      if (opts.onLevel) opts.onLevel(k, lv);
    }
    const L0 = levels[0];
    for (let i = 0; i < n; i++) {
      if (!hole0[i]) continue;
      out[i * 4] = L0.img[i * 3] + 0.5; out[i * 4 + 1] = L0.img[i * 3 + 1] + 0.5; out[i * 4 + 2] = L0.img[i * 3 + 2] + 0.5; out[i * 4 + 3] = 255;
    }
    if (progress) progress(1);
    return out;
  }

  root.ChumiInpaint = { inpaint: inpaint, dilate: dilate };
})(typeof self !== 'undefined' ? self : this);
