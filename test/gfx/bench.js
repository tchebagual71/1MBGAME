(() => {
  const G = GFX, { fb, W, H } = __K, res = {};
  const bench = (name, n, f) => { f(); const t0 = performance.now(); for (let i = 0; i < n; i++) f(i); res[name] = +((performance.now() - t0) / n).toFixed(4) + ' ms'; };
  const line80 = 'const RATE=6, N=1, SPREAD=.12; for(let i=0;i<N;i++) GAME.shoot(p.x,p.y,ax,ay);';
  const page = []; for (let i = 0; i < 25; i++) page.push(line80.slice(0, 80)); const big = page.join('\n');
  bench('text 2000 chars (25x80 lines)', 200, () => G.text(big, 0, 0, -1));
  bench('text 2000 chars clipped partly', 200, () => G.text(big, -30, 40, -1));
  bench('text scale2 400 chars', 200, () => G.text(big.slice(0, 400), 0, 0, -1, 2));
  bench('glow r=12 x100', 100, i => { for (let k = 0; k < 100; k++) G.glow((k * 37) % W, (k * 53) % H, 12, 0xff40c0ff); });
  bench('glow r=60 x10', 100, () => { for (let k = 0; k < 10; k++) G.glow(40 + k * 40, 135, 60, 0xff40c0ff, .5); });
  bench('glowLine 200px w3 x20', 100, () => { for (let k = 0; k < 20; k++) G.glowLine(20, k * 13, 460, 260 - k * 13, 0xff2020ff, 3); });
  bench('shapeG r14 x60', 100, () => { for (let k = 0; k < 60; k++) G.shapeG(G.SH.hex, (k * 37) % W, (k * 53) % H, k, 14, 0xffff00ff); });
  bench('line x1000', 100, () => { for (let k = 0; k < 1000; k++) G.line(k % W, 0, W - k % W, H - 1, -1); });
  bench('disc r10 x200', 100, () => { for (let k = 0; k < 200; k++) G.disc((k * 37) % W, (k * 53) % H, 10, -1); });
  bench('fill star r20 x100', 100, () => { for (let k = 0; k < 100; k++) G.fill(G.SH.star, (k * 37) % W, (k * 53) % H, k, 20, -1); });
  bench('spr chip rot x200', 100, () => { for (let k = 0; k < 200; k++) G.spr('chip', (k * 37) % W, (k * 53) % H, k * .1, 1.5); });
  bench('fade .9', 200, () => G.fade(.9));
  bench('clear', 200, () => G.clear(0));
  const snapb = G.snap(); bench('blit a=.5', 200, () => G.blit(snapb, .5));
  bench('textFx scale6 8ch', 50, () => G.textFx('SELF.MOD', 10, 10, 6, (x, y, u, v) => G.hsv(u, 1, 1)));
  // particles: 3000 live
  G.pClear(); for (let k = 0; k < 30; k++) G.burst(30 + k * 14, 135, 100, 0xff40c0ff, 120, 5, { size: k & 1 ? 1 : 2 });
  const pc = G.pCount();
  bench('pUpdate 3000', 100, () => G.pUpdate(0.0001));
  bench('pDraw 3000 (half size 2 glows)', 50, () => G.pDraw());
  G.pClear(); for (let k = 0; k < 30; k++) G.burst(30 + k * 14, 135, 100, 0xff40c0ff, 120, 5, { size: 1 });
  bench('pDraw 3000 size1', 50, () => G.pDraw());
  G.pClear(); for (let k = 0; k < 30; k++) G.ring(240, 135, 0, 200, -1, 3);
  bench('pDraw 30 big rings', 50, () => G.pDraw());
  G.pClear();
  res.particles = pc;
  return JSON.stringify(res, null, 1);
})()
