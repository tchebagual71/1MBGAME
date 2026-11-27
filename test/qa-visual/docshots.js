#!/usr/bin/env node
// node test/qa-visual/docshots.js [html=dist/dev.html] -> docs/shots/*.png (960x540, CRT on): curated screenshots of the real build
const path = require('path'), fs = require('fs'); const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(ROOT, 'docs', 'shots'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(ROOT, process.argv[2] || 'dist/dev.html')); await p.waitForFunction(() => window.__SM && window.__SM.S);
  const ev = (f, a) => p.evaluate(f, a), wait = s => p.waitForTimeout(s * 1000), shot = n => p.screenshot({ path: path.join(OUT, n + '.png') });
  const god = () => ev(() => { if (!window.__g) window.__g = setInterval(() => { const q = window.__SM.S.player; if (q) { q.inv = Math.max(q.inv, .3); q.hurtT = 0; q.hp = q.maxhp; } }, 30); });
  const start = async (s, w, fx) => { await ev(([s, w]) => { const M = window.__SM; M.SCENE.go('title'); M.RUN.start(); M.DIR.debug.skipTo(s, w); }, [s, w]); await god(); };
  // aim + fire like a player: track the nearest enemy
  const play = () => ev(() => { if (window.__a) return; window.__a = setInterval(() => { const M = window.__SM, q = M.S.player; if (!q) return; const e = M.ENT.nearest(q.x, q.y, 1); M.IN._mb = 1; M.IN.mode = 'mouse';
    if (e) { M.IN.mx = e.x; M.IN.my = e.y; } }, 50); });
  await wait(1.5);
  await ev(() => window.__SM.SCENE.go('title')); await wait(2.6); await shot('01-title');
  await start(1, 2); await play(); await wait(9); await shot('02-fight-heap');
  await start(4, 1); await wait(9); await shot('03-fight-swapspace');
  await ev(() => { const M = window.__SM; M.DIR.debug.boss('irq'); }); await wait(6.5); await shot('04-boss-irq');
  await ev(() => { const M = window.__SM; M.DIR.debug.boss('kernel'); }); await wait(5); await ev(() => window.__SM.DIR.debug.phase(1)); await wait(3.2); await shot('05-boss-kernel');
  await ev(() => { const M = window.__SM; M.DIR.debug.skipTo(2, 1); }); await wait(5);
  await ev(() => window.__SM.SCENE.go('patch', { picks: 1 })); await wait(1.2); await shot('06-patch-cards');
  await p.keyboard.press('Digit1'); await wait(.62); await shot('07-patch-diff');
  await wait(3);
  await ev(() => { clearInterval(window.__g); window.__g = 0; const M = window.__SM; M.S.score = 1234560; const q = M.S.player; q.inv = 0; q.hp = 1; M.GAME.hurtPlayer(5, null); }); await wait(3.6); await shot('08-game-over');
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'ok: ' + fs.readdirSync(OUT).join(' ')); await b.close();
})();
