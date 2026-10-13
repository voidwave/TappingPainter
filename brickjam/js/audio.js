/* Generated sound effects (no audio files needed). */
const Sound = (function () {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('brickjam:muted') === '1'; } catch (e) { /* ignore */ }

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function tone(freq, when, dur, vol, type, slideTo) {
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + (when || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(when, dur, vol, freq, q) {
    const c = ensure();
    if (!c || muted) return;
    const t = c.currentTime + (when || 0);
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq || 1200;
    f.Q.value = q || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  return {
    unlock() { if (!muted) ensure(); },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('brickjam:muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (!muted) ensure();
      return muted;
    },
    pick() { tone(520, 0, 0.06, 0.25, 'triangle'); },
    step() { noise(0, 0.04, 0.12, 900, 2); },
    bump() { tone(140, 0, 0.12, 0.3, 'sine', 90); },
    exit(i) {
      const f = 440 * Math.pow(2, Math.min(i || 0, 12) / 12);
      noise(0, 0.25, 0.18, 2400, 0.7);
      tone(f, 0.02, 0.25, 0.28, 'triangle', f * 2);
      tone(f * 1.5, 0.1, 0.3, 0.18, 'sine');
    },
    thaw() {
      noise(0, 0.3, 0.3, 4200, 1.5);
      tone(1800, 0, 0.15, 0.1, 'sine', 2600);
    },
    smash() {
      noise(0, 0.35, 0.5, 600, 0.8);
      tone(120, 0, 0.2, 0.4, 'sine', 50);
    },
    vacuum() {
      noise(0, 0.6, 0.25, 800, 0.5);
      tone(200, 0, 0.6, 0.15, 'sawtooth', 900);
    },
    win() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.5, 0.22, 'triangle'));
    },
  };
})();
