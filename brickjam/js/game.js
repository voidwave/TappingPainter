/* Brick Jam: screens, board rendering, dragging, timer and boosters. */
(function () {
  'use strict';

  const { COLORS, DIRS, EMPTY } = Levels;
  const $ = id => document.getElementById(id);

  /* ------------------------------------------------------------ saving */
  const SAVE_KEY = 'brickjam:save';
  const save = (function () {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* ignore */ }
    s = s || {};
    return {
      level: s.level || 1,
      boosters: { hammer: (s.boosters || {}).hammer ?? 2, vacuum: (s.boosters || {}).vacuum ?? 2 },
      tips: s.tips || {},
    };
  })();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------- state */
  let lv = null;          // current level description
  let grid = null;        // Int16Array of cell contents
  let bricks = {};        // id -> brick (with its element)
  let cleared = 0;
  let elapsed = 0;        // seconds spent on this level; there is no time limit
  let running = false;
  let paused = false;
  let mode = null;        // 'hammer' | 'vacuum' while aiming a booster
  let drag = null;
  let lastTick = 0;

  const board = $('board'), floor = $('floor'), pieces = $('pieces'),
    gatesEl = $('gates'), exitLayer = $('exitLayer'), fx = $('fx');

  /* ----------------------------------------------------------- screens */
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }

  function refreshHome() {
    $('homeLevel').textContent = 'Level ' + save.level;
    $('homeSound').textContent = 'Sound: ' + (Sound.muted ? 'off' : 'on');
  }

  function dialog(title, text, buttons, opts) {
    $('dlgTitle').textContent = title;
    const p = $('dlgText');
    p.textContent = text;
    p.className = opts && opts.rules ? 'rules' : '';
    const box = $('dlgButtons');
    box.innerHTML = '';
    buttons.forEach(([label, cls, fn]) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls || '');
      b.textContent = label;
      b.addEventListener('click', () => { closeDialog(); fn && fn(); });
      box.appendChild(b);
    });
    $('overlay').classList.add('show');
  }
  function closeDialog() { $('overlay').classList.remove('show'); }
  function dialogOpen() { return $('overlay').classList.contains('show'); }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  let bannerTimer = 0;
  function banner(msg, ms) {
    const b = $('banner');
    b.textContent = msg;
    b.classList.add('show');
    clearTimeout(bannerTimer);
    if (ms !== 0) bannerTimer = setTimeout(() => b.classList.remove('show'), ms || 2600);
  }
  function hideBanner() { $('banner').classList.remove('show'); }

  const RULES = 'Drag a brick to slide it around the board.\n\n' +
    'When a brick touches a gate of its own colour that is wide enough, it slides out. Clear every brick to finish the level. Take as long as you like.\n\n' +
    '❄ Frozen bricks show a number. They thaw once that many other bricks have left.\n\n' +
    '⇔ Bricks with arrows only slide that way.\n\n' +
    'Wooden blocks never move.\n\n' +
    'Boosters: the hammer smashes one brick, and the vacuum removes every brick of one colour.';

  /* ------------------------------------------------------------ layout */
  function layout() {
    if (!lv) return;
    const st = $('stage').getBoundingClientRect();
    const c = Math.max(24, Math.min(76, Math.floor(Math.min(
      (st.width - 24) / (lv.w + 1), (st.height - 80) / (lv.h + 1.25)))));
    board.style.setProperty('--c', c + 'px');
    const W = lv.w * c, H = lv.h * c;
    floor.style.width = W + 'px';
    floor.style.height = H + 'px';
    [pieces, exitLayer, fx].forEach(el => { el.style.width = W + 'px'; el.style.height = H + 'px'; });
  }
  window.addEventListener('resize', layout);

  /* ------------------------------------------------------------ level */
  function startLevel(n) {
    lv = Levels.generate(n);
    grid = Levels.makeGrid(lv, lv.blocks);
    cleared = 0;
    elapsed = 0;
    running = false;
    paused = false;
    drag = null;
    setMode(null);

    $('levelNum').textContent = n;
    const tier = $('tier');
    tier.textContent = lv.tier === 'superhard' ? 'SUPER HARD' : lv.tier === 'hard' ? 'HARD' : 'NORMAL';
    tier.className = 'tier ' + lv.tier;

    pieces.innerHTML = '';
    gatesEl.innerHTML = '';
    exitLayer.innerHTML = '';
    fx.innerHTML = '';
    bricks = {};

    for (const g of lv.gates) {
      const el = document.createElement('div');
      el.className = 'gate ' + g.side;
      el.style.setProperty('--gp', g.pos);
      el.style.setProperty('--gl', g.len);
      el.style.setProperty('--col', COLORS[g.color].c);
      el.style.setProperty('--d', COLORS[g.color].d);
      g.el = el;
      gatesEl.appendChild(el);
    }
    for (const [x, y] of lv.walls) {
      const el = document.createElement('div');
      el.className = 'wall';
      el.style.setProperty('--x', x);
      el.style.setProperty('--y', y);
      el.style.width = el.style.height = 'var(--c)';
      pieces.appendChild(el);
    }
    for (const b of lv.blocks) {
      b.el = buildBrick(b);
      bricks[b.id] = b;
      pieces.appendChild(b.el);
    }
    updateIce(true);
    updateTimer();
    updateBoosters();
    show('game');
    layout();

    const tips = [];
    if (n === 1) tips.push(['drag', 'Drag each brick into the gate of the same colour!']);
    if (lv.blocks.some(b => b.ice)) tips.push(['ice', '❄ Frozen bricks thaw after that many other bricks leave.']);
    if (lv.blocks.some(b => b.axis)) tips.push(['axis', '⇔ Bricks with arrows only slide that way.']);
    if (lv.walls.length) tips.push(['wall', 'Wooden blocks never move.']);
    const tip = tips.find(([k]) => !save.tips[k]);
    if (tip) {
      save.tips[tip[0]] = true;
      persist();
      banner(tip[1], 4200);
    } else {
      banner('Level ' + n + (lv.tier !== 'normal' ? ' · ' + tier.textContent : ''), 1400);
    }
    running = true;
  }

  const cx = (n) => 'calc(var(--c) * ' + n + ')';

  function buildBrick(b) {
    const el = document.createElement('div');
    el.className = 'brick';
    const col = COLORS[b.color];
    el.style.setProperty('--col', col.c);
    el.style.setProperty('--d', col.d);
    el.style.setProperty('--x', b.x);
    el.style.setProperty('--y', b.y);
    const bb = Levels.bounds(b.cells);
    el.style.width = cx(bb.w);
    el.style.height = cx(bb.h);
    const has = new Set(b.cells.map(([x, y]) => x + ',' + y));
    const R = 0.18, IN = { t: 0.03, r: 0.05, b: 0.11, l: 0.05 };
    for (const [x, y] of b.cells) {
      const e = {
        t: !has.has(x + ',' + (y - 1)), b: !has.has(x + ',' + (y + 1)),
        l: !has.has((x - 1) + ',' + y), r: !has.has((x + 1) + ',' + y),
      };
      const c = document.createElement('div');
      c.className = 'cell';
      const l = e.l ? IN.l : 0, r = e.r ? IN.r : 0, t = e.t ? IN.t : 0, bo = e.b ? IN.b : 0;
      c.style.left = cx(x + l);
      c.style.top = cx(y + t);
      c.style.width = cx(1 - l - r);
      c.style.height = cx(1 - t - bo);
      c.style.borderRadius = [e.t && e.l, e.t && e.r, e.b && e.r, e.b && e.l]
        .map(v => v ? cx(R) : '0').join(' ');
      const sh = [];
      if (e.t) sh.push('inset 0 ' + cx(0.06) + ' 0 rgba(255,255,255,.35)');
      if (e.l) sh.push('inset ' + cx(0.04) + ' 0 0 rgba(255,255,255,.18)');
      if (e.r) sh.push('inset ' + cx(-0.04) + ' 0 0 rgba(0,0,0,.1)');
      if (e.b) sh.push('inset 0 ' + cx(-0.05) + ' 0 rgba(0,0,0,.12)');
      if (sh.length) c.style.boxShadow = sh.join(',');
      el.appendChild(c);
    }
    // the ice number or the arrows sit in the middle of the brick
    const mx = b.cells.reduce((s, c) => s + c[0], 0) / b.cells.length;
    const my = b.cells.reduce((s, c) => s + c[1], 0) / b.cells.length;
    const placeMid = (node) => {
      node.style.left = cx(mx);
      node.style.top = cx(my - 0.04);
      el.appendChild(node);
    };
    if (b.axis) {
      const a = document.createElement('div');
      a.className = 'arrow-mark';
      a.innerHTML = '<svg viewBox="0 0 24 24"' + (b.axis === 'v' ? ' style="transform:rotate(90deg)"' : '') +
        '><path d="M2 12l5-5v3h10V7l5 5-5 5v-3H7v3z" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width=".8" stroke-linejoin="round"/></svg>';
      placeMid(a);
    }
    if (b.ice) {
      const l = document.createElement('div');
      l.className = 'ice-label';
      b.label = l;
      placeMid(l);
    }
    return el;
  }

  function isFrozen(b) { return b.ice > cleared; }

  function updateIce(initial) {
    for (const id in bricks) {
      const b = bricks[id];
      if (!b.ice) continue;
      const left = b.ice - cleared;
      if (left > 0) {
        b.el.classList.add('frozen');
        b.label.textContent = left;
      } else if (b.el.classList.contains('frozen')) {
        b.el.classList.add('thaw');
        if (!initial) Sound.thaw();
        setTimeout(() => b.el.classList.remove('frozen', 'thaw'), 480);
      }
    }
  }

  function place(b) {
    b.el.style.setProperty('--x', b.x);
    b.el.style.setProperty('--y', b.y);
  }

  function setCells(b, v) {
    for (const [x, y] of b.cells) grid[(b.y + y) * lv.w + b.x + x] = v;
  }

  /* ------------------------------------------------------------- input */
  function boardPoint(e) {
    const r = pieces.getBoundingClientRect();
    const c = r.width / lv.w;
    return { x: (e.clientX - r.left) / c, y: (e.clientY - r.top) / c };
  }

  function brickAt(p) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return null;
    const v = grid[y * lv.w + x];
    return v >= 0 ? bricks[v] : null;
  }

  board.addEventListener('pointerdown', e => {
    Sound.unlock();
    if (!running || paused || dialogOpen() || drag) return;
    const p = boardPoint(e);
    const b = brickAt(p);
    if (!b) return;
    e.preventDefault();
    if (mode) {
      useAimed(b);
      return;
    }
    if (isFrozen(b)) {
      Sound.bump();
      b.el.classList.remove('nope');
      void b.el.offsetWidth;
      b.el.classList.add('nope');
      toast('Frozen! ' + (b.ice - cleared) + ' more brick' + (b.ice - cleared === 1 ? '' : 's') + ' to thaw it');
      return;
    }
    drag = { b, gx: p.x - b.x, gy: p.y - b.y, id: e.pointerId };
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    b.el.classList.add('lift');
    Sound.pick();
  });

  board.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = boardPoint(e);
    moveToward(drag.b, Math.round(p.x - drag.gx), Math.round(p.y - drag.gy));
  });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag.b.el.classList.remove('lift');
    drag = null;
  }
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);
  board.addEventListener('lostpointercapture', endDrag);

  /* Slide the brick one cell at a time towards the target cell, going around
   * corners where it can, and out through a gate if it reaches one. */
  function moveToward(b, tx, ty) {
    let moved = false;
    for (let i = 0; i < 40; i++) {
      let dx = b.axis === 'v' ? 0 : tx - b.x;
      let dy = b.axis === 'h' ? 0 : ty - b.y;
      if (!dx && !dy) break;
      const h = dx ? (dx < 0 ? 'L' : 'R') : null;
      const v = dy ? (dy < 0 ? 'T' : 'B') : null;
      const order = (Math.abs(dx) >= Math.abs(dy) ? [h, v] : [v, h]).filter(Boolean);
      let stepped = false;
      for (const dir of order) {
        const nx = b.x + DIRS[dir].dx, ny = b.y + DIRS[dir].dy;
        if (Levels.fits(lv, grid, b, nx, ny)) {
          setCells(b, EMPTY);
          b.x = nx; b.y = ny;
          setCells(b, b.id);
          stepped = moved = true;
          break;
        }
        const gate = Levels.exitGate(lv, grid, b, b.x, b.y, dir);
        if (gate) {
          if (moved) place(b);
          leave(b, dir, gate);
          return;
        }
      }
      if (!stepped) break;
    }
    if (moved) {
      place(b);
      Sound.step();
      const ex = Levels.exitAt(lv, grid, b, b.x, b.y);
      if (ex) leave(b, ex.dir, ex.gate);
    }
  }

  /* --------------------------------------------------- removing bricks */
  function removeBrick(b) {
    setCells(b, EMPTY);
    delete bricks[b.id];
    if (drag && drag.b === b) drag = null;
    cleared++;
    updateIce(false);
  }

  function leave(b, dir, gate) {
    removeBrick(b);
    const el = b.el;
    el.classList.remove('lift');
    exitLayer.appendChild(el);
    void el.offsetWidth;
    el.classList.add('leaving');
    const bb = Levels.bounds(b.cells);
    const d = DIRS[dir];
    el.style.setProperty('--x', b.x + d.dx * (bb.w + 1));
    el.style.setProperty('--y', b.y + d.dy * (bb.h + 1));
    setTimeout(() => el.remove(), 420);

    gate.el.classList.remove('flash');
    void gate.el.offsetWidth;
    gate.el.classList.add('flash');

    // sparks at the gate
    const along = d.axis === 'h' ? b.y + bb.y0 + bb.h / 2 : b.x + bb.x0 + bb.w / 2;
    const px = d.axis === 'h' ? (dir === 'L' ? 0 : lv.w) : along;
    const py = d.axis === 'h' ? along : (dir === 'T' ? 0 : lv.h);
    burst(px, py, COLORS[b.color].c, 14, d);
    Sound.exit(cleared);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* ignore */ }
    checkWin();
  }

  function pop(b) {
    removeBrick(b);
    const el = b.el;
    const bb = Levels.bounds(b.cells);
    el.classList.add('pop');
    el.style.opacity = '0';
    el.style.transform = 'translate(calc(var(--x) * var(--c)), calc(var(--y) * var(--c))) scale(0.2)';
    el.style.transformOrigin = '50% 50%';
    setTimeout(() => el.remove(), 320);
    burst(b.x + bb.x0 + bb.w / 2, b.y + bb.y0 + bb.h / 2, COLORS[b.color].c, 18);
  }

  function burst(x, y, color, count, dir) {
    const c = pieces.getBoundingClientRect().width / lv.w;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('div');
      const size = c * (0.1 + Math.random() * 0.14);
      s.style.cssText = 'position:absolute;border-radius:30%;left:' + (x * c - size / 2) + 'px;top:' +
        (y * c - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px;background:' + color +
        ';box-shadow:0 0 0 2px rgba(255,255,255,.5)';
      fx.appendChild(s);
      let a = Math.random() * Math.PI * 2;
      if (dir) a = Math.atan2(-dir.dy, -dir.dx) + (Math.random() - 0.5) * 2.2;
      const dist = c * (0.6 + Math.random() * 1.1);
      s.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + Math.cos(a) * dist + 'px,' + Math.sin(a) * dist + 'px) rotate(' +
          (Math.random() * 400 - 200) + 'deg) scale(0.3)', opacity: 0 },
      ], { duration: 500 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => s.remove();
    }
  }

  function checkWin() {
    if (Object.keys(bricks).length) return;
    running = false;
    setMode(null);
    const n = lv.n;
    save.level = Math.max(save.level, n + 1);
    let reward = '';
    if (n % 3 === 0) {
      const k = n % 6 === 0 ? 'vacuum' : 'hammer';
      save.boosters[k]++;
      reward = '\n\nYou earned a ' + (k === 'hammer' ? 'hammer 🔨' : 'vacuum') + '!';
    }
    persist();
    setTimeout(() => {
      Sound.win();
      confetti();
      dialog('Level ' + n + ' complete!', 'Cleared in ' + fmt(elapsed) + '.' + reward, [
        ['Next level', 'primary', () => startLevel(n + 1)],
        ['Home', 'small', goHome],
      ]);
    }, 450);
  }

  function confetti() {
    const W = lv.w, H = lv.h;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        const col = COLORS[Math.floor(Math.random() * COLORS.length)].c;
        burst(Math.random() * W, Math.random() * H, col, 16);
      }, i * 120);
    }
  }

  /* ------------------------------------------------------------- timer */
  function fmt(s) {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function updateTimer() {
    $('timer').textContent = fmt(elapsed);
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - (lastTick || now)) / 1000);
    lastTick = now;
    if (running && !paused && !dialogOpen()) elapsed += dt;
    if (lv) updateTimer();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------------------------------------------------------- boosters */
  function updateBoosters() {
    document.querySelectorAll('[data-count]').forEach(el => {
      const n = save.boosters[el.dataset.count];
      el.textContent = n > 0 ? n : '+';
      el.classList.toggle('zero', n <= 0);
    });
    document.querySelectorAll('.booster').forEach(b => b.classList.toggle('active', b.dataset.booster === mode));
  }

  function setMode(m) {
    mode = m;
    document.body.classList.toggle('aim', !!m);
    if (m === 'hammer') banner('Tap a brick to smash it', 0);
    else if (m === 'vacuum') banner('Tap a brick to remove its whole colour', 0);
    else hideBanner();
    updateBoosters();
  }

  document.querySelectorAll('.booster').forEach(btn => btn.addEventListener('click', () => {
    Sound.unlock();
    if (!running || paused) return;
    const k = btn.dataset.booster;
    if (mode === k) { setMode(null); return; }
    if (save.boosters[k] <= 0) {
      toast('None left. Win levels to earn more!');
      return;
    }
    setMode(k);
  }));

  function useAimed(b) {
    const k = mode;
    save.boosters[k]--;
    persist();
    setMode(null);
    if (k === 'hammer') {
      Sound.smash();
      board.classList.add('shake');
      setTimeout(() => board.classList.remove('shake'), 320);
      pop(b);
    } else {
      Sound.vacuum();
      const same = Object.values(bricks).filter(o => o.color === b.color);
      same.forEach((o, i) => setTimeout(() => { if (bricks[o.id]) { pop(o); checkWin(); } }, i * 70));
      return;
    }
    checkWin();
  }

  /* -------------------------------------------------------- navigation */
  function pause() {
    if (!running) return;
    paused = true;
    endDrag();
    dialog('Paused', 'Level ' + lv.n, [
      ['Resume', 'primary', () => { paused = false; }],
      ['Restart', '', () => startLevel(lv.n)],
      ['Home', 'small', goHome],
    ]);
  }

  function goHome() {
    running = false;
    paused = false;
    setMode(null);
    refreshHome();
    show('home');
  }

  $('pauseBtn').addEventListener('click', pause);
  $('restartBtn').addEventListener('click', () => {
    if (!lv) return;
    if (running && cleared > 0) {
      paused = true;
      dialog('Restart?', 'Start this level again from the beginning.', [
        ['Restart', 'primary', () => startLevel(lv.n)],
        ['Keep playing', '', () => { paused = false; }],
      ]);
    } else {
      startLevel(lv.n);
    }
  });
  $('playBtn').addEventListener('click', () => { Sound.unlock(); startLevel(save.level); });
  $('homeSound').addEventListener('click', () => { Sound.toggle(); refreshHome(); });
  $('howBtn').addEventListener('click', () => dialog('How to play', RULES, [['Got it', 'primary']], { rules: true }));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running && !paused && !dialogOpen()) pause();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (mode) setMode(null);
      else if (dialogOpen() && paused) { closeDialog(); paused = false; }
      else if ($('game').classList.contains('active')) pause();
    }
  });

  refreshHome();

  // handy for testing: brickjam/?level=40 jumps straight to a level
  const q = new URLSearchParams(location.search).get('level');
  if (q && +q > 0) startLevel(Math.floor(+q));

  window.BrickJam = { state: () => ({ lv, grid, bricks, cleared, elapsed, running }), startLevel, moveToward };
})();
