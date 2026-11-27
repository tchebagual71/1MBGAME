#!/usr/bin/env node
// Long soak: title FX cycling, play across sectors via the real patch UI, RUN.start x30, die/retry, win flow.
// Asserts bounded entity/particle/voice/handler/timer counts, flat heap, capped LIVE.log, no errors.
// Usage: node test/qa-robust/soak.js [html=index.html] [minutesScale=1]
const path = require('path');
const { ROOT, launch, collect } = require('./lib');
const FILE = process.argv[2] || 'index.html', SCALE = +(process.argv[3] || 1);

(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript(() => { const T = window.__T = { to: new Set(), iv: new Set(), raf: 0 }; const st = setTimeout, ct = clearTimeout, si = setInterval, ci = clearInterval;
    window.setTimeout = (f, ms, ...a) => { const id = st(() => { T.to.delete(id); typeof f === 'function' ? f(...a) : 0; }, ms); T.to.add(id); return id; }; window.clearTimeout = id => { T.to.delete(id); ct(id); };
    window.setInterval = (f, ms, ...a) => { const id = si(f, ms, ...a); T.iv.add(id); return id; }; window.clearInterval = id => { T.iv.delete(id); ci(id); }; });
  const page = await ctx.newPage(); const errs = collect(page); const cdp = await ctx.newCDPSession(page);
  await page.goto('file://' + path.join(ROOT, FILE)); await page.waitForFunction(() => window.__SM && window.__SM.S.frame > 3);
  await page.mouse.click(480, 270);   // gesture -> audio on
  await page.evaluate(() => {
    const M = window.__SM, { S, LIVE, PATCH, SCENE, IN, AU, UI, DIR, ENT, BUS, RUN, GFX } = M;
    const H = window.__H = { throws: [], panics: 0, frames: 0, ms: 0, scenes: {} };
    BUS.on('panic', () => H.panics++); BUS.on('scene', n => H.scenes[n] = (H.scenes[n] || 0) + 1);
    H.step = (n, o) => { o = o || {}; const dt = 1 / 60, t0 = performance.now();
      for (let i = 0; i < n; i++) { S.dt = dt; S.t += dt; S.frame++; H.frames++;
        S.shake = S.shake > .05 ? S.shake * Math.pow(.002, dt) : 0; S.flash = S.flash > .01 ? S.flash * Math.pow(.001, dt) : 0;
        IN.poll(); if (o.god && S.player && !S.player.dead) S.player.hp = S.player.maxhp;
        if (o.cull && S.mode === 'play' && (H.frames % 90) === 0) ENT.each(1, e => { if (!e.boss && e.warp <= 0) ENT.damage(e, 1e4, null); });
        if (S.mode === 'patch' && o.pick && (H.frames % 50) === 0) IN._hq.Digit1 = 1;
        try { AU.update(dt); SCENE.cur.update(dt); SCENE.cur.draw(dt); UI.overlay(dt); }
        catch (e) { H.throws.push(String(e && e.message || e) + ' @' + S.mode); LIVE.panic(e); }
        if (i % 8 === 0) M.POST.present(dt); }
      H.ms += performance.now() - t0; };
    H.metrics = () => { let bus = 0; for (const k in BUS._h) bus += BUS._h[k].length;
      return { mode: S.mode, ent: ENT.list.length, parts: GFX.pCount(), voices: AU._dev.voices, jobs: AU._dev.jobs, bus, log: LIVE.log.length, active: PATCH.active.length,
        to: window.__T.to.size, iv: window.__T.iv.size, dom: document.getElementsByTagName('*').length, frames: H.frames }; };
  });
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); return Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1024 / 1024 * 10) / 10; };
  const S = n => Math.max(60, Math.round(n * SCALE));
  const step = (n, o) => page.evaluate(([n, o]) => { for (let k = 0; k < n; k += 600) window.__H.step(Math.min(600, n - k), o); }, [n, o || {}]);
  const ev = f => page.evaluate(f);
  const samples = [];
  const sample = async (tag) => { const m = await page.evaluate(() => window.__H.metrics()); m.heapMB = await heap(); m.tag = tag; samples.push(m); console.log(tag.padEnd(22), JSON.stringify(m)); return m; };
  const t0 = Date.now();
  await sample('start');
  // 1) title, FX cycling — 2 min
  await ev(() => window.__SM.SCENE.go('title')); for (let i = 0; i < 4; i++) await step(S(1800)); await sample('title 2min');
  // 2) campaign across sectors with the real patch UI — 8 min
  await ev(() => window.__SM.RUN.start());
  for (let s = 0; s < 6; s++) { await ev(`window.__SM.DIR.debug.skipTo(${s}, 0)`); await step(S(3600), { god: true, cull: true, pick: true });
    await ev(() => { const M = window.__SM; if (M.S.mode !== 'play') M.SCENE.go('play'); }); await ev(`window.__SM.DIR.debug.skipTo(${s}, 99)`); await step(S(1200), { god: true, cull: true, pick: true });
    await ev(() => { const M = window.__SM; M.DIR.debug.kill(); }); await step(S(600), { god: true, cull: true, pick: true }); }
  await sample('campaign 8min');
  // 3) RUN.start x30 — ~5 min
  for (let i = 0; i < 30; i++) { await ev(`(()=>{const M=window.__SM;M.RUN.start();M.DIR.debug.skipTo(${i % 6},${i % 4});})()`); await step(S(600), { god: true }); }
  await sample('RUN.start x30');
  // 4) die / retry x12 — ~3 min
  for (let i = 0; i < 12; i++) { await ev(`(()=>{const M=window.__SM;M.RUN.start();M.DIR.debug.skipTo(${i % 6},1);})()`); await step(S(300)); for (let k = 0; k < 6; k++) { await ev(() => { const M = window.__SM, p = M.S.player; if (p && !p.dead) { p.inv = 0; p.hp = 1; for (let j = 0; j < 4; j++) M.GAME.shoot(p.x, p.y, 0, 0, { team: 3, dmg: 9, r: 6 }); } }); await step(20); }
    await step(S(400)); const m = await ev(() => window.__SM.S.mode); if (m !== 'over') console.log('  die', i, 'mode', m); await ev(() => { window.__SM.IN._hq.Enter = 1; }); await step(S(200)); }
  await sample('die/retry x12');
  // 5) win flow x3 — ~3 min
  for (let i = 0; i < 3; i++) { await ev(() => { const M = window.__SM; M.RUN.start(); M.DIR.debug.boss('kernel'); }); await step(S(600), { god: true });
    for (let k = 0; k < 8 && (await ev(() => window.__SM.S.mode)) !== 'win'; k++) { await ev(() => { const M = window.__SM; if (M.S.mode === 'patch') M.SCENE.go('play'); M.DIR.debug.kill(); }); await step(S(300), { god: true, cull: true }); }
    const m = await ev(() => window.__SM.S.mode); if (m !== 'win') console.log('  win flow', i, 'ended in', m); await step(S(1800)); await ev(() => window.__SM.SCENE.go('title')); await step(S(600)); }
  await sample('win x3');
  // 6) repeat the whole cycle once more to see growth between two identical states
  await ev(() => window.__SM.SCENE.go('title')); await step(S(3600)); for (let i = 0; i < 30; i++) { await ev(() => window.__SM.RUN.start()); await step(S(300), { god: true, cull: true, pick: true }); }
  await ev(() => window.__SM.SCENE.go('title')); await step(S(600));
  const end = await sample('cycle 2 (title)');
  const res = await ev(() => ({ throws: window.__H.throws, panics: window.__H.panics, ms: window.__H.ms, frames: window.__H.frames, scenes: window.__H.scenes }));
  const simMin = res.frames / 3600;
  console.log(`simulated ${simMin.toFixed(1)} min (${res.frames} frames, ${(res.ms / res.frames).toFixed(2)} ms/frame avg) in ${((Date.now() - t0) / 1000).toFixed(0)} s wall; scenes ${JSON.stringify(res.scenes)}`);
  const max = k => Math.max(...samples.map(s => s[k]));
  const fails = [];
  if (res.throws.length) fails.push('throws: ' + [...new Set(res.throws)].slice(0, 6).join(' ; '));
  if (res.panics) fails.push('panics: ' + res.panics);
  if (errs.length) fails.push('console: ' + errs.slice(0, 5).join(' || '));
  if (max('bus') !== samples[0].bus) fails.push('BUS handlers grew ' + samples[0].bus + ' -> ' + max('bus'));
  if (max('log') > 64) fails.push('LIVE.log > 64');
  if (max('voices') > 28) fails.push('voices > 28');
  if (max('to') > 8 || max('iv') > 0) fails.push('timers ' + max('to') + '/' + max('iv'));
  if (max('dom') > samples[0].dom + 2) fails.push('DOM grew');
  if (max('ent') > 400) fails.push('entities ' + max('ent'));
  const h1 = samples.find(s => s.tag === 'title 2min').heapMB; if (end.heapMB > h1 * 1.25 + 4) fails.push(`heap grew ${h1} -> ${end.heapMB} MB`);
  console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'ALL PASS'); await b.close(); process.exit(fails.length ? 1 : 0);
})();
