#!/usr/bin/env node
// FX harness: kernel + (gfx or stub) + fx + driver -> test/fx/out/fx.html ; screenshots every effect at dim 1 / .38, bench, bug patches.
// usage: node test/fx/run.js [effect,effect...]
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const root = path.join(__dirname, '../..'), out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
let gfx = 'const GFX = undefined;';
if (fs.existsSync(path.join(root, 'src/10-gfx.js'))) { try { execSync('node --check ' + path.join(root, 'src/10-gfx.js')); gfx = rd('src/10-gfx.js'); } catch (e) { console.log('gfx fails check, stubbing'); } }
const driver = `
CV.width = W; CV.height = H; CV.style.width = (W*2)+'px'; CV.style.height=(H*2)+'px'; CV.style.left='0px'; CV.style.top='0px';
const ctx = CV.getContext('2d'), img = ctx.createImageData(W, H), u32 = new Uint32Array(img.data.buffer);
const present = () => { u32.set(fb); ctx.putImageData(img, 0, 0); };
window.T = {
  S, LIVE, PATCH, FX, fb,
  show(name, dim, frames, t) { FX.set(name, 0); FX.dim = dim; S.t = t || 5; for (let i = 0; i < (frames || 30); i++) { S.t += 1/60; S.beat = (i % 30) / 30 < .1 ? 1 - (i % 30) / 3 : 0; FX.draw(1/60); } present();
    let mx = 0; for (let i = 0; i < fb.length; i++) { const c = fb[i]; mx = Math.max(mx, c & 255, c >> 8 & 255, c >> 16 & 255); } return mx; },
  bench(name, n) { FX.set(name, 0); FX.dim = .38; for (let i = 0; i < 20; i++) FX.draw(1/60); const t0 = performance.now(); for (let i = 0; i < n; i++) { S.t += 1/60; FX.draw(1/60); } return (performance.now() - t0) / n; },
  present,
};
`;
const code = "(()=>{'use strict';\n" + [rd('src/00-kernel.js'), gfx, rd('src/20-fx.js'), driver].join('\n;\n') + '\n})();';
fs.writeFileSync(path.join(out, 'fx.html'), '<!DOCTYPE html><html><body style="margin:0;background:#000"><script>' + code + '</script></body></html>');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  let errs = 0; p.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message, e.stack); }); p.on('console', m => console.log('CONSOLE', m.text()));
  await p.goto('file://' + path.join(out, 'fx.html'));
  const names = process.argv[2] ? process.argv[2].split(',') : await p.evaluate(() => T.FX.names);
  const t0 = Date.now(); await p.evaluate(() => T.FX.warm()); console.log('warm (init all) ms', Date.now() - t0);
  const mode = process.argv[3] || 'all';
  if (mode === 'all' || mode === 'shots') for (const n of names) for (const d of [1, .38]) {
    const mx = await p.evaluate(([n, d]) => T.show(n, d, 90, 11), [n, d]);
    await p.screenshot({ path: path.join(out, n + '_' + d + '.png') }); console.log('shot', n, d, 'max', mx);
  }
  if (mode === 'all' || mode === 'bench') for (const n of names) console.log('bench', n, (await p.evaluate(n => T.bench(n, 200), n)).toFixed(2), 'ms');
  if (mode === 'all' || mode === 'bugs') {
    const bugs = await p.evaluate(() => Object.values(T.PATCH.all).filter(p => p.kind === 'bug' && p.id.startsWith('fx.')).map(p => p.id));
    for (const id of bugs) {
      const r = await p.evaluate(id => { const before = { out: T.LIVE.src['fx.out'], clock: T.LIVE.src['fx.clock'] }; const ok = T.PATCH.apply(id); let err = null;
        try { T.show('plasma', .38, 30, 20); } catch (e) { err = e.message; } return { ok, err, gen: T.LIVE.gen }; }, id);
      await p.screenshot({ path: path.join(out, 'bug_' + id + '.png') });
      const c = await p.evaluate(id => { const ok = T.PATCH.cure(id); return ok && T.LIVE.src['fx.out'] === T.LIVE._d['fx.out'].base && T.LIVE.src['fx.clock'] === T.LIVE._d['fx.clock'].base; }, id);
      console.log('bug', id, JSON.stringify(r), 'cured+clean', c);
    }
    // all at once, on every effect
    const all = await p.evaluate(ids => { const ok = ids.map(id => T.PATCH.apply(id)); const errs = []; for (const n of T.FX.names) { try { T.show(n, .38, 5, 30); } catch (e) { errs.push(n + ':' + e.message); } }
      T.show('tunnel', .38, 20, 30); return { ok, errs }; }, bugs);
    await p.screenshot({ path: path.join(out, 'bug_ALL.png') });
    const clean = await p.evaluate(ids => { ids.forEach(id => T.PATCH.cure(id)); return T.LIVE.src['fx.out'] === T.LIVE._d['fx.out'].base; }, bugs);
    console.log('all bugs', JSON.stringify(all), 'clean after cure', clean);
    // crossfade
    await p.evaluate(() => { T.FX.set('plasma', 0); T.FX.draw(1/60); T.FX.set('tunnel', 1); for (let i = 0; i < 30; i++) T.FX.draw(1/60); T.present(); });
    await p.screenshot({ path: path.join(out, 'xfade.png') });
  }
  console.log(errs ? 'ERRORS ' + errs : 'no page errors'); await b.close();
})();
