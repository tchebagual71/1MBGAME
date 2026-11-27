#!/usr/bin/env node
// node test/dir/run.js [campaign|reset|shots|all]   (run node test/dir/build.js first)
const path = require('path'), { chromium } = require('playwright');
const mode = process.argv[2] || 'all';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errs = [];
  pg.on('pageerror', e => { errs.push(e.message); console.log('PAGEERROR', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')); });
  pg.on('console', m => { if (m.type() === 'error') { errs.push(m.text()); console.log('CONSOLE.error', m.text().slice(0, 400)); } else if (m.text().startsWith('#')) console.log(m.text()); });
  await pg.goto('file://' + path.join(__dirname, 'out.html'));
  await pg.waitForTimeout(400);
  // install helpers: stop rAF loop, grab module namespaces through LIVE's eval scope, manual stepper
  await pg.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    const SM = window.__SM; SM.LIVE.def('test.ns', '', 'return { DIR, GAME, FX, AU, UI, GFX, POST, RUN, T_ENEMY, T_ESHOT, T_PSHOT }');
    const NS = SM.LIVE.fn['test.ns'](); window.NS = NS; Object.assign(window, SM, NS);
    window.T = { errs: [], step(dt, draw) { const { S, IN, SCENE, LIVE } = SM; S.dt = dt; S.t += dt; S.frame++;
      S.shake = S.shake > .05 ? S.shake * Math.pow(.002, dt) : 0; S.flash = S.flash > .01 ? S.flash * Math.pow(.001, dt) : 0;
      IN.poll();
      try { NS.AU.update(dt); SCENE.cur.update(dt); if (draw) { SCENE.cur.draw(dt); NS.UI.overlay(dt); NS.POST.present(dt); } }
      catch (e) { T.errs.push(String(e && e.stack || e).slice(0, 300)); LIVE.panic(e); } } };
  });
  let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

  if (mode === 'campaign' || mode === 'all') {
    const r = await pg.evaluate(() => {
      const R = { picks: [], phases: {}, maxEnemies: 0, spawnAtCap: 0, minSpawnD: 1e9, nan: 0, win: 0, sectors: {}, bosses: {}, times: {}, simT: 0, bugsAfter: -1, banners: 0 };
      SCENE.def('patch', { enter(prev, arg) { R.picks.push(arg && arg.picks || 1); }, update() { BUS.emit('patch:done'); SCENE.go('play'); }, draw() { } });
      BUS.on('run:win', () => { R.win++; });
      const sp = GAME.spawnEnemy; GAME.spawnEnemy = function (t, x, y, o) { const p = S.player; if (p) R.minSpawnD = Math.min(R.minSpawnD, Math.hypot(x - p.x, y - p.y));
        if (ENT.count(T_ENEMY) >= 60) R.spawnAtCap++; return sp(t, x, y, o); };
      const ub = UI.banner; UI.banner = function (a, b2, s) { R.banners++; return ub.call(UI, a, b2, s); };
      R.mus = []; const am = AU.music; AU.music = function (n) { R.mus.push(n); return am.call(AU, n); };
      const ai = AU.intensity; AU.intensity = function (x) { if (!(x >= 0 && x <= 1)) R.nan++; return ai.call(AU, x); };
      RUN.start();
      const dt = 1 / 60; let f = 0;
      while (S.mode !== 'win' && R.simT < 3600) {
        const p = S.player; if (p) { p.hp = p.maxhp; p.x = 240 + Math.cos(R.simT * .7) * 150; p.y = 141 + Math.sin(R.simT * 1.1) * 80; }
        // cheat bot: enemies die 2.5 s after spawn, bosses take maxhp/24 per second
        ENT.each(T_ENEMY, e => { if (e.T.enemy && !e.boss && e.age > 2.5) ENT.kill(e, null); });
        if (S.boss && S.boss.intro <= 0) ENT.damage(S.boss, S.boss.maxhp / 24 * dt, null);
        T.step(dt, (f % 12) === 0); f++; R.simT += dt;
        const st = DIR.state;
        R.sectors[st.sector] = R.sectors[st.sector] || R.simT.toFixed(0);
        if (S.boss) { const k = st.bossKey; R.bosses[k] = Math.max(R.bosses[k] == null ? -1 : R.bosses[k], S.boss.ph); }
        const n = ENT.count(T_ENEMY); if (n > R.maxEnemies) R.maxEnemies = n;
        if (!(isFinite(S.diff) && isFinite(st.intens))) R.nan++;
        if (f % 30 === 0) for (const e of ENT.list) if (!e.dead && !(isFinite(e.x) && isFinite(e.y) && isFinite(e.hp))) { R.nan++; break; }
      }
      R.bugsAfter = PATCH.bugs().length; R.errs = T.errs.slice(0, 5); R.nErr = T.errs.length; R.mode = S.mode; R.log = DIR.state.log.filter(s => !s.startsWith('wave')).join(' ');
      R.music = R.mus.join(','); delete R.mus; AU.music = am; AU.intensity = ai;   // unwrap: later sections call AU.music
      return R;
    });
    console.log(JSON.stringify(r, null, 1).slice(0, 2500));
    ok(r.nErr === 0, 'no exceptions (' + r.nErr + ')');
    ok(Object.keys(r.sectors).length === 7, 'all sectors reached ' + JSON.stringify(r.sectors));
    ok(Object.keys(r.bosses).length === 7, 'all 7 bosses fought ' + JSON.stringify(r.bosses));
    const need = { boot: 2, malloc: 2, stack: 2, irq: 2, gc: 2, twin: 2, kernel: 3 };
    ok(Object.keys(need).every(k => r.bosses[k] === need[k]), 'every boss phase entered');
    ok(r.nan === 0, 'no NaN');
    ok(r.spawnAtCap === 0, 'no DIR spawn at/over cap (max live ' + r.maxEnemies + ')');
    ok(r.minSpawnD >= 69, 'min spawn distance from player ' + r.minSpawnD.toFixed(1));
    ok(r.picks.length === 30 && r.picks.filter(x => x === 2).length === 6, 'patch handoffs: ' + r.picks.length + ' (' + r.picks.filter(x => x === 2).length + ' double)');
    ok(r.win === 1 && r.mode === 'win', 'run:win fired once, scene win');
    ok(r.bugsAfter === 0, 'no bugs left after win');
    console.log('sim time', r.simT.toFixed(0), 's');
  }

  if (mode === 'reset' || mode === 'all') {
    const r = await pg.evaluate(() => {
      const R = {};
      SCENE.def('patch', { enter() { }, update() { BUS.emit('patch:done'); SCENE.go('play'); }, draw() { } });
      RUN.start();
      // give the player a couple of upgrades so KERNEL can revert one
      for (const u of PATCH.offer(3, 'up')) PATCH.apply(u.id);
      R.ups0 = PATCH.active.slice();
      DIR.debug.boss('kernel'); const dt = 1 / 60;
      for (let i = 0; i < 200; i++) T.step(dt, false);
      R.hasBoss = !!S.boss; DIR.debug.phase(1); for (let i = 0; i < 30; i++) T.step(dt, false);
      R.rev = DIR.state.rev && DIR.state.rev.id; R.upsMid = PATCH.active.filter(id => PATCH.all[id].kind === 'up').length;
      DIR.debug.phase(2); for (let i = 0; i < 80; i++) T.step(dt, false);
      R.bugsMid = PATCH.bugs().slice(); R.dirBugs = DIR.state.bugs.slice(); R.hzMid = DIR.hz.length;
      DIR.reset();
      R.after = { boss: S.boss, bugs: PATCH.bugs().length, hz: DIR.hz.length, phase: DIR.state.phase, enemies: ENT.count(T_ENEMY), sector: S.sector, fxtag: Object.values(LIVE._d).filter(d => d.p.some(q => q.tag === 'kernel.fx')).length };
      for (let i = 0; i < 60 * 6; i++) { S.player.hp = S.player.maxhp; T.step(dt, false); }
      R.after2 = { phase: DIR.state.phase, wave: S.wave, sector: S.sector, enemies: ENT.count(T_ENEMY), boss: S.boss };
      // debug skip into a mid boss + mutator wave
      DIR.debug.skipTo(2, 1); for (let i = 0; i < 60 * 14; i++) { S.player.hp = S.player.maxhp; T.step(dt, false); }
      R.skip = { phase: DIR.state.phase, sector: S.sector, wave: S.wave, mut: ENT.count(T_ENEMY) };
      R.errs = T.errs.slice(0, 3);
      return R;
    });
    console.log(JSON.stringify(r));
    ok(r.hasBoss, 'debug.boss spawns KERNEL');
    ok(!!r.rev && r.upsMid < r.ups0.length, 'KERNEL reverted an upgrade ' + r.rev);
    ok(r.bugsMid.length > 0, 'boss infected bugs ' + r.bugsMid);
    ok(!r.after.boss && r.after.bugs === 0 && r.after.hz === 0 && r.after.phase === 'idle' && r.after.enemies === 0 && r.after.fxtag === 0, 'DIR.reset cleans up ' + JSON.stringify(r.after));
    ok(r.after2.phase === 'wave' && r.after2.sector === 0 && r.after2.wave === 0, 'restart runs from sector 0 wave 0');
    ok(r.skip.sector === 2 && r.skip.wave === 1, 'skipTo works');
    ok(!r.errs.length, 'no exceptions in reset test');
  }

  if (mode === 'shots' || mode === 'all') {
    const keys = ['boot', 'malloc', 'stack', 'irq', 'gc', 'twin', 'kernel'];
    for (const k of keys) for (const ph of (process.env.PH ? process.env.PH.split(',').map(Number) : [0, 1, 2, 3])) {
      if (ph === 3 && k !== 'kernel') continue;
      const res = await pg.evaluate(([k, ph]) => {
        SCENE.def('patch', { enter() { }, update() { SCENE.go('play'); }, draw() { } });
        RUN.start(); DIR.debug.boss(k); const dt = 1 / 60;
        for (let i = 0; i < 150; i++) { S.player.hp = 99; T.step(dt, false); }
        if (ph) { DIR.debug.phase(ph); }
        const p = S.player;
        for (let i = 0; i < 60 * 7; i++) { p.hp = 99; p.inv = 1; p.x = 240 + Math.cos(i / 90) * 120; p.y = 200 + Math.sin(i / 70) * 40; T.step(dt, true); }
        T.step(dt, true);
        return { ph: S.boss && S.boss.ph, hp: S.boss && Math.round(S.boss.hp), eshots: GAME.counts.eshots, errs: T.errs.slice(0, 2) };
      }, [k, ph]);
      const f = path.join(__dirname, 'shots', k + ph + '.png'); await pg.screenshot({ path: f });
      console.log('shot', f, JSON.stringify(res));
      if (res.errs.length) fail++;
    }
  }
  console.log(fail ? 'FAILURES: ' + fail : 'ALL OK', errs.length ? 'pageerrors ' + errs.length : '');
  await b.close(); process.exit(fail ? 1 : 0);
})();
