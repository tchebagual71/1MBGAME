// ===== 50-dir.js : DIR — campaign director: sectors, composed wave scripts, bosses =====
const DIR = (() => {
  const X0 = 8, X1 = 472, Y0 = 20, Y1 = 262, CX = 240, CY = 141;
  // wave script time scale: early sectors (weak guns, long mop-up) run tighter, late ones (instant kills) stretch
  const pace = () => DIR.PACE * (.9 + .05 * st.sector);
  const REPAIR_SECTORS = 1;   // BOOT SECTOR self-test: +1 hp per cleared wave (teaching sector)
  const HEAL = 1, BREATHER = 1.3, INTRO_T = 2.8, WARN_T = 2.3, CLEAR_HOLD = .8, STALL_T = 45;

  // ---- lazy, guarded access to sibling modules ----
  const banner = (a, b, s) => { if (typeof UI !== 'undefined' && UI.banner) UI.banner(a, b, s); };
  const sfx = (n, o) => { if (typeof AU !== 'undefined' && AU.sfx) AU.sfx(n, o); };
  const music = n => { st.music = n; if (typeof AU !== 'undefined' && AU.music) AU.music(n); };
  const fxSet = (n, f) => { if (typeof FX !== 'undefined' && FX.set) { FX.set(n, f == null ? .8 : f); FX.dim = .38; } };
  const kick = k => { if (typeof FX !== 'undefined' && FX.kick) FX.kick(k); };
  const P = () => S.player || { x: CX, y: 200, hp: 1, maxhp: 1 };
  const SH = n => (typeof GFX !== 'undefined' && GFX.SH && GFX.SH[n]) || POLY[n] || POLY.hex;
  const poly = (n, r, rot) => { const a = []; for (let i = 0; i < n; i++) { const t = (rot || 0) + i * TAU / n; a.push(Math.cos(t) * r, Math.sin(t) * r); } return a; };
  const POLY = { hex: poly(6, 1), oct: poly(8, 1, PI / 8), square: poly(4, 1, PI / 4), tri: poly(3, 1, -PI / 2), diamond: [0, -1, .7, 0, 0, 1, -.7, 0],
    dart: [1.2, 0, -.7, -.75, -.35, 0, -.7, .75], chip: [-1, -1, 1, -1, 1, 1, -1, 1], eye: [-1, 0, -.5, -.45, .5, -.45, 1, 0, .5, .45, -.5, .45] };
  const angd = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
  const W8 = rgb(255, 255, 255);
  const col = (e, c) => e.flash > 0 ? W8 : c;
  const DK = rgb(6, 7, 16);
  // thick solid outline (readable on bright FX backgrounds)
  const ol = (pts, x, y, rot, s, c) => { GFX.shape(pts, x, y, rot, s, c); GFX.shape(pts, x, y, rot, s + .9, c); };
  function band(x, y, r0, r1, a0, a1, c) { const n = Math.max(2, Math.ceil((a1 - a0) * r1 / 5));
    for (let i = 0; i < n; i++) { const u = a0 + (a1 - a0) * i / n, v = a0 + (a1 - a0) * (i + 1) / n, cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
      GFX.tri(x + cu * r0, y + su * r0, x + cu * r1, y + su * r1, x + cv * r1, y + sv * r1, c); GFX.tri(x + cu * r0, y + su * r0, x + cv * r1, y + sv * r1, x + cv * r0, y + sv * r0, c); } }

  // ---- state ----
  const st = { phase: 'idle', t: 0, sector: 0, wave: 0, w: null, next: null, music: null, bugs: [], boss: null, bossKey: '', bossMusic: 'boss',
    outro: null, intens: 0, beatHit: false, _pb: 0, _bt: 0, rev: null, patches: 0, log: [] };
  const HZ = [];           // hazards: telegraphed beams, sweeps, marks
  let hzE = null, kfxOK = false;

  // ---- tunable director logic (LIVE) ----
  LIVE.def('dir.diff', 'sec,wave', `
  const BASE = 1, PER_SECTOR = .36, PER_WAVE = .07;
  return BASE + sec * PER_SECTOR + Math.min(wave, 4) * PER_WAVE;`);
  LIVE.def('dir.budget', 'n,type,sec,wave', `
  const MUL = 1, GROW = .2, PER_WAVE = .05, FIXED = 'turret mine sniper';
  if (FIXED.includes(type)) return n;
  return Math.max(1, Math.round(n * MUL * (1 + GROW * sec + PER_WAVE * wave)));`);
  LIVE.def('dir.spawn', 'type,x,y,o', `
  const CAP = 60, SAFE = 72, PAD = 12;
  if (ENT.count(T_ENEMY) >= CAP) return false;
  const x0 = 8 + PAD, x1 = 472 - PAD, y0 = 20 + PAD, y1 = 262 - PAD, p = S.player;
  x = clamp(x, x0, x1); y = clamp(y, y0, y1);
  if (p) {
    let dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
    if (d < SAFE) {
      if (d < 1) { dx = 1; dy = 0; d = 1; }
      x = p.x + dx / d * SAFE; y = p.y + dy / d * SAFE;
      if (x < x0 || x > x1) x = p.x - dx / d * SAFE;
      if (y < y0 || y > y1) y = p.y - dy / d * SAFE;
      x = clamp(x, x0, x1); y = clamp(y, y0, y1);
      if (Math.hypot(x - p.x, y - p.y) < SAFE) { x = p.x < 240 ? x1 - 20 : x0 + 20; y = p.y < 141 ? y1 - 20 : y0 + 20; }
    }
  }
  return GAME.spawnEnemy(type, x, y, o) || null;`);
  LIVE.def('dir.mutator', 'w,sec,wave', `
  const FROM_SECTOR = 1, EVERY = 2, AT = 11, MAX_ALIVE = 2;
  if (sec < FROM_SECTOR || w.mut || w.t < AT) return null;
  w.mut = true;
  if ((sec * 4 + wave) % EVERY !== 1) return null;
  let n = 0; ENT.each(T_ENEMY, e => { if (e.type === 'mutator') n++; });
  if (n >= MAX_ALIVE) return null;
  const f = DIR.far();
  return LIVE.fn['dir.spawn']('mutator', f[0], f[1]);`);
  LIVE.def('dir.intensity', 'n,boss', `
  const FULL = 34, FLOOR = .12, BOSS = .75;
  if (boss) return BOSS + (1 - boss.hp / boss.maxhp) * (1 - BOSS);
  return clamp(FLOOR + n / FULL, 0, 1);`);

  // ---- formations: return [[x,y,type?],...] ----
  const sideDist = (p, s) => s === 'L' ? p.x - X0 : s === 'R' ? X1 - p.x : s === 'T' ? (p.y - Y0) * 1.6 : (Y1 - p.y) * 1.6;
  function farSide() { const p = P(), s = ['L', 'R', 'T', 'B'].sort((a, b) => sideDist(p, b) - sideDist(p, a)); return s[rnd() < .7 ? 0 : 1]; }
  function edgePt(side, u) { const I = 14;
    if (side === 'L') return [X0 + I, lerp(Y0 + I, Y1 - I, u)]; if (side === 'R') return [X1 - I, lerp(Y0 + I, Y1 - I, u)];
    if (side === 'T') return [lerp(X0 + I, X1 - I, u), Y0 + I]; return [lerp(X0 + I, X1 - I, u), Y1 - I]; }
  function far() { const p = P(); let bx = CX, by = CY, bd = -1;
    for (let i = 0; i < 8; i++) { const x = rndr(X0 + 30, X1 - 30), y = rndr(Y0 + 30, Y1 - 30), d = Math.hypot(x - p.x, y - p.y); if (d > bd) { bd = d; bx = x; by = y; } }
    return [bx, by]; }
  const sideOf = a => (typeof a === 'string' && 'LRTB'.includes(a[0])) ? a[0] : farSide();
  const FORMS = {
    ring(n, a) { const p = P(), R = a || 110, a0 = rnd() * TAU, o = []; for (let i = 0; i < n; i++) o.push([p.x + Math.cos(a0 + i * TAU / n) * R, p.y + Math.sin(a0 + i * TAU / n) * R * .85]); return o; },
    edge(n, a) { const s = sideOf(a), o = []; for (let i = 0; i < n; i++) o.push(edgePt(s, (i + .5) / n)); return o; },
    pincer(n) { const v = rnd() < .65, o = []; const h = Math.ceil(n / 2);
      for (let i = 0; i < n; i++) { const k = i < h ? i : i - h, m = i < h ? h : n - h; o.push(edgePt(v ? (i < h ? 'L' : 'R') : (i < h ? 'T' : 'B'), (k + .5) / m)); } return o; },
    corners(n) { const p = P(), c = [[X0 + 22, Y0 + 22], [X1 - 22, Y0 + 22], [X0 + 22, Y1 - 22], [X1 - 22, Y1 - 22]].sort((a, b) => Math.hypot(b[0] - p.x, b[1] - p.y) - Math.hypot(a[0] - p.x, a[1] - p.y)), o = [];
      for (let i = 0; i < n; i++) { const q = c[i % 4], k = i >> 2; o.push([q[0] + (q[0] < CX ? 1 : -1) * k * 16, q[1] + (q[1] < CY ? 1 : -1) * k * 10]); } return o; },
    arc(n, a) { const p = P(), R = a || 150, b = Math.atan2(CY - p.y, CX - p.x), o = [], sp = Math.min(1.8, .45 * n);
      for (let i = 0; i < n; i++) { const t = b + (n > 1 ? (i / (n - 1) - .5) * sp : 0); o.push([p.x + Math.cos(t) * R, p.y + Math.sin(t) * R]); } return o; },
    line(n) { const p = P(), y = p.y > CY ? Y0 + 34 : Y1 - 34, o = []; for (let i = 0; i < n; i++) o.push([lerp(X0 + 40, X1 - 40, n > 1 ? i / (n - 1) : .5), y]); return o; },
    grid(n) { const p = P(), g = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.push([70 + i * 113 + rndr(-18, 18), 52 + j * 88 + rndr(-14, 14)]);
      g.sort((a, b) => Math.hypot(b[0] - p.x, b[1] - p.y) - Math.hypot(a[0] - p.x, a[1] - p.y)); const o = []; for (let i = 0; i < n; i++) o.push(g[(i * 2 + (i >= 6 ? 1 : 0)) % 12]); return o; },
    rand(n) { const o = []; for (let i = 0; i < n; i++) o.push(far()); return o; },
    escort(n, a, type) { const c = FORMS.arc(1, 160)[0], o = [[c[0], c[1], type]], e = typeof a === 'string' ? a : 'gnat';
      for (let i = 0; i < n; i++) o.push([c[0] + Math.cos(i * TAU / n) * 20, c[1] + Math.sin(i * TAU / n) * 20, e]); return o; }
  };

  // ---- sectors: name, sub, fx pair, boss. Wave step = [t, form, type, n, arg] ----
  //  forms: ring(arg=radius) edge(arg=side LRTB/?) pincer corners arc line grid rand escort(arg=escort type)
  //         stream(arg='L8' side+duration: one gate, timed trickle) trickle(arg=duration: random far points)
  const SECTORS = [
    { name: 'BOOT SECTOR', sub: 'POWER-ON SELF TEST', fx: ['plasma', 'copper'], music: 's0', palette: [rgb(80, 230, 255), rgb(255, 160, 60)], boss: 'boot', waves: [
      { name: 'POST.SWARM', s: [[0, 'ring', 'gnat', 6, 120], [4, 'edge', 'gnat', 7, 'L'], [8, 'edge', 'gnat', 7, 'R'], [12, 'arc', 'drifter', 2], [15, 'stream', 'gnat', 8, '?6'], [21, 'corners', 'drifter', 4], [25, 'ring', 'gnat', 8, 130]] },
      { name: 'IRQ.TURRETS', s: [[0, 'grid', 'turret', 2], [1, 'pincer', 'gnat', 10], [7, 'stream', 'drifter', 4, '?8'], [12, 'ring', 'gnat', 10, 120], [18, 'grid', 'turret', 2], [20, 'edge', 'gnat', 10, 'B'], [26, 'arc', 'drifter', 4]] },
      { name: 'BOUNCE.LOOP', s: [[0, 'corners', 'drifter', 4], [5, 'trickle', 'gnat', 12, 14], [8, 'line', 'drifter', 4], [14, 'grid', 'turret', 2], [18, 'pincer', 'gnat', 12], [25, 'escort', 'drifter', 6, 'gnat']] },
      { name: 'POST.FAIL', s: [[0, 'grid', 'turret', 2], [1, 'ring', 'gnat', 10, 110], [6, 'stream', 'drifter', 6, '?10'], [10, 'pincer', 'gnat', 14], [16, 'escort', 'drifter', 6, 'gnat'], [20, 'edge', 'gnat', 12, 'T'], [24, 'corners', 'drifter', 4], [28, 'ring', 'gnat', 12, 130]] }] },
    { name: 'HEAP', sub: 'DYNAMIC ALLOCATION // NO GUARD PAGES', fx: ['metaballs', 'lens'], music: 's1', palette: [rgb(120, 255, 140), rgb(255, 90, 200)], boss: 'malloc', waves: [
      { name: 'MALLOC(N)', s: [[0, 'edge', 'worm', 2, '?'], [3, 'ring', 'gnat', 10, 120], [9, 'arc', 'splitter', 2], [14, 'stream', 'gnat', 10, '?8'], [19, 'corners', 'drifter', 4], [24, 'arc', 'worm', 2], [27, 'pincer', 'gnat', 12]] },
      { name: 'FRAGMENT', s: [[0, 'corners', 'splitter', 4], [6, 'trickle', 'gnat', 14, 14], [10, 'grid', 'turret', 3], [15, 'edge', 'worm', 3, '?'], [22, 'arc', 'splitter', 3], [26, 'ring', 'gnat', 12, 125]] },
      { name: 'LEAK', s: [[0, 'pincer', 'drifter', 6], [4, 'line', 'splitter', 3], [9, 'escort', 'worm', 6, 'gnat'], [15, 'stream', 'gnat', 12, '?9'], [20, 'grid', 'turret', 3], [24, 'corners', 'splitter', 4]] },
      { name: 'DOUBLE.FREE', s: [[0, 'ring', 'gnat', 14, 115], [5, 'edge', 'worm', 2, 'L'], [5, 'edge', 'worm', 2, 'R'], [11, 'arc', 'splitter', 4], [16, 'grid', 'turret', 3], [18, 'pincer', 'gnat', 16], [24, 'escort', 'splitter', 8, 'gnat'], [29, 'corners', 'drifter', 4]] }] },
    { name: 'STACK OVERFLOW', sub: 'RECURSION DEPTH EXCEEDED', fx: ['twister', 'kefrens'], music: 's2', palette: [rgb(255, 80, 80), rgb(255, 220, 90)], boss: 'stack', waves: [
      { name: 'PUSH', s: [[0, 'arc', 'charger', 2], [3, 'ring', 'gnat', 12, 120], [8, 'edge', 'worm', 3, '?'], [13, 'corners', 'charger', 4], [18, 'stream', 'gnat', 12, '?8'], [23, 'arc', 'splitter', 3], [27, 'pincer', 'charger', 4]] },
      { name: 'POP', s: [[0, 'grid', 'turret', 4], [2, 'pincer', 'drifter', 6], [8, 'arc', 'charger', 3], [13, 'trickle', 'gnat', 16, 12], [17, 'escort', 'worm', 6, 'gnat'], [24, 'corners', 'charger', 4]] },
      { name: 'RET.ADDR', s: [[0, 'line', 'charger', 5], [6, 'ring', 'gnat', 14, 125], [11, 'edge', 'splitter', 4, '?'], [16, 'grid', 'turret', 3], [19, 'stream', 'charger', 5, '?10'], [26, 'pincer', 'gnat', 16]] },
      { name: 'SMASH', s: [[0, 'corners', 'charger', 4], [2, 'ring', 'gnat', 14, 115], [8, 'edge', 'worm', 4, '?'], [12, 'arc', 'splitter', 4], [17, 'grid', 'turret', 4], [20, 'pincer', 'charger', 6], [26, 'escort', 'drifter', 8, 'gnat'], [30, 'trickle', 'gnat', 12, 8]] }] },
    { name: 'INTERRUPT TABLE', sub: 'VECTOR 0x08: TIMER // CLI;HLT', fx: ['starfield', 'moire'], music: 's3', palette: [rgb(255, 230, 80), rgb(80, 160, 255)], boss: 'irq', waves: [
      { name: 'TICK', s: [[0, 'grid', 'mine', 5], [2, 'arc', 'orbiter', 2], [6, 'ring', 'gnat', 14, 120], [12, 'pincer', 'charger', 4], [17, 'arc', 'orbiter', 3], [22, 'stream', 'gnat', 14, '?8'], [27, 'corners', 'splitter', 4]] },
      { name: 'NMI', s: [[0, 'ring', 'orbiter', 4, 130], [5, 'grid', 'mine', 6], [9, 'edge', 'worm', 4, '?'], [14, 'pincer', 'gnat', 16], [19, 'grid', 'turret', 3], [23, 'arc', 'charger', 4], [28, 'escort', 'orbiter', 6, 'gnat']] },
      { name: 'IRQ.STORM', s: [[0, 'trickle', 'mine', 8, 20], [1, 'corners', 'orbiter', 4], [7, 'stream', 'charger', 5, '?9'], [12, 'ring', 'gnat', 16, 125], [18, 'arc', 'splitter', 4], [23, 'pincer', 'orbiter', 4], [28, 'edge', 'gnat', 14, '?']] },
      { name: 'IRET', s: [[0, 'grid', 'turret', 4], [2, 'ring', 'orbiter', 4, 130], [6, 'pincer', 'charger', 6], [11, 'grid', 'mine', 6], [14, 'escort', 'worm', 8, 'gnat'], [20, 'arc', 'splitter', 5], [25, 'ring', 'gnat', 18, 120], [30, 'corners', 'orbiter', 4]] }] },
    { name: 'SWAP SPACE', sub: 'PAGE FAULT IN NONPAGED AREA', fx: ['voxel', 'rotozoom'], music: 's4', palette: [rgb(200, 120, 255), rgb(90, 255, 200)], boss: 'gc', waves: [
      { name: 'PAGE.IN', s: [[0, 'corners', 'sniper', 2], [3, 'ring', 'gnat', 16, 120], [8, 'arc', 'weaver', 2], [13, 'pincer', 'charger', 6], [18, 'grid', 'mine', 6], [22, 'stream', 'gnat', 14, '?8'], [27, 'arc', 'orbiter', 4]] },
      { name: 'THRASH', s: [[0, 'arc', 'weaver', 3], [4, 'trickle', 'gnat', 20, 16], [8, 'corners', 'sniper', 3], [14, 'edge', 'worm', 4, '?'], [19, 'escort', 'splitter', 8, 'gnat'], [25, 'pincer', 'orbiter', 4]] },
      { name: 'SEGV', s: [[0, 'grid', 'turret', 4], [1, 'line', 'charger', 6], [7, 'arc', 'weaver', 3], [12, 'corners', 'sniper', 3], [16, 'ring', 'gnat', 18, 125], [22, 'grid', 'mine', 6], [26, 'pincer', 'splitter', 6]] },
      { name: 'OOM.KILLER', s: [[0, 'ring', 'orbiter', 5, 130], [4, 'corners', 'sniper', 3], [8, 'pincer', 'gnat', 20], [13, 'arc', 'weaver', 3], [18, 'edge', 'charger', 6, '?'], [22, 'grid', 'mine', 6], [26, 'escort', 'worm', 10, 'gnat'], [31, 'ring', 'gnat', 16, 120]] }] },
    { name: 'RING 0', sub: 'SUPERVISOR MODE // CPL=0', fx: ['tunnel', 'feedback'], music: 's5', palette: [rgb(255, 70, 160), rgb(70, 220, 255)], boss: 'twin', waves: [
      { name: 'CPL=0', s: [[0, 'ring', 'gnat', 18, 120], [4, 'corners', 'sniper', 3], [8, 'arc', 'weaver', 3], [12, 'pincer', 'charger', 8], [17, 'grid', 'mine', 7], [20, 'arc', 'orbiter', 5], [25, 'stream', 'gnat', 16, '?8'], [30, 'corners', 'splitter', 4]] },
      { name: 'PRIVILEGE', s: [[0, 'grid', 'turret', 5], [2, 'edge', 'worm', 5, '?'], [7, 'ring', 'orbiter', 5, 130], [12, 'trickle', 'gnat', 20, 14], [15, 'corners', 'sniper', 3], [20, 'arc', 'weaver', 4], [26, 'pincer', 'charger', 8]] },
      { name: 'GPF', s: [[0, 'escort', 'splitter', 10, 'gnat'], [5, 'corners', 'weaver', 4], [10, 'line', 'charger', 8], [15, 'grid', 'mine', 7], [18, 'ring', 'gnat', 20, 120], [24, 'arc', 'sniper', 3], [28, 'pincer', 'orbiter', 6]] },
      { name: 'TRIPLE.FAULT', s: [[0, 'ring', 'orbiter', 6, 130], [3, 'corners', 'sniper', 4], [7, 'pincer', 'gnat', 22], [11, 'arc', 'weaver', 4], [15, 'edge', 'worm', 6, '?'], [19, 'grid', 'turret', 4], [22, 'escort', 'charger', 10, 'gnat'], [27, 'ring', 'gnat', 20, 115], [31, 'corners', 'splitter', 6]] }] },
    { name: 'KERNEL SPACE', sub: '/DEV/KERNEL // THE PROGRAM THAT RUNS YOU', fx: ['matrix', 'matrix'], music: 'boss', palette: [rgb(255, 255, 255), rgb(255, 40, 60)], boss: 'kernel', final: true, waves: [] }
  ];

  // ---- kit for LIVE boss pattern code (passed as `k`) ----
  const K = {
    beat: false,
    aim: (e, p) => Math.atan2(p.y - e.y, p.x - e.x),
    shot(x, y, a, spd, c, r, life) { if (typeof GAME === 'undefined') return null;
      return GAME.shoot(x, y, Math.cos(a) * spd, Math.sin(a) * spd, { team: T_ESHOT, dmg: 1, r: r || 3, c: c || C.red, life: life || 8, kind: 'orb' }); },
    // ring of n; optional gap of `gapN` slots centred on angle gapAt
    ring(x, y, n, spd, a0, c, gapN, gapAt, r) { const s = TAU / n;
      for (let i = 0; i < n; i++) { const a = a0 + i * s; if (gapN && Math.abs(angd(a, gapAt == null ? a0 : gapAt)) < gapN * s * .5) continue; K.shot(x, y, a, spd, c, r); } },
    fan(x, y, a, n, spread, spd, c, r) { for (let i = 0; i < n; i++) K.shot(x, y, a + (n > 1 ? (i / (n - 1) - .5) * spread : 0), spd, c, r); },
    // wall of bullets from an arena edge with a gap of width gapW around coordinate gap
    wall(side, gap, gapW, spd, c, step) { step = step || 13;
      // spawned ~16px outside the edge so the wall visibly slides in (spawning on the edge hit edge-huggers on frame 1)
      if (side === 'T' || side === 'B') { for (let x = X0 + 5; x < X1; x += step) if (Math.abs(x - gap) > gapW / 2) K.shot(x, side === 'T' ? Y0 - 14 : Y1 + 14, side === 'T' ? PI / 2 : -PI / 2, spd, c, 3, 6.5); }
      else for (let y = Y0 + 5; y < Y1; y += step) if (Math.abs(y - gap) > gapW / 2) K.shot(side === 'L' ? X0 - 14 : X1 + 14, y, side === 'L' ? 0 : PI, spd, c, 3, 10); },
    // telegraphed beam: {x,y,a,len,warn,dur,spin,c,owner,ox,oy,upd}
    beam(o) { const h = Object.assign({ kind: 'beam', t: 0, x: CX, y: CY, a: 0, len: 560, warn: 1, dur: 3, spin: 0, c: C.red, w: 3, et: 0, ox: 0, oy: 0 }, o); HZ.push(h); return h; },
    // line sweeping across the arena with a gap: vert=true -> vertical line moving in x
    sweep(o) { const h = Object.assign({ kind: 'sweep', t: 0, vert: false, pos: Y0, v: 40, gap: CX, gapW: 70, gv: 0, warn: 1, c: C.magenta, et: 0, end: Y1 }, o); h.dur = Math.abs((h.end - h.pos) / h.v); HZ.push(h); return h; },
    // ground mark: telegraph circle, then fn(x,y)
    mark(x, y, delay, fn, c) { const h = { kind: 'mark', t: 0, x: clamp(x, X0 + 6, X1 - 6), y: clamp(y, Y0 + 6, Y1 - 6), warn: delay, dur: 0, fn, c: c || C.yellow }; HZ.push(h); return h; },
    add(type, x, y, o) { if (x == null) { const f = far(); x = f[0]; y = f[1]; } const e = LIVE.fn['dir.spawn'](type, x, y, o); return e || null; },
    count(type) { let n = 0; ENT.each(T_ENEMY, e => { if (e.type === type) n++; }); return n; },
    // cooldown helper: true once per `period` seconds (per entity, per key)
    cd(e, key, period, first) { const m = e.tm; if (m[key] == null) m[key] = first == null ? period * .5 : first; if (m[key] <= 0) { m[key] += period; if (m[key] < 0) m[key] = period; return true; } return false; },
    clearShots() { ENT.each(T_ESHOT, b => { b.dead = true; }); }
  };

  // ---- hazards (drawn by a T_FX entity on the top layer) ----
  ENT.def('dir.hz', { team: T_FX, layer: 4, r: 0, hp: 1, update() { }, draw() { drawHz(); } });
  function ensureHz() { if (!hzE || hzE.dead || ENT.list.indexOf(hzE) < 0) hzE = ENT.spawn('dir.hz', -99, -99); }
  function emitLine(x, y, ca, sa, len, c, gapA, gapB) {
    if (typeof GAME === 'undefined') return;
    for (let d = 6; d < len; d += 9) { if (gapA != null && d > gapA && d < gapB) continue; const px = x + ca * d, py = y + sa * d;
      if (px < X0 - 4 || px > X1 + 4 || py < Y0 - 4 || py > Y1 + 4) { if (d > 40) break; continue; }
      GAME.shoot(px, py, 0, 0, { team: T_ESHOT, dmg: 1, r: 3, c, life: .085, kind: 'orb' }); }
  }
  function hzUpdate(dt) {
    for (let i = HZ.length - 1; i >= 0; i--) { const h = HZ[i]; h.t += dt;
      if (h.owner && h.owner.dead) { HZ.splice(i, 1); continue; }
      if (h.owner) { h.x = h.owner.x + h.ox; h.y = h.owner.y + h.oy; }
      if (h.upd) h.upd(h, dt);
      const live = h.t >= h.warn && h.t < h.warn + h.dur;
      if (h.kind === 'beam') { if (live) { h.a += h.spin * dt; h.et -= dt; if (h.et <= 0) { h.et = .05; emitLine(h.x, h.y, Math.cos(h.a), Math.sin(h.a), h.len, h.c); } } }
      else if (h.kind === 'sweep') { if (live) { h.pos += h.v * dt; h.gap += h.gv * dt; h.et -= dt;
          if (h.et <= 0) { h.et = .05; if (h.vert) emitLine(h.pos, Y0, 0, 1, Y1 - Y0, h.c, h.gap - h.gapW / 2 - Y0, h.gap + h.gapW / 2 - Y0);
            else emitLine(X0, h.pos, 1, 0, X1 - X0, h.c, h.gap - h.gapW / 2 - X0, h.gap + h.gapW / 2 - X0); } } }
      else if (h.kind === 'mark' && h.t >= h.warn && !h.fired) { h.fired = true; if (h.fn) h.fn(h.x, h.y); }
      if (h.t >= h.warn + h.dur && (h.kind !== 'mark' || h.fired)) HZ.splice(i, 1);
    }
  }
  function drawHz() {
    const blink = (S.t * 12 | 0) & 1;
    for (const h of HZ) {
      const live = h.t >= h.warn, c = h.c;
      if (h.kind === 'beam') { const ca = Math.cos(h.a), sa = Math.sin(h.a), x1 = h.x + ca * h.len, y1 = h.y + sa * h.len;
        if (!live) { const k = h.t / h.warn; if (blink || k > .7) GFX.lineA(h.x, h.y, x1, y1, GFX.scale(c, .35 + .4 * k));
          if (h.spin) { const a2 = h.a + Math.sign(h.spin) * .12; GFX.lineA(h.x + ca * 60, h.y + sa * 60, h.x + Math.cos(a2) * 80, h.y + Math.sin(a2) * 80, c); } }
        else if (h.dur > 0) { const nx = -sa, ny = ca; for (let j = -2; j <= 2; j++) GFX.lineA(h.x + nx * j, h.y + ny * j, x1 + nx * j, y1 + ny * j, j ? GFX.scale(c, .55) : W8);
          GFX.glow(h.x, h.y, 14, c, .9); } }
      else if (h.kind === 'sweep') { const g0 = h.gap - h.gapW / 2, g1 = h.gap + h.gapW / 2, cc = live ? c : GFX.scale(c, blink ? .5 : .25);
        const segs = (a, b) => { if (h.vert) { GFX.lineA(h.pos, a, h.pos, b, cc); if (live) { GFX.lineA(h.pos - 1, a, h.pos - 1, b, GFX.scale(c, .5)); GFX.lineA(h.pos + 1, a, h.pos + 1, b, GFX.scale(c, .5)); } }
          else { GFX.lineA(a, h.pos, b, h.pos, cc); if (live) { GFX.lineA(a, h.pos - 1, b, h.pos - 1, GFX.scale(c, .5)); GFX.lineA(a, h.pos + 1, b, h.pos + 1, GFX.scale(c, .5)); } } };
        if (h.vert) { segs(Y0, g0); segs(g1, Y1); GFX.glow(h.pos, g0, 6, c, .8); GFX.glow(h.pos, g1, 6, c, .8); }
        else { segs(X0, g0); segs(g1, X1); GFX.glow(g0, h.pos, 6, c, .8); GFX.glow(g1, h.pos, 6, c, .8); } }
      else if (h.kind === 'mark' && !h.fired) { const k = h.t / h.warn, r = 16 - 10 * k;
        GFX.circ(h.x, h.y, r, blink ? c : GFX.scale(c, .5)); GFX.line(h.x - r - 3, h.y, h.x - r + 3, h.y, c); GFX.line(h.x + r - 3, h.y, h.x + r + 3, h.y, c);
        GFX.line(h.x, h.y - r - 3, h.x, h.y - r + 3, c); GFX.line(h.x, h.y + r - 3, h.x, h.y + r + 3, c); GFX.glow(h.x, h.y, 6 + 6 * k, c, .5 + .5 * k); }
    }
    if (st.phase === 'boss' && st.t < WARN_T) { // hazard stripes during the warning
      const off = (S.t * 60) % 24, cc = rgb(255, 40, 40), dk = rgb(40, 0, 0);
      for (const y of [22, 252]) { GFX.rectA(X0, y, X1 - X0, 8, dk, .7); for (let x = -24 + off; x < W; x += 24) GFX.tri(x, y, x + 10, y, x + 2, y + 8, blink ? cc : GFX.scale(cc, .6)); }
    }
  }

  // ---- beat tracking (AU sets S.beat; fall back to an internal 120 bpm clock without audio) ----
  function beatTrack(dt) {
    K.beat = false; st._bt += dt;
    if (S.beat > .7 && st._pb <= .7) { K.beat = true; st._bt = 0; }
    else if (st._bt > 1.1) { K.beat = true; st._bt = .6; }
    st._pb = S.beat; st.beatHit = K.beat;
  }

  // ======================= BOSSES =======================
  const BOSS = {};
  function defBoss(key, cfg) {
    BOSS[key] = cfg;
    ENT.def('boss.' + key, {
      boss: true, name: cfg.name, team: T_ENEMY, r: cfg.r, hp: cfg.hp, score: cfg.score, layer: 2,
      init(e) { e.boss = true; e.name = cfg.name; e.hp = Math.round(cfg.hp * DIR.HPK); e.maxhp = e.hp; e.ph = 0; e.pt = 0; e.tm = {}; e.inv = 0; e.intro = 1.6; e.r0 = cfg.r; e.harmless = true;
        e.hx = cfg.home ? cfg.home[0] : CX; e.hy = cfg.home ? cfg.home[1] : 70; e.bugs = []; e.parts = []; if (cfg.init) cfg.init(e); },
      update(e, dt) {
        const p = P();
        if (e.intro > 0) { e.intro -= dt; e.x = lerp(e.x, e.hx, 1 - Math.pow(.03, dt)); e.y = lerp(e.y, e.hy, 1 - Math.pow(.03, dt)); if (e.intro <= 0) { e.harmless = false; sfx('boss'); kick(1); } if (cfg.idle) cfg.idle(e, dt); return; }
        for (const k in e.tm) e.tm[k] -= dt;
        if (e.inv > 0) e.inv -= dt;
        const th = cfg.ph, ratio = e.hp / e.maxhp;
        if (e.ph < th.length && ratio < th[e.ph]) phaseUp(e, cfg);
        e.pt += dt;
        if (cfg.move) cfg.move(e, p, dt);
        LIVE.fn['boss.' + key](e, p, dt, K);
        e.x = clamp(e.x, X0 + 4, X1 - 4); e.y = clamp(e.y, Y0 + 4, Y1 - 4);
      },
      draw(e) { cfg.draw(e); },
      hurt(e, d, src) {
        if (e.intro > 0 || e.inv > 0) { block(e, src); return false; }
        const k = cfg.hurt ? cfg.hurt(e, d, src) : 1;
        if (k === false || k <= 0) { block(e, src); return false; }
        if (k !== 1) e.hp += d * (1 - k);    // ENT.damage subtracts d afterwards: net d*k
        return true;
      },
      die(e) { bossDied(e, cfg); }
    });
  }
  function block(e, src) { const x = src && src.x != null ? src.x : e.x, y = src && src.y != null ? src.y : e.y; if (typeof GFX !== 'undefined') GFX.burst(x, y, 2, rgb(160, 200, 255), 40, .15); }
  function phaseUp(e, cfg) {
    e.ph++; e.pt = 0; e.inv = 1.0; e.tm = {};
    S.shake = Math.max(S.shake, 10); S.flash = Math.max(S.flash, .45); kick(1.4); sfx('boss');
    if (typeof GFX !== 'undefined') { GFX.ring(e.x, e.y, 10, 160, cfg.c || C.white, .6); GFX.burst(e.x, e.y, 60, cfg.c || C.white, 140, .7); }
    K.clearShots(); HZ.length = 0;
    cureBugs(e);
    if (cfg.infect) { const b = PATCH.infect(); if (b) { e.bugs.push(b.id); st.bugs.push(b.id); sfx('bug'); } }
    banner(cfg.name + ' // PHASE ' + (e.ph + 1), (cfg.phn && cfg.phn[e.ph]) || 'ESCALATING', 1.3);
    if (cfg.fxp && cfg.fxp[e.ph]) fxSet(cfg.fxp[e.ph], .4);
    if (cfg.onPhase) cfg.onPhase(e);
  }
  function cureBugs(e) { for (const id of e.bugs) { PATCH.cure(id); const i = st.bugs.indexOf(id); if (i >= 0) st.bugs.splice(i, 1); } e.bugs.length = 0; }
  function killParts(e) { for (const q of e.parts) { if (!q.dead) { q.dead = true; if (typeof GAME !== 'undefined') GAME.explode(q.x, q.y, 18, 0, T_PSHOT); } } e.parts.length = 0; }
  function bossDied(e, cfg) {
    cureBugs(e); killParts(e); if (cfg.onDie) cfg.onDie(e);
    HZ.length = 0; K.clearShots();
    ENT.each(T_ENEMY, q => { if (q !== e && !q.dead) ENT.kill(q, null); });
    S.boss = null; st.boss = null;
    st.phase = 'outro'; st.t = 0; st.outro = { x: e.x, y: e.y, r: e.r0 || 24, c: cfg.c || C.white, i: 0, final: !!cfg.final };
    S.flash = Math.max(S.flash, .6); S.shake = Math.max(S.shake, 12); kick(2); sfx('bigkill');
    st.log.push('bossdead:' + cfg.name);
  }
  const partDef = (type, o) => ENT.def(type, Object.assign({ team: T_ENEMY, layer: 1, r: 10, hp: 1e9, score: 0, seg: true, update() { } }, o));
  // forwarders: parts that pass damage on to the boss with a multiplier
  function fwd(e, d, src, k) { const b = e.parent; if (!b || b.dead) return false; e.flash = .08; if (b.intro > 0 || b.inv > 0 || k <= 0) { block(e, src); return false; } ENT.damage(b, d * k, src); return false; }

  // ---------- 0: BOOTSTRAP — shielded core, rotating plates block shots by angle ----------
  defBoss('boot', { name: 'BOOTSTRAP', r: 30, hp: 225, score: 5000, ph: [.62, .3], c: rgb(255, 170, 60), home: [CX, 72], fxp: ['tunnel', 'tunnel', 'tunnel'],
    phn: ['ROTATING SHIELD', 'COUNTER-SPIN // ADDS', 'VENTING CORE'],
    init(e) { e.rot = 0; e.pw = .52; e.open = 0; },
    idle(e, dt) { e.rot += dt; },
    move(e, p, dt) { e.rot += dt * [.8, -1.35, 1.7][e.ph];
      const vent = e.ph === 2 && (e.pt % 7) > 4.6; e.open = lerp(e.open, vent ? 1 : 0, 1 - Math.pow(.01, dt)); e.vent = vent;
      e.x = CX + Math.sin(e.age * .37) * 130; e.y = 72 + Math.sin(e.age * .83) * 16; },
    hurt(e, d, src) { if (!src || src.x == null) return 1; const a = Math.atan2(src.y - e.y, src.x - e.x), pw = e.pw * (1 - e.open);
      for (let i = 0; i < 3; i++) if (Math.abs(angd(a, e.rot + i * TAU / 3)) < pw) return false;
      return e.open > .5 ? 1.6 : 1; },
    draw(e) {
      const c1 = col(e, rgb(255, 170, 60)), c2 = col(e, rgb(90, 220, 255)), pr = 31 + e.open * 14, b = S.beat;
      GFX.glow(e.x, e.y, 58, rgb(255, 120, 30), .45 + b * .2);
      GFX.disc(e.x, e.y, 25, DK);
      for (let i = 0; i < 24; i++) { const a = e.age * .3 + i * TAU / 24; arc(e.x, e.y, 42 + e.open * 14, a, a + .14, GFX.scale(c2, .7)); }
      for (let i = 0; i < 3; i++) { const ac = e.rot + i * TAU / 3, pw = e.pw * (1 - e.open * .6);
        band(e.x, e.y, pr - 4, pr + 4, ac - pw, ac + pw, GFX.scale(c1, .55));
        arc(e.x, e.y, pr + 4, ac - pw, ac + pw, W8); arc(e.x, e.y, pr - 4, ac - pw, ac + pw, c1);
        for (const s of [-1, 1]) { const a = ac + s * pw; GFX.line(e.x + Math.cos(a) * (pr - 4), e.y + Math.sin(a) * (pr - 4), e.x + Math.cos(a) * (pr + 4), e.y + Math.sin(a) * (pr + 4), W8); }
        GFX.glow(e.x + Math.cos(ac) * pr, e.y + Math.sin(ac) * pr, 10, c1, .5); }
      for (let i = 0; i < 8; i++) { const a = -e.rot * .5 + i * TAU / 8; GFX.line(e.x + Math.cos(a) * 17, e.y + Math.sin(a) * 17, e.x + Math.cos(a) * 24, e.y + Math.sin(a) * 24, c2); }
      GFX.fill(SH('hex'), e.x, e.y, -e.rot * .5, 17, rgb(20, 40, 60)); ol(SH('hex'), e.x, e.y, -e.rot * .5, 17, c2);
      ol(SH('hex'), e.x, e.y, e.rot, 10 + b * 2, c1);
      GFX.glow(e.x, e.y, 10 + e.open * 10, e.vent ? W8 : c2, .8 + b * .3); GFX.disc(e.x, e.y, 3, W8);
      if (e.vent && ((S.t * 8) | 0) & 1) GFX.textC('VENT', e.x, e.y - 58, rgb(255, 255, 120));
    } });
  LIVE.def('boss.boot', 'e,p,dt,k', `
  const SPIRAL_RATE = .18, ARMS = 2, SPIN = .37, SPD = 56;
  const FAN_EVERY = 2.8, FAN_N = 4, FAN_SPREAD = .55, FAN_SPD = 78;
  const RING_EVERY = 2.6, RING_N = 18, RING_SPD = 54, GAP = 5, ADD_EVERY = 8;
  const C1 = rgb(255, 170, 60), C2 = rgb(90, 220, 255);
  if (e.ph === 0) {
    if (k.cd(e, 'sp', SPIRAL_RATE)) { e.sa = (e.sa || 0) + SPIN; for (let i = 0; i < ARMS; i++) k.shot(e.x, e.y, e.sa + i * TAU / ARMS, SPD, C1); }
    if (k.cd(e, 'fan', FAN_EVERY)) k.fan(e.x, e.y, k.aim(e, p), FAN_N, FAN_SPREAD, FAN_SPD, C2);
  } else if (e.ph === 1) {
    if (k.cd(e, 'ring', RING_EVERY)) k.ring(e.x, e.y, RING_N, RING_SPD, rnd() * TAU, C1, GAP, k.aim(e, p) + rndr(-.5, .5));
    if (k.cd(e, 'fan', FAN_EVERY * .8)) k.fan(e.x, e.y, k.aim(e, p), 3, .3, FAN_SPD, C2);
    if (k.cd(e, 'add', ADD_EVERY, 1) && k.count('gnat') < 6) { k.add('gnat'); k.add('gnat'); k.add('gnat'); }
  } else {
    if (k.cd(e, 'sp', SPIRAL_RATE * 1.8)) { e.sa = (e.sa || 0) + SPIN * .8;
      for (let i = 0; i < 2; i++) { k.shot(e.x, e.y, e.sa + i * PI, SPD, C1); k.shot(e.x, e.y, -e.sa + i * PI + .5, SPD * .9, C2); } }
    if (k.cd(e, 'fan', 1.7)) k.fan(e.x, e.y, k.aim(e, p), 3, .22, FAN_SPD + 10, rgb(255, 255, 200));
  }`);

  // ---------- 1: MALLOC — block cluster that frees fragments, allocation walls ----------
  partDef('boss.frag', { layer: 2, r: 10, hp: 80, score: 400, seg: false,
    init(e) { e.oa = e.oa || 0; e.os = e.os || 1; e.tm = {}; },
    update(e, dt) { const b = e.parent; if (!b || b.dead) { e.dead = true; return; } for (const q in e.tm) e.tm[q] -= dt; e.oa += e.os * dt; const R = e.R || 62;
      e.x = lerp(e.x, b.x + Math.cos(e.oa) * R, 1 - Math.pow(.05, dt)); e.y = lerp(e.y, b.y + Math.sin(e.oa) * R * .8, 1 - Math.pow(.05, dt)); },
    draw(e) { const c = col(e, rgb(255, 90, 200)), s = e.sz || 1;
      for (let i = 0; i < 4; i++) { const ox = (i & 1 ? 1 : -1) * 4.5 * s, oy = (i & 2 ? 1 : -1) * 4.5 * s;
        GFX.fill(POLY.square, e.x + ox, e.y + oy, e.age * 1.5, 4 * s, rgb(50, 10, 40)); ol(POLY.square, e.x + ox, e.y + oy, e.age * 1.5, 4 * s, c); }
      GFX.glow(e.x, e.y, 12 * s, c, .5 + S.beat * .3); },
    die(e) { if (typeof GAME !== 'undefined') { GAME.explode(e.x, e.y, 22, 0, T_PSHOT); GAME.dropBits(e.x, e.y, 4); } } });
  defBoss('malloc', { name: 'MALLOC//FREE', r: 27, hp: 800, score: 9000, ph: [.66, .33], c: rgb(120, 255, 140), home: [CX, 80], fxp: ['feedback', 'feedback', 'metaballs'],
    phn: ['ALLOCATING', 'FREE() // FRAGMENTS', 'HEAP CORRUPTION'],
    init(e) { e.vx = 38; e.vy = 22; e.blk = 9; },
    move(e, p, dt) { const sp = [1, 1.25, 1.5][e.ph]; e.x += e.vx * sp * dt; e.y += e.vy * sp * dt;
      if (e.x < 70 || e.x > 410) { e.vx = -e.vx; e.x = clamp(e.x, 70, 410); } if (e.y < 50 || e.y > 140) { e.vy = -e.vy; e.y = clamp(e.y, 50, 140); } },
    onPhase(e) { e.blk = e.ph === 1 ? 6 : 4; const n = e.ph === 1 ? 2 : 3;
      for (let i = 0; i < n; i++) { const q = ENT.spawn('boss.frag', e.x, e.y, { parent: e, oa: i * TAU / n, os: e.ph === 1 ? 1 : -1.3, R: e.ph === 1 ? 64 : 80, hp: Math.round((e.ph === 1 ? 70 : 45) * DIR.HPK), sz: e.ph === 1 ? 1.2 : .9 });
        if (q) e.parts.push(q); } },
    draw(e) {
      const c1 = col(e, rgb(120, 255, 140)), c2 = col(e, rgb(255, 90, 200)), b = S.beat, t = e.age;
      GFX.glow(e.x, e.y, 54, rgb(60, 200, 90), .45 + b * .2); GFX.rect(e.x - 26, e.y - 26, 52, 52, DK);
      const map = [0, 1, 2, 3, 5, 6, 7, 8]; let shown = 0;
      for (let i = 0; i < 8; i++) { const j = map[i], gx = (j % 3 - 1) * 16, gy = ((j / 3 | 0) - 1) * 16, used = i < e.blk - 1;
        const wob = Math.sin(t * 3 + i) * 1.5, bx = e.x + gx + wob, by = e.y + gy - wob;
        if (used) { GFX.fill(POLY.square, bx, by, 0, 9.5, (i + (t * 2 | 0)) % 3 ? rgb(20, 60, 30) : rgb(60, 20, 50)); ol(POLY.square, bx, by, 0, 9.5, (i & 1) ? c1 : c2); shown++; }
        else ol(POLY.square, bx, by, 0, 9.5, GFX.scale(c1, .3)); }
      GFX.fill(POLY.square, e.x, e.y, t, 9 + b * 2, rgb(80, 255, 150)); ol(POLY.square, e.x, e.y, -t, 12, W8); GFX.glow(e.x, e.y, 10, W8, .6);
      const br = 32 + Math.sin(t * 2) * 2; // brackets [ ]
      GFX.line(e.x - br, e.y - br, e.x - br, e.y + br, c1); GFX.line(e.x - br, e.y - br, e.x - br + 6, e.y - br, c1); GFX.line(e.x - br, e.y + br, e.x - br + 6, e.y + br, c1);
      GFX.line(e.x + br, e.y - br, e.x + br, e.y + br, c1); GFX.line(e.x + br, e.y - br, e.x + br - 6, e.y - br, c1); GFX.line(e.x + br, e.y + br, e.x + br - 6, e.y + br, c1);
      GFX.text('0x' + ((e.hp * 97 | 0) & 0xffff).toString(16).toUpperCase(), e.x - br, e.y + br + 4, GFX.scale(c1, .7));
    } });
  LIVE.def('boss.malloc', 'e,p,dt,k', `
  const WALL_EVERY = 3.4, WALL_SPD = 52, WALL_GAP = 60;
  const RING_EVERY = 2.6, RING_N = 12, RING_SPD = 58;
  const FRAG_EVERY = 2, FRAG_SPD = 72, SPIN = .45;
  const C1 = rgb(120, 255, 140), C2 = rgb(255, 90, 200);
  if (e.ph === 0) {
    if (k.cd(e, 'wall', WALL_EVERY, .5)) k.wall('T', rndr(40, 440), WALL_GAP, WALL_SPD, C1);
    if (k.cd(e, 'ring', RING_EVERY)) k.ring(e.x, e.y, RING_N, RING_SPD, rnd() * TAU, C2);
  } else if (e.ph === 1) {
    if (k.cd(e, 'wall', WALL_EVERY * 1.15)) { e.ws = !e.ws; k.wall(e.ws ? 'L' : 'R', rndr(50, 230), WALL_GAP - 6, WALL_SPD * .9, C1); }
    if (k.cd(e, 'sp', .26)) { e.sa = (e.sa || 0) + SPIN; k.shot(e.x, e.y, e.sa, RING_SPD, C2); k.shot(e.x, e.y, e.sa + PI, RING_SPD, C2); }
    for (const f of e.parts) if (!f.dead && k.cd(f, 'f', FRAG_EVERY, rnd() * FRAG_EVERY)) k.shot(f.x, f.y, k.aim(f, p), FRAG_SPD, C2);
  } else {
    if (k.cd(e, 'ring', RING_EVERY * .9)) { const a = rnd() * TAU; k.ring(e.x, e.y, 16, RING_SPD, a, C1, 3, k.aim(e, p)); e.echo = .5; e.ea = a + PI / 16; }
    if (e.echo > 0 && (e.echo -= dt) <= 0) k.ring(e.x, e.y, 12, RING_SPD * .8, e.ea, C2, 3, k.aim(e, p) + .4);
    if (k.cd(e, 'wall', WALL_EVERY * 1.6)) k.wall('T', rndr(40, 440), WALL_GAP + 10, WALL_SPD * .85, C1);
    for (const f of e.parts) if (!f.dead && k.cd(f, 'f', FRAG_EVERY * 1.3, rnd() * 2)) k.fan(f.x, f.y, k.aim(f, p), 3, .35, FRAG_SPD, C2);
  }`);

  // ---------- 2: STACK SMASHER — segmented serpent, armoured head, weak top-of-stack ----------
  partDef('boss.seg', { r: 8,
    hurt(e, d, src) { const b = e.parent; return fwd(e, d, src, b && e === b.parts[b.parts.length - 1] ? 1.5 : .75); },
    draw(e) { const b = e.parent; if (!b) return; const tail = e === b.parts[b.parts.length - 1], s = e.sz || 1;
      const c = col(e, tail ? rgb(255, 230, 80) : (e.idx & 1 ? rgb(255, 80, 80) : rgb(255, 140, 70)));
      GFX.fill(POLY.hex, e.x, e.y, e.a || 0, 7 * s, rgb(50, 12, 10)); ol(POLY.hex, e.x, e.y, e.a || 0, 7 * s, c);
      GFX.glow(e.x, e.y, (tail ? 13 : 7) * s, c, tail ? .7 + S.beat * .3 : .35);
      if (tail && ((S.t * 4) | 0) & 1) GFX.textC('TOS', e.x, e.y - 16, rgb(255, 230, 80)); } });
  defBoss('stack', { name: 'STACK SMASHER', r: 15, hp: 1750, score: 14000, ph: [.66, .33], c: rgb(255, 80, 80), infect: true, home: [CX, 80], fxp: ['fire', 'fire', 'kefrens'],
    phn: ['PUSH PUSH PUSH', 'POP // BUFFER OVERRUN', 'RET2LIBC CHARGE'],
    init(e) { e.ha = PI / 2; e.tx = CX; e.ty = CY; e.trail = []; e.spd = 72; e.charge = 0;
      for (let i = 0; i < 14; i++) { const q = ENT.spawn('boss.seg', e.x, e.y - i * 11, { parent: e, idx: i, sz: 1 - i * .025 }); if (q) e.parts.push(q); } },
    idle(e) { e.ha = PI / 2; trail(e); },
    move(e, p, dt) {
      if (e.charge > 0) { e.charge -= dt; if (e.charge <= .7) { e.x += Math.cos(e.ha) * 210 * dt; e.y += Math.sin(e.ha) * 210 * dt; } }
      else { if (Math.hypot(e.tx - e.x, e.ty - e.y) < 30 || e.pt > (e.rt || 0)) { e.rt = e.pt + 3.5; const f = far(); e.tx = lerp(f[0], CX, .3); e.ty = lerp(f[1], CY, .3); }
        const want = Math.atan2(e.ty - e.y, e.tx - e.x), d = angd(want, e.ha), tr = 2.2 * dt; e.ha += clamp(d, -tr, tr);
        const sp = e.spd * [1, 1.12, 1.3][e.ph]; e.x += Math.cos(e.ha) * sp * dt; e.y += Math.sin(e.ha) * sp * dt; }
      if (e.x < X0 + 16 || e.x > X1 - 16) { e.ha = PI - e.ha; e.charge = Math.min(e.charge, 0); } if (e.y < Y0 + 16 || e.y > Y1 - 16) { e.ha = -e.ha; e.charge = Math.min(e.charge, 0); }
      e.x = clamp(e.x, X0 + 16, X1 - 16); e.y = clamp(e.y, Y0 + 16, Y1 - 16); trail(e); },
    hurt() { return .5; },
    onPhase(e) { for (let i = 0; i < 4 && e.parts.length > 4; i++) { const q = e.parts.pop(); q.dead = true; if (typeof GAME !== 'undefined') GAME.explode(q.x, q.y, 24, 0, T_PSHOT); GFX.ring(q.x, q.y, 4, 40, rgb(255, 230, 80), .4); } },
    draw(e) {
      const c = col(e, rgb(255, 80, 80)), b = S.beat, a = e.ha, ca = Math.cos(a), sa = Math.sin(a), ch = e.charge > .7;
      GFX.glow(e.x, e.y, 30, ch ? rgb(255, 255, 120) : rgb(255, 50, 40), .5 + b * .2);
      const m = Math.sin(e.age * 9) * .35 + .45; // mandibles
      for (const s of [-1, 1]) { const a1 = a + s * m; GFX.line(e.x + ca * 8 - sa * s * 6, e.y + sa * 8 + ca * s * 6, e.x + Math.cos(a1) * 24, e.y + Math.sin(a1) * 24, W8);
        GFX.line(e.x + Math.cos(a1) * 24, e.y + Math.sin(a1) * 24, e.x + Math.cos(a1 - s * .6) * 28, e.y + Math.sin(a1 - s * .6) * 28, c); }
      GFX.fill(POLY.dart, e.x, e.y, a, 15, rgb(60, 10, 10)); ol(POLY.dart, e.x, e.y, a, 15, c); ol(POLY.dart, e.x, e.y, a, 10, rgb(255, 160, 80));
      GFX.glow(e.x + ca * 5, e.y + sa * 5, 5, rgb(255, 255, 160), 1); GFX.disc(e.x + ca * 5, e.y + sa * 5, 1.5, W8);
      for (let i = 1; i < e.parts.length; i++) { const q0 = e.parts[i - 1], q1 = e.parts[i]; GFX.lineA(q0.x, q0.y, q1.x, q1.y, rgb(90, 30, 20)); }
      GFX.text('RET 0x' + (0x7ff0 + e.parts.length * 8).toString(16).toUpperCase(), e.x - 22, e.y - 26, GFX.scale(c, .7));
    } });
  function trail(e) { const T = e.trail, l = T.length; if (!l || Math.hypot(T[l - 2] - e.x, T[l - 1] - e.y) > 2) { T.push(e.x, e.y); if (T.length > 240) T.splice(0, T.length - 240); }
    const n = T.length / 2; for (let i = 0; i < e.parts.length; i++) { const q = e.parts[i], j = Math.max(0, n - 1 - (i + 1) * 6) * 2; const tx = T[j] != null ? T[j] : e.x, ty = T[j + 1] != null ? T[j + 1] : e.y;
      q.a = Math.atan2(ty - q.y, tx - q.x); q.x = tx; q.y = ty; } }
  LIVE.def('boss.stack', 'e,p,dt,k', `
  const RIPPLE = .36, RIP_SPD = 54, FAN_EVERY = 2.4, FAN_N = 5, FAN_SPD = 84;
  const PUSH_EVERY = 2.8, RING_EVERY = 3.6, CHARGE_EVERY = 4.6, TELEGRAPH = .9;
  const C1 = rgb(255, 120, 70), C2 = rgb(255, 230, 90);
  const segs = e.parts, n = segs.length;
  if (k.cd(e, 'rip', RIPPLE) && n) { e.ri = ((e.ri || 0) + 1) % n; const q = segs[e.ri], a = (q.a || 0) + PI / 2;
    k.shot(q.x, q.y, a, RIP_SPD, C1); k.shot(q.x, q.y, a + PI, RIP_SPD, C1); }
  if (e.ph === 0) {
    if (k.cd(e, 'fan', FAN_EVERY)) k.fan(e.x, e.y, k.aim(e, p), FAN_N, .6, FAN_SPD, C2);
  } else if (e.ph === 1) {
    if (k.cd(e, 'push', PUSH_EVERY)) for (let i = 0; i < n; i += 2) { const q = segs[i]; k.shot(q.x, q.y, (q.a || 0) + (i & 2 ? 1 : -1) * PI / 2, RIP_SPD * .9, C2); }
    if (k.cd(e, 'ring', RING_EVERY)) k.ring(e.x, e.y, 14, 60, rnd() * TAU, C1, 3, k.aim(e, p));
  } else {
    if (e.charge <= 0 && k.cd(e, 'chg', CHARGE_EVERY, 1.5)) { e.ha = k.aim(e, p); e.charge = TELEGRAPH + .7;
      k.beam({ x: e.x, y: e.y, a: e.ha, len: 200, warn: TELEGRAPH, dur: 0, c: C2 }); }
    if (e.charge > 0 && e.charge < .7 && k.cd(e, 'drop', .07)) k.shot(e.x, e.y, e.ha + PI + rndr(-.8, .8), 14, C1);
    if (k.cd(e, 'fan', FAN_EVERY * 1.2)) k.fan(e.x, e.y, k.aim(e, p), 3, .35, FAN_SPD, C2);
  }`);

  // ---------- 3: IRQ CLOCK — clock face firing on the beat, hands are sweeping beams ----------
  defBoss('irq', { name: 'IRQ CLOCK', r: 32, hp: 3700, score: 20000, ph: [.62, .3], c: rgb(255, 230, 80), infect: true, home: [CX, 82], fxp: ['rotozoom', 'rotozoom', 'copper'],
    phn: ['TIMER INTERRUPT', 'NMI // NON-MASKABLE', 'DOUBLE FAULT'],
    init(e) { e.vec = 0; e.tpx = 0; e.tp = 0; },
    move(e, p, dt) {
      if (e.ph === 1) { if (e.tp > 0) { e.tp -= dt; if (e.tp <= 0) { e.x = e.tpx; e.y = e.tpy; e.hx = e.x; e.hy = e.y; GFX.ring(e.x, e.y, 6, 60, rgb(255, 230, 80), .4); sfx('dash'); } } }
      else if (e.ph === 2) { e.hx = lerp(e.hx, CX, dt); e.hy = lerp(e.hy, CY - 20, dt); }
      e.x = lerp(e.x, e.hx + Math.sin(e.age * .6) * 20, 1 - Math.pow(.2, dt)); e.y = lerp(e.y, e.hy + Math.cos(e.age * .8) * 8, 1 - Math.pow(.2, dt)); },
    draw(e) {
      const c = col(e, rgb(255, 230, 80)), c2 = col(e, rgb(80, 160, 255)), b = S.beat, x = e.x, y = e.y;
      if (e.tp > 0) { GFX.circ(e.tpx, e.tpy, 34 * (1 - e.tp), rgb(255, 230, 80)); GFX.glow(e.tpx, e.tpy, 20, rgb(255, 200, 60), .5); }
      GFX.glow(x, y, 50, rgb(200, 160, 40), .3 + b * .3);
      GFX.disc(x, y, 34, rgb(16, 14, 30)); GFX.circ(x, y, 34, c); GFX.circ(x, y, 37 + b * 3, GFX.scale(c2, .8)); GFX.circ(x, y, 29, GFX.scale(c, .4));
      for (let i = 0; i < 12; i++) { const a = i * TAU / 12 - PI / 2, hot = i === e.vec, r0 = hot ? 22 : 27;
        GFX.line(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * 33, y + Math.sin(a) * 33, hot ? W8 : c);
        if (hot) GFX.glow(x + Math.cos(a) * 30, y + Math.sin(a) * 30, 8, W8, .9);
        GFX.textC(i.toString(16).toUpperCase(), x + Math.cos(a) * 45, y + Math.sin(a) * 45 - 3, hot ? W8 : GFX.scale(c2, .9)); }
      const ha = e.hand != null ? e.hand : S.t * .2, ma = S.t * 2.4;
      GFX.line(x, y, x + Math.cos(ha) * 20, y + Math.sin(ha) * 20, W8); GFX.line(x + 1, y, x + 1 + Math.cos(ha) * 20, y + Math.sin(ha) * 20, c);
      GFX.line(x, y, x + Math.cos(ma) * 28, y + Math.sin(ma) * 28, c2);
      GFX.disc(x, y, 4, c); GFX.glow(x, y, 8, W8, .7);
      if (e.ph === 2) ol(POLY.oct, x, y, S.t, 52, GFX.scale(rgb(255, 60, 60), .6 + b * .4));
    } });
  LIVE.def('boss.irq', 'e,p,dt,k', `
  const RING_N = 18, RING_SPD = 70, GAP = 3, EVERY_NTH_BEAT = 2;
  const BEAM_EVERY = 7.5, BEAM_WARN = 1.2, BEAM_DUR = 3.4, BEAM_SPIN = .3, BEAM_START = 1.25;
  const NMI_EVERY = 8, AIM_SPD = 85;
  const C1 = rgb(255, 230, 80), C2 = rgb(90, 170, 255), CB = rgb(255, 60, 60);
  if (k.beat) { e.bc = (e.bc || 0) + 1;
    if (e.bc % (e.ph === 2 ? 1 : EVERY_NTH_BEAT) === 0) { e.vec = (e.vec + 5) % 12; const a = e.vec * TAU / 12 - PI / 2;
      k.ring(e.x, e.y, e.ph === 2 ? 10 : RING_N, e.ph === 2 ? RING_SPD * .9 : RING_SPD, a, e.ph === 1 ? C2 : C1, GAP, k.aim(e, p) + rndr(-.7, .7));
      if (e.ph !== 0 || e.bc % 4 === 0) k.fan(e.x, e.y, k.aim(e, p), 3, .25, AIM_SPD, C1); } }
  if (k.cd(e, 'beam', e.ph === 2 ? BEAM_EVERY * 1.1 : BEAM_EVERY, 2.5) && e.tp <= 0) {
    const s = rnd() < .5 ? 1 : -1, a = k.aim(e, p) - s * BEAM_START; e.hand = a;
    k.beam({ owner: e, a, len: 560, warn: BEAM_WARN, dur: BEAM_DUR, spin: s * BEAM_SPIN, c: CB });
    if (e.ph === 2) k.beam({ owner: e, a: a + PI, len: 560, warn: BEAM_WARN, dur: BEAM_DUR, spin: s * BEAM_SPIN, c: CB }); }
  if (e.ph === 1) {
    if (k.cd(e, 'nmi', NMI_EVERY, 1) && e.tp <= 0) { const f = DIR.far(); e.tpx = clamp(f[0], 70, 410); e.tpy = clamp(f[1], 60, 200); e.tp = 1; k.clearShots(); }
    if (k.cd(e, 'add', 12, .5) && k.count('orbiter') < 2) k.add('orbiter');
  }`);

  // ---------- 4: GARBAGE COLLECTOR — mark & sweep: marks burst, laser lines sweep with gaps ----------
  defBoss('gc', { name: 'GARBAGE COLLECTOR', r: 18, hp: 5300, score: 28000, ph: [.62, .3], c: rgb(200, 120, 255), infect: true, home: [CX, 46], fxp: ['moire', 'moire', 'voxel'],
    phn: ['MARK', 'SWEEP // COMPACT', 'STOP THE WORLD'],
    init(e) { e.dir = 1; },
    move(e, p, dt) { const sp = [55, 70, 40][e.ph]; e.x += e.dir * sp * dt; if (e.x > 400) e.dir = -1; if (e.x < 80) e.dir = 1; e.y = lerp(e.y, e.ph === 2 ? 70 : 46, dt); },
    draw(e) {
      const c = col(e, rgb(200, 120, 255)), c2 = col(e, rgb(90, 255, 200)), b = S.beat, x = e.x, y = e.y, wd = 86;
      GFX.glow(x, y, 40, rgb(140, 60, 200), .4 + b * .2);
      GFX.rect(x - wd, y - 8, wd * 2, 16, rgb(24, 8, 40)); GFX.frame(x - wd, y - 8, wd * 2, 16, c); GFX.frame(x - wd - 1, y - 9, wd * 2 + 2, 18, GFX.scale(c, .6));
      for (let i = 0; i < 14; i++) { const tx = x - wd + 8 + i * 12.4, ln = 8 + Math.sin(e.age * 6 + i * .8) * 4 + (e.ph === 1 ? 4 : 0);
        GFX.line(tx, y + 8, tx, y + 8 + ln, c2); GFX.pset(tx, y + 9 + ln, W8); }
      for (const s of [-1, 1]) { GFX.fill(POLY.tri, x + s * (wd + 6), y, s * PI / 2, 8, rgb(60, 20, 90)); ol(POLY.tri, x + s * (wd + 6), y, s * PI / 2, 8, c); }
      GFX.textC('GC', x - 56, y - 3, c2); GFX.textC('GC', x + 56, y - 3, c2);
      const p = P(), la = Math.atan2(p.y - y, p.x - x);
      GFX.disc(x, y, 15, rgb(20, 0, 30)); ol(SH('eye'), x, y, 0, 15, c); GFX.circ(x, y, 17 + b * 2, GFX.scale(c, .6));
      GFX.disc(x + Math.cos(la) * 6, y + Math.sin(la) * 4, 4, c2); GFX.disc(x + Math.cos(la) * 6, y + Math.sin(la) * 4, 1.5, W8); GFX.glow(x, y, 10, W8, .5);
    } });
  LIVE.def('boss.gc', 'e,p,dt,k', `
  const MARK_EVERY = 2.3, MARKS = 3, MARK_DELAY = 1.3, MARK_N = 8, MARK_SPD = 44;
  const SWEEP_EVERY = 7.5, SWEEP_V = 44, GAP_W = 74, BEAM_EVERY = 8;
  const C1 = rgb(200, 120, 255), C2 = rgb(90, 255, 200), CB = rgb(255, 60, 200);
  const burst = (x, y) => k.ring(x, y, MARK_N, MARK_SPD, rnd() * TAU, C2);
  if (k.cd(e, 'mark', MARK_EVERY * [1, 1.4, .8][e.ph]))
    for (let i = 0; i < MARKS; i++) k.mark(p.x + rndr(-70, 70), p.y + rndr(-55, 55), MARK_DELAY + i * .15, burst, C2);
  if (e.ph === 0) {
    if (k.cd(e, 'sweep', SWEEP_EVERY, 3)) k.sweep({ pos: 40, end: 262, v: SWEEP_V, gap: rndr(60, 420), gv: rndr(-25, 25), gapW: GAP_W, c: CB, warn: 1.2 });
    if (k.cd(e, 'fan', 3.1)) k.fan(e.x, e.y + 10, k.aim(e, p), 5, .6, 78, C1);
  } else if (e.ph === 1) {
    if (k.cd(e, 'sweep', SWEEP_EVERY + 1, 1.5)) {
      k.sweep({ vert: true, pos: 10, end: 236, v: SWEEP_V * .9, gap: rndr(50, 230), gapW: GAP_W, c: CB, warn: 1.2 });
      k.sweep({ vert: true, pos: 470, end: 244, v: -SWEEP_V * .9, gap: rndr(50, 230), gapW: GAP_W, c: CB, warn: 1.2 }); }
    if (k.cd(e, 'add', 9, 1) && k.count('gnat') < 8) for (let i = 0; i < 4; i++) k.add('gnat');
  } else {
    if (k.cd(e, 'beam', BEAM_EVERY, 1)) { const a = k.aim(e, p) + PI / 2;
      k.beam({ owner: e, a, len: 560, warn: 1.3, dur: 4, spin: .32, c: CB }); k.beam({ owner: e, a: a + PI, len: 560, warn: 1.3, dur: 4, spin: .32, c: CB }); }
    if (k.cd(e, 'sp', .3)) { e.sa = (e.sa || 0) + .5; k.ring(e.x, e.y, 4, 55, e.sa, C1); }
  }`);

  // ---------- 5: MUTEX & SEMAPHORE — twin daemons; one is locked (shielded), a deadly link between them ----------
  partDef('boss.twinB', { layer: 2, r: 16,
    hurt(e, d, src) { const b = e.parent; return fwd(e, d, src, b && b.lock === 1 ? .15 : 1); },
    draw(e) { const b = e.parent; if (b) twinDraw(e, b.lock === 1, rgb(255, 70, 200), b); } });
  function twinDraw(e, locked, c0, b) {
    const c = col(e, c0), t = e.age, bt = S.beat;
    GFX.glow(e.x, e.y, 36, c0, .5 + bt * .3); GFX.disc(e.x, e.y, 15, DK);
    GFX.fill(POLY.diamond, e.x, e.y, t * .6, 16, rgb(30, 10, 40)); ol(POLY.diamond, e.x, e.y, t * .6, 16, c);
    ol(POLY.diamond, e.x, e.y, -t * 1.1, 10, W8); GFX.glow(e.x, e.y, 6, W8, .8);
    for (let i = 0; i < 3; i++) { const a = t * 2 + i * TAU / 3; GFX.disc(e.x + Math.cos(a) * 22, e.y + Math.sin(a) * 22, 2, c); }
    if (locked) { ol(POLY.hex, e.x, e.y, t, 26, rgb(160, 200, 255)); ol(POLY.hex, e.x, e.y, t, 24, rgb(80, 110, 200));
      GFX.textC('LOCKED', e.x, e.y - 36, rgb(160, 200, 255)); }
    else if (((S.t * 5) | 0) & 1) GFX.textC('OPEN', e.x, e.y - 34, rgb(255, 255, 120));
  }
  defBoss('twin', { name: 'MUTEX & SEMAPHORE', r: 16, hp: 3900, score: 40000, ph: [.62, .3], c: rgb(70, 220, 255), infect: true, home: [CX - 150, 120], fxp: ['lens', 'lens', 'tunnel'],
    phn: ['MUTUAL EXCLUSION', 'LINKED // RACE CONDITION', 'DEADLOCK'],
    init(e) { e.th = PI; e.lock = 1; const q = ENT.spawn('boss.twinB', CX + 150, -30, { parent: e }); if (q) e.parts.push(q); },
    idle(e, dt) { const q = e.parts[0]; if (q) { q.x = lerp(q.x, CX + 150, 1 - Math.pow(.03, dt)); q.y = lerp(q.y, 120, 1 - Math.pow(.03, dt)); } },
    move(e, p, dt) { const q = e.parts[0]; e.th += dt * [.22, .26, .38][e.ph]; const rx = e.ph === 2 ? 120 : 155, ry = e.ph === 2 ? 60 : 78, cy = CY - 14;
      e.x = lerp(e.x, CX + Math.cos(e.th) * rx, 1 - Math.pow(.1, dt)); e.y = lerp(e.y, cy + Math.sin(e.th) * ry, 1 - Math.pow(.1, dt));
      if (q) { q.x = lerp(q.x, CX - Math.cos(e.th) * rx, 1 - Math.pow(.1, dt)); q.y = lerp(q.y, cy - Math.sin(e.th) * ry, 1 - Math.pow(.1, dt)); } },
    hurt(e) { return e.lock === 0 ? .15 : 1; },
    draw(e) { const q = e.parts[0];
      if (q) { const on = HZ.some(h => h.link && h.t >= h.warn); if (!on) GFX.bolt(e.x, e.y, q.x, q.y, GFX.scale(rgb(140, 120, 255), .5 + S.beat * .4), 5); }
      twinDraw(e, e.lock === 0, rgb(70, 220, 255), e); } });
  LIVE.def('boss.twin', 'e,p,dt,k', `
  const SWAP_EVERY = 6, SP_RATE = .15, ARMS = 2, SP_SPD = 66, FAN_EVERY = 1.9, FAN_SPD = 96;
  const LINK_EVERY = 5.5, LINK_WARN = 1.3, LINK_DUR = 3.2, RING_EVERY = 2.2, WALL_EVERY = 4.2;
  const CA = rgb(70, 220, 255), CB = rgb(255, 70, 200), CL = rgb(200, 160, 255);
  const q = e.parts[0]; if (!q) return;
  if (k.cd(e, 'swap', SWAP_EVERY)) { e.lock ^= 1; AU.sfx('shield'); }
  const open = e.lock === 1 ? e : q, shut = e.lock === 1 ? q : e;
  if (k.cd(e, 'sp', SP_RATE)) { e.sa = (e.sa || 0) + .41;
    for (let i = 0; i < ARMS; i++) { k.shot(e.x, e.y, e.sa + i * TAU / ARMS, SP_SPD, CA); k.shot(q.x, q.y, -e.sa + i * TAU / ARMS, SP_SPD, CB); } }
  if (k.cd(e, 'fan', e.ph === 2 ? FAN_EVERY * .9 : FAN_EVERY)) k.fan(open.x, open.y, k.aim(open, p), e.ph === 2 ? 5 : 3, .5, FAN_SPD, open === e ? CA : CB);
  if (e.ph >= 1) {
    if (k.cd(e, 'link', LINK_EVERY, 1)) k.beam({ link: true, warn: LINK_WARN, dur: LINK_DUR, c: CL,
      upd(h) { if (q.dead || e.dead) { h.t = 1e9; return; } h.x = e.x; h.y = e.y; h.a = Math.atan2(q.y - e.y, q.x - e.x); h.len = Math.hypot(q.x - e.x, q.y - e.y); } });
    if (k.cd(e, 'ring', RING_EVERY)) { e.rs = !e.rs; const s = e.rs ? e : q; k.ring(s.x, s.y, 14, 56, rnd() * TAU, CL, 3, k.aim(s, p)); }
  }
  if (e.ph === 2 && k.cd(e, 'wall', WALL_EVERY, 2)) { const sd = pick(['L', 'R']); k.wall(sd, rndr(50, 230), 64, 48, CL, 15); }`);

  // ---------- 6: KERNEL — rewrites the game against you ----------
  PATCH.def({ id: 'kernel.fx', name: '0xK3: FX.REWRITE', desc: 'KERNEL rewrites a background shader constant', kind: 'bug', weight: 0, max: 1, can: () => kfxOK,
    apply() { if (typeof FX === 'undefined' || typeof FX.cur !== 'string') return false; const nm = 'fx.' + FX.cur, s = LIVE.src[nm]; if (!s) return false;
      const m = (s.match(/\b[A-Z][A-Z0-9_]*\s*=\s*\d*\.?\d+/g) || []).filter(t => { const v = +t.split('=')[1]; return v > 0 && v < 1e4; }); if (!m.length) return false;
      const t = pick(m), v = +t.split('=')[1], nv = v * 1.75 + (v < 1 ? .2 : 0); return LIVE.patch(nm, t, t.split('=')[0] + '=' + (Number.isInteger(v) ? Math.round(nv) : +nv.toFixed(3))); } });
  defBoss('kernel', { name: 'KERNEL', r: 30, hp: 16000, score: 100000, ph: [.75, .5, .25], c: rgb(255, 255, 255), infect: true, final: true, home: [CX, 78], fxp: ['matrix', 'matrix', 'plasma', 'feedback'],
    phn: ['SYSCALL', 'REWRITE // REVERTING YOU', 'SELF.MOD', 'KERNEL PANIC'],
    init(e) { e.eye = 0; e.code = (LIVE.src['boss.kernel'] || 'KERNEL').replace(/\s+/g, '').slice(0, 400); },
    move(e, p, dt) { const sp = [.35, .45, .5, .6][e.ph]; e.hx = CX + Math.sin(e.age * sp) * 110; e.hy = 78 + Math.sin(e.age * sp * 2) * 22;
      e.x = lerp(e.x, e.hx, 1 - Math.pow(.2, dt)); e.y = lerp(e.y, e.hy, 1 - Math.pow(.2, dt)); },
    onPhase(e) {
      if (e.ph === 1) { revertUp(); }
      if (e.ph === 2) { restoreUp(); fxSet('plasma', .3); kfxOK = true; const ok = PATCH.apply('kernel.fx'); kfxOK = false; if (ok) { e.bugs.push('kernel.fx'); st.bugs.push('kernel.fx'); banner('KERNEL: PATCHING FX.' + FX.cur.toUpperCase(), 'YOUR REALITY IS A STRING', 2); } }
      if (e.ph === 3) { st.bossMusic = 'final'; music('final'); const b = PATCH.infect(); if (b) { e.bugs.push(b.id); st.bugs.push(b.id); } S.glitch = Math.max(S.glitch, .8); }
    },
    onDie() { restoreUp(); },
    draw(e) {
      const ph = e.ph, b = S.beat, x = e.x, y = e.y, t = e.age;
      const cA = col(e, [rgb(80, 230, 255), rgb(255, 80, 220), rgb(120, 255, 140), rgb(255, 50, 60)][ph]), cB = col(e, rgb(255, 255, 255));
      GFX.glow(x, y, 76, cA, .45 + b * .25); GFX.disc(x, y, 47, DK);
      if (ph >= 1) for (const [tx, ty] of [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1]]) if (((S.t * 7 + tx) | 0) % 3 === 0) GFX.bolt(x, y, tx, ty, GFX.scale(cA, .5), 10);
      ol(POLY.hex, x, y, t * .3, 54, GFX.scale(cA, .45)); ol(POLY.hex, x, y, -t * .5, 44 + b * 3, cA);
      ol(POLY.oct, x, y, t * .8, 36, GFX.scale(cB, .5));
      const n = 28, code = e.code; for (let i = 0; i < n; i++) { const a = -t * .4 + i * TAU / n, ch = code[(i + (S.t * 6 | 0)) % code.length];
        GFX.text(ch, x + Math.cos(a) * 66 - 2, y + Math.sin(a) * 56 - 3, i % 7 === 0 ? cB : cA); }
      GFX.fill(POLY.chip, x, y, 0, 22, rgb(14, 16, 28)); ol(POLY.chip, x, y, 0, 22, cB);
      for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) { GFX.line(x + i * 8, y + s * 22, x + i * 8, y + s * 28, cA); GFX.line(x + s * 22, y + i * 8, x + s * 28, y + i * 8, cA); }
      const p = P(), la = Math.atan2(p.y - y, p.x - x), bl = Math.abs(Math.sin(t * .7)) > .97 ? .15 : 1;
      GFX.fill(SH('eye'), x, y, 0, 15, ph === 3 ? rgb(90, 0, 10) : rgb(10, 30, 50)); ol(SH('eye'), x, y, 0, 15 * bl + .5, cA);
      GFX.disc(x + Math.cos(la) * 6, y + Math.sin(la) * 3, 4 * bl, ph === 3 ? rgb(255, 40, 40) : cA); GFX.disc(x + Math.cos(la) * 6, y + Math.sin(la) * 3, 1.5 * bl, cB);
      GFX.glow(x + Math.cos(la) * 6, y + Math.sin(la) * 3, 8, cA, .8);
    } });
  function revertUp() {
    const ups = []; for (const id of PATCH.active) if (PATCH.all[id] && PATCH.all[id].kind === 'up' && !ups.includes(id)) ups.push(id);
    if (!ups.length) { const b = PATCH.infect(); if (b && st.boss) { st.boss.bugs.push(b.id); st.bugs.push(b.id); } return; }
    const id = pick(ups), n = PATCH.active.filter(x => x === id).length, p = PATCH.all[id];
    if (PATCH.cure(id)) { st.rev = { id, n, t: 15 }; banner('KERNEL: REVERTING ' + (p.name || id).toUpperCase(), 'YOUR UPGRADE HAS BEEN UNLINKED', 2.4); sfx('glitch'); S.glitch = Math.max(S.glitch, .7); kick(1.5); }
  }
  function restoreUp() {
    const r = st.rev; if (!r) return; st.rev = null; let ok = 0; for (let i = 0; i < r.n; i++) if (PATCH.apply(r.id)) ok++;
    if (ok) { banner('RESTORED ' + ((PATCH.all[r.id] && PATCH.all[r.id].name) || r.id).toUpperCase(), 'RELINKED x' + ok, 1.6); sfx('cure'); }
  }
  LIVE.def('boss.kernel', 'e,p,dt,k', `
  const SP_RATE = .13, ARMS = 4, SP_SPD = 76, FAN_EVERY = 2.1, FAN_SPD = 98;
  const WALL_EVERY = 3.1, WALL_SPD = 52, GAP_W = 62, RING_EVERY = 2.4, SWAP_EVERY = 6.5, MARK_EVERY = 3.4;
  const C = [rgb(80, 230, 255), rgb(255, 80, 220), rgb(120, 255, 140), rgb(255, 60, 70)][e.ph], CW = rgb(255, 255, 255);
  const FXS = ['matrix', 'plasma', 'tunnel', 'rotozoom', 'kefrens', 'moire', 'twister', 'fire'];
  if (e.ph === 0) {
    if (k.cd(e, 'sp', SP_RATE)) { e.sa = (e.sa || 0) + .29; for (let i = 0; i < ARMS; i++) k.shot(e.x, e.y, e.sa + i * TAU / ARMS, SP_SPD, C); }
    if (k.cd(e, 'fan', FAN_EVERY)) k.fan(e.x, e.y, k.aim(e, p), 5, .6, FAN_SPD, CW);
    if (k.cd(e, 'add', 9, 3) && k.count('drifter') < 4) { k.add('drifter'); k.add('gnat'); k.add('gnat'); }
  } else if (e.ph === 1) {
    if (k.cd(e, 'wall', WALL_EVERY, 1)) { const sd = pick(['T', 'L', 'R']); k.wall(sd, sd === 'T' ? rndr(60, 420) : rndr(50, 230), GAP_W, WALL_SPD, C); }
    if (k.cd(e, 'ring', RING_EVERY)) k.ring(e.x, e.y, 22, 60, rnd() * TAU, CW, 4, k.aim(e, p) + rndr(-.6, .6));
    if (k.cd(e, 'beam', 8, 3)) { const a = k.aim(e, p) + PI / 2; k.beam({ owner: e, a, warn: 1.3, dur: 3.4, spin: .3, c: C }); k.beam({ owner: e, a: a + PI, warn: 1.3, dur: 3.4, spin: .3, c: C }); }
    if (k.cd(e, 'swap', SWAP_EVERY)) { FX.set(pick(FXS), .25); FX.kick(1); S.glitch = Math.max(S.glitch, .4); }
    if (DIR.state.rev && (DIR.state.rev.t -= dt) <= 0) DIR.restoreUp();
  } else if (e.ph === 2) {
    if (k.cd(e, 'sp', SP_RATE * 1.15)) { e.sa = (e.sa || 0) + (e.pt % 6 < 3 ? .27 : -.27); for (let i = 0; i < ARMS + 1; i++) k.shot(e.x, e.y, e.sa + i * TAU / (ARMS + 1), SP_SPD * .95, C); }
    if (k.cd(e, 'fan', FAN_EVERY * 1.2)) k.fan(e.x, e.y, k.aim(e, p), 3, .3, FAN_SPD, CW);
    if (k.cd(e, 'mut', 14, 1) && k.count('mutator') < 1) k.add('mutator');
    if (k.cd(e, 'mark', MARK_EVERY, 2)) for (let i = 0; i < 2; i++) k.mark(p.x + rndr(-60, 60), p.y + rndr(-50, 50), 1.3 + i * .2, (x, y) => k.ring(x, y, 8, 46, rnd() * TAU, CW), CW);
    if (k.cd(e, 'snipe', 12, 2) && k.count('sniper') < 2) k.add('sniper');
    if (k.cd(e, 'wall', WALL_EVERY * 1.4, 3)) { const sd = pick(['T', 'L', 'R']); k.wall(sd, sd === 'T' ? rndr(60, 420) : rndr(50, 230), GAP_W + 8, WALL_SPD * .9, CW); }
  } else {
    if (k.cd(e, 'sp', SP_RATE * 1.25)) { e.sa = (e.sa || 0) + .23; for (let i = 0; i < 2; i++) { k.shot(e.x, e.y, e.sa + i * PI, SP_SPD + 4, C); k.shot(e.x, e.y, -e.sa + i * PI + PI / 2, SP_SPD, CW); } }
    if (k.cd(e, 'ring', RING_EVERY)) k.ring(e.x, e.y, 20, 60, rnd() * TAU, C, 4, k.aim(e, p));
    if (k.cd(e, 'mark', MARK_EVERY * .85, 2)) for (let i = 0; i < 3; i++) k.mark(p.x + rndr(-70, 70), p.y + rndr(-55, 55), 1.3 + i * .15, (x, y) => k.ring(x, y, 8, 48, rnd() * TAU, C), CW);
    if (k.cd(e, 'wall', WALL_EVERY * 1.1, 2)) k.wall(pick(['L', 'R']), rndr(50, 230), GAP_W + 6, WALL_SPD * .9, CW);
    if (k.cd(e, 'beam', 11, 5)) { const a = k.aim(e, p) - PI / 2; k.beam({ owner: e, a, warn: 1.3, dur: 3, spin: -.34, c: C }); k.beam({ owner: e, a: a + PI, warn: 1.3, dur: 3, spin: -.34, c: C }); }
    if (k.cd(e, 'swap', SWAP_EVERY * .8)) { FX.set(pick(['feedback', 'fire', 'matrix']), .2); FX.kick(1.2); }
    if (k.cd(e, 'sweep', 5.6, 3)) { const down = rnd() < .5; k.sweep({ pos: down ? 30 : 256, end: down ? 256 : 30, v: down ? 46 : -46, gap: rndr(70, 410), gv: rndr(-30, 30), gapW: 70, c: CW, warn: 1.2 }); }
  }`);

  // ======================= DIRECTOR =======================
  function startSector(i, quiet) {
    st.sector = i; S.sector = i; st.wave = 0; S.wave = 0; S.diff = LIVE.fn['dir.diff'](i, 0);
    const sc = SECTORS[i]; st.phase = 'intro'; st.t = 0; st.bossMusic = 'boss';
    fxSet(sc.fx[0], 1.2); music(sc.music); kick(1);
    if (!quiet) banner((sc.final ? 'FINAL // ' : 'SECTOR ' + (i + 1) + ': ') + sc.name, sc.sub, 3);
    st.log.push('sector:' + i);
  }
  function startWave(w) {
    const sc = SECTORS[st.sector], wv = sc.waves[w];
    st.wave = w; S.wave = w; S.diff = LIVE.fn['dir.diff'](st.sector, w);
    st.phase = 'wave'; st.t = 0;
    st.w = { t: 0, i: 0, jobs: [], steps: wv.s, end: wv.s[wv.s.length - 1][0], clr: 0, mut: false, peak: 0 };
    if (w > 0) fxSet(sc.fx[w & 1], 1);
    banner('WAVE ' + (w + 1) + '/' + sc.waves.length, wv.name, 1.6);
    st.log.push('wave:' + st.sector + '.' + w);
  }
  function fireStep(w, s) {
    const form = s[1], type = s[2], arg = s[4], n = LIVE.fn['dir.budget'](s[3], type, st.sector, st.wave);
    if (form === 'stream') { const side = sideOf(arg), dur = (parseFloat(String(arg || '').slice(1)) || 8) * pace(), u = rndr(.2, .8);
      for (let i = 0; i < n; i++) w.jobs.push({ t: w.t + i * dur / n, type, side, u }); }
    else if (form === 'trickle') { const dur = (+arg || 10) * pace(); for (let i = 0; i < n; i++) w.jobs.push({ t: w.t + i * dur / n, type, far: true }); }
    else { const f = FORMS[form] || FORMS.rand, pts = f(n, arg, type);
      for (let i = 0; i < pts.length; i++) w.jobs.push({ t: w.t + i * .06, type: pts[i][2] || type, x: pts[i][0], y: pts[i][1] }); }
  }
  function runJobs(w) {
    const J = w.jobs;
    for (let i = 0; i < J.length; i++) { const j = J[i]; if (j.t > w.t) continue;
      let x = j.x, y = j.y; if (j.side) { const q = edgePt(j.side, clamp(j.u + rndr(-.06, .06), 0, 1)); x = q[0]; y = q[1]; } else if (j.far) { const q = far(); x = q[0]; y = q[1]; }
      const r = LIVE.fn['dir.spawn'](j.type, x, y);
      if (r === false) { j.t = w.t + .4; continue; }
      J.splice(i--, 1);
    }
  }
  function goPatch(next, arg) { st.phase = 'patch'; st.next = next; st.t = 0; st.patches++; st.log.push('patch:' + (arg && arg.picks || 1)); SCENE.go('patch', arg); }
  function startBoss() {
    const sc = SECTORS[st.sector]; st.phase = 'boss'; st.t = 0; st.boss = null; S.wave = sc.waves.length; st.wave = S.wave; st.bossKey = sc.boss;
    S.diff = LIVE.fn['dir.diff'](st.sector, 4);
    const B = BOSS[sc.boss]; st.bossMusic = 'boss'; music('boss'); sfx('warn'); fxSet((B.fxp && B.fxp[0]) || sc.fx[0], 1.5);
    banner(sc.final ? 'WARNING // KERNEL MODE' : 'WARNING', 'BOSS PROCESS DETECTED: ' + B.name, WARN_T);
    st.log.push('boss:' + sc.boss);
  }
  function spawnBoss() {
    const key = SECTORS[st.sector].boss, B = BOSS[key], p = P();
    let x = B.home ? B.home[0] : CX; if (Math.abs(p.x - x) < 60 && p.y < 130) x = p.x < CX ? 360 : 120;
    const e = ENT.spawn('boss.' + key, x, -40, {}); if (B.home) { e.hx = x; }
    st.boss = e; S.boss = e; banner(B.name, (B.phn && B.phn[0]) || '', 1.8); kick(1.5); S.shake = Math.max(S.shake, 8);
    st.log.push('bossspawn:' + key);
  }
  function outro(dt) {
    const o = st.outro, T = [0, .25, .5, .75, 1.0, 1.3, 1.6, 2.0, 2.4];
    while (o.i < T.length && st.t >= T[o.i]) {
      const big = o.i === T.length - 1, a = rnd() * TAU, d = big ? 0 : rnd() * o.r * 1.6, x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
      if (typeof GAME !== 'undefined') GAME.explode(x, y, big ? 70 : 26, 0, T_PSHOT);
      if (typeof GFX !== 'undefined') { GFX.ring(x, y, 4, big ? 220 : 50, big ? W8 : o.c, big ? 1 : .4); GFX.burst(x, y, big ? 220 : 40, big ? o.c : W8, big ? 200 : 90, big ? 1.2 : .5); if (big) { GFX.ring(x, y, 10, 320, o.c, 1.4); GFX.floatText('PROCESS TERMINATED', x - 50, y - 20, W8, 1.6); } }
      S.shake = Math.max(S.shake, big ? 16 : 6); S.flash = Math.max(S.flash, big ? 1 : .2); sfx(big ? 'bigkill' : 'explode', { pitch: .8 + rnd() * .4 }); kick(big ? 2 : .5);
      if (big && typeof GAME !== 'undefined') GAME.dropBits(o.x, o.y, o.final ? 60 : 30);
      o.i++;
    }
    if (st.t > (o.final ? 5 : 3)) {
      const p = S.player; if (p && p.hp > 0) p.hp = Math.min(p.maxhp, p.hp + HEAL);
      if (o.final) { st.phase = 'done'; cleanupBugs(); st.log.push('win'); BUS.emit('run:win'); return; }
      goPatch({ type: 'sector', s: st.sector + 1 }, { picks: 2 });
    }
  }
  function resume() {
    const n = st.next; st.next = null;
    if (!n) { st.phase = 'wave'; return; }
    if (n.type === 'wave') { music(SECTORS[st.sector].music); startWave(n.w); }
    else if (n.type === 'boss') startBoss();
    else if (n.type === 'sector') startSector(Math.min(n.s, SECTORS.length - 1));
  }
  function cleanupBugs() { for (const id of st.bugs) PATCH.cure(id); st.bugs.length = 0; LIVE.revertTag('kernel.fx'); }

  function update(dt) {
    beatTrack(dt); hzUpdate(dt); if (HZ.length || st.phase === 'boss') ensureHz();
    const p = S.player, alive = !p || !(p.dead || p.hp <= 0);
    let n = 0, mut = 0; ENT.each(T_ENEMY, e => { n++; if (e.type === 'mutator') mut++; });
    st.intens = lerp(st.intens, LIVE.fn['dir.intensity'](n, st.phase === 'boss' ? st.boss : null), 1 - Math.pow(.3, dt));
    if (typeof AU !== 'undefined' && AU.intensity) AU.intensity(st.intens);
    st.t += dt;
    if (!alive) return;
    if (st.phase === 'idle') { startSector(0); return; }
    if (st.phase === 'patch') { resume(); return; }
    if (st.phase === 'intro') { if (st.t > INTRO_T) { if (SECTORS[st.sector].waves.length) startWave(0); else startBoss(); } return; }
    if (st.phase === 'wave') {
      const w = st.w; w.t += dt;
      while (w.i < w.steps.length && w.steps[w.i][0] * pace() <= w.t) fireStep(w, w.steps[w.i++]);
      runJobs(w); LIVE.fn['dir.mutator'](w, st.sector, st.wave);
      if (n > w.peak) w.peak = n;
      const done = w.i >= w.steps.length && !w.jobs.length;
      if (done && n === 0) { w.clr += dt; if (w.clr > CLEAR_HOLD) { st.phase = 'clear'; st.t = 0; if (st.sector < REPAIR_SECTORS && typeof GAME !== 'undefined') GAME.heal(1); banner('WAVE CLEARED', 'SECTOR ' + (st.sector + 1) + ' // ' + SECTORS[st.sector].waves[st.wave].name + ' OK', 1.4); sfx('levelup'); } }
      else w.clr = 0;
      if (done && n > 0 && w.t > w.end * pace() + STALL_T) { ENT.each(T_ENEMY, e => ENT.kill(e, e)); st.log.push('stall:' + st.sector + '.' + st.wave); }
      return;
    }
    if (st.phase === 'clear') { if (st.t > BREATHER) { const nw = st.wave + 1; goPatch(nw < SECTORS[st.sector].waves.length ? { type: 'wave', w: nw } : { type: 'boss' }); } return; }
    if (st.phase === 'boss') {
      if (!st.boss && st.t > WARN_T) spawnBoss();
      if (st.t < WARN_T && st.t - dt < 1.2 && st.t >= 1.2) sfx('warn');
      return;
    }
    if (st.phase === 'outro') { outro(dt); return; }
  }

  function wipe(keepRev) {
    if (st.boss) { const e = st.boss; cureBugs(e); killParts(e); e.dead = true; }
    for (const e of ENT.list) if (e.boss || (e.T && e.T.boss) || e.type === 'boss.seg' || e.type === 'boss.twinB' || e.type === 'boss.frag') e.dead = true;
    ENT.each(T_ENEMY, e => { if (e.type === 'mutator') ENT.kill(e, e); else e.dead = true; }); ENT.each(T_ESHOT, e => { e.dead = true; });
    cleanupBugs(); if (keepRev) restoreUp(); else st.rev = null;
    HZ.length = 0; S.boss = null; st.boss = null; st.w = null; st.next = null; st.outro = null; kfxOK = false;
  }
  function reset() {
    wipe(false);
    Object.assign(st, { phase: 'idle', t: 0, sector: 0, wave: 0, music: null, bossKey: '', bossMusic: 'boss', intens: 0, patches: 0, log: [] });
    S.sector = 0; S.wave = 0; S.diff = LIVE.fn['dir.diff'](0, 0); S.boss = null;
  }
  BUS.on('patch:done', () => { if (S.mode !== 'win' && st.phase !== 'done') { const m = st.next && st.next.type === 'boss' ? 'boss' : st.next && st.next.type === 'sector' ? SECTORS[Math.min(st.next.s, SECTORS.length - 1)].music : st.music; if (m && typeof AU !== 'undefined' && AU.music) AU.music(m); } });

  const debug = {
    skipTo(s, w) { wipe(true); s = clamp(s | 0, 0, SECTORS.length - 1); w = w | 0; const nw = SECTORS[s].waves.length; startSector(s, w >= nw);
      if (w >= nw) startBoss(); else startWave(w); return st.phase; },
    boss(name) { name = String(name).toLowerCase(); const i = SECTORS.findIndex(sc => sc.boss === name || BOSS[sc.boss].name.toLowerCase().includes(name)); if (i < 0) return false;
      debug.skipTo(i, 99); st.t = WARN_T - .01; return true; },
    kill() { if (st.boss) ENT.damage(st.boss, st.boss.hp + 1, null); },
    phase(k) { const e = st.boss; if (!e) return; const B = BOSS[st.bossKey]; const th = B.ph[k - 1]; if (th != null) { e.hp = Math.floor(e.maxhp * th) - 1; e.inv = 0; } }
  };

  return { reset, update, sectors: SECTORS, state: st, bosses: BOSS, k: K, hz: HZ, far, HPK: 1, PACE: .77, debug, restoreUp,
    spawn: (t, x, y, o) => LIVE.fn['dir.spawn'](t, x, y, o) };

  // arc helper (function declaration, hoisted)
  function arc(x, y, r, a0, a1, c) { const n = Math.max(3, Math.ceil((a1 - a0) * r / 4)); let px = x + Math.cos(a0) * r, py = y + Math.sin(a0) * r;
    for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, qx = x + Math.cos(a) * r, qy = y + Math.sin(a) * r; GFX.lineA(px, py, qx, qy, c); px = qx; py = qy; } }
})();
