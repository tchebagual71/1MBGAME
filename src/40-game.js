// ===== 40-game.js : player, weapon, bullets, enemies, pickups, collisions, scoring, gameplay patches =====
const GAME = (() => {
  // ---------- arena / tunables (non-live) ----------
  const AX0 = 8, AX1 = 472, AY0 = 20, AY1 = 262;
  const CS = 32, GW = 15, GH = 9;                       // collision bucket grid
  const MAX_PSHOT = 460, MAX_ESHOT = 520, MAX_BITS = 220;
  const COMBO_TH = [0, 0, 5, 12, 20, 30, 42, 56, 72, 90, 110];   // combo needed for mult = index
  const ENEMY_TYPES = ['gnat', 'drifter', 'turret', 'worm', 'splitter', 'shard', 'charger', 'orbiter', 'mine', 'sniper', 'weaver', 'mutator'];

  const PCOL = rgb(80, 220, 255), PCORE = rgb(220, 250, 255), PDARK = rgb(4, 16, 30);
  const ECOL = rgb(255, 120, 40), EHOT = rgb(255, 235, 170), EDARK = rgb(40, 6, 0);
  const DARK = rgb(6, 6, 14), BITC = rgb(140, 255, 190);

  // vector shapes (model radius ≈ 1)
  const SH = {
    ship: [1.3, 0, -.8, .8, -.35, 0, -.8, -.8],
    dart: [1, 0, -.7, .7, -.25, 0, -.7, -.7],
    hex: [1, 0, .5, .87, -.5, .87, -1, 0, -.5, -.87, .5, -.87],
    sq: [1, 1, -1, 1, -1, -1, 1, -1],
    sq2: [1, 0, 0, 1, -1, 0, 0, -1],
    head: [1, 0, .35, .85, -.7, .55, -.7, -.55, .35, -.85],
    dia: [0, -1.1, .75, 0, 0, 1.1, -.75, 0],
    tri: [1, 0, -.6, .75, -.6, -.75],
    arrow: [1.1, 0, 0, .9, -.8, .9, -.4, 0, -.8, -.9, 0, -.9],
    oct: [1, 0, .7, .7, 0, 1, -.7, .7, -1, 0, -.7, -.7, 0, -1, .7, -.7],
    star: [1, 0, .38, .38, 0, 1, -.38, .38, -1, 0, -.38, -.38, 0, -1, .38, -.38],
    snipe: [1.4, 0, .1, .5, -.8, .3, -.8, -.3, .1, -.5],
    pin: [1, 0, .2, .35, -.5, .87, -.4, 0, -.5, -.87, .2, -.35],
    chip: [.8, -1, 1, -.8, 1, .8, .8, 1, -.8, 1, -1, .8, -1, -.8, -.8, -1],
  };

  // ---------- internal state ----------
  let hsT = 0, slowT = 0, comboTimer = 0, hitSfxT = 0, pickSfxT = 0, pickChain = 0, spawnSfxT = 0, bitsLive = 0, stamp = 1;
  const grid = []; for (let i = 0; i < GW * GH; i++) grid.push([]);
  const enemies = [], pshots = [], eshots = [];
  const orbs = new Float32Array(64 * 3); let orbN = 0;
  const ghosts = []; for (let i = 0; i < 10; i++) ghosts.push({ x: 0, y: 0, rot: 0, t: 0 });
  let ghostI = 0, ghostT = 0;

  const sfx = (n, o) => { try { AU.sfx(n, o); } catch (e) { } };
  const pop = (str, x, y, c, life) => GFX.floatText(str, clamp(x, 4 + str.length * 3, 476 - str.length * 3), y, c, life);
  const hpMul = () => 1 + (S.diff - 1) * .6;
  const spdMul = () => 1 + (S.diff - 1) * .18;
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  // =====================================================================
  //  LIVE SOURCE — the player reads (and patches) all of this
  // =====================================================================
  LIVE.def('wpn.fire', 'p,ax,ay,dt', `const RATE=5.5, N=1, SPREAD=.16, SPEED=330, DMG=1, SIZE=2;
const o = { team: T_PSHOT, dmg: DMG, r: SIZE, pierce: 0, bounce: 0, homing: 0 };
const a = Math.atan2(ay, ax);
for (let i = 0; i < N; i++) {
  const d = a + (i - (N - 1) / 2) * SPREAD;
  GAME.shoot(p.x + ax * 5, p.y + ay * 5, Math.cos(d) * SPEED, Math.sin(d) * SPEED, o);
}
/*HOOK:fire*/
GAME.recoil(p, ax, ay, N);
AU.sfx('shoot');
return 1 / RATE;`);

  LIVE.def('wpn.bullet', 'b,dt', `if (b.homing) {
  if (!b.tgt || b.tgt.dead) b.tgt = GAME.nearestEnemy(b.x, b.y, 150);
  if (b.tgt) {
    const sp = Math.hypot(b.vx, b.vy), want = Math.atan2(b.tgt.y - b.y, b.tgt.x - b.x);
    let a = Math.atan2(b.vy, b.vx);
    a += clamp(Math.atan2(Math.sin(want - a), Math.cos(want - a)), -1, 1) * b.homing * dt;
    b.vx = Math.cos(a) * sp;
    b.vy = Math.sin(a) * sp;
  }
}
/*HOOK:bullet*/
b.x += b.vx * dt;
b.y += b.vy * dt;`);

  LIVE.def('wpn.hit', 'b,e', `const CRIT=0, CRIT_X=3, CHAIN=0, BLAST=0;
let dmg = b.dmg;
if (rnd() < CRIT) { dmg *= CRIT_X; GAME.pop('CRIT!', e.x, e.y - e.r - 6, C.yellow); }
if (CHAIN > 0) GAME.chain(e, CHAIN, b.dmg * .7);
if (BLAST > 0) GAME.explode(b.x, b.y, BLAST, b.dmg * .5, T_PSHOT);
/*HOOK:onhit*/
return dmg;`);

  LIVE.def('ply.move', 'p,dt', `const SPEED=118, ACCEL=16;
let mx = IN.mvx, my = IN.mvy;
/*HOOK:move*/
const k = 1 - Math.exp(-ACCEL * dt);
p.vx += (mx * SPEED - p.vx) * k;
p.vy += (my * SPEED - p.vy) * k;
p.x += p.vx * dt;
p.y += p.vy * dt;`);

  LIVE.def('ply.dash', 'p', `const BOOST=340, DUR=.16, IFRAMES=.3, COOLDOWN=.85;
let dx = IN.mvx, dy = IN.mvy;
if (dx * dx + dy * dy < .04) { dx = p.ax; dy = p.ay; }
/*HOOK:aim*/
const l = Math.hypot(dx, dy) || 1;
p.vx = dx / l * BOOST;
p.vy = dy / l * BOOST;
p.dashT = DUR;
p.inv = Math.max(p.inv, IFRAMES);
p.dashCd = p.dashMax = COOLDOWN;
AU.sfx('dash');
/*HOOK:dash*/`);

  LIVE.def('ply.hurt', 'p,dmg,src', `const INV=1.2, KNOCK=190, BLOCK=0;
if (rnd() < BLOCK) { GAME.pop('ECC: BLOCKED', p.x, p.y - 12, C.cyan); p.inv = .5; return false; }
p.hp -= dmg;
p.inv = INV;
const a = src ? Math.atan2(p.y - src.y, p.x - src.x) : rnd() * TAU;
p.vx += Math.cos(a) * KNOCK;
p.vy += Math.sin(a) * KNOCK;
S.shake = Math.max(S.shake, 7);
S.flash = Math.max(S.flash, .2);
AU.sfx('hurt');
/*HOOK:hurt*/
return true;`);

  LIVE.def('ply.kill', 'p,e', `const BITS=1, LEECH=0;
GAME.dropBits(e.x, e.y, Math.round(e.T.bits * BITS));
if (rnd() < LEECH) GAME.heal(1);
/*HOOK:kill*/`);

  LIVE.def('ply.tick', 'p,dt', `const MAXHP=5, MAGNET=40, REGEN=0, ORBITALS=0, ORBIT_R=24, SPIN=3.2;
p.maxhp = MAXHP;
p.magnet = MAGNET;
if (p.hp < p.maxhp) p.regen += REGEN * dt;
if (p.regen >= 1) { p.regen = 0; GAME.heal(1); }
for (let i = 0; i < ORBITALS; i++) {
  const a = S.t * SPIN + i * TAU / ORBITALS;
  GAME.orb(p.x + Math.cos(a) * ORBIT_R, p.y + Math.sin(a) * ORBIT_R, 2);
}
/*HOOK:tick*/`);

  // every enemy runs through this scheduler, then its own ai.<type>
  LIVE.def('ai.step', 'e,p,dt', `const TIME=1;
dt *= TIME;
LIVE.fn['ai.' + e.type](e, p, dt);
e.x += e.vx * dt;
e.y += e.vy * dt;`);

  const AI = {
    gnat: `const SPEED=64, STEER=4, BUZZ=.9;
const a = GAME.aim(e, p) + Math.sin(e.age * 7 + e.seed) * BUZZ;
e.vx += (Math.cos(a) * SPEED * e.spd - e.vx) * STEER * dt;
e.vy += (Math.sin(a) * SPEED * e.spd - e.vy) * STEER * dt;`,

    drifter: `const SPEED=40, PULL=10, SPIN=1.4;
if (e.x < 8 + e.r) e.vx = Math.abs(e.vx);
if (e.x > 472 - e.r) e.vx = -Math.abs(e.vx);
if (e.y < 20 + e.r) e.vy = Math.abs(e.vy);
if (e.y > 262 - e.r) e.vy = -Math.abs(e.vy);
e.vx += Math.sign(p.x - e.x) * PULL * dt;
e.vy += Math.sign(p.y - e.y) * PULL * dt;
const v = Math.hypot(e.vx, e.vy) || 1;
e.vx *= SPEED * e.spd / v;
e.vy *= SPEED * e.spd / v;
e.rot += SPIN * dt;`,

    turret: `const RELOAD=2.4, BURST=3, GAP=.13, BSPD=96;
e.vx -= e.vx * 4 * dt;
e.vy -= e.vy * 4 * dt;
e.rot = GAME.aim(e, p);
e.cd -= dt;
if (e.cd > 0) return;
if (e.n > 0) { e.n--; e.cd = GAP; GAME.eshot(e.x, e.y, e.rot, BSPD * e.spd); AU.sfx('shoot2'); }
else { e.n = BURST; e.cd = RELOAD; }`,

    worm: `const SPEED=46, WAVE=3, AMP=.9, TURN=1.6;
const want = GAME.aim(e, p);
e.dir += Math.atan2(Math.sin(want - e.dir), Math.cos(want - e.dir)) * TURN * dt;
const a = e.dir + Math.sin(e.age * WAVE) * AMP;
e.vx = Math.cos(a) * SPEED * e.spd;
e.vy = Math.sin(a) * SPEED * e.spd;
e.rot = a;`,

    splitter: `const SPEED=30, STEER=2, SPIN=2;
const a = GAME.aim(e, p);
e.vx += (Math.cos(a) * SPEED * e.spd - e.vx) * STEER * dt;
e.vy += (Math.sin(a) * SPEED * e.spd - e.vy) * STEER * dt;
e.rot += SPIN * dt;`,

    shard: `const SPEED=95, STEER=2.6;
const a = GAME.aim(e, p);
e.vx += (Math.cos(a) * SPEED * e.spd - e.vx) * STEER * dt;
e.vy += (Math.sin(a) * SPEED * e.spd - e.vy) * STEER * dt;
e.rot = Math.atan2(e.vy, e.vx);`,

    charger: `const SEEK=26, WIND=.7, LOCK=.2, DASH=280, DASH_T=.55, REST=.7;
e.t -= dt;
if (e.st === 0) {            // stalk
  e.rot = GAME.aim(e, p);
  e.vx = Math.cos(e.rot) * SEEK;
  e.vy = Math.sin(e.rot) * SEEK;
  if (e.t <= 0) { e.st = 1; e.t = WIND; AU.sfx('charge'); }
} else if (e.st === 1) {     // wind-up: aim, then lock
  if (e.t > LOCK) e.rot = GAME.aim(e, p);
  e.vx -= e.vx * 8 * dt;
  e.vy -= e.vy * 8 * dt;
  if (e.t <= 0) { e.st = 2; e.t = DASH_T; e.vx = Math.cos(e.rot) * DASH * e.spd; e.vy = Math.sin(e.rot) * DASH * e.spd; }
} else if (e.st === 2) {     // dash
  if (e.t <= 0) { e.st = 3; e.t = REST; }
} else {                     // recover
  e.vx -= e.vx * 6 * dt;
  e.vy -= e.vy * 6 * dt;
  if (e.t <= 0) { e.st = 0; e.t = 1 + rnd(); }
}`,

    orbiter: `const R=80, ORBIT=.9, PULL=3, RELOAD=1.9, BSPD=88;
e.ang += ORBIT * e.dirn * dt;
const tx = p.x + Math.cos(e.ang) * R, ty = p.y + Math.sin(e.ang) * R;
e.vx = (tx - e.x) * PULL;
e.vy = (ty - e.y) * PULL;
GAME.cap(e, 95 * e.spd);
e.rot += 3 * dt;
e.cd -= dt;
if (e.cd <= 0) { e.cd = RELOAD; GAME.eshot(e.x, e.y, GAME.aim(e, p), BSPD * e.spd); AU.sfx('shoot2'); }`,

    mine: `const FUSE=.75, RANGE=38, BLAST=36, DRIFT=10;
if (!e.fuse) {
  e.vx = Math.cos(e.seed + e.age * .4) * DRIFT;
  e.vy = Math.sin(e.seed + e.age * .3) * DRIFT;
  if (GAME.dist(e, p) < RANGE) { e.fuse = FUSE; e.blast = BLAST; AU.sfx('warn'); }
} else {
  e.vx = e.vy = 0;
  e.fuse -= dt;
  if (e.fuse <= 0) { GAME.explode(e.x, e.y, BLAST, 1, T_ESHOT); ENT.kill(e, e); }
}`,

    sniper: `const MOVE=1.5, AIM=1.3, LOCK=.35, BEAM=.22, REST=.8, SPEED=70;
e.t -= dt;
if (e.st === 0) {            // reposition
  GAME.seek(e, e.tx, e.ty, SPEED);
  if (e.t <= 0) { e.st = 1; e.t = AIM; AU.sfx('charge'); }
} else if (e.st === 1) {     // laser sight: track, then lock
  e.vx -= e.vx * 6 * dt;
  e.vy -= e.vy * 6 * dt;
  if (e.t > LOCK) e.rot = GAME.aim(e, p);
  if (e.t <= 0) { e.st = 2; e.t = BEAM; AU.sfx('laser'); S.shake = Math.max(S.shake, 3); }
} else if (e.st === 2) {     // beam
  GAME.beam(e.x, e.y, e.rot, 3);
  if (e.t <= 0) { e.st = 3; e.t = REST; }
} else if (e.t <= 0) {
  e.st = 0; e.t = MOVE;
  GAME.spot(e, 110);
}`,

    weaver: `const ARMS=3, RATE=5, SPIN=1.9, BSPD=58, DRIFT=14;
e.rot += SPIN * dt;
GAME.seek(e, p.x, p.y, DRIFT);
if (e.age % 4.5 > 3) return;     // breathe
e.cd -= dt;
if (e.cd <= 0) {
  e.cd = 1 / RATE;
  for (let i = 0; i < ARMS; i++) GAME.eshot(e.x, e.y, e.rot + i * TAU / ARMS, BSPD * e.spd);
}`,

    mutator: `const FLEE=64, WALL=44, JINK=1.7;
if (!e.infected) { e.infected = true; e.bug = PATCH.infect(); GAME.onInfect(e); }
let a = GAME.aim(e, p) + PI + Math.sin(e.age * JINK) * .8;
const wx = (e.x < 8 + WALL) - (e.x > 472 - WALL), wy = (e.y < 20 + WALL) - (e.y > 262 - WALL);
if (wx || wy) a = Math.atan2(Math.sin(a) + wy * 1.6, Math.cos(a) + wx * 1.6);
e.vx += (Math.cos(a) * FLEE * e.spd - e.vx) * 3 * dt;
e.vy += (Math.sin(a) * FLEE * e.spd - e.vy) * 3 * dt;
e.rot = Math.sin(e.age * 3) * .3;`,
  };
  for (const k in AI) LIVE.def('ai.' + k, 'e,p,dt', AI[k]);

  // =====================================================================
  //  helpers exposed to live code
  // =====================================================================
  const H = {
    aim: (e, p) => Math.atan2(p.y - e.y, p.x - e.x),
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    cap(e, v) { const l = Math.hypot(e.vx, e.vy); if (l > v) { e.vx *= v / l; e.vy *= v / l; } },
    seek(e, tx, ty, spd) { const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy) || 1, k = Math.min(1, l / 30);
      e.vx += (dx / l * spd * k - e.vx) * Math.min(1, 4 * S.dt); e.vy += (dy / l * spd * k - e.vy) * Math.min(1, 4 * S.dt); },
    spot(e, mind) { const p = S.player || { x: 240, y: 140 };
      for (let i = 0; i < 12; i++) { e.tx = rndr(AX0 + 24, AX1 - 24); e.ty = rndr(AY0 + 24, AY1 - 24); if (Math.hypot(e.tx - p.x, e.ty - p.y) >= mind) break; } },
    eshot(x, y, ang, spd, o) { return shoot(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd, o); },
    nearestEnemy(x, y, maxd) { let b = null, bd = maxd * maxd;
      for (let i = 0; i < enemies.length; i++) { const e = enemies[i]; if (e.dead || e.warp > 0) continue; const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y); if (d < bd) { bd = d; b = e; } }
      return b; },
    pop(str, x, y, c) { pop(str, x, y, c || C.white); },
    recoil(p, ax, ay, n) { p.kick = Math.min(3, p.kick + 1.4); p.muz = .05; p.vx -= ax * (6 + n); p.vy -= ay * (6 + n); },
    orb(x, y, dmg) { if (orbN >= 64) return; orbs[orbN * 3] = x; orbs[orbN * 3 + 1] = y; orbs[orbN * 3 + 2] = dmg; orbN++; },
    heal(n) { const p = S.player; if (!p || p.dead || p.hp >= p.maxhp) return; p.hp = Math.min(p.maxhp, p.hp + n);
      pop('+' + n + ' HP', p.x, p.y - 12, C.green); GFX.ring(p.x, p.y, 4, 22, C.green, .35); sfx('pickup', { pitch: 1.6 }); },
    slow(t) { slowT = Math.max(slowT, t); },
    hitstop(t) { hsT = Math.max(hsT, t); },
    // sniper beam: hitscan ray from (x,y) along ang, half-width w
    beam(x, y, ang, w) { const p = S.player; if (!p || p.dead) return;
      const c = Math.cos(ang), s = Math.sin(ang), dx = p.x - x, dy = p.y - y, t = dx * c + dy * s;
      if (t > 0 && Math.abs(dx * s - dy * c) < w + p.r) hurtPlayer(1, { x: p.x - c * 8, y: p.y - s * 8 }); },
    // arc lightning from e to n further enemies
    chain(e, n, dmg) { const id = ++stamp; e._ch = id; let cur = e;
      for (let k = 0; k < n; k++) { let b = null, bd = 80 * 80;
        for (let i = 0; i < enemies.length; i++) { const o = enemies[i]; if (o.dead || o._ch === id || o.warp > 0) continue; const d = (o.x - cur.x) ** 2 + (o.y - cur.y) ** 2; if (d < bd) { bd = d; b = o; } }
        if (!b) break; b._ch = id; GFX.bolt(cur.x, cur.y, b.x, b.y, rgb(170, 220, 255), 5); GFX.spark(b.x, b.y, 0, 0, C.white, .15, 2);
        ENT.damage(b, dmg, { x: cur.x, y: cur.y, team: T_PSHOT }); cur = b; }
      if (cur !== e) sfx('laser', { vol: .3, pitch: 2 }); },
    // fork a hitting bullet into n children
    split(b, n, spread) { const a = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy) * .85;
      for (let i = 0; i < n; i++) { const d = a + (i - (n - 1) / 2) * spread;
        const c = shoot(b.x, b.y, Math.cos(d) * sp, Math.sin(d) * sp, { team: T_PSHOT, dmg: Math.max(.5, b.dmg * .5), r: Math.max(1.5, b.r * .75), gen: b.gen + 1, life: .6 }); if (c) c.last = b.last; } },
    onInfect(e) {
      e.label = e.bug ? e.bug.name : 'NULL_PTR';
      if (e.bug) { sfx('bug'); S.glitch = Math.max(S.glitch, .85); pop('INJECT ' + e.bug.name, e.x, e.y - 18, C.red, 1.4); GFX.ring(e.x, e.y, 4, 46, C.red, .5); S.shake = Math.max(S.shake, 4); }
    },
  };

  // =====================================================================
  //  bullets
  // =====================================================================
  let nP = 0, nE = 0;   // live counts (updated each frame in collide)
  function shoot(x, y, vx, vy, o) {
    const pl = !!o && (o.team === T_PSHOT || o.team === T_PLAYER);
    if (pl ? nP >= MAX_PSHOT : nE >= MAX_ESHOT) return null;
    if (pl) nP++; else nE++;
    const b = ENT.spawn('shot', x, y);
    b.team = pl ? T_PSHOT : T_ESHOT; b.vx = vx; b.vy = vy;
    if (o) {
      b.dmg = o.dmg == null ? 1 : o.dmg; b.r = o.r || 2; b.c = o.c || (pl ? PCOL : ECOL); b.life = o.life || (pl ? 2.2 : 7);
      b.pierce = o.pierce | 0; b.bounce = o.bounce | 0; b.homing = o.homing || 0; b.kind = o.kind || (pl ? 'bolt' : 'orb');
      b.accel = o.accel || 0; b.turn = o.turn || 0; b.grav = o.grav || 0; b.gen = o.gen || 0;
    } else { b.dmg = 1; b.r = 2; b.c = ECOL; b.life = 7; b.pierce = 0; b.bounce = 0; b.homing = 0; b.kind = 'orb'; b.accel = 0; b.turn = 0; b.grav = 0; b.gen = 0; }
    b.tgt = null; b.last = null; b.hot = b.kind === 'orb' || b.kind === 'big' ? EHOT : C.white;
    return b;
  }

  ENT.def('shot', { r: 2, hp: 1, team: T_ESHOT, layer: 4,
    update(b, dt) {
      b.life -= dt; if (b.life <= 0) { b.dead = true; return; }
      if (b.team === T_PSHOT) {
        LIVE.fn['wpn.bullet'](b, dt);
        if (b.x < AX0 || b.x > AX1 || b.y < AY0 || b.y > AY1) {
          if (b.bounce > 0) {
            b.bounce--; b.last = null;
            if (b.x < AX0) { b.x = 2 * AX0 - b.x; b.vx = Math.abs(b.vx); } else if (b.x > AX1) { b.x = 2 * AX1 - b.x; b.vx = -Math.abs(b.vx); }
            if (b.y < AY0) { b.y = 2 * AY0 - b.y; b.vy = Math.abs(b.vy); } else if (b.y > AY1) { b.y = 2 * AY1 - b.y; b.vy = -Math.abs(b.vy); }
            GFX.spark(b.x, b.y, -b.vx * .2, -b.vy * .2, b.c, .15, 1);
          } else { b.dead = true; GFX.burst(clamp(b.x, AX0, AX1), clamp(b.y, AY0, AY1), 3, b.c, 40, .18); }
        }
      } else {
        if (b.turn) { const c = Math.cos(b.turn * dt), s = Math.sin(b.turn * dt), vx = b.vx; b.vx = vx * c - b.vy * s; b.vy = vx * s + b.vy * c; }
        if (b.accel) { const k = 1 + b.accel * dt; b.vx *= k; b.vy *= k; }
        if (b.grav) b.vy += b.grav * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < -24 || b.x > W + 24 || b.y < -24 || b.y > H + 24) b.dead = true;
      }
      if (!(b.x === b.x && b.y === b.y)) b.dead = true;   // NaN guard
    },
    draw(b) {
      const x = b.x, y = b.y, r = b.r;
      if (b.team === T_PSHOT) {
        const sp = Math.hypot(b.vx, b.vy) || 1, k = Math.min(10, sp * .022) / sp;
        const tx = x - b.vx * k, ty = y - b.vy * k;
        if (r > 2.4) { GFX.disc(x, y, r + 1, PDARK); GFX.disc(x, y, r, b.c); GFX.disc(x, y, r * .5, PCORE); GFX.lineA(tx, ty, x, y, b.c); }
        else { GFX.lineA(tx, ty, x, y, b.c); GFX.lineA(tx + .5, ty + .5, x + .5, y + .5, GFX.scale(b.c, .5)); GFX.pset(x, y, PCORE); GFX.add(x - b.vx * k * .4, y - b.vy * k * .4, b.c); }
      } else if (b.kind === 'needle' || b.kind === 'beam') {
        const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp * (r * 2.5 + 2), uy = b.vy / sp * (r * 2.5 + 2);
        GFX.line(x - ux + 1, y - uy, x + ux + 1, y + uy, EDARK); GFX.line(x - ux, y - uy + 1, x + ux, y + uy + 1, EDARK);
        GFX.line(x - ux, y - uy, x + ux, y + uy, b.c); GFX.pset(x + ux * .5, y + uy * .5, b.hot);
      } else {
        GFX.disc(x, y, r + 1.6, EDARK); GFX.disc(x, y, r, b.c); GFX.disc(x, y, r * .45, b.hot);
        if (r >= 4) GFX.circ(x, y, r + 2.5 + Math.sin(S.t * 12) * .8, GFX.scale(b.c, .6));
      }
    } });

  // =====================================================================
  //  explosions, bits, fx entities
  // =====================================================================
  ENT.def('boom', { r: 1, hp: 1, team: T_FX, layer: 0,
    update(e, dt) { if (e.age > e.life) e.dead = true; },
    draw(e) { const t = e.age / e.life; GFX.glow(e.x, e.y, e.rad * (.6 + t * .6), e.c, (1 - t) * .9); if (t < .25) GFX.disc(e.x, e.y, e.rad * .35 * (1 - t * 4), C.white); } });

  function explode(x, y, r, dmg, team) {
    const pl = team === T_PSHOT || team === T_PLAYER, c = pl ? rgb(120, 220, 255) : rgb(255, 140, 50);
    const fx = ENT.spawn('boom', x, y); fx.rad = r; fx.c = c; fx.life = .3;
    GFX.ring(x, y, r * .2, r, c, .3); GFX.ring(x, y, r * .1, r * .7, C.white, .18);
    GFX.burst(x, y, 6 + (r * .4 | 0), c, r * 3, .4, { drag: 3 });
    if (r >= 24) S.shake = Math.max(S.shake, Math.min(9, r * .12));
    sfx('explode', { vol: Math.min(1, .3 + r / 80) });
    const src = { x, y, team, dmg, boom: 1 };
    if (pl) {
      const L = ENT.list, n = L.length;
      for (let i = 0; i < n; i++) { const e = L[i]; if (e.dead || e.team !== T_ENEMY || e.warp > 0) continue;
        const rr = r + e.r; if ((e.x - x) * (e.x - x) + (e.y - y) * (e.y - y) < rr * rr) ENT.damage(e, dmg, src); }
    } else {
      const p = S.player; if (p && !p.dead) { const rr = r + p.r; if ((p.x - x) ** 2 + (p.y - y) ** 2 < rr * rr) hurtPlayer(Math.max(1, Math.round(dmg)), src); }
    }
  }

  ENT.def('bit', { r: 3, hp: 1, team: T_PICK, layer: 1,
    update(e, dt) {
      const p = S.player; e.life -= dt; if (e.life <= 0) { e.dead = true; bitsLive--; return; }
      e.vx -= e.vx * 3 * dt; e.vy -= e.vy * 3 * dt;
      if (p && !p.dead) {
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, m = p.magnet || 0;
        if (d < 7) { e.dead = true; bitsLive--; collectBit(e); return; }
        if (d < Math.abs(m) || e.age > 6) { const f = (m < 0 && d < -m ? -1 : 1) * (520 + 9000 / (d + 10)); e.vx += dx / d * f * dt; e.vy += dy / d * f * dt; GAME_cap(e, 300); }
      }
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.x = clamp(e.x, AX0, AX1); e.y = clamp(e.y, AY0, AY1);
    },
    draw(e) { if (e.life < 2 && (e.life * 10 | 0) % 2) return; const c = e.v ? BITC : rgb(90, 220, 255);
      GFX.add(e.x, e.y, GFX.scale(c, .5)); GFX.text(e.v ? '1' : '0', e.x - 2, e.y - 3, c); } });
  const GAME_cap = H.cap;

  function dropBits(x, y, n) {
    n = Math.min(40, n | 0);
    for (let i = 0; i < n; i++) {
      if (bitsLive >= MAX_BITS) { S.score += 5 * S.mult * (n - i); break; }
      const a = rnd() * TAU, s = rndr(30, 110), b = ENT.spawn('bit', x, y);
      b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s; b.life = 10; b.v = rnd() < .5 ? 1 : 0; bitsLive++;
    }
  }
  function collectBit(e) {
    S.score += 5 * S.mult; GAME.bits++;
    GFX.spark(e.x, e.y, 0, -20, BITC, .2, 1);
    if (S.t - pickSfxT > .045) { pickChain = S.t - pickSfxT < .4 ? Math.min(pickChain + 1, 16) : 0; pickSfxT = S.t; sfx('pickup', { vol: .35, pitch: 1 + pickChain * .06 }); }
  }

  // =====================================================================
  //  player
  // =====================================================================
  ENT.def('player', { r: 2.5, hp: 5, team: T_PLAYER, layer: 3, update: playerUpdate, draw: playerDraw });

  function playerUpdate(p, dt) {
    if (p.dead) return;
    p.inv = Math.max(0, p.inv - dt); p.hurtT = Math.max(0, p.hurtT - dt);
    const was = p.dashCd; p.dashCd = Math.max(0, p.dashCd - dt); if (was > 0 && p.dashCd === 0) p.ping = .25;
    p.ping = Math.max(0, p.ping - dt); p.kick = Math.max(0, p.kick - dt * 30); p.muz -= dt;
    IN.aimFrom(p.x, p.y); p.ax = IN.ax; p.ay = IN.ay;
    if (!(p.ax === p.ax) || !(p.ay === p.ay)) { p.ax = 1; p.ay = 0; }
    p.rot = Math.atan2(p.ay, p.ax);
    p.dashBuf = IN.dash ? .15 : p.dashBuf - dt;
    if (p.dashBuf > 0 && p.dashCd <= 0 && p.dashT <= 0) {
      p.dashBuf = 0; p.ram = 0; p.dashId++;
      LIVE.fn['ply.dash'](p);
      GFX.burst(p.x, p.y, 10, PCOL, 70, .3, { drag: 4 }); GFX.ring(p.x, p.y, 2, 14, PCOL, .2); ghostT = 0;
    }
    if (p.dashT > 0) {
      p.dashT -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ghostT -= dt; if (ghostT <= 0) { ghostT = .018; const g = ghosts[ghostI = (ghostI + 1) % ghosts.length]; g.x = p.x; g.y = p.y; g.rot = p.rot; g.t = .22; }
      if (p.dashT <= 0) { p.vx *= .3; p.vy *= .3; }
    } else LIVE.fn['ply.move'](p, dt);
    if (!(p.x === p.x) || !(p.y === p.y)) { p.x = 240; p.y = 140; p.vx = p.vy = 0; }
    if (!(p.vx === p.vx) || !(p.vy === p.vy)) p.vx = p.vy = 0;
    if (p.x < AX0 + 2) { p.x = AX0 + 2; if (p.vx < 0) p.vx = 0; } else if (p.x > AX1 - 2) { p.x = AX1 - 2; if (p.vx > 0) p.vx = 0; }
    if (p.y < AY0 + 2) { p.y = AY0 + 2; if (p.vy < 0) p.vy = 0; } else if (p.y > AY1 - 2) { p.y = AY1 - 2; if (p.vy > 0) p.vy = 0; }
    LIVE.fn['ply.tick'](p, dt);
    if (!(p.maxhp >= 1)) p.maxhp = 1;
    if (p.hp > p.maxhp) p.hp = p.maxhp;
    p.dashMax = Math.max(.05, p.dashMax || .85);
    // weapon
    p.fireCd -= dt;
    if (IN.fire) { let k = 0; while (p.fireCd <= 0 && k++ < 4) { const cd = +LIVE.fn['wpn.fire'](p, p.ax, p.ay, dt); p.fireCd += cd > .015 ? cd : .015; } }
    else if (p.fireCd < 0) p.fireCd = 0;
  }

  function playerDraw(p) {
    if (p.dead) return;
    for (const g of ghosts) if (g.t > 0) { g.t -= S.dt; GFX.shape(SH.ship, g.x, g.y, g.rot, 6, GFX.scale(PCOL, Math.max(0, g.t / .22) * .6), true); }
    const blink = p.hurtT > 0 && (S.t * 20 | 0) % 2;
    const ox = -p.ax * p.kick, oy = -p.ay * p.kick, x = p.x + ox, y = p.y + oy;
    if (p.hp <= 1) GFX.glow(p.x, p.y, 16 + S.beat * 4, C.red, .35 + .25 * Math.sin(S.t * 10));
    if (!blink) {
      GFX.glow(x, y, 15, PCOL, p.dashT > 0 ? .6 : .32);
      GFX.disc(x, y, 4, PDARK);
      GFX.shape(SH.ship, x, y, p.rot, 6, p.dashT > 0 ? C.white : PCOL);
      GFX.shape(SH.ship, x, y, p.rot, 3.2, GFX.scale(PCOL, .55));
    }
    GFX.disc(p.x, p.y, 1.5, C.white);                 // the true hitbox
    if (p.muz > 0) { const mx = p.x + p.ax * 8, my = p.y + p.ay * 8; GFX.glow(mx, my, 7, PCORE, .9); GFX.disc(mx, my, 1.6, C.white); }
    GFX.pset(p.x + p.ax * 15, p.y + p.ay * 15, GFX.scale(PCOL, .7));
    if (p.ping > 0) GFX.circ(p.x, p.y, 4 + (1 - p.ping / .25) * 10, GFX.scale(PCOL, p.ping * 3));
    for (let i = 0; i < orbN; i++) { const ox2 = orbs[i * 3], oy2 = orbs[i * 3 + 1]; GFX.glow(ox2, oy2, 7, PCOL, .55); GFX.disc(ox2, oy2, 2.6, PCORE); GFX.circ(ox2, oy2, 3.5, PCOL); }
  }

  function hurtPlayer(dmg, src) {
    const p = S.player; if (!p || p.dead || p.inv > 0) return false;
    if (LIVE.fn['ply.hurt'](p, dmg, src) === false) return false;
    p.hurtT = p.inv;
    S.combo = S.combo / 3 | 0; setMult();
    // mercy: clear enemy bullets right around the player
    for (let i = 0; i < eshots.length; i++) { const b = eshots[i]; if (!b.dead && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < 34 * 34) { b.dead = true; GFX.spark(b.x, b.y, 0, 0, b.c, .2, 1); } }
    GFX.burst(p.x, p.y, 14, C.red, 90, .4); GFX.ring(p.x, p.y, 3, 26, C.red, .3);
    hsT = Math.max(hsT, .07);
    if (p.hp <= 0) playerDie(src);
    return true;
  }

  function playerDie(src) {
    const p = S.player; p.hp = 0; ENT.kill(p, src);
    for (let i = 0; i < 4; i++) GFX.burst(p.x, p.y, 40, [PCOL, C.white, C.magenta, C.yellow][i], 60 + i * 50, .9 + i * .2, { drag: 1.5 });
    GFX.ring(p.x, p.y, 4, 90, C.white, .6); GFX.ring(p.x, p.y, 2, 60, PCOL, .9);
    const fx = ENT.spawn('boom', p.x, p.y); fx.rad = 60; fx.c = PCOL; fx.life = .8;
    S.shake = Math.max(S.shake, 16); S.flash = Math.max(S.flash, .8); S.glitch = Math.max(S.glitch, 1);
    sfx('explode', { vol: 1 }); sfx('bigkill'); try { FX.kick(1); } catch (e) { }
    slowT = Math.max(slowT, 1); comboTimer = 0;
    BUS.emit('player:dead');
  }

  // =====================================================================
  //  enemies
  // =====================================================================
  const DEF = {
    gnat:     { r: 4, hp: 1, score: 10, bits: 1, c: rgb(200, 255, 70), sh: SH.dart, k: 1.4, face: 1 },
    drifter:  { r: 8, hp: 4, score: 30, bits: 2, c: rgb(255, 80, 230), sh: SH.hex, k: 1.1 },
    turret:   { r: 8, hp: 7, score: 50, bits: 3, c: rgb(110, 150, 255), sh: SH.sq, k: .85 },
    worm:     { r: 6, hp: 12, score: 90, bits: 6, c: rgb(90, 255, 150), sh: SH.head, k: 1.35 },
    splitter: { r: 9, hp: 5, score: 40, bits: 2, c: rgb(255, 120, 190), sh: SH.dia, k: 1.15 },
    shard:    { r: 4, hp: 1, score: 10, bits: 1, c: rgb(255, 160, 215), sh: SH.tri, k: 1.4 },
    charger:  { r: 7, hp: 5, score: 50, bits: 3, c: rgb(255, 60, 80), sh: SH.arrow, k: 1.25 },
    orbiter:  { r: 6, hp: 4, score: 40, bits: 2, c: rgb(180, 120, 255), sh: SH.oct, k: 1 },
    mine:     { r: 6, hp: 2, score: 20, bits: 1, c: rgb(255, 235, 80), sh: SH.star, k: 1.45 },
    sniper:   { r: 6, hp: 4, score: 60, bits: 3, c: rgb(140, 255, 230), sh: SH.snipe, k: 1.2 },
    weaver:   { r: 8, hp: 8, score: 70, bits: 4, c: rgb(255, 170, 255), sh: SH.pin, k: 1.25 },
    mutator:  { r: 8, hp: 9, score: 150, bits: 12, c: rgb(255, 255, 255), sh: SH.chip, k: 1 },
  };

  function enemyInit(e) {
    if (e.warp == null) e.warp = .6;
    e.warp0 = e.warp || .6; if (e.rot == null) e.rot = 0;
    e.spd = e.spd || spdMul(); e.seed = rnd() * 100; e.cd = e.cd || 0; e.st = 0; e.t = 0; e.n = 0;
  }
  const INIT = {
    turret(e) { e.n = 3; e.cd = rndr(.8, 1.8); },
    worm(e) { const p = S.player; e.dir = p ? Math.atan2(p.y - e.y, p.x - e.x) : 0; e.rot = e.dir; },
    charger(e) { e.t = rndr(.8, 1.6); },
    orbiter(e) { const p = S.player || { x: 240, y: 140 }; e.ang = Math.atan2(e.y - p.y, e.x - p.x); e.dirn = rnd() < .5 ? -1 : 1; e.cd = rndr(.8, 1.8); },
    mine(e) { e.fuse = 0; },
    sniper(e) { e.t = rndr(.6, 1.2); e.tx = e.x; e.ty = e.y; },
    weaver(e) { e.rot = rnd() * TAU; },
    drifter(e) { if (!e.vx && !e.vy) { const a = rnd() * TAU; e.vx = Math.cos(a) * 40; e.vy = Math.sin(a) * 40; } },
    mutator(e) { e.infected = false; e.bug = null; e.label = ''; },
  };

  function enemyUpdate(e, dt) {
    if (e.warp > 0) { e.warp -= dt; if (e.warp <= 0) { e.warp = 0; GFX.ring(e.x, e.y, 2, e.r * 2.5, e.T.c, .2); } return; }
    const p = S.player || { x: 240, y: 140, dead: true };
    LIVE.fn['ai.step'](e, p, dt);
    if (!(e.x === e.x && e.y === e.y)) { e.x = 240; e.y = 140; }
    if (!(e.vx === e.vx && e.vy === e.vy)) { e.vx = e.vy = 0; }
    const r = e.r;
    if (e.x < AX0 + r) { e.x = AX0 + r; if (e.vx < 0) e.vx *= -.5; } else if (e.x > AX1 - r) { e.x = AX1 - r; if (e.vx > 0) e.vx *= -.5; }
    if (e.y < AY0 + r) { e.y = AY0 + r; if (e.vy < 0) e.vy *= -.5; } else if (e.y > AY1 - r) { e.y = AY1 - r; if (e.vy > 0) e.vy *= -.5; }
    if (e.T.face && (e.vx || e.vy)) e.rot = Math.atan2(e.vy, e.vx);
    if (e.type === 'mine') e.rot += dt * (e.fuse ? 9 : 1.2);
    if (e.segs) wormFollow(e);
  }

  function wormFollow(e) {
    let lx = e.x, ly = e.y; const GAP = 6.5;
    for (const s of e.segs) {
      if (s.dead) continue;
      const dx = s.x - lx, dy = s.y - ly, d = Math.hypot(dx, dy) || 1;
      if (d > GAP) { s.x = lx + dx / d * GAP; s.y = ly + dy / d * GAP; }
      s.rot = Math.atan2(-dy, -dx); s.warp = e.warp; s.flash = e.flash; lx = s.x; ly = s.y;
    }
  }

  function enemyDraw(e) {
    const T = e.T, y = e.y;
    let c = T.c, x = e.x;
    if (e.st === 1 && e.type === 'charger') x += (Math.random() - .5) * 2;
    if (e.type === 'mutator') c = GFX.hsv((S.t * .6) % 1, .55, 1);
    if (e.warp > 0) { warpDraw(e, c); return; }
    const fc = e.flash > 0 ? C.white : c;
    GFX.glow(x, y, e.r * 2.6, c, .28 + S.beat * .1);
    GFX.disc(x, y, e.r * .75, DARK);
    const X = EXTRA[e.type]; if (X && X.pre) X.pre(e, fc, c);
    GFX.shape(T.sh, x, y, e.rot, e.r * T.k, fc);
    if (X && X.post) X.post(e, fc, c);
    if (e.maxhp >= 6 && e.hp < e.maxhp) { const w = e.r * 2, f = clamp(e.hp / e.maxhp, 0, 1); GFX.rect(x - w / 2, y + e.r + 4, w, 1, DARK); GFX.rect(x - w / 2, y + e.r + 4, w * f, 1, c); }
  }
  function warpDraw(e, c) {
    const t = clamp(e.warp / e.warp0, 0, 1), r = e.r + t * 22, x = e.x, y = e.y;
    GFX.circ(x, y, r, GFX.scale(c, .35 + .65 * (1 - t)));
    GFX.circ(x, y, r * .55, GFX.scale(c, .25 * (1 - t)));
    const a = t * 4; for (let i = 0; i < 4; i++) { const q = a + i * PI / 2; GFX.line(x + Math.cos(q) * r, y + Math.sin(q) * r, x + Math.cos(q) * (r - 5), y + Math.sin(q) * (r - 5), c); }
    if ((S.frame & 1) || t < .3) GFX.shape(e.T.sh, x + (rnd() - .5) * t * 4, y, e.rot, e.r * e.T.k * (1 - t * .6), GFX.scale(c, .5), true);
    if (e.type === 'mutator' && (S.frame & 4)) GFX.textC('INJECTING', x, y - e.r - 18, C.red);
  }

  const EXTRA = {
    turret: { post(e, c) { const cx = Math.cos(e.rot), cy = Math.sin(e.rot);
      GFX.shape(SH.sq2, e.x, e.y, S.t * 2, e.r * .55, GFX.scale(c, .7));
      GFX.line(e.x + cx * 3, e.y + cy * 3, e.x + cx * (e.r + 4), e.y + cy * (e.r + 4), c);
      if (e.n > 0 && e.cd < .45) GFX.glow(e.x + cx * (e.r + 3), e.y + cy * (e.r + 3), 6 + (1 - e.cd / .45) * 5, ECOL, .9); } },
    worm: { post(e, c) { GFX.pset(e.x + Math.cos(e.rot + .6) * 4, e.y + Math.sin(e.rot + .6) * 4, C.white); GFX.pset(e.x + Math.cos(e.rot - .6) * 4, e.y + Math.sin(e.rot - .6) * 4, C.white); } },
    charger: { pre(e, c) {
      if (e.st === 1) { const cx = Math.cos(e.rot), cy = Math.sin(e.rot), lock = e.t <= .2, lc = lock ? C.white : C.red;
        if (lock || (S.t * 16 | 0) % 2) for (let d = 10; d < 150; d += 8) GFX.line(e.x + cx * d, e.y + cy * d, e.x + cx * (d + 4), e.y + cy * (d + 4), lc);
        GFX.glow(e.x, e.y, 14, C.red, .5); }
      if (e.st === 2) GFX.glow(e.x, e.y, 16, C.white, .4); } },
    orbiter: { post(e, c) { for (let i = 0; i < 3; i++) { const a = e.rot + i * TAU / 3; GFX.disc(e.x + Math.cos(a) * (e.r + 4), e.y + Math.sin(a) * (e.r + 4), 1.3, c); } GFX.disc(e.x, e.y, 1.8, c); } },
    mine: { pre(e, c) {
      if (e.fuse > 0) { const on = (S.t * (6 + (1 - e.fuse) * 22) | 0) % 2; GFX.circ(e.x, e.y, e.blast || 36, on ? rgb(255, 80, 40) : rgb(90, 30, 10)); if (on) GFX.glow(e.x, e.y, 20, C.red, .8); }
      else if ((S.t * 2 + e.seed | 0) % 2) GFX.disc(e.x, e.y, 2, C.red); } },
    sniper: { pre(e, c) {
      const cx = Math.cos(e.rot), cy = Math.sin(e.rot);
      if (e.st === 1) { const lock = e.t <= .35, col = lock ? ((S.t * 30 | 0) % 2 ? C.white : C.red) : rgb(200, 40, 50);
        GFX.line(e.x + cx * 8, e.y + cy * 8, e.x + cx * 600, e.y + cy * 600, col); }
      else if (e.st === 2) { const nx = -cy, ny = cx;
        for (let k = -2; k <= 2; k++) GFX.line(e.x + nx * k, e.y + ny * k, e.x + cx * 600 + nx * k, e.y + cy * 600 + ny * k, Math.abs(k) < 2 ? C.white : C.red);
        GFX.glow(e.x + cx * 10, e.y + cy * 10, 14, C.white, .9); } },
      post(e, c) { GFX.circ(e.x, e.y, 3, c); } },
    weaver: { post(e, c) { GFX.circ(e.x, e.y, e.r * .45, c); if (e.age % 4.5 > 3) GFX.circ(e.x, e.y, e.r + 2, GFX.scale(c, .4)); } },
    mutator: { post(e, c) {
      GFX.textC(e.bug ? '\x7f' : '?', e.x, e.y - 3, c);
      if (e.label) { const s = e.label, w = s.length * 6 + 4, lx = clamp(e.x - w / 2, 2, W - w - 2), ly = clamp(e.y - e.r - 16, 2, H - 12);
        GFX.rectA(lx, ly, w, 11, C.black, .75); GFX.frame(lx, ly, w, 11, e.bug ? C.red : C.dim);
        if (!e.bug || (S.t * 4 | 0) % 4) GFX.text(s, lx + 2, ly + 2, e.bug ? rgb(255, 90, 90) : C.dim); } } },
    drifter: { post(e, c) { GFX.shape(SH.hex, e.x, e.y, -e.rot * 1.5, e.r * .5, GFX.scale(c, .6)); } },
    splitter: { post(e, c) { GFX.shape(SH.dia, e.x, e.y, e.rot + PI / 2, e.r * .55, GFX.scale(c, .7)); } },
  };

  function enemyDie(e, src) {
    const T = e.T, c = e.type === 'mutator' ? C.white : T.c, credited = src !== e && !e.noscore;
    GFX.burst(e.x, e.y, 8 + e.r * 2 | 0, c, 50 + e.r * 8, .5, { drag: 2 });
    GFX.burst(e.x, e.y, 4, C.white, 40, .25);
    GFX.ring(e.x, e.y, 2, e.r * 2.6, c, .28);
    const fx = ENT.spawn('boom', e.x, e.y); fx.rad = e.r * 2.2; fx.c = c; fx.life = .22;
    if (T.onDie) T.onDie(e, src, credited);
    if (!credited) return;
    S.kills++; S.combo++; comboTimer = 2.6 - S.mult * .08;
    const old = S.mult; setMult();
    const pts = T.score * S.mult; S.score += pts;
    if (T.score >= 30) pop('' + pts, e.x, e.y - e.r - 2, S.mult > 1 ? C.yellow : C.white, .7);
    if (S.mult > old) { const p = S.player; pop('x' + S.mult, p ? p.x : e.x, (p ? p.y : e.y) - 18, C.magenta, 1); sfx('combo', { pitch: 1 + S.mult * .05 }); }
    if (S.player) LIVE.fn['ply.kill'](S.player, e);
    if (T.score >= 50) { sfx('bigkill'); hsT = Math.max(hsT, .035); S.shake = Math.max(S.shake, 3); } else { sfx('kill', { vol: .6 }); S.shake = Math.max(S.shake, 1.2); }
  }
  function setMult() { let m = 1; while (m < 10 && S.combo >= COMBO_TH[m + 1]) m++; S.mult = m; }

  const ONDIE = {
    splitter(e) { const n = 2 + (rnd() < .5 ? 1 : 0), a0 = rnd() * TAU;
      for (let i = 0; i < n; i++) { const a = a0 + i * TAU / n; spawnEnemy('shard', e.x + Math.cos(a) * 4, e.y + Math.sin(a) * 4, { warp: 0, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 }); } },
    mine(e, src) { if (src !== e) explode(e.x, e.y, 38, 4, T_PSHOT); },
    worm(e) { for (const s of e.segs || []) if (!s.dead) { s.noscore = true; ENT.kill(s, s); } },
    mutator(e) {
      if (e.bug) {
        const ok = PATCH.cure(e.bug.id);
        GFX.ring(e.x, e.y, 4, 110, C.white, .7); GFX.ring(e.x, e.y, 2, 70, C.green, .5); GFX.ring(e.x, e.y, 1, 40, C.cyan, .35);
        GFX.burst(e.x, e.y, 60, C.green, 160, .9, { drag: 1.5 });
        pop('PATCH REVERTED', e.x, e.y - 22, C.green, 1.6); pop(e.bug.name, e.x, e.y - 12, C.dim, 1.4);
        sfx('cure'); S.flash = Math.max(S.flash, .45); S.shake = Math.max(S.shake, 8); hsT = Math.max(hsT, .12); S.glitch = Math.max(S.glitch, .5);
        try { FX.kick(.8); } catch (er) { }
        if (ok) e.bug = null;
      }
    },
  };

  for (const k of ENEMY_TYPES) {
    const d = DEF[k];
    ENT.def(k, { r: d.r, hp: d.hp, team: T_ENEMY, layer: 2, score: d.score, bits: d.bits, c: d.c, sh: d.sh, k: d.k, face: d.face, enemy: true,
      init(e) { enemyInit(e); if (INIT[k]) INIT[k](e); }, update: enemyUpdate, draw: enemyDraw, die: enemyDie, onDie: ONDIE[k] });
  }
  // worm body segment: hits are forwarded to the head
  ENT.def('wseg', { r: 5, hp: 1, team: T_ENEMY, layer: 2, score: 0, bits: 0, seg: true,
    update(e) { if (!e.head || e.head.dead) { e.noscore = true; ENT.kill(e, e); } },
    hurt(e, d, src) { if (e.head && !e.head.dead && !(e.warp > 0)) ENT.damage(e.head, d * .6, src); return false; },
    draw(e) { if (e.warp > 0) { if (S.frame & 1) GFX.circ(e.x, e.y, e.r * .6, GFX.scale(DEF.worm.c, .4)); return; }
      const c = DEF.worm.c, fc = e.flash > 0 ? C.white : c, k = e.idx / 8;
      GFX.glow(e.x, e.y, 9, c, .18); GFX.disc(e.x, e.y, e.r * .8, DARK); GFX.circ(e.x, e.y, e.r * (1 - k * .35), fc); GFX.pset(e.x, e.y, GFX.scale(c, .8)); },
    die(e) { GFX.burst(e.x, e.y, 6, DEF.worm.c, 60, .4); } });

  function spawnEnemy(type, x, y, o) {
    const T = ENT.T[type];
    if (!T) return null;
    if (!T.enemy) return ENT.spawn(type, x, y, o);
    x = clamp(x === x ? x : 240, AX0 + T.r, AX1 - T.r); y = clamp(y === y ? y : 140, AY0 + T.r, AY1 - T.r);
    const p = S.player;
    if (p && !p.dead) { const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy); if (d < 44) { const a = d > .1 ? Math.atan2(dy, dx) : rnd() * TAU; x = clamp(p.x + Math.cos(a) * 48, AX0 + T.r, AX1 - T.r); y = clamp(p.y + Math.sin(a) * 48, AY0 + T.r, AY1 - T.r); } }
    const e = ENT.spawn(type, x, y, o);
    if (!(o && o.hp)) { e.hp = Math.max(1, Math.round(T.hp * hpMul() * 10) / 10); e.maxhp = e.hp; }
    if (type === 'worm') {
      e.segs = []; const n = 7 + Math.min(4, S.diff | 0), a = e.dir + PI;
      for (let i = 0; i < n; i++) { const s = ENT.spawn('wseg', x + Math.cos(a) * (i + 1) * 6.5, y + Math.sin(a) * (i + 1) * 6.5); s.head = e; s.idx = i; s.warp = e.warp; s.r = 5 - i * .15; e.segs.push(s); }
      const L = ENT.list; L.splice(L.indexOf(e), 1); L.push(e);      // head draws on top of its body
    }
    if (e.warp > 0 && S.t - spawnSfxT > .08) { spawnSfxT = S.t; sfx('spawn', { vol: .4 }); }
    return e;
  }

  // =====================================================================
  //  collisions (bucket grid)
  // =====================================================================
  function gridInsert(e) {
    const m = e.r + 8;
    const x0 = clamp(Math.floor((e.x - m) / CS), 0, GW - 1), x1 = clamp(Math.floor((e.x + m) / CS), 0, GW - 1);
    const y0 = clamp(Math.floor((e.y - m) / CS), 0, GH - 1), y1 = clamp(Math.floor((e.y + m) / CS), 0, GH - 1);
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) grid[gy * GW + gx].push(e);
  }
  const cellOf = (x, y) => clamp(Math.floor(y / CS), 0, GH - 1) * GW + clamp(Math.floor(x / CS), 0, GW - 1);

  function shotHits(b, x, y) {
    const cell = grid[cellOf(x, y)];
    for (let i = 0; i < cell.length; i++) {
      const e = cell[i]; if (e.dead || e === b.last) continue;
      const rr = e.r + b.r, dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy < rr * rr) { hitEnemy(b, e); if (b.dead) return true; }
    }
    return false;
  }

  function hitEnemy(b, e) {
    let dmg = +LIVE.fn['wpn.hit'](b, e);
    if (!(dmg >= 0)) dmg = b.dmg;
    if (!e.dead) {
      ENT.damage(e, dmg, b);
      if (!e.boss && !e.T.seg) { const k = 8 / (e.r + 2); e.vx += b.vx * k * .02; e.vy += b.vy * k * .02; }
    }
    GFX.spark(b.x, b.y, -b.vx * .15 + (rnd() - .5) * 40, -b.vy * .15 + (rnd() - .5) * 40, C.white, .12, 1);
    GFX.spark(b.x, b.y, -b.vx * .1 + (rnd() - .5) * 60, -b.vy * .1 + (rnd() - .5) * 60, b.c, .2, 1);
    if (S.t - hitSfxT > .05) { hitSfxT = S.t; sfx('hit', { vol: .4 }); }
    b.last = e;
    if (b.pierce > 0) b.pierce--; else { b.dead = true; GFX.burst(b.x, b.y, 3, b.c, 50, .15); }
  }

  function collide(dt) {
    enemies.length = 0; pshots.length = 0; eshots.length = 0;
    for (let i = 0; i < grid.length; i++) grid[i].length = 0;
    const L = ENT.list;
    for (let i = 0; i < L.length; i++) { const e = L[i]; if (e.dead) continue;
      if (e.team === T_ENEMY) { enemies.push(e); if (!(e.warp > 0)) gridInsert(e); }
      else if (e.team === T_PSHOT) pshots.push(e); else if (e.team === T_ESHOT) eshots.push(e); }
    nP = pshots.length; nE = eshots.length;

    // soft separation so swarms don't stack into one blob
    for (let c = 0; c < grid.length; c++) { const cell = grid[c], n = Math.min(cell.length, 24);
      for (let i = 0; i < n; i++) { const a = cell[i]; if (a.boss || a.T.seg) continue;
        for (let j = i + 1; j < n; j++) { const b = cell[j]; if (b.boss || b.T.seg) continue;
          const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * .9, d2 = dx * dx + dy * dy;
          if (d2 < rr * rr && d2 > .01) { const d = Math.sqrt(d2), push = (rr - d) * .25 / d; a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push; } } } }

    // player shots -> enemies
    for (let i = 0; i < pshots.length; i++) { const b = pshots[i]; if (b.dead) continue;
      if (shotHits(b, b.x, b.y)) continue;
      const mx = b.vx * dt * .5, my = b.vy * dt * .5; if (mx * mx + my * my > 9) shotHits(b, b.x - mx, b.y - my); }

    // orbitals -> enemies + enemy bullets
    for (let k = 0; k < orbN; k++) { const ox = orbs[k * 3], oy = orbs[k * 3 + 1], od = orbs[k * 3 + 2], cell = grid[cellOf(ox, oy)];
      for (let i = 0; i < cell.length; i++) { const e = cell[i]; if (e.dead || (e._orbT || 0) > S.t) continue; const rr = e.r + 4;
        if ((e.x - ox) ** 2 + (e.y - oy) ** 2 < rr * rr) { e._orbT = S.t + .18; ENT.damage(e, od, { x: ox, y: oy, team: T_PSHOT }); GFX.spark(ox, oy, 0, 0, C.white, .15, 2); } }
      for (let i = 0; i < eshots.length; i++) { const b = eshots[i]; if (!b.dead && (b.x - ox) ** 2 + (b.y - oy) ** 2 < (b.r + 4) ** 2) { b.dead = true; GFX.burst(b.x, b.y, 4, b.c, 40, .2); } } }

    const p = S.player; if (!p || p.dead) return;
    // enemy shots -> player
    if (p.inv <= 0) for (let i = 0; i < eshots.length; i++) { const b = eshots[i]; if (b.dead) continue; const rr = b.r + p.r;
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < rr * rr) { b.dead = true; hurtPlayer(b.dmg > 0 ? Math.ceil(b.dmg) : 1, b); if (p.dead) return; break; } }
    // enemy bodies -> player (or dash-strike)
    for (let i = 0; i < enemies.length; i++) { const e = enemies[i]; if (e.dead || e.warp > 0 || e.harmless) continue;
      const rr = e.r * .85 + p.r; if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 >= rr * rr) continue;
      if (p.ram > 0 && p.dashT > 0) { if (e._ram !== p.dashId) { e._ram = p.dashId; ENT.damage(e, p.ram, p); GFX.burst(e.x, e.y, 10, C.white, 90, .3); S.shake = Math.max(S.shake, 3); } }
      else if (p.inv <= 0 && e.contact !== 0) { hurtPlayer(e.contact || 1, e); if (p.dead) return; }
    }
  }

  // =====================================================================
  //  GAMEPLAY PATCH CATALOG
  // =====================================================================
  const r3 = v => String(+(+v).toFixed(3)).replace(/^0\./, '.').replace(/^-0\./, '-.');
  // stackable numeric edit of a named constant: NAME=val -> NAME=f(val)
  const tune = (fn, name, f) => LIVE.patch(fn, new RegExp('\\b' + name + '=(-?[\\d.]+)'), (m, a) => name + '=' + r3(f(+a)));
  // field edit inside an object literal: key: val -> key: f(val)
  const field = (fn, key, f) => LIVE.patch(fn, new RegExp('\\b' + key + ': (-?[\\d.]+)'), (m, a) => key + ': ' + r3(f(+a)));
  // insert a whole new statement at a hook marker (marker is kept so hooks stack)
  const hook = (fn, tag, line) => LIVE.patch(fn, '/*HOOK:' + tag + '*/', line + '\n/*HOOK:' + tag + '*/');
  const up = (id, name, desc, o) => PATCH.def(Object.assign({ id, name, desc, kind: 'up' }, o));
  const bug = (id, name, desc, o) => PATCH.def(Object.assign({ id, name, desc, kind: 'bug' }, o));

  // --- weapon ---
  up('rate', 'OVERCLOCK', 'RATE*=1.25 : +25% fire rate', { max: 4, weight: 1.3, apply: () => tune('wpn.fire', 'RATE', v => v * 1.25) });
  up('fork', 'FORK()', 'N=1 -> N+2 : two extra barrels', { max: 2, apply: () => tune('wpn.fire', 'N', v => v + 2) });
  up('scatter', 'SCATTER', 'N+=1, SPREAD*=1.5 : shotgun cone', { max: 2, apply: () => LIVE.patch('wpn.fire', /\bN=(\d+), SPREAD=([\d.]+)/, (m, a, b) => 'N=' + (+a + 1) + ', SPREAD=' + r3(b * 1.5)) });
  up('dmg', 'INT64', 'DMG+=1 : heavier slugs', { max: 4, weight: 1.3, apply: () => tune('wpn.fire', 'DMG', v => v + 1) });
  up('velocity', 'HIGH_VELOCITY', 'SPEED*=1.3 : faster rounds', { max: 2, apply: () => tune('wpn.fire', 'SPEED', v => Math.round(v * 1.3)) });
  up('fat', 'FAT_POINTERS', 'SIZE+=1.3 : bigger hitboxes', { max: 2, apply: () => tune('wpn.fire', 'SIZE', v => v + 1.3) });
  up('pierce', 'NOCLIP', 'pierce: 0 -> +1 : rounds pass through', { max: 3, apply: () => field('wpn.fire', 'pierce', v => v + 1) });
  up('bounce', 'RICOCHET', 'bounce: 0 -> +1 : rounds bounce off walls', { max: 3, apply: () => field('wpn.fire', 'bounce', v => v + 1) });
  up('homing', 'SEEK()', 'homing: 0 -> +3 : rounds steer to targets', { max: 2, apply: () => field('wpn.fire', 'homing', v => v + 3) });
  up('rear', 'REAR_GUN', '+ GAME.shoot(.., -ax*SPEED, -ay*SPEED) : tail gun', { weight: .6, apply: () => hook('wpn.fire', 'fire', 'GAME.shoot(p.x, p.y, -ax * SPEED, -ay * SPEED, o);') });
  up('side', 'SIDE_CHANNEL', '+ 2x GAME.shoot(perpendicular) : side cannons', { weight: .5, apply: () => hook('wpn.fire', 'fire', 'GAME.shoot(p.x, p.y, -ay * SPEED * .8, ax * SPEED * .8, o);\nGAME.shoot(p.x, p.y, ay * SPEED * .8, -ax * SPEED * .8, o);') });
  // --- on-hit ---
  up('crit', 'BRANCH_PREDICT', 'CRIT+=.15 : chance of x3 damage', { max: 3, apply: () => tune('wpn.hit', 'CRIT', v => v + .15) });
  up('chain', 'ARC_LIGHTNING', 'CHAIN+=2 : hits arc to nearby enemies', { max: 2, weight: .8, apply: () => tune('wpn.hit', 'CHAIN', v => v + 2) });
  up('blast', 'HE_ROUNDS', 'BLAST+=14 : rounds explode on impact', { max: 2, weight: .8, apply: () => tune('wpn.hit', 'BLAST', v => v + 14) });
  up('split', 'RECURSION', '+ if (!b.gen) GAME.split(b, 2, .7) : hits fork', { weight: .5, apply: () => hook('wpn.hit', 'onhit', 'if (!b.gen) GAME.split(b, 2, .7);') });
  up('execute', 'KILL -9', '+ if (hp-dmg < 20% maxhp) dmg = hp : execute', { weight: .5, apply: () => hook('wpn.hit', 'onhit', 'if (!e.boss && e.hp - dmg < e.maxhp * .2) dmg = e.hp;') });
  // --- player ---
  up('turbo', 'TURBO_CLOCK', 'SPEED*=1.12 : move faster', { max: 2, apply: () => tune('ply.move', 'SPEED', v => Math.round(v * 1.12)) });
  up('dashcd', 'FAST_DASH', 'COOLDOWN*=.7 : dash more often', { max: 2, apply: () => tune('ply.dash', 'COOLDOWN', v => v * .7) });
  up('nova', 'DASH_NOVA', '+ for 16: GAME.shoot(ring) : dash emits a nova', { weight: .6, apply: () => hook('ply.dash', 'dash', 'for (let i = 0; i < 16; i++) GAME.shoot(p.x, p.y, Math.cos(i * TAU / 16) * 260, Math.sin(i * TAU / 16) * 260, { team: T_PSHOT, dmg: 3, pierce: 2 });') });
  up('ram', 'DASH_STRIKE', '+ p.ram = 6 : dash through enemies for 6 dmg', { weight: .6, apply: () => hook('ply.dash', 'dash', 'p.ram = 6;') });
  up('hp', 'MALLOC(HP)', 'MAXHP+=1 : +1 max hp, heal 1', { max: 3, weight: 1.2,
    apply() { const ok = tune('ply.tick', 'MAXHP', v => v + 1); const p = S.player; if (ok && p && !p.dead) { p.maxhp++; p.hp = Math.min(p.maxhp, p.hp + 1); } return ok; } });
  up('regen', 'GARBAGE_COLLECT', 'REGEN+=.025 : regenerate hp over time', { max: 2, apply: () => tune('ply.tick', 'REGEN', v => v + .025) });
  up('orbit', 'ORBITALS', 'ORBITALS+=2 : satellites shred contacts', { max: 3, apply: () => tune('ply.tick', 'ORBITALS', v => v + 2) });
  up('magnet', 'WIDE_BUS', 'MAGNET*=1.8 : pull bits from afar', { max: 2, weight: .8, apply: () => tune('ply.tick', 'MAGNET', v => Math.round(v * 1.8)) });
  up('ecc', 'ECC_MEMORY', 'BLOCK+=.2 : chance to ignore a hit', { max: 2, apply: () => tune('ply.hurt', 'BLOCK', v => v + .2) });
  up('thorns', 'THORNS.EXE', '+ GAME.explode(p, 70, 10) : getting hit detonates', { weight: .6, apply: () => hook('ply.hurt', 'hurt', 'GAME.explode(p.x, p.y, 70, 10, T_PSHOT);') });
  up('bullettime', 'BULLET_TIME', '+ GAME.slow(1.5) : time slows when hit', { weight: .6, apply: () => hook('ply.hurt', 'hurt', 'GAME.slow(1.5);') });
  up('leech', 'LIFESTEAL', 'LEECH+=.03 : kills may heal', { max: 2, apply: () => tune('ply.kill', 'LEECH', v => v + .03) });
  up('bits', 'BIT_DOUBLER', 'BITS*=2 : double bit drops', { max: 2, weight: .8, apply: () => tune('ply.kill', 'BITS', v => v * 2) });
  up('cascade', 'CASCADE', '+ 3x GAME.shoot(homing) : kills spawn seekers', { weight: .5, apply: () => hook('ply.kill', 'kill', 'for (let i = 0; i < 3; i++) GAME.shoot(e.x, e.y, Math.cos(i * 2.1) * 200, Math.sin(i * 2.1) * 200, { team: T_PSHOT, dmg: 1, homing: 7 });') });

  // --- bugs (injected by mutators / bosses; cured on kill) ---
  bug('b_invert', '0xDEAD: INVERT_AXIS', 'mx = IN.mvx -> mx = -IN.mvx', { apply: () => LIVE.patch('ply.move', 'let mx = IN.mvx, my = IN.mvy;', 'let mx = -IN.mvx, my = -IN.mvy;') });
  bug('b_rotate', '0xC0DE: AXIS_ROT37', '+ [mx, my] = rotate(37deg)', { apply: () => hook('ply.move', 'move', '[mx, my] = [mx * .8 - my * .6, mx * .6 + my * .8];') });
  bug('b_ice', '0x01CE: FRICTION_UNDERFLOW', 'ACCEL=16 -> ACCEL=2.2', { apply: () => LIVE.patch('ply.move', /\bACCEL=[\d.]+/, 'ACCEL=2.2') });
  bug('b_drift', '0xD21F: STICKY_VECTOR', '+ mx += sin(t)*.45', { apply: () => hook('ply.move', 'move', 'mx += Math.sin(S.t * 1.3) * .45; my += Math.cos(S.t * .9) * .45;') });
  bug('b_jitter', '0x0BAD: AIM_JITTER', 'atan2(ay, ax) -> + (rnd()-.5)*.8', { apply: () => LIVE.patch('wpn.fire', 'Math.atan2(ay, ax)', 'Math.atan2(ay, ax) + (rnd() - .5) * .8') });
  bug('b_lag', '0x7E57: TRIGGER_LAG', 'return 1/RATE -> + rnd()*.35', { apply: () => LIVE.patch('wpn.fire', 'return 1 / RATE;', 'return 1 / RATE + rnd() * .35;') });
  bug('b_slowshot', '0x5L0W: BUS_CONTENTION', '+ b.v *= 1 - 1.5*dt : rounds stall', { apply: () => hook('wpn.bullet', 'bullet', 'b.vx -= b.vx * 1.5 * dt; b.vy -= b.vy * 1.5 * dt;') });
  bug('b_haste', '0xFA57: CLOCK_SKEW', 'TIME=1 -> TIME=1.45 : enemies overclocked', { apply: () => LIVE.patch('ai.step', /\bTIME=[\d.]+/, 'TIME=1.45') });
  bug('b_misfire', '0xD45H: DASH_MISFIRE', '+ if (rnd()<.5) dash sideways', { apply: () => hook('ply.dash', 'aim', 'if (rnd() < .5) [dx, dy] = [-dy, dx];') });
  bug('b_magnet', '0x0FF: MAGNET_POLARITY', 'p.magnet = MAGNET -> -MAGNET', { apply: () => LIVE.patch('ply.tick', 'p.magnet = MAGNET;', 'p.magnet = -MAGNET;') });

  // =====================================================================
  //  public API
  // =====================================================================
  function reset() {
    ENT.clear(); try { GFX.pClear(); } catch (e) { }
    hsT = slowT = comboTimer = 0; bitsLive = 0; orbN = 0; nP = nE = 0; S.comboT = 0; GAME.bits = 0;
    for (const g of ghosts) g.t = 0;
    const p = ENT.spawn('player', 240, 150, { hp: 5, maxhp: 5, inv: 1, hurtT: 0, dashCd: 0, dashMax: .85, dashT: 0, dashBuf: 0, dashId: 0, ram: 0,
      fireCd: 0, ax: 1, ay: 0, rot: 0, kick: 0, muz: 0, ping: 0, magnet: 40, regen: 0 });
    S.player = p;
    return p;
  }

  function update(dt) {
    const real = dt;
    if (hsT > 0) { hsT -= real; dt *= .1; } else if (slowT > 0) { slowT -= real; dt *= .45; }
    orbN = 0;
    const p = S.player;
    if (p && !p.dead && ENT.list.indexOf(p) < 0) ENT.list.push(p);     // someone ENT.clear()ed us
    ENT.update(dt);
    collide(dt);
    GFX.pUpdate(dt);
    if (comboTimer > 0) { comboTimer -= real; if (comboTimer <= 0) { comboTimer = 0; S.combo = 0; S.mult = 1; } }
    S.comboT = comboTimer > 0 ? clamp(comboTimer / (2.6 - S.mult * .08), 0, 1) : 0;
    const gt = Math.min(.5, .12 * PATCH.bugs().length);
    S.glitch += (gt - S.glitch) * Math.min(1, real * (S.glitch > gt ? 2.5 : .8));
    if (S.glitch < .002) S.glitch = 0;
  }

  function draw() { ENT.draw(); GFX.pDraw(); }

  const GAME = {
    reset, update, draw, shoot, spawnEnemy, explode, dropBits, hurtPlayer, enemyTypes: ENEMY_TYPES, bits: 0, SH,
    get player() { return S.player; },
    get counts() { return { enemies: enemies.length, pshots: nP, eshots: nE, bits: bitsLive, ents: ENT.list.length }; },
  };
  for (const k in H) GAME[k] = H[k];
  return GAME;
})();
