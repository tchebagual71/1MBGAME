#!/usr/bin/env node
// SELF.MOD QA campaign runner.
// node test/qa-play/run.js [skills=novice,average,expert] [runs=6] [workers=3] [out=test/qa-play/out/results.json] [--shots] [--html=dist/dev.html]
// Runs full campaigns with the honest bot (test/qa-play/bot.js) faster than realtime and writes per-run logs as JSON.
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const argv = process.argv.slice(2), flags = argv.filter(a => a.startsWith('--')), pos = argv.filter(a => !a.startsWith('--'));
const skills = (pos[0] || 'novice,average,expert').split(','), runs = +(pos[1] || 6), workers = +(pos[2] || 3);
const out = path.resolve(pos[3] || path.join(__dirname, 'out/results.json'));
const flag = (n, d) => { const f = flags.find(a => a.startsWith('--' + n)); return f ? (f.includes('=') ? f.split('=')[1] : true) : d; };
const html = path.resolve(flag('html', path.join(__dirname, '../../dist/dev.html'))), shots = !!flag('shots'), seed0 = +flag('seed', 1000);
const opt = JSON.parse(flag('opt', '{}'));
const botSrc = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
const shotDir = path.join(__dirname, 'shots'); if (shots) fs.mkdirSync(shotDir, { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const jobs = []; for (const s of skills) for (let i = 0; i < runs; i++) jobs.push({ skill: s, seed: seed0 + i * 7919 + skills.indexOf(s) * 13 });
  const results = []; let next = 0; const t0 = Date.now();
  async function worker(wi) {
    const pg = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    pg.on('pageerror', e => console.log('PAGEERROR', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')));
    while (next < jobs.length) {
      const j = jobs[next++];
      await pg.goto('file://' + html); await pg.waitForFunction(() => window.__SM && window.__SM.SCENE.name);
      await pg.evaluate(botSrc);
      await pg.evaluate(([s, seed, o]) => QA.start(s, seed, o), [j.skill, j.seed, Object.assign({ shots }, opt)]);
      let r, nshot = 0;
      for (;;) { r = await pg.evaluate(() => QA.step(3600));
        if (r.done) break;
        if (r.want && shots && nshot < 70) { nshot++; await pg.screenshot({ path: path.join(shotDir, `${j.skill}_${j.seed}_${String(nshot).padStart(2, '0')}_${r.want}.png`) }); } }
      const L = r.log; results.push(L);
      const d = L.death;
      console.log(`[w${wi}] ${j.skill.padEnd(7)} seed ${j.seed} -> ${L.win ? 'WIN ' : 'DIED'} ${d ? 'at ' + d.at + (d.bossPh != null ? ' ph' + d.bossPh : '') + ' by ' + d.by : ''} t=${L.time}s score=${L.score} picks=${L.picks.length} errs=${L.errs.length} panics=${L.panics}`);
      fs.writeFileSync(out, JSON.stringify(results));
    }
    await pg.close();
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, (_, i) => worker(i)));
  await b.close();
  console.log(`done ${results.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${out}`);
})();
