// ===== 20-fx.js : FX — demoscene backgrounds. Every per-pixel kernel is SOURCE TEXT generated from templates with
// named tunables and compiled through LIVE (a tiny JIT), so patches can rewrite the running visuals. =====
const FX = (() => {
  const N = W * H, HW = W >> 1, HH = H >> 1;
  const A = new Uint32Array(N), B = new Uint32Array(N);      // current / previous effect frames (no alpha)
  const L = new Uint8ClampedArray(256);                          // tone LUT (dim, beat, kick baked in by fx.tone)
  const E = {}, names = [], pend = [];
  let prev = null, fadeT = 0, fadeD = 0, ft = 37, kick = 0, frameN = 0, pOdd = 0;

  // ---------- init-time helpers ----------
  const col = (r, g, b) => rgb(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)) & 0xffffff;
  const cr = c => c & 255, cg = c => c >> 8 & 255, cb = c => c >> 16 & 255;
  const scl = (c, k) => col(cr(c) * k, cg(c) * k, cb(c) * k);
  const grad = (st, cyc) => { const p = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / (cyc ? 256 : 255); let j = 0; while (j < st.length - 2 && x > st[j + 1][0]) j++;
      const a = st[j], c = st[j + 1], f = sstep(a[0], c[0], x); p[i] = col(lerp(a[1], c[1], f), lerp(a[2], c[2], f), lerp(a[3], c[3], f)); }
    return p; };
  const SN = new Uint8Array(1024); for (let i = 0; i < 1024; i++) SN[i] = 127.5 + 127.49 * Math.sin(i * TAU / 1024);
  const hash = (i, o, s) => { let h = Math.imul(i ^ Math.imul(o + 1, 0x9e3779b1) ^ Math.imul(s + 7, 0x85ebca6b), 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  const sm = x => x * x * (3 - 2 * x);
  const fbm = (sz, oct, seed, base) => { // tileable value-noise fbm, normalised 0..1
    const out = new Float32Array(sz * sz); let amp = 1;
    for (let o = 0; o < oct; o++) { const n = base << o, g = new Float32Array(n * n), cs = sz / n; if (n > sz) break;
      for (let i = 0; i < n * n; i++) g[i] = hash(i, o, seed);
      for (let y = 0; y < sz; y++) { const gy = y / cs, y0 = gy | 0, fy = sm(gy - y0), y1 = (y0 + 1) % n;
        for (let x = 0; x < sz; x++) { const gx = x / cs, x0 = gx | 0, fx = sm(gx - x0), x1 = (x0 + 1) % n;
          out[y * sz + x] += amp * lerp(lerp(g[y0 * n + x0], g[y0 * n + x1], fx), lerp(g[y1 * n + x0], g[y1 * n + x1], fx), fy); } }
      amp *= .5; }
    let lo = 1e9, hi = -1e9; for (let i = 0; i < out.length; i++) { lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]); }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1); return out; };
  // the JIT: named tunables + body template -> LIVE source (players read & patch this)
  const jit = (name, K, body, args) => LIVE.def('fx.' + name, args || 'o, t, dt, b, k, Z',
    '// fx.' + name + ' — generated kernel\nconst ' + Object.keys(K).map(a => a + ' = ' + K[a]).join(', ') + ';\n' + body.trim());
  // expression template: sum of sine-table terms  sn[(v * f + T * s) & 1023]
  const terms = (v, list) => list.map(([f, s]) => 'sn[(' + v + ' * ' + f + ' + T * ' + s + ') & 1023]').join(' + ');

  // ---------- shared live kernels: clock, tone, 2x upscaler, scanout (every effect goes through fx.out) ----------
  LIVE.def('fx.clock', 't, dt, b, k', `// fx.clock — demo time base for every effect
const RATE = 1, PUSH = .35, SURGE = 1.5;
return t + dt * (RATE + b * PUSH + k * SURGE);`);
  LIVE.def('fx.tone', 'L, dim, b, k', `// fx.tone — brightness curve; caps channels so gameplay stays readable at low dim
const CAP = 110, GAMMA = .92, FLOOR = 3, PULSE = .1, PUNCH = .55;
const g = dim * (1 + b * PULSE + k * PUNCH), cap = dim <= .4 ? CAP : Math.min(255, CAP + (dim - .4) * 600);
const gm = lerp(GAMMA, 1, dim), fl = FLOOR * dim;
for (let v = 0; v < 256; v++) L[v] = Math.min(cap, fl + (255 - fl) * g * Math.pow(v / 255, gm));`);
  LIVE.def('fx.up2', 's, pal, o', `// fx.up2 — 240x135 index field -> 480x270 through a palette, bilinear
for (let y = 0; y < ${HH}; y++) {
  const r0 = y * ${HW}, r1 = (y < ${HH - 1} ? y + 1 : y) * ${HW};
  let d0 = y * ${W * 2}, d1 = d0 + ${W};
  for (let x = 0; x < ${HW}; x++) {
    const xn = x < ${HW - 1} ? x + 1 : x, a = s[r0 + x], q = s[r0 + xn], c = s[r1 + x], d = s[r1 + xn];
    o[d0++] = pal[a]; o[d0++] = pal[(a + q) >> 1];
    o[d1++] = pal[(a + c) >> 1]; o[d1++] = pal[(a + q + c + d) >> 2];
  }
}`);
  LIVE.def('fx.out', 's, d, L, t, b', `// fx.out — scanout: effect frame -> fb through the tone LUT
const ROLL = 0, SKEW = 0, SKEWF = .043;
const roll = (((t * ROLL) % H + H) % H) | 0;
for (let y = 0; y < H; y++) {
  const sy = (y + roll) % H, si = sy * W;
  let sx = ((((SKEW * Math.sin(sy * SKEWF + t * 9) * (1 + Math.sin(t * 1.7))) | 0) % W) + W) % W;
  for (let x = 0, di = y * W; x < W; x++, di++) {
    const c = s[si + sx];
    d[di] = 0xff000000 | L[c >> 16 & 255] << 16 | L[c >> 8 & 255] << 8 | L[c & 255];
    if (++sx === W) sx = 0;
  }
}`);

  // ---------- effect registry ----------
  const def = (name, fx) => { if (!E[name]) names.push(name); E[name] = fx; fx.ok = false; fx.Z = fx.Z || {}; pend.push(name); return fx; };
  const init = fx => { if (!fx.ok) { fx.ok = true; if (fx.init) fx.init(fx.Z); } };
  const live = (name, fx) => { fx.draw = fx.draw || ((t, dt, o, b, k) => LIVE.fn['fx.' + name](o, t, dt, b, k, fx.Z)); return def(name, fx); };

  // ===== PLASMA — four sine fields + a wandering radial ripple, cyclic palette =====
  jit('plasma', { SPEED: 1, RING: 9, ORBIT: 110, CYCLE: 26, BEAT: 30 }, `
const sn = Z.sn, pal = Z.pal, cx = Z.cx, cy = Z.cy, T = t * SPEED;
for (let x = 0; x < W; x++) cx[x] = ${terms('x', [[5, 70], [3, -43]])};
for (let y = 0; y < H; y++) cy[y] = ${terms('y', [[4, 52], [7, -37]])};
const px = W / 2 + ORBIT * 1.5 * Math.sin(T * .37), py = H / 2 + ORBIT * .8 * Math.cos(T * .29);
const rot = (T * CYCLE + b * BEAT + k * 90) | 0;
for (let y = 0, i = 0; y < H; y++) {
  const dy2 = (y - py) * (y - py), ry = cy[y] + rot * 4;
  for (let x = 0; x < W; x++, i++) {
    const dx = x - px, r = Math.sqrt(dx * dx + dy2) * RING;
    o[i] = pal[((cx[x] + ry + sn[(r - T * 90) & 1023] + sn[(r * .5 + x * 2 - T * 40) & 1023]) >> 2) & 255];
  }
}`);
  live('plasma', { init(Z) {
    Z.sn = SN; Z.cx = new Int32Array(W); Z.cy = new Int32Array(H);
    Z.pal = grad([[0, 8, 2, 30], [.14, 70, 10, 120], [.27, 215, 40, 150], [.36, 255, 170, 90], [.44, 200, 40, 140], [.56, 30, 10, 80],
      [.66, 10, 50, 140], [.76, 30, 190, 220], [.84, 160, 250, 255], [.92, 30, 60, 150], [1, 8, 2, 30]], 1);
  } });

  // ===== TUNNEL — precomputed polar map (window slides over a 2x map so the centre wanders) =====
  jit('tunnel', { SPIN: 26, SPEED: 110, SWAY: 1, GLOW: 6 }, `
const mp = Z.mp, tex = Z.tex, sp = Z.sp, MW = Z.mw;
const ox = (Z.ox * (1 + .9 * SWAY * Math.sin(t * .61))) | 0, oy = (Z.oy * (1 + .85 * SWAY * Math.sin(t * .83 + 1))) | 0;
const ru = (t * SPIN + 40 * Math.sin(t * .3)) & 255, rv = (t * SPEED + k * 60) & 255, lift = (b * GLOW) | 0;
for (let y = 0, i = 0; y < H; y++) {
  for (let x = 0, j = (y + oy) * MW + ox; x < W; x++, i++, j++) {
    const m = mp[j];
    o[i] = sp[((m >> 16) + lift) << 8 | tex[(((m >> 8) + rv) & 255) << 8 | ((m + ru) & 255)]];
  }
}`);
  live('tunnel', { init(Z) {
    const OX = 120, OY = 70, MW = W + 2 * OX, MH = H + 2 * OY, mp = new Uint32Array(MW * MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const dx = x - MW / 2 + .5, dy = y - MH / 2 + .5, d = Math.sqrt(dx * dx + dy * dy) + .01;
      const u = (Math.atan2(dy, dx) / TAU * 512) & 255, v = (7000 / d) & 255, s = Math.min(23, Math.pow(d / 210, .8) * 23) | 0;
      mp[y * MW + x] = u | v << 8 | s << 16; }
    const tex = new Uint8Array(65536);
    for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) { const gu = u & 31, gv = v & 63;
      let c = 40 + (((u * 3) ^ (v * 2)) & 63) + (((u >> 5) + (v >> 6)) & 1) * 30;
      const gw = v & 31; if (gu < 2 || gw < 2) c = 160 + (gu + gw) * 6; else if (gu === 2 || gw === 2) c = 15;
      if (((v >> 6) & 3) === 1 && gu > 10 && gu < 22 && gv > 26 && gv < 38) c = 200 + ((gu + gv) & 7) * 7;   // light strips
      tex[v << 8 | u] = c; }
    const pal = grad([[0, 0, 0, 0], [.2, 10, 20, 50], [.45, 30, 90, 140], [.6, 70, 170, 210], [.7, 160, 240, 255], [.76, 240, 255, 255],
      [.78, 120, 20, 150], [.9, 255, 60, 200], [1, 255, 200, 255]]);
    const sp = new Uint32Array(32 * 256);
    for (let l = 0; l < 32; l++) { const k = Math.pow(Math.min(l, 23) / 23, 1.4) * (1 + Math.max(0, l - 23) * .06); for (let i = 0; i < 256; i++) sp[l << 8 | i] = scl(pal[i], k); }
    Object.assign(Z, { mp, tex, sp, mw: MW, ox: OX, oy: OY });
  } });

  // ===== ROTOZOOM — fixed-point incremental rotate/zoom of a tiled pattern, colour cycling =====
  jit('rotozoom', { ZOOM: 1.05, ZAMP: .55, SPIN: .27, PAN: 38, CYCLE: 40 }, `
const tex = Z.tex, pal = Z.pal;
const a = t * SPIN + Math.sin(t * .23) * 1.3, z = (ZOOM + ZAMP * Math.sin(t * .41)) * (1 - k * .35);
const du = Math.cos(a) * z * 256 | 0, dv = Math.sin(a) * z * 256 | 0, rot = (t * CYCLE + b * 20) | 0;
let u0 = t * PAN * 256 - 240 * du + 135 * dv, v0 = t * PAN * 154 - 240 * dv - 135 * du;
for (let y = 0, i = 0; y < H; y++, u0 -= dv, v0 += du) {
  let u = u0 | 0, v = v0 | 0;
  for (let x = 0; x < W; x++, i++, u += du, v += dv) o[i] = pal[(tex[(v >> 8 & 255) << 8 | (u >> 8 & 255)] + rot) & 255];
}`);
  live('rotozoom', { init(Z) {
    const tex = new Uint8Array(65536);
    for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) { const x = (u & 63) - 31.5, y = (v & 63) - 31.5, r = Math.sqrt(x * x + y * y), q = Math.max(Math.abs(x), Math.abs(y));
      const ck = ((u >> 6) + (v >> 6)) & 1; tex[v << 8 | u] = ck ? (r * 5) & 255 : ((q * 5) + 128 + (((u >> 3) ^ (v >> 3)) & 1) * 10) & 255; }
    Z.tex = tex;
    Z.pal = grad([[0, 20, 0, 40], [.12, 140, 10, 90], [.24, 255, 80, 60], [.33, 255, 200, 80], [.42, 255, 250, 210], [.5, 60, 10, 60],
      [.62, 20, 30, 120], [.74, 40, 160, 230], [.83, 200, 250, 255], [.92, 90, 20, 130], [1, 20, 0, 40]], 1);
  } });

  // ===== FIRE — classic averaging fire at half-res with drifting embers =====
  jit('fire', { COOL: 1, SEED: 120, RUNS: 7, EMBERS: 5, WIND: 0, HEAT: 255 }, `
const h = Z.h, cm = Z.cm, FW = ${HW}, FH = ${HH + 3}, cs = (t * 70) | 0;
let s = Z.seed | 0, v = 0;
for (let i = (FH - 2) * FW, n = 0; i < FH * FW; i++) {
  if (--n <= 0) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; n = 1 + (s >>> 3) % RUNS; v = ((s >>> 12) & 255) < SEED + b * 70 + k * 120 ? HEAT : (s >>> 20) & 31; }
  h[i] = v;
}
for (let e = 0; e < EMBERS; e++) {
  const ex = (FW / 2 + Math.sin(t * .23 + e * 2.1) * FW * .4) | 0, ey = (FH - 4 - ((t * 9 + e * 37) % (FH * .7))) | 0;
  for (let yy = -1; yy <= 1; yy++) for (let xx = -2; xx <= 2; xx++) h[(ey + yy) * FW + ex + xx] = HEAT;
}
for (let y = 0; y < FH - 2; y++) {
  const cr = ((y + cs) & 255) << 8;
  for (let x = 0, i = y * FW; x < FW; x++, i++) {
    const j = i + FW + WIND, v = (h[j - 1] + h[j] + h[j + 1] + h[j + FW]) >> 2, c = COOL + cm[cr | x];
    h[i] = v > c ? v - c : 0;
  }
}
Z.seed = s;
LIVE.fn['fx.up2'](h, Z.pal, o);`);
  live('fire', { init(Z) {
    Z.h = new Uint8Array(HW * (HH + 5)); Z.seed = 0x1234567;
    const n = fbm(256, 4, 41, 16); Z.cm = new Uint8Array(65536); for (let i = 0; i < 65536; i++) Z.cm[i] = Math.max(0, n[i] * 5 - 1.8) | 0;
    Z.pal = grad([[0, 0, 0, 0], [.1, 24, 0, 22], [.25, 110, 6, 24], [.42, 220, 40, 0], [.6, 255, 130, 10], [.8, 255, 220, 70], [1, 255, 255, 230]]);
  } });

  // ===== STARFIELD — 3D warp stars over a slowly rotating nebula =====
  jit('starfield', { SPEED: 95, WARP: 4, SPIN: .025, FOV: 220, DEPTH: 300 }, `
const tex = Z.neb, sx = Z.sx, sy = Z.sy, sz = Z.sz, st = Z.st;
const a = t * SPIN, zz = .5 + .06 * Math.sin(t * .1), du = Math.cos(a) * zz * 256 | 0, dv = Math.sin(a) * zz * 256 | 0;
let u0 = t * 1500 - 240 * du + 135 * dv, v0 = t * 500 - 240 * dv - 135 * du;
for (let y = 0, i = 0; y < H; y++, u0 -= dv, v0 += du) {
  let u = u0 | 0, v = v0 | 0;
  for (let x = 0; x < W; x++, i++, u += du, v += dv) o[i] = tex[(v >> 8 & 255) << 8 | (u >> 8 & 255)];
}
const mv = SPEED * (1 + b * .7 + k * 9) * dt, tail = Math.abs(mv) * WARP + .6;
for (let j = 0; j < sz.length; j++) {
  let z = sz[j] - mv; if (z < 1) z += DEPTH; else if (z > DEPTH + 1) z -= DEPTH; sz[j] = z;
  const hx = W / 2 + sx[j] * FOV / z, hy = H / 2 + sy[j] * FOV / z, tx = W / 2 + sx[j] * FOV / (z + tail), ty = H / 2 + sy[j] * FOV / (z + tail);
  const br = (1 - z / DEPTH), lum = Math.min(255, br * br * 340), n = Math.min(48, Math.max(Math.abs(hx - tx), Math.abs(hy - ty)) | 0) + 1, tint = st[j];
  for (let q = 0; q <= n; q++) {
    const f = q / n, px = (tx + (hx - tx) * f) | 0, py = (ty + (hy - ty) * f) | 0;
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    const p = py * W + px, c = o[p], l = lum * f, r = (c & 255) + l * (tint & 255) / 255, g = (c >> 8 & 255) + l * (tint >> 8 & 255) / 255, bl = (c >> 16 & 255) + l;
    o[p] = (r > 255 ? 255 : r) | (g > 255 ? 255 : g) << 8 | (bl > 255 ? 255 : bl) << 16;
  }
}`);
  live('starfield', { init(Z) {
    const a = fbm(256, 6, 3, 4), c = fbm(256, 6, 11, 8), neb = new Uint32Array(65536);
    for (let i = 0; i < 65536; i++) { const p = Math.pow(a[i], 2.2), q = Math.pow(c[i], 3.2), dust = hash(i, 9, 1) > .9975 ? 90 * hash(i, 3, 2) : 0;
      neb[i] = col(4 + 130 * q + 30 * p + dust, 2 + 30 * p + 25 * q * p + dust, 14 + 120 * p + 50 * q + dust); }
    const n = 1100, sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n), st = new Uint32Array(n);
    for (let i = 0; i < n; i++) { sx[i] = (hash(i, 1, 5) - .5) * 1400; sy[i] = (hash(i, 2, 5) - .5) * 800; sz[i] = 1 + hash(i, 3, 5) * 300;
      const w = hash(i, 4, 5); st[i] = w < .2 ? col(255, 190, 0) : w < .5 ? col(170, 210, 0) : col(230, 240, 0); }
    Object.assign(Z, { neb, sx, sy, sz, st });
  } });

  // ===== COPPER — rotating ring of raster bars + glowing sine waves =====
  jit('copper', { NB: 8, AMP: 92, SPD: 1.15, WAVES: 3, WAMP: 34, WTH: 9 }, `
const row = Z.row, bg = Z.bg, bars = Z.bars, ord = Z.ord, zs = Z.zs, gl = Z.gl, wc = Z.wc, BH = 30;
for (let y = 0; y < H; y++) row[y] = bg[y];
for (let j = 0; j < NB; j++) { zs[j] = Math.cos(t * SPD + j * TAU / NB); ord[j] = j; }
for (let j = 1; j < NB; j++) { const v = ord[j]; let q = j - 1; while (q >= 0 && zs[ord[q]] > zs[v]) { ord[q + 1] = ord[q]; q--; } ord[q + 1] = v; }
for (let n = 0; n < NB; n++) {
  const j = ord[n], a = t * SPD + j * TAU / NB, sh = (110 + 146 * (zs[j] + 1) / 2) | 0;
  const yc = (H / 2 + AMP * (1 + k * .5) * Math.sin(a) + 24 * Math.sin(t * .7)) | 0;
  for (let r = 0; r < BH; r++) { const y = yc - BH / 2 + r; if (y < 0 || y >= H) continue;
    const c = bars[(j & 7) * BH + r]; row[y] = ((c & 255) * sh >> 8) | ((c >> 8 & 255) * sh >> 8) << 8 | ((c >> 16 & 255) * sh >> 8) << 16; }
}
for (let y = 0; y < H; y++) o.fill(row[y], y * W, y * W + W);
for (let w = 0; w < WAVES; w++) {
  const c = wc[w], wr = c & 255, wg = c >> 8 & 255, wb = c >> 16 & 255;
  for (let x = 0; x < W; x++) {
    const yc = (H / 2 + (WAMP + b * 10) * Math.sin(x * (.013 + w * .006) + t * (1.3 + w * .4) + w * 2) * Math.sin(x * .004 - t * .5 + w)) | 0;
    for (let d = -WTH; d <= WTH; d++) { const y = yc + d; if (y < 0 || y >= H) continue;
      const p = y * W + x, q = o[p], g = gl[d < 0 ? -d : d], r = (q & 255) + (wr * g >> 8), gg = (q >> 8 & 255) + (wg * g >> 8), bb = (q >> 16 & 255) + (wb * g >> 8);
      o[p] = (r > 255 ? 255 : r) | (gg > 255 ? 255 : gg) << 8 | (bb > 255 ? 255 : bb) << 16; }
  }
}`);
  live('copper', { init(Z) {
    const BH = 30, hues = [[255, 40, 60], [255, 140, 20], [255, 230, 60], [60, 240, 120], [40, 220, 255], [60, 90, 255], [170, 60, 255], [255, 60, 200]];
    Z.bars = new Uint32Array(8 * BH);
    for (let j = 0; j < 8; j++) for (let r = 0; r < BH; r++) { const p = Math.sin(PI * (r + .5) / BH), s = Math.pow(p, 10) * 200, h = hues[j];
      Z.bars[j * BH + r] = col(h[0] * Math.pow(p, 1.4) + s, h[1] * Math.pow(p, 1.4) + s, h[2] * Math.pow(p, 1.4) + s); }
    Z.bg = new Uint32Array(H); for (let y = 0; y < H; y++) { const f = y / H; Z.bg[y] = col(10 + 20 * f, 4 + 6 * f, 30 + 20 * Math.sin(f * PI) + ((y & 2) ? 6 : 0)); }
    Z.row = new Uint32Array(H); Z.ord = new Int32Array(8); Z.zs = new Float32Array(8);
    Z.gl = new Uint8Array(32); for (let d = 0; d < 32; d++) Z.gl[d] = 255 * Math.exp(-d * d / 9) + 50 * Math.exp(-d / 4);
    Z.wc = new Uint32Array([col(60, 230, 255), col(255, 70, 210), col(255, 210, 80)]);
  } });

  // ===== VOXEL — Comanche-style heightfield flyover into a synthwave sunset =====
  jit('voxel', { ALT: 60, HORIZON: 96, SCALE: 110, DIST: 420, SPEED: 30, SWAY: .45, FOV: .75 }, `
const hm = Z.hm, cm = Z.cm, sky = Z.sky, FRB = Z.fog & 0xff00ff, FG = Z.fog & 0xff00;
const px = 128 + 90 * Math.sin(t * .11), py = t * SPEED, ang = Math.sin(t * .17) * SWAY;
const sa = Math.sin(ang), ca = Math.cos(ang), hor = (HORIZON + 8 * Math.sin(t * .37) + b * 3) | 0;
const gnd = hm[((py + 10) & 255) << 8 | (px & 255)];
Z.ch += (Math.max(gnd, 120) + ALT - Z.ch) * .03;
const ch = Z.ch + k * 25;
for (let x = 0; x < W; x++) {
  const sx = (x / W - .5) * 2 * FOV, rx = sa + ca * sx, ry = ca - sa * sx;
  let yb = H, z = 2, dz = .6;
  while (z < DIST && yb > 0) {
    const j = ((py + ry * z) & 255) << 8 | ((px + rx * z) & 255);
    let sy = ((ch - hm[j]) * SCALE / z + hor) | 0;
    if (sy < yb) {
      if (sy < 0) sy = 0;
      const f = z / DIST, fa = (f * f * 256) | 0, ia = 256 - fa, c0 = cm[j];
      const c = ((((c0 & 0xff00ff) * ia + FRB * fa) >>> 8) & 0xff00ff) | ((((c0 & 0xff00) * ia + FG * fa) >>> 8) & 0xff00);
      for (let y = sy, p = sy * W + x; y < yb; y++, p += W) o[p] = c;
      yb = sy;
    }
    z += dz; dz *= 1.011;
  }
  const so = hor - 96;
  for (let y = 0, p = x; y < yb; y++, p += W) { const r = y - so; o[p] = sky[(r < 0 ? 0 : r > H - 1 ? H - 1 : r) * W + x]; }
}`);
  live('voxel', { init(Z) {
    const n = fbm(256, 6, 21, 2), m = fbm(256, 3, 5, 16), hm = new Uint8Array(65536), cm = new Uint32Array(65536);
    for (let i = 0; i < 65536; i++) { const r = 1 - Math.abs(2 * n[i] - 1); hm[i] = clamp(255 * (.6 * n[i] + .32 * r * r + .08 * m[i]), 0, 255); }
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const i = y << 8 | x, h = hm[i] / 255, sl = (hm[y << 8 | ((x + 255) & 255)] - hm[y << 8 | ((x + 1) & 255)]) / 24;
      const lt = clamp(.75 + sl, .35, 1.5), base = h < .3 ? [40, 10, 70] : h < .5 ? [lerp(40, 160, (h - .3) / .2), lerp(10, 30, (h - .3) / .2), lerp(70, 120, (h - .3) / .2)]
        : h < .7 ? [lerp(160, 250, (h - .5) / .2), lerp(30, 110, (h - .5) / .2), lerp(120, 70, (h - .5) / .2)] : [lerp(250, 255, (h - .7) / .3), lerp(110, 230, (h - .7) / .3), lerp(70, 170, (h - .7) / .3)];
      const grid = (x & 15) === 0 || (y & 15) === 0 ? 1.25 : 1; cm[i] = col(base[0] * lt * grid, base[1] * lt * grid, base[2] * lt * grid); }
    const sky = new Uint32Array(N), hz = 96;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const f = clamp(y / hz, 0, 1.2);
      let r = lerp(6, 250, Math.pow(f, 2.2)), g = lerp(2, 70, Math.pow(f, 3)), bl = lerp(30, 120, Math.pow(f, 1.2));
      const dx = x - W / 2, dy = y - (hz - 26), d = Math.sqrt(dx * dx + dy * dy);
      if (d < 44 && !(dy > 0 && ((dy | 0) % 8) < dy / 5)) { const s = (y - (hz - 70)) / 60; r = 255; g = lerp(230, 60, s); bl = lerp(90, 130, s); }
      else { const gw = Math.max(0, 1 - d / 110); r += 120 * gw * gw; g += 30 * gw * gw; bl += 40 * gw * gw; }
      if (y < hz * .7 && hash(y * W + x, 1, 77) > .997) { r += 120; g += 120; bl += 140; }
      sky[y * W + x] = col(r, g, bl); }
    Object.assign(Z, { hm, cm, sky, fog: col(150, 40, 110), ch: 200 });
  } });

  // ===== METABALLS — inverse-square field at half-res, glowing iso band =====
  jit('metaballs', { NB: 7, RAD: 18, GAIN: 70, SPD: .55 }, `
const f8 = Z.f8, dx2 = Z.dx2, dy2 = Z.dy2, r2 = Z.r2, FWh = ${HW};
for (let j = 0; j < NB; j++) {
  const bx = FWh / 2 + Math.sin(t * SPD * (1 + j * .21) + j * 1.7) * (60 + j * 7), by = ${HH / 2} + Math.cos(t * SPD * (.8 + j * .17) + j * 2.9) * (36 + j * 3);
  for (let x = 0; x < FWh; x++) dx2[j * FWh + x] = (x - bx) * (x - bx);
  Z.by[j] = by; r2[j] = RAD * RAD * (.6 + .4 * Math.sin(j * 1.3 + t * .4) + .9 * (j & 1)) * (1 + b * .12 + k * .5);
}
for (let y = 0, i = 0; y < ${HH}; y++) {
  for (let j = 0; j < NB; j++) dy2[j] = (y - Z.by[j]) * (y - Z.by[j]) + 1;
  for (let x = 0; x < FWh; x++, i++) {
    let s = 0;
    for (let j = 0; j < NB; j++) s += r2[j] / (dx2[j * FWh + x] + dy2[j]);
    s *= GAIN; f8[i] = s > 255 ? 255 : s;
  }
}
LIVE.fn['fx.up2'](f8, Z.pal, o);`);
  live('metaballs', { init(Z) {
    Z.f8 = new Uint8Array(HW * HH); Z.dx2 = new Float32Array(16 * HW); Z.dy2 = new Float32Array(16); Z.r2 = new Float32Array(16); Z.by = new Float32Array(16);
    Z.pal = grad([[0, 2, 6, 14], [.12, 6, 20, 46], [.22, 12, 50, 100], [.26, 40, 160, 210], [.28, 200, 255, 250], [.31, 60, 30, 120],
      [.45, 150, 30, 160], [.65, 250, 70, 150], [.85, 255, 170, 120], [1, 255, 250, 220]]);
  } });

  // ===== MOIRE — three wandering ring sources, interfering products in two additive palettes =====
  jit('moire', { F1: 16, F2: 19, F3: 13, WANDER: 1 }, `
const dm = Z.dm, sn = Z.sn, pa = Z.pa, pb = Z.pb, MW = Z.mw, OX = Z.ox, OY = Z.oy;
const w = WANDER * (1 + k * .5), z = 1 + b * .06;
const x1 = (OX + OX * .95 * w * Math.sin(t * .31)) | 0, y1 = (OY + OY * .9 * w * Math.cos(t * .43)) | 0;
const x2 = (OX + OX * .95 * w * Math.sin(t * .27 + 2)) | 0, y2 = (OY + OY * .9 * w * Math.sin(t * .37 + 1)) | 0;
const x3 = (OX + OX * .9 * w * Math.cos(t * .23 + 4)) | 0, y3 = (OY + OY * .9 * w * Math.sin(t * .29 + 3)) | 0;
const f1 = F1 * z, f2 = F2 * z, f3 = F3 * z, ph = (t * 300) | 0;
for (let y = 0, i = 0; y < H; y++) {
  let j1 = (y + y1) * MW + x1, j2 = (y + y2) * MW + x2, j3 = (y + y3) * MW + x3;
  for (let x = 0; x < W; x++, i++) {
    const a = sn[(dm[j1++] * f1 - ph) & 1023], c = sn[(dm[j2++] * f2 + ph) & 1023], d = sn[(dm[j3++] * f3) & 1023];
    o[i] = pa[(a * c) >> 8] + pb[(c * d) >> 8];
  }
}`);
  live('moire', { init(Z) {
    const OX = 140, OY = 80, MW = W + 2 * OX, MH = H + 2 * OY, dm = new Uint16Array(MW * MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) dm[y * MW + x] = Math.sqrt((x - MW / 2) ** 2 + (y - MH / 2) ** 2) * 4;
    Z.pa = grad([[0, 0, 0, 6], [.5, 30, 4, 60], [.85, 130, 20, 140], [1, 175, 60, 150]]);
    Z.pb = grad([[0, 0, 0, 0], [.55, 0, 30, 40], [.85, 20, 130, 105], [1, 80, 195, 105]]);
    Object.assign(Z, { dm, sn: SN, mw: MW, ox: OX, oy: OY });
  } });

  // ===== TWISTER — three twisting textured bars, per-row face projection =====
  jit('twister', { NT: 3, R: 36, TWIST: 2.3, SPD: 1.3, WOB: 46 }, `
const bg = Z.bg, sp = Z.sp, tex = Z.tex;
for (let y = 0, i = 0; y < H; y++, i += W) {
  o.fill(bg[y], i, i + W);
  for (let n = 0; n < NT; n++) {
    const rr = R * (n === 1 ? 1.2 : .82), cx = (n + .5) * W / NT + WOB * Math.sin(y * .011 + t * .9 + n * 2);
    const a = t * SPD * (n & 1 ? -1 : 1) + Math.sin(y * .0045 * TWIST + t * .6 + n) * TWIST + k * 3, tv = ((y + t * 50 * (n + 1)) >> 1 & 15) << 4;
    for (let f = 0; f < 4; f++) {
      const x0 = cx + rr * Math.sin(a + f * PI / 2), x1 = cx + rr * Math.sin(a + (f + 1) * PI / 2);
      if (x1 <= x0 + .5) continue;
      const wd = x1 - x0, inv = 16 / wd, sh = Math.min(31, (wd / (rr * 1.4142) * 27 + b * 4) | 0), base = ((((n * 4 + f) & 7) * 32) + sh) << 4;
      const xa = Math.max(0, Math.ceil(x0)), xb = Math.min(W, x1);
      for (let x = xa; x < xb; x++) o[i + x] = sp[base + tex[tv | (((x - x0) * inv) & 15)]];
    }
  }
}`);
  live('twister', { init(Z) {
    const faces = [[255, 70, 140], [70, 200, 255], [255, 190, 60], [150, 80, 255], [80, 255, 170], [255, 110, 60], [60, 120, 255], [230, 230, 255]];
    Z.tex = new Uint8Array(256);
    for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) Z.tex[v << 4 | u] = u === 0 || u === 15 ? 15 : ((v >> 2) & 1 ? 9 : 6) + (u > 3 && u < 7 ? 3 : 0);
    Z.sp = new Uint32Array(8 * 32 * 16);
    for (let f = 0; f < 8; f++) for (let s = 0; s < 32; s++) for (let x = 0; x < 16; x++) { const l = Math.pow(s / 31, 1.3), m = x / 15, h = faces[f], spec = Math.pow(l, 6) * 120 * m;
      Z.sp[(f * 32 + s) << 4 | x] = col(h[0] * l * (.3 + .7 * m) + spec, h[1] * l * (.3 + .7 * m) + spec, h[2] * l * (.3 + .7 * m) + spec); }
    Z.bg = new Uint32Array(H); for (let y = 0; y < H; y++) { const f = Math.sin(y / H * PI); Z.bg[y] = col(8 + 18 * f, 4 + 8 * f, 22 + 30 * f + ((y % 3) ? 0 : 6)); }
  } });

  // ===== LENS — two bouncing magnifier lenses over a scrolling tiled surface =====
  jit('lens', { NL: 2, SCROLL: 26, BOUNCE: 1, WAVE: 6 }, `
const bg = Z.bg, tex = Z.tex, pal = Z.pal, lx = Z.lx, ly = Z.ly, lm = Z.lm, hl = Z.hl, R = Z.R, D = R * 2;
for (let y = 0, i = 0; y < H; y++) {
  const v = ((y + t * SCROLL * .6) & 255) << 8, ou = (t * SCROLL + WAVE * Math.sin(y * .03 + t)) | 0;
  for (let x = 0; x < W; x++, i++) bg[i] = pal[tex[v | ((x + ou) & 255)]];
}
o.set(bg);
for (let n = 0; n < NL; n++) {
  const cx = (W / 2 + (W / 2 - R) * Math.sin(t * (.53 + n * .31) + n * 2.4)) | 0;
  const cy = (H - R - Math.abs(Math.sin(t * (1.1 + n * .37) * BOUNCE + n)) * (H - D) * (1 + k * .2)) | 0;
  for (let yy = 0, j = 0; yy < D; yy++) {
    const py = cy - R + yy; if (py < 0 || py >= H) { j += D; continue; }
    for (let xx = 0; xx < D; xx++, j++) {
      const m = lm[j]; if (!m) continue; const px = cx - R + xx; if (px < 0 || px >= W) continue;
      let sx = px + lx[j], sy = py + ly[j]; sx = sx < 0 ? 0 : sx >= W ? W - 1 : sx; sy = sy < 0 ? 0 : sy >= H ? H - 1 : sy;
      const c = bg[sy * W + sx], h = hl[j];
      const r = ((c & 255) * m >> 7) + h, g = ((c >> 8 & 255) * m >> 7) + h, bl = ((c >> 16 & 255) * m >> 7) + h;
      o[py * W + px] = (r > 255 ? 255 : r) | (g > 255 ? 255 : g) << 8 | (bl > 255 ? 255 : bl) << 16;
    }
  }
}`);
  live('lens', { init(Z) {
    const tex = new Uint8Array(65536);
    for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) { const x = (u & 31) - 15.5, y = (v & 31) - 15.5, d = Math.abs(x) + Math.abs(y), r = Math.sqrt(x * x + y * y);
      const ck = ((u >> 5) ^ (v >> 5)) & 1; let c = ck ? 20 + ((u + v) & 7) * 3 : 60 + ((u - v) & 15);
      if (d < 14 && d > 11) c = 150 + (d - 11) * 12; else if (d < 7) c = 95 + d * 4; if ((u & 31) === 0 || (v & 31) === 0) c = 110;
      tex[v << 8 | u] = c; }
    const pal = grad([[0, 4, 10, 16], [.12, 10, 40, 50], [.3, 20, 90, 90], [.45, 40, 60, 70], [.58, 230, 150, 50], [.75, 255, 220, 120], [.86, 255, 90, 120], [1, 255, 240, 230]]);
    const R = 54, D = R * 2, lx = new Int8Array(D * D), ly = new Int8Array(D * D), lm = new Uint8Array(D * D), hl = new Uint8Array(D * D);
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) { const j = y * D + x, dx = x - R + .5, dy = y - R + .5, r = Math.sqrt(dx * dx + dy * dy) / R;
      if (r >= 1) continue; const f = .32 + .68 * r * r; lx[j] = Math.round(dx * f - dx); ly[j] = Math.round(dy * f - dy);
      lm[j] = clamp(165 - 60 * Math.pow(r, 6) - (r > .94 ? 70 : 0), 1, 255);
      const sd = Math.sqrt((dx + R * .38) ** 2 + (dy + R * .42) ** 2) / (R * .38); hl[j] = clamp(150 * Math.pow(Math.max(0, 1 - sd), 2) + (r > .9 && r < .95 ? 40 : 0), 0, 255); }
    Object.assign(Z, { tex, pal, bg: new Uint32Array(N), lx, ly, lm, hl, R });
  } });

  // ===== FEEDBACK — zoom/rotate feedback of the previous frame + lissajous light seeds =====
  jit('feedback', { ZOOM: .972, SPIN: .014, DR: 236, DG: 242, DB: 250, SEEDS: 9 }, `
const P = Z.p, Q = Z.q, hue = Z.hue, spr = Z.spr;
const a = SPIN * (1.4 * Math.sin(t * .23)) + k * .06, zz = ZOOM - k * .04 - b * .006, ca = Math.cos(a) * zz, sa = Math.sin(a) * zz;
const du = ca * 65536 | 0, dv = sa * 65536 | 0;
let u0 = (W / 2 + ca * -W / 2 - sa * -H / 2) * 65536, v0 = (H / 2 + sa * -W / 2 + ca * -H / 2) * 65536;
for (let y = 0, i = 0; y < H; y++, u0 -= dv, v0 += du) {
  let u = u0 | 0, v = v0 | 0;
  for (let x = 0; x < W; x++, i++, u += du, v += dv) {
    const sx = u >> 16, sy = v >> 16;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) { Q[i] = 0; continue; }
    const c = P[sy * W + sx];
    Q[i] = ((c & 255) * DR >> 8) | ((c >> 8 & 255) * DG >> 8) << 8 | ((c >> 16 & 255) * DB >> 8) << 16;
  }
}
for (let s = 0; s < SEEDS; s++) {
  const ph = t * 1.3 + s * TAU / SEEDS, cx = (W / 2 + Math.sin(ph * 1.5 + t * .2) * 150) | 0, cy = (H / 2 + Math.sin(ph * 2 + t * .37) * 85) | 0;
  const c = hue[((t * 40) + s * 28) & 255], cr = c & 255, cg = c >> 8 & 255, cb = c >> 16 & 255, gain = 150 + b * 105;
  for (let yy = -6, j = 0; yy <= 6; yy++) for (let xx = -6; xx <= 6; xx++, j++) {
    const px = cx + xx, py = cy + yy; if (px < 0 || py < 0 || px >= W || py >= H) continue;
    const p = py * W + px, q = Q[p], g = spr[j] * gain >> 8, r = (q & 255) + (cr * g >> 8), gg = (q >> 8 & 255) + (cg * g >> 8), bb = (q >> 16 & 255) + (cb * g >> 8);
    Q[p] = (r > 255 ? 255 : r) | (gg > 255 ? 255 : gg) << 8 | (bb > 255 ? 255 : bb) << 16;
  }
}
o.set(Q); Z.p = Q; Z.q = P;`);
  live('feedback', { init(Z) {
    Z.p = new Uint32Array(N); Z.q = new Uint32Array(N);
    Z.hue = grad([[0, 255, 40, 120], [.17, 255, 160, 30], [.34, 120, 255, 60], [.5, 30, 230, 255], [.67, 90, 70, 255], [.84, 230, 60, 255], [1, 255, 40, 120]], 1);
    Z.spr = new Uint8Array(169); for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) Z.spr[y * 13 + x] = 255 * Math.exp(-((x - 6) ** 2 + (y - 6) ** 2) / 7);
  } });

  // ===== KEFRENS — one persistent line buffer, a cylinder sprite stamped per scanline =====
  jit('kefrens', { BW: 26, A1: 150, A2: 54, F1: .011, F2: .034, SPD: 1.5 }, `
const lb = Z.lb, spr = Z.spr, bgc = Z.bgc;
lb.fill(bgc);
for (let y = 0, i = 0; y < H; y++, i += W) {
  const x0 = (W / 2 - BW / 2 + A1 * Math.sin(y * F1 + t * SPD) * (.75 + .25 * Math.sin(t * .4)) + A2 * Math.sin(y * F2 - t * SPD * 1.7 + k * 3)) | 0;
  const s = (((y >> 2) + ((t * 18) | 0)) & 15) * 32;
  for (let j = 0; j < BW; j++) { const xx = x0 + j; if (xx >= 0 && xx < W) lb[xx] = spr[s + (j * 32 / BW | 0)]; }
  o.set(lb, i);
}`);
  live('kefrens', { init(Z) {
    const hp = grad([[0, 255, 50, 90], [.2, 255, 170, 40], [.4, 230, 255, 90], [.6, 50, 230, 210], [.8, 110, 80, 255], [1, 255, 50, 90]], 1);
    Z.spr = new Uint32Array(16 * 32);
    for (let s = 0; s < 16; s++) { const h = hp[(s * 16) & 255]; for (let j = 0; j < 32; j++) { const p = Math.sin(PI * (j + .5) / 32), l = Math.pow(p, 1.6), sp = Math.pow(p, 18) * 170;
      Z.spr[s * 32 + j] = col(cr(h) * l + sp, cg(h) * l + sp, cb(h) * l + sp); } }
    Z.lb = new Uint32Array(W); Z.bgc = col(6, 4, 18);
  } });

  // ===== MATRIX — code rain made of the game's own live source =====
  jit('matrix', { SPEED: 11, TRAIL: 16, WALL: 34, DRIFT: .6 }, `
const gl = Z.gl, txt = Z.txt, tl = txt.length, hd = Z.hd, sp = Z.sp, ln = Z.ln, of = Z.of, pal = Z.pal, bgr = Z.bgr, NC = ${W / 6}, NR = 34;
const go = SPEED * dt * (1 + b * .5 + k * 3);
for (let c = 0; c < NC; c++) {
  hd[c] += sp[c] * go;
  if (hd[c] - ln[c] > NR || hd[c] < -40) { hd[c] = -Math.random() * 12; sp[c] = .4 + Math.random(); ln[c] = TRAIL * (.4 + Math.random()); of[c] = (Math.random() * 4000) | 0; }
}
const wl = (t * DRIFT) | 0;
for (let r = 0; r < NR; r++) {
  const y0 = r * 8, rowMax = Math.min(8, H - y0), bg = bgr[r];
  for (let c = 0; c < NC; c++) {
    const d = hd[c] - r, inT = d >= 0 && d < ln[c];
    const lvl = inT ? (d < 1 ? 255 : 235 * Math.pow(1 - d / ln[c], .7) + 20) | 0 : WALL;
    let ch = txt[(((inT ? of[c] : wl) + r) * NC + c) % tl];
    if (inT && d < 1.5 && Math.random() < .3) ch = 16 + (Math.random() * 60 | 0);
    const fg = pal[lvl], g0 = ch * 48;
    for (let yy = 0, p = y0 * W + c * 6; yy < rowMax; yy++, p += W - 6)
      for (let xx = 0; xx < 6; xx++, p++) o[p] = gl[g0 + yy * 6 + xx] ? fg : bg;
  }
}`);
  const hexG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001',
    '111101111101111', '111101111001111', '010101111101101', '110101110101110', '011100100100011', '110101101101110', '111100111100111', '111100111100100'];
  const glyphs = Z => { // borrow GFX's font if present (drawn into fb then read back), else a 3x5 hex fallback
    const gl = Z.gl; gl.fill(0); let ok = false;
    if (typeof GFX !== 'undefined' && GFX && typeof GFX.text === 'function') {
      const save = fb.slice(0, W * 8);
      try { for (let ch = 33; ch < 127; ch++) { fb.fill(0, 0, W * 8); GFX.text(String.fromCharCode(ch), 0, 0, 0xffffffff, 1);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) if (fb[y * W + x]) { gl[(ch - 32) * 48 + y * 6 + x] = 1; ok = true; } } } catch (e) { ok = false; }
      fb.set(save);
    }
    if (!ok) { gl.fill(0); for (let i = 1; i < 96; i++) { const g = hexG[(i + 32) & 15]; for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (g[y * 3 + x] === '1') gl[i * 48 + (y + 1) * 6 + x + 1] = 1; } }
    Z.font = ok;
  };
  const srcText = Z => { // the live source, laid out as an 80-column listing (glyph indices)
    const lines = Object.values(LIVE.src).join('\n').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 1), NC = W / 6;
    const txt = new Uint8Array(Math.max(1, lines.length) * NC);
    lines.forEach((s, i) => { for (let j = 0; j < NC && j < s.length; j++) { const c = s.charCodeAt(j); txt[i * NC + j] = c > 32 && c < 127 ? c - 32 : 0; } });
    Z.txt = txt; Z.gen = LIVE.gen; Z.gt = S.t;
  };
  live('matrix', { init(Z) {
    const NC = W / 6; Z.gl = new Uint8Array(96 * 48); glyphs(Z); srcText(Z);
    Z.hd = new Float32Array(NC); Z.sp = new Float32Array(NC); Z.ln = new Float32Array(NC); Z.of = new Int32Array(NC);
    for (let c = 0; c < NC; c++) { Z.hd[c] = Math.random() * 40 - 6; Z.sp[c] = .4 + Math.random(); Z.ln[c] = 16 * (.4 + Math.random()); Z.of[c] = (Math.random() * 4000) | 0; }
    Z.pal = grad([[0, 0, 0, 0], [.15, 0, 44, 22], [.5, 0, 120, 50], [.8, 30, 210, 90], [.95, 120, 255, 160], [1, 235, 255, 240]]);
    Z.bgr = new Uint32Array(34); for (let r = 0; r < 34; r++) Z.bgr[r] = col(0, 6 + r * .3, 6 + r * .25);
  }, draw(t, dt, o, b, k) { const Z = this.Z;
    if (!Z.font && typeof GFX !== 'undefined') glyphs(Z);
    if (Z.gen !== LIVE.gen && S.t - Z.gt > .5) srcText(Z);
    LIVE.fn['fx.matrix'](o, t, dt, b, k, Z); } });

  // ===== BOOT — cruncher border raster flicker around a dark screen =====
  jit('boot', { BX: 36, BY: 26, RUN: 6, CALM: 0 }, `
const pal = Z.pal, scr = Z.scr;
let s = (Z.s = (Math.imul(Z.s, 1103515245) + 12345 + ((t * 60) | 0)) | 0), runl = 0, c = 0;
for (let y = 0, i = 0; y < H; y++, i += W) {
  if (--runl <= 0) { s = (Math.imul(s, 1103515245) + 12345) | 0; runl = 1 + ((s >>> 24) % RUN); c = pal[(s >>> 16) & 15]; if (CALM) c = pal[6]; }
  if (y < BY || y >= H - BY) { o.fill(c, i, i + W); continue; }
  o.fill(c, i, i + BX); o.fill(c, i + W - BX, i + W);
  const sc = scr[(y + ((t * 30) | 0)) & 7], nz = (s >>> 8) & 1;
  o.fill(nz ? sc : scr[0], i + BX, i + W - BX);
}`);
  live('boot', { init(Z) {
    Z.pal = new Uint32Array([[0, 0, 0], [255, 255, 255], [136, 57, 50], [103, 182, 189], [139, 63, 150], [85, 160, 73], [64, 49, 141], [191, 206, 114],
      [139, 84, 41], [87, 66, 0], [184, 105, 98], [80, 80, 80], [120, 120, 120], [148, 224, 137], [120, 105, 196], [159, 159, 159]].map(c => col(c[0], c[1], c[2])));
    Z.scr = new Uint32Array(8); for (let i = 0; i < 8; i++) Z.scr[i] = col(20 + (i === 3 ? 6 : 0), 16 + (i === 3 ? 6 : 0), 64 + (i === 3 ? 14 : 0)); Z.s = 1;
  } });

  // ---------- frame driver ----------
  const run = (name, o, t, dt, b, k) => { const fx = E[name]; init(fx); fx.draw(t, dt, o, b, k); };
  const mix = (a, c, f) => { const ia = (f * 256) | 0, ib = 256 - ia;
    for (let i = 0; i < N; i++) { const x = a[i], y = c[i];
      a[i] = ((((x & 0xff00ff) * ia + (y & 0xff00ff) * ib) >>> 8) & 0xff00ff) | ((((x & 0xff00) * ia + (y & 0xff00) * ib) >>> 8) & 0xff00); } };

  const api = {
    def(name, fx) { return def(name, fx); },
    names, cur: null, dim: 1, E,
    get kickLevel() { return kick; },
    set(name, fade) { if (!E[name] || api.cur === name) return; init(E[name]); fade = fade == null ? .6 : +fade;
      if (api.cur && fade > 0) { prev = api.cur; fadeT = 0; fadeD = fade; } else prev = null; api.cur = name; },
    kick(k) { kick = Math.min(1.2, kick + (k == null ? .5 : +k)); },
    warm() { while (pend.length) { const n = pend.shift(); if (E[n]) init(E[n]); } },
    draw(dt) {
      if (dt == null) dt = S.dt || 1 / 60;
      if (!api.cur) api.set(names[0], 0);
      frameN++; kick = kick > .002 ? kick * Math.pow(.015, dt) : 0;
      const b = S.beat || 0, t0 = ft; ft = LIVE.fn['fx.clock'](ft, dt, b, kick); const edt = ft - t0;
      run(api.cur, A, ft, edt, b, kick);
      if (prev) { fadeT += dt;
        if (fadeT >= fadeD || !E[prev]) prev = null;
        else { if (fadeD <= 1.2 || (pOdd ^= 1)) run(prev, B, ft, edt, b, kick); mix(A, B, sstep(0, 1, fadeT / fadeD)); } }
      LIVE.fn['fx.tone'](L, clamp(api.dim, 0, 1), b, kick);
      LIVE.fn['fx.out'](A, fb, L, S.t, b);
      if (frameN > 3 && pend.length) { const n = pend.shift(); if (E[n]) init(E[n]); }  // idle precompute, one effect per frame
    }
  };

  // ---------- visual corruption bugs: they patch shared live code every effect passes through ----------
  const SRCX = /s\[si \+ (.+?)\];/;
  PATCH.def({ id: 'fx.palrot', name: '0xB105: PALETTE_ROT', kind: 'bug', desc: 'fx.out: R<-G<-B channel rotate, blue plane XOR-banded',
    apply() { return LIVE.patch('fx.out', 'L[c >> 16 & 255] << 16 | L[c >> 8 & 255] << 8 | L[c & 255]', 'L[c >> 8 & 255] << 16 | L[c & 255] << 8 | L[(c >> 16 & 255) ^ (sy << 3 & 96)]'); } });
  PATCH.def({ id: 'fx.hsync', name: '0xF1F0: HSYNC_SKEW', kind: 'bug', desc: 'fx.out: SKEW = 0 -> SKEW = 34 : scanlines lose horizontal hold',
    apply() { return LIVE.patch('fx.out', 'SKEW = 0,', 'SKEW = 34,'); } });
  PATCH.def({ id: 'fx.vroll', name: '0x7E11: VSYNC_ROLL', kind: 'bug', desc: 'fx.out: ROLL = 0 -> ROLL = 140 : the picture rolls',
    apply() { return LIVE.patch('fx.out', 'ROLL = 0,', 'ROLL = 140,'); } });
  PATCH.def({ id: 'fx.mosaic', name: '0xD3C1: BLOCK_DECIMATE', kind: 'bug', desc: 'fx.out: s[si + sx] -> s[si + sx - sx % 8] : 8x8 block decimation',
    apply() { const a = LIVE.patch('fx.out', SRCX, (m, e) => 's[si + ((' + e + ') - (' + e + ') % 8)];');
      const c = LIVE.patch('fx.out', 'const sy = (y + roll) % H', 'const sy = (y - y % 8 + roll) % H'); return a || c; } });
  PATCH.def({ id: 'fx.mirror', name: '0x4D1R: MIRROR_FOLD', kind: 'bug', desc: 'fx.out: x > 239 reads 479 - x : the screen folds in half',
    apply() { return LIVE.patch('fx.out', SRCX, (m, e) => 's[si + ((' + e + ') < 240 ? (' + e + ') : 479 - (' + e + '))];'); } });
  PATCH.def({ id: 'fx.clock', name: '0xC10C: CLOCK_SKEW', kind: 'bug', desc: 'fx.clock: RATE = 1 -> RATE = 5 * Math.sin(S.t * 1.3) : time runs backwards',
    apply() { return LIVE.patch('fx.clock', 'RATE = 1,', 'RATE = 5 * Math.sin(S.t * 1.3),'); } });

  return api;
})();
