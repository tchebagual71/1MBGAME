// node test/qa-visual/fxlum.js [dim=.38] -> per-effect fb brightness stats (fb only, before CRT)
const path = require('path'); const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  await p.goto('file://' + path.join(__dirname, '../../dist/dev.html')); await p.waitForFunction(() => window.__SM);
  const r = await p.evaluate(dim => { const { FX, fb, S, SCENE } = window.__SM; SCENE.go('title'); const out = {};
    for (const n of FX.names) { if (n === 'boot') continue; FX.set(n, 0); FX.dim = dim; let mx = [], lum = [];
      for (let f = 0; f < 90; f++) { S.beat = (f % 30) / 30 < .1 ? 1 : 0; FX.draw(1 / 60); if (f % 10) continue;
        for (let i = 0; i < fb.length; i += 7) { const c = fb[i], R = c & 255, G = c >> 8 & 255, B = c >> 16 & 255; mx.push(Math.max(R, G, B)); lum.push((R * 54 + G * 183 + B * 19) >> 8); } }
      mx.sort((a, b) => a - b); lum.sort((a, b) => a - b); const q = (a, k) => a[Math.floor(a.length * k)];
      out[n] = `maxch p50 ${q(mx, .5)} p95 ${q(mx, .95)} max ${mx[mx.length - 1]} | lum mean ${(lum.reduce((a, b) => a + b, 0) / lum.length).toFixed(1)} p95 ${q(lum, .95)}`; }
    return out; }, +(process.argv[2] || .38));
  for (const k in r) console.log(k.padEnd(10), r[k]); await b.close();
})();
