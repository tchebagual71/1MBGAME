// node test/qa-visual/perf.js [html=dist/dev.html] -> CPU ms/frame (update / draw+overlay / present) in heavy situations
const path = require('path'); const { chromium } = require('playwright');
(async () => {
  const html = path.resolve(__dirname, '../..', process.argv[2] || 'dist/dev.html');
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + html); await p.waitForFunction(() => window.__SM && window.__SM.S);
  const bench = (label, setup, fxn) => p.evaluate(([label, setup, fxn]) => {
    const M = window.__SM, { S, SCENE, UI, POST, FX, GAME, DIR, IN, GFX, ENT } = M;
    const keep = () => { const pl = S.player; if (pl) { pl.inv = 1; pl.hp = pl.maxhp; } };
    const top = (nE, nB) => { const T = GAME.enemyTypes.filter(t => t !== 'mutator' && t !== 'shard'); let e = 0; ENT.each(1, () => e++); let bb = 0; ENT.each(3, () => bb++);
      for (let i = e; i < nE; i++) GAME.spawnEnemy(T[i % T.length], 30 + Math.random() * 420, 30 + Math.random() * 220, { warp: 0 });
      for (let i = bb; i < nB; i++) { const a = Math.random() * 6.28; GAME.shoot(20 + Math.random() * 440, 26 + Math.random() * 230, Math.cos(a) * 20, Math.sin(a) * 20, { team: 3, life: 30 }); } };
    const parts = n => { while (GFX.pCount() < n) GFX.burst(40 + Math.random() * 400, 40 + Math.random() * 200, 100, GFX.hsv(Math.random(), .7, 1), 60, 4); };
    SCENE.go('title'); M.RUN.start(); keep();
    new Function('M', 'top', 'parts', setup)(M, top, parts);
    if (fxn) { FX.set(fxn, 0); FX.dim = .38; }
    IN._mb = 1; IN.mx = 100; IN.my = 60; IN.mode = 'mouse';
    const N = 90, dt = 1 / 60, tU = [], tD = [], tP = [];
    for (let f = 0; f < N + 10; f++) { keep(); if (setup.includes('top(')) new Function('M', 'top', 'parts', setup.replace(/M\.DIR[^;]*;/g, ''))(M, top, parts);
      S.dt = dt; S.t += dt; S.frame++;
      const a = performance.now(); IN.poll(); IN.fire = true; SCENE.cur.update(dt); const b2 = performance.now(); SCENE.cur.draw(dt); UI.overlay(dt); const c = performance.now(); POST.present(dt); const d = performance.now();
      if (f >= 10) { tU.push(b2 - a); tD.push(c - b2); tP.push(d - c); } }
    const st = a => { a.sort((x, y) => x - y); return a[a.length >> 1].toFixed(2) + "/" + (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2); };
    let ne = 0, nb = 0; ENT.each(1, () => ne++); ENT.each(3, () => nb++);
    return label.padEnd(26) + ' upd ' + st(tU) + '  draw ' + st(tD) + '  present ' + st(tP) + `   [${ne}e ${nb}b ${GFX.pCount()}p ${S.mode}]`;
  }, [label, setup, fxn || '']);
  console.log('median/mean ms per frame (headless swiftshader; present includes software GL upload)');
  for (const fx of ['plasma', 'copper', 'metaballs', 'lens', 'twister', 'kefrens', 'starfield', 'moire', 'voxel', 'rotozoom', 'tunnel', 'feedback', 'matrix', 'fire'])
    console.log(await bench('heavy 60e/400b/3000p ' + fx, `M.DIR.debug.skipTo(2,1); top(60,400); parts(3000);`, fx));
  console.log(await bench('KERNEL p1', `M.DIR.debug.boss('kernel'); for(let i=0;i<260;i++){M.DIR.update(1/60);M.GAME.update(1/60);}`));
  console.log(await bench('KERNEL p3 + heavy', `M.DIR.debug.boss('kernel'); for(let i=0;i<260;i++){M.DIR.update(1/60);M.GAME.update(1/60);} M.DIR.debug.phase(2); top(40,300); parts(2500);`));
  console.log(await bench('patch screen', `M.SCENE.go('patch');`));
  console.log(await bench('title', `M.SCENE.go('title');`));
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no errors'); await b.close();
})();
