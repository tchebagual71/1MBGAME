// SELF.MOD QA player bot — injected into dist/dev.html. An *honest* bot: it only uses what a player can see on screen
// (positions/velocities of things, telegraph lines, its own hp/dash meter), perceives the world with a reaction delay,
// positional noise and a limited attention span, moves with keyboard-like (8-dir) or stick-like input, and aims with error.
// It steps the game loop itself (fixed dt, same frame order as 99-main.js, POST skipped unless a screenshot is wanted).
(() => {
  const SM = window.__SM, { S, LIVE, PATCH, ENT, SCENE, IN, RUN, BUS, GAME, DIR, AU, UI } = SM;
  window.requestAnimationFrame = () => 0;                      // stop the real loop: we drive it
  const T_ENEMY = 1, T_ESHOT = 3, DT = 1 / 60, X0 = 8, X1 = 472, Y0 = 20, Y1 = 262;

  const SKILL = {
    novice:  { delay: .32, noise: 3.5, velErr: .25, miss: .35, hor: [.1, .2, .32, .45], replan: 15, dirs: 8, aimErr: .16, lead: 0, dashP: .45, att: 18, range: 60, margin: .5, weak: 0, adapt: .25, temp: 1.6, wall: 1, lapse: .4, lapseT: [.35, .7] },
    average: { delay: .25, noise: 2.5, velErr: .16, miss: .2, hor: [.08, .17, .28, .4], replan: 11, dirs: 8, aimErr: .08, lead: .5, dashP: .8, att: 30, range: 80, margin: 1.5, weak: .5, adapt: .6, temp: .9, wall: 1.5, lapse: .22, lapseT: [.25, .5] },
    expert:  { delay: .2, noise: 1.6, velErr: .1, miss: .1, hor: [.06, .13, .22, .34, .5], replan: 7, dirs: 16, aimErr: .035, lead: 1, dashP: 1, att: 55, range: 95, margin: 2.5, weak: 1, adapt: 1.2, temp: .45, wall: 2, lapse: .08, lapseT: [.2, .35] },
  };
  // how good a human *thinks* each patch is (expert = sharper preference); unlisted = 1
  const VALUE = { dmg: 3, rate: 2.8, fork: 2.6, hp: 2.4, pierce: 2, crit: 1.8, chain: 1.8, homing: 1.7, scatter: 1.7, orbit: 1.6, blast: 1.6, regen: 1.6, leech: 1.4,
    ecc: 1.4, dashcd: 1.3, turbo: 1.2, split: 1.3, nova: 1.2, ram: 1.1, velocity: 1.1, bounce: 1.2, fat: 1.2, cascade: 1.1, execute: 1.1, rear: 1, side: 1.1,
    thorns: .9, bullettime: .9, magnet: .5, bits: 1.2 };

  const Q = window.QA = { cfg: null, log: null, ring: [], f: 0, plan: { mx: 0, my: 0 }, rot: { c: 1, s: 0 }, est: { x: 1, y: 0 }, lastOffer: [] };

  // ---- instrumentation (invisible to the game) ----
  let owner = null;
  const wrapFn = (name, mk) => { let cur = LIVE.fn[name]; const w = mk(() => cur);
    Object.defineProperty(LIVE.fn, name, { configurable: true, enumerable: true, get: () => w, set: f => { cur = f; } }); };
  wrapFn('ai.step', g => function (e, p, dt) { const o = owner; owner = e.type; try { return g()(e, p, dt); } finally { owner = o; } });
  for (const k of ['boot', 'malloc', 'stack', 'irq', 'gc', 'twin', 'kernel'])
    wrapFn('boss.' + k, g => function (e, p, dt, kk) { const o = owner; owner = 'boss.' + k + ':' + e.ph; try { return g()(e, p, dt, kk); } finally { owner = o; } });
  wrapFn('ply.hurt', g => function (p, dmg, src) { const r = g()(p, dmg, src); if (r !== false && Q.log) onHurt(dmg, src); return r; });
  const sp0 = ENT.spawn; ENT.spawn = function (t, x, y, o) { const e = sp0.call(ENT, t, x, y, o); if (e && t === 'shot') e.__own = owner || (S.boss ? 'hz:' + (DIR.state.bossKey + ':' + S.boss.ph) : 'hazard'); return e; };
  const of0 = PATCH.offer; PATCH.offer = function (n, kind) { const r = of0.call(PATCH, n, kind); if ((kind || 'up') === 'up' && n === 3) Q.lastOffer = r; return r; };
  BUS.on('hurt', (e, d) => { if (!Q.log || e.team !== T_ENEMY) return; const eff = Math.max(0, d + Math.min(0, e.hp)); const sg = Q.seg; if (sg) sg.dmg += eff; Q.log.dmg += eff; });
  BUS.on('kill', e => { if (Q.log && e.team === T_ENEMY && Q.seg && e.T && e.T.enemy) Q.seg.kills++; });

  function segKey() { const st = DIR.state; if (st.phase === 'wave') return st.sector + '.' + st.wave; if (st.phase === 'boss' || (st.phase === 'outro')) return st.sector + '.B'; return null; }
  function srcName(src) {
    if (!src) return owner || 'unknown';
    if (src.__own) return src.__own.startsWith('hz:') ? (src.vx === 0 && src.vy === 0 ? 'hzline' : 'hzburst') + src.__own.slice(2) : src.__own;
    if (src.type && src.type !== 'shot') return src.type;
    if (src.boom) return (owner || 'explosion') + '(blast)';
    return owner ? owner + '(beam)' : 'other';
  }
  function onHurt(dmg, src) {
    const nm = srcName(src), L = Q.log, sg = Q.seg; L.hits++; L.hitBy[nm] = (L.hitBy[nm] || 0) + 1;
    if (sg) { sg.hurt += dmg; sg.hitBy[nm] = (sg.hitBy[nm] || 0) + 1; }
    Q.lastHit = nm;
    // fairness: hit by something that had no time to be seen
    if (src && src.age != null && ((src.team === T_ESHOT && src.age < .12 && !(src.vx === 0 && src.vy === 0)) || (src.team === T_ENEMY && !src.boss && src.age - (src.warp0 || 0) < .25)))
      L.unfair.push({ by: nm, age: +src.age.toFixed(3), at: Q.segK, d: S.player ? +Math.hypot(src.x - S.player.x, src.y - S.player.y).toFixed(1) : -1 });
  }

  // ---- perception ----
  function snapshot() {
    const sn = { b: [], e: [], hz: [] }, p = S.player;
    for (const e of ENT.list) { if (e.dead) continue;
      if (e.team === T_ESHOT) sn.b.push([e.x, e.y, e.vx, e.vy, e.r, e]);
      else if (e.team === T_ENEMY && !e.harmless) sn.e.push({ wl: e.warp > 0 ? e.warp : 0, x: e.x, y: e.y, vx: e.warp > 0 ? 0 : e.vx || 0, vy: e.warp > 0 ? 0 : e.vy || 0, r: e.r, type: e.type, st: e.st, rot: e.rot, t: e.t, fuse: e.fuse, blast: e.blast, boss: !!e.boss, ref: e, contact: e.contact }); }
    for (const h of DIR.hz) sn.hz.push(Object.assign({}, h));
    return sn;
  }
  const ND = new WeakMap();   // per-bullet notice distance: some bullets are only seen late (clutter)
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return (u - 2) * 1.22; };

  // ---- planning: sample candidate inputs, predict own path, sum danger ----
  function plan(p, sn, lag) {
    const c = Q.cfg, cands = [[0, 0]];
    for (let i = 0; i < c.dirs; i++) { const a = i * Math.PI * 2 / c.dirs; cands.push([Math.cos(a), Math.sin(a)]); if (c.dirs > 8) cands.push([Math.cos(a) * .5, Math.sin(a) * .5]); }
    const spd = +(/SPEED=([\d.]+)/.exec(LIVE.src['ply.move']) || [0, 118])[1], A = 16;
    // perceived threats extrapolated to "now" (we know how things move), plus noise
    const nz = c.noise, B = [];
    for (const b of sn.b) { const ve = 1 + gauss() * c.velErr, vx = b[2] * ve, vy = b[3] * ve, x = b[0] + vx * lag + gauss() * nz, y = b[1] + vy * lag + gauss() * nz, d = (x - p.x) ** 2 + (y - p.y) ** 2; let nd = ND.get(b[5]); if (nd == null) { nd = Math.random() < c.miss ? 12 + Math.random() * 45 : 150; ND.set(b[5], nd); } if (d < nd * nd) B.push([x, y, vx, vy, b[4], d]); }
    if (B.length > c.att) { B.sort((a, b) => a[5] - b[5]); B.length = c.att; }
    const E = sn.e.map(e => ({ ...e, x: e.x + e.vx * lag + gauss() * nz, y: e.y + e.vy * lag + gauss() * nz }));
    const H = c.hor, mg = c.margin;
    let best = null, bc = 1e18, bnear = 1e9;
    for (const cd of cands) {
      // learned control remap (bugs that rotate/invert axes)
      let cost = 0, near = 1e9;
      const tx = cd[0] * spd, ty = cd[1] * spd;
      for (let hi = 0; hi < H.length; hi++) { const t = H[hi], k = (1 - Math.exp(-A * t)) / A;
        let px = p.x + tx * t + (p.vx - tx) * k, py = p.y + ty * t + (p.vy - ty) * k;
        px = Math.max(X0 + 2, Math.min(X1 - 2, px)); py = Math.max(Y0 + 2, Math.min(Y1 - 2, py));
        const wt = 1 / (1 + t * 3);
        for (const b of B) { const bx = b[0] + b[2] * t, by = b[1] + b[3] * t, cl = Math.hypot(bx - px, by - py) - b[4] - 2.5 - mg; if (cl < near) near = cl; if (cl < 10) cost += wt * (cl < 0 ? 60 - cl * 4 : (10 - cl) * (10 - cl) * .25); }
        for (const e of E) { if (e.wl > t + lag + .1) continue; const ex = e.x + e.vx * t, ey = e.y + e.vy * t, cl = Math.hypot(ex - px, ey - py) - e.r * .85 - 2.5 - mg - 2; if (cl < near) near = cl; if (cl < 14) cost += wt * (cl < 0 ? 80 - cl * 4 : (14 - cl) * (14 - cl) * .3);
          // charger lining up / dashing: corridor along its heading
          if (e.type === 'charger' && (e.st === 1 || e.st === 2)) { const ca = Math.cos(e.rot), sa = Math.sin(e.rot), dx = px - e.x, dy = py - e.y, along = dx * ca + dy * sa, perp = Math.abs(dx * sa - dy * ca);
            if (along > -5 && along < 170 && perp < 14 + mg) cost += wt * 25 * (1 - perp / (14 + mg + 1)); }
          if (e.type === 'sniper' && (e.st === 1 || e.st === 2)) { const ca = Math.cos(e.rot), sa = Math.sin(e.rot), dx = px - e.x, dy = py - e.y, along = dx * ca + dy * sa, perp = Math.abs(dx * sa - dy * ca);
            const urg = e.st === 2 ? 1 : Math.max(.15, 1 - e.t / 1.3); if (along > 0 && perp < 10 + mg) cost += wt * 50 * urg * (1 - perp / (11 + mg)); }
          if (e.type === 'mine' && e.fuse > 0) { const cl2 = Math.hypot(e.x - px, e.y - py) - (e.blast || 36) - 3; if (cl2 < 0) cost += wt * (e.fuse < .35 ? 40 : 12) * Math.min(1, -cl2 / 10); } }
        for (const h of sn.hz) cost += wt * hzCost(h, px, py, t + lag, mg);
        if (hi === H.length - 1) { // positional preferences at the end of the horizon
          const wl = Math.min(px - X0, X1 - px, (py - Y0) * 1.2, (Y1 - py) * 1.2); if (wl < 30) cost += (30 - wl) * .06 * c.wall;
          cost += Math.hypot(px - 240, py - 150) * .004;
          for (const h of sn.hz) if (h.kind === 'sweep' && h.t < h.warn + h.dur) { const el = Math.max(0, h.t + lag - h.warn), pos = h.pos + h.v * el, gap = h.gap + (h.gv || 0) * el;
            const along = h.vert ? px : py, other = h.vert ? py : px, ahead = (along - pos) * Math.sign(h.v); if (ahead > -4 && ahead < 110) cost += Math.max(0, Math.abs(other - gap) - h.gapW * .25) * .02 * (1 - ahead / 110) * c.weak; }
          for (const e of E) { if (e.wl > .4) continue; const d = Math.hypot(e.x - px, e.y - py), R = e.boss ? c.range + 30 : c.range; if (d < R) cost += (R - d) / R * (e.boss ? 1.2 : .5); }
        }
      }
      if (cd[0] !== Q.plan.mx || cd[1] !== Q.plan.my) cost += .08;
      if (cost < bc) { bc = cost; best = cd; bnear = near; }
    }
    return { mx: best[0], my: best[1], cost: bc, near: bnear };
  }
  function segDist(px, py, x, y, a, len) { const ca = Math.cos(a), sa = Math.sin(a), dx = px - x, dy = py - y, al = dx * ca + dy * sa; if (al < 0 || al > len) return 1e9; return Math.abs(dx * sa - dy * ca); }
  function hzCost(h, px, py, t, mg) {
    const tt = h.t + t, live = tt >= h.warn && tt < h.warn + h.dur;
    if (h.kind === 'beam') { if (!(tt >= h.warn - .25 && tt < h.warn + Math.max(h.dur, .1))) return 0;
      const a = h.a + (tt > h.warn ? h.spin * (tt - Math.max(h.t, h.warn)) : 0), d = segDist(px, py, h.x, h.y, a, h.len || 560); return d < 8 + mg ? (live ? 60 : 20) * (1 - d / (9 + mg)) : 0; }
    if (h.kind === 'sweep') { if (!(tt >= h.warn - .2 && tt < h.warn + h.dur)) return 0; const el = Math.max(0, tt - Math.max(h.t, h.warn)), pos = h.pos + h.v * el, gap = h.gap + (h.gv || 0) * el;
      const along = h.vert ? px : py, other = h.vert ? py : px, d = Math.abs(along - pos); if (d > 7 + mg) return 0; if (Math.abs(other - gap) < h.gapW / 2 - 6) return 0; return 50 * (1 - d / (8 + mg)); }
    if (h.kind === 'mark' && !h.fired) { const left = h.warn - tt; if (left > .3 || left < -.3) return 0; const d = Math.hypot(px - h.x, py - h.y); return d < 22 ? 15 * (1 - d / 22) : 0; }
    return 0;
  }

  // ---- control loop ----
  function control() {
    const c = Q.cfg, p = S.player; IN.mode = 'stick'; IN.fire = true; IN.dash = false;
    if (!p || p.dead) { IN.mvx = IN.mvy = 0; return; }
    const D = Math.max(1, Math.round(c.delay / DT)), sn = Q.ring[Math.max(0, Q.ring.length - 1 - D)] || snapshot(), lag = Math.min(D, Q.ring.length - 1) * DT;
    // learn control remapping: compare commanded vs realised acceleration
    if (Q.prevV && Math.hypot(Q.cmd.x, Q.cmd.y) > .5 && !(p.dashT > 0) && !(p.hurtT > 0)) { const ax = p.vx - Q.prevV.x, ay = p.vy - Q.prevV.y, l = Math.hypot(ax, ay);
      if (l > 3) { const ux = ax / l, uy = ay / l, cl = Math.hypot(Q.cmd.x, Q.cmd.y), cx = Q.cmd.x / cl, cy = Q.cmd.y / cl;
        const rc = ux * cx + uy * cy, rs = uy * cx - ux * cy, k = c.adapt * DT; Q.est.x += (rc - Q.est.x) * k; Q.est.y += (rs - Q.est.y) * k; } }
    Q.prevV = { x: p.vx, y: p.vy };
    // attention lapse: keep doing what we were doing (reading the HUD, panicking, looking at the boss...)
    if (Q.frozen > 0) Q.frozen -= DT; else if (Math.random() < c.lapse * DT) Q.frozen = c.lapseT[0] + Math.random() * (c.lapseT[1] - c.lapseT[0]);
    if ((Q.f - Q.lastPlan >= c.replan * (.75 + Math.random() * .5)) && !(Q.frozen > 0)) { Q.plan = plan(p, sn, lag); Q.lastPlan = Q.f; }
    let mx = Q.plan.mx, my = Q.plan.my;
    // dash when the best option still collides soon
    if (!(Q.frozen > 0) && Q.lastPlan === Q.f && p.dashCd <= 0 && !(p.dashT > 0) && Q.plan.near < 1.5 && Q.plan.cost > 25 && Math.random() < c.dashP) { IN.dash = true; Q.dashes++; }
    // apply inverse of learned rotation
    const el = Math.hypot(Q.est.x, Q.est.y); let ox = mx, oy = my;
    if (el > .35) { const rc = Q.est.x / el, rs = Q.est.y / el; ox = mx * rc + my * rs; oy = -mx * rs + my * rc; }
    if (c.dirs <= 8 && (ox || oy)) { const a = Math.round(Math.atan2(oy, ox) / (Math.PI / 4)) * Math.PI / 4; ox = Math.cos(a); oy = Math.sin(a); if (Math.abs(ox) < 1e-9) ox = 0; if (Math.abs(oy) < 1e-9) oy = 0; }
    IN.mvx = ox; IN.mvy = oy; Q.cmd = { x: mx, y: my };
    // aim
    let tgt = null, bs = 1e9;
    for (const e of sn.e) { if (e.wl > 0) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); let s = d; const r = e.ref;
      if (e.type === 'mutator') s -= 70 * (c.weak + .3);
      if (r && r.parent && r.parent.boss) { const b = r.parent; if (r.type === 'boss.seg') s += (r === b.parts[b.parts.length - 1] ? -120 : 40) * c.weak; if (r.type === 'boss.twinB') s += (b.lock === 1 ? 150 : -60) * c.weak; }
      if (e.boss) { s -= 30; if (e.type === 'boss.stack') s += 120 * c.weak; if (e.type === 'boss.twin') s += (r.lock === 0 ? 150 : -60) * c.weak; }
      if (s < bs) { bs = s; tgt = e; } }
    if (tgt) { let tx = tgt.x + tgt.vx * lag, ty = tgt.y + tgt.vy * lag; const d = Math.hypot(tx - p.x, ty - p.y), tof = d / 330 * c.lead; tx += tgt.vx * tof; ty += tgt.vy * tof;
      const a = Math.atan2(ty - p.y, tx - p.x) + gauss() * c.aimErr; Q.aimA = Q.aimA == null ? a : Q.aimA + Math.atan2(Math.sin(a - Q.aimA), Math.cos(a - Q.aimA)) * Math.min(1, DT * 18); }
    if (Q.aimA != null) { IN.ax = Math.cos(Q.aimA); IN.ay = Math.sin(Q.aimA); }
  }

  // ---- patch screen: read 3 cards, pick by perceived value (softmax), press the digit ----
  function patchInput() {
    Q.pt = (Q.pt || 0) + DT;
    if (Q.lastOffer && Q.lastOffer.length && Q.pt > .7 && Q.offerSeen !== Q.lastOffer) {
      const o = Q.lastOffer, c = Q.cfg, w = o.map(p => Math.exp(Math.log(VALUE[p.id] || 1) / c.temp * (Q.pref && Q.pref[p.id] || 1)));
      let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0; for (; i < o.length - 1; i++) { r -= w[i]; if (r <= 0) break; }
      if (Q.forcePick) { const j = o.findIndex(p => Q.forcePick.includes(p.id)); if (j >= 0) i = j; }
      Q.offerSeen = o; IN._hq['Digit' + (i + 1)] = 1; IN._aq = true; Q.log.picks.push({ id: o[i].id, t: +S.runTime.toFixed(1), at: DIR.state.sector + '.' + DIR.state.wave, offered: o.map(p => p.id) }); Q.pt = 0; return;
    }
    if (Q.pt > .35 && Q.offerSeen === Q.lastOffer) { IN._hq.KeyX = 1; IN._aq = true; Q.pt = 0; }   // skip the diff animation
  }

  // ---- one frame, exactly like 99-main.js ----
  function frame(draw) {
    S.dt = DT; S.t += DT; S.frame++;
    S.shake = S.shake > .05 ? S.shake * Math.pow(.002, DT) : 0; S.flash = S.flash > .01 ? S.flash * Math.pow(.001, DT) : 0;
    if (SCENE.name === 'patch') patchInput();
    IN.poll();
    if (SCENE.name === 'play') { Q.ring.push(snapshot()); if (Q.ring.length > 30) Q.ring.shift(); control(); }
    try { AU.update(DT); SCENE.cur.update(DT); if (draw) SCENE.cur.draw(DT); UI.overlay(DT); Q.errN = 0; }
    catch (e) { Q.log.errs.push(String(e && e.stack || e).slice(0, 300)); if (!LIVE.panic(e) && ++Q.errN > 120) { Q.errN = 0; SCENE.go('title'); } }
    if (draw) SM.POST.present(DT);
    Q.f++;
  }
  Q.frame = frame; Q.track = () => track();

  // ---- segment bookkeeping ----
  function track() {
    const k = segKey(), st = DIR.state, p = S.player;
    if (k !== Q.segK) {
      if (Q.seg && !Q.seg.end) closeSeg();
      Q.segK = k;
      if (k) { Q.seg = { k, t0: S.runTime, dur: 0, hurt: 0, dmg: 0, kills: 0, hitBy: {}, peak: 0, nsum: 0, nf: 0, hp0: p ? p.hp : 0, maxhp: p ? p.maxhp : 0, ups: PATCH.active.filter(id => PATCH.all[id].kind === 'up').length, phases: [], bugs: 0 };
        Q.log.segs.push(Q.seg); }
      else Q.seg = null;
    }
    if (p && !p.dead && p.hp > 0) Q.log.minHp = Math.min(Q.log.minHp == null ? 99 : Q.log.minHp, p.hp);
    const sg = Q.seg; if (!sg) return;
    let n = 0; ENT.each(T_ENEMY, e => { if (e.T && e.T.enemy) { n++; if (!(e.warp > 0) && (e.x < X0 - 1 || e.x > X1 + 1 || e.y < Y0 - 1 || e.y > Y1 + 1)) Q.log.outside++; } });
    const age = S.runTime - sg.t0; if (age > (k.endsWith('B') ? 200 : 90) && !sg.stalled) { sg.stalled = 1; Q.log.stall.push(k); } sg.peak = Math.max(sg.peak, n); sg.nsum += n; sg.nf++;
    sg.bugs = Math.max(sg.bugs, PATCH.bugs().length);
    if (Q.shotsOn && !k.endsWith('B') && age >= 14 && !sg.shot) { sg.shot = 1; Q.want = 'mid_' + k; }
    if (S.boss && k.endsWith('B')) { const b = S.boss; if (sg.ph !== b.ph) { sg.ph = b.ph; sg.phases.push(+(S.runTime - sg.t0).toFixed(1)); sg.phT = S.runTime; }
      if (Q.shotsOn && sg.phT && S.runTime - sg.phT > 5 && sg.shotPh !== b.ph) { sg.shotPh = b.ph; Q.want = 'boss_' + k + '_ph' + b.ph; }
      if (!sg.fight0 && b.intro <= 0) sg.fight0 = S.runTime; sg.bossHp = b.hp / b.maxhp; }
    if (st.phase === 'outro' && sg.fight0 && !sg.fightEnd) sg.fightEnd = S.runTime;
    if (st.phase === 'clear' && !sg.end) closeSeg();
  }
  function closeSeg() { const sg = Q.seg; sg.end = S.runTime; sg.dur = +(sg.end - sg.t0).toFixed(1); sg.fight = sg.fight0 ? +((sg.fightEnd || sg.end) - sg.fight0).toFixed(1) : undefined; sg.avgN = +(sg.nsum / Math.max(1, sg.nf)).toFixed(1); sg.dps = +(sg.dmg / Math.max(1, sg.dur)).toFixed(1); delete sg.nsum; delete sg.nf; }

  // ---- public: start a campaign, then step it in chunks ----
  Q.start = (skill, seed, opt) => {
    opt = opt || {}; Q.cfg = Object.assign({}, SKILL[skill], opt.cfg || {}); Q.skill = skill; Q.pref = opt.pref || null; Q.forcePick = opt.forcePick || null; Q.shotsOn = !!opt.shots;
    if (opt.hpk) DIR.HPK = opt.hpk; if (opt.pace) DIR.PACE = opt.pace;
    LIVE._c('s', 'srand(s)')(seed); Q.ring = []; Q.f = 0; Q.plan = { mx: 0, my: 0, cost: 0, near: 99 }; Q.est = { x: 1, y: 0 }; Q.cmd = { x: 0, y: 0 }; Q.prevV = null; Q.aimA = null; Q.dashes = 0; Q.segK = null; Q.seg = null; Q.frozen = 0; Q.lastPlan = -99;
    Q.log = { skill, seed, segs: [], picks: [], errs: [], hits: 0, hitBy: {}, dmg: 0, death: null, win: false, panics: 0, unfair: [], outside: 0, stall: [] };
    Q.onWin = () => { Q.log.win = true; }; Q.onDead = () => { if (Q.log.death) return; const st = DIR.state, b = S.boss;
      Q.log.death = { at: Q.segK || (st.sector + '.' + st.phase), sector: st.sector, phase: st.phase, bossPh: b ? b.ph : null, by: Q.lastHit, t: +S.runTime.toFixed(1), bugs: PATCH.bugs() }; if (Q.shotsOn) Q.want = 'death'; };
    RUN.start();
  };
  BUS.on('run:win', () => Q.onWin && Q.onWin());
  BUS.on('player:dead', () => Q.onDead && Q.onDead());
  BUS.on('panic', () => { if (Q.log) Q.log.panics++; });
  // returns {done, want} ; want = name of a screenshot moment (frame is drawn before returning)
  Q.step = (maxFrames, limitT) => {
    for (let i = 0; i < maxFrames; i++) {
      frame(false); track();
      const m = SCENE.name;
      if (m === 'over' || m === 'win' || m === 'title' || S.runTime > (limitT || 2400)) { if (Q.seg && !Q.seg.end) closeSeg(); return Q.finish(); }
      if (Q.want) { const w = Q.want; Q.want = null; for (let k = 0; k < 8; k++) frame(true); return { done: false, want: w }; }
      if (Q.shotEvery && Q.f % Q.shotEvery === 0) { frame(true); return { done: false, want: 'tick' }; }
    }
    return { done: false };
  };
  Q.finish = () => { const L = Q.log; L.time = +S.runTime.toFixed(1); L.score = S.score; L.kills = S.kills; L.final = PATCH.active.slice(); L.mode = SCENE.name; L.sector = DIR.state.sector; L.dashes = Q.dashes; L.bits = GAME.bits; return { done: true, log: L }; };
  Q.draw = () => frame(true);
})();
