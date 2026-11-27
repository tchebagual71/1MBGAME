#!/usr/bin/env node
// Gameplay bug hunt: state leaks across RUN.start, pause/resume + restart mid-boss, KERNEL revert/restore with stacked
// patches, mutators vs boss-phase bugs, held fire through the patch screen (real mouse events).
// node test/qa-play/bugs.js   (needs dist/dev.html)
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const html = path.resolve(path.join(__dirname, '../../dist/dev.html')), botSrc = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errs = []; pg.on('pageerror', e => { errs.push(e.message); console.log('PAGEERROR', e.message); });
  await pg.goto('file://' + html); await pg.waitForFunction(() => window.__SM && window.__SM.SCENE.name);
  await pg.evaluate(botSrc);
  // pristine snapshot of every live function
  await pg.evaluate(() => { window.PRIS = Object.assign({}, __SM.LIVE.src); });
  const audit = () => pg.evaluate(() => {
    const { S, LIVE, PATCH, ENT, DIR, FX } = __SM, bad = [];
    for (const k in PRIS) if (LIVE.src[k] !== PRIS[k]) bad.push('src:' + k);
    if (PATCH.active.length) bad.push('active:' + PATCH.active.join(','));
    for (const id in PATCH.all) if (PATCH.all[id].n) bad.push('n:' + id);
    const nonP = ENT.list.filter(e => !e.dead && e.team !== 0 && e.team !== 2 && e.team !== 5); if (nonP.length) bad.push('ents:' + nonP.map(e => e.type).join(','));
    if (S.boss || DIR.state.boss) bad.push('boss'); if (DIR.hz.length) bad.push('hz:' + DIR.hz.length); if (DIR.state.rev) bad.push('rev'); if (DIR.state.bugs.length) bad.push('dirbugs');
    const p = S.player; if (!p || p.hp !== 5 || p.maxhp !== 5 || p.dead) bad.push('player:' + (p && p.hp + '/' + p.maxhp));
    if (S.score || S.kills || S.combo || S.mult !== 1 || S.sector || S.wave || S.runTime > .5) bad.push('S:' + [S.score, S.kills, S.combo, S.mult, S.sector, S.wave, S.runTime.toFixed(2)].join('/'));
    return bad;
  });
  const steps = (n, draw) => pg.evaluate(([n, draw]) => { for (let i = 0; i < n; i++) QA.frame(draw && i % 6 === 0); return __SM.SCENE.name; }, [n, !!draw]);

  // 1) play -> die -> retry x3 (novice dies fast); each retry must be pristine
  for (let i = 0; i < 3; i++) {
    const r = await pg.evaluate(seed => { QA.start('novice', seed); for (let f = 0; f < 60 * 900; f++) { QA.frame(false); if (__SM.SCENE.name === 'over') break; } return { scene: __SM.SCENE.name, sector: __SM.S.sector, t: __SM.S.runTime }; }, 900 + i);
    ok(r.scene === 'over', `retry ${i}: run ended in 'over' (sector ${r.sector}, ${r.t.toFixed(0)}s)`);
    await pg.evaluate(() => { __SM.RUN.start(); QA.frame(false); });
    const bad = await audit(); ok(!bad.length, `retry ${i}: clean restart ${bad.join(' ')}`);
  }
  // 2) win -> title -> start
  {
    const r = await pg.evaluate(() => { const { DIR, SCENE, PATCH } = __SM; QA.start('expert', 4242); for (const id of ['rate', 'dmg', 'dmg', 'hp', 'fork']) PATCH.apply(id);
      DIR.debug.boss('kernel'); for (let f = 0; f < 600; f++) QA.frame(false); DIR.debug.phase(1); for (let f = 0; f < 120; f++) QA.frame(false); DIR.debug.phase(2); for (let f = 0; f < 120; f++) QA.frame(false);
      DIR.debug.phase(3); for (let f = 0; f < 120; f++) QA.frame(false); const bugsMid = PATCH.bugs().slice(); DIR.debug.kill(); for (let f = 0; f < 60 * 8 && SCENE.name !== 'win'; f++) QA.frame(false);
      return { scene: SCENE.name, bugsMid, bugs: PATCH.bugs(), active: PATCH.active.slice() }; });
    ok(r.scene === 'win', 'kernel kill -> win scene');
    ok(!r.bugs.length, 'no bugs active on win (mid-fight had ' + r.bugsMid.join(',') + ')');
    ok(['rate', 'dmg', 'hp', 'fork'].every(id => r.active.includes(id)), 'upgrades intact after kernel (revert restored): ' + r.active.join(','));
    await pg.evaluate(() => { __SM.SCENE.go('title'); for (let f = 0; f < 30; f++) QA.frame(false); __SM.RUN.start(); QA.frame(false); });
    const bad = await audit(); ok(!bad.length, 'win -> title -> start is clean ' + bad.join(' '));
  }
  // 3) pause/resume mid-boss, and restart from pause mid-KERNEL phase 1 (an upgrade is reverted at that moment)
  {
    const r = await pg.evaluate(() => { const { S, DIR, SCENE, PATCH, IN } = __SM; QA.start('expert', 77); for (const id of ['rate', 'rate', 'dmg']) PATCH.apply(id);
      DIR.debug.boss('irq'); for (let f = 0; f < 600; f++) QA.frame(false); const hp0 = S.boss.hp, ph0 = S.boss.ph, hz0 = DIR.hz.length;
      SCENE.go('pause'); for (let f = 0; f < 300; f++) QA.frame(false); const hpP = S.boss.hp, scP = SCENE.name;
      IN._hq.Escape = 1; QA.frame(false); for (let f = 0; f < 10; f++) QA.frame(false);
      return { scP, frozen: hpP === hp0, back: SCENE.name, ph: S.boss && S.boss.ph === ph0 }; });
    ok(r.scP === 'pause' && r.frozen, 'pause freezes boss fight');
    ok(r.back === 'play' && r.ph, 'Esc resumes boss fight in same phase');
    const r2 = await pg.evaluate(() => { const { S, DIR, SCENE, PATCH } = __SM; QA.start('expert', 78); for (const id of ['rate', 'rate', 'dmg', 'dmg', 'hp']) PATCH.apply(id);
      DIR.debug.boss('kernel'); for (let f = 0; f < 400; f++) QA.frame(false); DIR.debug.phase(1); for (let f = 0; f < 90; f++) QA.frame(false);
      const rev = DIR.state.rev && DIR.state.rev.id; SCENE.go('pause'); QA.frame(false); __SM.RUN.start(); QA.frame(false); return { rev }; });
    const bad = await audit(); ok(!bad.length && r2.rev, `restart from pause during KERNEL revert (${r2.rev}) is clean ${bad.join(' ')}`);
  }
  // 4) KERNEL revert/restore for every stackable upgrade: source must be byte-identical after restore, hp sane
  {
    const r = await pg.evaluate(() => { const { S, DIR, PATCH, LIVE } = __SM, out = [];
      for (const id in PATCH.all) { const P = PATCH.all[id]; if (P.kind !== 'up') continue;
        QA.start('expert', 99); const others = ['rate', 'dmg', 'hp'].filter(x => x !== id); for (const o of others) PATCH.apply(o); for (let i = 0; i < P.max; i++) PATCH.apply(id);
        // force KERNEL to pick this id: make it the only up active while reverting
        const save = PATCH.active.slice(); const src0 = JSON.stringify(LIVE.src); const p = S.player; const mh0 = p.maxhp;
        DIR.debug.boss('kernel'); for (let f = 0; f < 400; f++) QA.frame(false);
        PATCH.active = PATCH.active.filter(x => x === id).concat(PATCH.active.filter(x => PATCH.all[x].kind === 'bug'));
        DIR.debug.phase(1); for (let f = 0; f < 3; f++) QA.frame(false);
        PATCH.active = PATCH.active.concat(save.filter(x => x !== id));
        const rev = DIR.state.rev; const mid = LIVE.src['wpn.fire'];
        for (let f = 0; f < 60 * 16; f++) { p.hp = p.maxhp; p.inv = 1; QA.frame(false); }
        const same = JSON.stringify(Object.fromEntries(Object.entries(LIVE.src).filter(([k]) => !k.startsWith('fx.') && !k.startsWith('mu.') && !k.startsWith('ui.') && !k.startsWith('post.')))) ===
          JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(src0)).filter(([k]) => !k.startsWith('fx.') && !k.startsWith('mu.') && !k.startsWith('ui.') && !k.startsWith('post.'))));
        const n = PATCH.active.filter(x => x === id).length;
        out.push({ id, rev: rev && rev.id, n: rev && rev.n, restored: n, max: P.max, same, maxhp: p.maxhp, mh0, bugs: PATCH.bugs() }); }
      return out; });
    for (const x of r) ok(x.rev === x.id && x.restored === x.max && x.n === x.max, `KERNEL revert ${x.id} x${x.max}: reverted ${x.rev} x${x.n}, restored x${x.restored}${x.same ? '' : ' (live src differs after restore: bug patches active ' + x.bugs.join(',') + ')'}${x.maxhp !== x.mh0 ? ' maxhp ' + x.mh0 + '->' + x.maxhp : ''}`);
  }
  // 5) mutator killed during boss phases: cures only its own bug; boss phase bugs still cured at phase end; nothing left after death
  {
    const r = await pg.evaluate(() => { const { S, DIR, PATCH, ENT, GAME } = __SM; QA.start('expert', 55); for (const id of ['rate', 'dmg', 'dmg']) PATCH.apply(id);
      DIR.debug.boss('gc'); for (let f = 0; f < 400; f++) QA.frame(false); DIR.debug.phase(1); for (let f = 0; f < 80; f++) QA.frame(false);
      const bossBug = S.boss.bugs.slice(); const m = GAME.spawnEnemy('mutator', 100, 200, { warp: 0 }); for (let f = 0; f < 5; f++) QA.frame(false);
      const mBug = m.bug && m.bug.id; const both = PATCH.bugs().slice(); ENT.damage(m, 1e6, { x: 0, y: 0 }); QA.frame(false); const afterKill = PATCH.bugs().slice();
      DIR.debug.phase(2); for (let f = 0; f < 80; f++) QA.frame(false); const ph2 = PATCH.bugs().slice(), boss2 = S.boss.bugs.slice();
      const m2 = GAME.spawnEnemy('mutator', 100, 200, { warp: 0 }); for (let f = 0; f < 5; f++) QA.frame(false); const m2Bug = m2.bug && m2.bug.id;
      DIR.debug.kill(); for (let f = 0; f < 60 * 5; f++) QA.frame(false);
      return { bossBug, mBug, both, afterKill, ph2, boss2, m2Bug, end: PATCH.bugs(), scene: __SM.SCENE.name }; });
    ok(r.mBug && r.both.includes(r.mBug) && r.bossBug.every(x => r.both.includes(x)), `boss bug ${r.bossBug} + mutator bug ${r.mBug} both active`);
    ok(!r.afterKill.includes(r.mBug) && r.bossBug.every(x => r.afterKill.includes(x)), 'killing the mutator cures only its bug');
    ok(r.bossBug.every(x => !r.ph2.includes(x) || r.boss2.includes(x)), 'phase change cures previous boss bug');
    ok(!r.end.length, 'no bugs after boss death (mutator alive at death had ' + r.m2Bug + ') -> ' + r.end.join(','));
  }
  // 6) held fire through the patch screen, with real mouse input
  {
    await pg.evaluate(() => { const { S, DIR, PATCH } = __SM; QA.start('expert', 66); DIR.debug.skipTo(0, 0); });
    await pg.mouse.move(700, 270); await pg.mouse.down();
    // kill the wave, stepping the real input path (IN.poll) without the bot overriding fire
    const r = await pg.evaluate(() => { const { S, DIR, SCENE, ENT, IN, PATCH, LIVE } = __SM; const log = []; const n0 = PATCH.active.length;
      for (let f = 0; f < 60 * 60 && SCENE.name !== 'patch'; f++) { ENT.each(1, e => { if (e.age > .7) ENT.kill(e, null); }); QA.frame(false); }
      const enter = SCENE.name; let picked = 0, fr = 0;
      for (let f = 0; f < 60 * 3; f++) { S.dt = 1 / 60; IN.poll(); __SM.SCENE.cur.update(1 / 60); if (PATCH.active.length !== n0) { picked = f; break; } fr = f; }
      return { enter, picked, held: IN.fire, active: PATCH.active.length - n0 }; });
    ok(r.enter === 'patch', 'reached patch screen while holding fire');
    ok(r.active === 0, 'holding fire (no new click) does not pick a card: ' + JSON.stringify(r));
    await pg.mouse.up(); await pg.mouse.click(480, 180);
    const r2 = await pg.evaluate(() => { const { SCENE, IN, PATCH } = __SM; let sc = []; for (let f = 0; f < 60 * 4; f++) { __SM.S.dt = 1 / 60; IN.poll(); IN._aq = true; __SM.SCENE.cur.update(1 / 60); if (!sc.includes(SCENE.name)) sc.push(SCENE.name); if (SCENE.name === 'play') break; } return { sc, n: PATCH.active.length }; });
    ok(r2.n >= 1, 'click picks a card after release ' + JSON.stringify(r2));
    await pg.mouse.move(700, 100); await pg.mouse.down();
    const r3 = await pg.evaluate(() => { const { SCENE, IN, S } = __SM; for (let f = 0; f < 120 && SCENE.name !== 'play'; f++) { IN.poll(); IN._aq = true; SCENE.cur.update(1 / 60); }
      let shots = 0; for (let f = 0; f < 60; f++) { S.dt = 1 / 60; S.t += 1 / 60; IN.poll(); SCENE.cur.update(1 / 60); } __SM.ENT.each(2, () => shots++); return { scene: SCENE.name, fire: IN.fire, shots }; });
    ok(r3.scene === 'play' && r3.fire && r3.shots > 0, 'held fire works again after the patch screen ' + JSON.stringify(r3));
    await pg.mouse.up();
  }
  ok(!errs.length, 'no page errors (' + errs.length + ')');
  await b.close(); console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
