// ===== test driver for POST (concatenated after kernel + 70-post.js) =====
const TEST = (() => {
  // tiny 3x5 font for orientation labels
  const F = { T: '111010010010010', O: '111101101101111', P: '111101111100100', B: '110101110101110', M: '101111111101101', L: '100100100100111', R: '110101110101101',
    A: '010101111101101', S: '111100111001111', E: '111100110100111', '0': '111101101101111', '1': '010110010010111', ' ': '000000000000000', G: '111100101101111' };
  const txt = (s, x, y, c, k = 1) => { for (const ch of s) { const g = F[ch] || F[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') rect(x + (i % 3) * k, y + (i / 3 | 0) * k, k, k, c); x += 4 * k; } };
  const rect = (x, y, w, h, c) => { for (let j = Math.max(0, y | 0); j < Math.min(H, y + h); j++) for (let i = Math.max(0, x | 0); i < Math.min(W, x + w); i++) fb[j * W + i] = c; };
  const pats = {
    bars() { fb.fill(C.black);
      const cols = [rgb(255, 255, 255), rgb(255, 255, 0), rgb(0, 255, 255), rgb(0, 255, 0), rgb(255, 0, 255), rgb(255, 0, 0), rgb(0, 0, 255), rgb(0, 0, 0)];
      for (let i = 0; i < 8; i++) rect(i * 60, 0, 60, 120, cols[i]);
      for (let x = 0; x < W; x++) { const v = x * 255 / (W - 1) | 0; rect(x, 120, 1, 30, rgb(v, v, v)); rect(x, 150, 1, 15, rgb(v, 0, 0)); rect(x, 165, 1, 15, rgb(0, v, 0)); rect(x, 180, 1, 15, rgb(0, 0, v)); }
      for (let y = 195; y < H; y++) for (let x = 0; x < W; x++) fb[y * W + x] = x < 120 ? (((x + y) & 1) ? C.white : C.black) : x < 240 ? ((x & 1) ? C.white : C.black) : x < 360 ? ((y & 1) ? C.white : C.black) : (((x >> 1) + (y >> 1)) & 1 ? C.cyan : C.magenta); },
    checker() { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fb[y * W + x] = ((x + y) & 1) ? C.white : C.black; },
    gratings() { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fb[y * W + x] = y < 90 ? ((x & 1) ? C.white : C.black) : y < 180 ? ((y & 1) ? C.white : C.black) : ((x % 3) === 0 ? C.yellow : C.black); },
    orient() { fb.fill(rgb(30, 30, 40)); rect(0, 0, 40, 40, rgb(255, 0, 0)); rect(W - 40, 0, 40, 40, rgb(0, 255, 0)); rect(0, H - 40, 40, 40, rgb(0, 0, 255)); rect(W - 40, H - 40, 40, 40, C.white);
      txt('TOP', 200, 10, C.white, 4); txt('BOTTOM', 180, 230, C.yellow, 4); txt('L', 60, 120, C.red, 5); txt('R', 400, 120, C.green, 5);
      for (let i = 0; i < W; i++) fb[i] = C.yellow; for (let i = 0; i < W; i++) fb[(H - 1) * W + i] = C.cyan; },
    text() { fb.fill(rgb(8, 10, 20)); let s = 'ABLMOPRST01 '; for (let r = 0; r < 40; r++) txt((s + s + s + s + s + s + s + s + s).slice(r % 7, r % 7 + 110), 2, 2 + r * 6.6 | 0, r & 1 ? C.white : C.green, 1); },
    dots() { fb.fill(C.black); srand(7); for (let i = 0; i < 300; i++) { const x = rndi(W), y = rndi(H); fb[y * W + x] = pick([C.white, C.cyan, C.magenta, C.yellow, C.red]); }
      for (let i = 0; i < 12; i++) rect(20 + i * 38, 200, 2 + (i % 3), 2 + (i % 3), C.white); },
    game(t = 0) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = Math.sin(x * .03 + t) + Math.sin(y * .04 - t * .7) + Math.sin((x + y) * .02 + t * .3);
        fb[y * W + x] = rgb(40 + 30 * Math.sin(v * 2), 20 + 20 * Math.sin(v * 2 + 2), 60 + 40 * Math.sin(v * 2 + 4)); }
      rect(0, 0, W, 16, rgb(10, 10, 20)); txt('SCORE 0001010', 4, 4, C.white, 1); txt('SECTOR 1', 400, 4, C.cyan, 1);
      for (let i = 0; i < 5; i++) rect(200 + i * 8, 5, 6, 6, C.red);
      const px = 240 + Math.sin(t) * 60 | 0, py = 150; for (let k = -6; k <= 6; k++) { rect(px + k, py + Math.abs(k), 1, 1, C.cyan); } rect(px - 1, py - 2, 3, 3, C.white);
      for (let i = 0; i < 20; i++) rect(px + i * 9 - 90, py - 20 - i * 4, 2, 2, C.yellow);
      srand(3); for (let i = 0; i < 14; i++) { const ex = 30 + rndi(420), ey = 30 + rndi(200), r = 5; for (let a = 0; a < 24; a++) rect(ex + Math.cos(a / 24 * TAU) * r | 0, ey + Math.sin(a / 24 * TAU) * r | 0, 1, 1, i & 1 ? C.magenta : C.orange); }
      for (let i = 0; i < 40; i++) rect(100 + i * 7, 240 + (i % 5), 2, 2, C.red); }
  };
  let cur = 'bars';
  const tmp = document.createElement('canvas'), tc = tmp.getContext('2d', { willReadFrequently: true });
  const lum = (d, n, step) => { let s = 0, k = 0; for (let i = 0; i < n; i += 4 * step) { s += .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; k++; } return s / k; };
  const api = {
    pat(n) { cur = n; pats[n](S.t); return n; },
    set(o) { for (const k in o) { if (k === 'crt') S.opt.crt = o[k]; else S[k] = o[k]; } },
    step(n = 1, dt = 1 / 60, keep) { let out = null; for (let i = 0; i < n; i++) { S.dt = dt; S.t += dt; S.frame++; if (cur === 'game') pats.game(S.t);
        if (keep) for (const k in keep) S[k] = keep[k]; POST.present(dt); } return out; },
    measure() { POST.present(1 / 60); tmp.width = CV.width; tmp.height = CV.height; tc.drawImage(CV, 0, 0);
      const d = tc.getImageData(0, 0, tmp.width, tmp.height).data; const o = lum(d, d.length, 1), s = lum(new Uint8Array(fb.buffer), fb.length * 4, 1);
      return { src: +s.toFixed(2), out: +o.toFixed(2), ratio: +(o / s).toFixed(3), w: CV.width, h: CV.height }; },
    raf(n = 120) { return new Promise(res => { let i = 0, tot = 0, mx = 0; const f = () => { if (cur === 'game') pats.game(S.t += 1 / 60); const t0 = performance.now(); POST.present(1 / 60); const ms = performance.now() - t0; if (i > 10) { tot += ms; mx = Math.max(mx, ms); }
      if (++i < n) requestAnimationFrame(f); else res({ avg: +(tot / (n - 11)).toFixed(3), max: +mx.toFixed(3) }); }; requestAnimationFrame(f); }); },
    bench(n = 200) { const t0 = performance.now(); for (let i = 0; i < n; i++) POST.present(1 / 60); return (performance.now() - t0) / n; },
    patch: id => PATCH.apply(id), cure: id => PATCH.cure(id), stats: () => POST.stats, mode: () => POST.mode,
    src: n => LIVE.src[n], livepatch: (n, a, b) => LIVE.patch(n, a, b)
  };
  window.T = api;
  window.__SM = { S, LIVE, PATCH, BUS, fb };
  fit(); POST.init(CV); api.pat('bars'); api.step(2);
  return api;
})();
