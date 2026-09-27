/*
 * Puzzle processor: turns a colour image into a paint-by-number puzzle.
 *
 * Pipeline
 *   1. quantise every pixel to a palette (fixed palette for built-in art,
 *      k-means for photos)
 *   2. smooth the index map and find connected regions
 *   3. repeatedly merge regions that are too small / too thin into their
 *      best neighbour
 *   4. distance transform -> the best spot (and size) for each number
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

  // Perceptual-ish weighted RGB distance
  function dist2(r1, g1, b1, r2, g2, b2) {
    const rm = (r1 + r2) * 0.5;
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
  }

  function assign(data, n, palette) {
    const idx = new Uint16Array(n);
    const k = palette.length;
    const cache = new Map();
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const key = (r << 16) | (g << 8) | b;
      let best = cache.get(key);
      if (best === undefined) {
        let bd = Infinity;
        best = 0;
        for (let c = 0; c < k; c++) {
          const p = palette[c];
          const d = dist2(r, g, b, p[0], p[1], p[2]);
          if (d < bd) { bd = d; best = c; }
        }
        if (cache.size < 200000) cache.set(key, best);
      }
      idx[i] = best;
    }
    return idx;
  }

  function kmeans(data, n, k, seed) {
    const rand = mulberry32(seed);
    const sampleCount = Math.min(n, 30000);
    const samples = new Float32Array(sampleCount * 3);
    for (let s = 0; s < sampleCount; s++) {
      const i = Math.floor(rand() * n) * 4;
      samples[s * 3] = data[i]; samples[s * 3 + 1] = data[i + 1]; samples[s * 3 + 2] = data[i + 2];
    }
    // k-means++ initialisation
    const centers = [];
    const first = Math.floor(rand() * sampleCount);
    centers.push([samples[first * 3], samples[first * 3 + 1], samples[first * 3 + 2]]);
    const dmin = new Float64Array(sampleCount).fill(Infinity);
    while (centers.length < k) {
      const c = centers[centers.length - 1];
      let total = 0;
      for (let s = 0; s < sampleCount; s++) {
        const d = dist2(samples[s * 3], samples[s * 3 + 1], samples[s * 3 + 2], c[0], c[1], c[2]);
        if (d < dmin[s]) dmin[s] = d;
        total += dmin[s];
      }
      if (total === 0) break;
      let t = rand() * total, pick = 0;
      for (let s = 0; s < sampleCount; s++) { t -= dmin[s]; if (t <= 0) { pick = s; break; } }
      centers.push([samples[pick * 3], samples[pick * 3 + 1], samples[pick * 3 + 2]]);
    }
    const kk = centers.length;
    const assignS = new Uint16Array(sampleCount);
    for (let iter = 0; iter < 14; iter++) {
      const sums = new Float64Array(kk * 4);
      for (let s = 0; s < sampleCount; s++) {
        const r = samples[s * 3], g = samples[s * 3 + 1], b = samples[s * 3 + 2];
        let bd = Infinity, best = 0;
        for (let c = 0; c < kk; c++) {
          const p = centers[c];
          const d = dist2(r, g, b, p[0], p[1], p[2]);
          if (d < bd) { bd = d; best = c; }
        }
        assignS[s] = best;
        sums[best * 4] += r; sums[best * 4 + 1] += g; sums[best * 4 + 2] += b; sums[best * 4 + 3]++;
      }
      for (let c = 0; c < kk; c++) {
        const cnt = sums[c * 4 + 3];
        if (cnt > 0) centers[c] = [sums[c * 4] / cnt, sums[c * 4 + 1] / cnt, sums[c * 4 + 2] / cnt];
      }
    }
    return centers.map(c => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
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
    for (let pass = 0; pass < 8; pass++) {
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
   *   palette   – optional [[r,g,b],…] fixed palette (built-in artwork)
   *   colors    – k for k-means when no palette given
   *   minArea   – minimum region size in px
   *   minThick  – minimum inscribed radius in px
   *   smooth    – run blur + mode filters (photos)
   */
  function process(width, height, data, opts) {
    const w = width, h = height, n = w * h;
    let src = data;
    if (opts.smooth) src = boxBlur(data, w, h);

    const palette = opts.palette || kmeans(src, n, opts.colors || 20, 1234567);
    let idx = assign(src, n, palette);
    if (opts.smooth) { idx = modeFilter(idx, w, h); idx = modeFilter(idx, w, h); }

    const lab = mergeSmall(idx, w, h, opts.minArea || 30, opts.minThick || 1.8);

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

    // pixels grouped by region (counting sort) + bounding boxes
    const start = new Int32Array(R + 1);
    for (let p = 0; p < n; p++) start[labels[p] + 1]++;
    for (let r = 0; r < R; r++) start[r + 1] += start[r];
    const fill = start.slice(0, R);
    const pix = new Int32Array(n);
    const bbox = new Int32Array(R * 4);
    for (let r = 0; r < R; r++) { bbox[r * 4] = w; bbox[r * 4 + 1] = h; bbox[r * 4 + 2] = -1; bbox[r * 4 + 3] = -1; }
    for (let p = 0; p < n; p++) {
      const r = labels[p];
      pix[fill[r]++] = p;
      const x = p % w, y = (p - x) / w, o = r * 4;
      if (x < bbox[o]) bbox[o] = x;
      if (y < bbox[o + 1]) bbox[o + 1] = y;
      if (x > bbox[o + 2]) bbox[o + 2] = x;
      if (y > bbox[o + 3]) bbox[o + 3] = y;
    }

    return {
      width: w, height: h, regionCount: R,
      palette: finalPalette,
      labels, regionColor, regionLabel, regionStart: start, regionPix: pix, regionBBox: bbox,
    };
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
        '    postMessage({ id: m.id, result: r }, [r.labels.buffer, r.regionColor.buffer, r.regionLabel.buffer, r.regionStart.buffer, r.regionPix.buffer, r.regionBBox.buffer]);\n' +
        '  } catch (err) { postMessage({ id: m.id, error: String(err) }); }\n' +
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
