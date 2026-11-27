#!/usr/bin/env node
// Fuzz the LIVE/PATCH machinery in the integrated build while stepping the real game.
// Usage: node test/qa-robust/fuzz.js [html=dist/dev.html] [ops=3000] [seed=1]
const path = require('path');
const { ROOT, launch, collect } = require('./lib');
const FILE = process.argv[2] || 'dist/dev.html', OPS = +(process.argv[3] || 3000), SEED = +(process.argv[4] || 1);

// ---------------- page-side harness ----------------
function harness() {
  const M = window.__SM, { S, LIVE, PATCH, SCENE, IN, AU, UI, DIR, ENT, BUS, RUN, GAME } = M;
  const H = window.__H = { panics: [], throws: [], viol: [], frames: 0 };
  BUS.on('panic', (e, en) => H.panics.push({ err: String(e && e.message || e).slice(0, 160), fn: en && en.name, tag: en && en.tag, active: PATCH.active.slice() }));
  // one frame, same order as 99-main.js (POST optional)
  H.step = (n, o) => { o = o || {}; const dt = o.dt || 1 / 60;
    for (let i = 0; i < n; i++) { S.dt = dt; S.t += dt; S.frame++; H.frames++;
      S.shake = S.shake > .05 ? S.shake * Math.pow(.002, dt) : 0; S.flash = S.flash > .01 ? S.flash * Math.pow(.001, dt) : 0;
      IN.poll();
      if (o.god && S.player && !S.player.dead) { S.player.hp = S.player.maxhp; }
      try { AU.update(dt); SCENE.cur.update(dt); if (!o.nodraw || i === n - 1) { SCENE.cur.draw(dt); UI.overlay(dt); } }
      catch (e) { H.throws.push({ err: String(e && e.message || e).slice(0, 200), stack: String(e && e.stack || '').split('\n').slice(0, 3).join(' | '), mode: S.mode, active: PATCH.active.slice() }); LIVE.panic(e); }
      if (o.post) M.POST.present(dt);
    } };
  // replay a function's source from base + its patch list (mirrors kernel semantics) — must equal LIVE.src
  const ap = (s, p) => { if (p.find instanceof RegExp) p.find.lastIndex = 0; return typeof p.repl === 'function' ? s.replace(p.find, p.repl) : s.replace(p.find, () => p.repl); };
  H.check = (where) => {
    const v = m => { if (H.viol.length < 200) H.viol.push(where + ': ' + m); };
    for (const id in PATCH.all) { const p = PATCH.all[id], c = PATCH.active.filter(x => x === id).length; if (p.n !== c) v(`${id} n=${p.n} active=${c}`); if (p.n > p.max) v(`${id} n>max`); }
    for (const name in LIVE._d) { const d = LIVE._d[name]; if (typeof LIVE.fn[name] !== 'function') v(name + ' not a function');
      let s = d.base; for (const q of d.p) s = ap(s, q); if (s !== LIVE.src[name]) { try { new Function(d.args, s); v(name + ' src != replay'); } catch (e) { /* replay includes a non-compiling step that _re skipped */ } }
      for (const q of d.p) { if (q.app && q.tag && PATCH.all[q.tag] && !PATCH.all[q.tag].n) v(`${name}: orphan edit of inactive ${q.tag}`); if (q.on === false && q.tag && PATCH.all[q.tag]) H.dormant = (H.dormant || 0) + 1; } }
  };
  H.base = () => { const o = {}; for (const n in LIVE._d) o[n] = LIVE._d[n].base; return o; };
  H.diffBase = () => { const out = []; for (const n in LIVE._d) if (LIVE.src[n] !== LIVE._d[n].base || LIVE._d[n].p.length) out.push(n); return out; };
  H.snap = () => Object.assign({}, LIVE.src);
  H.eqSnap = (a) => { const out = []; for (const n in LIVE.src) if (LIVE.src[n] !== a[n]) out.push(n); return out; };
}

(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 480, height: 270 } }); const page = await ctx.newPage(); const errs = collect(page);
  await page.goto('file://' + path.join(ROOT, FILE)); await page.waitForFunction(() => window.__SM && window.__SM.S.frame > 3);
  await page.evaluate(harness);
  let fails = 0; const rep = (ok, name, info) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(46) + ' ' + (info || '')); };

  // ---------- deterministic per-patch checks ----------
  const det = await page.evaluate(() => {
    const { PATCH, LIVE, RUN, S } = window.__SM, H = window.__H, out = { ids: 0, bad: [], pairBad: [], stackBad: [], dollar: null };
    RUN.start(); H.step(5);
    const ids = Object.keys(PATCH.all); out.ids = ids.length; out.kinds = { up: ids.filter(i => PATCH.all[i].kind === 'up').length, bug: ids.filter(i => PATCH.all[i].kind === 'bug').length };
    const can = id => PATCH.can(PATCH.all[id]);
    for (const id of ids) {
      PATCH.reset(); const p = PATCH.all[id]; const forced = !can(id); const oc = p.can; if (forced) p.can = null;
      const ok = PATCH.apply(id); if (!ok) { out.bad.push(id + ': apply failed on clean build'); p.can = oc; continue; }
      let k = 1; while (p.n < p.max && PATCH.apply(id)) k++; if (k !== p.max) out.stackBad.push(`${id}: stacked ${k}/${p.max}`);
      H.step(3);
      PATCH.cure(id); const dif = H.diffBase(); if (dif.length) out.bad.push(id + ': cure left ' + dif.join(','));
      if (p.n || PATCH.active.length) out.bad.push(id + ': bookkeeping after cure');
      // reapply after cure works
      if (!PATCH.apply(id)) out.bad.push(id + ': re-apply after cure failed');
      PATCH.reset(); if (H.diffBase().length) out.bad.push(id + ': reset left ' + H.diffBase().join(','));
      p.can = oc;
    }
    // pairs on the same function: A then B, cure A -> must equal B alone
    const touches = {}; for (const id of ids) { PATCH.reset(); const p = PATCH.all[id], oc = p.can; p.can = null; PATCH.apply(id); p.can = oc; touches[id] = H.diffBase(); }
    PATCH.reset(); let pairs = 0;
    for (const a of ids) for (const b of ids) { if (a === b || !touches[a].some(n => touches[b].includes(n))) continue; pairs++;
      const A = PATCH.all[a], B = PATCH.all[b], ca = A.can, cb = B.can; A.can = B.can = null;
      PATCH.reset(); PATCH.apply(b); const solo = H.snap();
      PATCH.reset(); const okA = PATCH.apply(a), okB = PATCH.apply(b);
      if (okA && okB) { PATCH.cure(a); const d = H.eqSnap(solo); if (d.length) out.pairBad.push(`${a}+${b} cure ${a}: ${b} lost in ${d.join(',')}`);
        PATCH.cure(b); if (H.diffBase().length) out.pairBad.push(`${a}+${b}: residue after both cured`); }
      else if (okB === false && okA) out.pairBad.push(`${b} cannot apply after ${a} (conflict)`);
      A.can = ca; B.can = cb; }
    out.pairs = pairs; PATCH.reset();
    // kernel semantics: '$' in literal replacement, /g regex lastIndex, sticky regex, re-def keeps patches, offer() weight 0, panic bookkeeping
    LIVE.def('qa.t', 'x', 'const A=1, B=2;\nreturn A + B + x;');
    LIVE.patch('qa.t', 'A=1', "A='$&$1$$'.length"); out.dollar = LIVE.src['qa.t'].includes("A='$&$1$$'.length");
    const g = /B=(\d)/g; g.lastIndex = 999; out.gReg = LIVE.patch('qa.t', g, (m, a) => 'B=' + (+a + 1)) && LIVE.patch('qa.t', g, (m, a) => 'B=' + (+a + 1)) && LIVE.src['qa.t'].includes('B=4');
    const y = /return/y; out.sticky = !LIVE.patch('qa.t', y, 'return 0+');   // sticky at index 0 never matches 'const' — must be stable, not flaky
    LIVE.revert('qa.t'); LIVE.patch('qa.t', 'B=2', 'B=5'); LIVE.def('qa.t', 'x', 'const A=1, B=2;\nreturn A * B * x;'); out.redef = LIVE.src['qa.t'].includes('B=5') && LIVE.fn['qa.t'](1) === 5;
    LIVE.revert('qa.t');
    PATCH.def({ id: 'qa.w0', name: 'W0', kind: 'qa', weight: 0, apply: () => true }); PATCH.def({ id: 'qa.w1', name: 'W1', kind: 'qa', weight: 1, apply: () => true });
    let w0 = 0; for (let i = 0; i < 200; i++) if (PATCH.offer(2, 'qa').some(p => p.id === 'qa.w0')) w0++; out.weight0 = w0 === 0;
    // partial apply rolls back
    PATCH.def({ id: 'qa.part', name: 'P', kind: 'qa', apply: () => { LIVE.patch('qa.t', 'A=1', 'A=9'); return false; } }); PATCH.apply('qa.part'); out.partial = LIVE.src['qa.t'] === LIVE._d['qa.t'].base;
    // panic removes a whole stacked application & keeps bookkeeping
    PATCH.def({ id: 'qa.st', name: 'S', kind: 'qa', max: 3, apply: () => LIVE.patch('qa.t', /B=(\d+)/, (m, a) => 'B=' + (+a + 1)) && LIVE.patch('qa.t', 'return', 'x = x + 0;\nreturn') });
    PATCH.apply('qa.st'); PATCH.apply('qa.st'); PATCH.apply('qa.st');
    LIVE.panic(new Error('synthetic')); const P = PATCH.all['qa.st'];
    out.panic = P.n === 2 && PATCH.active.filter(x => x === 'qa.st').length === 2 && LIVE.src['qa.t'].includes('B=4') && (LIVE.src['qa.t'].match(/x = x/g) || []).length === 2;
    // panic targets the function on the stack, not the newest patch overall
    LIVE.def('qa.u', 'x', 'return x.y.z;'); LIVE.patch('qa.u', 'return x.y.z;', 'return x.y.z + 0;', 'qa.st2');
    LIVE.patch('qa.t', 'return', 'return 0 +', 'qa.other');
    let err = null; try { LIVE.fn['qa.u']({}); } catch (e) { err = e; }
    LIVE.panic(err); out.targeted = LIVE.src['qa.u'] === LIVE._d['qa.u'].base && LIVE.src['qa.t'].includes('return 0 +');
    out.stackHasName = /live:qa\.u/.test(err.stack);
    PATCH.cure('qa.st'); LIVE.revert('qa.t'); LIVE.revert('qa.u'); for (const k of ['qa.w0', 'qa.w1', 'qa.part', 'qa.st']) delete PATCH.all[k]; delete LIVE._d['qa.t']; delete LIVE._d['qa.u']; delete LIVE.src['qa.t']; delete LIVE.src['qa.u']; delete LIVE.fn['qa.t']; delete LIVE.fn['qa.u'];
    PATCH.reset(); out.viol = H.viol.length; H.panics.length = 0; return out;
  });
  rep(det.ids >= 50, 'patch catalog size', JSON.stringify(det.kinds));
  rep(!det.bad.length, 'every patch: apply/stack/cure/reapply/reset exact', det.bad.join(' ; '));
  rep(!det.stackBad.length, 'stackable patches reach max', det.stackBad.join(' ; '));
  rep(!det.pairBad.length, `same-fn pairs (${det.pairs}): cure A keeps B exact`, det.pairBad.slice(0, 12).join(' ; ') + (det.pairBad.length > 12 ? ` (+${det.pairBad.length - 12})` : ''));
  rep(det.dollar, "literal '$' in replacement");
  rep(det.gReg && det.sticky, 'RegExp /g /y lastIndex stateless');
  rep(det.redef, 're-def keeps & re-applies patches');
  rep(det.weight0, 'offer() never returns weight-0');
  rep(det.partial, 'partial apply rolled back');
  rep(det.panic, 'panic removes one whole stacked application');
  rep(det.targeted && det.stackHasName, 'panic targets the throwing live fn');

  // ---------- random soak ----------
  const t0 = Date.now();
  const soak = await page.evaluate(async ([OPS, SEED]) => {
    const { PATCH, LIVE, RUN, S, DIR, SCENE, ENT, IN } = window.__SM, H = window.__H;
    let sd = SEED >>> 0; const R = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296); const ri = n => R() * n | 0;
    const ids = Object.keys(PATCH.all); const st = { apply: 0, applyOk: 0, cure: 0, infect: 0, reset: 0, start: 0, skip: 0, frames: 0, maxActive: 0 };
    RUN.start();
    for (let op = 0; op < OPS; op++) {
      const r = R();
      if (r < .35) { st.apply++; if (PATCH.apply(ids[ri(ids.length)])) st.applyOk++; }
      else if (r < .47) { const a = PATCH.active; if (a.length) { PATCH.cure(a[ri(a.length)]); st.cure++; } }
      else if (r < .55) { PATCH.infect(); st.infect++; }
      else if (r < .57) { PATCH.reset(); st.reset++; H.check('after reset'); const d = H.diffBase(); if (d.length) H.viol.push('reset left ' + d.join(',')); }
      else if (r < .59) { RUN.start(); st.start++; }
      else if (r < .63) { try { const s = ri(7), w = ri(6); if (s === 6) DIR.debug.boss('kernel'); else DIR.debug.skipTo(s, w); st.skip++; } catch (e) { H.viol.push('skipTo threw ' + e.message); } }
      else if (r < .65) { try { DIR.debug.phase(1 + ri(3)); } catch (e) { H.viol.push('phase threw ' + e.message); } }
      else if (r < .66) { try { DIR.debug.kill(); } catch (e) { H.viol.push('kill threw ' + e.message); } }
      else if (r < .68) { ENT.each(1, e => { if (!e.boss && R() < .7) ENT.damage(e, 999, null); }); }
      else { const n = 1 + ri(40); H.step(n, { god: R() < .9, nodraw: R() < .5 }); st.frames += n; }
      if (S.mode !== 'play' && R() < .3) { if (S.mode === 'patch' || S.mode === 'pause') SCENE.go('play'); else RUN.start(); }
      st.maxActive = Math.max(st.maxActive, PATCH.active.length);
      if (op % 7 === 0) H.check('op' + op);
      if (op % 200 === 0) await new Promise(r => setTimeout(r, 0));
    }
    PATCH.reset(); const left = H.diffBase(); H.check('final');
    return { st, left, panics: H.panics, throws: H.throws, viol: H.viol, dormant: H.dormant || 0, log: LIVE.log.length };
  }, [OPS, SEED]);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('soak', JSON.stringify(soak.st), 'in', secs + 's; dormant-patch observations', soak.dormant, '; LIVE.log', soak.log);
  const uniq = (a, k) => { const m = new Map(); for (const x of a) { const key = k(x); m.set(key, (m.get(key) || 0) + 1); } return [...m].map(([k, n]) => n + 'x ' + k); };
  rep(!soak.throws.length, 'no exceptions while stepping', uniq(soak.throws, x => x.err + ' @' + x.mode + ' ' + x.stack.split('|')[1] + ' [' + x.active.join(',') + ']').slice(0, 10).join('\n   '));
  rep(!soak.panics.length, 'no LIVE.panic needed', uniq(soak.panics, x => x.fn + ' ' + x.err + ' [' + x.active.join(',') + ']').slice(0, 10).join('\n   '));
  rep(!soak.viol.length, 'bookkeeping invariants', soak.viol.slice(0, 10).join(' ; '));
  rep(!soak.left.length, 'reset restores every base source', soak.left.join(','));
  rep(!errs.length, 'no console errors', errs.slice(0, 6).join(' || '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
