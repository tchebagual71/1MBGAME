// node test/fx/times.js effect dim t1,t2,...  -> screenshots at several times
const path = require('path'), { chromium } = require('playwright');
(async () => { const [n, d, ts] = process.argv.slice(2); const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('file://' + path.join(__dirname, 'out/fx.html'));
  for (const t of ts.split(',')) { await p.evaluate(([n, d, t]) => T.show(n, +d, 60, +t), [n, d, t]); await p.screenshot({ path: path.join(__dirname, 'out', `t_${n}_${t}.png`) }); }
  await b.close(); })();
