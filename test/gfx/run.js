#!/usr/bin/env node
// node test/gfx/run.js [scene ...]  -> builds test/gfx/out/gfx.html, screenshots scenes, runs fuzz + bench
const fs = require('fs'), path = require('path'); const { chromium } = require('playwright');
const root = path.join(__dirname, '../..'), outd = path.join(__dirname, 'out'); fs.mkdirSync(outd, { recursive: true });
const parts = ['src/00-kernel.js', 'src/10-gfx.js', 'test/gfx/scenes.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8'));
const code = "(()=>{'use strict';\n" + parts.join('\n;\n') + '\n})();';
fs.writeFileSync(path.join(outd, 'gfx.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000"><script>' + code + '</script></body></html>');
const want = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const z of [1, 3]) {
    const p = await b.newPage({ viewport: { width: 480 * z, height: 270 * z }, deviceScaleFactor: 1 });
    p.on('pageerror', e => console.log('PAGEERROR', e.message)); p.on('console', m => console.log('console:', m.text()));
    await p.goto('file://' + path.join(outd, 'gfx.html') + '?z=' + z);
    const names = want.length ? want.filter(n => !/^(fuzz|bench)$/.test(n)) : await p.evaluate(() => Object.keys(TEST.scenes));
    for (const n of names) { await p.evaluate(n => TEST.run(n), n); await p.screenshot({ path: path.join(outd, `${n}-x${z}.png`) }); }
    if (z === 1 && (!want.length || want.includes('fuzz'))) console.log('FUZZ', await p.evaluate(fs.readFileSync(path.join(__dirname, 'fuzz.js'), 'utf8')));
    if (z === 1 && (!want.length || want.includes('bench'))) console.log('BENCH', await p.evaluate(fs.readFileSync(path.join(__dirname, 'bench.js'), 'utf8')));
    await p.close();
  }
  await b.close();
})();
