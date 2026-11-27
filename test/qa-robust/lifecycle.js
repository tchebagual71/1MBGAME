#!/usr/bin/env node
// Page lifecycle, audio lifecycle and input edge cases on the shipped build. Usage: node test/qa-robust/lifecycle.js [index.html]
const path = require('path');
const { ROOT, launch, collect, sleep } = require('./lib');
const FILE = process.argv[2] || 'index.html';
let fails = 0; const rep = (ok, name, info) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(44) + ' ' + (info || '')); };
const ev = (p, fn, arg) => p.evaluate(fn, arg);

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1, hasTouch: true });
  // dt recorder: max S.dt seen per window
  await ctx.addInitScript(() => { window.__dt = { max: 0, n: 0 }; const f = () => { const M = window.__SM; if (M) { window.__dt.max = Math.max(window.__dt.max, M.S.dt); window.__dt.n++; } requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const p = await ctx.newPage(); const errs = collect(p); const cdp = await ctx.newCDPSession(p);
  await p.goto('file://' + path.join(ROOT, FILE)); await p.waitForFunction(() => window.__SM && window.__SM.S.frame > 5);

  // --- audio only after gesture
  rep(await ev(p, () => !window.__SM.AU._dev.ctx), 'no AudioContext before a gesture');
  await p.mouse.click(480, 270); await sleep(800);
  const au = await ev(p, () => ({ ctx: !!window.__SM.AU._dev.ctx, st: window.__SM.AU._dev.ctx && window.__SM.AU._dev.ctx.state, ready: window.__SM.AU.ready }));
  rep(au.ctx && au.st === 'running', 'AudioContext created+running after click', JSON.stringify(au));

  // --- context suspended externally (OS interruption) -> next gesture resumes it
  await ev(p, () => window.__SM.AU._dev.ctx.suspend()); await sleep(300);
  const sus = await ev(p, () => ({ st: window.__SM.AU._dev.ctx.state, ready: window.__SM.AU.ready }));
  await p.keyboard.press('KeyX'); await sleep(600);
  const res = await ev(p, () => ({ st: window.__SM.AU._dev.ctx.state, ready: window.__SM.AU.ready }));
  rep(sus.st === 'suspended' && !sus.ready && res.st === 'running' && res.ready, 'suspended ctx resumes on next gesture', JSON.stringify([sus, res]));

  // --- mute persists across scenes
  await ev(p, () => { const M = window.__SM; M.RUN.start(); });
  await p.keyboard.press('KeyM'); await sleep(200);
  await ev(p, () => { const M = window.__SM; M.SCENE.go('title'); }); await sleep(200); await ev(p, () => window.__SM.RUN.start()); await sleep(300);
  const mu = await ev(p, () => ({ opt: window.__SM.S.opt.mute, ready: window.__SM.AU.ready }));
  rep(mu.opt === true && mu.ready === false, 'mute persists across title->play', JSON.stringify(mu));
  await p.keyboard.press('KeyM'); await sleep(400);
  rep(await ev(p, () => !window.__SM.S.opt.mute && window.__SM.AU.ready), 'unmute resumes music engine');

  // --- RUN.start spam + rapid music switching
  const v0 = await ev(p, () => window.__SM.AU._dev.voices);
  for (let i = 0; i < 30; i++) await ev(p, () => { const M = window.__SM; M.RUN.start(); M.AU.sfx('kill'); M.AU.sfx('explode'); });
  for (const m of ['title', 's0', 'patch', 's0', 'boss', 'over', 'title', 's3', 'final', 'win', null, 's1']) { await ev(p, m => window.__SM.AU.music(m), m); await sleep(40); }
  await sleep(1500);
  const a2 = await ev(p, () => ({ v: window.__SM.AU._dev.voices, st: window.__SM.AU._dev.stat, song: window.__SM.AU.song, ready: window.__SM.AU.ready }));
  rep(a2.v <= 28 && a2.ready, 'RUN.start x30 + music switch storm', JSON.stringify(a2));

  // --- hidden 30 s (page frozen: rAF + timers stop) then visible
  await ev(p, () => { window.__dt.max = 0; });
  await ev(p, () => { const M = window.__SM; M.RUN.start(); });
  const rs0 = await ev(p, () => window.__SM.AU._dev.stat.resyncs);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(30000); await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await sleep(1500);
  const fr = await ev(p, () => ({ max: window.__dt.max, ready: window.__SM.AU.ready, st: window.__SM.AU._dev.ctx.state, res: window.__SM.AU._dev.stat.resyncs, mode: window.__SM.S.mode }));
  rep(fr.max <= 0.0501 && fr.ready, 'frozen 30 s -> active: dt clamped, audio live', JSON.stringify(fr) + ' resyncs before ' + rs0);

  // --- visibilitychange hidden: keys released + auto pause
  await ev(p, () => { const M = window.__SM; M.RUN.start(); }); await sleep(300);
  await p.keyboard.down('KeyD'); await sleep(100);
  await ev(p, () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(150);
  const vh = await ev(p, () => ({ mode: window.__SM.S.mode, d: window.__SM.IN.key('KeyD') }));
  await ev(p, () => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await p.keyboard.up('KeyD');
  rep(vh.mode === 'pause' && !vh.d, 'visibility hidden -> pause, keys released', JSON.stringify(vh));

  // --- blur: stuck key + mouse released, pause
  await ev(p, () => { const M = window.__SM; M.RUN.start(); }); await sleep(300);
  await p.keyboard.down('KeyW'); await p.mouse.move(600, 300); await p.mouse.down(); await sleep(100);
  const pre = await ev(p, () => ({ w: window.__SM.IN.key('KeyW'), f: window.__SM.IN.fire }));
  await ev(p, () => dispatchEvent(new Event('blur'))); await sleep(120);
  const bl = await ev(p, () => ({ mode: window.__SM.S.mode, w: window.__SM.IN.key('KeyW'), mb: window.__SM.IN._mb }));
  await p.keyboard.up('KeyW'); await p.mouse.up();
  rep(pre.w && pre.f && bl.mode === 'pause' && !bl.w && !bl.mb, 'blur -> pause, keyboard+mouse released', JSON.stringify([pre, bl]));

  // --- mouseup lost outside the window: next mousemove resyncs from e.buttons
  await ev(p, () => { const M = window.__SM; M.RUN.start(); }); await sleep(200);
  await ev(p, () => { dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: 500, clientY: 300 })); }); await sleep(60);
  await ev(p, () => { dispatchEvent(new MouseEvent('mousemove', { buttons: 0, clientX: 510, clientY: 300 })); }); await sleep(60);
  rep(await ev(p, () => !window.__SM.IN.fire), 'lost mouseup recovered via e.buttons');

  // --- Cmd-held keyup loss on macOS: Meta keyup clears keys
  await ev(p, () => { dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' })); dispatchEvent(new KeyboardEvent('keydown', { code: 'MetaLeft', key: 'Meta', metaKey: true })); dispatchEvent(new KeyboardEvent('keyup', { code: 'MetaLeft', key: 'Meta' })); });
  rep(await ev(p, () => !window.__SM.IN.key('KeyA')), 'Meta keyup clears stuck keys');
  // --- empty e.code (virtual keyboards)
  await ev(p, () => { dispatchEvent(new KeyboardEvent('keydown', { code: '', key: 'p' })); }); await sleep(100);
  rep(await ev(p, () => window.__SM.S.mode === 'pause'), 'keydown with empty code (key "p") pauses');
  await ev(p, () => { dispatchEvent(new KeyboardEvent('keyup', { code: '', key: 'p' })); });

  // --- touch: stick ownership by identifier, crossing halves, 3rd finger, touchcancel no tap
  await ev(p, () => { const M = window.__SM; M.RUN.start(); }); await sleep(200);
  const touch = await ev(p, async () => {
    const M = window.__SM, cv = document.querySelector('canvas'), r = cv.getBoundingClientRect();
    const T = (id, fx, fy) => new Touch({ identifier: id, target: cv, clientX: r.left + fx / 480 * r.width, clientY: r.top + fy / 270 * r.height });
    const fire = (type, ch, all) => cv.dispatchEvent(new TouchEvent(type, { changedTouches: ch, touches: all, bubbles: true, cancelable: true }));
    const out = {}; const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const a = T(1, 100, 150); fire('touchstart', [a], [a]);
    const a2 = T(1, 300, 150); fire('touchmove', [a2], [a2]);                 // left finger crosses into the right half
    const c = T(2, 400, 100); fire('touchstart', [c], [a2, c]);
    const d = T(3, 420, 200); fire('touchstart', [d], [a2, c, d]);          // 3rd finger
    await raf(); out.s0 = M.IN.sticks[0].on && M.IN.sticks[0].id === 1; out.s1 = M.IN.sticks[1].on && M.IN.sticks[1].id === 2; out.mvx = M.IN.mvx;
    fire('touchcancel', [c], [a2, d]); await raf(); out.cancelNoDash = !M.IN.dash; out.s1off = !M.IN.sticks[1].on;
    // lost touchend: next touchstart lists only the new finger -> stale stick 0 dropped
    const e = T(4, 380, 120); fire('touchstart', [e], [e]); out.stale0 = !M.IN.sticks[0].on; out.s1new = M.IN.sticks[1].id === 4;
    fire('touchend', [e], []); fire('touchend', [d], []); await raf(); out.dashTap = true; return out; });
  rep(touch.s0 && touch.s1 && touch.mvx > .9 && touch.cancelNoDash && touch.s1off && touch.stale0 && touch.s1new, 'multi-touch ownership / cancel / stale', JSON.stringify(touch));

  // --- gamepad connect / map / disconnect
  const gp = await ev(p, async () => {
    const M = window.__SM; M.RUN.start(); const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const btn = n => Array.from({ length: 17 }, (_, i) => ({ pressed: n.includes(i), value: n.includes(i) ? 1 : 0 }));
    let pad = { connected: true, axes: [0, 0, 0, 0], buttons: btn([]) }; const orig = navigator.getGamepads; navigator.getGamepads = () => [null, pad];
    const out = {}; await raf();
    pad = { connected: true, axes: [.9, 0, 0, -.9], buttons: btn([7]) }; await raf(); out.move = M.IN.mvx > .8; out.aim = M.IN.ay < -.9 && M.IN.fire;
    pad = { connected: true, axes: [0, 0, 0, 0], buttons: btn([9]) }; await raf(); out.pause = M.S.mode === 'pause';
    pad = { connected: true, axes: [0, 0, 0, 0], buttons: btn([]) }; await raf();
    pad = { connected: true, axes: [0, 0, 0, 0], buttons: btn([13]) }; await raf(); out.dpad = true;
    pad = { connected: true, axes: [0, 0, 0, 0], buttons: btn([0]) }; await raf();       // A held while disconnecting
    navigator.getGamepads = () => [null, null]; await raf(); out.padReset = M.IN._pad === 0;
    navigator.getGamepads = () => { throw new DOMException('blocked', 'SecurityError'); }; await raf(); out.throwOk = M.S.frame > 0;
    navigator.getGamepads = orig; return out; });
  rep(gp.move && gp.aim && gp.pause && gp.padReset && gp.throwOk, 'gamepad map / disconnect / throwing API', JSON.stringify(gp));

  // --- letterboxed pointer mapping (portrait window): fb coords of canvas corners
  await p.setViewportSize({ width: 500, height: 900 }); await sleep(300);
  const lb = await ev(p, () => { const r = document.querySelector('canvas').getBoundingClientRect(), M = window.__SM;
    dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); const c = [M.IN.mx, M.IN.my];
    dispatchEvent(new MouseEvent('mousemove', { clientX: r.left, clientY: r.top })); const tl = [M.IN.mx, M.IN.my];
    dispatchEvent(new MouseEvent('mousemove', { clientX: r.right, clientY: r.bottom })); const br = [M.IN.mx, M.IN.my]; return { r: [r.left, r.top, r.width, r.height], c, tl, br }; });
  rep(Math.abs(lb.c[0] - 240) < 1 && Math.abs(lb.c[1] - 135) < 1 && Math.abs(lb.tl[0]) < 1 && Math.abs(lb.br[1] - 270) < 1, 'letterboxed pointer -> fb coords', JSON.stringify(lb));
  await p.setViewportSize({ width: 960, height: 540 });

  // --- page scroll / zoom prevention
  const pv = await ev(p, () => { const k = new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true }); dispatchEvent(k); const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: 5, cancelable: true }); dispatchEvent(w);
    const cm = new MouseEvent('contextmenu', { cancelable: true }); dispatchEvent(cm); return [k.defaultPrevented, w.defaultPrevented, cm.defaultPrevented, getComputedStyle(document.body).touchAction]; });
  rep(pv[0] && pv[1] && pv[2] && pv[3] === 'none', 'space/ctrl-wheel/contextmenu prevented, touch-action none', JSON.stringify(pv));

  // --- WebGL context loss + restore
  await ev(p, () => { const M = window.__SM; M.RUN.start(); M.S.opt.crt = true; });
  const cl = await ev(p, async () => { const M = window.__SM, cv = document.querySelector('canvas'); const gl = cv.getContext(M.POST.mode === 'webgl2' ? 'webgl2' : 'webgl'); const x = gl && gl.getExtension('WEBGL_lose_context');
    if (!x) return { skip: M.POST.mode }; const w = ms => new Promise(r => setTimeout(r, ms)); x.loseContext(); await w(600); const f1 = M.S.frame; await w(300); const runs = M.S.frame > f1; x.restoreContext(); await w(1200);
    return { lost: M.POST.stats.lost, runs, frame: M.S.frame, isLost: gl.isContextLost() }; });
  await sleep(300); await p.screenshot({ path: path.join(__dirname, 'out/ctxrestore.png') });
  const lum = await ev(p, () => { const c = document.createElement('canvas'); return 0; });
  rep(cl.lost >= 1 && cl.runs && !cl.isLost, 'webgl context lost -> restored', JSON.stringify(cl));

  await sleep(500);
  rep(!errs.length, 'no console errors / page errors', errs.slice(0, 8).join(' || '));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
