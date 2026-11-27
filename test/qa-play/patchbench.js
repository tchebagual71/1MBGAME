#!/usr/bin/env node
// Patch DPS bench: god-mode player auto-aims; measures damage dealt vs (A) a crowd stream and (B) a single large target,
// for every 'up' patch, as a marginal multiplier over reference builds.  node test/qa-play/patchbench.js [html]
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const html = path.resolve(process.argv[2] || path.join(__dirname, '../../dist/dev.html'));
const REFS = { empty: [], mid: ['rate', 'dmg', 'fork', 'pierce', 'crit', 'hp', 'rate', 'homing'], late: ['rate', 'rate', 'dmg', 'dmg', 'fork', 'pierce', 'crit', 'chain', 'scatter', 'homing', 'blast', 'orbit', 'rate', 'dmg', 'crit', 'hp', 'regen', 'split'] };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }), pg = await b.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  await pg.goto('file://' + html); await pg.waitForFunction(() => window.__SM && window.__SM.SCENE.name);
  await pg.evaluate(fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8'));
  const res = await pg.evaluate((REFS) => {
    const { S, PATCH, ENT, DIR, GAME, IN, RUN, BUS, LIVE } = __SM; DIR.update = () => { };
    let dmg = 0; BUS.on('hurt', (e, d) => { if (e.team === 1) dmg += Math.max(0, d + Math.min(0, e.hp)); });
    function run(build, mode, secs, sector) {
      QA.start('expert', 77); for (const id of build) PATCH.apply(id); S.diff = 1 + sector * .34 + .14;
      const p = S.player; dmg = 0; let t = 0, nextSpawn = 0; const tgt = [];
      if (mode === 'single') { const e = GAME.spawnEnemy('turret', 240, 70, { warp: 0, hp: 1e7, r: 26 }); e.cd = 1e9; e.n = 0; e.contact = 0; }
      while (t < secs) {
        p.x = 240; p.y = 200; p.hp = p.maxhp; p.inv = 1;
        if (mode === 'crowd' && t >= nextSpawn && ENT.count(1) < 14) { nextSpawn = t + .35; const a = Math.random() * Math.PI - Math.PI; const e = GAME.spawnEnemy('drifter', 240 + Math.cos(a) * 170, 200 + Math.sin(a) * 140, { warp: .1, hp: 12 * sector }); }
        ENT.each(3, q => { q.dead = true; });
        QA.frame(false); t += 1 / 60;
      }
      ENT.clear(); return dmg / secs;
    }
    const out = {};
    for (const sec of [1, 3]) for (const mode of ['single', 'crowd']) for (const rn in REFS) {
      if (sec === 1 && rn === 'late') continue; if (sec === 3 && rn === 'empty') continue;
      const ref = REFS[rn], base = run(ref, mode, 20, sec), row = { base: +base.toFixed(1) };
      for (const id in PATCH.all) { const q = PATCH.all[id]; if (q.kind !== 'up') continue; const v = run(ref.concat([id]), mode, 20, sec); row[id] = +(v / base).toFixed(2); }
      out[mode + ':' + rn + '@s' + sec] = row;
    }
    return out;
  }, REFS);
  const ids = Object.keys(Object.values(res)[0]).filter(k => k !== 'base');
  const cols = Object.keys(res); console.log('patch'.padEnd(11) + cols.map(c => c.padStart(18)).join(''));
  console.log('base dps'.padEnd(11) + cols.map(c => String(res[c].base).padStart(18)).join(''));
  for (const id of ids.sort((a, b) => cols.reduce((s, c) => s + res[c][b], 0) - cols.reduce((s, c) => s + res[c][a], 0))) console.log(id.padEnd(11) + cols.map(c => res[c][id].toFixed(2).padStart(18)).join(''));
  fs.writeFileSync(path.join(__dirname, 'out/patchbench.json'), JSON.stringify(res, null, 1));
  await b.close();
})();
