/* Brick Jam puzzle rules, solver and level generator.
 *
 * A level is a w x h board. Each cell is empty, a wooden wall, or part of a
 * brick. Coloured gates sit in the frame around the board. A brick leaves the
 * board when it touches a gate of its own colour that is at least as wide as
 * the brick, and nothing is in its way on the way out.
 *
 * Levels are generated from the level number, so level 37 is always the same
 * puzzle. Every generated level is checked with the solver before it's used. */
const Levels = (function () {
  'use strict';

  const EMPTY = -1, WALL = -2;

  const COLORS = [
    { name: 'red',    c: '#f0443e', d: '#b3221f' },
    { name: 'blue',   c: '#2f7de1', d: '#1d54a3' },
    { name: 'green',  c: '#6fd35a', d: '#3f9a34' },
    { name: 'yellow', c: '#ffd23f', d: '#cf9c12' },
    { name: 'purple', c: '#9b5cf0', d: '#6a33b8' },
    { name: 'orange', c: '#ff8f3a', d: '#cc5c14' },
    { name: 'cyan',   c: '#3fc6ef', d: '#1a8fb8' },
    { name: 'pink',   c: '#ff6fb5', d: '#c93a80' },
  ];

  const DIRS = {
    L: { dx: -1, dy: 0, axis: 'h' },
    R: { dx: 1, dy: 0, axis: 'h' },
    T: { dx: 0, dy: -1, axis: 'v' },
    B: { dx: 0, dy: 1, axis: 'v' },
  };

  function rot(cells) {
    const r = cells.map(([x, y]) => [-y, x]);
    return norm(r);
  }
  function norm(cells) {
    const mx = Math.min(...cells.map(c => c[0]));
    const my = Math.min(...cells.map(c => c[1]));
    return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
  function rotations(cells) {
    const out = [];
    let c = norm(cells);
    for (let i = 0; i < 4; i++) {
      const key = JSON.stringify(c);
      if (!out.some(o => JSON.stringify(o) === key)) out.push(c);
      c = rot(c);
    }
    return out;
  }

  // [shape, weight, first level it can appear on]
  const SHAPE_DEFS = [
    [[[0, 0]], 1.2, 1],
    [[[0, 0], [1, 0]], 4, 1],
    [[[0, 0], [0, 1]], 4, 1],
    [[[0, 0], [1, 0], [2, 0]], 2.2, 1],
    [[[0, 0], [0, 1], [0, 2]], 2.2, 1],
    [[[0, 0], [1, 0], [0, 1], [1, 1]], 3, 1],
    [[[0, 0], [0, 1], [1, 1]], 0.6, 4],
    [[[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], 0.8, 6],
    [[[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], 0.8, 6],
    [[[0, 0], [0, 1], [0, 2], [1, 2]], 0.25, 12],
    [[[0, 0], [1, 0], [2, 0], [1, 1]], 0.2, 16],
  ];
  const SHAPES = [];
  SHAPE_DEFS.forEach(([cells, w, from]) => {
    const rs = rotations(cells);
    rs.forEach(r => SHAPES.push({ cells: r, w: w / rs.length * (rs.length > 2 ? 2 : 1), from }));
  });

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------ rules */

  function bounds(cells) {
    let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
    for (const [x, y] of cells) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function makeGrid(lv, blocks) {
    const g = new Int16Array(lv.w * lv.h).fill(EMPTY);
    for (const [x, y] of lv.walls) g[y * lv.w + x] = WALL;
    for (const b of blocks) for (const [cx, cy] of b.cells) g[(b.y + cy) * lv.w + b.x + cx] = b.id;
    return g;
  }

  function fits(lv, grid, b, x, y) {
    for (const [cx, cy] of b.cells) {
      const ax = x + cx, ay = y + cy;
      if (ax < 0 || ay < 0 || ax >= lv.w || ay >= lv.h) return false;
      const v = grid[ay * lv.w + ax];
      if (v !== EMPTY && v !== b.id) return false;
    }
    return true;
  }

  function canMove(b, dir) {
    return !b.axis || DIRS[dir].axis === b.axis;
  }

  /* The gate brick b would leave through if it sat at (x, y) and went in
   * direction dir, or null. The brick must touch that side of the board, fit
   * inside a gate of its colour, and have a clear path out. */
  function exitGate(lv, grid, b, x, y, dir) {
    if (!canMove(b, dir)) return null;
    const d = DIRS[dir];
    const bb = bounds(b.cells);
    const x0 = x + bb.x0, x1 = x + bb.x1, y0 = y + bb.y0, y1 = y + bb.y1;
    const touches = dir === 'L' ? x0 === 0 : dir === 'R' ? x1 === lv.w - 1 :
      dir === 'T' ? y0 === 0 : y1 === lv.h - 1;
    if (!touches) return null;
    const lo = d.axis === 'h' ? y0 : x0;
    const hi = d.axis === 'h' ? y1 : x1;
    const gate = lv.gates.find(g => g.side === dir && g.color === b.color && g.pos <= lo && g.pos + g.len - 1 >= hi);
    if (!gate) return null;
    for (const [cx, cy] of b.cells) {
      let ax = x + cx + d.dx, ay = y + cy + d.dy;
      while (ax >= 0 && ay >= 0 && ax < lv.w && ay < lv.h) {
        const v = grid[ay * lv.w + ax];
        if (v !== EMPTY && v !== b.id) return null;
        ax += d.dx; ay += d.dy;
      }
    }
    return gate;
  }

  function exitAt(lv, grid, b, x, y) {
    for (const dir of ['L', 'R', 'T', 'B']) {
      const gate = exitGate(lv, grid, b, x, y, dir);
      if (gate) return { dir, gate };
    }
    return null;
  }

  /* Can brick b reach any exit by sliding around, with everything else
   * staying still? Breadth-first search over its positions. */
  function reachExit(lv, grid, b) {
    const seen = new Uint8Array(lv.w * lv.h + lv.w + 1);
    const key = (x, y) => (y + 1) * lv.w + x + 1;
    const q = [[b.x, b.y]];
    seen[key(b.x, b.y)] = 1;
    while (q.length) {
      const [x, y] = q.shift();
      if (exitAt(lv, grid, b, x, y)) return true;
      for (const dir of ['L', 'R', 'T', 'B']) {
        if (!canMove(b, dir)) continue;
        const nx = x + DIRS[dir].dx, ny = y + DIRS[dir].dy;
        if (nx < -3 || ny < -3 || nx > lv.w || ny > lv.h) continue;
        const k = key(nx, ny);
        if (k < 0 || k >= seen.length || seen[k]) continue;
        if (!fits(lv, grid, b, nx, ny)) continue;
        seen[k] = 1;
        q.push([nx, ny]);
      }
    }
    return false;
  }

  /* Removing a brick only ever frees space and thaws ice, so greedily taking
   * out anything that can leave is enough to tell whether a level can be
   * solved. depth counts the rounds: how many layers deep the jam is. */
  function solve(lv) {
    let blocks = lv.blocks.map(b => Object.assign({}, b));
    const grid = makeGrid(lv, blocks);
    let cleared = 0, depth = 0;
    while (blocks.length) {
      const out = blocks.filter(b => b.ice <= cleared && reachExit(lv, grid, b));
      if (!out.length) return { ok: false, depth, left: blocks.length };
      depth++;
      for (const b of out) {
        for (const [cx, cy] of b.cells) grid[(b.y + cy) * lv.w + b.x + cx] = EMPTY;
        cleared++;
      }
      blocks = blocks.filter(b => !out.includes(b));
    }
    return { ok: true, depth };
  }

  /* -------------------------------------------------------- generator */

  function tierOf(n) {
    return n % 10 === 0 ? 'superhard' : n % 5 === 0 ? 'hard' : 'normal';
  }

  function params(n) {
    const tier = tierOf(n);
    const t = tier === 'superhard' ? 2 : tier === 'hard' ? 1 : 0;
    const w = n <= 2 ? 4 : n <= 5 ? 5 : n <= 12 ? 6 : n <= 30 ? 7 : 8;
    return {
      tier,
      w,
      h: Math.min(9, w + (n <= 2 ? 0 : 1)),
      colors: Math.min(8, n <= 2 ? 2 : 3 + Math.floor(n / 5)),
      fill: Math.min(0.86, 0.5 + n * 0.012 + t * 0.03),
      walls: n < 4 ? 0 : Math.min(5, 1 + Math.floor(n / 9)),
      ice: n < 6 ? 0 : Math.min(5, 1 + Math.floor(n / 12) + t),
      locks: n < 9 ? 0 : Math.min(4, 1 + Math.floor(n / 14)),
      depth: Math.min(7, 1 + Math.floor(n / 5) + t),
    };
  }

  function pickWeighted(r, list) {
    let sum = 0;
    for (const s of list) sum += s.w;
    let v = r() * sum;
    for (const s of list) { v -= s.w; if (v <= 0) return s; }
    return list[list.length - 1];
  }

  function candidate(n, p, r) {
    const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const lv = { n, tier: p.tier, w: p.w, h: p.h, walls: [], gates: [], blocks: [] };
    const grid = new Int16Array(lv.w * lv.h).fill(EMPTY);

    // walls
    const nw = ri(Math.max(0, p.walls - 2), p.walls);
    for (let i = 0; i < nw; i++) {
      const x = ri(0, lv.w - 1), y = ri(0, lv.h - 1);
      if (grid[y * lv.w + x] !== EMPTY) continue;
      grid[y * lv.w + x] = WALL;
      lv.walls.push([x, y]);
    }

    // gates: every colour gets one, some get two
    const colors = [];
    const pool = COLORS.map((_, i) => i);
    while (colors.length < p.colors) colors.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    const used = { L: [], R: [], T: [], B: [] };
    const want = colors.concat(colors.filter(() => r() < 0.35));
    for (const color of want) {
      for (let tries = 0; tries < 30; tries++) {
        const side = 'LRTB'[ri(0, 3)];
        const span = side === 'L' || side === 'R' ? lv.h : lv.w;
        const len = Math.min(span - 1, r() < 0.2 ? 1 : r() < 0.7 ? 2 : 3);
        const pos = ri(0, span - len);
        if (used[side].some(([a, b]) => pos <= b && pos + len - 1 >= a)) continue;
        used[side].push([pos, pos + len - 1]);
        lv.gates.push({ side, pos, len, color });
        break;
      }
    }

    /* Bricks are added in reverse order of leaving: a new brick is only kept
     * if it can get out past the bricks already placed. Those leave after it,
     * so the level can always be solved by taking the bricks out newest first. */
    const shapes = SHAPES.filter(s => s.from <= n);
    const free = lv.w * lv.h - lv.walls.length;
    const count = {};
    let filled = 0;
    for (let tries = 0; tries < 900 && filled < free * p.fill; tries++) {
      const s = pickWeighted(r, shapes);
      const bb = bounds(s.cells);
      const x = ri(0, lv.w - bb.w), y = ri(0, lv.h - bb.h);
      const b = { id: lv.blocks.length, cells: s.cells, x, y, ice: 0, axis: null };
      if (!fits(lv, grid, b, x, y)) continue;
      const ok = colors.filter(c => { b.color = c; return reachExit(lv, grid, b); });
      if (!ok.length) continue;
      ok.sort((a, c) => (count[a] || 0) - (count[c] || 0) || r() - 0.5);
      b.color = ok[r() < 0.7 ? 0 : ri(0, ok.length - 1)];
      if (r() < p.locks * 0.06) {
        b.axis = r() < 0.5 ? 'h' : 'v';
        if (!reachExit(lv, grid, b)) b.axis = b.axis === 'h' ? 'v' : 'h';
        if (!reachExit(lv, grid, b)) b.axis = null;
      }
      count[b.color] = (count[b.color] || 0) + 1;
      for (const [cx, cy] of s.cells) grid[(y + cy) * lv.w + x + cx] = b.id;
      lv.blocks.push(b);
      filled += s.cells.length;
    }
    lv.gates = lv.gates.filter(g => count[g.color]);

    // ice: brick i is the (m - i)th to leave, so m - 1 - i others go first
    const m = lv.blocks.length;
    const ni = ri(Math.max(0, p.ice - 1), p.ice);
    for (let i = 0, tries = 0; i < ni && tries < 20; tries++) {
      const k = ri(0, m - 1);
      const b = lv.blocks[k];
      const room = m - 1 - k;
      if (b.ice || room < 2) continue;
      b.ice = ri(2, Math.min(room, 3 + Math.floor(n / 5)));
      i++;
    }
    return lv;
  }

  const cache = new Map();

  function generate(n) {
    if (cache.has(n)) return clone(cache.get(n));
    const p = params(n);
    const r = rng(n * 2654435761 + 12345);
    // a fixed number of tries (never a time limit) so every device gets the same level
    let best = null;
    for (let a = 0; a < 60; a++) {
      const lv = candidate(n, p, r);
      if (lv.blocks.length < 3) continue;
      const res = solve(lv);
      if (!res.ok) continue;
      lv.depth = res.depth;
      lv.score = Math.min(res.depth, p.depth + 1) * 100 + lv.blocks.length;
      if (!best || lv.score > best.score) best = lv;
      if (res.depth >= p.depth && a >= 8) break;
    }
    cache.set(n, best);
    return clone(best);
  }

  function clone(lv) {
    return JSON.parse(JSON.stringify(lv));
  }

  return { COLORS, DIRS, EMPTY, WALL, bounds, makeGrid, fits, canMove, exitGate, exitAt, solve, generate, params, tierOf };
})();

if (typeof module !== 'undefined') module.exports = Levels;
