#!/usr/bin/env node
// Usage: node tools/smoke.js [html=dist/dev.html] [seconds=6] [out.png] [script]
// script: comma list of actions run in order, e.g. "wait:2,key:Enter,wait:1,click:240:135,down:KeyD,wait:2,up:KeyD,shot:/path/a.png,eval:S.mode"
// Prints console errors / page errors and the final S.mode (dev build exposes nothing globally, so 'eval:' runs in page global scope only).
const path = require('path'); const { chromium } = require('playwright');
(async () => {
  const html = path.resolve(process.argv[2] || 'dist/dev.html'), secs = +(process.argv[3] || 6), out = process.argv[4], script = process.argv[5] || '';
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  let errs = 0; p.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')); });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { if (m.type() === 'error') errs++; console.log('CONSOLE.' + m.type(), m.text().slice(0, 600)); } else if (m.text().startsWith('#')) console.log(m.text()); });
  await p.goto('file://' + html);
  for (const a of script.split(',').filter(Boolean)) { const [op, x, y] = a.split(':').length > 2 && a.startsWith('shot') ? ['shot', a.slice(5)] : a.split(':');
    if (op === 'wait') await p.waitForTimeout(+x * 1000); else if (op === 'key') await p.keyboard.press(x); else if (op === 'down') await p.keyboard.down(x); else if (op === 'up') await p.keyboard.up(x);
    else if (op === 'click') await p.mouse.click(+x * 2, +y * 2); else if (op === 'move') await p.mouse.move(+x * 2, +y * 2); else if (op === 'mdown') await p.mouse.down(); else if (op === 'mup') await p.mouse.up();
    else if (op === 'shot') await p.screenshot({ path: x }); else if (op === 'eval') console.log('EVAL', a.slice(5), '=>', JSON.stringify(await p.evaluate(a.slice(5)))); }
  await p.waitForTimeout(secs * 1000);
  if (out) await p.screenshot({ path: out });
  console.log(errs ? `FAIL: ${errs} error(s)` : 'OK: no errors'); await b.close(); process.exit(errs ? 1 : 0);
})();
