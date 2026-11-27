#!/usr/bin/env node
// Build + headless boot smoke of BOTH dist/dev.html and index.html (plus index.html via the JS-inflate fallback).
// Drives boot -> title -> play with real input events, then pause/resume, and fails on ANY console error / page error.
// Usage: node tools/check.js [--full]    (--full also runs the test/qa-robust suite)
'use strict';
const path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const run = (args, label) => { const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' }); if (r.status !== 0) { console.error(`CHECK FAILED: ${label} (exit ${r.status})`); process.exit(1); } };

run(['tools/build.js'], 'build');

let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.error('CHECK FAILED: playwright not available'); process.exit(1); }
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function smoke(b, file, label, init) {
  const ctx = await b.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 300)); });
  p.on('crash', () => errs.push('page crashed'));
  const t0 = Date.now(); let state = null;
  try {
    await p.goto('file://' + path.join(root, file));
    await p.waitForFunction(() => window.__SM && window.__SM.S.frame > 5, null, { timeout: 20000 });
    await p.mouse.click(480, 270); await sleep(300);                                  // gesture: audio init, skip boot
    for (let i = 0; i < 20 && (await p.evaluate(() => window.__SM.S.mode)) !== 'title'; i++) { await p.keyboard.press('Enter'); await sleep(250); }
    await p.keyboard.press('Enter'); await sleep(800);                                // START
    if ((await p.evaluate(() => window.__SM.S.mode)) !== 'play') await p.evaluate(() => window.__SM.RUN.start());
    await p.keyboard.down('KeyD'); await p.mouse.move(700, 200); await p.mouse.down(); await sleep(1200); await p.mouse.up(); await p.keyboard.up('KeyD');
    await p.keyboard.press('Space'); await sleep(300);
    await p.keyboard.press('Escape'); await sleep(300); const paused = await p.evaluate(() => window.__SM.S.mode);
    await p.keyboard.press('Escape'); await sleep(300);
    await p.evaluate(() => { const M = window.__SM; M.DIR.debug.skipTo(2, 1); M.PATCH.apply('fork'); M.PATCH.infect(); }); await sleep(1200);
    state = await p.evaluate(() => { const M = window.__SM; return { mode: M.S.mode, frame: M.S.frame, post: M.POST.mode, audio: M.AU.ready, err: M.S.err ? String(M.S.err) : null }; });
    state.paused = paused;
    if (state.err) errs.push('S.err: ' + state.err);
    if (paused !== 'pause') errs.push('Escape did not pause (mode ' + paused + ')');
    if (!/play|patch|pause/.test(state.mode)) errs.push('unexpected mode ' + state.mode);
  } catch (e) { errs.push('driver: ' + e.message.split('\n')[0]); }
  await ctx.close();
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${label.padEnd(34)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${state ? JSON.stringify(state) : ''}`);
  for (const e of errs) console.log('     ' + e);
  return errs.length;
}

(async () => {
  const b = await chromium.launch({ args: ARGS }); let bad = 0;
  bad += await smoke(b, 'dist/dev.html', 'dist/dev.html');
  bad += await smoke(b, 'index.html', 'index.html');
  bad += await smoke(b, 'index.html', 'index.html (no DecompressionStream)', 'window.DecompressionStream = undefined;');
  await b.close();
  if (bad) { console.error(`CHECK FAILED: ${bad} problem(s)`); process.exit(1); }
  if (process.argv.includes('--full')) {
    for (const t of ['inflate.js', 'boot.js', 'lifecycle.js', 'genome.js', 'fuzz.js']) run(['test/qa-robust/' + t], t);
  }
  console.log('CHECK OK');
})();
