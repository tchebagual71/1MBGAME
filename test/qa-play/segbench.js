#!/usr/bin/env node
// Segment bench: replay builds captured from campaign logs into single waves / boss fights, many times.
// node test/qa-play/segbench.js results.json segs=0.B,1.B,... skills=average,expert reps=6
// Player never dies here: when hp would hit 0 it is refilled and a "life" is counted (so hard segments still produce data).
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const [resF, segArg, skArg, repArg, wArg] = process.argv.slice(2);
const R = JSON.parse(fs.readFileSync(resF, 'utf8')), segs = (segArg || '0.B,1.B,2.B,3.B,4.B,5.B,6.B').split(','), skills = (skArg || 'average,expert').split(','), reps = +(repArg || 6);
const html = path.resolve(path.join(__dirname, '../../dist/dev.html')), botSrc = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
function buildFor(run, key) { const [s, w] = key.split('.'), S = +s, Wv = w === 'B' ? 4 : +w;
  return run.picks.filter(p => { const [a, b] = p.at.split('.').map(Number); return a < S || (a === S && b < Wv); }).map(p => p.id); }
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const jobs = []; for (const k of segs) for (const sk of skills) for (let i = 0; i < reps; i++) jobs.push({ k, sk, i });
  const out = {}; let next = 0;
  async function worker() { const pg = await b.newPage(); pg.on('pageerror', e => console.log('PAGEERROR', e.message));
    await pg.goto('file://' + html); await pg.waitForFunction(() => window.__SM && window.__SM.SCENE.name); await pg.evaluate(botSrc);
    while (next < jobs.length) { const j = jobs[next++];
      // pick builds from runs (any skill) that actually reached this segment, cycling
      const pool = R.filter(r => r.segs.some(g => g.k === j.k)); const run = pool.length ? pool[j.i % pool.length] : R[0], build = buildFor(run, j.k);
      const r = await pg.evaluate(([k, sk, seed, build]) => {
        const { S, PATCH, DIR, SCENE, BUS } = __SM; QA.start(sk, seed); for (const id of build) PATCH.apply(id);
        const p = S.player; p.hp = p.maxhp = Math.max(p.maxhp, +(/MAXHP=(\d+)/.exec(__SM.LIVE.src['ply.tick']) || [0, 5])[1]);
        const [s, w] = k.split('.'); DIR.debug.skipTo(+s, w === 'B' ? 99 : +w);
        let lives = 0, t = 0; const hp0 = p.hp;
        for (let f = 0; f < 60 * 200; f++) { if (p.hp <= 1 && !p.dead) { lives++; p.hp = p.maxhp; } QA.frame(false); t += 1 / 60;
          QA.track && QA.track(); const st = DIR.state.phase; if (SCENE.name !== 'play' || st === 'clear' || st === 'outro' || p.dead) break; }
        const g = QA.log; return { t: +t.toFixed(1), hits: g.hits, lives, hp0, n: build.length, hitBy: g.hitBy, dead: p.dead, build, bossLeft: S.boss ? +(S.boss.hp / S.boss.maxhp).toFixed(2) : 0 };
      }, [j.k, j.sk, 5000 + j.i * 31, build]);
      (out[j.k + ' ' + j.sk] = out[j.k + ' ' + j.sk] || []).push(r); }
    await pg.close(); }
  await Promise.all([0, 1, 2, 3].map(worker)); await b.close();
  if (process.env.V) for (const key of Object.keys(out).sort()) for (const r of out[key]) if (r.t > +process.env.V) console.log('SLOW', key, r.t, 'left', r.bossLeft, r.build.join(','));
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  for (const key of Object.keys(out).sort()) { const a = out[key], hb = {}; for (const r of a) for (const k in r.hitBy) hb[k] = (hb[k] || 0) + r.hitBy[k];
    console.log(`${key.padEnd(12)} t ${avg(a.map(r => r.t)).toFixed(1).padStart(5)} [${Math.min(...a.map(r => r.t)).toFixed(0)}-${Math.max(...a.map(r => r.t)).toFixed(0)}]  hits ${avg(a.map(r => r.hits)).toFixed(1).padStart(4)}  hp0 ${avg(a.map(r => r.hp0)).toFixed(1)}  wouldDie ${a.filter(r => r.hits >= r.hp0).length}/${a.length}  ups ${avg(a.map(r => r.n)).toFixed(0)}  ${Object.entries(hb).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => k + ':' + v).join(' ')}`); }
})();
