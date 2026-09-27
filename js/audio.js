/* Soft, generated sound effects (no audio files needed). */
const Sound = (function () {
  'use strict';
  let ctx = null, master = null;
  let muted = Store.muted();
  // major pentatonic: every combination sounds pleasant
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  let step = 4;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    master.connect(lp);
    lp.connect(ctx.destination);
    return ctx;
  }

  function note(semi, when, dur, vol, type) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + (when || 0);
    const f = 392 * Math.pow(2, semi / 12);
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o2.type = 'triangle';
    o.frequency.value = f;
    o2.frequency.value = f * 2.001;
    const g2 = c.createGain();
    g2.gain.value = 0.18;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.6));
    o.start(t); o2.start(t);
    o.stop(t + (dur || 0.6) + 0.05); o2.stop(t + (dur || 0.6) + 0.05);
  }

  return {
    unlock() { if (!muted) ensure(); },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      Store.setMuted(muted);
      if (!muted) ensure();
      return muted;
    },
    fill() {
      if (muted) return;
      step = Math.max(0, Math.min(scale.length - 1, step + Math.round((Math.random() - 0.5) * 4)));
      note(scale[step], 0, 0.7, 0.4);
    },
    wrong() {
      if (muted) return;
      note(-12, 0, 0.25, 0.25, 'sine');
    },
    colorDone() {
      if (muted) return;
      [0, 4, 7, 12].forEach((s, i) => note(s, i * 0.09, 0.9, 0.3));
    },
    finished() {
      if (muted) return;
      [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => note(s, i * 0.12, 1.4, 0.3));
    },
    hint() {
      if (muted) return;
      note(12, 0, 0.5, 0.25);
      note(19, 0.1, 0.7, 0.2);
    },
  };
})();
