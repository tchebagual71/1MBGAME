// node test/qa-visual/fxbench.js -> min-of-batches ms per FX.draw (robust to machine noise), plus GAME.draw/pDraw/hud/title
const path = require('path'); const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.goto('file://' + path.join(__dirname, '../../dist/dev.html')); await p.waitForFunction(() => window.__SM && window.__SM.S);
  const r = await p.evaluate(() => {
    const M = window.__SM, { FX, S } = M, out = [];
    const mb = (fn, n) => { let best = 1e9; for (let k = 0; k < 7; k++) { const a = performance.now(); for (let i = 0; i < n; i++) fn(i); best = Math.min(best, (performance.now() - a) / n); } return best; };
    M.SCENE.go('title'); FX.warm();
    for (const n of FX.names) { FX.set(n, 0); FX.dim = .38; for (let i = 0; i < 10; i++) FX.draw(1 / 60); out.push(n.padEnd(10) + mb(() => { S.t += 1 / 60; FX.draw(1 / 60); }, 20).toFixed(2)); }
    M.RUN.start(); const pl = S.player; pl.inv = 99;
    const T = M.GAME.enemyTypes.filter(t => t !== 'mutator' && t !== 'shard');
    for (let i = 0; i < 60; i++) M.GAME.spawnEnemy(T[i % T.length], 30 + Math.random() * 420, 30 + Math.random() * 220, { warp: 0 });
    for (let i = 0; i < 400; i++) { const a = Math.random() * 6.28; M.GAME.shoot(20 + Math.random() * 440, 26 + Math.random() * 230, Math.cos(a) * 5, Math.sin(a) * 5, { team: 3, life: 60 }); }
    while (M.GFX.pCount() < 3000) M.GFX.burst(240, 135, 100, M.GFX.hsv(Math.random(), .7, 1), 60, 50);
    out.push('GAME.draw (60e/400b) ' + mb(() => M.ENT.draw(), 20).toFixed(2));
    out.push('GFX.pDraw 3000      ' + mb(() => M.GFX.pDraw(), 20).toFixed(2));
    out.push('UI.hud              ' + mb(() => M.UI.hud(1 / 60), 20).toFixed(2));
    M.SCENE.go('title'); for (let i = 0; i < 5; i++) M.SCENE.cur.draw(1 / 60);
    out.push('title scene draw    ' + mb(() => { S.t += 1 / 60; M.SCENE.cur.update(1 / 60); M.SCENE.cur.draw(1 / 60); }, 20).toFixed(2));
    M.SCENE.go('patch'); for (let i = 0; i < 40; i++) { M.SCENE.cur.update(1 / 60); M.SCENE.cur.draw(1 / 60); }
    out.push('patch scene draw    ' + mb(() => { M.SCENE.cur.draw(1 / 60); }, 20).toFixed(2));
    return out.join('\n'); });
  console.log(r); await b.close();
})();
