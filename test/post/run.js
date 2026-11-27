#!/usr/bin/env node
// node test/post/run.js [outdir]  — screenshots + measurements for POST
const path = require('path'), fs = require('fs'); const { chromium } = require('playwright');
require('./build.js');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'shots')); fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.join(__dirname, 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let errs = 0;
  async function page(w, h, dpr, q = '') {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    p.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message); });
    p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(m.text())) { errs++; console.log('CONSOLE.' + m.type(), m.text().slice(0, 400)); } });
    await p.goto(url + q); await p.waitForTimeout(100); return p;
  }
  const ev = (p, s) => p.evaluate(s);
  const shot = async (p, name) => { await p.screenshot({ path: path.join(out, name + '.png') }); };
  const res = {};
  // sizes x patterns
  for (const [w, h, d] of [[480, 270, 1], [960, 540, 1], [960, 540, 2], [1920, 1080, 1], [390, 844, 1], [390, 844, 2], [1280, 720, 1]]) {
    const p = await page(w, h, d);
    const tag = `${w}x${h}@${d}`;
    res[tag] = { mode: await ev(p, 'T.mode()') };
    for (const pat of ['bars', 'gratings', 'orient', 'text', 'dots', 'game']) {
      await ev(p, `T.pat('${pat}'); T.step(4)`);
      res[tag][pat] = await ev(p, 'T.measure()');
      res[tag][pat + '_off'] = await ev(p, `T.set({crt:false}); T.step(2); const r = T.measure(); T.set({crt:true}); T.step(2); r`);
      if (w === 960 && d === 1 || w === 1920 || pat === 'orient' || pat === 'game' || pat === 'bars') { await ev(p, 'T.step(1)'); await shot(p, `${tag}-${pat}`); }
    }
    res[tag].cpu = await ev(p, `T.pat('game'); T.raf(120)`);
    await p.close();
  }
  // effects at 960x540 dpr2 (1920x1080 backing) on the game frame
  const p = await page(960, 540, 1);
  await ev(p, `T.pat('game'); T.step(3)`);
  for (const g of [0, .12, .5, 1]) for (const k of [0, 1]) { await ev(p, `T.step(${k ? 7 : 1}, 1/60, {glitch:${g}})`); await shot(p, `fx-glitch${g}-${k}`); }
  await ev(p, `T.step(1,1/60,{glitch:0, flash:.6})`); await shot(p, 'fx-flash'); res.flash = await ev(p, `T.set({flash:.6}); T.measure()`);
  await ev(p, `T.step(1,1/60,{flash:0, shake:8})`); await shot(p, 'fx-shake');
  await ev(p, `T.step(1,1/60,{shake:0, beat:1})`); await shot(p, 'fx-beat'); await ev(p, 'T.set({beat:0})');
  for (const id of ['post.hsync', 'post.swap', 'post.ghost']) {
    res[id] = { apply: await ev(p, `T.patch('${id}')`) };
    await ev(p, `T.step(10)`); await shot(p, 'bug-' + id);
    res[id].on = await ev(p, `T.measure()`);
    res[id].cure = await ev(p, `T.cure('${id}')`);
    await ev(p, 'T.step(10)'); res[id].off = await ev(p, `T.measure()`);
  }
  await ev(p, `T.patch('post.hsync'); T.patch('post.swap'); T.patch('post.ghost'); T.set({crt:false}); T.step(5)`); await shot(p, 'bug-all-crtoff');
  await ev(p, `T.cure('post.hsync'); T.cure('post.swap'); T.cure('post.ghost'); T.set({crt:true}); T.step(5)`); await shot(p, 'bug-cured');
  // a broken patch must keep the old program
  res.broken = await ev(p, `const s = T.stats(); const f0 = s.fails; T.livepatch('post.frag', 'GAIN=1.04;', 'GAIN=1.04; const _x=1;'); T.livepatch('post.frag', 'gl_FragColor = vec4(', 'gl_FragColor = vec4(nope+'); T.step(3); ({fails: s.fails - f0, src: T.src('post.frag').includes('nope')})`);
  await shot(p, 'broken-patch-kept');
  res.stats = await ev(p, 'T.stats()');
  await p.close();
  // context loss / restore
  const pl = await page(960, 540, 1);
  res.ctxloss = await ev(pl, `(async () => { T.pat('orient'); const ext = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
    ext.loseContext(); await new Promise(r => setTimeout(r, 100)); T.step(3); ext.restoreContext(); await new Promise(r => setTimeout(r, 200)); T.step(3); return T.measure(); })()`);
  await shot(pl, 'ctx-restored'); await pl.close();
  // forced 2D fallback
  for (const [w, h] of [[960, 540], [390, 844]]) {
    const p2 = await page(w, h, 1, '?nogl');
    res['2d' + w] = { mode: await ev(p2, 'T.mode()') };
    await ev(p2, `T.pat('orient'); T.step(2)`); await shot(p2, `2d-${w}-orient`);
    res['2d' + w].orient = await ev(p2, 'T.measure()');
    await ev(p2, `T.pat('game'); T.step(2, 1/60, {glitch:.5, shake:4, flash:.3})`); await shot(p2, `2d-${w}-fx`);
    res['2d' + w].cpu = await ev(p2, `T.set({glitch:0,shake:0,flash:0}); T.raf(60)`);
    await p2.close();
  }
  console.log(JSON.stringify(res, null, 1));
  console.log(errs ? `FAIL: ${errs} console errors` : 'OK: no console errors');
  await b.close();
})();
