// node test/qa-visual/prof.js scene-setup-js  -> breakdown of draw time by module function
const path = require('path'); const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.goto('file://' + path.join(__dirname, '../../dist/dev.html')); await p.waitForFunction(() => window.__SM && window.__SM.S);
  const r = await p.evaluate(setup => {
    const M = window.__SM, T = {}; const wrap = (o, k, n) => { const f = o[k]; o[k] = function () { const a = performance.now(); const r = f.apply(this, arguments); T[n] = (T[n] || 0) + performance.now() - a; return r; }; };
    M.SCENE.go('title'); M.RUN.start(); new Function('M', setup)(M);
    for (let i = 0; i < 30; i++) { M.S.t += 1 / 60; M.S.dt = 1 / 60; M.S.frame++; M.SCENE.cur.update(1 / 60); M.SCENE.cur.draw(1 / 60); M.UI.overlay(1 / 60); }
    wrap(M.FX, 'draw', 'FX.draw'); wrap(M.GAME, 'draw', 'GAME.draw'); wrap(M.UI, 'hud', 'UI.hud'); wrap(M.GFX, 'pDraw', 'GFX.pDraw'); wrap(M.GFX, 'textFx', 'GFX.textFx'); wrap(M.GFX, 'glow', 'GFX.glow'); wrap(M.GFX, 'glowLine', 'GFX.glowLine'); wrap(M.GFX, 'boltNow', 'GFX.boltNow'); wrap(M.GFX, 'text', 'GFX.text'); wrap(M.GFX, 'lineA', 'GFX.lineA'); wrap(M.GFX, 'hsv', 'GFX.hsv'); wrap(M.GFX, 'fade', 'GFX.fade'); wrap(M.GFX, 'rectA', 'GFX.rectA');
    for (const k in M.LIVE.fn) if (/^(fx|ui|boss)\./.test(k)) wrap(M.LIVE.fn, k, k);
    const N = 120; let tot = 0;
    for (let i = 0; i < N; i++) { M.S.t += 1 / 60; M.S.dt = 1 / 60; M.S.frame++; M.SCENE.cur.update(1 / 60); const a = performance.now(); M.SCENE.cur.draw(1 / 60); M.UI.overlay(1 / 60); tot += performance.now() - a; }
    const o = Object.entries(T).map(([k, v]) => [k, v / N]).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => k.padEnd(18) + v.toFixed(3));
    return ['TOTAL draw ' + (tot / N).toFixed(3), ...o].join('\n');
  }, process.argv[2] || "M.SCENE.go('title')");
  console.log(r); await b.close();
})();
