#!/usr/bin/env node
// Usage: node test/audio/run.js [phase...]   phases: songs sfx seam live virtual bugs flood (default: all)
const fs = require('fs'), path = require('path'); const { chromium } = require('playwright');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
require('./build.js');
const phases = process.argv.slice(2).length ? process.argv.slice(2) : ['songs', 'sfx', 'seam', 'live', 'virtual', 'bugs', 'flood'];
const save = (name, b64) => fs.writeFileSync(path.join(OUT, name), Buffer.from(b64.replace(/^data:image\/png;base64,/, ''), 'base64'));
let fail = 0; const check = (ok, msg) => { if (!ok) { fail++; console.log('  FAIL:', msg); } };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message); });
  p.on('console', m => { if (m.type() === 'error') { fail++; console.log('CONSOLE', m.text()); } });
  await p.goto('file://' + path.join(__dirname, 'harness.html'));
  await p.addScriptTag({ path: path.join(__dirname, 'lib.js') });

  if (phases.includes('songs')) {
    console.log('== songs (16 bars @48k) ==');
    const names = await p.evaluate(() => __T.AU.songs);
    for (const n of names) {
      const r = await p.evaluate(([n]) => { const sr = 48000, ramp = /^s\d|boss|final/.test(n);
        const x = AL.renderSong(n, 16, sr, ramp ? 0 : .5, ramp); const st = AL.stats(x.L, x.R, sr);
        const keep = ['title', 's0', 's3', 'boss', 'patch', 'final'].includes(n);
        return { st, ms: x.ms, sec: x.sec, rt: x.ms / (x.sec * 1000), pic: keep ? AL.picture(x.L, sr, n + (ramp ? '  (intensity 0 -> 1)' : '')) : null, wav: keep ? AL.wav(x.L.subarray(0, sr * 14), x.R.subarray(0, sr * 14), sr) : null }; }, [n]);
      const s = r.st; console.log(`${n.padEnd(6)} ${r.sec.toFixed(1)}s render ${r.ms.toFixed(0)}ms (x${(r.rt * 100).toFixed(2)}% realtime) peak ${s.peak} rms ${s.rms} (${s.rmsDb} dB) maxStep ${s.maxStep} silent ${s.silentFrac} bands[sub,bass,lmid,hmid,hi] ${s.spec}`);
      check(s.nan === 0, n + ' NaN'); check(s.peak <= 1, n + ' peak'); check(s.rms > .03 && s.rms < .4, n + ' rms ' + s.rms); check(s.silentFrac < .15, n + ' silence');
      check(s.spec[0] < .6 && s.spec[4] < .25, n + ' spectral balance');
      if (r.pic) save('song-' + n + '.png', r.pic); if (r.wav) fs.writeFileSync(path.join(OUT, n + '.wav'), Buffer.from(r.wav, 'base64'));
    }
  }
  if (phases.includes('sfx')) {
    console.log('== sfx ==');
    const r = await p.evaluate(() => { const out = {}, sr = 48000; let all = []; const t0 = performance.now();
      for (const n of __T.AU.sfxNames) { const t1 = performance.now(), d = __T.AU._dev.renderSfx(n, sr); const ms = performance.now() - t1; const st = AL.stats(d, null, sr);
        let last = 0; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > .01) last = i;
        out[n] = { dur: +(d.length / sr).toFixed(3), audible: +(last / sr).toFixed(3), peak: st.peak, rms: st.rms, nan: st.nan, ms: +ms.toFixed(1), spec: st.spec, start: Math.abs(d[0]), end: Math.abs(d[d.length - 1]) };
        all.push(d, new Float32Array(sr * .08)); }
      const tot = all.reduce((a, b) => a + b.length, 0), cat = new Float32Array(tot); let o = 0; for (const a of all) { cat.set(a, o); o += a.length; }
      return { out, total: performance.now() - t0, pic: AL.picture(cat, sr, 'all sfx: ' + __T.AU.sfxNames.join(' '), 1600), wav: AL.wav(cat, cat, sr) }; });
    for (const n in r.out) { const s = r.out[n]; console.log(`${n.padEnd(8)} dur ${s.dur}s audible ${s.audible}s peak ${s.peak} rms ${s.rms} render ${s.ms}ms bands ${s.spec}`);
      check(!s.nan && s.peak > .5 && s.peak <= 1.0001 && s.dur <= 1.5 && s.end < .01 && s.start < .05, 'sfx ' + n); }
    console.log('total sfx render', r.total.toFixed(1), 'ms'); save('sfx.png', r.pic); fs.writeFileSync(path.join(OUT, 'sfx.wav'), Buffer.from(r.wav, 'base64'));
  }
  if (phases.includes('seam')) {
    console.log('== chunk seams through real AudioBufferSourceNode scheduling (OfflineAudioContext) ==');
    const r = await p.evaluate(async () => { const sr = 48000, e = __T.AU._dev.mkEngine(sr); e.music('s3'); e.setI(1);
      const n = 1024 * 300, L = new Float32Array(n), R = new Float32Array(n); for (let o = 0; o < n; o += 1024) e.render(L, R, o, 16);
      const oc = new OfflineAudioContext(2, n + 2048, sr);
      for (let o = 0; o < n; o += 1024) { const bf = oc.createBuffer(2, 1024, sr); bf.copyToChannel(L.subarray(o, o + 1024), 0); bf.copyToChannel(R.subarray(o, o + 1024), 1);
        const s = oc.createBufferSource(); s.buffer = bf; s.connect(oc.destination); s.start(o / sr); }
      const res = await oc.startRendering(), y = res.getChannelData(0); let md = 0, mi = 0; for (let i = 0; i < n; i++) { const d = Math.abs(y[i] - L[i]); if (d > md) { md = d; mi = i; } }
      // also: largest jump at chunk boundaries vs elsewhere
      let jb = 0, je = 0; for (let i = 1; i < n; i++) { const d = Math.abs(L[i] - L[i - 1]); if (i % 1024 === 0) jb = Math.max(jb, d); else je = Math.max(je, d); }
      return { md, mi, jb, je }; });
    console.log(`scheduled vs direct max diff ${r.md.toExponential(2)} @${r.mi}; max jump at seams ${r.jb.toFixed(3)} vs elsewhere ${r.je.toFixed(3)}`);
    check(r.md < 1e-4, 'seam scheduling mismatch'); check(r.jb <= r.je, 'seam jump');
  }
  if (phases.includes('virtual')) {
    console.log('== virtual clock (no AudioContext) ==');
    const r = await p.evaluate(() => { const { AU, S } = __T; const out = {};
      // before init / before any music: still pulses
      let beats = 0, prev = 0; for (let i = 0; i < 600; i++) { AU.update(1 / 60); if (S.beat === 1 && prev !== 1) beats++; prev = S.beat; }
      out.idle = beats;
      AU.music('s4'); beats = 0; for (let i = 0; i < 600; i++) { AU.update(1 / 60); if (S.beat === 1 && prev !== 1) beats++; prev = S.beat; }
      out.s4 = beats; out.bar = S.bar; out.song = AU.song; out.bpm = AU.bpm;
      // dropped frames: big dt
      beats = 0; for (let i = 0; i < 40; i++) { AU.update(.25); if (S.beat === 1) beats++; } out.bigdt = beats;
      AU.mute(true); beats = 0; for (let i = 0; i < 300; i++) { AU.update(1 / 60); if (S.beat === 1 && prev !== 1) beats++; prev = S.beat; } out.muted = beats; AU.mute(false);
      let t0 = performance.now(); for (let i = 0; i < 1000; i++) AU.update(1 / 60); out.msPerFrame = (performance.now() - t0) / 1000;
      return out; });
    console.log(JSON.stringify(r));
    check(r.idle >= 18 && r.idle <= 22, 'idle 120bpm beats over 10s ~20');
    check(Math.abs(r.s4 - 26) <= 2, 's4 156 bpm beats over 10s ~26 (allowing 1-beat switch latency)'); check(r.muted >= 10, 'beats while muted');
  }
  if (phases.includes('bugs')) {
    console.log('== bug patches ==');
    const r = await p.evaluate(() => { const { AU, LIVE, PATCH } = __T, sr = 48000, out = [];
      const ref = AL.renderSong('s1', 4, sr, .8); const src0 = {}; for (const k in LIVE.src) src0[k] = LIVE.src[k];
      for (const id of Object.keys(PATCH.all).filter(k => PATCH.all[k].kind === 'bug')) {
        const ok = PATCH.apply(id), x = AL.renderSong('s1', 4, sr, .8), st = AL.stats(x.L, x.R, sr);
        let diff = 0; const n = Math.min(ref.L.length, x.L.length); for (let i = 0; i < n; i++) diff += (ref.L[i] - x.L[i]) ** 2; diff = Math.sqrt(diff / n);
        const bugs = PATCH.bugs().slice(); PATCH.cure(id); let clean = true; for (const k in src0) if (LIVE.src[k] !== src0[k]) clean = false;
        const y = AL.renderSong('s1', 4, sr, .8); let d2 = 0; for (let i = 0; i < n; i++) d2 = Math.max(d2, Math.abs(ref.L[i] - y.L[i]));
        out.push({ id, name: PATCH.all[id].name, ok, bugs, peak: st.peak, rms: st.rms, nan: st.nan, diffRms: +diff.toFixed(4), clean, afterCureMaxDiff: d2, spec: st.spec, pic: AL.picture(x.L, sr, id, 600) });
      }
      // all bugs at once
      for (const id of Object.keys(PATCH.all)) PATCH.apply(id); const z = AL.renderSong('s1', 4, sr, .8), zs = AL.stats(z.L, z.R, sr); PATCH.reset();
      // a broken patch must self-heal
      let healed = false; __T.BUS.on('panic', (e, en) => { healed = en && en.name === 'mu.bass'; });
      LIVE.patch('mu.bass', "return r;", "return r.boom();", 'test'); const h = AL.renderSong('s1', 2, sr, .8), hs = AL.stats(h.L, h.R, sr);
      return { out, all: zs, healed, healedStats: hs, healedSrcClean: LIVE.src['mu.bass'] === __T.AU && false || !LIVE.src['mu.bass'].includes('boom') }; });
    for (const o of r.out) { console.log(`${o.id.padEnd(12)} ${o.name.padEnd(20)} applied ${o.ok} peak ${o.peak} rms ${o.rms} diffRms ${o.diffRms} cured-clean ${o.clean} afterCureMaxDiff ${o.afterCureMaxDiff} bands ${o.spec}`);
      check(o.ok && o.clean && o.afterCureMaxDiff === 0 && o.diffRms > .01 && o.peak <= 1 && !o.nan, 'bug ' + o.id); save('bug-' + o.id + '.png', o.pic); }
    console.log('all bugs at once:', JSON.stringify(r.all)); check(r.all.nan === 0 && r.all.peak <= 1, 'all bugs');
    console.log('broken patch healed:', r.healed, 'src clean:', r.healedSrcClean, 'peak', r.healedStats.peak); check(r.healed && r.healedSrcClean && r.healedStats.nan === 0, 'heal');
  }
  if (phases.includes('live')) {
    console.log('== live AudioContext (rAF loop 4 s) ==');
    const r = await p.evaluate(() => new Promise(res => { const { AU, S } = __T; const ti = performance.now(); AU.init(); const initMs = performance.now() - ti; AU.music('title'); AU.intensity(.7); let worstF = 0;
      let n = 0, cost = 0, worst = 0, beats = 0, prev = 0, last = performance.now(); const lv = [];
      function f(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; const t0 = performance.now(); AU.update(dt); const c = performance.now() - t0; if (n > 30) { cost += c; worst = Math.max(worst, c); } else worstF = Math.max(worstF, c);
        if (S.beat === 1 && prev !== 1) beats++; prev = S.beat; lv.push(AU.level); if (n % 7 === 0) AU.sfx('shoot');
        if (++n < 240) requestAnimationFrame(f); else res({ initMs, worstFirst30: worstF, state: AU._dev.ctx.state, sr: AU._dev.ctx.sampleRate, frames: n, avgMs: cost / (n - 31), worstMs: worst, beats, stat: AU._dev.stat, lvMax: Math.max(...lv), lvMean: lv.reduce((a, b) => a + b) / lv.length, ready: AU.ready }); }
      requestAnimationFrame(f); }));
    console.log(JSON.stringify(r));
    check(r.ready && r.stat.chunks > 100, 'live rendering'); check(r.beats >= 4, 'beats live'); check(r.avgMs < 1.5, 'per-frame cost');
  }
  if (phases.includes('flood')) {
    console.log('== flood: 15 shoot/s + 30 kill/s + music through the real graph (OfflineAudioContext, stepped at 60 fps) ==');
    const r = await p.evaluate(async () => { const { AU } = __T, sr = 48000, secs = 6, oc = new OfflineAudioContext(2, sr * secs, sr);
      AU._dev.attach(oc); AU.music('s5'); AU.intensity(1);
      for (let i = 0; i < 30; i++) AU.update(1 / 60);  // pre-render sfx
      let maxV = 0, f = 0;
      for (let k = 1; k < secs * 60 - 25; k++) { const t = k / 60; oc.suspend(t).then(() => { AU.update(1 / 60); f++;
        if (k % 4 === 0) AU.sfx('shoot', { pan: Math.sin(k) * .8, pitch: 1 + (k % 3) * .05 }); if (k % 2 === 0) AU.sfx('kill', { pan: Math.cos(k) * .5 });
        if (k % 30 === 0) AU.sfx('bigkill'); if (k % 3 === 0) AU.sfx('hit'); if (k % 5 === 0) AU.sfx('pickup'); if (k % 97 === 0) AU.sfx('hurt');
        maxV = Math.max(maxV, AU._dev.voices); oc.resume(); }); }
      const buf = await oc.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), st = AL.stats(L, R, sr);
      let clip = 0; for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) >= .999 || Math.abs(R[i]) >= .999) clip++;
      return { st, clip, maxV, frames: f, stat: AU._dev.stat, pic: AL.picture(L, sr, 'flood: s5 music + 15 shoot/s + 30 kill/s + hits + pickups + bigkills'), wav: AL.wav(L, R, sr) }; });
    console.log(`peak ${r.st.peak} rms ${r.st.rms} clipped samples ${r.clip} max voices ${r.maxV} frames ${r.frames} resyncs ${r.stat.resyncs} bands ${r.st.spec}`);
    check(r.st.nan === 0 && r.st.peak <= 1 && r.clip < 10, 'flood clipping'); check(r.st.silentFrac < .1, 'flood silent gaps ' + r.st.silentFrac);
    save('flood.png', r.pic); fs.writeFileSync(path.join(OUT, 'flood.wav'), Buffer.from(r.wav, 'base64'));
  }
  await b.close();
  console.log(fail ? `FAILED: ${fail}` : 'ALL OK'); process.exit(fail ? 1 : 0);
})();
