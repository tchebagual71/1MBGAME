// node test/ui/perf.js : ms per draw() of each UI scene (+ hud/overlay) in headless chromium
const path = require('path'); const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('file://' + path.join(__dirname, 'index.html')); await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const T = __T, out = {};
    const time = (name, f) => { for (let i = 0; i < 5; i++) f(); const t0 = performance.now(); for (let i = 0; i < 60; i++) f(); out[name] = ((performance.now() - t0) / 60).toFixed(2); };
    T.SCENE.go('title'); time('title', () => T.SCENE.cur.draw(1 / 60));
    T.RUN.start(); time('play.hud', () => T.UI.hud(1 / 60)); time('fx.draw', () => T.FX.draw(1 / 60));
    T.SCENE.go('patch'); time('patch.pick', () => T.SCENE.cur.draw(1 / 60));
    T.SCENE.go('pause'); time('pause', () => T.SCENE.cur.draw(1 / 60));
    T.SCENE.go('over'); time('over', () => T.SCENE.cur.draw(1 / 60));
    T.SCENE.go('win'); time('win', () => T.SCENE.cur.draw(1 / 60));
    T.SCENE.go('boot'); time('boot', () => T.SCENE.cur.draw(1 / 60));
    return out; });
  console.log(r); await b.close(); })();
