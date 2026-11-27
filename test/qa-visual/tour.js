#!/usr/bin/env node
// Visual QA tour of the INTEGRATED build.
//   node test/qa-visual/tour.js [html=dist/dev.html] [configs=d960,d960n,d1080,phL,phP] [filter-regex]
// Screenshots -> test/qa-visual/shots/<config>/<name>.png. Prints page errors. Look at every image.
const path = require('path'), fs = require('fs'); const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..');
const html = path.resolve(ROOT, process.argv[2] || 'dist/dev.html');
const CFG = {
  d960: { viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, crt: true, full: true },
  d960n: { viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, crt: false, full: true },
  d1080: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, crt: true },
  d1080n: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, crt: false },
  phL: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, crt: true, touch: true },
  phP: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, crt: true, touch: true },
};
const want = (process.argv[3] || 'd960,d960n,d1080,phL,phP').split(',');
const filt = process.argv[4] ? new RegExp(process.argv[4]) : null;

// in-page helpers (installed once per page)
const HELP = `(() => { const M = window.__SM; window.__Q = {
  god() { if (window.__godI) return; window.__godI = setInterval(() => { const p = M.S.player; if (p) { p.inv = Math.max(p.inv, 0.3); p.hurtT = 0; if (p.hp < p.maxhp) p.hp = p.maxhp; } }, 30); },
  fire(on, x, y) { M.IN._mb = on ? 1 : 0; if (x != null) { M.IN.mx = x; M.IN.my = y; M.IN.mode = 'mouse'; } },
  pop(nE, nB, types) {
    const G = M.GAME, T = types || G.enemyTypes.filter(t => t !== 'mutator' && t !== 'shard'), p = M.S.player || { x: 240, y: 150 };
    for (let i = 0; i < nE; i++) { let x, y, k = 0; do { x = 30 + Math.random() * 420; y = 34 + Math.random() * 216; } while (Math.hypot(x - p.x, y - p.y) < 60 && k++ < 20);
      const e = G.spawnEnemy(T[i % T.length], x, y, { warp: 0 }); }
    for (let i = 0; i < nB; i++) { const x = 20 + Math.random() * 440, y = 26 + Math.random() * 230, a = Math.random() * 6.283, s = 10 + Math.random() * 25;
      if (Math.hypot(x - p.x, y - p.y) < 30) continue;
      G.shoot(x, y, Math.cos(a) * s, Math.sin(a) * s, { team: M.T_ESHOT || 3, kind: i % 6 === 0 ? 'needle' : 'orb', r: i % 9 === 0 ? 4 : 2, life: 20 }); }
  },
  particles(n) { for (let i = 0; i < n / 50; i++) M.GFX.burst(40 + Math.random() * 400, 40 + Math.random() * 200, 50, M.GFX.hsv(Math.random(), .7, 1), 80, 3); },
  bits(n) { for (let i = 0; i < n / 10; i++) M.GAME.dropBits(40 + Math.random() * 400, 40 + Math.random() * 200, 10); },
  quiet() { M.ENT.each(1, e => { e.dead = true; }); M.ENT.each(3, e => { e.dead = true; }); },
}; })()`;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  let errsTotal = 0;
  for (const cn of want) {
    const cfg = CFG[cn]; if (!cfg) { console.log('unknown config', cn); continue; }
    const dir = path.join(__dirname, 'shots', cn); fs.mkdirSync(dir, { recursive: true });
    const ctx = await b.newContext({ viewport: cfg.viewport, deviceScaleFactor: cfg.deviceScaleFactor, hasTouch: !!cfg.hasTouch, isMobile: !!cfg.isMobile });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
    await p.goto('file://' + html);
    await p.waitForFunction(() => window.__SM && window.__SM.S, null, { timeout: 15000 });
    await p.evaluate(HELP);
    const ev = (f, a) => p.evaluate(f, a), wait = s => p.waitForTimeout(s * 1000);
    const shot = async n => { if (filt && !filt.test(n)) return; await p.screenshot({ path: path.join(dir, n + '.png') }); process.stdout.write('.'); };
    const run = async (n, fn) => { if (filt && !filt.test(n) && !fn.always) return; try { await fn(); } catch (e) { errs.push('TOUR ' + n + ': ' + e.message.split('\n')[0]); } };
    await ev(c => { window.__SM.S.opt.crt = c; }, cfg.crt);
    if (cfg.touch) await ev(() => { window.__SM.IN.touch = true; });
    const start = async () => { await ev(() => { const M = window.__SM; M.SCENE.go('title'); M.RUN.start(); __Q.god(); }); await wait(.3); };
    const tap = async (fx, fy) => { // tap at fb coords
      const r = await ev(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
      await p.touchscreen.tap(r[0] + fx / 480 * r[2], r[1] + fy / 270 * r[3]); };

    await run('01-boot', async () => { await wait(.5); await shot('01-boot'); await wait(1.2); await shot('02-boot-link'); });
    await run('03-title', async () => {
      await ev(() => window.__SM.SCENE.go('title')); await wait(.35); await shot('03-title-drop'); await wait(1.4); await shot('04-title');
      await wait(2.3); await shot('05-title-b'); if (cfg.full) { await wait(5); await shot('06-title-c'); }
    });
    if (cfg.full) await run('07-title-gen', async () => {
      await ev(() => { const M = window.__SM; M.S.genome = { gen: 3, ids: Object.keys(M.PATCH.all).filter(k => M.PATCH.all[k].kind === 'up').slice(0, 3), hi: 0 }; M.S.hi = 1234567; M.SCENE.go('title'); });
      await wait(1.6); await shot('07-title-gen'); await ev(() => { window.__SM.S.genome = { gen: 0, ids: [], hi: 0 }; });
    });
    await run('08-howto', async () => { await ev(() => { const M = window.__SM; M.SCENE.go('title'); }); await wait(1); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await wait(.5); await shot('08-howto'); await p.keyboard.press('KeyQ'); await wait(.2); });

    // sectors: both FX backgrounds, realistic fight
    const nsec = cfg.full ? 7 : 2;
    for (let s = 0; s < nsec; s++) await run('10-sec' + s, async () => {
      await start();
      await ev(s => { const M = window.__SM; if (s < 6) M.DIR.debug.skipTo(s, 1); else M.DIR.debug.skipTo(s, 0); }, s);
      await wait(4.4);   // let the sector + wave banners pass
      const fxs = await ev(s => window.__SM.DIR.sectors[s].fx, s);
      for (let k = 0; k < 2; k++) {
        if (s === 6 && k === 1) break;
        await ev(([n]) => { const M = window.__SM; M.FX.set(n, 0); M.FX.dim = .38; __Q.quiet(); if (M.S.boss == null) __Q.pop(26, 90); __Q.fire(true, 340, 90); }, [fxs[k]]);
        await wait(1.6); await shot('10-sec' + s + '-' + fxs[k]);
      }
      await ev(() => __Q.fire(false));
    });
    if (cfg.full) await run('11-heavy', async () => { await start(); await ev(() => { window.__SM.DIR.debug.skipTo(3, 2); __Q.quiet(); __Q.pop(60, 300); __Q.particles(2500); __Q.bits(120); __Q.fire(true, 120, 200); }); await wait(.5); await shot('11-heavy'); await ev(() => __Q.fire(false)); });

    // bosses x phases
    const bosses = cfg.full ? ['boot', 'malloc', 'stack', 'irq', 'gc', 'twin', 'kernel'] : ['boot', 'kernel'];
    for (const bn of bosses) await run('20-boss-' + bn, async () => {
      await start(); await ev(bn => { window.__SM.DIR.debug.boss(bn); __Q.quiet(); }, bn);
      await wait(.45); await shot('20-boss-' + bn + '-warn-banner');
      await wait(2.9); await ev(() => __Q.fire(true, 240, 80)); await wait(1.2); await shot('20-boss-' + bn + '-p1');
      const nph = await ev(() => { const st = window.__SM.DIR.state; return st.boss ? window.__SM.DIR.bosses[st.bossKey].ph.length : 0; });
      for (let k = 1; k <= (cfg.full ? nph : 1); k++) {
        await ev(k => window.__SM.DIR.debug.phase(k), k); await wait(.45); await shot('20-boss-' + bn + '-p' + (k + 1) + 'a-banner'); await wait(2); await shot('20-boss-' + bn + '-p' + (k + 1));
      }
      await ev(() => __Q.fire(false));
    });

    // HUD: boss bar + bugs + ticker
    await run('30-hud', async () => {
      await start(); await ev(() => { const M = window.__SM; M.DIR.debug.skipTo(1, 2); __Q.pop(14, 40); M.S.score = 1234560; M.S.combo = 23; M.S.mult = 4; });
      await wait(2.6); await ev(() => { const M = window.__SM; M.PATCH.apply('fx.hsync'); M.PATCH.apply('uiScramble'); }); await wait(.35); await shot('30-hud-ticker-bugs');
      await ev(() => { const M = window.__SM; M.S.boss = { hp: 600, maxhp: 1000, name: 'GARBAGE COLLECTOR', dead: false }; M.S.player.hp = 1; }); await wait(.4); await shot('31-hud-boss-lowhp');
      await ev(() => { const M = window.__SM; M.PATCH.apply('uiMirror'); M.S.glitch = .8; }); await wait(.3); await shot('32-hud-mirror-glitch');
      await ev(() => { const M = window.__SM; M.S.boss = null; M.PATCH.cure('uiMirror'); M.PATCH.cure('uiScramble'); M.PATCH.cure('fx.hsync'); M.UI.banner('SECTOR 2', 'HEAP // DYNAMIC ALLOCATION'); }); await wait(.15); await shot('33-banner-in'); await wait(.6); await shot('34-banner');
      await ev(() => window.__SM.BUS.emit('panic', new Error('x is not a function'), { name: 'wpn.fire' })); await wait(.4); await shot('35-panic-toast');
      await ev(() => { const M = window.__SM; M.PATCH.apply('fx.vroll'); M.PATCH.cure('fx.vroll'); }); await wait(.3); await shot('36-cure-toast');
    });
    if (cfg.touch) await run('37-sticks', async () => {
      await start(); await ev(() => { const M = window.__SM; M.DIR.debug.skipTo(0, 1); M.IN.touch = true; }); await wait(2.6);
      await ev(() => { const M = window.__SM; Object.assign(M.IN.sticks[0], { on: true, ox: 70, oy: 215, x: 88, y: 205 }); Object.assign(M.IN.sticks[1], { on: true, ox: 400, oy: 200, x: 385, y: 180 }); });
      await wait(.4); await shot('37-touch-sticks');
      await ev(() => { const M = window.__SM; M.IN.sticks[0].on = false; M.IN.sticks[1].on = false; }); await wait(.2); await shot('38-touch-idle');
    });

    // visual bug patches
    if (cfg.full) {
      const vb = await ev(() => Object.keys(window.__SM.PATCH.all).filter(k => { const q = window.__SM.PATCH.all[k]; return q.kind === 'bug' && /^(fx\.|post\.|ui)/.test(k); }));
      for (const id of vb) await run('40-bug-' + id, async () => {
        await start(); await ev(() => { window.__SM.DIR.debug.skipTo(2, 1); }); await wait(4.4); await ev(() => { __Q.pop(20, 60); __Q.fire(true, 300, 100); });
        await ev(id => window.__SM.PATCH.apply(id), id); await wait(.8); await shot('40-bug-' + id);
        await ev(id => { window.__SM.PATCH.cure(id); __Q.fire(false); }, id);
      });
    }

    // patch screen
    await run('50-patch', async () => {
      await start(); await ev(() => { window.__SM.DIR.debug.skipTo(1, 1); __Q.pop(10, 30); }); await wait(1.5);
      await ev(() => window.__SM.SCENE.go('patch', { picks: 2 })); await wait(.25); await shot('50-patch-in'); await wait(.7); await shot('51-patch-cards');
      if (!cfg.touch) { await p.mouse.move(480 * cfg.viewport.width / 960, 160 * cfg.viewport.height / 540); await wait(.4); await shot('52-patch-hover'); }
      if (cfg.touch) { await tap(240, 80); await wait(.3); await shot('52-patch-tap1'); await tap(240, 80); }
      else await p.keyboard.press('Digit2');
      await wait(.3); await shot('53-diff-open'); await wait(.45); await shot('54-diff-typing'); await wait(.5); await shot('55-diff-ok');
      await wait(1.4); await shot('56-patch-pick2');
      // pick a patch with a long source line and multiple entries if any
      await p.keyboard.press('Digit3'); await wait(.7); await shot('57-diff2');
      await wait(2.5);
    });
    if (cfg.full) await run('58-diffs', async () => { // cycle several random offers through the diff screen
      await start();
      for (let i = 0; i < 8; i++) {
        await ev(() => window.__SM.SCENE.go('patch')); await wait(.6);
        await p.keyboard.press('Digit' + (1 + i % 3)); await wait(.8); await shot('58-diff-' + i);
        await wait(2.4); if (await ev(() => window.__SM.S.mode) === 'patch') { await p.keyboard.press('Enter'); await wait(.2); await p.keyboard.press('Enter'); await wait(.2); }
      }
    });

    await run('60-pause', async () => { await start(); await ev(() => { window.__SM.DIR.debug.skipTo(2, 1); __Q.pop(18, 40); for (const id of ['fork', 'rate', 'pierce', 'homing', 'crit']) window.__SM.PATCH.apply(id); window.__SM.PATCH.apply('uiScramble'); }); await wait(1.2);
      await ev(() => window.__SM.SCENE.go('pause')); await wait(1.2); await shot('60-pause'); await ev(() => window.__SM.SCENE.go('play')); });
    await run('70-over', async () => { await start(); await ev(() => { const M = window.__SM; M.DIR.debug.skipTo(3, 1); __Q.pop(18, 50); M.S.score = 345670; }); await wait(1.5);
      await ev(() => { clearInterval(window.__godI); window.__godI = 0; const p = window.__SM.S.player; p.inv = 0; p.hp = 1; window.__SM.GAME.hurtPlayer(5, null); }); await wait(.5); await shot('70-death');
      await wait(1.6); await shot('71-over-in'); await wait(1.2); await shot('72-over'); });
    await run('75-win', async () => { await ev(() => { const M = window.__SM; M.S.score = 2345670; M.SCENE.go('win'); }); await wait(2.5); await shot('75-win'); await wait(4); await shot('76-win-b'); });
    if (cfg.touch) await run('80-tapmenu', async () => { await ev(() => window.__SM.SCENE.go('title')); await wait(1.5); await tap(240, 140); await wait(.4); await shot('80-tap-howto'); await tap(240, 140); await wait(.3); await tap(240, 113); await wait(.6); const m = await ev(() => window.__SM.S.mode); console.log('\n  tap START ->', m); await shot('81-after-tap-start'); });

    console.log('\n' + cn + ': ' + (errs.length ? errs.length + ' error(s)\n  ' + errs.slice(0, 8).join('\n  ') : 'no errors'));
    errsTotal += errs.length; await ctx.close();
  }
  await b.close(); process.exit(errsTotal ? 1 : 0);
})();
