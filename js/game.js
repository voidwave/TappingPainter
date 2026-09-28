/*
 * The painting screen: canvas rendering, pan / pinch-zoom, tap-to-fill,
 * palette, hints, saving and the finish celebration.
 *
 * Rendering is vector based: every region has a smoothed outline (Path2D).
 * Painted regions reveal the high-resolution picture through those paths; outlines, highlights and numbers are
 * drawn fresh at screen resolution each frame, so they stay crisp at any zoom.
 */
const HIGHLIGHT = '#d9d5df';
const MAX_HI_PIXELS = 4.2e6;

class Game {
  constructor(el, callbacks) {
    this.el = el;
    this.cb = callbacks;
    this.canvas = el.querySelector('#canvas');
    this.ctx = this.canvas.getContext('2d');
    this.stage = el.querySelector('#stage');
    this.paletteEl = el.querySelector('#palette');
    this.progFill = el.querySelector('#progFill');
    this.progText = el.querySelector('#progText');
    this.hintCount = el.querySelector('#hintCount');
    this.loadingEl = el.querySelector('#loading');
    this.doneEl = el.querySelector('#done');
    this.titleEl = el.querySelector('#gameTitle');

    this.dpr = 1;
    this.vw = 1; this.vh = 1;
    this.view = { s: 1, tx: 0, ty: 0 };
    this.pointers = new Map();
    this.gesture = null;
    this.anims = [];
    this.ripples = [];
    this.petals = [];
    this.flash = null;
    this.pulse = null;
    this.viewAnim = null;
    this.timelapse = null;
    this.rafId = 0;
    this.puzzle = null;
    this.cache = new Map();

    this.bindInput();
    el.querySelector('#backBtn').addEventListener('click', () => this.cb.onBack());
    el.querySelector('#hintBtn').addEventListener('click', () => this.useHint());
    el.querySelector('#fitBtn').addEventListener('click', () => this.animateViewTo(this.fitView()));
    const soundBtn = el.querySelector('#soundBtn');
    const syncSound = () => soundBtn.classList.toggle('off', Sound.muted);
    soundBtn.addEventListener('click', () => { Sound.toggle(); syncSound(); });
    syncSound();
    el.querySelector('#replayBtn').addEventListener('click', () => this.startTimelapse());
    el.querySelector('#saveImgBtn').addEventListener('click', () => this.downloadImage());
    el.querySelector('#galleryBtn').addEventListener('click', () => this.cb.onBack());

    new ResizeObserver(() => this.resize()).observe(this.stage);
  }

  // ------------------------------------------------------------------ loading
  async open(entry) {
    this.entry = entry;
    this.puzzle = null;
    this.titleEl.textContent = entry.title;
    this.doneEl.classList.remove('show');
    this.paletteEl.innerHTML = '';
    this.loadingEl.classList.add('show');
    this.anims = []; this.ripples = []; this.petals = [];
    this.flash = null; this.pulse = null; this.viewAnim = null; this.timelapse = null;
    this.updateHints();
    this.draw();

    let data = this.cache.get(entry.id);
    if (!data) {
      const src = await entry.loadSource();
      const base = src.base;
      const baseData = base.getContext('2d').getImageData(0, 0, base.width, base.height);
      const hi = src.hi(MAX_HI_PIXELS);
      const puzzle = await PuzzleProcessor.process(baseData, entry.opts);
      data = { puzzle, hi };
      // hi-res images are big: keep only the two most recent pictures around
      this.cache.set(entry.id, data);
      while (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value);
    }
    if (this.entry !== entry) return; // user left while we were processing
    this.setup(data.puzzle, data.hi);
    this.loadingEl.classList.remove('show');
  }

  setup(puzzle, hi) {
    this.puzzle = puzzle;
    this.hi = hi;
    const { width: w, height: h, regionCount: R, labels, regionColor, palette } = puzzle;
    this.w = w; this.h = h;
    this.K = hi.width / w;

    this.paths = new Array(R);
    this.lineCss = palette.map(c => {
      const m = c.map(v => Math.round(v * 0.45 + 150 * 0.55));
      return `rgb(${m[0]},${m[1]},${m[2]})`;
    });
    this.colorRegions = palette.map(() => []);
    for (let r = 0; r < R; r++) this.colorRegions[regionColor[r]].push(r);

    this.painted = new Uint8Array(R);
    this.order = [];
    this.colorTotal = new Int32Array(palette.length);
    this.colorDone = new Int32Array(palette.length);
    for (let r = 0; r < R; r++) this.colorTotal[regionColor[r]]++;

    // restore progress (stored as each region's label pixel, which is robust)
    const saved = Store.progress(this.entry.id);
    if (saved && saved.pts) {
      for (const pt of saved.pts) {
        if (pt < 0 || pt >= labels.length) continue;
        const r = labels[pt];
        if (this.painted[r]) continue;
        this.painted[r] = 1;
        this.order.push(r);
        this.colorDone[regionColor[r]]++;
      }
    }

    this.layer = document.createElement('canvas');
    this.layer.width = hi.width; this.layer.height = hi.height;
    this.layerCtx = this.layer.getContext('2d');
    this.solidPattern = this.layerCtx.createPattern(hi, 'no-repeat');
    this.ditherDirty = null;
    this.rebuildLayer();

    this.selected = this.nextColor(-1);
    this.buildPalette();
    this.updateProgress();
    this.view = this.fitView();
    this.clampView();
    if (this.isComplete()) this.showDone();
    this.draw();
  }

  // ---------------------------------------------------------------- rendering
  // Smoothed outline of a region, in hi-res layer coordinates
  path(r) {
    let p = this.paths[r];
    if (p) return p;
    const P = this.puzzle, pts = P.contourPts, K = this.K;
    p = new Path2D();
    for (let l = P.regionLoops[r]; l < P.regionLoops[r + 1]; l++) {
      const s = P.loopStart[l], e = P.loopStart[l + 1];
      if (e - s < 2) continue;
      p.moveTo(pts[s * 2] * K, pts[s * 2 + 1] * K);
      for (let i = s + 1; i < e; i++) p.lineTo(pts[i * 2] * K, pts[i * 2 + 1] * K);
      p.closePath();
    }
    this.paths[r] = p;
    return p;
  }

  // Painted regions are filled from either the plain picture or its
  // edge-dithered version (see dither.js)
  rebuildLayer() {
    const s = ditherSettings();
    this.dither = s.enabled && !this.isComplete()
      ? new EdgeDither(this.puzzle, this.hi, this.painted, s) : null;
    if (this.dither) {
      this.dither.computeDistance();
      this.dither.render(0, 0, this.w, this.h);
      this.pattern = this.layerCtx.createPattern(this.dither.canvas, 'no-repeat');
    } else {
      this.pattern = this.solidPattern;
    }
    this.ditherDirty = null;
    this.clearLayer();
    if (this.isComplete()) this.layerCtx.drawImage(this.hi, 0, 0);
    else for (const r of this.order) this.paintRegion(r);
    this.draw();
  }

  // A newly painted region changes the fade of every painted pixel near it
  markDitherDirty(r) {
    if (!this.dither) return;
    const bb = this.puzzle.regionBBox, o = r * 4, m = this.dither.s.band + 3;
    const rect = [bb[o] - m, bb[o + 1] - m, bb[o + 2] + 1 + m, bb[o + 3] + 1 + m];
    const d = this.ditherDirty;
    this.ditherDirty = d
      ? [Math.min(d[0], rect[0]), Math.min(d[1], rect[1]), Math.max(d[2], rect[2]), Math.max(d[3], rect[3])]
      : rect;
  }

  flushDither() {
    const [x0, y0, x1, y1] = this.ditherDirty;
    this.ditherDirty = null;
    const d = this.dither, P = this.puzzle, bb = P.regionBBox, K = this.K;
    d.computeDistance(x0, y0, x1, y1);
    d.render(x0, y0, x1, y1);
    this.pattern = this.layerCtx.createPattern(d.canvas, 'no-repeat');
    // repaint the settled regions inside the rectangle; animating ones redraw themselves
    const busy = new Set(this.anims.map(a => a.r));
    const c = this.layerCtx;
    c.save();
    c.beginPath();
    c.rect(x0 * K, y0 * K, (x1 - x0) * K, (y1 - y0) * K);
    c.clip();
    c.fillStyle = '#ffffff';
    c.fillRect(x0 * K, y0 * K, (x1 - x0) * K, (y1 - y0) * K);
    for (const r of this.order) {
      const o = r * 4;
      if (busy.has(r) || bb[o + 2] + 1 < x0 || bb[o] > x1 || bb[o + 3] + 1 < y0 || bb[o + 1] > y1) continue;
      this.paintRegion(r);
    }
    c.restore();
  }

  clearLayer() {
    this.layerCtx.fillStyle = '#ffffff';
    this.layerCtx.fillRect(0, 0, this.layer.width, this.layer.height);
  }

  // Reveal a region of the hi-res picture. The thin stroke overlaps the
  // neighbours slightly so two painted regions never show a hairline seam.
  paintRegion(r) {
    const c = this.layerCtx, p = this.path(r);
    c.fillStyle = this.pattern;
    c.fill(p, 'evenodd');
    c.strokeStyle = this.pattern;
    c.lineWidth = 1;
    c.lineJoin = 'round';
    c.stroke(p);
  }

  // Part of the reveal animation: only inside a growing circle
  paintPartial(r, x, y, rad) {
    const c = this.layerCtx, K = this.K;
    c.save();
    c.beginPath();
    c.arc(x * K, y * K, rad * K, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = this.pattern;
    c.fill(this.path(r), 'evenodd');
    c.restore();
  }

  resize() {
    const rect = this.stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const oldFit = this.puzzle ? this.fitView() : null;
    const wasFit = oldFit && Math.abs(this.view.s - oldFit.s) < 1e-6;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.vw = rect.width; this.vh = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    if (this.puzzle) {
      if (wasFit) this.view = this.fitView();
      this.clampView();
    }
    this.draw();
  }

  fitView() {
    const pad = 16;
    const s = Math.min((this.vw - pad * 2) / this.w, (this.vh - pad * 2) / this.h);
    return { s, tx: (this.vw - this.w * s) / 2, ty: (this.vh - this.h * s) / 2 };
  }

  get minScale() { return this.fitView().s * 0.8; }
  get maxScale() { return Math.max(this.fitView().s * 14, 12); }

  clampView() {
    const v = this.view;
    v.s = Math.max(this.minScale, Math.min(this.maxScale, v.s));
    const W = this.w * v.s, H = this.h * v.s, m = 80;
    if (W <= this.vw) v.tx = (this.vw - W) / 2;
    else v.tx = Math.min(m, Math.max(this.vw - W - m, v.tx));
    if (H <= this.vh) v.ty = (this.vh - H) / 2;
    else v.ty = Math.min(m, Math.max(this.vh - H - m, v.ty));
  }

  draw() {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(t => { this.rafId = 0; this.frame(t); });
  }

  frame(now) {
    const again = this.step(now);
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    if (!this.puzzle) return;
    const v = this.view;

    // the picture, with a soft paper shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#fff';
    ctx.fillRect(v.tx, v.ty, this.w * v.s, this.h * v.s);
    ctx.restore();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.layer, v.tx, v.ty, this.w * v.s, this.h * v.s);

    if (!this.timelapse) {
      this.drawOutlines(v);
      this.drawNumbers(now);
    }

    for (const rp of this.ripples) {
      const t = Math.max(0, (now - rp.start) / 600);
      ctx.strokeStyle = `rgba(${rp.c[0]},${rp.c[1]},${rp.c[2]},${(1 - t) * 0.8})`;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 10 + t * 50, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.pulse) {
      const p = this.pulse, L = this.puzzle.regionLabel;
      const x = L[p.r * 3] * v.s + v.tx, y = L[p.r * 3 + 1] * v.s + v.ty;
      const base = Math.max(22, L[p.r * 3 + 2] * v.s * 1.2);
      const k = ((now - p.start) % 900) / 900;
      ctx.strokeStyle = `rgba(255, 196, 64, ${1 - k})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, base + k * 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 196, 64, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, base, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.petals.length) this.drawPetals(ctx);
    if (again) this.draw();
  }

  // Highlight + outlines of the unpainted regions that are on screen
  drawOutlines(v) {
    const ctx = this.ctx, P = this.puzzle, bb = P.regionBBox, K = this.K;
    const m = this.dpr * v.s / K;
    ctx.setTransform(m, 0, 0, m, this.dpr * v.tx, this.dpr * v.ty);
    const x0 = -v.tx / v.s, y0 = -v.ty / v.s, x1 = (this.vw - v.tx) / v.s, y1 = (this.vh - v.ty) / v.s;
    const visible = r => {
      const o = r * 4;
      return bb[o + 2] + 1 >= x0 && bb[o] <= x1 && bb[o + 3] + 1 >= y0 && bb[o + 1] <= y1;
    };
    if (this.selected >= 0) {
      ctx.fillStyle = HIGHLIGHT;
      for (const r of this.colorRegions[this.selected]) {
        if (!this.painted[r] && visible(r)) ctx.fill(this.path(r), 'evenodd');
      }
    }
    ctx.lineWidth = 1.15 * K / v.s;
    ctx.lineJoin = 'round';
    for (let c = 0; c < this.colorRegions.length; c++) {
      ctx.strokeStyle = this.lineCss[c];
      for (const r of this.colorRegions[c]) {
        if (!this.painted[r] && visible(r)) ctx.stroke(this.path(r));
      }
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // advances animations; returns true while anything is still moving
  step(now) {
    let active = false;
    if (this.ditherDirty && this.dither) this.flushDither();
    if (this.viewAnim) {
      const a = this.viewAnim;
      const t = Math.min(1, (now - a.start) / a.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const s = Math.exp(Math.log(a.from.s) + (Math.log(a.to.s) - Math.log(a.from.s)) * e);
      const cx = a.fc.x + (a.tc.x - a.fc.x) * e, cy = a.fc.y + (a.tc.y - a.fc.y) * e;
      this.view = { s, tx: this.vw / 2 - cx * s, ty: this.vh / 2 - cy * s };
      if (t >= 1) { this.view = { ...a.to }; this.viewAnim = null; } else active = true;
    }
    if (this.anims.length) {
      const keep = [];
      for (const an of this.anims) {
        // rAF timestamps can be slightly older than the tap's performance.now()
        const t = Math.max(0, Math.min(1, (now - an.start) / an.dur));
        if (t >= 1) {
          this.paintRegion(an.r);
        } else {
          this.paintPartial(an.r, an.x, an.y, an.maxR * (1 - Math.pow(1 - t, 3)));
          keep.push(an);
        }
      }
      this.anims = keep;
      active = active || keep.length > 0;
    }
    if (this.ripples.length) {
      this.ripples = this.ripples.filter(r => now - r.start < 600);
      active = active || this.ripples.length > 0;
    }
    if (this.flash) {
      if (now > this.flash.until) this.flash = null; else active = true;
    }
    if (this.pulse) {
      if (now - this.pulse.start > 3000 || this.painted[this.pulse.r]) this.pulse = null; else active = true;
    }
    if (this.timelapse) { this.stepTimelapse(now); active = true; }
    if (this.petals.length) {
      for (const p of this.petals) {
        p.y += p.vy; p.x += Math.sin(now / 600 + p.ph) * 0.8 + p.vx; p.rot += p.vr;
      }
      this.petals = this.petals.filter(p => p.y < this.vh + 30);
      active = active || this.petals.length > 0;
    }
    return active;
  }

  drawNumbers() {
    const ctx = this.ctx, v = this.view, P = this.puzzle, L = P.regionLabel;
    const fontCache = this._fontCache || (this._fontCache = {});
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let lastFont = '';
    for (let r = 0; r < P.regionCount; r++) {
      if (this.painted[r]) continue;
      const rad = L[r * 3 + 2] * v.s;
      const col = P.regionColor[r];
      const label = col + 1;
      const fs = Math.min(rad * (label > 9 ? 1.05 : 1.35), 44);
      if (fs < 7) continue;
      const x = L[r * 3] * v.s + v.tx, y = L[r * 3 + 1] * v.s + v.ty;
      if (x < -fs || y < -fs || x > this.vw + fs || y > this.vh + fs) continue;
      const hl = col === this.selected;
      const size = Math.round(fs);
      const key = size + (hl ? 'b' : 'n');
      const font = fontCache[key] || (fontCache[key] = `${hl ? 600 : 400} ${size}px ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif`);
      if (font !== lastFont) { ctx.font = font; lastFont = font; }
      if (this.flash && this.flash.r === r) {
        ctx.fillStyle = 'rgba(232, 80, 80, 0.18)';
        ctx.beginPath(); ctx.arc(x, y, fs * 0.9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d64545';
      } else {
        ctx.fillStyle = hl ? '#2e2a36' : '#8a8592';
      }
      ctx.fillText(String(label), x, y + fs * 0.04);
    }
  }

  // -------------------------------------------------------------------- input
  bindInput() {
    const c = this.canvas;
    const pos = e => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', e => {
      if (!this.puzzle || this.timelapse) return;
      Sound.unlock();
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const p = pos(e);
      this.pointers.set(e.pointerId, p);
      this.viewAnim = null;
      if (this.pointers.size === 1) {
        this.gesture = { type: 'tap', sx: p.x, sy: p.y, last: p };
        clearTimeout(this.lpTimer);
        this.lpTimer = setTimeout(() => {
          if (this.gesture && this.gesture.type === 'tap') {
            this.gesture.type = 'brush';
            if (navigator.vibrate) navigator.vibrate(10);
            this.paintAt(p.x, p.y, false);
          }
        }, 420);
      } else if (this.pointers.size === 2) {
        clearTimeout(this.lpTimer);
        const [a, b] = [...this.pointers.values()];
        this.gesture = {
          type: 'pinch',
          d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          v0: { ...this.view },
        };
      }
    });
    c.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = pos(e);
      const prev = this.pointers.get(e.pointerId);
      this.pointers.set(e.pointerId, p);
      const g = this.gesture;
      if (!g) return;
      if (g.type === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const s = Math.max(this.minScale, Math.min(this.maxScale, g.v0.s * d / g.d0));
        const mx = (g.m0.x - g.v0.tx) / g.v0.s, my = (g.m0.y - g.v0.ty) / g.v0.s;
        this.view = { s, tx: m.x - mx * s, ty: m.y - my * s };
        this.clampView();
        this.draw();
      } else if (g.type === 'tap') {
        if (Math.hypot(p.x - g.sx, p.y - g.sy) > 10) {
          clearTimeout(this.lpTimer);
          g.type = 'pan';
          this.view.tx += p.x - g.sx; this.view.ty += p.y - g.sy;
          this.clampView();
          this.draw();
        }
      } else if (g.type === 'pan') {
        this.view.tx += p.x - prev.x; this.view.ty += p.y - prev.y;
        this.clampView();
        this.draw();
      } else if (g.type === 'brush') {
        const dist = Math.hypot(p.x - g.last.x, p.y - g.last.y);
        const steps = Math.max(1, Math.ceil(dist / 4));
        for (let i = 1; i <= steps; i++) {
          this.paintAt(g.last.x + (p.x - g.last.x) * i / steps, g.last.y + (p.y - g.last.y) * i / steps, false, true);
        }
        g.last = p;
      }
    });
    const up = e => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      clearTimeout(this.lpTimer);
      const g = this.gesture;
      if (g && g.type === 'tap' && e.type === 'pointerup') this.paintAt(p.x, p.y, true);
      if (this.pointers.size === 1 && g && g.type === 'pinch') {
        this.gesture = { type: 'pan' };
      } else if (this.pointers.size === 0) {
        this.gesture = null;
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      if (!this.puzzle) return;
      e.preventDefault();
      const p = pos(e);
      // trackpad pinch arrives as ctrl+wheel; a mouse wheel zooms; two-finger scroll pans
      if (e.ctrlKey || !this.isTrackpadPan(e)) {
        const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        this.zoomAt(p.x, p.y, k);
      } else {
        this.view.tx -= e.deltaX; this.view.ty -= e.deltaY;
        this.clampView();
        this.draw();
      }
    }, { passive: false });
    // Safari's own pinch gesture would zoom the whole page
    for (const t of ['gesturestart', 'gesturechange']) c.addEventListener(t, e => e.preventDefault());
  }

  // Two-finger scrolling on a trackpad sends small pixel deltas on both axes.
  isTrackpadPan(e) {
    return e.deltaMode === 0 && (Math.abs(e.deltaX) > 0.5 || (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)));
  }

  zoomAt(x, y, k) {
    const v = this.view;
    const s = Math.max(this.minScale, Math.min(this.maxScale, v.s * k));
    const mx = (x - v.tx) / v.s, my = (y - v.ty) / v.s;
    this.view = { s, tx: x - mx * s, ty: y - my * s };
    this.clampView();
    this.draw();
  }

  // --------------------------------------------------------------- gameplay
  paintAt(sx, sy, smart, quiet) {
    if (!this.puzzle || this.selected < 0) return;
    const v = this.view, P = this.puzzle, w = this.w, h = this.h;
    const mx = Math.floor((sx - v.tx) / v.s), my = Math.floor((sy - v.ty) / v.s);
    if (mx < 0 || my < 0 || mx >= w || my >= h) return;
    const r = P.labels[my * w + mx];
    if (!this.painted[r] && P.regionColor[r] === this.selected) {
      this.fill(r, mx, my, sx, sy);
      return;
    }
    if (!smart) return;
    // forgiving taps: look for a matching region under the fingertip
    const rad = Math.max(2, Math.round(14 / v.s));
    let best = -1, bd = Infinity, bx = 0, by = 0;
    for (let y = Math.max(0, my - rad); y <= Math.min(h - 1, my + rad); y++) {
      for (let x = Math.max(0, mx - rad); x <= Math.min(w - 1, mx + rad); x++) {
        const rr = P.labels[y * w + x];
        if (this.painted[rr] || P.regionColor[rr] !== this.selected) continue;
        const d = (x - mx) * (x - mx) + (y - my) * (y - my);
        if (d < bd && d <= rad * rad) { bd = d; best = rr; bx = x; by = y; }
      }
    }
    if (best >= 0) {
      this.fill(best, bx, by, sx, sy);
    } else if (!this.painted[r] && !quiet) {
      this.flash = { r, until: performance.now() + 900 };
      Sound.wrong();
      const sw = this.paletteEl.querySelector(`[data-color="${P.regionColor[r]}"]`);
      if (sw) { sw.classList.remove('nudge'); void sw.offsetWidth; sw.classList.add('nudge'); }
      this.draw();
    }
  }

  fill(r, mx, my, sx, sy) {
    const P = this.puzzle, bb = P.regionBBox, o = r * 4;
    this.painted[r] = 1;
    this.order.push(r);
    this.markDitherDirty(r);
    const col = P.regionColor[r];
    this.colorDone[col]++;
    const far = Math.max(
      Math.hypot(bb[o] - mx, bb[o + 1] - my), Math.hypot(bb[o + 2] + 1 - mx, bb[o + 1] - my),
      Math.hypot(bb[o] - mx, bb[o + 3] + 1 - my), Math.hypot(bb[o + 2] + 1 - mx, bb[o + 3] + 1 - my)) + 2;
    const now = performance.now();
    this.anims.push({ r, x: mx + 0.5, y: my + 0.5, maxR: far, start: now, dur: Math.min(700, 260 + far * 1.2) });
    this.ripples.push({ x: sx, y: sy, start: now, c: P.palette[col] });
    Sound.fill();
    this.updateSwatch(col);
    this.updateProgress();
    this.scheduleSave();
    if (this.colorDone[col] === this.colorTotal[col]) {
      setTimeout(() => Sound.colorDone(), 150);
      Store.setHints(Store.hints() + 1);
      this.updateHints();
      if (this.isComplete()) {
        this.selected = -1;
        setTimeout(() => this.finish(), 800);
      } else {
        this.select(this.nextColor(col));
      }
    }
    this.draw();
  }

  nextColor(from) {
    const n = this.puzzle.palette.length;
    for (let i = 1; i <= n; i++) {
      const c = (from + i + n) % n;
      if (this.colorDone[c] < this.colorTotal[c]) return c;
    }
    return -1;
  }

  isComplete() { return this.order.length === this.puzzle.regionCount; }

  select(col) {
    if (col === this.selected) return;
    this.selected = col;
    for (const sw of this.paletteEl.children) sw.classList.toggle('selected', +sw.dataset.color === col);
    const sw = this.paletteEl.querySelector(`[data-color="${col}"]`);
    if (sw) sw.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    this.draw();
  }

  useHint() {
    if (!this.puzzle || this.isComplete()) return;
    const hints = Store.hints();
    if (hints <= 0) { this.cb.toast('No hints left – finish a colour to earn more'); return; }
    const P = this.puzzle, L = P.regionLabel, v = this.view;
    const cx = (this.vw / 2 - v.tx) / v.s, cy = (this.vh / 2 - v.ty) / v.s;
    let best = -1, bd = Infinity;
    const want = this.selected >= 0 && this.colorDone[this.selected] < this.colorTotal[this.selected] ? this.selected : -1;
    for (let r = 0; r < P.regionCount; r++) {
      if (this.painted[r] || (want >= 0 && P.regionColor[r] !== want)) continue;
      const d = Math.hypot(L[r * 3] - cx, L[r * 3 + 1] - cy);
      if (d < bd) { bd = d; best = r; }
    }
    if (best < 0) return;
    Store.setHints(hints - 1);
    this.updateHints();
    Sound.hint();
    this.select(P.regionColor[best]);
    const fit = this.fitView();
    const s = Math.max(v.s, Math.min(this.maxScale, Math.max(fit.s, 20 / Math.max(1, L[best * 3 + 2]))));
    this.animateViewTo({ s, tx: this.vw / 2 - L[best * 3] * s, ty: this.vh / 2 - L[best * 3 + 1] * s });
    this.pulse = { r: best, start: performance.now() };
  }

  animateViewTo(to) {
    const saved = this.view;
    this.view = { ...to };
    this.clampView();
    const target = this.view;
    this.view = saved;
    const f = this.view;
    this.viewAnim = {
      from: { ...f }, to: target, start: performance.now(), dur: 650,
      fc: { x: (this.vw / 2 - f.tx) / f.s, y: (this.vh / 2 - f.ty) / f.s },
      tc: { x: (this.vw / 2 - target.tx) / target.s, y: (this.vh / 2 - target.ty) / target.s },
    };
    this.draw();
  }

  // --------------------------------------------------------------------- UI
  buildPalette() {
    const P = this.puzzle;
    this.paletteEl.innerHTML = '';
    P.palette.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.color = i;
      const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      b.style.setProperty('--c', `rgb(${c[0]},${c[1]},${c[2]})`);
      b.style.setProperty('--ink', lum > 150 ? '#2b2833' : '#ffffff');
      b.innerHTML = `<span class="ring"></span><span class="dot">${i + 1}</span>`;
      b.setAttribute('aria-label', `Colour ${i + 1}`);
      b.addEventListener('click', () => { Sound.unlock(); this.select(i); });
      this.paletteEl.appendChild(b);
      this.updateSwatch(i);
    });
    for (const sw of this.paletteEl.children) sw.classList.toggle('selected', +sw.dataset.color === this.selected);
  }

  updateSwatch(col) {
    const sw = this.paletteEl.querySelector(`[data-color="${col}"]`);
    if (!sw) return;
    const p = this.colorTotal[col] ? this.colorDone[col] / this.colorTotal[col] : 1;
    sw.style.setProperty('--p', p.toFixed(3));
    sw.classList.toggle('done', p >= 1);
  }

  updateProgress() {
    const pct = this.puzzle ? Math.floor(100 * this.order.length / this.puzzle.regionCount) : 0;
    this.progFill.style.width = pct + '%';
    this.progText.textContent = pct + '%';
  }

  updateHints() { this.hintCount.textContent = Store.hints(); }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 500);
  }

  save(withThumb) {
    if (!this.puzzle || !this.entry || this.sandbox) return;
    clearTimeout(this.saveTimer);
    const P = this.puzzle, L = P.regionLabel, w = this.w;
    const pts = this.order.map(r => Math.floor(L[r * 3 + 1]) * w + Math.floor(L[r * 3]));
    Store.saveProgress(this.entry.id, { v: 2, pts });
    const pct = Math.floor(100 * this.order.length / P.regionCount);
    Store.saveMeta(this.entry.id, { pct, done: this.isComplete() });
    if (withThumb) Store.saveThumb(this.entry.id, this.thumbnail());
  }

  thumbnail() {
    const size = 320;
    const c = document.createElement('canvas');
    const k = size / Math.max(this.layer.width, this.layer.height);
    c.width = Math.round(this.layer.width * k); c.height = Math.round(this.layer.height * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.layer, 0, 0, c.width, c.height);
    // faint outlines so an unfinished thumbnail still reads as a picture
    if (!this.isComplete()) {
      ctx.setTransform(c.width / this.layer.width, 0, 0, c.height / this.layer.height, 0, 0);
      ctx.lineWidth = this.layer.width / c.width * 0.6;
      ctx.strokeStyle = 'rgba(120,115,130,0.55)';
      for (let r = 0; r < this.puzzle.regionCount; r++) if (!this.painted[r]) ctx.stroke(this.path(r));
    }
    return c.toDataURL('image/jpeg', 0.82);
  }

  close() {
    if (this.puzzle && this.order.length) this.save(true);
    this.entry = null;
    this.timelapse = null;
    this.petals = [];
    this.doneEl.classList.remove('show');
  }

  // ------------------------------------------------------------ tuning aids
  // Paint a random share of the picture instantly (tune mode only)
  paintRandom(share) {
    if (!this.puzzle) return;
    const P = this.puzzle, todo = [];
    for (let r = 0; r < P.regionCount; r++) if (!this.painted[r]) todo.push(r);
    let n = Math.min(todo.length - 1, Math.round(P.regionCount * share));
    while (n-- > 0) {
      const i = Math.floor(Math.random() * todo.length);
      const r = todo.splice(i, 1)[0];
      this.painted[r] = 1;
      this.order.push(r);
      this.colorDone[P.regionColor[r]]++;
    }
    for (let c = 0; c < P.palette.length; c++) this.updateSwatch(c);
    if (this.selected >= 0 && this.colorDone[this.selected] >= this.colorTotal[this.selected]) this.select(this.nextColor(this.selected));
    this.updateProgress();
    this.rebuildLayer();
  }

  // ----------------------------------------------------------------- finish
  finish() {
    // swap in the whole picture: seamless, with every tiny detail
    this.anims = [];
    this.dither = null;
    this.pattern = this.solidPattern;
    this.layerCtx.drawImage(this.hi, 0, 0);
    this.save(true);
    Store.setHints(Store.hints() + 3);
    this.updateHints();
    Sound.finished();
    this.animateViewTo(this.fitView());
    this.spawnPetals();
    setTimeout(() => this.showDone(), 900);
  }

  showDone() {
    this.doneEl.classList.add('show');
  }

  spawnPetals() {
    const cols = this.puzzle.palette;
    for (let i = 0; i < 70; i++) {
      const c = cols[Math.floor(Math.random() * cols.length)];
      this.petals.push({
        x: Math.random() * this.vw, y: -20 - Math.random() * this.vh * 0.8,
        vy: 1.2 + Math.random() * 2, vx: (Math.random() - 0.5) * 0.6,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.08,
        ph: Math.random() * 6, s: 5 + Math.random() * 6, c: `rgb(${c[0]},${c[1]},${c[2]})`,
      });
    }
    this.draw();
  }

  drawPetals(ctx) {
    for (const p of this.petals) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  startTimelapse() {
    if (!this.puzzle) return;
    this.doneEl.classList.remove('show');
    this.petals = [];
    this.pattern = this.solidPattern;
    this.clearLayer();
    const total = this.order.length;
    this.timelapse = { i: 0, start: performance.now(), dur: Math.min(9000, Math.max(3000, total * 30)) };
    this.view = this.fitView();
    this.draw();
  }

  stepTimelapse(now) {
    const tl = this.timelapse;
    const target = Math.min(this.order.length, Math.ceil(this.order.length * (now - tl.start) / tl.dur));
    for (; tl.i < target; tl.i++) this.paintRegion(this.order[tl.i]);
    if (tl.i >= this.order.length) {
      this.timelapse = null;
      this.layerCtx.drawImage(this.hi, 0, 0);
      setTimeout(() => { if (this.puzzle && this.isComplete()) this.showDone(); }, 600);
    }
  }

  downloadImage() {
    const a = document.createElement('a');
    a.download = (this.entry ? this.entry.title : 'painting').replace(/[^\w\- ]+/g, '') + '.png';
    a.href = this.layer.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
