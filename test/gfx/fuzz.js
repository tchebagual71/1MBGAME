(() => {
  const { fb, W, H } = __K, G = GFX, N = W * H;
  const pool = [NaN, Infinity, -Infinity, 1e30, -1e30, 1e9, -1e9, -5, 0, .5, 239.7, 480, 270, 479.99, 269.99, -0.0001, undefined, null, 'abc', '12', {}, [], 3, 17.3, -40, 600, true, 2.5];
  const R = () => Math.random() < .55 ? pool[Math.random() * pool.length | 0] : (Math.random() * 700 - 110);
  const C = () => Math.random() < .2 ? pool[Math.random() * pool.length | 0] : (Math.random() * 4294967296) >>> 0;
  const ptsR = () => { const r = Math.random(); if (r < .1) return null; if (r < .2) return [1, 2]; if (r < .3) return [NaN, 1, 2, NaN, 5, 5]; if (r < .4) return G.SH.star; const a = []; for (let i = 0; i < (Math.random() * 40 | 0); i++) a.push(R()); return a; };
  const S = () => { const r = Math.random(); return r < .1 ? null : r < .2 ? 12345 : r < .3 ? '\n\n\nx\n' : r < .4 ? '♥中😀\x7f\x93\x94' : 'HELLO world {}[]'.repeat(Math.random() * 4 | 0); };
  const calls = {
    clear: () => [C()], fade: () => [R()], pset: () => [R(), R(), C()], add: () => [R(), R(), C()], rect: () => [R(), R(), R(), R(), C()], rectA: () => [R(), R(), R(), R(), C(), R()],
    rectAdd: () => [R(), R(), R(), R(), C()], frame: () => [R(), R(), R(), R(), C()], line: () => [R(), R(), R(), R(), C()], lineA: () => [R(), R(), R(), R(), C()],
    glowLine: () => [R(), R(), R(), R(), C(), R(), R()], circ: () => [R(), R(), R(), C()], circA: () => [R(), R(), R(), C(), R()], disc: () => [R(), R(), R(), C()], discA: () => [R(), R(), R(), C()],
    discB: () => [R(), R(), R(), C(), R()], glow: () => [R(), R(), R(), C(), R()], tri: () => [R(), R(), R(), R(), R(), R(), C()], triA: () => [R(), R(), R(), R(), R(), R(), C()],
    shape: () => [ptsR(), R(), R(), R(), R(), C(), Math.random() < .5], shapeG: () => [ptsR(), R(), R(), R(), R(), C(), R()], fill: () => [ptsR(), R(), R(), R(), R(), C()], fillA: () => [ptsR(), R(), R(), R(), R(), C()],
    text: () => [S(), R(), R(), C(), R()], textW: () => [S(), R()], textC: () => [S(), R(), R(), C(), R()], textR: () => [S(), R(), R(), C(), R()], textO: () => [S(), R(), R(), C(), R(), C()], textS: () => [S(), R(), R(), C(), R(), C()],
    textFx: () => [S(), R(), R(), R(), Math.random() < .5 ? (x, y, u, v) => (u * 255) | 0 : C()], hsv: () => [R(), R(), R()], mix: () => [C(), C(), R()], scale: () => [C(), R()],
    spr: () => [['orb', 'bit', 'nope', 'chip', null][Math.random() * 5 | 0], R(), R(), R(), R(), Math.random() < .5 ? undefined : C(), Math.random() * 3 | 0],
    sprDef: () => ['fz', R(), R(), [(x, y) => x * y, [1, 2, 3], '..##', null, new Uint32Array(5)][Math.random() * 5 | 0]],
    burst: () => [R(), R(), Math.random() < .1 ? 1e6 : R(), C(), R(), R(), Math.random() < .5 ? { grav: R(), drag: R(), size: R(), spread: R(), ang: R() } : undefined],
    spark: () => [R(), R(), R(), R(), C(), R(), R()], ring: () => [R(), R(), R(), R(), C(), R()], floatText: () => [S(), R(), R(), C(), R()],
    bolt: () => [R(), R(), R(), R(), C(), R()], boltNow: () => [R(), R(), R(), R(), C(), R()],
    pUpdate: () => [Math.random() < .5 ? R() : 1 / 60], pDraw: () => [], pClear: () => [Math.random()],
    snap: () => [Math.random() < .5 ? new Uint32Array(N) : null], copy: () => [new Uint32Array(N), Math.random() < .5 ? fb : new Uint32Array(10)], blit: () => [Math.random() < .5 ? new Uint32Array(N).fill(0xff00ff00) : [1, 2], R(), Math.random() < .5],
  };
  const missing = Object.keys(calls).filter(k => typeof G[k] !== 'function');
  let errs = [], n = 0;
  for (let it = 0; it < 3000; it++) for (const k in calls) { const a = calls[k](); try { G[k](...a); n++; } catch (e) { if (errs.length < 10) errs.push(k + ' ' + e.message + ' args=' + JSON.stringify(a.map(v => typeof v === 'function' ? 'fn' : v)).slice(0, 200)); } }
  // alpha check
  let badA = 0; for (let i = 0; i < N; i++) if ((fb[i] >>> 24) !== 255) badA++;
  // wrap-around check: shapes fully off-screen must not change fb
  const offs = [[-60, 100], [W + 60, 100], [200, -60], [200, H + 60], [-0.6, 100], [W + .2, 100]];
  let wrap = [];
  for (const [x, y] of offs) {
    fb.fill(0xff000000);
    const tests = {
      disc: () => G.disc(x, y, 20, -1), circ: () => G.circ(x, y, 20, -1), glow: () => G.glow(x, y, 20, -1), rect: () => G.rect(x - 21, y - 21, 20, 20, -1),
      line: () => G.line(x - 20, y - 20, x - 1, y + 20, -1), text: () => G.text('WWWW', x + (x < 0 ? -25 : 0), y + (y < 0 ? -10 : 0), -1, 1),
      text2: () => G.text('WWWW', x + (x < 0 ? -50 : 0), y + (y < 0 ? -20 : 0), -1, 2), shape: () => G.shape(G.SH.star, x + (x < 0 ? -21 : 21), y, 0, 20, -1),
      fill: () => G.fill(G.SH.star, x + (x < 0 ? -21 : 21), y, 0, 20, -1), spr: () => G.spr('chip', x + (x < 0 ? -10 : 10), y + (y < 0 ? -10 : 10), .5, 1, -1)
    };
    for (const t in tests) { if (Math.abs(x - Math.round(x)) > .01 && /glow|disc|circ/.test(t) === false) continue; fb.fill(0xff000000); tests[t](); let ch = 0; for (let i = 0; i < N; i++) if (fb[i] !== 0xff000000) ch++; if (ch && !(x > -1 && x < 0) && !(x >= W && x < W + 1)) wrap.push(t + '@' + x + ',' + y + ':' + ch); }
  }
  // edge-precise: disc centred exactly off left edge must not wrap to previous row's right end
  fb.fill(0xff000000); G.disc(-.5, 100, 30, -1); let wr = 0; for (let y = 0; y < H; y++) if (fb[y * W + W - 1] !== 0xff000000) wr++;
  fb.fill(0xff000000); G.text('W', -3, 100, -1); for (let y = 0; y < H; y++) if (fb[y * W + W - 1] !== 0xff000000) wr++;
  fb.fill(0xff000000); G.glowLine(-10, 50, 10, 200, -1, 5); for (let y = 0; y < H; y++) if (fb[y * W + W - 1] !== 0xff000000) wr++;
  fb.fill(0xff000000); G.spr('orb', 1, 100, 1, 3); for (let y = 0; y < H; y++) if (fb[y * W + W - 1] !== 0xff000000) wr++;
  G.pClear();
  return JSON.stringify({ calls: n, errors: errs, missing, badAlpha: badA, wrap, edgeWrapPx: wr });
})()
