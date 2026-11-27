// ===== 10-gfx.js : software rasteriser — primitives, bitmap font, sprites, vector shapes, particles =====
// Everything draws straight into the kernel framebuffer `fb` (W×H Uint32, 0xAABBGGRR). All entry points accept
// fractional / out-of-range / NaN arguments: coordinates are clipped in integer space, nothing ever writes outside fb.
// Pixel convention: pixel (i,j) covers [i,i+1)×[j,j+1); its centre is (i+.5, j+.5).
const GFX = (() => {
  const N = W * H, A = 0xff000000, LIM = 1e8;
  const ok = v => v > -LIM && v < LIM;                     // finite & sane (false for NaN/±Inf)
  const col = c => (c | A);                                // force opaque (typed-array store wraps the sign)

  // ---------- colour math ----------
  // saturating per-channel add of two packed colours (exact, branch-free)
  const addc = (p, c) => {
    const x = p & 0xffffff, y = c & 0xffffff, lo = (x & 0x7f7f7f) + (y & 0x7f7f7f);
    const cr = ((x & y) | ((x ^ y) & lo)) & 0x808080;
    return (lo ^ ((x ^ y) & 0x808080)) | ((cr >>> 7) * 255) | A;
  };
  // multiply colour by m/256, m in 0..256 (fast, no saturation needed)
  const mul8 = (c, m) => ((((c & 0xff00ff) * m) >>> 8) & 0xff00ff) | ((((c & 0xff00) * m) >>> 8) & 0xff00) | A;
  // alpha blend s over d with a in 0..256
  const blend = (d, s, a) => { const b = 256 - a;
    return ((((s & 0xff00ff) * a + (d & 0xff00ff) * b) >>> 8) & 0xff00ff) | ((((s & 0xff00) * a + (d & 0xff00) * b) >>> 8) & 0xff00) | A; };
  const scale = (c, k) => { k = +k; if (!(k > 0)) return A >>> 0; if (k > 64) k = 64;
    let r = (c & 255) * k, g = (c >> 8 & 255) * k, b = (c >> 16 & 255) * k;
    return (A | (b > 255 ? 255 : b) << 16 | (g > 255 ? 255 : g) << 8 | (r > 255 ? 255 : r)) >>> 0; };
  const mix = (c1, c2, t) => { t = +t; t = t > 0 ? (t < 1 ? t : 1) : 0; return blend(c1 | 0, c2 | 0, (t * 256 + .5) | 0) >>> 0; };
  const hsv = (h, s, v) => {
    h = +h || 0; s = s == null ? 1 : clamp(+s || 0, 0, 1); v = v == null ? 1 : clamp(+v || 0, 0, 1);
    h = (h - Math.floor(h)) * 6; const i = h | 0, f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    let r, g, b;
    switch (i % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q; }
    return rgb(r * 255 + .5, g * 255 + .5, b * 255 + .5);
  };
  const lum = c => ((c & 255) * 54 + (c >> 8 & 255) * 183 + (c >> 16 & 255) * 19) >> 8;

  // fast private RNG for visual noise (never disturbs gameplay rnd())
  let rs = 0x1234567;
  const fr = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };

  // ---------- basic fills ----------
  const clear = c => { fb.fill(c == null ? A : col(c)); };
  const fade = k => { k = +k; if (!(k < 1)) return; if (!(k > 0)) { fb.fill(A); return; }
    const m = (k * 256) | 0;
    for (let i = 0; i < N; i++) { const p = fb[i]; fb[i] = ((((p & 0xff00ff) * m) >>> 8) & 0xff00ff) | ((((p & 0xff00) * m) >>> 8) & 0xff00) | A; } };
  const pset = (x, y, c) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = col(c); };
  const add = (x, y, c) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && x < W && y >= 0 && y < H) { const i = y * W + x; fb[i] = addc(fb[i], c); } };
  const get = (x, y) => { x = Math.floor(x); y = Math.floor(y); return x >= 0 && x < W && y >= 0 && y < H ? fb[y * W + x] : 0; };
  // integer span helpers (callers pass ints; spans are clipped here)
  const span = (y, x0, x1, c) => { if (y < 0 || y >= H) return; if (x0 < 0) x0 = 0; if (x1 > W - 1) x1 = W - 1; if (x0 > x1) return; const o = y * W; fb.fill(c, o + x0, o + x1 + 1); };
  const spanA = (y, x0, x1, c) => { if (y < 0 || y >= H) return; if (x0 < 0) x0 = 0; if (x1 > W - 1) x1 = W - 1; for (let i = y * W + x0, e = y * W + x1; i <= e; i++) fb[i] = addc(fb[i], c); };
  const spanB = (y, x0, x1, c, a) => { if (y < 0 || y >= H) return; if (x0 < 0) x0 = 0; if (x1 > W - 1) x1 = W - 1; for (let i = y * W + x0, e = y * W + x1; i <= e; i++) fb[i] = blend(fb[i], c, a); };
  // rect bounds -> R = [x0,y0,x1,y1) clipped ints, returns false if empty
  const R = new Int32Array(4);
  const rbox = (x, y, w, h) => { x = +x; y = +y; w = +w; h = +h; if (!(ok(x) && ok(y) && ok(w) && ok(h))) return false;
    if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
    let x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.floor(x + w), y1 = Math.floor(y + h);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > W) x1 = W; if (y1 > H) y1 = H;
    if (x0 >= x1 || y0 >= y1) return false; R[0] = x0; R[1] = y0; R[2] = x1; R[3] = y1; return true; };
  const rect = (x, y, w, h, c) => { if (!rbox(x, y, w, h)) return; c = col(c); for (let j = R[1]; j < R[3]; j++) fb.fill(c, j * W + R[0], j * W + R[2]); };
  const rectA = (x, y, w, h, c, a) => { a = a == null ? 1 : +a; if (!(a > 0) || !rbox(x, y, w, h)) return; if (a >= 1) return rect(x, y, w, h, c);
    const m = (a * 256 + .5) | 0; c |= 0; for (let j = R[1]; j < R[3]; j++) for (let i = j * W + R[0], e = j * W + R[2]; i < e; i++) fb[i] = blend(fb[i], c, m); };
  const rectAdd = (x, y, w, h, c) => { if (!rbox(x, y, w, h)) return; c |= 0; for (let j = R[1]; j < R[3]; j++) for (let i = j * W + R[0], e = j * W + R[2]; i < e; i++) fb[i] = addc(fb[i], c); };
  const frame = (x, y, w, h, c) => { x = +x; y = +y; w = +w; h = +h; if (!(ok(x) && ok(y) && ok(w) && ok(h))) return;
    if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.floor(x + w) - 1, y1 = Math.floor(y + h) - 1; if (x1 < x0 || y1 < y0) return;
    c = col(c); span(y0, x0, x1, c); if (y1 !== y0) span(y1, x0, x1, c);
    const ya = Math.max(y0 + 1, 0), yb = Math.min(y1 - 1, H - 1);
    for (let j = ya; j <= yb; j++) { if (x0 >= 0 && x0 < W) fb[j * W + x0] = c; if (x1 !== x0 && x1 >= 0 && x1 < W) fb[j * W + x1] = c; } };

  // ---------- lines ----------
  const L = new Float64Array(4), CT = new Float64Array(2);
  const lb = (p, q) => { if (p === 0) return q >= 0; const r = q / p;
    if (p < 0) { if (r > CT[1]) return false; if (r > CT[0]) CT[0] = r; } else { if (r < CT[0]) return false; if (r < CT[1]) CT[1] = r; } return true; };
  // Liang–Barsky clip of segment against [0,W)×[0,H) (slightly inset), result in L
  const clipSeg = (x0, y0, x1, y1) => {
    if (!(ok(x0) && ok(y0) && ok(x1) && ok(y1))) return false;
    const dx = x1 - x0, dy = y1 - y0;
    if (x0 >= 0 && x0 < W && x1 >= 0 && x1 < W && y0 >= 0 && y0 < H && y1 >= 0 && y1 < H) { L[0] = x0; L[1] = y0; L[2] = x1; L[3] = y1; return true; }
    CT[0] = 0; CT[1] = 1;
    if (!lb(-dx, x0) || !lb(dx, W - 1e-3 - x0) || !lb(-dy, y0) || !lb(dy, H - 1e-3 - y0)) return false;
    const t0 = CT[0], t1 = CT[1];
    L[0] = x0 + t0 * dx; L[1] = y0 + t0 * dy; L[2] = x0 + t1 * dx; L[3] = y0 + t1 * dy; return true;
  };
  // mode 0 = set, 1 = additive; skipLast avoids double-adding shared polygon vertices
  const seg = (x0, y0, x1, y1, c, mode, skipLast) => {
    if (!clipSeg(x0, y0, x1, y1)) return;
    let ax = Math.floor(L[0]), ay = Math.floor(L[1]); const bx = Math.floor(L[2]), by = Math.floor(L[3]);
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1; let e = dx + dy;
    let n = (dx > -dy ? dx : -dy) + (skipLast ? 0 : 1);
    if (n <= 0) n = 1; // a zero-length segment still plots one pixel
    if (mode) while (n-- > 0) { const i = ay * W + ax; fb[i] = addc(fb[i], c); const e2 = 2 * e; if (e2 >= dy) { e += dy; ax += sx; } if (e2 <= dx) { e += dx; ay += sy; } }
    else while (n-- > 0) { fb[ay * W + ax] = c; const e2 = 2 * e; if (e2 >= dy) { e += dy; ax += sx; } if (e2 <= dx) { e += dx; ay += sy; } }
  };
  const line = (x0, y0, x1, y1, c) => seg(+x0, +y0, +x1, +y1, col(c), 0, false);
  const lineA = (x0, y0, x1, y1, c) => seg(+x0, +y0, +x1, +y1, c | 0, 1, false);

  // ---------- glow (phosphor bloom falloff LUTs indexed by d²/r²) ----------
  const GN = 1024, GF = new Float32Array(GN + 1), GC = new Float32Array(GN + 1);
  for (let i = 0; i <= GN; i++) { const t2 = i / GN, t = Math.sqrt(t2), u = 1 - t2;
    GF[i] = .42 * u * u + .58 * Math.exp(-t2 * 11);          // hot core + long soft skirt
    GF[i] *= sstep(1, .85, t);                               // ensure it reaches 0 at r
    GC[i] = Math.max(0, 1 - t * 3.2); GC[i] *= GC[i] * .6; }  // white-hot centre
  GF[GN] = 0; GC[GN] = 0;
  const glow = (x, y, r, c, a) => {
    x = +x; y = +y; r = +r; a = a == null ? 1 : +a;
    if (!(ok(x) && ok(y) && r > 0 && a > 0)) return; if (r > 2000) r = 2000; if (a > 8) a = 8;
    if (r < .75) { const k = Math.min(1, a * r * 1.3); if (k > .01) add(x, y, mul8(c, (k * 256) | 0)); return; }
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.floor(y + r)), x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.floor(x + r));
    if (x0 > x1 || y0 > y1) return;
    const cr = (c & 255) * a, cg = (c >> 8 & 255) * a, cb = (c >> 16 & 255) * a, wk = 255 * a * (.35 + lum(c) / 400), r2 = r * r, ig = GN / r2;
    for (let j = y0; j <= y1; j++) {
      const dy = j + .5 - y, dy2 = dy * dy; if (dy2 >= r2) continue;
      // exact horizontal extent of the disc on this row -> no wasted pixels
      const hw = Math.sqrt(r2 - dy2); let i0 = Math.ceil(x - hw - .5), i1 = Math.floor(x + hw - .5); if (i0 < x0) i0 = x0; if (i1 > x1) i1 = x1;
      let dx = i0 + .5 - x;
      for (let i = j * W + i0, e = j * W + i1; i <= e; i++, dx++) {
        const q = ((dx * dx + dy2) * ig) | 0; if (q >= GN) continue;
        const f = GF[q], g = GC[q] * wk, p = fb[i];
        let R = (p & 255) + cr * f + g, G = (p >> 8 & 255) + cg * f + g, B = (p >> 16 & 255) + cb * f + g;
        fb[i] = A | (B > 255 ? 255 : B) << 16 | (G > 255 ? 255 : G) << 8 | (R > 255 ? 255 : R);
      }
    }
  };
  // additive soft line (lasers / beams): w = half width of the soft falloff
  const glowLine = (x0, y0, x1, y1, c, w, a) => {
    x0 = +x0; y0 = +y0; x1 = +x1; y1 = +y1; w = w == null ? 3 : +w; a = a == null ? 1 : +a;
    if (!(ok(x0) && ok(y0) && ok(x1) && ok(y1) && w > 0 && a > 0)) return; if (w > 200) w = 200;
    const dx = x1 - x0, dy = y1 - y0, ll = dx * dx + dy * dy; if (ll < 1e-6) return glow(x0, y0, w, c, a);
    const il = 1 / ll, w2 = w * w, ig = GN / w2, cr = (c & 255) * a, cg = (c >> 8 & 255) * a, cb = (c >> 16 & 255) * a, wk = 255 * a * (.35 + lum(c) / 400);
    const steep = Math.abs(dy) > Math.abs(dx);
    // iterate rows (or columns for shallow lines) and only the band around the line
    const ma0 = Math.floor(Math.min(steep ? y0 : x0, steep ? y1 : x1) - w), ma1 = Math.floor(Math.max(steep ? y0 : x0, steep ? y1 : x1) + w);
    const lim = steep ? H - 1 : W - 1, mlim = steep ? W - 1 : H - 1;
    const slope = steep ? dx / dy : dy / dx, band = w * Math.sqrt(1 + slope * slope) + 1;
    for (let m = Math.max(0, ma0); m <= Math.min(lim, ma1); m++) {
      const mc = m + .5, t = steep ? (mc - y0) : (mc - x0), cen = (steep ? x0 : y0) + slope * t;
      let n0 = Math.floor(cen - band), n1 = Math.floor(cen + band); if (n0 < 0) n0 = 0; if (n1 > mlim) n1 = mlim;
      for (let n = n0; n <= n1; n++) {
        const px = steep ? n + .5 : mc, py = steep ? mc : n + .5;
        let u = ((px - x0) * dx + (py - y0) * dy) * il; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = px - x0 - u * dx, ey = py - y0 - u * dy, q = ((ex * ex + ey * ey) * ig) | 0; if (q >= GN) continue;
        const i = steep ? m * W + n : n * W + m, f = GF[q], g = GC[q] * wk, p = fb[i];
        let R = (p & 255) + cr * f + g, G = (p >> 8 & 255) + cg * f + g, B = (p >> 16 & 255) + cb * f + g;
        fb[i] = A | (B > 255 ? 255 : B) << 16 | (G > 255 ? 255 : G) << 8 | (R > 255 ? 255 : R);
      }
    }
  };

  // ---------- circles (pixel-centre sampling, span based) ----------
  const discM = (x, y, r, c, mode, a) => {
    x = +x; y = +y; r = +r; if (!(ok(x) && ok(y) && r > 0)) return;
    if (r < .5) { if (mode === 1) add(x, y, c); else if (mode === 2) { const xi = Math.floor(x), yi = Math.floor(y); if (xi >= 0 && xi < W && yi >= 0 && yi < H) fb[yi * W + xi] = blend(fb[yi * W + xi], c, a); } else pset(x, y, c); return; }
    const r2 = r * r, j0 = Math.max(0, Math.ceil(y - r - .5)), j1 = Math.min(H - 1, Math.floor(y + r - .5));
    for (let j = j0; j <= j1; j++) { const dy = j + .5 - y, h2 = r2 - dy * dy; if (h2 < 0) continue; const hw = Math.sqrt(h2);
      const i0 = Math.ceil(x - hw - .5), i1 = Math.floor(x + hw - .5); if (i1 < i0) continue;
      if (mode === 1) spanA(j, i0, i1, c); else if (mode === 2) spanB(j, i0, i1, c, a); else span(j, i0, i1, c); }
  };
  // ring = disc(r) minus disc(r-th): gapless at any radius
  const ringM = (x, y, r, c, mode, th) => {
    x = +x; y = +y; r = +r; th = th == null ? 1 : +th; if (!(ok(x) && ok(y) && r > 0 && th > 0)) return;
    if (r <= th + .25) return discM(x, y, r, c, mode, 256);
    const r2 = r * r, ri = r - th, ri2 = ri * ri, j0 = Math.max(0, Math.ceil(y - r - .5)), j1 = Math.min(H - 1, Math.floor(y + r - .5));
    const S = mode ? spanA : span;
    for (let j = j0; j <= j1; j++) { const dy = j + .5 - y, dy2 = dy * dy, h2 = r2 - dy2; if (h2 < 0) continue; const hw = Math.sqrt(h2);
      const a0 = Math.ceil(x - hw - .5), a1 = Math.floor(x + hw - .5); if (a1 < a0) continue;
      const g2 = ri2 - dy2; if (g2 <= 0) { S(j, a0, a1, c); continue; }
      const gw = Math.sqrt(g2), b0 = Math.ceil(x - gw - .5), b1 = Math.floor(x + gw - .5);
      if (b1 < b0) { S(j, a0, a1, c); continue; }
      S(j, a0, Math.min(b0 - 1, a1), c); S(j, Math.max(b1 + 1, a0), a1, c); }
  };
  const circ = (x, y, r, c) => ringM(x, y, r, col(c), 0, 1);
  const circA = (x, y, r, c, th) => ringM(x, y, r, c | 0, 1, th);
  const disc = (x, y, r, c) => discM(x, y, r, col(c), 0, 0);
  const discA = (x, y, r, c) => discM(x, y, r, c | 0, 1, 0);
  const discB = (x, y, r, c, a) => { a = +a; if (!(a > 0)) return; discM(x, y, r, c | 0, 2, Math.min(256, (a * 256 + .5) | 0)); };

  // ---------- polygons ----------
  // scanline fill, even-odd rule (works for concave shapes too). V holds transformed vertices.
  let V = new Float64Array(256);
  const XS = new Float64Array(256);
  const polyFill = (n, c, mode) => {
    let ymin = 1e30, ymax = -1e30;
    for (let k = 0; k < n; k++) { const y = V[k * 2 + 1]; if (!ok(y) || !ok(V[k * 2])) return; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    const j0 = Math.max(0, Math.ceil(ymin - .5)), j1 = Math.min(H - 1, Math.ceil(ymax - .5) - 1);
    for (let j = j0; j <= j1; j++) {
      const yc = j + .5; let m = 0;
      for (let k = 0, p = n - 1; k < n; p = k++) {
        const ya = V[p * 2 + 1], yb = V[k * 2 + 1];
        if ((ya <= yc) !== (yb <= yc) && m < 256) { const xa = V[p * 2]; let xv = xa + (yc - ya) / (yb - ya) * (V[k * 2] - xa);
          let q = m++; while (q > 0 && XS[q - 1] > xv) { XS[q] = XS[q - 1]; q--; } XS[q] = xv; }
      }
      for (let q = 0; q + 1 < m; q += 2) { const i0 = Math.ceil(XS[q] - .5), i1 = Math.ceil(XS[q + 1] - .5) - 1; if (i1 >= i0) mode ? spanA(j, i0, i1, c) : span(j, i0, i1, c); }
    }
  };
  const tri = (x0, y0, x1, y1, x2, y2, c) => { V[0] = +x0; V[1] = +y0; V[2] = +x1; V[3] = +y1; V[4] = +x2; V[5] = +y2; polyFill(3, col(c), 0); };
  const triA = (x0, y0, x1, y1, x2, y2, c) => { V[0] = +x0; V[1] = +y0; V[2] = +x1; V[3] = +y1; V[4] = +x2; V[5] = +y2; polyFill(3, c | 0, 1); };
  // transform model points into V, returns vertex count (0 = invalid)
  const xform = (pts, x, y, rot, sc) => {
    if (!pts || !(pts.length >= 4)) return 0; x = +x; y = +y; rot = +rot || 0; sc = sc == null ? 1 : +sc; if (!(ok(x) && ok(y) && ok(sc) && ok(rot))) return 0;
    let n = pts.length >> 1; if (n > 4096) n = 4096; if (V.length < n * 2) V = new Float64Array(n * 2);
    const cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
    for (let k = 0; k < n; k++) { const px = +pts[k * 2], py = +pts[k * 2 + 1]; V[k * 2] = x + px * cs - py * sn; V[k * 2 + 1] = y + px * sn + py * cs; }
    return n;
  };
  const shape = (pts, x, y, rot, sc, c, addm) => { const n = xform(pts, x, y, rot, sc); if (!n) return; const m = addm ? 1 : 0; c = m ? c | 0 : col(c);
    for (let k = 0, p = n - 1; k < n; p = k++) seg(V[p * 2], V[p * 2 + 1], V[k * 2], V[k * 2 + 1], c, m, m === 1); };
  const fill = (pts, x, y, rot, sc, c) => { const n = xform(pts, x, y, rot, sc); if (n >= 3) polyFill(n, col(c), 0); };
  const fillA = (pts, x, y, rot, sc, c) => { const n = xform(pts, x, y, rot, sc); if (n >= 3) polyFill(n, c | 0, 1); };
  // glowing vector shape: soft additive outline + crisp core (the house style for enemies)
  const shapeG = (pts, x, y, rot, sc, c, w) => { const n = xform(pts, x, y, rot, sc); if (!n) return; w = w == null ? 2.5 : +w;
    const c2 = c | 0, half = mul8(c2, 110);
    // copy V since glowLine doesn't touch it, but seg doesn't either — safe to iterate directly
    for (let k = 0, p = n - 1; k < n; p = k++) glowLine(V[p * 2], V[p * 2 + 1], V[k * 2], V[k * 2 + 1], half, w, .8);
    for (let k = 0, p = n - 1; k < n; p = k++) seg(V[p * 2], V[p * 2 + 1], V[k * 2], V[k * 2 + 1], c2, 1, true); };

  // ---------- bitmap font: 5×8 glyphs in a 6px advance, 9px line height. 8 base32 digits per glyph (one per row, bit4 = left) ----------
  const FONT = '0000000044444040aaa00000aavavaa04fke5u40op248j30cik8lid044400000248884208422248004lel400044v440000000c48000v000000000cc011248gg0ehjlphe04ck444v0eh1248v0v2421he026aiv220vgu11he068guhhe0v1248880ehhehhe0ehhf12c00cc00cc00cc00c48248g842000v0v00084212480eh124040ehnlngf0ehhvhhh0uhhuhhu0ehggghe0sihhhis0vgguggv0vgguggg0ehgnhhf0hhhvhhh0e44444e072222ic0hikokih0ggggggv0hrllhhh0hhpljhh0ehhhhhe0uhhuggg0ehhhlid0uhhukih0fgge11u0v4444440hhhhhhe0hhhhha40hhhllla0hha4ahh0hha44440v1248gv0e88888e0gg842110e22222e04ah000000000000v8420000000e1fhf0gguhhhu000egghe011fhhhf000ehvge0698u888000fhhf1eggmphhh040c444e0206222icggikoki0c444443000qlllh000mphhh000ehhhe000uhhugg00fhhf1100mpggg000fge1u088u8896000hhhjd000hhha4000hhlla000ha4ah000hhhf1e00v248v03448443044444444o44244o0008l2000vvvvvvvv042v2400048v84004el444404444le400rvve400evlvea0004eve40044veerh06544ss00lalalala0112k80000eee000000000l00ha4ah00ciic000000040000gosusog00ehhhe00ssssssss0000vvvv';
  const NG = FONT.length >> 3, GB = new Uint8Array(NG * 8), GS = new Int32Array(NG + 1);
  for (let g = 0; g < NG; g++) for (let r = 0; r < 8; r++) GB[g * 8 + r] = parseInt(FONT[g * 8 + r], 32);
  let no = 0; for (let g = 0; g < NG; g++) { GS[g] = no; for (let r = 0; r < 8; r++) for (let b = 0; b < 5; b++) if (GB[g * 8 + r] & (16 >> b)) no++; } GS[NG] = no;
  const GO = new Int32Array(no); // per-glyph pixel offsets (row*W+col) for the unclipped fast path
  for (let g = 0, k = 0; g < NG; g++) for (let r = 0; r < 8; r++) for (let b = 0; b < 5; b++) if (GB[g * 8 + r] & (16 >> b)) GO[k++] = r * W + b;
  // char code -> glyph index (-1 = unknown -> '?'); extras 0x7f.. plus a few unicode aliases
  const CM = new Int16Array(0x2800).fill(31);   // 31 = '?'
  for (let c = 32; c < 127; c++) CM[c] = c - 32;
  for (let c = 127; c < 127 + NG - 95; c++) CM[c] = c - 32;
  const alias = { '█': 0x7f, '→': 0x80, '←': 0x81, '↑': 0x82, '↓': 0x83, '♥': 0x84, '❤': 0x84, '☠': 0x85, '◆': 0x86, '♦': 0x86,
    '★': 0x87, '♪': 0x88, '♫': 0x88, '░': 0x89, '▒': 0x89, '▓': 0x89, '✓': 0x8a, '•': 0x8b, '…': 0x8c, '×': 0x8d, '°': 0x8e,
    '·': 0x8f, '▶': 0x90, '►': 0x90, '○': 0x91, '●': 0x8b, '▌': 0x92, '▄': 0x93, '—': 45, '–': 45, '−': 45, '‘': 39, '’': 39,
    '“': 34, '”': 34, ' ': 32, '\t': 32 };
  for (const k in alias) CM[k.charCodeAt(0)] = alias[k] - 32;
  CM[10] = -2; // newline marker
  const glyphOf = ch => ch < 0x2800 ? CM[ch] : 31;
  const CHR = { block: '\x7f', right: '\x80', left: '\x81', up: '\x82', down: '\x83', heart: '\x84', skull: '\x85', diamond: '\x86', star: '\x87', note: '\x88',
    shade: '\x89', check: '\x8a', bullet: '\x8b', ellipsis: '\x8c', times: '\x8d', degree: '\x8e', middot: '\x8f', play: '\x90', circle: '\x91', halfL: '\x92', lowblk: '\x93' };

  const sc1 = s => { s = +s; return s >= 1 ? (s < 64 ? s : 64) : 1; };
  const str$ = s => typeof s === 'string' ? s : s == null ? '' : String(s);
  // draw one glyph at integer origin (scale 1)
  const glyph1 = (g, cx, cy, c) => {
    if (cx >= 0 && cx <= W - 5 && cy >= 0 && cy <= H - 8) { const o = cy * W + cx; for (let k = GS[g], e = GS[g + 1]; k < e; k++) fb[o + GO[k]] = c; return; }
    if (cx <= -5 || cx >= W || cy <= -8 || cy >= H) return;
    for (let r = 0; r < 8; r++) { const y = cy + r; if (y < 0 || y >= H) continue; const bits = GB[g * 8 + r]; if (!bits) continue;
      for (let b = 0; b < 5; b++) if (bits & (16 >> b)) { const x = cx + b; if (x >= 0 && x < W) fb[y * W + x] = c; } }
  };
  // scaled glyph, nearest (fractional scale -> uneven but stable pixel blocks)
  const glyphS = (g, ox, oy, s, c) => {
    if (ox >= W || oy >= H || ox + 5 * s <= 0 || oy + 8 * s <= 0) return;
    for (let r = 0; r < 8; r++) { const bits = GB[g * 8 + r]; if (!bits) continue;
      let y0 = Math.floor(oy + r * s), y1 = Math.floor(oy + (r + 1) * s); if (y0 < 0) y0 = 0; if (y1 > H) y1 = H; if (y0 >= y1) continue;
      for (let b = 0; b < 5; b++) if (bits & (16 >> b)) {
        let x0 = Math.floor(ox + b * s), x1 = Math.floor(ox + (b + 1) * s); if (x0 < 0) x0 = 0; if (x1 > W) x1 = W; if (x0 >= x1) continue;
        for (let y = y0; y < y1; y++) fb.fill(c, y * W + x0, y * W + x1);
      } }
  };
  // draw chars [i0,i1) on one line; returns nothing
  const run = (s, i0, i1, x, y, c, sc) => {
    if (y >= H || y + 8 * sc <= 0) return;
    if (sc === 1) { let cx = Math.floor(x); const cy = Math.floor(y);
      for (let i = i0; i < i1 && cx < W; i++, cx += 6) { if (cx <= -6) continue; const g = glyphOf(s.charCodeAt(i)); if (g > 0) glyph1(g, cx, cy, c); } return; }
    const adv = 6 * sc; let ox = x;
    for (let i = i0; i < i1 && ox < W; i++, ox += adv) { if (ox + adv <= 0) continue; const g = glyphOf(s.charCodeAt(i)); if (g > 0) glyphS(g, ox, y, sc, c); }
  };
  // number of chars on the longest line
  const maxLine = s => { let m = 0, k = 0; for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 10) { if (k > m) m = k; k = 0; } else k++; } return k > m ? k : m; };
  const textW = (s, sc) => maxLine(str$(s)) * 6 * sc1(sc);
  // align: 0 left (x = left), 1 centre (x = centre), 2 right (x = right edge, exclusive)
  const textAl = (s, x, y, c, sc, al) => {
    s = str$(s); sc = sc1(sc); x = +x; y = +y; const n = s.length;
    if (!(ok(x) && ok(y))) return maxLine(s) * 6 * sc; c = col(c);
    if (sc !== 1) { y = Math.floor(y); x = al ? x : Math.floor(x); }
    let i0 = 0, ly = y, mw = 0;
    for (let i = 0; i <= n; i++) {
      if (i === n || s.charCodeAt(i) === 10) {
        const k = i - i0, w = k * 6 * sc; if (w > mw) mw = w;
        if (k && ly < H) { const lx = al === 0 ? x : al === 1 ? Math.floor(x - (w - sc) / 2) : Math.floor(x - w + sc); run(s, i0, i, lx, ly, c, sc); }
        i0 = i + 1; ly += 9 * sc;
      }
    }
    return mw;
  };
  const text = (s, x, y, c, sc) => textAl(s, x, y, c, sc, 0);
  const textC = (s, cx, y, c, sc) => textAl(s, cx, y, c, sc, 1);
  const textR = (s, rx, y, c, sc) => textAl(s, rx, y, c, sc, 2);
  // outlined / shadowed text for readability on busy backgrounds
  const textO = (s, x, y, c, sc, oc, al) => { sc = sc1(sc); oc = oc == null ? A : oc; al = al | 0; const d = Math.max(1, Math.round(sc * .5));
    textAl(s, x - d, y, oc, sc, al); textAl(s, x + d, y, oc, sc, al); textAl(s, x, y - d, oc, sc, al); textAl(s, x, y + d, oc, sc, al); return textAl(s, x, y, c, sc, al); };
  const textS = (s, x, y, c, sc, sh, al) => { sc = sc1(sc); const d = Math.max(1, Math.round(sc * .5)); textAl(s, x + d, y + d, sh == null ? A : sh, sc, al | 0); return textAl(s, x, y, c, sc, al | 0); };
  // per-pixel shaded big text: fn(px,py,u,v) -> colour (0 = skip). u,v in 0..1 across the whole text block.
  // At scale ≥ 3 diagonal steps are smoothed (half-cell wedges) so logos don't look like raw blocks.
  const textFx = (s, x, y, sc, fn) => {
    s = str$(s); sc = sc1(sc); x = Math.floor(+x); y = Math.floor(+y); if (!(ok(x) && ok(y))) return 0;
    const solid = typeof fn === 'number' ? col(fn) : 0; if (!solid && typeof fn !== 'function') return 0;
    let lines = 1; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) lines++;
    const ml = maxLine(s), tw = Math.max(1, ml * 6 * sc - sc), th = Math.max(1, lines * 9 * sc - sc), iu = 1 / tw, iv = 1 / th, smooth = sc >= 3;
    const bit = (g, cxl, r) => cxl >= 0 && cxl < 5 && r >= 0 && r < 8 && (GB[g * 8 + r] & (16 >> cxl)) !== 0;
    let ox = x, oy = y;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i); if (ch === 10) { ox = x; oy += 9 * sc; continue; }
      const g = glyphOf(ch);
      if (g > 0 && ox < W && oy < H && ox + 6 * sc > 0 && oy + 9 * sc > 0) {
        for (let r = 0; r < 8; r++) for (let b = 0; b < 5; b++) {
          const on = bit(g, b, r);
          // wedge mask: which corner-triangles to add (empty cell) or remove (set cell). bits: 1=NE 2=NW 4=SE 8=SW
          let wedge = 0;
          if (smooth) {
            const n = bit(g, b, r - 1), so = bit(g, b, r + 1), e = bit(g, b + 1, r), w = bit(g, b - 1, r);
            if (!on) { if (n && e && !bit(g, b + 1, r - 1) && !so && !w) wedge |= 1; if (n && w && !bit(g, b - 1, r - 1) && !so && !e) wedge |= 2;
              if (so && e && !bit(g, b + 1, r + 1) && !n && !w) wedge |= 4; if (so && w && !bit(g, b - 1, r + 1) && !n && !e) wedge |= 8; if (!wedge) continue; }
          } else if (!on) continue;
          const x0 = Math.floor(ox + b * sc), x1 = Math.floor(ox + (b + 1) * sc), y0 = Math.floor(oy + r * sc), y1 = Math.floor(oy + (r + 1) * sc), cw = x1 - x0, chh = y1 - y0;
          for (let py = Math.max(0, y0); py < Math.min(H, y1); py++) {
            const ly = (py - y0 + .5) / chh;
            for (let px = Math.max(0, x0); px < Math.min(W, x1); px++) {
              if (wedge) { const lx = (px - x0 + .5) / cw;
                if (!((wedge & 1 && lx > ly) || (wedge & 2 && lx + ly < 1) || (wedge & 4 && lx + ly > 1) || (wedge & 8 && lx < ly))) continue; }
              const cc = solid || fn(px, py, (px - x) * iu, (py - y) * iv);
              if (cc) fb[py * W + px] = cc | A;
            }
          }
        }
      }
      ox += 6 * sc;
    }
    return ml * 6 * sc;
  };

  // ---------- sprites ----------
  const SPR = {}, PT = new Int32Array(6);
  const put = (i, s) => {
    if (PT[0] === 2) s = PT[5]; else if (PT[1]) s = A | (((s >> 16 & 255) * PT[4]) >> 8) << 16 | (((s >> 8 & 255) * PT[3]) >> 8) << 8 | (((s & 255) * PT[2]) >> 8);
    fb[i] = PT[0] === 1 ? addc(fb[i], s) : s;
  };
  // sprDef(name, w, h, pixels | fn(x,y)->c | 'string art', palette{char:colour}) ; 0 = transparent
  const sprDef = (name, w, h, src, pal) => {
    w = Math.max(1, Math.min(512, w | 0)); h = Math.max(1, Math.min(512, h | 0)); const px = new Uint32Array(w * h);
    if (typeof src === 'function') { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = src(x, y); px[y * w + x] = c ? (c | A) : 0; } }
    else if (typeof src === 'string') { const s = src.replace(/\s+/g, ''); for (let i = 0; i < w * h && i < s.length; i++) { const ch = s[i], c = pal && pal[ch] != null ? pal[ch] : (ch === '.' ? 0 : C.white); px[i] = c ? (c | A) : 0; } }
    else if (src && src.length) { for (let i = 0; i < w * h && i < src.length; i++) { const c = src[i]; px[i] = c ? (c | A) : 0; } }
    return (SPR[name] = { w, h, px });
  };
  // spr(name,x,y,rot=0,scale=1,tint) — centred; tint multiplies channels. mode: 0 normal, 1 additive, 2 silhouette (solid tint, e.g. hit flash)
  const spr = (name, x, y, rot, sc, tint, mode) => {
    const sp = SPR[name]; if (!sp) return; x = +x; y = +y; rot = +rot || 0; sc = sc == null ? 1 : +sc; mode = mode | 0;
    if (!(ok(x) && ok(y) && ok(rot) && sc > 0)) return; if (sc > 64) sc = 64;
    const w = sp.w, h = sp.h, px = sp.px;
    PT[0] = mode; PT[1] = tint != null ? 1 : 0; PT[2] = (tint & 255) + 1; PT[3] = (tint >> 8 & 255) + 1; PT[4] = (tint >> 16 & 255) + 1; PT[5] = col(tint);
    if (rot === 0 && sc === 1) {
      const x0 = Math.round(x - w / 2), y0 = Math.round(y - h / 2);
      for (let j = Math.max(0, -y0); j < h && y0 + j < H; j++) for (let i = Math.max(0, -x0); i < w && x0 + i < W; i++) { const s = px[j * w + i]; if (s) put((y0 + j) * W + x0 + i, s); }
      return;
    }
    const cs = Math.cos(rot), sn = Math.sin(rot), rad = Math.sqrt(w * w + h * h) * .5 * sc + 1, is = 1 / sc;
    const j0 = Math.max(0, Math.floor(y - rad)), j1 = Math.min(H - 1, Math.ceil(y + rad)), i0 = Math.max(0, Math.floor(x - rad)), i1 = Math.min(W - 1, Math.ceil(x + rad));
    const hw = w / 2, hh = h / 2, du = cs * is, dv = -sn * is;
    for (let j = j0; j <= j1; j++) {
      const dy = j + .5 - y, dx0 = i0 + .5 - x;
      let u = (dx0 * cs + dy * sn) * is + hw, v = (-dx0 * sn + dy * cs) * is + hh;
      for (let i = i0; i <= i1; i++, u += du, v += dv) {
        if (u >= 0 && u < w && v >= 0 && v < h) { const s = px[(v | 0) * w + (u | 0)]; if (s) put(j * W + i, s); }
      }
    }
  };
  // built-in procedural sprites (greyscale/white so tint works)
  sprDef('orb', 9, 9, (x, y) => { const d = Math.hypot(x - 4, y - 4) / 4.5; if (d > 1) return 0; const k = 1 - d * d, hl = Math.max(0, 1 - Math.hypot(x - 3, y - 3) / 2); const v = Math.min(255, 70 + 185 * k + 120 * hl); return rgb(v, v, v); });
  sprDef('bit', 5, 5, ['..#..', '.###.', '#####', '.###.', '..#..'].join(''));
  sprDef('cursor', 11, 11, (x, y) => { const dx = Math.abs(x - 5), dy = Math.abs(y - 5);
    if ((dx === 0 && dy >= 2 && dy <= 5) || (dy === 0 && dx >= 2 && dx <= 5)) return C.white; if (dx === 0 && dy === 0) return C.white; return 0; });
  sprDef('heart', 7, 6, ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'].join(''));
  sprDef('skull', 7, 7, ['.#####.', '#######', '#oo#oo#', '#oo#oo#', '###.###', '.#####.', '.#.#.#.'].join(''), { '#': C.white, o: rgb(30, 30, 30) });
  sprDef('chip', 9, 9, ['.#.#.#.#.', '#########', '.#ooooo#.', '##ooooo##', '.#ooooo#.', '##ooooo##', '.#ooooo#.', '#########', '.#.#.#.#.'].join(''), { '#': rgb(210, 210, 210), o: rgb(80, 80, 80) });
  sprDef('star', 7, 7, (x, y) => { const dx = Math.abs(x - 3), dy = Math.abs(y - 3); return (dx === 0 || dy === 0) && dx + dy <= 3 ? (dx + dy === 0 ? C.white : rgb(170, 170, 170)) : (dx === 1 && dy === 1 ? rgb(110, 110, 110) : 0); });

  // ---------- vector shape library: flat [x0,y0,...], radius ≈ 1, pointing +x at rot 0 (use rot = atan2(vy,vx)) ----------
  const poly = (n, r, a0) => { const o = []; for (let k = 0; k < n; k++) { const a = (a0 || 0) + k * TAU / n; o.push(+(Math.cos(a) * r).toFixed(4), +(Math.sin(a) * r).toFixed(4)); } return o; };
  const alt = (n, r1, r2, a0) => { const o = []; for (let k = 0; k < n * 2; k++) { const a = (a0 || 0) + k * PI / n, r = k & 1 ? r2 : r1; o.push(+(Math.cos(a) * r).toFixed(4), +(Math.sin(a) * r).toFixed(4)); } return o; };
  const SH = {
    ship: [1, 0, .1, .3, -.5, .9, -.75, .9, -.45, .25, -.75, 0, -.45, -.25, -.75, -.9, -.5, -.9, .1, -.3],
    dart: [1, 0, -.9, .45, -.55, 0, -.9, -.45],
    diamond: [1, 0, 0, .7, -1, 0, 0, -.7],
    hex: poly(6, 1, 0),
    star: alt(5, 1, .42, 0),
    cross: [.3, -1, .3, -.3, 1, -.3, 1, .3, .3, .3, .3, 1, -.3, 1, -.3, .3, -1, .3, -1, -.3, -.3, -.3, -.3, -1],
    arrow: [1, 0, .15, .75, .15, .3, -1, .3, -1, -.3, .15, -.3, .15, -.75],
    skull: [-.8, .15, -.88, -.3, -.65, -.75, -.25, -.97, .25, -.97, .65, -.75, .88, -.3, .8, .15, .5, .4, .5, .9, .25, .75, 0, .9, -.25, .75, -.5, .9, -.5, .4],
    chip: (() => { const o = [], q = .62; // square body with 2 pins per side
      const side = (ax, ay, bx, by, nx, ny) => { o.push(ax, ay); for (const t of [.3, .7]) { const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, dx = (bx - ax) * .1, dy = (by - ay) * .1;
        o.push(+(px - dx).toFixed(3), +(py - dy).toFixed(3), +(px - dx + nx * .38).toFixed(3), +(py - dy + ny * .38).toFixed(3), +(px + dx + nx * .38).toFixed(3), +(py + dy + ny * .38).toFixed(3), +(px + dx).toFixed(3), +(py + dy).toFixed(3)); } };
      side(-q, -q, q, -q, 0, -1); side(q, -q, q, q, 1, 0); side(q, q, -q, q, 0, 1); side(-q, q, -q, -q, -1, 0); return o; })(),
    eye: (() => { const o = []; for (let k = 0; k <= 8; k++) { const t = k / 8, a = PI * t; o.push(+Math.cos(a).toFixed(4), +(-Math.sin(a) * .62).toFixed(4)); }
      for (let k = 1; k <= 7; k++) { const a = PI + PI * k / 8; o.push(+Math.cos(a).toFixed(4), +(-Math.sin(a) * .62).toFixed(4)); } return o; })(),
    gear: (() => { const o = []; for (let k = 0; k < 8; k++) { const a = k * TAU / 8, d = TAU / 8;
      for (const [f, r] of [[0, .72], [.18, .72], [.28, 1], [.62, 1], [.72, .72]]) { const b = a + f * d; o.push(+(Math.cos(b) * r).toFixed(4), +(Math.sin(b) * r).toFixed(4)); } } return o; })(),
    bolt: [.35, -1, -.55, .12, -.05, .12, -.35, 1, .55, -.15, .05, -.15],
    tri: [1, 0, -.5, .866, -.5, -.866],
    square: [.8, .8, -.8, .8, -.8, -.8, .8, -.8],
    ring: poly(16, 1, 0),
    oct: poly(8, 1, PI / 8),
    bug: [.9, 0, .55, .45, .9, .75, .35, .6, 0, .7, -.35, .6, -.9, .75, -.55, .45, -.9, 0, -.55, -.45, -.9, -.75, -.35, -.6, 0, -.7, .35, -.6, .9, -.75, .55, -.45]
  };

  // ---------- particles: SoA pool, swap-remove, additive ----------
  const PN = 4096;
  const px_ = new Float32Array(PN), py_ = new Float32Array(PN), vx_ = new Float32Array(PN), vy_ = new Float32Array(PN), lf_ = new Float32Array(PN), ml_ = new Float32Array(PN),
    sz_ = new Float32Array(PN), gr_ = new Float32Array(PN), dr_ = new Float32Array(PN), cl_ = new Uint32Array(PN), kd_ = new Uint8Array(PN), tx_ = new Array(PN).fill(null);
  let pn = 0, pcur = 0;
  // kinds: 0 dot/spark, 1 ring, 2 text, 3 bolt
  const palloc = () => { if (pn < PN) return pn++; pcur = (pcur + 1) % PN; tx_[pcur] = null; return pcur; };
  const BO = new Float32Array(65);
  const pmove =(d, s) => { px_[d] = px_[s]; py_[d] = py_[s]; vx_[d] = vx_[s]; vy_[d] = vy_[s]; lf_[d] = lf_[s]; ml_[d] = ml_[s]; sz_[d] = sz_[s]; gr_[d] = gr_[s]; dr_[d] = dr_[s]; cl_[d] = cl_[s]; kd_[d] = kd_[s]; tx_[d] = tx_[s]; tx_[s] = null; };
  const spark = (x, y, vx, vy, c, life, size, grav, drag) => {
    x = +x; y = +y; vx = +vx || 0; vy = +vy || 0; life = life == null ? .5 : +life; if (!(ok(x) && ok(y) && life > 0 && ok(vx) && ok(vy))) return;
    const i = palloc(); px_[i] = x; py_[i] = y; vx_[i] = vx; vy_[i] = vy; lf_[i] = ml_[i] = Math.min(life, 60); sz_[i] = size == null ? 1 : clamp(+size || 1, .2, 32);
    gr_[i] = +grav || 0; dr_[i] = drag == null ? 1.5 : +drag || 0; cl_[i] = c | A; kd_[i] = 0;
  };
  const burst = (x, y, n, c, speed, life, o) => {
    x = +x; y = +y; if (!(ok(x) && ok(y))) return; n = Math.min(PN, Math.max(0, n | 0)); speed = speed == null ? 60 : +speed || 0; life = life == null ? .5 : +life; if (!(life > 0)) return;
    const grav = o && o.grav || 0, drag = o && o.drag != null ? +o.drag : 2, size = o && o.size || 1, spread = o && o.spread != null ? +o.spread : TAU, ang = o && o.ang || 0, hot = o && o.hot != null ? o.hot : .3, c2 = o && o.c2;
    c |= 0;
    for (let k = 0; k < n; k++) {
      const a = ang + (fr() - .5) * spread, v = speed * (.08 + .92 * fr()), l = life * (.55 + .7 * fr());
      let cc = c2 != null && fr() < .5 ? c2 | 0 : c; if (fr() < hot) cc = blend(cc, -1, 140);
      spark(x, y, Math.cos(a) * v, Math.sin(a) * v, cc, l, size * (.6 + .8 * fr()), grav, drag);
    }
  };
  const ring = (x, y, r0, r1, c, life) => { x = +x; y = +y; r0 = +r0 || 0; r1 = r1 == null ? 30 : +r1; life = life == null ? .4 : +life;
    if (!(ok(x) && ok(y) && ok(r1) && life > 0)) return; const i = palloc(); px_[i] = x; py_[i] = y; vx_[i] = Math.max(0, r0); vy_[i] = Math.max(0, Math.min(2000, r1)); lf_[i] = ml_[i] = Math.min(life, 60); cl_[i] = c | A; kd_[i] = 1; sz_[i] = 2; };
  const floatText = (s, x, y, c, life) => { x = +x; y = +y; life = life == null ? .8 : +life; if (!(ok(x) && ok(y) && life > 0)) return;
    const i = palloc(); px_[i] = x; py_[i] = y; vx_[i] = 0; vy_[i] = -42; lf_[i] = ml_[i] = Math.min(life, 60); cl_[i] = c | A; kd_[i] = 2; tx_[i] = str$(s); dr_[i] = 3; gr_[i] = 0; };
  // lightning: drawn immediately by boltNow; GFX.bolt queues a short-lived flickering bolt rendered by pDraw (safe to call from update OR draw;
  // calling it every frame with the same endpoints just keeps one bolt alive)
  const boltNow = (x0, y0, x1, y1, c, jag, seed) => {
    x0 = +x0; y0 = +y0; x1 = +x1; y1 = +y1; jag = jag == null ? 6 : +jag || 0; if (!(ok(x0) && ok(y0) && ok(x1) && ok(y1))) return;
    if (seed != null) rs = (seed * 2654435761) | 1;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy); if (len > 4000) return;
    // midpoint displacement: 2^lv segments, displacement halves-ish per level
    let lv = 1; while (lv < 6 && (len >> lv) > 5) lv++;
    const ns = 1 << lv, nx = len ? -dy / len : 0, ny = len ? dx / len : 0, hot = blend(c | 0, -1, 130), dim = mul8(c | 0, 90);
    BO[0] = 0; BO[ns] = 0;
    for (let step = ns, amp = jag * Math.max(1, Math.sqrt(len / 60)); step > 1; step >>= 1, amp *= .58) for (let k = step >> 1; k < ns; k += step) BO[k] = (BO[k - (step >> 1)] + BO[k + (step >> 1)]) * .5 + (fr() * 2 - 1) * amp;
    let ax = x0, ay = y0;
    for (let k = 1; k <= ns; k++) {
      const t = k / ns, off = BO[k], bx = x0 + dx * t + nx * off, by = y0 + dy * t + ny * off;
      seg(ax + nx, ay + ny, bx + nx, by + ny, dim, 1, true); seg(ax, ay, bx, by, hot, 1, k !== ns);
      if (jag > 2 && k < ns && fr() < .07) { // forked branch
        const fa = Math.atan2(by - ay, bx - ax) + (fr() < .5 ? -1 : 1) * (.4 + fr() * .7), fl = len / ns * (1.5 + fr() * 2.5);
        const ex = bx + Math.cos(fa) * fl, ey = by + Math.sin(fa) * fl, mx = (bx + ex) / 2 + (fr() - .5) * fl * .4, my = (by + ey) / 2 + (fr() - .5) * fl * .4;
        seg(bx, by, mx, my, dim, 1, true); seg(mx, my, ex, ey, mul8(dim, 150), 1, false); }
      ax = bx; ay = by;
    }
    glow(x0, y0, 6, c, .8); glow(x1, y1, 6, c, .8);
  };
  const bolt = (x0, y0, x1, y1, c, jag, life) => {
    x0 = +x0; y0 = +y0; x1 = +x1; y1 = +y1; if (!(ok(x0) && ok(y0) && ok(x1) && ok(y1))) return; life = life == null ? .12 : +life || .12; c |= A;
    for (let i = 0; i < pn; i++) if (kd_[i] === 3 && cl_[i] === (c >>> 0) && Math.abs(px_[i] - x0) < 1.5 && Math.abs(py_[i] - y0) < 1.5 && Math.abs(vx_[i] - x1) < 1.5 && Math.abs(vy_[i] - y1) < 1.5) { lf_[i] = ml_[i] = life; return; }
    const i = palloc(); px_[i] = x0; py_[i] = y0; vx_[i] = x1; vy_[i] = y1; lf_[i] = ml_[i] = Math.min(life, 10); cl_[i] = c; kd_[i] = 3; sz_[i] = jag == null ? 6 : +jag || 0;
  };
  const pUpdate = dt => {
    dt = +dt; if (!(dt > 0)) return; if (dt > .1) dt = .1;
    for (let i = 0; i < pn; i++) {
      const l = lf_[i] - dt; if (l <= 0) { pn--; if (i !== pn) pmove(i, pn); else tx_[i] = null; i--; continue; } lf_[i] = l;
      const k = kd_[i]; if (k === 1 || k === 3) continue;
      const d = dr_[i]; if (d > 0) { const f = 1 / (1 + d * dt); vx_[i] *= f; vy_[i] *= f; }
      vy_[i] += gr_[i] * dt; px_[i] += vx_[i] * dt; py_[i] += vy_[i] * dt;
    }
  };
  const pDraw = () => {
    for (let i = 0; i < pn; i++) {
      const t = lf_[i] / ml_[i], k = kd_[i], c = cl_[i], x = px_[i], y = py_[i];
      if (k === 0) {
        const m = (Math.sqrt(t) * 256) | 0, cc = mul8(c, m), s = sz_[i] * (.4 + .6 * t), vx = vx_[i], vy = vy_[i], v2 = vx * vx + vy * vy;
        if (v2 > 2500) seg(x - vx * .028, y - vy * .028, x, y, mul8(c, m >> 1), 1, true);   // motion streak
        if (s <= 1.25) add(x, y, cc); else glow(x, y, s * 1.7, c, t * .9);
      } else if (k === 1) {
        const e = 1 - t, r = vx_[i] + (vy_[i] - vx_[i]) * (1 - (1 - e) * (1 - e) * (1 - e)), cc = mul8(c, (t * 230) | 0);
        ringM(x, y, r, cc, 1, 1 + 2.5 * t); if (r > 3) ringM(x, y, r - 2.5 - 2.5 * t, mul8(c, (t * 70) | 0), 1, 2);
      } else if (k === 2) {
        const e = 1 - t, sc = e < .08 ? 2 : 1, a = t > .3 ? 256 : (t / .3 * 256) | 0, s = tx_[i];
        if (a > 20 && !(t < .3 && (S.frame & 1))) { textAl(s, x + 1, y + 1, A, sc, 1); textAl(s, x, y, mul8(c, a), sc, 1); }
      } else {
        boltNow(x, y, vx_[i], vy_[i], mul8(c, (Math.min(1, t * 1.6) * 256) | 0), sz_[i]);
      }
    }
  };
  const pClear = () => { for (let i = 0; i < pn; i++) tx_[i] = null; pn = 0; };

  // ---------- framebuffer snapshots ----------
  const snap = buf => { if (buf && buf.length === N && buf !== fb) { buf.set(fb); return buf; } return new Uint32Array(fb); };
  const copy = (dst, src) => { src = src || fb; if (!dst || !dst.set || dst === src) return dst; const n = Math.min(dst.length, src.length); if (n === src.length) dst.set(src); else dst.set(src.subarray(0, n)); return dst; };
  // blit(buf, a=1, additive=false): alpha-blend (or add, scaled by a) a full-screen buffer onto fb
  const blit = (buf, a, addm) => {
    if (!buf || buf.length < N || buf === fb) return; a = a == null ? 1 : +a; if (!(a > 0)) return;
    if (addm) { const m = Math.min(256, (a * 256) | 0); for (let i = 0; i < N; i++) fb[i] = addc(fb[i], m >= 256 ? buf[i] : mul8(buf[i], m)); return; }
    if (a >= 1) { fb.set(buf.length === N ? buf : buf.subarray(0, N)); return; }
    const m = (a * 256 + .5) | 0; for (let i = 0; i < N; i++) fb[i] = blend(fb[i], buf[i], m);
  };

  return {
    clear, fade, pset, add, get, rect, rectA, rectAdd, frame, line, lineA, glowLine, circ, circA, disc, discA, discB, glow, tri, triA, shape, shapeG, fill, fillA,
    text, textW, textC, textR, textO, textS, textFx, CHR, hsv, mix, scale, addc: (a, b) => addc(a, b) >>> 0, lum,
    spr, sprDef, SPR, SH, burst, spark, ring, floatText, bolt, boltNow, pUpdate, pDraw, pClear, pCount: () => pn, PMAX: PN,
    copy, snap, blit
  };
})();
