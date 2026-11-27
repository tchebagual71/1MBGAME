#!/usr/bin/env node
// node test/game/run.js  -> builds, runs all GAME tests, writes screenshots to test/game/shots/
const path = require('path'), fs = require('fs'), cp = require('child_process'); const { chromium } = require('playwright');
cp.execSync('node ' + path.join(__dirname, 'build.js'), { stdio: 'inherit' });
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { fails++; console.log('PAGEERROR', e.message); });
  page.on('console', m => { if (m.type() === 'error') { fails++; console.log('CONSOLE', m.text()); } });
  await page.goto('file://' + path.join(__dirname, 'out.html'));
  await page.addScriptTag({ path: path.join(__dirname, 'sim.js') });
  await page.waitForTimeout(300);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async n => { await ev(() => window.__G.POST.present()); await page.screenshot({ path: path.join(shots, n + '.png') }); };
  const sim = (n, o) => ev(([n, o]) => window.__sim(n, o), [n, o || {}]);
  const clean = r => r.errs.length === 0 && r.nan === 0;

  await ev(() => { const { RUN, S } = window.__SM; RUN.start(); });
  // 1. long normal play
  let r = await sim(60 * 60, {}); await shot('fight1');
  console.log(JSON.stringify(r)); ok(clean(r), 'normal 60s: no errors / NaN');
  r = await sim(60 * 120, {}); console.log(JSON.stringify(r)); ok(clean(r), 'normal 120s more');
  ok(r.maxEnt < 1500 && r.maxEs <= 520 && r.maxP <= 460, 'entity counts bounded');
  // 2. each type killable
  for (const t of await ev(() => window.__G.GAME.enemyTypes)) {
    r = await ev(([t]) => { const { RUN } = window.__SM; RUN.start(); const D = window.__G.DIR; D.only = [t]; D.max = 5; const o = window.__sim(60 * 25, { god: true, aggro: true }); D.only = null; D.max = 24; return o; }, [t]);
    ok(clean(r) && (r.kills[t] || 0) > 0, 'kill ' + t + ' x' + (r.kills[t] || 0) + (r.errs.length ? ' ' + r.errs[0] : ''));
  }
  // 3. death
  r = await ev(() => { const { RUN } = window.__SM; RUN.start(); const D = window.__G.DIR; D.max = 40; const o = window.__sim(60 * 90, { passive: true, fire: false, stopOnOver: true }); D.max = 24; return o; });
  ok(r.died, 'player can die (passive bot) ' + JSON.stringify(r.kills));
  // 4. every patch individually + stack to max
  const ids = await ev(() => Object.keys(window.__SM.PATCH.all));
  const own = await ev(() => { const { PATCH, LIVE } = window.__SM; return Object.values(PATCH.all).map(p => ({ id: p.id, kind: p.kind, max: p.max, name: p.name, desc: p.desc })); });
  console.log('patches:', own.filter(p => p.kind === 'up').length, 'ups,', own.filter(p => p.kind === 'bug').length, 'bugs');
  for (const P of own) {
    r = await ev(([id]) => { const { RUN, PATCH, LIVE } = window.__SM; RUN.start(); const p = PATCH.all[id]; const res = [];
      for (let i = 0; i < p.max; i++) { const before = JSON.stringify(LIVE.src); const a = PATCH.apply(id); res.push(a && JSON.stringify(LIVE.src) !== before); }
      const D = window.__G.DIR; D.only = window.__G.GAME.enemyTypes.filter(t => t !== 'mutator');
      const o = window.__sim(60 * 12, { god: true, dashSpam: true }); D.only = null; o.res = res; o.active = PATCH.active.length;
      const diffSrc = Object.keys(LIVE.src).filter(k => LIVE.src[k] !== LIVE._d[k].base);
      PATCH.cure(id); o.cured = Object.keys(LIVE.src).every(k => LIVE.src[k] === LIVE._d[k].base); o.changed = diffSrc; return o; }, [P.id]);
    ok(clean(r) && r.res.every(x => x) && r.cured && r.panics === 0, `patch ${P.id} (${P.name}) x${P.max} -> ${r.changed.join(',')} ${r.res} ${r.errs.slice(0, 2).join(' | ')}`);
  }
  // 5. everything at once
  r = await ev(() => { const { RUN, PATCH, LIVE } = window.__SM; RUN.start(); let n = 0;
    for (const p of Object.values(PATCH.all)) for (let i = 0; i < p.max; i++) if (PATCH.apply(p.id)) n++;
    const o = window.__sim(60 * 40, { god: true }); o.applied = n; return o; });
  console.log(JSON.stringify(r)); ok(clean(r) && r.panics === 0, 'all patches stacked, 40s sim, ' + r.ms.toFixed(2) + ' ms/frame');
  await shot('allpatches');
  r = await ev(() => { const { PATCH, LIVE } = window.__SM; for (const id of PATCH.bugs()) PATCH.cure(id);
    const bad = Object.keys(LIVE._d).filter(k => LIVE._d[k].p.some(p => PATCH.all[p.tag] && PATCH.all[p.tag].kind === 'bug'));
    const o = window.__sim(60 * 20, { god: true, aggro: true }); o.bad = bad; o.bugsLeft = PATCH.bugs().length; return o; });
  ok(clean(r) && r.bad.length === 0 && r.bugsLeft === 0, 'cure all bugs keeps ups intact');
  await shot('ups_only');
  // 6. reset + genome
  r = await ev(() => { const { RUN, PATCH, LIVE, S } = window.__SM; S.genome = { gen: 1, ids: ['fork', 'rate', 'orbit', 'hp'], hi: 0 }; RUN.start();
    const o = { active: PATCH.active.slice(), hp: S.player.hp, maxhp: S.player.maxhp, src: LIVE.src['wpn.fire'] }; S.genome = { gen: 0, ids: [], hi: 0 }; RUN.start();
    o.clean = Object.keys(LIVE.src).every(k => LIVE.src[k] === LIVE._d[k].base); return o; });
  ok(r.active.length === 4 && r.maxhp === 6 && r.hp === 6 && r.clean, 'genome re-apply + reset clean ' + JSON.stringify(r.active));
  // 7. mutator flow
  r = await ev(() => { const { RUN, PATCH, S, ENT } = window.__SM; RUN.start(); const D = window.__G.DIR; D.on = false;
    const m = window.__G.GAME.spawnEnemy('mutator', 400, 200); window.__sim(60, { fire: false, passive: true, god: true });
    const o = { bugs: PATCH.bugs().slice(), label: m.label }; window.__G.POST.present(); return o; });
  await shot('mutator');
  r = await ev(() => { const { PATCH } = window.__SM; const o = window.__sim(60 * 20, { god: true, aggro: true }); o.bugsAfter = PATCH.bugs().slice(); window.__G.DIR.on = true; return o; });
  ok(r.bugsAfter.length === 0 && (r.kills.mutator || 0) === 1, 'mutator infects + cure on kill ' + JSON.stringify(r.bugsAfter));
  // 8. high difficulty mid-fight screenshot
  r = await ev(() => { const { RUN, S, PATCH } = window.__SM; RUN.start(); S.diff = 3; window.__G.DIR.max = 50; ['rate', 'fork', 'pierce', 'orbit', 'chain'].forEach(id => PATCH.apply(id));
    const o = window.__sim(60 * 30, { god: true }); return o; });
  ok(clean(r), 'diff 3, 50 enemies: ' + r.ms.toFixed(2) + ' ms/frame, maxE ' + r.maxE + ' maxEs ' + r.maxEs);
  await shot('diff3');
  console.log(fails ? `\n${fails} FAILURES` : '\nALL OK'); await b.close(); process.exit(fails ? 1 : 0);
})();
