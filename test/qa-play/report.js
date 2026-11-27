#!/usr/bin/env node
// node test/qa-play/report.js results.json [--runs]  -> balance tables (per sector/wave/boss, deaths, patches)
const fs = require('fs');
const R = JSON.parse(fs.readFileSync(process.argv[2] || __dirname + '/out/results.json', 'utf8'));
const verbose = process.argv.includes('--runs');
const by = (a, f) => a.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN, med = a => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const f1 = v => isNaN(v) ? '  -  ' : v.toFixed(1).padStart(5), pct = (a, b) => b ? (100 * a / b).toFixed(0).padStart(3) + '%' : '  - ';
const skills = Object.keys(by(R, r => r.skill));
for (const sk of skills) {
  const rs = R.filter(r => r.skill === sk), wins = rs.filter(r => r.win);
  console.log(`\n=== ${sk.toUpperCase()}  runs ${rs.length}  wins ${wins.length} (${pct(wins.length, rs.length)})  avg time ${f1(avg(rs.map(r => r.time)))}s  win time ${f1(avg(wins.map(r => r.time)) / 60)}min  score ${avg(rs.map(r => r.score)) | 0}  errs ${rs.reduce((s, r) => s + r.errs.length, 0)} panics ${rs.reduce((s, r) => s + r.panics, 0)}`);
  const deaths = by(rs.filter(r => r.death), r => r.death.sector); const reached = s => rs.filter(r => r.segs.some(g => g.k.startsWith(s + '.'))).length;
  console.log('sector | reach | died | wave dur (med) | wave hurt/avg | wave peakN | boss fight (med) | boss hurt | boss dps | ups@boss | died in boss');
  for (let s = 0; s <= 6; s++) {
    const W = rs.flatMap(r => r.segs.filter(g => g.k.startsWith(s + '.') && !g.k.endsWith('B') && g.end)), B = rs.flatMap(r => r.segs.filter(g => g.k === s + '.B'));
    const bd = (deaths[s] || []).filter(r => r.death.phase === 'boss' || r.death.at.endsWith('B')).length;
    console.log(`  ${s}    |  ${String(reached(s)).padStart(3)}  | ${String((deaths[s] || []).length).padStart(3)}  |   ${f1(med(W.map(g => g.dur)))}       |   ${f1(avg(W.map(g => g.hurt)))}      |  ${f1(avg(W.map(g => g.peak)))}    |    ${f1(med(B.filter(g => g.fight).map(g => g.fight)))}        |  ${f1(avg(B.map(g => g.hurt)))}   | ${f1(avg(B.map(g => g.dps)))}   | ${f1(avg(B.map(g => g.ups)))}  | ${bd}`);
  }
  // per wave detail
  const segs = by(rs.flatMap(r => r.segs.filter(g => g.end)), g => g.k);
  console.log('per segment: key dur(med/min/max) hurt(avg) kills avgN peak dps   [boss: phase times]');
  for (const k of Object.keys(segs).sort((a, b) => parseFloat(a) - parseFloat(b) || (a < b ? -1 : 1))) { const g = segs[k], d = g.map(x => x.fight || x.dur);
    const dk = rs.filter(r => r.death && r.death.at === k).length;
    console.log(`  ${k.padEnd(4)} ${f1(med(d))} ${f1(Math.min(...d))} ${f1(Math.max(...d))}  hurt ${f1(avg(g.map(x => x.hurt)))} kills ${f1(avg(g.map(x => x.kills)))} avgN ${f1(avg(g.map(x => x.avgN)))} peak ${f1(avg(g.map(x => x.peak)))} dps ${f1(avg(g.map(x => x.dps)))} n=${g.length}${dk ? ' DEATHS ' + dk : ''}${k.endsWith('B') ? '  ph@ ' + JSON.stringify(g.slice(0, 3).map(x => x.phases)) : ''}`); }
  const killers = {}; for (const r of rs) if (r.death) killers[r.death.by] = (killers[r.death.by] || 0) + 1;
  console.log('death at:', JSON.stringify(Object.entries(by(rs.filter(r => r.death), r => r.death.at + (r.death.bossPh != null ? 'p' + r.death.bossPh : ''))).map(([k, v]) => k + ':' + v.length).join(' ')), ' killers:', JSON.stringify(killers));
  const hits = {}; for (const r of rs) for (const k in r.hitBy) hits[k] = (hits[k] || 0) + r.hitBy[k];
  console.log('hits by:', Object.entries(hits).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => k + ':' + v).join(' '));
  const mh = {}; for (const r of wins) mh[r.minHp] = (mh[r.minHp] || 0) + 1; console.log('winners: lowest hp reached during run ->', JSON.stringify(mh), ' total hits/run med', med(rs.map(r => r.hits)));
  const unf = rs.flatMap(r => r.unfair || []), ub = {}; for (const u of unf) ub[u.by] = (ub[u.by] || 0) + 1;
  console.log('unfair hits:', unf.length, JSON.stringify(ub), ' outside-arena enemy frames:', rs.reduce((s, r) => s + (r.outside || 0), 0), ' stalls:', JSON.stringify(rs.flatMap(r => r.stall || [])));
  if (verbose) for (const r of rs) console.log('  run', r.seed, r.win ? 'WIN' : 'died ' + JSON.stringify(r.death), r.time, r.final.join(','));
}
// patches: pick rate (picked / offered) and win rate when held
const P = {}; for (const r of R) { const held = new Set(r.picks.map(p => p.id)); for (const pk of r.picks) for (const o of pk.offered) { const q = P[o] = P[o] || { off: 0, pick: 0, runs: 0, wins: 0, sec: 0 }; q.off++; if (o === pk.id) q.pick++; }
  for (const id of held) { const q = P[id]; q.runs++; if (r.win) q.wins++; q.sec += r.sector + (r.win ? 1 : 0); } }
const base = R.filter(r => r.win).length / R.length, bs = avg(R.map(r => r.sector + (r.win ? 1 : 0)));
console.log(`\n=== PATCHES (all runs; base win ${pct(base * 100, 100)}, base reach ${bs.toFixed(2)})  id offered picked pickrate runs-held winrate avgReach`);
for (const [id, q] of Object.entries(P).sort((a, b) => b[1].pick / b[1].off - a[1].pick / a[1].off))
  console.log(`  ${id.padEnd(11)} ${String(q.off).padStart(4)} ${String(q.pick).padStart(4)} ${pct(q.pick, q.off)}  ${String(q.runs).padStart(3)} ${pct(q.wins, q.runs)} ${(q.sec / Math.max(1, q.runs)).toFixed(2)}`);
// less biased: among runs where the patch was OFFERED in sectors 0-2, compare reach when picked there vs passed over
console.log('\n=== EARLY-PICK EFFECT (offered in s0-2): id  nPicked reach(picked)  nPassed reach(passed)  delta  win(picked) win(passed)');
const E = {}; for (const r of R) { const reach = r.sector + (r.win ? 1 : 0), seen = {};
  for (const pk of r.picks) { if (+pk.at.split('.')[0] > 2) continue; for (const o of pk.offered) { seen[o] = seen[o] || (o === pk.id ? 'p' : 'o'); if (o === pk.id) seen[o] = 'p'; } }
  for (const id in seen) { const q = E[id] = E[id] || { p: [], o: [], pw: 0, ow: 0 }; q[seen[id]].push(reach); if (r.win) q[seen[id] + 'w']++; } }
for (const [id, q] of Object.entries(E).sort((a, b) => (avg(b[1].p) - avg(b[1].o)) - (avg(a[1].p) - avg(a[1].o))))
  console.log(`  ${id.padEnd(11)} ${String(q.p.length).padStart(3)} ${avg(q.p).toFixed(2)}   ${String(q.o.length).padStart(3)} ${avg(q.o).toFixed(2)}   ${(avg(q.p) - avg(q.o) >= 0 ? '+' : '') + (avg(q.p) - avg(q.o)).toFixed(2)}   ${pct(q.pw, q.p.length)} ${pct(q.ow, q.o.length)}`);
