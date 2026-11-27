// ===== TEST STUB GFX (minimal real implementation of the SPEC API) =====
const GFX = (() => {
  const R = c => c & 255, G = c => c >> 8 & 255, B = c => c >> 16 & 255;
  const pset = (x, y, c) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < W && y < H) fb[y * W + x] = c; };
  const add = (x, y, c) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = y * W + x, d = fb[i];
    fb[i] = rgb(Math.min(255, R(d) + R(c)), Math.min(255, G(d) + G(c)), Math.min(255, B(d) + B(c))); };
  const scale = (c, k) => rgb(R(c) * k, G(c) * k, B(c) * k);
  const mix = (a, b, t) => rgb(lerp(R(a), R(b), t), lerp(G(a), G(b), t), lerp(B(a), B(b), t));
  const hsv = (h, s, v) => { h = ((h % 1) + 1) % 1 * 6; const i = h | 0, f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]; return rgb(r * 255, g * 255, b * 255); };
  function line(x0, y0, x1, y1, c, a) { const dx = x1 - x0, dy = y1 - y0, n = Math.min(2000, Math.max(Math.abs(dx), Math.abs(dy)) | 0) + 1;
    for (let i = 0; i <= n; i++) { const t = i / n; (a ? add : pset)(x0 + dx * t, y0 + dy * t, c); } }
  function rect(x, y, w, h, c) { for (let j = Math.max(0, y | 0); j < Math.min(H, (y + h) | 0); j++) for (let i = Math.max(0, x | 0); i < Math.min(W, (x + w) | 0); i++) fb[j * W + i] = c; }
  function rectA(x, y, w, h, c, a) { for (let j = Math.max(0, y | 0); j < Math.min(H, (y + h) | 0); j++) for (let i = Math.max(0, x | 0); i < Math.min(W, (x + w) | 0); i++) fb[j * W + i] = mix(fb[j * W + i], c, a); }
  function disc(x, y, r, c) { for (let j = Math.ceil(-r); j <= r; j++) for (let i = Math.ceil(-r); i <= r; i++) if (i * i + j * j <= r * r) pset(x + i, y + j, c); }
  function circ(x, y, r, c) { const n = Math.max(8, r * 6 | 0); for (let i = 0; i < n; i++) { const a = i / n * TAU; pset(x + Math.cos(a) * r, y + Math.sin(a) * r, c); } }
  function glow(x, y, r, c, a = 1) { const r2 = r * r; for (let j = Math.ceil(-r); j <= r; j++) for (let i = Math.ceil(-r); i <= r; i++) { const d = (i * i + j * j) / r2; if (d < 1) { const k = (1 - d) * (1 - d) * a * .6; add(x + i, y + j, scale(c, k)); } } }
  function shape(pts, x, y, rot, s, c, ad) { const co = Math.cos(rot) * s, si = Math.sin(rot) * s, n = pts.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[j * 2], by = pts[j * 2 + 1];
      line(x + ax * co - ay * si, y + ax * si + ay * co, x + bx * co - by * si, y + bx * si + by * co, c, ad); } }
  // font via canvas
  const cvs = document.createElement('canvas'); cvs.width = 6 * 96; cvs.height = 8; const cx = cvs.getContext('2d');
  cx.fillStyle = '#000'; cx.fillRect(0, 0, cvs.width, 8); cx.fillStyle = '#fff'; cx.font = 'bold 8px monospace'; cx.textBaseline = 'top';
  for (let i = 0; i < 96; i++) cx.fillText(String.fromCharCode(32 + i), i * 6, 0);
  const fd = cx.getImageData(0, 0, cvs.width, 8).data, font = new Uint8Array(96 * 48);
  for (let i = 0; i < 96; i++) for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) font[i * 48 + y * 6 + x] = fd[(y * cvs.width + i * 6 + x) * 4] > 100 ? 1 : 0;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) font[95 * 48 + y * 6 + x] = 1;
  function text(s, x, y, c, sc = 1) { s = String(s); let cx0 = x; for (let k = 0; k < s.length; k++) { const ch = s.charCodeAt(k) - 32; if (ch === 10 - 32) { y += 9 * sc; x = cx0; continue; }
      if (ch >= 0 && ch < 96) for (let j = 0; j < 8 * sc; j++) for (let i = 0; i < 6 * sc; i++) if (font[ch * 48 + ((j / sc) | 0) * 6 + ((i / sc) | 0)]) pset(x + i, y + j, c); x += 6 * sc; } return s.length * 6 * sc; }
  const textW = (s, sc = 1) => String(s).length * 6 * sc;
  // particles
  const P = []; const N = 3000;
  function spawnP(x, y, vx, vy, c, life, size, drag, grav) { if (P.length >= N) P.shift(); P.push({ x, y, vx, vy, c, life, l0: life, size: size || 1, drag: drag || 0, grav: grav || 0 }); }
  const rings = [], texts = [], bolts = [];
  return {
    clear(c) { fb.fill(c); }, fade(k) { for (let i = 0; i < fb.length; i++) fb[i] = scale(fb[i], k); },
    pset, add, rect, rectA, frame(x, y, w, h, c) { line(x, y, x + w - 1, y, c); line(x, y + h - 1, x + w - 1, y + h - 1, c); line(x, y, x, y + h - 1, c); line(x + w - 1, y, x + w - 1, y + h - 1, c); },
    line: (a, b, c2, d, c) => line(a, b, c2, d, c), lineA: (a, b, c2, d, c) => line(a, b, c2, d, c, 1), circ, disc, discA: disc, discB: disc, glow,
    tri() { }, shape, fill(pts, x, y, rot, s, c) { shape(pts, x, y, rot, s, c); },
    text, textW, textC: (s, cx, y, c, sc = 1) => text(s, cx - textW(s, sc) / 2, y, c, sc), textR: (s, rx, y, c, sc = 1) => text(s, rx - textW(s, sc), y, c, sc),
    textFx() { }, hsv, mix, scale, spr() { }, sprDef() { },
    burst(x, y, n, c, sp = 60, life = .5, o = {}) { for (let i = 0; i < n; i++) { const a = (o.ang != null ? o.ang + (rnd() - .5) * (o.spread || TAU) : rnd() * TAU), s = sp * (.3 + rnd() * .7); spawnP(x, y, Math.cos(a) * s, Math.sin(a) * s, c, life * (.5 + rnd() * .5), o.size, o.drag, o.grav); } },
    spark(x, y, vx, vy, c, life = .3, size = 1) { spawnP(x, y, vx, vy, c, life, size); },
    ring(x, y, r0, r1, c, life = .3) { rings.push({ x, y, r0, r1, c, life, t: 0 }); },
    floatText(s, x, y, c, life = .8) { texts.push({ s, x, y, c, life, t: 0 }); },
    bolt(x0, y0, x1, y1, c) { bolts.push({ x0, y0, x1, y1, c, t: .1 }); },
    pUpdate(dt) { for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; p.life -= dt; if (p.life <= 0) { P.splice(i, 1); continue; } p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      for (const a of [rings, texts]) for (let i = a.length - 1; i >= 0; i--) { a[i].t += dt; if (a[i].t > a[i].life) a.splice(i, 1); }
      for (let i = bolts.length - 1; i >= 0; i--) { bolts[i].t -= dt; if (bolts[i].t <= 0) bolts.splice(i, 1); } },
    pDraw() { for (const p of P) { const k = p.life / p.l0; add(p.x, p.y, scale(p.c, k)); if (p.size > 1) add(p.x + 1, p.y, scale(p.c, k)); }
      for (const r of rings) { const t = r.t / r.life; circ(r.x, r.y, lerp(r.r0, r.r1, t), scale(r.c, 1 - t)); }
      for (const t of texts) text(t.s, t.x - t.s.length * 3, t.y - t.t * 20, t.c);
      for (const b of bolts) { let px = b.x0, py = b.y0; for (let i = 1; i <= 6; i++) { const t = i / 6, nx = lerp(b.x0, b.x1, t) + (i < 6 ? (Math.random() - .5) * 8 : 0), ny = lerp(b.y0, b.y1, t) + (i < 6 ? (Math.random() - .5) * 8 : 0); line(px, py, nx, ny, b.c, 1); px = nx; py = ny; } } },
    pClear() { P.length = 0; rings.length = 0; texts.length = 0; bolts.length = 0; },
    pCount: () => P.length,
    copy(d, s) { d.set(s); }, snap() { return fb.slice(); }, blit() { },
    SH: { ship: [1, 0, -1, .7, -1, -.7], dart: [1, 0, -1, .5, -1, -.5], diamond: [1, 0, 0, 1, -1, 0, 0, -1], hex: [], star: [], cross: [], arrow: [], skull: [], chip: [], eye: [], gear: [], bolt: [], tri: [], square: [] },
  };
})();
