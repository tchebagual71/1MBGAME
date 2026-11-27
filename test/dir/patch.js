// real main loop + real UI 'patch' scene: clear waves by killing enemies, pick patches with the keyboard
const path = require('path'), { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  let errs = 0; pg.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message); });
  await pg.goto('file://' + path.join(__dirname, 'out.html')); await pg.waitForTimeout(500);
  await pg.evaluate(() => { const SM = window.__SM; SM.LIVE.def('test.ns', '', 'return { DIR, GAME, T_ENEMY }'); window.NS = SM.LIVE.fn['test.ns'](); SM.RUN.start(); });
  const seen = [];
  for (let i = 0; i < 90; i++) {
    const st = await pg.evaluate(() => { const { S, ENT } = window.__SM, { DIR, T_ENEMY } = window.NS; S.player.hp = S.player.maxhp;
      ENT.each(T_ENEMY, e => { if (e.age > 1) ENT.kill(e, null); }); return S.mode + ':' + DIR.state.phase + ':' + S.wave; });
    if (seen[seen.length - 1] !== st) seen.push(st);
    if (st.startsWith('patch')) { await pg.waitForTimeout(600); if (i === 20) await pg.screenshot({ path: path.join(__dirname, 'shots/patch.png') }); await pg.keyboard.press('Digit1'); await pg.waitForTimeout(300); await pg.keyboard.press('Enter'); }
    await pg.waitForTimeout(500);
  }
  console.log(seen.join(' | ')); console.log(errs ? 'FAIL' : 'OK'); await b.close();
})();
