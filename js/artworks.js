/*
 * Built-in artwork, drawn procedurally with flat colours. Each artwork
 * declares its palette so the processor can map every pixel (including the
 * anti-aliased edges) back to an exact colour.
 */
const Artworks = (function () {
  'use strict';

  const SIZE = 1000;

  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- drawing helpers ----------
  function poly(ctx, pts, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
  }
  function circle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function ellipse(ctx, x, y, rx, ry, rot, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  function stroke(ctx, pts, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  // pointed petal from (x,y) pointing at angle a, length len, half-width wid
  function petal(ctx, x, y, a, len, wid, color) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const tx = x + ca * len, ty = y + sa * len;
    const mx = x + ca * len * 0.5, my = y + sa * len * 0.5;
    const nx = -sa * wid, ny = ca * wid;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx + nx * 2, my + ny * 2, tx, ty);
    ctx.quadraticCurveTo(mx - nx * 2, my - ny * 2, x, y);
    ctx.fill();
  }
  function bird(ctx, x, y, s, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(5, s * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.3);
    ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.6, x, y);
    ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.6, x + s, y - s * 0.3);
    ctx.stroke();
  }
  function cloud(ctx, x, y, s, main, shade) {
    const puffs = [[-0.9, 0.1, 0.45], [-0.4, -0.25, 0.6], [0.25, -0.35, 0.7], [0.85, 0, 0.5], [0, 0.15, 0.55]];
    if (shade) for (const p of puffs) circle(ctx, x + p[0] * s, y + p[1] * s + s * 0.12, p[2] * s, shade);
    for (const p of puffs) circle(ctx, x + p[0] * s, y + p[1] * s, p[2] * s, main);
  }
  function wave(ctx, x0, x1, baseY, amp, period, phase, color, bottom) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let x = x0; x <= x1; x += 8) {
      ctx.lineTo(x, baseY + Math.sin(x / period + phase) * amp + Math.sin(x / (period * 0.43) + phase * 2) * amp * 0.35);
    }
    ctx.lineTo(x1, bottom);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 1. Calico cat under cherry blossoms ----------
  const catColors = {
    sky1: '#e6f1f7', sky2: '#f4ecf2', wall: '#f7f0e6', wallShade: '#e9ddcc',
    roofDark: '#5b6270', roofMid: '#8a909c', roofLight: '#b7bcc6',
    trunk: '#7c5747', trunkDark: '#583c32', trunkLight: '#a07660',
    bl1: '#f6c1d0', bl2: '#ee9fb6', bl3: '#fde6ee', blC: '#c9466e', leaf: '#9fc48a', leafDark: '#6f9a61',
    white: '#ffffff', shade: '#dcd6e3', orange: '#e59a4b', black: '#3a3232',
    pink: '#f2adb8', eye: '#e9a52c', nose: '#e5808f',
  };
  function blossom(ctx, x, y, r, rot, petalColor, C) {
    for (let i = 0; i < 5; i++) {
      const a = rot + i * Math.PI * 2 / 5;
      ellipse(ctx, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.52, r * 0.4, a, petalColor);
    }
    circle(ctx, x, y, r * 0.36, C.bl3);
    circle(ctx, x, y, r * 0.14, C.blC);
  }
  function drawCat(ctx) {
    const C = catColors;
    const rand = rng(7);
    // sky + roof + wall
    rect(ctx, 0, 0, SIZE, 150, C.sky1);
    rect(ctx, 0, 150, SIZE, 160, C.sky2);
    rect(ctx, 0, 300, SIZE, 30, C.roofDark);
    for (let i = 0; i < 21; i++) {
      const x = i * 50 - 10;
      ctx.fillStyle = i % 2 ? C.roofMid : C.roofLight;
      ctx.beginPath();
      ctx.moveTo(x, 330);
      ctx.lineTo(x + 50, 330);
      ctx.lineTo(x + 50, 400);
      ctx.arc(x + 25, 400, 25, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
    }
    rect(ctx, 0, 428, SIZE, 572, C.wall);
    rect(ctx, 0, 440, SIZE, 44, C.wallShade);
    rect(ctx, 0, 424, SIZE, 16, C.roofDark);

    // trunk
    poly(ctx, [[760, 1000], [792, 760], [802, 520], [822, 300], [850, 0], [935, 0], [918, 300], [906, 540], [922, 780], [905, 1000]], C.trunk);
    poly(ctx, [[870, 1000], [888, 780], [872, 540], [884, 300], [900, 0], [935, 0], [918, 300], [906, 540], [922, 780], [905, 1000]], C.trunkDark);
    poly(ctx, [[772, 1000], [800, 760], [810, 520], [830, 300], [858, 0], [875, 0], [848, 300], [830, 520], [822, 760], [798, 1000]], C.trunkLight);
    // upper branch
    poly(ctx, [[830, 330], [700, 250], [560, 150], [420, 90], [300, 60], [300, 80], [420, 118], [550, 180], [690, 280], [822, 372]], C.trunk);
    poly(ctx, [[640, 222], [640, 100], [655, 60], [668, 100], [660, 235]], C.trunk);
    // main branch the cat sits on
    poly(ctx, [[812, 650], [600, 688], [400, 716], [200, 728], [0, 734], [0, 792], [200, 790], [420, 784], [620, 768], [812, 762]], C.trunk);
    poly(ctx, [[812, 650], [600, 688], [400, 716], [200, 728], [0, 734], [0, 748], [200, 742], [400, 730], [600, 703], [812, 668]], C.trunkLight);
    poly(ctx, [[0, 776], [200, 776], [420, 770], [620, 752], [812, 745], [812, 762], [620, 768], [420, 784], [200, 790], [0, 792]], C.trunkDark);
    // side twig with leaves on the left
    poly(ctx, [[90, 740], [60, 640], [20, 560], [0, 540], [0, 566], [40, 640], [72, 744]], C.trunkDark);

    // blossoms
    const clusters = [[610, 110, 7], [760, 60, 6], [900, 140, 7], [960, 330, 6], [700, 330, 5], [880, 540, 6], [720, 620, 5], [360, 60, 5], [470, 120, 5], [40, 560, 6], [140, 690, 5], [980, 700, 4], [880, 900, 4]];
    for (const [cx, cy, n] of clusters) {
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, d = rand() * 70;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (rand() < 0.4) ellipse(ctx, x + 30 * (rand() - 0.5), y + 30 * (rand() - 0.5), 22, 10, rand() * 3, rand() < 0.5 ? C.leaf : C.leafDark);
        blossom(ctx, x, y, 24 + rand() * 14, rand() * 6, rand() < 0.5 ? C.bl1 : C.bl2, C);
      }
    }

    // --- cat ---
    // tail made of beads with calico stripes
    const tail = t => {
      const u = 1 - t;
      return [u * u * u * 505 + 3 * u * u * t * 585 + 3 * u * t * t * 520 + t * t * t * 610,
        u * u * u * 712 + 3 * u * u * t * 760 + 3 * u * t * t * 900 + t * t * t * 905];
    };
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const [x, y] = tail(t);
      const band = Math.floor(t * 7);
      circle(ctx, x, y, 22 - t * 8, band % 2 ? C.black : C.orange);
    }
    // body
    const bodyPath = new Path2D();
    bodyPath.ellipse(430, 612, 96, 112, 0, 0, Math.PI * 2);
    bodyPath.ellipse(478, 660, 82, 66, -0.2, 0, Math.PI * 2);
    ctx.fillStyle = C.white;
    ctx.fill(bodyPath);
    ctx.save();
    ctx.clip(bodyPath);
    ellipse(ctx, 515, 555, 70, 62, 0.3, C.orange);
    ellipse(ctx, 540, 640, 52, 42, 0.2, C.black);
    ellipse(ctx, 505, 712, 70, 30, 0, C.orange);
    ellipse(ctx, 555, 590, 26, 14, 0.9, C.black);
    ellipse(ctx, 470, 560, 30, 12, 0.5, C.black);
    ellipse(ctx, 360, 640, 26, 75, 0.1, C.shade);
    ctx.restore();
    // legs + paws
    ellipse(ctx, 398, 672, 24, 52, 0.05, C.white);
    ellipse(ctx, 452, 676, 24, 50, -0.05, C.white);
    ellipse(ctx, 425, 690, 6, 36, 0, C.shade);
    ellipse(ctx, 394, 718, 30, 15, 0, C.white);
    ellipse(ctx, 458, 720, 30, 15, 0, C.white);
    ellipse(ctx, 560, 718, 34, 14, 0, C.white);
    // head
    const headPath = new Path2D();
    headPath.arc(415, 468, 80, 0, Math.PI * 2);
    headPath.ellipse(415, 495, 92, 60, 0, 0, Math.PI * 2);
    // ears
    poly(ctx, [[342, 440], [352, 352], [410, 404]], C.orange);
    poly(ctx, [[425, 400], [482, 346], [490, 438]], C.black);
    poly(ctx, [[356, 420], [362, 376], [392, 404]], C.pink);
    poly(ctx, [[444, 404], [474, 376], [476, 422]], C.pink);
    ctx.fillStyle = C.white;
    ctx.fill(headPath);
    ctx.save();
    ctx.clip(headPath);
    ellipse(ctx, 362, 420, 52, 40, -0.4, C.orange);
    ellipse(ctx, 470, 418, 48, 40, 0.4, C.black);
    ellipse(ctx, 415, 540, 70, 20, 0, C.shade);
    ctx.restore();
    // face
    for (const ex of [382, 450]) {
      ellipse(ctx, ex, 478, 17, 19, 0, C.eye);
      ellipse(ctx, ex, 478, 7, 14, 0, C.black);
      circle(ctx, ex - 5, 470, 4.5, C.white);
    }
    poly(ctx, [[405, 505], [427, 505], [416, 518]], C.nose);
    stroke(ctx, [[416, 518], [416, 526], [404, 534]], 4, C.black);
    stroke(ctx, [[416, 526], [428, 534]], 4, C.black);

    // falling petals
    for (let i = 0; i < 26; i++) {
      const x = rand() * SIZE, y = 150 + rand() * 820;
      if (x > 300 && x < 640 && y > 340 && y < 760) continue;
      ellipse(ctx, x, y, 13, 8, rand() * 3, rand() < 0.5 ? C.bl1 : C.bl2);
    }
  }

  // ---------- 2. Mountain lake at sunset ----------
  const sunsetColors = {
    s1: '#2e2b58', s2: '#4a3b78', s3: '#7a4c90', s4: '#b65f8e', s5: '#e7877b', s6: '#f5b380', s7: '#fbd89c',
    sunGlow: '#fde6b4', sun: '#fff5d6',
    farL: '#9a7fb0', farD: '#7c649a', midL: '#5f4f86', midD: '#473c6e', snow: '#f4ecf6', snowShade: '#cdbfe0',
    lake1: '#e39a86', lake2: '#b86d8e', lake3: '#6d4c86', lake4: '#3e3466', ripple: '#fbd0a2', reflect: '#3a3060',
    pineA: '#1f3b3f', pineB: '#2c5452', shore: '#231f3a', rock: '#3a3354', rockL: '#4f4670', birdC: '#2a2340',
  };
  function mountain(ctx, x0, px, py, x1, base, cl, cd, snow, snowShade) {
    const mx = px + (x1 - x0) * 0.08;
    poly(ctx, [[x0, base], [px, py], [mx, base]], cl);
    poly(ctx, [[mx, base], [px, py], [x1, base]], cd);
    if (snow) {
      const f = 0.24;
      const lx = px + (x0 - px) * f, ly = py + (base - py) * f;
      const rx = px + (x1 - px) * f, ry = py + (base - py) * f;
      const midX = px + (mx - px) * f;
      poly(ctx, [[px, py], [lx, ly], [lx + (midX - lx) * 0.4, ly - 18], [midX, ly + 10], [px, py]], snow);
      poly(ctx, [[px, py], [midX, ly + 10], [midX + (rx - midX) * 0.5, ry - 14], [rx, ry]], snowShade);
    }
  }
  function pine(ctx, x, base, h, a, b, trunk) {
    rect(ctx, x - 5, base - h * 0.15, 10, h * 0.15, trunk);
    for (let i = 0; i < 3; i++) {
      const top = base - h + i * h * 0.22;
      const bot = base - h * 0.12 - (2 - i) * h * 0.18;
      const w = h * (0.18 + i * 0.1);
      poly(ctx, [[x, top], [x - w, bot], [x, bot]], a);
      poly(ctx, [[x, top], [x, bot], [x + w, bot]], b);
    }
  }
  function drawSunset(ctx) {
    const C = sunsetColors;
    const bands = [C.s1, C.s2, C.s3, C.s4, C.s5, C.s6, C.s7];
    const hz = 640;
    for (let i = 0; i < bands.length; i++) rect(ctx, 0, Math.round(i * hz / bands.length), SIZE, Math.ceil(hz / bands.length) + 1, bands[i]);
    circle(ctx, 500, 600, 150, C.sunGlow);
    circle(ctx, 500, 600, 100, C.sun);
    const stars = rng(3);
    for (let i = 0; i < 18; i++) circle(ctx, stars() * SIZE, stars() * 150, 3 + stars() * 3, C.sun);
    bird(ctx, 300, 250, 22, C.birdC);
    bird(ctx, 345, 280, 16, C.birdC);
    bird(ctx, 700, 200, 20, C.birdC);
    // far range
    mountain(ctx, -100, 120, 380, 360, hz, C.farL, C.farD, C.snow, C.snowShade);
    mountain(ctx, 220, 420, 430, 620, hz, C.farL, C.farD);
    mountain(ctx, 560, 800, 330, 1100, hz, C.farL, C.farD, C.snow, C.snowShade);
    // mid range
    mountain(ctx, -60, 230, 500, 520, hz, C.midL, C.midD);
    mountain(ctx, 380, 620, 470, 900, hz, C.midL, C.midD, C.snow, C.snowShade);
    mountain(ctx, 760, 960, 520, 1150, hz, C.midL, C.midD);
    // lake
    const lb = [C.lake1, C.lake2, C.lake3, C.lake4];
    for (let i = 0; i < 4; i++) rect(ctx, 0, hz + i * 90, SIZE, 91, lb[i]);
    poly(ctx, [[-60, hz], [230, 780], [520, hz]], C.reflect);
    poly(ctx, [[380, hz], [620, 800], [900, hz]], C.reflect);
    poly(ctx, [[760, hz], [960, 760], [1150, hz]], C.reflect);
    ellipse(ctx, 500, 668, 90, 12, 0, C.ripple);
    ellipse(ctx, 500, 700, 64, 8, 0, C.ripple);
    ellipse(ctx, 500, 728, 40, 6, 0, C.ripple);
    const rr = rng(11);
    for (let i = 0; i < 12; i++) ellipse(ctx, 60 + rr() * 880, 760 + rr() * 150, 30 + rr() * 50, 5, 0, C.ripple);
    // pines on the shores
    const pr = rng(5);
    for (let i = 0; i < 7; i++) pine(ctx, 20 + i * 38 + pr() * 10, 910 + pr() * 20, 220 + pr() * 120, C.pineA, C.pineB, C.shore);
    for (let i = 0; i < 6; i++) pine(ctx, 760 + i * 44 + pr() * 10, 920 + pr() * 20, 200 + pr() * 140, C.pineA, C.pineB, C.shore);
    // shore + rocks
    wave(ctx, 0, SIZE, 925, 12, 90, 1, C.shore, 1000);
    poly(ctx, [[330, 1000], [380, 930], [450, 915], [500, 960], [520, 1000]], C.rock);
    poly(ctx, [[380, 930], [450, 915], [430, 960]], C.rockL);
    poly(ctx, [[560, 1000], [600, 950], [660, 945], [690, 1000]], C.rock);
    poly(ctx, [[600, 950], [660, 945], [630, 975]], C.rockL);
  }

  // ---------- 3. Koi pond ----------
  const koiColors = {
    water: '#2c7a8a', waterL: '#3a93a3', waterD: '#23677a', glint: '#79c3cc',
    padL: '#7cb865', padD: '#4f8f45', padV: '#3d7438',
    lotus1: '#f39fbd', lotus2: '#fbd3e1', lotusC: '#f6d160',
    koiW: '#fbf5ec', koiO: '#ef7b35', koiR: '#d6452c', koiB: '#2b2a2e', fin: '#f7b88d', finW: '#e2e6ea',
    stone1: '#8d8f96', stone2: '#b3b5bb', stone3: '#6c6e76', moss: '#94ad62',
  };
  function lilyPad(ctx, x, y, r, rot, C) {
    const sectors = 7;
    const gap = 0.42;
    for (let i = 0; i < sectors; i++) {
      const a0 = rot + gap / 2 + (i * (Math.PI * 2 - gap)) / sectors;
      const a1 = rot + gap / 2 + ((i + 1) * (Math.PI * 2 - gap)) / sectors;
      ctx.fillStyle = i % 2 ? C.padL : C.padD;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
  }
  function lotus(ctx, x, y, s, C) {
    for (let i = 0; i < 8; i++) petal(ctx, x, y, i * Math.PI / 4 + 0.2, s, s * 0.2, C.lotus1);
    for (let i = 0; i < 6; i++) petal(ctx, x, y, i * Math.PI / 3, s * 0.7, s * 0.17, C.lotus2);
    circle(ctx, x, y, s * 0.2, C.lotusC);
  }
  function koi(ctx, x, y, len, ang, pattern, C) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const w = len * 0.2;
    // tail
    ctx.fillStyle = pattern.fin;
    ctx.beginPath();
    ctx.moveTo(-len * 0.42, 0);
    ctx.quadraticCurveTo(-len * 0.62, -w * 0.4, -len * 0.72, -w * 1.2);
    ctx.quadraticCurveTo(-len * 0.62, 0, -len * 0.72, w * 1.2);
    ctx.quadraticCurveTo(-len * 0.62, w * 0.4, -len * 0.42, 0);
    ctx.fill();
    // pectoral fins
    ellipse(ctx, len * 0.12, -w * 0.95, len * 0.12, w * 0.35, -0.6, pattern.fin);
    ellipse(ctx, len * 0.12, w * 0.95, len * 0.12, w * 0.35, 0.6, pattern.fin);
    // body
    const body = new Path2D();
    body.moveTo(len * 0.5, 0);
    body.bezierCurveTo(len * 0.45, -w * 1.2, -len * 0.1, -w * 1.1, -len * 0.46, 0);
    body.bezierCurveTo(-len * 0.1, w * 1.1, len * 0.45, w * 1.2, len * 0.5, 0);
    ctx.fillStyle = pattern.base;
    ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    for (const s of pattern.spots) ellipse(ctx, s[0] * len, s[1] * w, s[2] * len, s[3] * w, s[4], s[5]);
    ctx.restore();
    ctx.restore();
  }
  function drawKoi(ctx) {
    const C = koiColors;
    rect(ctx, 0, 0, SIZE, SIZE, C.water);
    const rings = [[260, 300], [720, 620], [420, 820]];
    for (const [x, y] of rings) {
      for (let i = 5; i >= 1; i--) {
        ctx.strokeStyle = i % 2 ? C.waterL : C.waterD;
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.arc(x, y, i * 48, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const g = rng(21);
    for (let i = 0; i < 18; i++) ellipse(ctx, g() * SIZE, g() * SIZE, 18 + g() * 26, 6, g() * 0.4 - 0.2, C.glint);
    // stones in the corner
    circle(ctx, 60, 960, 120, C.stone1);
    circle(ctx, 190, 1010, 90, C.stone2);
    circle(ctx, -20, 830, 90, C.stone3);
    ellipse(ctx, 40, 880, 50, 22, -0.5, C.moss);
    circle(ctx, 980, 40, 110, C.stone2);
    circle(ctx, 870, -30, 90, C.stone1);
    ellipse(ctx, 920, 110, 50, 20, 0.4, C.moss);
    // koi
    koi(ctx, 330, 470, 300, -0.5, {
      base: C.koiW, fin: C.finW,
      spots: [[0.3, -0.2, 0.16, 0.7, 0.2, C.koiR], [-0.02, 0.4, 0.14, 0.6, -0.3, C.koiR], [-0.28, -0.2, 0.08, 0.5, 0, C.koiB]],
    }, C);
    koi(ctx, 640, 330, 260, 2.4, {
      base: C.koiO, fin: C.fin,
      spots: [[0.2, 0.3, 0.14, 0.5, 0.3, C.koiW], [-0.18, -0.35, 0.1, 0.45, 0, C.koiB], [-0.32, 0.3, 0.07, 0.4, 0, C.koiB]],
    }, C);
    koi(ctx, 610, 790, 240, -2.8, {
      base: C.koiW, fin: C.fin,
      spots: [[0.25, 0, 0.18, 0.85, 0, C.koiO], [-0.12, -0.3, 0.1, 0.5, 0.5, C.koiB], [-0.3, 0.3, 0.07, 0.5, 0, C.koiO]],
    }, C);
    koi(ctx, 170, 720, 200, 0.9, {
      base: C.koiR, fin: C.fin,
      spots: [[0.15, -0.3, 0.12, 0.5, 0, C.koiW], [-0.2, 0.2, 0.1, 0.55, 0, C.koiW]],
    }, C);
    // lily pads + lotus
    lilyPad(ctx, 820, 470, 110, 2.2, C);
    lilyPad(ctx, 130, 160, 95, 0.4, C);
    lilyPad(ctx, 460, 150, 70, 4.0, C);
    lilyPad(ctx, 880, 850, 90, 3.1, C);
    lilyPad(ctx, 350, 600, 55, 1.2, C);
    lotus(ctx, 800, 450, 70, C);
    lotus(ctx, 150, 140, 60, C);
    lotus(ctx, 890, 830, 55, C);
  }

  // ---------- 4. Hot air balloons ----------
  const balloonColors = {
    sk1: '#8fc9e8', sk2: '#a6d5ec', sk3: '#bee1f0', sk4: '#d6ebf3', sk5: '#ecf5f6',
    cloud: '#ffffff', cloudS: '#dbe7ef',
    red: '#e2574c', yellow: '#f6c94c', teal: '#3fa7a0', purple: '#8a6bbf', orange: '#f28b3c', cream: '#fff4dc', navy: '#34507a',
    basket: '#9a6b44', basketL: '#c2915f', rope: '#5a4636',
    hill1: '#a8cf7c', hill2: '#86b867', hill3: '#5f9a52', field: '#e8d36f', tree: '#3f7a45', treeL: '#58944f', roof: '#c75d4a', house: '#fbeede',
  };
  function balloon(ctx, x, y, r, cols, C) {
    const env = new Path2D();
    env.moveTo(x - r * 0.35, y + r * 1.3);
    env.quadraticCurveTo(x - r * 1.05, y + r * 0.55, x - r, y);
    env.arc(x, y, r, Math.PI, 0);
    env.quadraticCurveTo(x + r * 1.05, y + r * 0.55, x + r * 0.35, y + r * 1.3);
    env.closePath();
    ctx.fillStyle = cols[0];
    ctx.fill(env);
    ctx.save();
    ctx.clip(env);
    ellipse(ctx, x, y + r * 0.2, r * 0.68, r * 2, 0, cols[1]);
    ellipse(ctx, x, y + r * 0.2, r * 0.3, r * 2, 0, cols[0]);
    rect(ctx, x - r * 1.2, y + r * 0.42, r * 2.4, r * 0.2, cols[2]);
    ctx.restore();
    // skirt, ropes, basket
    poly(ctx, [[x - r * 0.35, y + r * 1.3], [x + r * 0.35, y + r * 1.3], [x + r * 0.25, y + r * 1.45], [x - r * 0.25, y + r * 1.45]], cols[2]);
    const rw = Math.max(3.5, r * 0.035);
    stroke(ctx, [[x - r * 0.23, y + r * 1.45], [x - r * 0.18, y + r * 1.72]], rw, C.rope);
    stroke(ctx, [[x + r * 0.23, y + r * 1.45], [x + r * 0.18, y + r * 1.72]], rw, C.rope);
    rect(ctx, x - r * 0.2, y + r * 1.72, r * 0.4, r * 0.28, C.basket);
    rect(ctx, x - r * 0.22, y + r * 1.7, r * 0.44, r * 0.07, C.basketL);
  }
  function drawBalloons(ctx) {
    const C = balloonColors;
    const sk = [C.sk1, C.sk2, C.sk3, C.sk4, C.sk5];
    for (let i = 0; i < 5; i++) rect(ctx, 0, i * 150, SIZE, 151, sk[i]);
    cloud(ctx, 180, 160, 90, C.cloud, C.cloudS);
    cloud(ctx, 760, 110, 70, C.cloud, C.cloudS);
    cloud(ctx, 560, 470, 80, C.cloud, C.cloudS);
    cloud(ctx, 90, 560, 60, C.cloud, C.cloudS);
    balloon(ctx, 690, 270, 150, [C.red, C.yellow, C.navy], C);
    balloon(ctx, 280, 400, 105, [C.teal, C.cream, C.orange], C);
    balloon(ctx, 470, 150, 60, [C.purple, C.yellow, C.teal], C);
    balloon(ctx, 880, 560, 55, [C.orange, C.cream, C.red], C);
    balloon(ctx, 130, 330, 38, [C.yellow, C.red, C.purple], C);
    bird(ctx, 420, 330, 18, C.navy);
    bird(ctx, 455, 355, 13, C.navy);
    // hills
    wave(ctx, 0, SIZE, 740, 30, 160, 0.5, C.hill1, 1000);
    poly(ctx, [[520, 800], [700, 770], [760, 830], [560, 860]], C.field);
    wave(ctx, 0, SIZE, 830, 34, 140, 2.2, C.hill2, 1000);
    poly(ctx, [[120, 900], [330, 870], [380, 930], [150, 960]], C.field);
    wave(ctx, 0, SIZE, 920, 26, 120, 4.1, C.hill3, 1000);
    // trees + house
    const t = rng(9);
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 110 + t() * 40, y = 780 + t() * 60;
      rect(ctx, x - 5, y, 10, 26, C.basket);
      circle(ctx, x, y - 8, 22, C.tree);
      circle(ctx, x - 7, y - 14, 11, C.treeL);
    }
    rect(ctx, 800, 850, 80, 55, C.house);
    poly(ctx, [[790, 852], [840, 812], [890, 852]], C.roof);
    rect(ctx, 830, 872, 18, 33, C.basket);
  }

  // ---------- 5. Lighthouse ----------
  const lighthouseColors = {
    sk1: '#6fb6e0', sk2: '#8cc6e7', sk3: '#aad5ec', sk4: '#c8e4f1', sun: '#fff1b8', sunG: '#fde7a0',
    cloud: '#ffffff', cloudS: '#d9e9f3',
    sea1: '#3f86b8', sea2: '#2f70a2', sea3: '#245b8b', foam: '#e6f4fb', wave: '#6aa9d4',
    rock1: '#6f6a70', rock2: '#8c878c', rock3: '#534f57', grass: '#7fb35d', grassD: '#5d9147',
    red: '#d9463e', white: '#fbf8f2', dark: '#2f3440', lamp: '#ffd95a', roofR: '#b8322e',
    hull: '#5b3b2e', sail: '#fffaf0', sail2: '#f3d9b0', gull: '#3b4250',
  };
  function drawLighthouse(ctx) {
    const C = lighthouseColors;
    const sk = [C.sk1, C.sk2, C.sk3, C.sk4];
    for (let i = 0; i < 4; i++) rect(ctx, 0, i * 150, SIZE, 151, sk[i]);
    circle(ctx, 200, 200, 95, C.sunG);
    circle(ctx, 200, 200, 65, C.sun);
    cloud(ctx, 460, 150, 70, C.cloud, C.cloudS);
    cloud(ctx, 880, 260, 60, C.cloud, C.cloudS);
    cloud(ctx, 130, 440, 50, C.cloud, C.cloudS);
    // sea
    rect(ctx, 0, 600, SIZE, 400, C.sea1);
    wave(ctx, 0, SIZE, 700, 10, 60, 0, C.sea2, 1000);
    wave(ctx, 0, SIZE, 820, 14, 70, 2, C.sea3, 1000);
    const w = rng(13);
    for (let i = 0; i < 24; i++) {
      const x = w() * 700, y = 620 + w() * 360, s = 18 + (y - 600) * 0.08;
      ctx.fillStyle = y > 820 ? C.foam : C.wave;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 1.6, s * 0.55, 0, Math.PI, 0);
      ctx.ellipse(x + s * 0.4, y, s * 1.2, s * 0.25, 0, 0, Math.PI, true);
      ctx.fill();
    }
    // sailboat
    poly(ctx, [[280, 655], [420, 655], [395, 690], [305, 690]], C.hull);
    poly(ctx, [[348, 648], [348, 470], [250, 648]], C.sail);
    poly(ctx, [[356, 648], [356, 500], [420, 648]], C.sail2);
    rect(ctx, 348, 460, 8, 196, C.hull);
    // cliff (low poly)
    const cliff = [
      [[560, 1000], [600, 820], [700, 760], [760, 1000]],
      [[700, 760], [820, 700], [860, 1000], [760, 1000]],
      [[820, 700], [1000, 640], [1000, 1000], [860, 1000]],
      [[600, 820], [650, 700], [700, 760]],
      [[650, 700], [760, 640], [820, 700], [700, 760]],
      [[760, 640], [1000, 600], [1000, 640], [820, 700]],
    ];
    const rc = [C.rock1, C.rock3, C.rock2, C.rock2, C.rock1, C.rock3];
    cliff.forEach((p, i) => poly(ctx, p, rc[i]));
    poly(ctx, [[640, 700], [700, 650], [760, 628], [1000, 590], [1000, 612], [760, 646], [650, 710]], C.grass);
    poly(ctx, [[820, 616], [1000, 590], [1000, 604], [830, 628]], C.grassD);
    // foam at the cliff base
    for (let i = 0; i < 6; i++) ellipse(ctx, 560 + i * 30, 990 - i * 10, 40, 12, -0.3, C.foam);
    // lighthouse
    const tower = new Path2D();
    tower.moveTo(760, 640); tower.lineTo(790, 300); tower.lineTo(870, 300); tower.lineTo(900, 640); tower.closePath();
    ctx.fillStyle = C.white;
    ctx.fill(tower);
    ctx.save();
    ctx.clip(tower);
    for (let y = 300; y < 640; y += 136) rect(ctx, 740, y + 68, 180, 68, C.red);
    ctx.restore();
    rect(ctx, 815, 470, 30, 44, C.dark);
    ctx.fillStyle = C.dark;
    ctx.beginPath(); ctx.arc(830, 590, 22, Math.PI, 0); ctx.lineTo(852, 640); ctx.lineTo(808, 640); ctx.fill();
    rect(ctx, 770, 282, 120, 20, C.dark);
    rect(ctx, 795, 220, 70, 62, C.lamp);
    stroke(ctx, [[818, 222], [818, 280]], 6, C.dark);
    stroke(ctx, [[842, 222], [842, 280]], 6, C.dark);
    ctx.fillStyle = C.roofR;
    ctx.beginPath(); ctx.moveTo(785, 222); ctx.quadraticCurveTo(830, 150, 875, 222); ctx.fill();
    circle(ctx, 830, 168, 10, C.dark);
    // keeper's cottage
    rect(ctx, 900, 560, 90, 70, C.white);
    poly(ctx, [[892, 562], [945, 515], [1000, 562]], C.roofR);
    rect(ctx, 925, 585, 22, 22, C.lamp);
    // gulls
    bird(ctx, 540, 330, 26, C.gull);
    bird(ctx, 600, 290, 18, C.gull);
    bird(ctx, 640, 400, 14, C.gull);
  }

  // ---------- 6. Mandala ----------
  const mandalaColors = {
    bg: '#1f2a4a', bg2: '#2c3b63', teal: '#3fa59b', coral: '#ef7b62', gold: '#f2c14e', pink: '#e98fb3',
    cream: '#fbf1dc', lav: '#9d8bd6', mint: '#a8dcc1', deep: '#173a4a',
  };
  function drawMandala(ctx) {
    const C = mandalaColors;
    rect(ctx, 0, 0, SIZE, SIZE, C.bg);
    // corners
    for (const [x, y] of [[0, 0], [SIZE, 0], [0, SIZE], [SIZE, SIZE]]) {
      circle(ctx, x, y, 200, C.bg2);
      circle(ctx, x, y, 150, C.lav);
      circle(ctx, x, y, 100, C.bg2);
      circle(ctx, x, y, 55, C.gold);
    }
    const cx = 500, cy = 500;
    const TAU = Math.PI * 2;
    circle(ctx, cx, cy, 470, C.deep);
    for (let i = 0; i < 32; i++) {
      const a = i * TAU / 32;
      circle(ctx, cx + Math.cos(a) * 448, cy + Math.sin(a) * 448, 16, i % 2 ? C.gold : C.mint);
    }
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16;
      petal(ctx, cx + Math.cos(a) * 170, cy + Math.sin(a) * 170, a, 255, 34, C.teal);
      petal(ctx, cx + Math.cos(a) * 210, cy + Math.sin(a) * 210, a, 160, 18, C.mint);
      petal(ctx, cx + Math.cos(a) * 250, cy + Math.sin(a) * 250, a, 80, 9, C.gold);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i + 0.5) * TAU / 16;
      petal(ctx, cx + Math.cos(a) * 170, cy + Math.sin(a) * 170, a, 190, 22, C.coral);
      petal(ctx, cx + Math.cos(a) * 200, cy + Math.sin(a) * 200, a, 100, 11, C.cream);
      circle(ctx, cx + Math.cos(a) * 395, cy + Math.sin(a) * 395, 13, C.pink);
    }
    circle(ctx, cx, cy, 195, C.bg2);
    for (let i = 0; i < 24; i++) {
      const a = i * TAU / 24;
      circle(ctx, cx + Math.cos(a) * 182, cy + Math.sin(a) * 182, 10, C.cream);
    }
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12;
      petal(ctx, cx + Math.cos(a) * 60, cy + Math.sin(a) * 60, a, 110, 20, i % 2 ? C.pink : C.lav);
      petal(ctx, cx + Math.cos(a) * 80, cy + Math.sin(a) * 80, a, 60, 9, C.cream);
    }
    circle(ctx, cx, cy, 78, C.gold);
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 + TAU / 16;
      petal(ctx, cx, cy, a, 70, 12, C.coral);
    }
    circle(ctx, cx, cy, 26, C.teal);
    circle(ctx, cx, cy, 11, C.cream);
  }

  function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  const list = [
    { id: 'cat', title: 'Calico & Blossoms', colors: catColors, draw: drawCat },
    { id: 'koi', title: 'Koi Pond', colors: koiColors, draw: drawKoi },
    { id: 'sunset', title: 'Mountain Sunset', colors: sunsetColors, draw: drawSunset },
    { id: 'balloons', title: 'Hot Air Balloons', colors: balloonColors, draw: drawBalloons },
    { id: 'lighthouse', title: 'Lighthouse', colors: lighthouseColors, draw: drawLighthouse },
    { id: 'mandala', title: 'Mandala', colors: mandalaColors, draw: drawMandala },
  ];

  function render(art) {
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    art.draw(ctx);
    return c;
  }

  function palette(art) {
    const seen = new Set();
    const out = [];
    for (const hex of Object.values(art.colors)) {
      const k = hex.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(hexToRgb(k));
    }
    return out;
  }

  return { list, render, palette, SIZE };
})();
