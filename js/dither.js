/*
 * Soft edge dithering for painted regions.
 *
 * Each painted pixel gets an opacity from its distance to the nearest
 * *unpainted* region: solid in the middle of a tile, fading out in a fine
 * dither towards tiles that are still to be done. Borders between two painted
 * tiles stay solid, so the picture knits together as you paint.
 *
 * The result is kept in `canvas` (same size as the hi-res picture) and used
 * as the fill pattern for painted regions.
 */
const DITHER_DEFAULTS = {
  enabled: true,
  pattern: 'bayer',  // 'bayer' (ordered, classic) or 'noise' (soft, organic)
  band: 14,          // fade width, in picture pixels
  minAlpha: 0.35,    // opacity right at an edge that faces an unpainted tile
  dot: 1,            // dither dot size, in hi-res pixels
  gap: 0.55,         // colour of dropped dots: 1 = paper white, lower = pale tint
};

function ditherSettings() {
  return Object.assign({}, DITHER_DEFAULTS, Store.get('dither', {}));
}

const BAYER8 = (function () {
  const m = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // bit-reversal construction of the 8x8 Bayer matrix
      let v = 0, xc = x ^ y, yc = y;
      for (let bit = 0; bit < 3; bit++) {
        v = (v << 2) | (((xc >> bit) & 1) << 1) | ((yc >> bit) & 1);
      }
      m[y * 8 + x] = (v + 0.5) / 64;
    }
  }
  return m;
})();

class EdgeDither {
  constructor(puzzle, hi, painted, settings) {
    this.P = puzzle;
    this.w = puzzle.width; this.h = puzzle.height;
    this.W = hi.width; this.H = hi.height;
    this.painted = painted;
    this.s = settings;
    this.src = hi.getContext('2d').getImageData(0, 0, this.W, this.H).data;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(this.W, this.H);
    this.du = new Float32Array(this.w * this.h);
  }

  // Chamfer distance (picture px) from every pixel to the nearest unpainted
  // pixel, capped at the fade width. Only a window can change after a tap,
  // so an optional rectangle limits the work.
  computeDistance(x0 = 0, y0 = 0, x1 = this.w, y1 = this.h) {
    const { w, h, du, painted } = this, labels = this.P.labels;
    const cap = this.s.band + 2, D = Math.SQRT2;
    // exact region we must refresh (+1 px for bilinear sampling)...
    const ix0 = Math.max(0, Math.floor(x0) - 1), ix1 = Math.min(w, Math.ceil(x1) + 1);
    const iy0 = Math.max(0, Math.floor(y0) - 1), iy1 = Math.min(h, Math.ceil(y1) + 1);
    // ...computed in a window wide enough to contain every source that can reach it
    const m = Math.ceil(cap) + 1;
    const X0 = Math.max(0, ix0 - m), X1 = Math.min(w, ix1 + m);
    const Y0 = Math.max(0, iy0 - m), Y1 = Math.min(h, iy1 + m);
    const ww = X1 - X0, wh = Y1 - Y0;
    if (ww <= 0 || wh <= 0) return;
    if (!this.tmp || this.tmp.length < ww * wh) this.tmp = new Float32Array(ww * wh);
    const t = this.tmp;
    for (let y = 0; y < wh; y++) {
      const row = (Y0 + y) * w + X0;
      for (let x = 0; x < ww; x++) t[y * ww + x] = painted[labels[row + x]] ? cap : 0;
    }
    for (let y = 0; y < wh; y++) {
      for (let x = 0, p = y * ww; x < ww; x++, p++) {
        let v = t[p];
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, t[p - 1] + 1);
        if (y > 0) {
          v = Math.min(v, t[p - ww] + 1);
          if (x > 0) v = Math.min(v, t[p - ww - 1] + D);
          if (x < ww - 1) v = Math.min(v, t[p - ww + 1] + D);
        }
        t[p] = v;
      }
    }
    for (let y = wh - 1; y >= 0; y--) {
      for (let x = ww - 1, p = y * ww + ww - 1; x >= 0; x--, p--) {
        let v = t[p];
        if (v === 0) continue;
        if (x < ww - 1) v = Math.min(v, t[p + 1] + 1);
        if (y < wh - 1) {
          v = Math.min(v, t[p + ww] + 1);
          if (x < ww - 1) v = Math.min(v, t[p + ww + 1] + D);
          if (x > 0) v = Math.min(v, t[p + ww - 1] + D);
        }
        t[p] = v;
      }
    }
    for (let y = iy0; y < iy1; y++) {
      for (let x = ix0; x < ix1; x++) du[y * w + x] = t[(y - Y0) * ww + (x - X0)];
    }
  }

  // Re-render the dithered picture inside a picture-pixel rectangle
  render(x0, y0, x1, y1) {
    const { w, h, W, H, du, painted, src, s } = this;
    const d = this.img.data, labels = this.P.labels, RL = this.P.regionLabel;
    const d32 = this.d32 || (this.d32 = new Uint32Array(d.buffer));
    const s32 = this.s32 || (this.s32 = new Uint32Array(src.buffer, src.byteOffset, W * H));
    const kx = w / W, ky = h / H;
    const X0 = Math.max(0, Math.floor(x0 / kx)), X1 = Math.min(W, Math.ceil(x1 / kx));
    const Y0 = Math.max(0, Math.floor(y0 / ky)), Y1 = Math.min(H, Math.ceil(y1 / ky));
    if (X1 <= X0 || Y1 <= Y0) return;
    const minA = s.minAlpha, gap = s.gap, cap = s.band + 2;
    const WHITE = 0xffffffff;
    // per-column lookups, shared by every row
    const cols = X1 - X0;
    const colX = new Int32Array(cols), colI = new Int32Array(cols), colJ = new Int32Array(cols), colF = new Float32Array(cols);
    for (let X = X0; X < X1; X++) {
      const u = (X + 0.5) * kx - 0.5, xi = Math.max(0, Math.min(w - 1, Math.floor(u)));
      colX[X - X0] = Math.min(w - 1, Math.floor((X + 0.5) * kx));
      colI[X - X0] = xi;
      colJ[X - X0] = Math.min(w - 1, xi + 1);
      colF[X - X0] = Math.max(0, Math.min(1, u - xi));
    }
    const noise = s.pattern === 'noise', dot = s.dot;
    const thr = new Float32Array(cols);
    for (let Y = Y0; Y < Y1; Y++) {
      const v = (Y + 0.5) * ky - 0.5;
      const yi = Math.max(0, Math.min(h - 1, Math.floor(v))), yj = Math.min(h - 1, yi + 1);
      const fy = Math.max(0, Math.min(1, v - yi));
      const ly = Math.min(h - 1, Math.floor((Y + 0.5) * ky)) * w;
      const cy = Math.floor(Y / dot), rowI = yi * w, rowJ = yj * w;
      for (let c = 0; c < cols; c++) {
        const cx = Math.floor((X0 + c) / dot);
        if (noise) {
          const f = 0.06711056 * cx + 0.00583715 * cy;
          const g = 52.9829189 * (f - Math.floor(f));
          thr[c] = g - Math.floor(g);
        } else {
          thr[c] = BAYER8[(cy & 7) * 8 + (cx & 7)];
        }
      }
      let q = Y * W + X0;
      for (let c = 0; c < cols; c++, q++) {
        const r = labels[ly + colX[c]];
        if (!painted[r]) { d32[q] = WHITE; continue; }
        const xi = colI[c], xj = colJ[c];
        const a00 = du[rowI + xi], a01 = du[rowI + xj], a10 = du[rowJ + xi], a11 = du[rowJ + xj];
        // deep inside a painted area: straight copy
        if (a00 >= cap && a01 >= cap && a10 >= cap && a11 >= cap) { d32[q] = s32[q]; continue; }
        const fx = colF[c];
        const dist = (a00 * (1 - fx) + a01 * fx) * (1 - fy) + (a10 * (1 - fx) + a11 * fx) * fy;
        // small tiles fade from their centre; big tiles only near the edge
        const band = Math.max(1.5, Math.min(s.band, RL[r * 3 + 2] * 0.85));
        let t = (dist - 0.5) / band;
        t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
        if (minA + (1 - minA) * t > thr[c]) { d32[q] = s32[q]; continue; }
        const o = q * 4;
        d[o] = src[o] + (255 - src[o]) * gap;
        d[o + 1] = src[o + 1] + (255 - src[o + 1]) * gap;
        d[o + 2] = src[o + 2] + (255 - src[o + 2]) * gap;
        d[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0, X0, Y0, X1 - X0, Y1 - Y0);
  }
}
