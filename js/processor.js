/*
 * Puzzle processor: turns a colour image into a paint-by-number puzzle.
 *
 * Pipeline
 *   1. painterly smoothing (Kuwahara), then quantise every pixel to a
 *      palette with k-means in Lab colour space (follows light and shadow)
 *   2. smooth the index map and find connected regions
 *   3. repeatedly merge regions that are too small / too thin into their
 *      best neighbour, so every region can hold a readable number
 *   4. distance transform -> the best spot (and size) for each number
 *   5. trace and smooth the region outlines into shared vector curves
 *
 * Everything lives inside createProcessor() so the exact same source can be
 * run on the main thread or stringified into a Web Worker (works offline and
 * from file:// too).
 */
function createProcessor() {
  'use strict';

  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function boxBlur(src, w, h) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const o = (yy * w + xx) * 4;
            r += src[o]; g += src[o + 1]; b += src[o + 2]; n++;
          }
        }
        const o = (y * w + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    return out;
  }

  /*
   * Kuwahara filter: every pixel takes the mean colour of whichever of its
   * four neighbouring squares is the most uniform. Flattens texture and noise
   * into soft brush-stroke patches while keeping edges crisp — a painterly
   * base that cuts into much nicer regions than the raw photo.
   */
  function kuwahara(src, w, h, rad) {
    const W1 = w + 1, N = W1 * (h + 1);
    const sr = new Float64Array(N), sg = new Float64Array(N), sb = new Float64Array(N);
    const sl = new Float64Array(N), sl2 = new Float64Array(N);
    for (let y = 0; y < h; y++) {
      let ar = 0, ag = 0, ab = 0, al = 0, al2 = 0;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const r = src[o], g = src[o + 1], b = src[o + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        ar += r; ag += g; ab += b; al += l; al2 += l * l;
        const i = (y + 1) * W1 + x + 1, u = i - W1;
        sr[i] = sr[u] + ar; sg[i] = sg[u] + ag; sb[i] = sb[u] + ab; sl[i] = sl[u] + al; sl2[i] = sl2[u] + al2;
      }
    }
    const out = new Uint8ClampedArray(src.length);
    const box = (S, x0, y0, x1, y1) => S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = Infinity, bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
        for (let q = 0; q < 4; q++) {
          const x0 = q & 1 ? x : Math.max(0, x - rad), x1 = q & 1 ? Math.min(w, x + rad + 1) : x + 1;
          const y0 = q & 2 ? y : Math.max(0, y - rad), y1 = q & 2 ? Math.min(h, y + rad + 1) : y + 1;
          const cnt = (x1 - x0) * (y1 - y0);
          const m = box(sl, x0, y0, x1, y1) / cnt;
          const v = box(sl2, x0, y0, x1, y1) / cnt - m * m;
          if (v < best) { best = v; bx0 = x0; by0 = y0; bx1 = x1; by1 = y1; }
        }
        const cnt = (bx1 - bx0) * (by1 - by0), o = (y * w + x) * 4;
        out[o] = box(sr, bx0, by0, bx1, by1) / cnt;
        out[o + 1] = box(sg, bx0, by0, bx1, by1) / cnt;
        out[o + 2] = box(sb, bx0, by0, bx1, by1) / cnt;
        out[o + 3] = 255;
      }
    }
    return out;
  }

  // sRGB -> CIE Lab, so clusters follow how we perceive light and shadow
  const srgbLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    srgbLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function labF(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  function toLab(r, g, b, out, o) {
    const R = srgbLin[r], G = srgbLin[g], B = srgbLin[b];
    const x = labF((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const y = labF(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = labF((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    out[o] = 116 * y - 16;
    out[o + 1] = 500 * (x - y);
    out[o + 2] = 200 * (y - z);
  }

  // k-means in Lab space (k-means++ seeding on a sample); returns RGB palette + index map
  function kmeansLab(data, n, k, seed) {
    const rand = mulberry32(seed);
    const lab = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) toLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], lab, i * 3);
    const S = Math.min(n, 40000);
    const smp = new Int32Array(S);
    for (let s = 0; s < S; s++) smp[s] = Math.floor(rand() * n);
    const d2 = (i, c) => {
      const a = lab[i * 3] - c[0], b = lab[i * 3 + 1] - c[1], cc = lab[i * 3 + 2] - c[2];
      return a * a + b * b + cc * cc;
    };
    const centers = [];
    const p0 = smp[Math.floor(rand() * S)];
    centers.push([lab[p0 * 3], lab[p0 * 3 + 1], lab[p0 * 3 + 2]]);
    const dmin = new Float64Array(S).fill(Infinity);
    while (centers.length < k) {
      const c = centers[centers.length - 1];
      let total = 0;
      for (let s = 0; s < S; s++) { const d = d2(smp[s], c); if (d < dmin[s]) dmin[s] = d; total += dmin[s]; }
      if (total === 0) break;
      let t = rand() * total, pick = smp[0];
      for (let s = 0; s < S; s++) { t -= dmin[s]; if (t <= 0) { pick = smp[s]; break; } }
      centers.push([lab[pick * 3], lab[pick * 3 + 1], lab[pick * 3 + 2]]);
    }
    const K = centers.length;
    for (let iter = 0; iter < 16; iter++) {
      const sums = new Float64Array(K * 4);
      for (let s = 0; s < S; s++) {
        const i = smp[s];
        let bd = Infinity, best = 0;
        for (let c = 0; c < K; c++) { const d = d2(i, centers[c]); if (d < bd) { bd = d; best = c; } }
        sums[best * 4] += lab[i * 3]; sums[best * 4 + 1] += lab[i * 3 + 1]; sums[best * 4 + 2] += lab[i * 3 + 2]; sums[best * 4 + 3]++;
      }
      for (let c = 0; c < K; c++) {
        const cnt = sums[c * 4 + 3];
        if (cnt > 0) centers[c] = [sums[c * 4] / cnt, sums[c * 4 + 1] / cnt, sums[c * 4 + 2] / cnt];
      }
    }
    const idx = new Uint16Array(n);
    const rgb = new Float64Array(K * 4);
    for (let i = 0; i < n; i++) {
      let bd = Infinity, best = 0;
      for (let c = 0; c < K; c++) { const d = d2(i, centers[c]); if (d < bd) { bd = d; best = c; } }
      idx[i] = best;
      rgb[best * 4] += data[i * 4]; rgb[best * 4 + 1] += data[i * 4 + 1]; rgb[best * 4 + 2] += data[i * 4 + 2]; rgb[best * 4 + 3]++;
    }
    const palette = [];
    for (let c = 0; c < K; c++) {
      const cnt = rgb[c * 4 + 3] || 1;
      palette.push([Math.round(rgb[c * 4] / cnt), Math.round(rgb[c * 4 + 1] / cnt), Math.round(rgb[c * 4 + 2] / cnt)]);
    }
    return { palette, idx };
  }

  // 3x3 majority filter on the index map: removes speckle, smooths edges
  function modeFilter(idx, w, h) {
    const out = new Uint16Array(idx.length);
    const vals = new Uint16Array(9), cnts = new Uint8Array(9);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const v = idx[yy * w + xx];
            let j = 0;
            while (j < m && vals[j] !== v) j++;
            if (j === m) { vals[m] = v; cnts[m] = 1; m++; } else cnts[j]++;
          }
        }
        const self = idx[y * w + x];
        let best = self, bc = 0;
        for (let j = 0; j < m; j++) {
          if (cnts[j] > bc || (cnts[j] === bc && vals[j] === self)) { bc = cnts[j]; best = vals[j]; }
        }
        out[y * w + x] = bc >= 5 ? best : self;
      }
    }
    return out;
  }

  function label(idx, w, h) {
    const n = w * h;
    const labels = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    const color = [], area = [];
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (labels[i] !== -1) continue;
      const c = idx[i];
      let sp = 0, a = 0;
      stack[sp++] = i;
      labels[i] = count;
      while (sp > 0) {
        const p = stack[--sp];
        a++;
        const x = p % w;
        if (x > 0 && labels[p - 1] === -1 && idx[p - 1] === c) { labels[p - 1] = count; stack[sp++] = p - 1; }
        if (x < w - 1 && labels[p + 1] === -1 && idx[p + 1] === c) { labels[p + 1] = count; stack[sp++] = p + 1; }
        if (p >= w && labels[p - w] === -1 && idx[p - w] === c) { labels[p - w] = count; stack[sp++] = p - w; }
        if (p < n - w && labels[p + w] === -1 && idx[p + w] === c) { labels[p + w] = count; stack[sp++] = p + w; }
      }
      color.push(c); area.push(a);
      count++;
    }
    return { labels, count, color, area };
  }

  // Chamfer distance (in px) from each pixel to the nearest pixel of another region
  function distanceTransform(labels, w, h) {
    const n = w * h;
    const d = new Float32Array(n);
    const INF = 1e9;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x, l = labels[p];
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          labels[p - 1] !== l || labels[p + 1] !== l || labels[p - w] !== l || labels[p + w] !== l;
        d[p] = edge ? 1 : INF;
      }
    }
    const D = Math.SQRT2;
    for (let y = 1; y < h; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        let v = d[p];
        if (v === 1) continue;
        v = Math.min(v, d[p - 1] + 1, d[p - w] + 1, d[p - w - 1] + D, d[p - w + 1] + D);
        d[p] = v;
      }
    }
    for (let y = h - 2; y >= 0; y--) {
      for (let x = w - 2; x >= 1; x--) {
        const p = y * w + x;
        let v = d[p];
        if (v === 1) continue;
        v = Math.min(v, d[p + 1] + 1, d[p + w] + 1, d[p + w + 1] + D, d[p + w - 1] + D);
        d[p] = v;
      }
    }
    return d;
  }

  function regionMaxDist(labels, dist, count) {
    const maxd = new Float32Array(count);
    const at = new Int32Array(count);
    for (let p = 0; p < labels.length; p++) {
      const l = labels[p];
      if (dist[p] > maxd[l]) { maxd[l] = dist[p]; at[l] = p; }
    }
    return { maxd, at };
  }

  function mergeSmall(idx, w, h, minArea, minThick) {
    let lab;
    for (let pass = 0; pass < 14; pass++) {
      lab = label(idx, w, h);
      const dist = distanceTransform(lab.labels, w, h);
      const { maxd } = regionMaxDist(lab.labels, dist, lab.count);
      const small = new Uint8Array(lab.count);
      let any = false;
      for (let r = 0; r < lab.count; r++) {
        if (lab.area[r] < minArea || maxd[r] < minThick) { small[r] = 1; any = true; }
      }
      if (!any) return lab;
      // shared border lengths between a small region and each neighbour
      const borders = new Map();
      const add = (a, b) => {
        let m = borders.get(a);
        if (!m) { m = new Map(); borders.set(a, m); }
        m.set(b, (m.get(b) || 0) + 1);
      };
      const L = lab.labels;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x, a = L[p];
          if (x < w - 1) {
            const b = L[p + 1];
            if (a !== b) { if (small[a]) add(a, b); if (small[b]) add(b, a); }
          }
          if (y < h - 1) {
            const b = L[p + w];
            if (a !== b) { if (small[a]) add(a, b); if (small[b]) add(b, a); }
          }
        }
      }
      const newColor = new Int32Array(lab.count).fill(-1);
      for (const [r, m] of borders) {
        let best = -1, bestScore = -1;
        for (const [nb, len] of m) {
          // prefer merging into stable (non-small) neighbours
          const score = len * (small[nb] ? 1 : 1000) + lab.area[nb] * 1e-6;
          if (score > bestScore) { bestScore = score; best = nb; }
        }
        if (best >= 0) newColor[r] = lab.color[best];
      }
      let changed = false;
      for (let p = 0; p < idx.length; p++) {
        const nc = newColor[L[p]];
        if (nc >= 0 && idx[p] !== nc) { idx[p] = nc; changed = true; }
      }
      if (!changed) return lab;
    }
    return label(idx, w, h);
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  /*
   * opts:
   *   colors    – number of colours (k-means clusters)
   *   minArea   – minimum region size in px
   *   minThick  – minimum inscribed radius in px
   */
  function process(width, height, data, opts) {
    const w = width, h = height, n = w * h;
    // painterly pre-filter: soft brush-stroke patches instead of pixel noise
    const rad = Math.max(2, Math.round(Math.max(w, h) / 260));
    let src = kuwahara(boxBlur(data, w, h), w, h, rad);
    src = kuwahara(src, w, h, Math.max(2, rad - 1));
    const { palette, idx: q } = kmeansLab(src, n, opts.colors || 20, 1234567);
    let idx = modeFilter(q, w, h);
    idx = modeFilter(idx, w, h);
    idx = modeFilter(idx, w, h);

    const lab = mergeSmall(idx, w, h, opts.minArea || 250, opts.minThick || 5);

    // drop unused colours and order the palette by hue, then lightness
    const used = new Uint8Array(palette.length);
    for (const c of lab.color) used[c] = 1;
    const order = [];
    for (let c = 0; c < palette.length; c++) {
      if (!used[c]) continue;
      const [hh, s, l] = rgbToHsl(palette[c][0], palette[c][1], palette[c][2]);
      const key = s < 0.12 ? l : 1 + Math.floor(hh * 12) + l * 0.5;
      order.push({ c, key });
    }
    order.sort((a, b) => a.key - b.key);
    const remap = new Int32Array(palette.length).fill(-1);
    const finalPalette = order.map((o, i) => { remap[o.c] = i; return palette[o.c]; });

    const R = lab.count;
    const labels = lab.labels;
    const regionColor = new Uint16Array(R);
    for (let r = 0; r < R; r++) regionColor[r] = remap[lab.color[r]];

    const dist = distanceTransform(labels, w, h);
    const { maxd, at } = regionMaxDist(labels, dist, R);
    const regionLabel = new Float32Array(R * 3);
    for (let r = 0; r < R; r++) {
      regionLabel[r * 3] = (at[r] % w) + 0.5;
      regionLabel[r * 3 + 1] = Math.floor(at[r] / w) + 0.5;
      regionLabel[r * 3 + 2] = maxd[r];
    }

    // bounding boxes (inclusive pixel coords)
    const bbox = new Int32Array(R * 4);
    for (let r = 0; r < R; r++) { bbox[r * 4] = w; bbox[r * 4 + 1] = h; bbox[r * 4 + 2] = -1; bbox[r * 4 + 3] = -1; }
    for (let p = 0; p < n; p++) {
      const r = labels[p];
      const x = p % w, y = (p - x) / w, o = r * 4;
      if (x < bbox[o]) bbox[o] = x;
      if (y < bbox[o + 1]) bbox[o + 1] = y;
      if (x > bbox[o + 2]) bbox[o + 2] = x;
      if (y > bbox[o + 3]) bbox[o + 3] = y;
    }

    const contours = traceContours(labels, w, h, R);

    return {
      width: w, height: h, regionCount: R,
      palette: finalPalette,
      labels, regionColor, regionLabel, regionBBox: bbox,
      contourPts: contours.pts, loopStart: contours.loopStart, regionLoops: contours.regionLoops,
    };
  }

  /*
   * Vector outlines. Region borders are traced along pixel edges, split at
   * junctions (where 3+ regions meet), and every shared border piece is
   * smoothed exactly once, so neighbouring regions get identical curves:
   * no gaps, no double lines, no staircase.
   */
  function traceContours(labels, w, h, R) {
    const W1 = w + 1;
    let E = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x, l = labels[p];
        if (y === 0 || labels[p - w] !== l) E++;
        if (x === w - 1 || labels[p + 1] !== l) E++;
        if (y === h - 1 || labels[p + w] !== l) E++;
        if (x === 0 || labels[p - 1] !== l) E++;
      }
    }
    // directed edges keep their region on the right-hand side (clockwise, y down)
    const from = new Int32Array(E), to = new Int32Array(E), reg = new Int32Array(E), nextAt = new Int32Array(E);
    const head = new Int32Array(W1 * (h + 1)).fill(-1);
    let e = 0;
    const add = (a, b, l) => { from[e] = a; to[e] = b; reg[e] = l; nextAt[e] = head[a]; head[a] = e; e++; };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x, l = labels[p];
        const v00 = y * W1 + x, v10 = v00 + 1, v01 = v00 + W1, v11 = v01 + 1;
        if (y === 0 || labels[p - w] !== l) add(v00, v10, l);
        if (x === w - 1 || labels[p + 1] !== l) add(v10, v11, l);
        if (y === h - 1 || labels[p + w] !== l) add(v11, v01, l);
        if (x === 0 || labels[p - 1] !== l) add(v01, v00, l);
      }
    }
    const dirOf = d => (d === 1 ? 0 : d === W1 ? 1 : d === -1 ? 2 : 3);

    const lab = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : labels[y * w + x]);
    const junction = v => {
      const x = v % W1, y = (v - x) / W1;
      if ((x === 0 || x === w) && (y === 0 || y === h)) return true;
      const a = lab(x - 1, y - 1), b = lab(x, y - 1), c = lab(x - 1, y), d = lab(x, y);
      let k = 1;
      if (b !== a) k++;
      if (c !== a && c !== b) k++;
      if (d !== a && d !== b && d !== c) k++;
      if (k >= 3) return true;
      return k === 2 && a === d && b === c && a !== b;
    };

    const used = new Uint8Array(E);
    const regionLoopsList = new Array(R);
    for (let r = 0; r < R; r++) regionLoopsList[r] = [];
    const chainCache = new Map();

    for (let s = 0; s < E; s++) {
      if (used[s]) continue;
      const l = reg[s];
      const verts = [from[s]];
      let cur = s;
      for (;;) {
        used[cur] = 1;
        const v = to[cur];
        const din = dirOf(v - from[cur]);
        let nxt = -1, bestRank = 9;
        for (let f = head[v]; f !== -1; f = nextAt[f]) {
          if (reg[f] !== l || (used[f] && f !== s)) continue;
          // prefer turning right, which hugs the region at pinch points
          const rank = (din + 1 - dirOf(to[f] - v) + 4) % 4;
          if (rank < bestRank) { bestRank = rank; nxt = f; }
        }
        if (nxt === -1 || nxt === s) break;
        verts.push(v);
        cur = nxt;
      }
      regionLoopsList[l].push(loopToPoints(verts));
    }

    function loopToPoints(verts) {
      const n = verts.length;
      let j0 = -1;
      for (let i = 0; i < n; i++) if (junction(verts[i])) { j0 = i; break; }
      if (j0 < 0) {
        // closed border with no junction (an island): canonical start + direction
        let mi = 0;
        for (let i = 1; i < n; i++) if (verts[i] < verts[mi]) mi = i;
        const fwd = verts[(mi + 1) % n] < verts[(mi - 1 + n) % n];
        const canon = new Array(n);
        for (let i = 0; i < n; i++) canon[i] = verts[(mi + (fwd ? i : -i) + n * 2) % n];
        const key = canon[0] * 4 + dirOf(canon[1] - canon[0]);
        let pts = chainCache.get(key);
        if (!pts) { pts = smoothChain(canon, true); chainCache.set(key, pts); }
        return fwd ? pts : reversePts(pts);
      }
      const out = [];
      let chain = [verts[j0]];
      for (let k = 1; k <= n; k++) {
        const v = verts[(j0 + k) % n];
        chain.push(v);
        if (k === n || junction(v)) {
          const a = chain[0], b = chain[chain.length - 1];
          const fwd = a < b || (a === b && chain[1] < chain[chain.length - 2]);
          const canon = fwd ? chain : chain.slice().reverse();
          const key = canon[0] * 4 + dirOf(canon[1] - canon[0]);
          let pts = chainCache.get(key);
          if (!pts) { pts = smoothChain(canon, false); chainCache.set(key, pts); }
          const seg = fwd ? pts : reversePts(pts);
          for (let i = 0; i < seg.length - 2; i++) out.push(seg[i]); // drop the shared end point
          chain = [v];
        }
      }
      return out;
    }

    function reversePts(p) {
      const o = new Array(p.length);
      for (let i = 0; i < p.length; i += 2) { o[p.length - 2 - i] = p[i]; o[p.length - 1 - i] = p[i + 1]; }
      return o;
    }

    function smoothChain(vs, closed) {
      const n = vs.length;
      const X = v => v % W1, Y = v => (v - (v % W1)) / W1;
      let pts = [];
      if (!closed) pts.push(X(vs[0]), Y(vs[0]));
      const m = closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const a = vs[i], b = vs[(i + 1) % n];
        pts.push((X(a) + X(b)) / 2, (Y(a) + Y(b)) / 2);
      }
      if (!closed) pts.push(X(vs[n - 1]), Y(vs[n - 1]));
      pts = simplify(pts, closed, 0.6);
      pts = cutCorners(pts, closed, 2.2);
      pts = cutCorners(pts, closed, 1.2);
      return pts;
    }

    // flatten
    let total = 0, loops = 0;
    for (let r = 0; r < R; r++) for (const lp of regionLoopsList[r]) { total += lp.length; loops++; }
    const pts = new Float32Array(total);
    const loopStart = new Int32Array(loops + 1);
    const regionLoops = new Int32Array(R + 1);
    let pi = 0, li = 0;
    for (let r = 0; r < R; r++) {
      regionLoops[r] = li;
      for (const lp of regionLoopsList[r]) {
        loopStart[li++] = pi / 2;
        for (let i = 0; i < lp.length; i++) pts[pi++] = lp[i];
      }
    }
    regionLoops[R] = li;
    loopStart[loops] = pi / 2;
    return { pts, loopStart, regionLoops };
  }

  // Douglas–Peucker on a flat [x,y,…] list; the ends of open chains stay fixed
  function simplify(p, closed, eps) {
    const n = p.length / 2;
    if (n < 3) return p;
    const keep = new Uint8Array(n);
    const run = (a, b) => {
      const stack = [a, b];
      while (stack.length) {
        const j = stack.pop(), i = stack.pop();
        const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
        let md = -1, mk = -1;
        for (let k = i + 1; k < j; k++) {
          // distance to the segment's line, or to the point when both ends coincide
          const dd = len > 1e-6
            ? Math.abs((p[k * 2] - ax) * dy - (p[k * 2 + 1] - ay) * dx) / len
            : Math.hypot(p[k * 2] - ax, p[k * 2 + 1] - ay);
          if (dd > md) { md = dd; mk = k; }
        }
        if (md > eps) { keep[mk] = 1; stack.push(i, mk, mk, j); }
      }
    };
    if (closed) {
      let far = 0, fd = -1;
      for (let k = 1; k < n; k++) {
        const d = Math.hypot(p[k * 2] - p[0], p[k * 2 + 1] - p[1]);
        if (d > fd) { fd = d; far = k; }
      }
      keep[0] = keep[far] = 1;
      run(0, far);
      // wrap-around half: copy so indices stay increasing
      const q = [];
      for (let k = far; k < n; k++) q.push(k);
      q.push(0);
      const sub = [];
      for (const k of q) sub.push(p[k * 2], p[k * 2 + 1]);
      const kept = simplify(sub, false, eps);
      const out = [];
      for (let k = 0; k < far; k++) if (keep[k]) out.push(p[k * 2], p[k * 2 + 1]);
      for (let k = 0; k < kept.length - 2; k += 2) out.push(kept[k], kept[k + 1]);
      return out.length >= 6 ? out : p;
    }
    keep[0] = keep[n - 1] = 1;
    run(0, n - 1);
    const out = [];
    for (let k = 0; k < n; k++) if (keep[k]) out.push(p[k * 2], p[k * 2 + 1]);
    return out;
  }

  // Chaikin corner cutting with a capped cut length: rounds staircase corners
  // and small wiggles but keeps big shapes (and the chain ends) where they are
  function cutCorners(p, closed, cap) {
    const n = p.length / 2;
    if (n < 3) return p;
    const out = [];
    if (!closed) out.push(p[0], p[1]);
    const first = closed ? 0 : 1, last = closed ? n : n - 1;
    for (let i = first; i < last; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const x = p[i * 2], y = p[i * 2 + 1];
      const ax = p[a * 2] - x, ay = p[a * 2 + 1] - y, bx = p[b * 2] - x, by = p[b * 2 + 1] - y;
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      const ta = Math.min(0.25, cap / la), tb = Math.min(0.25, cap / lb);
      out.push(x + ax * ta, y + ay * ta, x + bx * tb, y + by * tb);
    }
    if (!closed) out.push(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
    return out;
  }

  return { process };
}

// Runs processing in a Web Worker when possible, main thread otherwise.
const PuzzleProcessor = (function () {
  let worker = null, workerFailed = false, seq = 0;
  const pending = new Map();

  function getWorker() {
    if (worker || workerFailed) return worker;
    try {
      const code = 'const P = (' + createProcessor.toString() + ')();\n' +
        'onmessage = function (e) {\n' +
        '  const m = e.data;\n' +
        '  try {\n' +
        '    const r = P.process(m.width, m.height, m.data, m.opts);\n' +
        '    const t = [r.labels.buffer, r.regionColor.buffer, r.regionLabel.buffer, r.regionBBox.buffer, r.contourPts.buffer, r.loopStart.buffer, r.regionLoops.buffer];\n' +
        '    postMessage({ id: m.id, result: r }, t);\n' +
        '  } catch (err) { postMessage({ id: m.id, error: String(err && err.stack || err) }); }\n' +
        '};';
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = e => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
      };
      worker.onerror = () => {
        workerFailed = true;
        worker = null;
        for (const [, p] of pending) p.retry();
        pending.clear();
      };
    } catch (err) {
      workerFailed = true;
      worker = null;
    }
    return worker;
  }

  let local = null;
  function runLocal(imageData, opts) {
    if (!local) local = createProcessor();
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try { resolve(local.process(imageData.width, imageData.height, imageData.data, opts)); } catch (e) { reject(e); }
      }, 30);
    });
  }

  function process(imageData, opts) {
    const w = getWorker();
    if (!w) return runLocal(imageData, opts);
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, retry: () => runLocal(imageData, opts).then(resolve, reject) });
      const copy = new Uint8ClampedArray(imageData.data);
      w.postMessage({ id, width: imageData.width, height: imageData.height, data: copy, opts }, [copy.buffer]);
    });
  }

  return { process };
})();
