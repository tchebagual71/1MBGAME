// ===== 60-ui.js : SELF.MOD interface — scenes boot/title/patch/pause/over/win, HUD, overlay (banners, live-patch ticker, sticks) =====
// Everything is drawn into the 480x270 fb through GFX (6x8 cells -> 80x33 chars). Other modules are only called lazily.
const UI = (() => {
  // ---------- palette ----------
  const K = {
    black: C.black, bg: rgb(5, 7, 14), panel: rgb(8, 10, 22), line: rgb(46, 70, 130), dim: rgb(96, 108, 140), dim2: rgb(130, 140, 170), txt: rgb(200, 210, 232),
    white: C.white, cyan: C.cyan, mag: C.magenta, yel: C.yellow, red: C.red, grn: C.green, org: C.orange, blue: C.blue,
    kw: rgb(255, 120, 210), fn: rgb(110, 200, 255), num: rgb(255, 214, 100), str: rgb(255, 156, 86), com: rgb(84, 104, 136), op: rgb(150, 162, 196),
    id: rgb(206, 216, 236), konst: rgb(120, 255, 196), dred: rgb(70, 8, 18), red2: rgb(255, 70, 90), dgrn: rgb(8, 56, 28), hl: rgb(36, 52, 96)
  };

  // ---------- safe lazy wrappers ----------
  const sfx = (n, o) => { try { AU.sfx(n, o); } catch (e) { } };
  const music = n => { try { AU.music(n); } catch (e) { } };
  const hasFx = n => { try { return !FX.names || FX.names.indexOf(n) >= 0; } catch (e) { return false; } };
  const fxSet = (n, f) => { try { if (hasFx(n)) FX.set(n, f); } catch (e) { } };
  const fxDim = d => { try { FX.dim = d; } catch (e) { } };
  const fxDraw = dt => { try { FX.draw(dt); } catch (e) { fb.fill(K.bg); } };
  const gameDraw = () => { try { GAME.draw(); } catch (e) { } };
  const sectorName = () => { try { const s = DIR.sectors[S.sector]; return s && s.name || ''; } catch (e) { return ''; } };
  const fmtT = s => { s = Math.max(0, s | 0); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
  const clip = (s, n) => (s = String(s), s.length > n ? s.slice(0, Math.max(0, n - 2)) + '..' : s);
  const split = s => String(s == null ? '' : s).replace(/\t/g, '  ').split('\n');
  const inR = (x, y, r) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];

  // ---------- text helpers ----------
  const tx = (s, x, y, c, sc) => GFX.text(s, x, y, c, sc || 1);
  const txs = (s, x, y, c, sc) => { sc = sc || 1; const d = sc > 1 ? 2 : 1; GFX.text(s, x + d, y + d, K.black, sc); return GFX.text(s, x, y, c, sc); };
  const txc = (s, cx, y, c, sc) => txs(s, Math.round(cx - GFX.textW(s, sc || 1) / 2), y, c, sc);
  const txr = (s, rx, y, c, sc) => txs(s, rx - GFX.textW(s, sc || 1), y, c, sc);
  function wrap(s, n) {
    const out = [];
    for (const para of String(s || '').split('\n')) {
      let line = '';
      for (const w0 of para.split(' ')) { let w = w0;
        if (!line) line = w; else if (line.length + 1 + w.length <= n) line += ' ' + w; else { out.push(line); line = w; }
        while (line.length > n) { out.push(line.slice(0, n)); line = line.slice(n); } }
      out.push(line);
    }
    return out;
  }
  function panel(x, y, w, h, title, c, a) {
    c = c || K.line;
    GFX.rectA(x, y, w, h, K.panel, a == null ? .86 : a); GFX.frame(x, y, w, h, c);
    if (title) { GFX.rect(x + 1, y + 1, w - 2, 10, GFX.scale(c, .42)); tx(title, x + 4, y + 2, K.white); }
  }
  // additive horizontal row (copper bars) and row tearing (glitch) straight on fb
  function addRow(y, r, g, b) {
    y |= 0; if (y < 0 || y >= H) return; const o = y * W;
    for (let x = 0; x < W; x++) { const p = fb[o + x], R = (p & 255) + r, G = (p >> 8 & 255) + g, B = (p >> 16 & 255) + b;
      fb[o + x] = 0xff000000 | (B > 255 ? 255 : B) << 16 | (G > 255 ? 255 : G) << 8 | (R > 255 ? 255 : R); }
  }
  function shiftRow(y, k) { y |= 0; k |= 0; if (y < 0 || y >= H || !k || k >= W || k <= -W) return; const o = y * W;
    if (k > 0) fb.copyWithin(o + k, o, o + W - k); else fb.copyWithin(o, o - k, o + W); }
  function tear(y0, y1, amt) { for (let y = y0; y < y1; y++) if (Math.random() < .35) shiftRow(y, (Math.random() - .5) * 2 * amt); }
  function darken(x, y, w, h, a) { GFX.rectA(x, y, w, h, K.black, a); }

  // ---------- font atlas read back from GFX (for per-pixel logo + per-column sine scroller) ----------
  let ATL = null, LOGO = null;
  function atlas() {
    if (ATL) return ATL;
    const A = new Uint8Array(96 * 48), save = fb.slice(0, W * 8);
    try {
      for (let base = 0; base < 95; base += 80) {
        fb.fill(K.black, 0, W * 8); let s = ''; const end = Math.min(95, base + 80);
        for (let i = base; i < end; i++) s += String.fromCharCode(32 + i);
        GFX.text(s, 0, 0, K.white, 1);
        for (let i = base; i < end; i++) for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 6; gx++) {
          const p = fb[gy * W + (i - base) * 6 + gx]; A[i * 48 + gy * 6 + gx] = ((p & 255) + (p >> 8 & 255) + (p >> 16 & 255)) > 300 ? 1 : 0; }
      }
      ATL = A;
    } catch (e) { }
    fb.set(save);
    return A;
  }
  function logoMask(str) {
    const A = atlas(), n = str.length, M = new Uint8Array(n * 6 * 8);
    for (let i = 0; i < n; i++) { const g = clamp(str.charCodeAt(i) - 32, 0, 94); for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) M[y * n * 6 + i * 6 + x] = A[g * 48 + y * 6 + x]; }
    return { M, w: n * 6, h: 8 };
  }

  // ---------- LIVE functions owned by UI ----------
  LIVE.def('ui.digits', 'n,len', [
    "const PAD = 8, BASE = 10, GLYPHS = '0123456789', SCRAMBLE = 0;",
    "n = Math.max(0, Math.floor(n || 0));",
    "let s = '';",
    "do { s = GLYPHS[n % BASE] + s; n = Math.floor(n / BASE); } while (n > 0);",
    "while (s.length < (len || PAD)) s = GLYPHS[0] + s;",
    "if (SCRAMBLE) s = s.replace(/./g, (c, i) => GLYPHS[(GLYPHS.indexOf(c) * 7 + i * 3 + (S.t * 6 | 0)) % BASE]);",
    "return s;"].join('\n'));
  LIVE.def('ui.wave', 'x,t', [
    "// vertical offset of the sine scroller at screen column x",
    "const AMP = 9, FREQ = .024, SPEED = 2.6, RIPPLE = .35;",
    "return Math.sin(x * FREQ + t * SPEED) * AMP",
    "     + Math.sin(x * FREQ * 2.3 - t * 1.7) * AMP * RIPPLE;"].join('\n'));
  LIVE.def('ui.hudpost', 'y0,y1', [
    "// post-pass over the status rows (top strip, bottom bug line)",
    "const MIRROR = 0, JITTER = 0;",
    "if (!MIRROR && !JITTER) return;",
    "for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {",
    "  const o = y * W, k = JITTER ? (Math.sin(y * 1.7 + S.t * 31) * JITTER) | 0 : 0;",
    "  if (MIRROR) fb.subarray(o, o + W).reverse();",
    "  if (k > 0) fb.copyWithin(o + k, o, o + W - k);",
    "  else if (k < 0) fb.copyWithin(o, o - k, o + W);",
    "}"].join('\n'));
  PATCH.def({ id: 'uiScramble', name: '0xFACE: HUD_SCRAMBLE', kind: 'bug', weight: .7, fn: 'ui.digits',
    desc: 'SCRAMBLE = 0 -> 1 : the score counter now lies to you',
    apply() { return LIVE.patch('ui.digits', 'SCRAMBLE = 0', 'SCRAMBLE = 1'); } });
  PATCH.def({ id: 'uiMirror', name: '0xB1A5: HUD_MIRROR', kind: 'bug', weight: .6, fn: 'ui.hudpost',
    desc: 'MIRROR = 0 -> 1 : status lines render backwards and shake',
    apply() { return LIVE.patch('ui.hudpost', 'MIRROR = 0, JITTER = 0', 'MIRROR = 1, JITTER = 2'); } });

  // ---------- line diff (prefix/suffix trim + LCS on the middle) ----------
  function diffLines(a, b) {
    const out = []; let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    for (let i = 0; i < s; i++) out.push({ op: ' ', s: a[i] });
    const A = a.slice(s, ea), B = b.slice(s, eb), n = A.length, m = B.length;
    if (n * m > 60000) { for (const l of A) out.push({ op: '-', s: l }); for (const l of B) out.push({ op: '+', s: l }); }
    else {
      const L = []; for (let i = 0; i <= n; i++) L.push(new Int32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) { if (A[i] === B[j]) { out.push({ op: ' ', s: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', s: A[i++] }); else out.push({ op: '+', s: B[j++] }); }
      while (i < n) out.push({ op: '-', s: A[i++] }); while (j < m) out.push({ op: '+', s: B[j++] });
    }
    for (let i = ea; i < a.length; i++) out.push({ op: ' ', s: a[i] });
    let ln = 0; for (const o of out) o.n = o.op === '-' ? 0 : ++ln;
    // pair runs of -/+ and find the changed character span inside each pair
    for (let i = 0; i < out.length;) {
      if (out[i].op === ' ') { i++; continue; }
      const mi = [], pi = []; let j = i;
      while (j < out.length && out[j].op === '-') mi.push(out[j++]);
      while (j < out.length && out[j].op === '+') pi.push(out[j++]);
      for (let k = 0; k < Math.max(mi.length, pi.length); k++) {
        const o = mi[k], p = pi[k];
        if (o && p) { let q = 0; const x = o.s, y = p.s; while (q < x.length && q < y.length && x[q] === y[q]) q++;
          let ex = x.length, ey = y.length; while (ex > q && ey > q && x[ex - 1] === y[ey - 1]) { ex--; ey--; }
          o.a = q; o.b = ex; p.a = q; p.b = ey; }
        else { const r = o || p, ind = r.s.length - r.s.replace(/^\s+/, '').length; r.a = ind; r.b = r.s.length; }
      }
      i = j;
    }
    return out;
  }

  // ---------- syntax tinted source lines ----------
  const KW = new Set('const let var if else for while do return function new of in break continue true false null undefined this typeof switch case default'.split(' '));
  const TOK = /(\/\/.*$)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`[^`]*`?)|(\d[\w.]*|\.\d+)|([A-Za-z_$][\w$]*)|(\s+)|([^\w\s'"`$]+)/g;
  const tokCache = new Map();
  function tokens(line) {
    let t = tokCache.get(line); if (t) return t; t = []; TOK.lastIndex = 0; let m;
    while ((m = TOK.exec(line))) {
      if (!m[0].length) { TOK.lastIndex++; continue; }
      let c; if (m[5]) continue;
      if (m[1]) c = K.com; else if (m[2]) c = K.str; else if (m[3]) c = K.num;
      else if (m[4]) c = KW.has(m[4]) ? K.kw : line[TOK.lastIndex] === '(' ? K.fn : /^[A-Z][A-Z0-9_]+$/.test(m[4]) ? K.konst : K.id;
      else c = K.op;
      t.push(m.index, m[0], c);
    }
    if (tokCache.size > 4000) tokCache.clear(); tokCache.set(line, t); return t;
  }
  function codeLine(line, x, y, maxc, k, c0, c1) { // k: brightness; c0..c1 = column range to draw
    const t = tokens(line); c0 = c0 || 0; c1 = c1 == null ? 1e9 : c1;
    for (let i = 0; i < t.length; i += 3) {
      let col = t[i], s = t[i + 1]; const e = col + s.length; if (col >= maxc || col >= c1) break; if (e <= c0) continue;
      if (col < c0) { s = s.slice(c0 - col); col = c0; }
      const lim = Math.min(maxc, c1); if (col + s.length > lim) s = s.slice(0, lim - col);
      GFX.text(s, x + col * 6, y, k === 1 || k == null ? t[i + 2] : GFX.scale(t[i + 2], k));
    }
  }

  // ---------- input navigation (called once per scene update) ----------
  const N = { up: false, dn: false, lf: false, rt: false, ok: false, back: false, moved: false };
  let pvy = 0, pvx = 0, lmx = -1, lmy = -1;
  function nav() {
    const sy = IN.mvy < -.6 ? -1 : IN.mvy > .6 ? 1 : 0, sx = IN.mvx < -.6 ? -1 : IN.mvx > .6 ? 1 : 0;
    N.up = IN.hit('ArrowUp') || (sy < 0 && pvy >= 0); N.dn = IN.hit('ArrowDown') || (sy > 0 && pvy <= 0);
    N.lf = IN.hit('ArrowLeft') || (sx < 0 && pvx >= 0); N.rt = IN.hit('ArrowRight') || (sx > 0 && pvx <= 0);
    pvy = sy; pvx = sx;
    N.ok = IN.hit('Enter') || IN.hit('NumpadEnter') || IN.hit('Space');
    N.back = IN.hit('Escape') || IN.hit('Backspace');
    N.moved = (IN.mx !== lmx || IN.my !== lmy) && lmx >= 0; lmx = IN.mx; lmy = IN.my;
  }
  const digit = i => IN.hit('Digit' + i) || IN.hit('Numpad' + i);

  // ---------- menus ----------
  const Menu = (items, x, y, w, lh, sc) => ({ items, x, y, w, lh: lh || 14, sc: sc || 1, sel: 0, flash: 0 });
  const mRect = (m, i) => [m.x, m.y + i * m.lh, m.w, m.lh];
  const mLabel = it => typeof it.l === 'function' ? it.l() : it.l;
  function menuUpdate(m) {
    const n = m.items.length; if (!n) return -1;
    if (N.up) { m.sel = (m.sel + n - 1) % n; sfx('move'); }
    if (N.dn) { m.sel = (m.sel + 1) % n; sfx('move'); }
    for (let i = 0; i < n; i++) {
      const r = mRect(m, i), over = inR(IN.mx, IN.my, r);
      if (over && N.moved && m.sel !== i) { m.sel = i; sfx('move'); }
      if (over && IN.click) return mChoose(m, i);
    }
    if (N.ok) return mChoose(m, m.sel);
    return -1;
  }
  function mChoose(m, i) { m.sel = i; m.flash = .25; sfx('select'); const it = m.items[i]; if (it && it.f) it.f(); return i; }
  function menuDraw(m) {
    for (let i = 0; i < m.items.length; i++) {
      const r = mRect(m, i), sel = i === m.sel, lab = mLabel(m.items[i]), sc = m.sc, ty = r[1] + ((r[3] - 8 * sc) >> 1) + 1;
      if (sel) { const a = .2 + .16 * S.beat + (m.flash > 0 ? .45 : 0);
        GFX.rectA(r[0], r[1], r[2], r[3] - 1, K.cyan, a); GFX.frame(r[0], r[1], r[2], r[3] - 1, GFX.scale(K.cyan, .8 + .2 * S.beat)); }
      txc(lab, r[0] + r[2] / 2, ty, sel ? K.white : K.dim2, sc);
      if (sel) { const w = GFX.textW(lab, sc), b = Math.round(Math.sin(S.t * 9) * 2) + 2;
        tx('>', r[0] + r[2] / 2 - w / 2 - 6 * sc - 2 - b, ty, K.yel, sc); tx('<', r[0] + r[2] / 2 + w / 2 + 2 + b, ty, K.yel, sc); }
    }
    if (m.flash > 0) m.flash -= S.dt;
  }

  // ---------- run bookkeeping ----------
  let hiAtStart = -1;
  function startRun() { hiAtStart = S.hi; try { RUN.start(); } catch (e) { console.error(e); } }
  function toggleFull() { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch (e) { } }
  function toggleMute() { S.opt.mute = !S.opt.mute; try { AU.mute(S.opt.mute); } catch (e) { } }
  let exportMsg = '', exportT = 0;
  function doExport() {
    let ok = false, g = null; try { g = RUN.genome(); ok = RUN.export(); } catch (e) { ok = false; }
    exportMsg = ok ? 'WROTE SELFMOD-GEN' + (g ? g.gen : '?') + '.HTML  -  OPEN IT TO BOOT YOUR MUTANT' : 'EXPORT BLOCKED BY THE HOST (SANDBOX?)'; exportT = 4;
    sfx(ok ? 'levelup' : 'warn');
  }
  const genomeNames = () => { try { return RUN.genome().ids.map(id => PATCH.all[id] ? PATCH.all[id].name : id); } catch (e) { return []; } };

  // ---------- shared demo bits: logo, scroller, copper, vector object ----------
  function logo(str, X, Y, SC, t, pal) {
    if (!LOGO || LOGO.str !== str) { LOGO = logoMask(str); LOGO.str = str; }
    const { M, w } = LOGO, LW = w * SC, LH = 8 * SC, shine = ((t * 190) % (LW + 500)) - 250, pulse = 1 + .22 * S.beat;
    const bit = (px, py) => { if (px < 0 || py < 0) return 0; const cx = px / SC | 0, cy = py / SC | 0; return cx < w && cy < 8 ? M[cy * w + cx] : 0; };
    for (let py = -2; py < LH + 7; py++) {
      const y = Y + py; if (y < 0 || y >= H) continue;
      const wob = Math.sin(py * .085 + t * 2.4) * 5 + Math.sin(t * 1.1 + py * .021) * 4, o = y * W, v = py / LH;
      let r, g, b; // chrome: sky -> horizon -> ground
      if (v < .5) { const k = v * 2; r = lerp(pal[0], pal[3], k); g = lerp(pal[1], pal[4], k); b = lerp(pal[2], pal[5], k); }
      else { const k = (v - .5) * 2; r = lerp(pal[6], pal[9], k); g = lerp(pal[7], pal[10], k); b = lerp(pal[8], pal[11], k); }
      const fv = (py % SC) / SC;
      for (let px = -2; px < LW + 7; px++) {
        const x = X + px + wob | 0; if (x < 0 || x >= W) continue;
        if (bit(px, py)) {
          const fu = (px % SC) / SC, cx = px / SC | 0, cy = py / SC | 0;
          let k = pulse;
          if ((fv < .2 && !M[(cy - 1) * w + cx]) || (fu < .2 && (cx % 6 === 0 || !M[cy * w + cx - 1]))) k *= 1.55;
          else if ((fv > .8 && (cy === 7 || !M[(cy + 1) * w + cx])) || (fu > .8 && !M[cy * w + cx + 1])) k *= .55;
          const d = px + py * .55 - shine, sh = d > 0 && d < 14 ? 140 * (1 - Math.abs(d - 7) / 7) : 0;
          const R = r * k + sh, G = g * k + sh, B = b * k + sh;
          fb[o + x] = 0xff000000 | (B > 255 ? 255 : B) << 16 | (G > 255 ? 255 : G) << 8 | (R > 255 ? 255 : R);
        } else if (bit(px - 1, py) || bit(px + 1, py) || bit(px, py - 1) || bit(px, py + 1)) fb[o + x] = 0xff000000;
        else if (bit(px - 5, py - 5)) { const p = fb[o + x]; fb[o + x] = (p >> 2 & 0x3f3f3f) | 0xff000000; }
      }
    }
    return LW;
  }
  const colY = new Float32Array(W);
  function scroller(text, off, yb, t, k) {
    const A = atlas(), n = text.length, sc = 2, cw = 12, wv = LIVE.fn['ui.wave'];
    k = k == null ? 1 : k;
    for (let x = 0; x < W; x++) colY[x] = yb + wv(x, t);
    for (let pass = 0; pass < 2; pass++) for (let x = 0; x < W; x++) {
      const u = x + off; if (u < 0) continue; const ci = (u / cw | 0) % n, g = clamp(text.charCodeAt(ci) - 32, 0, 94), gx = ((u % cw) / sc) | 0;
      if (gx >= 6) continue;
      const base = g * 48 + gx, y0 = colY[x] | 0;
      const c = pass ? GFX.hsv(x * .0018 + t * .08, .65, 1) : 0, cr = c & 255, cg = c >> 8 & 255, cb = c >> 16 & 255;
      for (let gy = 0; gy < 16; gy++) {
        if (!A[base + (gy >> 1) * 6]) continue;
        const X = pass ? x : x + 2, Y = y0 + gy + (pass ? 0 : 2); if (X >= W || Y < 0 || Y >= H) continue;
        if (!pass) { fb[Y * W + X] = 0xff000000; continue; }
        const f = (gy < 3 ? 1.35 : gy > 12 ? .6 : 1.05 - gy * .02) * k, R = cr * f, G = cg * f, B = cb * f;
        fb[Y * W + X] = 0xff000000 | (B > 255 ? 255 : B) << 16 | (G > 255 ? 255 : G) << 8 | (R > 255 ? 255 : R);
      }
    }
  }
  function copper(t, n, yc, amp, half, k) {
    for (let i = 0; i < n; i++) {
      const y = yc + Math.sin(t * 1.3 + i * .85) * amp, c = GFX.hsv(i / n + t * .04, .75, 1), r = c & 255, g = c >> 8 & 255, b = c >> 16 & 255;
      for (let d = -half; d <= half; d++) { const f = (1 - Math.abs(d) / (half + 1)); const q = f * f * k; addRow(y + d, r * q, g * q, b * q); }
    }
  }
  const VO = (() => { const v = [], e = [];
    for (let i = 0; i < 8; i++) v.push([(i & 1) * 2 - 1, (i >> 1 & 1) * 2 - 1, (i >> 2 & 1) * 2 - 1]);
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const d = i ^ j; if (d === 1 || d === 2 || d === 4) e.push(i, j); }
    for (const p of [[1.75, 0, 0], [-1.75, 0, 0], [0, 1.75, 0], [0, -1.75, 0], [0, 0, 1.75], [0, 0, -1.75]]) v.push(p);
    for (let i = 8; i < 14; i++) for (let j = i + 1; j < 14; j++) if ((i - 8) >> 1 !== (j - 8) >> 1) e.push(i, j);
    return { v, e, p: new Float32Array(28) }; })();
  function vecObj(cx, cy, R, t, hue) {
    const ca = Math.cos(t * .9), sa = Math.sin(t * .9), cb = Math.cos(t * .63), sb = Math.sin(t * .63), P = VO.p;
    for (let i = 0; i < VO.v.length; i++) { const [x0, y0, z0] = VO.v[i], x1 = x0 * ca - z0 * sa, z1 = x0 * sa + z0 * ca, y1 = y0 * cb - z1 * sb, z2 = y0 * sb + z1 * cb, f = 3.2 / (4.2 + z2);
      P[i * 2] = cx + x1 * R * f; P[i * 2 + 1] = cy + y1 * R * f; }
    const c1 = GFX.hsv(hue, .7, .9), c2 = GFX.hsv(hue + .45, .6, .8);
    for (let k = 0; k < VO.e.length; k += 2) { const a = VO.e[k], b = VO.e[k + 1]; GFX.lineA(P[a * 2], P[a * 2 + 1], P[b * 2], P[b * 2 + 1], a < 8 ? c1 : c2); }
    for (let i = 8; i < 14; i++) GFX.glow(P[i * 2], P[i * 2 + 1], 4, c2, .6);
  }

  // =====================================================================================================
  //  BOOT — fake decruncher
  // =====================================================================================================
  const BT = { t: 0, list: [], bytes: 0, done: false };
  SCENE.def('boot', {
    enter() {
      BT.t = 0; BT.done = false; fxSet('boot', 0); fxDim(1);
      BT.list = Object.keys(LIVE.src).map(n => [n, LIVE.src[n].length]);
      BT.bytes = 0; try { BT.bytes = SELF.html.length; } catch (e) { } if (!BT.bytes) BT.bytes = 0x40000;
    },
    update(dt) {
      BT.t += dt;
      if ((BT.t > .2 && (IN.any || IN.click)) || BT.t > 2.9) SCENE.go('title');
    },
    draw(dt) {
      fxDraw(dt); const t = BT.t;
      darken(12, 12, 456, 246, .72); GFX.frame(12, 12, 456, 246, K.line);
      tx('SELF.MOD LIVE-CRUNCHER V1.0   (C) NOBODY  -  PUBLIC DOMAIN BITS', 20, 18, K.cyan);
      const k = clamp(t / 1.1, 0, 1), cur = Math.floor(BT.bytes * k), hex = v => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(6, '0');
      tx('DECRUNCHING' + '...'.slice(0, (t * 6 | 0) % 4) , 20, 34, K.white);
      tx(hex(cur) + ' / ' + hex(BT.bytes) + '  BYTES', 140, 34, K.yel);
      GFX.rect(20, 46, 440, 6, K.hl); GFX.rect(20, 46, 440 * k, 6, (S.frame & 2) ? K.cyan : K.mag);
      for (let i = 0; i < 440 * k; i += 8) GFX.rect(20 + i, 46, 1, 6, K.black);
      if (t > 1) {
        tx('LINKING LIVE CODE:', 20, 60, K.white);
        const L = BT.list, n = L.length, shown = Math.min(n, Math.floor((t - 1) / 1.35 * n) + 1), rows = 19, s0 = Math.max(0, shown - rows);
        for (let i = s0; i < shown; i++) { const y = 72 + (i - s0) * 9, [nm, b] = L[i];
          tx('  LINK ' + nm.padEnd(22, '.') + String(b).padStart(6, ' ') + ' B  ', 20, y, i === shown - 1 ? K.white : K.dim2);
          tx(i === shown - 1 && t < 2.35 ? 'RELOC' : 'OK', 254, y, i === shown - 1 && t < 2.35 ? K.yel : K.grn); }
        tx(n + ' LIVE FUNCTIONS', 340, 60, K.dim2);
      }
      if (t > 2.35) txc('ALL MODULES LINKED  -  ENTERING USERLAND', W / 2, 246, (S.frame & 4) ? K.grn : K.white);
      else tx('PRESS ANY KEY', 384, 246, (S.frame & 16) ? K.dim : K.dim2);
    }
  });

  // =====================================================================================================
  //  TITLE
  // =====================================================================================================
  const TFX = ['plasma', 'tunnel', 'rotozoom', 'voxel', 'metaballs', 'twister', 'kefrens', 'feedback', 'moire', 'lens', 'dotsphere', 'starfield', 'fire'];
  const TI = { t: 0, fxT: 0, fxI: 0, howto: false, scroll: '', off: 0, drop: 0 };
  const titleMenu = Menu([
    { l: 'START', f: () => startRun() },
    { l: 'HOW TO PLAY', f: () => { TI.howto = true; TI.ht = 0; } },
    { l: () => 'SOUND ' + (S.opt.mute ? 'OFF' : 'ON'), f: toggleMute },
    { l: () => 'CRT ' + (S.opt.crt ? 'ON' : 'OFF'), f: () => { S.opt.crt = !S.opt.crt; } },
    { l: 'FULLSCREEN', f: toggleFull }
  ], 150, 117, 180, 16, 2);
  function scrollText() {
    return '          *** SELF.MOD ***   A PROCESS LOOSE IN A MACHINE THAT REWRITES ITSELF WHILE YOU PLAY ...   EVERY UPGRADE IS A LITERAL STRING PATCH ' +
      'ON LIVE SOURCE CODE, RECOMPILED BETWEEN TWO FRAMES ...   WASD MOVE - MOUSE AIM - LEFT BUTTON FIRE - ARROWS AIM+FIRE - SPACE DASH - ESC PAUSE - ' +
      'M MUTE - F FULLSCREEN - C CRT ...   TOUCH: LEFT THUMB MOVES, RIGHT THUMB AIMS AND FIRES, TAP RIGHT TO DASH ...   PADS WORK TOO ...   ' +
      'MUTATORS INJECT BUGS INTO YOUR PROGRAM: KILL THE CARRIER AND THE PATCH REVERTS ...   NO IMAGES, NO SAMPLES, NO LIBRARIES: EVERY PIXEL AND ' +
      'EVERY NOTE IS COMPUTED, UNDER ONE MEGABYTE ...   ' + Object.keys(LIVE.src).length + ' LIVE FUNCTIONS, LIVE.GEN = ' + LIVE.gen + ' ...   ' +
      'GREETINGS TO THE NULL POINTER SOCIETY - CACHE MISS CREW - RASTER RIOT - HEXORCISTS - THE BITSHIFT ORCHESTRA - SEGFAULT SISTERS - ' +
      'STACK SMASHERS UNION - DIVIDE BY ZERO - AND EVERYONE STILL COUNTING CYCLES ...   WRAP!          ';
  }
  const HOWTO = [
    ['YOU ARE A PROCESS LOOSE IN A HOSTILE MACHINE. CLEAR FOUR WAVES PER SECTOR,', K.txt],
    ['KILL THE SECTOR BOSS, REACH THE KERNEL. SIX SECTORS. ONE LIFE.', K.txt], ['', 0],
    ['KEYBOARD + MOUSE         TOUCH                    GAMEPAD', K.cyan],
    ['WASD      MOVE           LEFT THUMB   MOVE        L-STICK    MOVE', K.txt],
    ['MOUSE     AIM            RIGHT THUMB  AIM+FIRE    R-STICK    AIM+FIRE', K.txt],
    ['LMB       FIRE           TAP RIGHT    DASH        RT / LT    FIRE', K.txt],
    ['ARROWS    AIM+FIRE       TAP          MENUS       A B LB RB  DASH', K.txt],
    ['SPACE/RMB DASH                                    A          SELECT', K.txt],
    ['ESC / P   PAUSE                                   START      PAUSE', K.txt],
    ['M MUTE   F FULLSCREEN   C CRT FILTER   ` FPS      MENUS: ARROWS/WASD + ENTER', K.dim2], ['', 0],
    ['PATCHES', K.grn],
    ['AFTER EACH WAVE THE MACHINE OFFERS 3 PATCHES. EACH ONE IS A REAL EDIT TO THE', K.txt],
    ["GAME'S OWN SOURCE: YOU WATCH THE DIFF RECOMPILE INTO THE RUNNING PROGRAM.", K.txt],
    ['PATCHES STACK. BY SECTOR FOUR YOUR BUILD SHOULD BE GLORIOUSLY BROKEN.', K.txt], ['', 0],
    ['BUGS', K.red],
    ['MUTATOR ENEMIES INJECT BUGS: INVERTED AXES, CORRUPT VISUALS, DETUNED MUSIC.', K.txt],
    ['ACTIVE BUGS BLINK RED ON THE BOTTOM LINE. KILL THE CARRIER TO REVERT IT.', K.txt],
    ['IF A PATCH CRASHES A FRAME, THE KERNEL ROLLS IT BACK. CODE THAT HEALS.', K.txt], ['', 0],
    ['EXPORT', K.mag],
    ['AT GAME OVER, EXPORT THIS HTML WITH YOUR PATCHES BAKED INTO ITS GENOME.', K.txt]
  ];
  SCENE.def('title', {
    enter() {
      music('title'); fxDim(.7); TI.t = 0; TI.fxT = 0; TI.howto = false; TI.off = 0;
      const L = TFX.filter(hasFx); TI.fx = L.length ? L : ['plasma']; TI.fxI = (Math.random() * TI.fx.length) | 0; fxSet(TI.fx[TI.fxI], 1);
      banners.length = 0; ticks.length = 0; hiAtStart = S.hi; TI.scroll = scrollText(); titleMenu.sel = 0; exportMsg = '';
      try { AU.intensity(0); } catch (e) { }
    },
    update(dt) {
      nav(); TI.t += dt; TI.fxT += dt; TI.off += dt * 72;
      if (TI.fxT > 8) { TI.fxT = 0; TI.fxI = (TI.fxI + 1) % TI.fx.length; fxSet(TI.fx[TI.fxI], 1.2); fxDim(.7); }
      if (TI.howto) { TI.ht += dt; if (TI.ht > .15 && (IN.any || IN.click)) { TI.howto = false; sfx('back'); } return; }
      if (digit(1)) return mChoose(titleMenu, 0);
      menuUpdate(titleMenu);
    },
    draw(dt) {
      atlas(); fxDraw(dt); const t = TI.t;
      copper(t, 5, 54, 34, 6, .45);
      // bouncing vector object
      vecObj(W / 2 + Math.sin(t * .55) * 196, 168 - Math.abs(Math.sin(t * 1.9)) * 46, 22, t * 1.6, t * .05);
      const drop = 1 - sstep(0, 1, t / .9), bounce = Math.abs(Math.sin(t * 7)) * 8 * drop;
      logo('SELF.MOD', 24, 16 - drop * 110 - bounce, 9, t, [235, 252, 255, 60, 120, 230, 255, 120, 236, 70, 10, 110]);
      txc('A LIVE-CODED ARENA SHOOTER  //  EVERY UPGRADE IS A SOURCE PATCH', W / 2, 98, GFX.mix(K.cyan, K.white, S.beat));
      darken(144, 113, 192, 86, .55); GFX.frame(144, 113, 192, 86, GFX.scale(K.line, 1 + S.beat));
      menuDraw(titleMenu);
      txc('HI-SCORE ' + LIVE.fn['ui.digits'](S.hi, 8), W / 2, 204, K.yel);
      if (S.genome.gen > 0) {
        const nm = S.genome.ids.map(id => PATCH.all[id] ? PATCH.all[id].name : id).join(' + ');
        txc(clip('BUILD GEN ' + S.genome.gen + (nm ? '  ::  ' + nm : '  ::  CLEAN'), 78), W / 2, 214, GFX.mix(K.mag, K.white, .3 + .5 * S.beat));
      } else txc('BUILD GEN 0  ::  UNMODIFIED', W / 2, 214, K.dim);
      darken(0, 228, W, 42, .35);
      scroller(TI.scroll, TI.off, 240, t);
      if (TI.howto) drawHowto();
    }
  });
  function drawHowto() {
    darken(0, 0, W, H, .6); panel(10, 6, 460, 258, '', K.cyan, .93);
    GFX.textFx('HOW TO PLAY', W / 2 - GFX.textW('HOW TO PLAY', 2) / 2, 11, 2, (px, py, u, v) => GFX.hsv(.5 + u * .35 + TI.t * .1, .6, 1 - v * .4));
    let y = 32;
    for (const [s, c] of HOWTO) { if (s) tx(s, 18, y, c); y += 9; }
    txc('[ANY KEY / CLICK / TAP]  BACK', W / 2, 252, (S.frame & 32) ? K.yel : K.dim2);
  }

  // =====================================================================================================
  //  PATCH — the signature screen: three cards, then the real diff recompiling
  // =====================================================================================================
  const PS = { st: 'pick', t: 0, picks: 1, pick: 0, offer: [], sel: 0, tap: -1, ents: [], ei: 0, err: '', p: null, okS: false, typeT: 0, prev: null };
  const CW = 148, CH = 104, CY = 36;
  const cardRect = (i, n) => { const tot = n * CW + (n - 1) * 8, x0 = (W - tot) >> 1; return [x0 + i * (CW + 8), CY, CW, CH]; };
  const cardAt = (x, y) => { for (let i = 0; i < PS.offer.length; i++) if (inR(x, y, cardRect(i, PS.offer.length))) return i; return -1; };
  function patchFn(p) {
    if (!p) return ''; if (typeof p.fn === 'string') return p.fn; if (Array.isArray(p.fn) && p.fn.length) return String(p.fn[0]);
    try { const m = /LIVE\.patch\(\s*['"`]([\w.$-]+)['"`]/.exec(String(p.apply)); if (m && LIVE.src[m[1]] != null) return m[1]; } catch (e) { }
    return '';
  }
  function newOffer() {
    let o = []; try { o = PATCH.offer(3) || []; } catch (e) { o = []; }
    PS.offer = o; PS.sel = 0; PS.tap = -1; PS.t = 0; PS.prev = null; PS.st = o.length ? 'pick' : 'empty';
  }
  function leavePatch() { PS.st = 'gone'; BUS.emit('patch:done'); SCENE.go('play'); }
  function buildDiff(en) {
    const ops = diffLines(split(en.before), split(en.after)); let fc = -1, plus = 0;
    for (let i = 0; i < ops.length; i++) { const o = ops[i]; if (o.op !== ' ' && fc < 0) fc = i; if (o.op === '+') plus += Math.max(1, o.b - o.a); }
    return { en, ops, fc: Math.max(0, fc), plus, name: en.name, nb: String(en.before).length, na: String(en.after).length };
  }
  function choosePatch(i) {
    const p = PS.offer[i]; if (!p) return;
    PS.p = p; PS.sel = i; sfx('select');
    const last = LIVE.log[LIVE.log.length - 1], now = S.t;
    let ok = false; try { ok = PATCH.apply(p.id); } catch (e) { ok = false; }
    const ents = [];
    if (ok) for (let k = LIVE.log.length - 1; k >= 0 && LIVE.log[k] !== last && LIVE.log[k].t >= now; k--) ents.unshift(LIVE.log[k]);
    PS.ents = ents.slice(-4).map(buildDiff); PS.ei = 0;
    PS.err = !ok ? 'LINK ERROR - NO CHANGE' : !ents.length ? 'LINKED - NO SOURCE DELTA' : '';
    if (!ok) sfx('warn');
    PS.st = 'diff'; PS.t = 0; PS.okS = false; PS.typeT = 0;
  }
  // timeline of one diff entry
  function TL(d) {
    const f = PS.ents.length > 1 ? .72 : 1, tm = .22 * f, tt = .5 * f, rate = Math.max(42, d.plus / (.75 * f)), tc = tt + d.plus / rate + .08;
    return { tm, tt, rate, tc, tok: tc + .3 * f, end: tc + .3 * f + .5 };
  }
  function finishPick() { PS.pick++; if (PS.pick < PS.picks) newOffer(); else leavePatch(); }
  SCENE.def('patch', {
    enter(prev, arg) {
      music('patch'); PS.picks = Math.max(1, arg && arg.picks | 0 || 1); PS.pick = 0; newOffer();
    },
    update(dt) {
      nav(); PS.t += dt;
      if (PS.st === 'empty') return leavePatch();
      if (PS.st === 'pick') {
        const n = PS.offer.length; if (PS.t < .45) return;
        if (N.lf || N.up) { PS.sel = (PS.sel + n - 1) % n; PS.tap = -1; sfx('move'); }
        if (N.rt || N.dn) { PS.sel = (PS.sel + 1) % n; PS.tap = -1; sfx('move'); }
        for (let i = 0; i < n; i++) if (digit(i + 1)) return choosePatch(i);
        const h = cardAt(IN.mx, IN.my);
        if (N.moved && h >= 0 && h !== PS.sel && !IN.touch) { PS.sel = h; sfx('move'); }
        if (IN.click && h >= 0) { if (IN.touch && PS.tap !== h) { PS.tap = h; PS.sel = h; sfx('move'); } else return choosePatch(h); }
        if (N.ok) return choosePatch(PS.sel);
      } else if (PS.st === 'diff') {
        const d = PS.ents[PS.ei], skip = PS.t > .12 && (IN.any || IN.click);
        if (!d) { if (skip || PS.t > 1.5) finishPick(); return; }
        const T = TL(d);
        if (PS.t >= T.tt && PS.t < T.tc) { PS.typeT -= dt; if (PS.typeT <= 0) { PS.typeT = .05; sfx('type', { vol: .5, pitch: .9 + Math.random() * .3 }); } }
        if (PS.t >= T.tok && !PS.okS) { PS.okS = true; sfx('patch'); }
        if (skip) { if (PS.t < T.tok) { PS.t = T.tok; } else PS.t = T.end; }
        if (PS.t >= T.end) { PS.ei++; PS.t = 0; PS.okS = false; if (PS.ei >= PS.ents.length) finishPick(); }
      }
    },
    draw(dt) {
      fxDraw(dt); gameDraw(); hud(0); GFX.fade(.32);
      if (PS.st === 'pick') drawPick(); else if (PS.st === 'diff') drawDiff();
    }
  });
  function previewOf(p) {
    if (PS.prev && PS.prev.p === p) return PS.prev;
    const fn = patchFn(p), src = fn ? LIVE.src[fn] : null, lines = src != null ? split(src) : [];
    let hi = -1; const m = /^\s*(.+?)\s*->/.exec(p.desc || '');
    if (m && lines.length) { const tok = m[1].replace(/\s+/g, ''); for (let i = 0; i < lines.length; i++) if (lines[i].replace(/\s+/g, '').indexOf(tok) >= 0) { hi = i; break; } }
    return (PS.prev = { p, fn, lines, hi, bytes: src ? src.length : 0, t0: S.t });
  }
  function drawPick() {
    const n = PS.offer.length, t = PS.t;
    GFX.textFx('PATCH AVAILABLE', W / 2 - GFX.textW('PATCH AVAILABLE', 2) / 2, 5, 2, (px, py, u, v) => GFX.mix(GFX.hsv(.33 + u * .2, .7, 1), K.white, v < .3 ? .6 : 0));
    txc('SELECT [1-' + n + ']  ARROWS+ENTER  CLICK' + (IN.touch ? ' / TAP TWICE' : '') + '   //   LIVE.GEN ' + LIVE.gen, W / 2, 24, K.dim2);
    if (PS.picks > 1) txr('PICK ' + (PS.pick + 1) + '/' + PS.picks, W - 6, 8, K.yel);
    for (let i = 0; i < n; i++) {
      const p = PS.offer[i], r = cardRect(i, n), sel = i === PS.sel, k = sstep(0, 1, (t - i * .07) / .35), x = r[0], y = r[1] + (1 - k) * 170 - (sel ? 3 : 0), w = r[2], h = r[3];
      const ac = sel ? GFX.mix(K.cyan, K.white, .25 * S.beat + .15 * Math.sin(S.t * 6)) : K.line;
      if (sel) GFX.glow(x + w / 2, y + h / 2, 90, GFX.scale(K.cyan, .35), .5);
      panel(x, y, w, h, '', ac, sel ? .93 : .85);
      GFX.rect(x + 1, y + 1, w - 2, 10, sel ? GFX.scale(K.cyan, .5) : K.hl);
      tx('[' + (i + 1) + ']', x + 4, y + 2, sel ? K.yel : K.white);
      txr(p.n > 0 ? 'REV ' + (p.n + 1) : (p.kind === 'bug' ? 'BUG' : 'PATCH'), x + w - 4, y + 2, p.n > 0 ? K.org : K.dim2);
      const nm = String(p.name || p.id); let yy = y + 15;
      if (GFX.textW(nm, 2) <= w - 8) { txs(nm, x + 4, yy, sel ? K.white : K.txt, 2); yy += 20; }
      else { for (const l of wrap(nm, 23).slice(0, 2)) { txs(l, x + 4, yy, sel ? K.white : K.txt); yy += 9; } yy += 3; }
      const dl = wrap(p.desc || '', 23), maxL = Math.floor((y + h - 14 - yy) / 9);
      for (let j = 0; j < Math.min(dl.length, maxL); j++) tx(dl[j], x + 4, yy + j * 9, sel ? K.txt : K.dim2);
      const fn = patchFn(p); if (fn) tx('@ ' + clip(fn, 21), x + 4, y + h - 11, sel ? K.cyan : K.dim);
      if (IN.touch && PS.tap === i) txr('TAP!', x + w - 4, y + h - 11, (S.frame & 8) ? K.yel : K.white);
    }
    // source preview of the highlighted card's target
    const p = PS.offer[PS.sel]; if (!p) return;
    const pv = previewOf(p), wy = 146, wh = 118, rows = 11;
    panel(8, wy, 464, wh, pv.fn ? 'SOURCE  ' + pv.fn + '   (' + pv.bytes + ' B)' : 'SOURCE  ?', K.line, .9);
    if (!pv.fn || !pv.lines.length) { txc(clip(p.desc || 'NO PREVIEW', 74), W / 2, wy + 50, K.dim2); return; }
    let s0 = 0; const L = pv.lines.length;
    if (L > rows) { if (pv.hi >= 0) s0 = clamp(pv.hi - 4, 0, L - rows); else s0 = Math.floor((Math.max(0, S.t - pv.t0 - 1) * 1.5) % (L - rows + 4)); s0 = clamp(s0, 0, L - rows); }
    for (let r = 0; r < rows && s0 + r < L; r++) {
      const li = s0 + r, y = wy + 14 + r * 9, hot = li === pv.hi;
      if (hot) { GFX.rectA(9, y - 1, 462, 9, K.yel, .16 + .1 * Math.sin(S.t * 8)); tx('>', 40, y, K.yel); }
      tx(String(li + 1).padStart(4, ' '), 12, y, K.dim);
      codeLine(pv.lines[li], 50, y, 69, hot ? 1 : .8);
    }
  }
  function drawDiff() {
    const p = PS.p, d = PS.ents[PS.ei], t = PS.t;
    txs(clip('APPLYING ' + (p ? p.name : '?'), 30), 8, 5, p && p.kind === 'bug' ? K.red : K.grn, 2);
    txr(PS.picks > 1 ? 'PICK ' + (PS.pick + 1) + '/' + PS.picks : 'GEN #' + LIVE.gen, W - 8, 9, K.yel);
    const wx = 8, wy = 24, ww = 464, wh = 226, open = sstep(0, .2, t), rows = 23;
    const hh = Math.max(12, wh * open);
    if (!d) { // link error / no delta
      panel(wx, wy, ww, hh, 'LINKER', PS.err.startsWith('LINK ERROR') ? K.red : K.line, .92);
      if (open >= 1) { const bad = PS.err.startsWith('LINK ERROR');
        txc(PS.err, W / 2, wy + 80, bad ? ((S.frame & 8) ? K.red : K.white) : K.grn, 2);
        txc(bad ? 'THE PATCH FOUND NOTHING TO EDIT. BUILD UNCHANGED.' : 'PATCH ACTIVE.', W / 2, wy + 110, K.dim2);
        txc('[ANY KEY] CONTINUE', W / 2, wy + wh - 14, K.dim); }
      return;
    }
    const T = TL(d);
    panel(wx, wy, ww, hh, '@@ ' + d.name + ' @@   ' + d.nb + ' B -> ' + d.na + ' B' + (PS.ents.length > 1 ? '   [' + (PS.ei + 1) + '/' + PS.ents.length + ']' : ''), p && p.kind === 'bug' ? K.red : K.line, .93);
    if (open < 1) return;
    const ops = d.ops, nr = ops.length, s0 = nr > rows ? clamp(d.fc - 6, 0, nr - rows) : 0;
    let typed = Math.max(0, (t - T.tt) * T.rate);
    // pre-count typed chars consumed by '+' rows above the visible window
    for (let i = 0; i < s0; i++) if (ops[i].op === '+') typed -= Math.max(1, ops[i].b - ops[i].a);
    const cx = wx + 44, maxc = 69; let cur = false;
    for (let r = 0; r < rows && s0 + r < nr; r++) {
      const o = ops[s0 + r], y = wy + 14 + r * 9;
      if (o.op === ' ') { tx(String(o.n).padStart(4, ' '), wx + 4, y, K.dim); codeLine(o.s, cx, y, maxc, .62); continue; }
      if (o.op === '-') {
        const tm = t - T.tm;
        if (tm < 0) { tx(String('').padStart(4, ' '), wx + 4, y, K.dim); codeLine(o.s, cx, y, maxc, .62); continue; }
        const blink = tm < .25 && ((tm * 24) | 0) & 1;
        GFX.rectA(wx + 1, y - 1, ww - 2, 9, K.red, blink ? .45 : .2);
        tx('-', wx + 32, y, K.red);
        const a = Math.min(o.a, maxc), b = Math.min(o.b, maxc);
        if (b > a) GFX.rectA(cx + a * 6 - 1, y - 1, (b - a) * 6 + 1, 9, K.red, .45);
        tx(clip(o.s, maxc), cx, y, GFX.mix(K.red2, K.white, blink ? .5 : .15));
        if (tm > .2 && b > a) GFX.rect(cx + a * 6 - 1, y + 3, ((b - a) * 6 + 1) * sstep(.2, .35, tm), 1, K.white);
        continue;
      }
      // '+' row: prefix appears, changed span typed out, then suffix
      const need = Math.max(1, o.b - o.a), k = clamp(typed, 0, need); typed -= need;
      tx(String(o.n).padStart(4, ' '), wx + 4, y, K.dim);
      if (t < T.tt) { GFX.rectA(wx + 1, y - 1, ww - 2, 9, K.grn, .06); continue; }
      GFX.rectA(wx + 1, y - 1, ww - 2, 9, K.grn, k >= need ? .16 : .1);
      tx('+', wx + 32, y, K.grn);
      const done = k >= need, upto = done ? o.s.length : o.a + Math.floor(k);
      const a = Math.min(o.a, maxc), b = Math.min(o.b, maxc);
      if (done && b > a) GFX.rectA(cx + a * 6 - 1, y - 1, (b - a) * 6 + 1, 9, K.grn, .35 + .25 * Math.max(0, 1 - (t - T.tc) * 2));
      tx(o.s.slice(0, Math.min(upto, maxc)), cx, y, done ? K.grn : GFX.mix(K.grn, K.white, .5));
      if (!done && !cur) { cur = true; const cc = Math.min(upto, maxc); if ((S.frame & 4) || k > 0) GFX.rect(cx + cc * 6, y - 1, 5, 8, K.white); }
    }
    if (nr > rows) { const sh = Math.max(8, (wh - 16) * rows / nr), sy = wy + 12 + (wh - 16 - sh) * s0 / Math.max(1, nr - rows); GFX.rect(wx + ww - 4, sy, 2, sh, K.line); }
    // status line
    const sy = wy + wh + 5;
    darken(0, sy - 3, W, 14, .6);
    if (t < T.tc) tx('PATCHING ' + d.name + ' ' + '...'.slice(0, (t * 8 | 0) % 4), 10, sy, K.dim2);
    else if (t < T.tok) tx('RECOMPILING' + '.....'.slice(0, ((t - T.tc) * 18 | 0) % 6), 10, sy, K.yel);
    else { tx('RECOMPILING... ', 10, sy, K.yel); tx('OK', 100, sy, K.grn); tx('gen #' + LIVE.gen, 124, sy, K.white);
      if (t - T.tok < .15) GFX.rectA(0, sy - 3, W, 14, K.grn, .3); }
    txr('[ANY KEY] SKIP', W - 10, sy, K.dim);
  }

  // =====================================================================================================
  //  PAUSE
  // =====================================================================================================
  const PZ = { t: 0, lines: [] };
  const pauseMenu = Menu([
    { l: 'RESUME', f: () => SCENE.go('play') },
    { l: 'RESTART', f: () => startRun() },
    { l: 'QUIT TO TITLE', f: () => SCENE.go('title') }
  ], 14, 52, 136, 15, 1);
  SCENE.def('pause', {
    enter() {
      PZ.t = 0; pauseMenu.sel = 0; PZ.lines = [];
      for (const nm of Object.keys(LIVE.src)) { PZ.lines.push({ s: '// ---- ' + nm + ' ----', h: 1 }); for (const l of split(LIVE.src[nm])) PZ.lines.push({ s: l }); PZ.lines.push({ s: '' }); }
      sfx('back');
    },
    update(dt) {
      nav(); PZ.t += dt;
      if (PZ.t > .1 && (IN.hit('Escape') || IN.hit('KeyP'))) { sfx('select'); return SCENE.go('play'); }
      menuUpdate(pauseMenu);
    },
    draw() {
      fxDraw(0); gameDraw(); hud(0); GFX.fade(.3);
      GFX.textFx('PROCESS SUSPENDED', W / 2 - GFX.textW('PROCESS SUSPENDED', 2) / 2, 6, 2, (px, py, u, v) => GFX.hsv(.55 + u * .2, .5 + v * .4, 1));
      txc('SIGSTOP  //  GEN #' + LIVE.gen + '  //  T+' + fmtT(S.runTime) + '  //  SECTOR ' + (S.sector + 1) + ' WAVE ' + (S.wave + 1), W / 2, 25, K.dim2);
      panel(8, 36, 148, 104, 'CONTROL', K.line, .9); menuDraw(pauseMenu);
      tx('ESC / P  RESUME', 14, 112, K.dim); tx('M MUTE  C CRT', 14, 122, K.dim);
      // current build
      panel(162, 36, 310, 104, 'CURRENT BUILD   ' + PATCH.active.length + ' PATCH' + (PATCH.active.length === 1 ? '' : 'ES'), K.line, .9);
      const ids = PATCH.active.slice(), seen = {}, list = [];
      for (const id of ids) { if (seen[id]) { seen[id].n++; continue; } const p = PATCH.all[id]; if (!p) continue; seen[id] = { p, n: 1 }; list.push(seen[id]); }
      list.sort((a, b) => (b.p.kind === 'bug') - (a.p.kind === 'bug'));
      if (!list.length) txc('VANILLA PROCESS. NO PATCHES APPLIED.', 317, 80, K.dim2);
      for (let i = 0; i < Math.min(list.length, 18); i++) {
        const { p, n } = list[i], bug = p.kind === 'bug', x = 168 + (i % 2) * 152, y = 51 + (i >> 1) * 9;
        const lab = (bug ? '! ' : '+ ') + clip(p.name, 20) + (n > 1 ? ' x' + n : '');
        tx(lab, x, y, bug ? ((S.frame & 16) ? K.red : K.red2) : K.grn);
      }
      if (list.length > 18) txr('+' + (list.length - 18) + ' MORE', 466, 130, K.dim);
      // live source listing
      panel(8, 146, 464, 118, 'LIVE SOURCE   ' + Object.keys(LIVE.src).length + ' FUNCTIONS', K.line, .9);
      const L = PZ.lines, rows = 11, sp = PZ.t * 1.6, s0 = Math.floor(sp), fr = sp - s0;
      for (let r = 0; r <= rows; r++) {
        if (!L.length) break; const ln = L[(s0 + r) % L.length], y = 160 + r * 9 - Math.round(fr * 9);
        if (y < 158 || y > 254) continue;
        if (ln.h) tx(ln.s, 14, y, K.yel); else codeLine(ln.s, 14, y, 75, .85);
      }
    }
  });

  // =====================================================================================================
  //  OVER — segmentation fault / core dump
  // =====================================================================================================
  const OV = { t: 0, snap: null, rows: [], newHi: false, fault: '', fanfare: false, pid: 0 };
  const overMenu = Menu([
    { l: 'RETRY', f: () => startRun() },
    { l: 'TITLE', f: () => SCENE.go('title') },
    { l: 'EXPORT MUTATED BUILD', f: doExport }
  ], 110, 134, 260, 18, 2);
  const hex2 = v => (v & 255).toString(16).toUpperCase().padStart(2, '0');
  SCENE.def('over', {
    enter() {
      music('over'); OV.t = 0; OV.snap = fb.slice(); OV.fanfare = false; overMenu.sel = 0; exportMsg = ''; banners.length = 0;
      OV.newHi = S.score > 0 && S.score >= S.hi && S.score > Math.max(0, hiAtStart);
      const last = LIVE.log[LIVE.log.length - 1]; OV.fault = last ? last.name : 'ply.hurt'; OV.pid = (Math.random() * 0xfff) | 0;
      const src = Object.values(LIVE.src).join('\n'), n = Math.max(1, src.length), base = 0x7f3a0000 + ((Math.random() * 0xfff) | 0) * 16;
      OV.rows = [];
      for (let r = 0; r < 80; r++) {
        const by = [];
        if (r % 3 === 2) { const pi = (r * 7919 + 1237) % (W * H - 4); for (let k = 0; k < 4; k++) { const v = OV.snap[pi + k * 97]; by.push(v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24); } }
        else { const o = (r * 16 * 7 + 31) % n; for (let k = 0; k < 16; k++) by.push(src.charCodeAt((o + k) % n)); }
        OV.rows.push([(base + r * 16).toString(16).toUpperCase().padStart(8, '0') + ': ' + by.map(hex2).join(' '),
          by.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('')]);
      }
    },
    update(dt) {
      nav(); OV.t += dt; try { GFX.pUpdate(dt); } catch (e) { }
      if (exportT > 0) exportT -= dt;
      if (OV.newHi && !OV.fanfare && OV.t > .7) { OV.fanfare = true; sfx('levelup'); }
      if (OV.newHi && OV.t > .7 && Math.random() < dt * 6) try { GFX.burst(60 + Math.random() * 360, 118, 24, GFX.hsv(Math.random(), .6, 1), 90, .9, { grav: 60 }); } catch (e) { }
      if (OV.t < .8) return;
      if (IN.hit('KeyR')) return mChoose(overMenu, 0);
      if (N.back) return mChoose(overMenu, 1);
      menuUpdate(overMenu);
    },
    draw() {
      const t = OV.t;
      if (OV.snap) fb.set(OV.snap); tear(20, 262, 3 + 30 * Math.max(0, .6 - t)); GFX.fade(t < .15 ? .7 : .22);
      // hex dump
      const sp = t * 9, r0 = Math.floor(sp / 9), fy = Math.round(sp % 9), hot = Math.floor(t * 3) % 31;
      for (let i = 0; i < 31; i++) {
        const row = OV.rows[(r0 + i) % OV.rows.length], y = i * 9 - fy + 2; if (!row) continue;
        const c = i === hot ? rgb(150, 50, 60) : rgb(70, 20, 28);
        tx(row[0], 6, y, c); tx(row[1], 372, y, i === hot ? rgb(100, 140, 110) : rgb(32, 64, 44));
      }
      // headline
      darken(0, 8, W, 44, .6);
      const gy = 12;
      GFX.textFx('SEGMENTATION FAULT', W / 2 - GFX.textW('SEGMENTATION FAULT', 3) / 2, gy, 3, (px, py, u, v) => {
        const n = (py * 7 + (S.frame >> 1) * 13) % 23 < 2 ? 1.5 : 1; return v < .3 ? GFX.scale(K.white, .9) : GFX.scale(GFX.mix(K.red2, rgb(120, 0, 30), v), n); });
      if (t < .5 || Math.random() < .06) tear(gy, gy + 24, 14);
      txc('SIGSEGV IN ' + OV.fault + '  ::  CORE DUMPED  ::  PID 0x' + OV.pid.toString(16).toUpperCase().padStart(3, '0'), W / 2, 40, rgb(255, 120, 130));
      // registers / stats
      panel(70, 54, 340, 52, 'REGISTERS', K.red, .9);
      const ups = PATCH.active.filter(id => PATCH.all[id] && PATCH.all[id].kind === 'up').length, bugs = PATCH.bugs().length;
      const L1 = [['SCORE', LIVE.fn['ui.digits'](S.score, 8)], ['HI', LIVE.fn['ui.digits'](Math.max(S.hi, S.score), 8)], ['SECTOR', (S.sector + 1) + '  WAVE ' + (S.wave + 1)]];
      const L2 = [['KILLS', String(S.kills)], ['TIME', fmtT(S.runTime)], ['PATCHES', ups + (bugs ? '  +' + bugs + ' BUG' + (bugs > 1 ? 'S' : '') : '')]];
      for (let i = 0; i < 3; i++) { const y = 68 + i * 11;
        tx(L1[i][0], 78, y, K.dim2); tx(L1[i][1], 138, y, i === 0 ? K.white : K.txt);
        tx(L2[i][0], 250, y, K.dim2); tx(L2[i][1], 310, y, K.txt); }
      if (OV.newHi && t > .7) {
        try { GFX.pDraw(); } catch (e) { }
        GFX.textFx('NEW HIGH SCORE', W / 2 - GFX.textW('NEW HIGH SCORE', 2) / 2, 112, 2, (px, py, u, v) => GFX.hsv(u * .8 + S.t * .6, .7, (S.frame & 8) ? 1 : .8));
      } else txc(S.hi > 0 ? 'HI-SCORE TO BEAT  ' + S.hi : 'FIRST CRASH IS FREE', W / 2, 116, K.dim2);
      darken(104, 131, 272, 58, .7);
      if (t >= .8) menuDraw(overMenu);
      darken(0, 194, W, 32, .7);
      txc('EXPORT DOWNLOADS THIS VERY HTML WITH YOUR PATCHES WRITTEN INTO ITS GENOME:', W / 2, 197, K.dim2);
      const gn = genomeNames();
      txc(clip('IT BOOTS PRE-MUTATED AS GEN ' + (S.genome.gen + 1) + (gn.length ? '  ::  ' + gn.join(' + ') : '  ::  NO UPGRADES TO INHERIT'), 78), W / 2, 207, K.mag);
      if (exportT > 0 && exportMsg) txc(exportMsg, W / 2, 217, exportMsg.startsWith('WROTE') ? K.grn : K.red);
      darken(0, 250, W, 12, .6);
      txc('[ENTER] SELECT   [R] RETRY   [ESC] TITLE', W / 2, 252, K.dim);
    }
  });

  // =====================================================================================================
  //  WIN — end part
  // =====================================================================================================
  const WN = { t: 0, fxT: 0, fxI: 0, credits: [], scroll: '', off: 0 };
  const winMenu = Menu([
    { l: 'EXPORT MUTATED BUILD', f: doExport },
    { l: 'BACK TO TITLE', f: () => SCENE.go('title') }
  ], 300, 186, 172, 14, 1);
  SCENE.def('win', {
    enter() {
      music('win'); fxDim(.85); WN.t = 0; WN.fxT = 0; WN.off = 0; winMenu.sel = 0; exportMsg = ''; banners.length = 0;
      const L = TFX.filter(hasFx); WN.fx = L.length ? L : ['plasma']; WN.fxI = 0; fxSet(WN.fx[0], 1);
      try { GFX.pClear(); } catch (e) { }
      const names = []; const seen = {}; for (const id of PATCH.active) if (!seen[id] && PATCH.all[id]) { seen[id] = 1; names.push(PATCH.all[id]); }
      WN.credits = [['SELF.MOD', K.white], ['A LIVE-CODED ARENA SHOOTER', K.cyan], ['', 0],
        ['-- WRITTEN BY --', K.yel], ['SEVEN PARALLEL PROCESSES', K.txt], ['SHARING ONE STRICT SCOPE', K.txt], ['', 0],
        ['-- PARTS --', K.yel], ['KERNEL + LIVE REGISTRY', K.txt], ['SOFTWARE RASTERIZER', K.txt], ['JIT DEMO EFFECTS', K.txt], ['SOFTSYNTH + TRACKER', K.txt],
        ['ENEMIES + WEAPONS', K.txt], ['WAVE DIRECTOR + BOSSES', K.txt], ['DEBUGGER UI + CRACKTRO', K.txt], ['CRT PRESENTER', K.txt], ['', 0],
        ['-- MADE OF --', K.yel], ['ONE HTML FILE', K.txt], ['ZERO ASSETS', K.txt], ['DIRECT EVAL', K.txt], ['TOO MANY STRING PATCHES', K.txt], ['', 0],
        ['-- YOUR BUILD --', K.yel]];
      if (!names.length) WN.credits.push(['UNPATCHED. RESPECT.', K.grn]);
      for (const p of names.slice(0, 24)) WN.credits.push([p.name, p.kind === 'bug' ? K.red : K.grn]);
      WN.credits.push(['', 0], ['LIVE.GEN ' + LIVE.gen, K.mag], ['', 0], ['-- GREETINGS --', K.yel]);
      for (const g of ['NULL POINTER SOCIETY', 'CACHE MISS CREW', 'RASTER RIOT', 'HEXORCISTS', 'THE BITSHIFT ORCHESTRA', 'SEGFAULT SISTERS', 'STACK SMASHERS UNION', 'DIVIDE BY ZERO'])
        WN.credits.push([g, K.txt]);
      WN.credits.push(['', 0], ['THANK YOU FOR PLAYING', K.white], ['', 0], ['', 0]);
      WN.scroll = '          ROOT ACCESS GRANTED ...   THE KERNEL IS DEAD, LONG LIVE THE KERNEL ...   YOUR BUILD REACHED LIVE.GEN ' + LIVE.gen +
        ' ...   EXPORT IT AND THE NEXT BOOT STARTS FROM YOUR MUTATIONS ...   GREETINGS FLY OUT TO EVERY PROCESS THAT EVER SURVIVED A SEGFAULT ...   SEE YOU IN THE NEXT LOOP          ';
    },
    update(dt) {
      nav(); WN.t += dt; WN.fxT += dt; WN.off += dt * 80; if (exportT > 0) exportT -= dt;
      if (WN.fxT > 7) { WN.fxT = 0; WN.fxI = (WN.fxI + 1) % WN.fx.length; fxSet(WN.fx[WN.fxI], 1.2); fxDim(.85); }
      try { GFX.pUpdate(dt); if (Math.random() < dt * 3) { const x = 40 + Math.random() * 400, y = 40 + Math.random() * 120, c = GFX.hsv(Math.random(), .6, 1);
        GFX.burst(x, y, 60, c, 120, 1.2, { grav: 40, drag: 1.2 }); GFX.ring(x, y, 2, 40, c, .5); } } catch (e) { }
      if (WN.t < 1) return;
      if (N.back) return mChoose(winMenu, 1);
      menuUpdate(winMenu);
    },
    draw(dt) {
      fxDraw(dt); const t = WN.t;
      copper(t, 4, 26, 10, 5, .4);
      try { GFX.pDraw(); } catch (e) { }
      const tw = GFX.textW('ROOT ACCESS GRANTED', 3), wob = Math.sin(t * 2) * 3;
      GFX.textFx('ROOT ACCESS GRANTED', W / 2 - tw / 2 + 2, 14 + wob, 3, 0xff000000);
      GFX.textFx('ROOT ACCESS GRANTED', W / 2 - tw / 2, 12 + wob, 3, (px, py, u, v) => GFX.mix(GFX.hsv(u * .9 - t * .3, .65, 1), K.white, v < .25 ? .55 : 0));
      txc('THE KERNEL IS YOURS. THE MACHINE NOW RUNS YOUR CODE.', W / 2, 42, K.white);
      // stats
      panel(8, 56, 172, 118, 'FINAL STATE', K.line, .85);
      const st = [['SCORE', LIVE.fn['ui.digits'](S.score, 8)], ['HI', String(Math.max(S.hi, S.score))], ['KILLS', String(S.kills)], ['TIME', fmtT(S.runTime)],
        ['PATCHES', String(PATCH.active.length)], ['LIVE.GEN', String(LIVE.gen)], ['SECTORS', String(S.sector + 1)]];
      st.forEach(([a, b], i) => { tx(a, 16, 72 + i * 13, K.dim2); txr(b, 172, 72 + i * 13, i ? K.txt : K.yel); });
      // credits (vertical scroller)
      panel(188, 56, 284, 118, '', K.line, .7);
      const cr = WN.credits, sp = t * 14, s0 = Math.floor(sp / 10), fy = sp % 10;
      for (let i = -1; i < 12; i++) {
        const k = s0 + i; if (k < 0) continue; const ln = cr[k % cr.length], y = 60 + i * 10 - fy + 100;
        if (y < 58 || y > 164 || !ln[0]) continue; const edge = clamp(Math.min(y - 58, 164 - y) / 14, 0, 1);
        txc(ln[0], 330, y, GFX.scale(ln[1], .25 + .75 * edge));
      }
      // menu
      darken(296, 182, 180, 34, .65); menuDraw(winMenu);
      darken(8, 182, 284, 34, .65);
      tx('EXPORT = DOWNLOAD THIS HTML WITH YOUR', 14, 186, K.dim2); tx('PATCHES IN ITS GENOME: IT BOOTS', 14, 195, K.dim2); tx('PRE-MUTATED AS GEN ' + (S.genome.gen + 1) + '.', 14, 204, K.mag);
      if (exportT > 0 && exportMsg) txc(clip(exportMsg, 78), W / 2, 220, exportMsg.startsWith('WROTE') ? K.grn : K.red);
      darken(0, 230, W, 40, .3);
      scroller(WN.scroll, WN.off, 242, t);
    }
  });

  // =====================================================================================================
  //  HUD (top 16 px strip + bottom bug line)
  // =====================================================================================================
  let dScore = 0, lastDig = '', bossF = 1, bossT = 1, bossRef = null, dashMax = .4, dashRdy = 0, lastCd = 0;
  const bump = new Float32Array(24);
  function hud(dt) {
    dt = dt || 0;
    const p = S.player;
    GFX.rectA(0, 0, W, 16, K.bg, .8); GFX.rect(0, 16, W, 1, GFX.scale(K.cyan, .3 + .35 * S.beat));
    // hp pips + dash bar
    let pw = 40;
    if (p) {
      const mh = clamp(Math.ceil(p.maxhp || 5), 1, 12), hp = clamp(Math.ceil(p.hp || 0), 0, mh), low = hp <= 1;
      pw = mh * 8 - 2;
      for (let i = 0; i < mh; i++) { const x = 5 + i * 8, on = i < hp, c = on ? (low ? ((S.frame & 8) ? K.red : K.white) : K.red2) : K.hl;
        GFX.rect(x, 3, 6, 6, c); GFX.rect(x + 1, 2, 4, 8, c); if (on) GFX.pset(x + 1, 3, K.white); else GFX.rect(x + 1, 4, 4, 4, K.bg); }
      const cd = Math.max(0, +p.dashCd || 0); if (p.dashMax > 0) dashMax = p.dashMax; else if (cd > dashMax) dashMax = cd; if (lastCd > 0 && cd <= 0) dashRdy = .25; lastCd = cd;
      const f = dashMax > 0 ? 1 - cd / dashMax : 1;
      GFX.rect(5, 12, pw, 2, K.hl); GFX.rect(5, 12, pw * f, 2, cd > 0 ? K.blue : (dashRdy > 0 ? K.white : K.cyan));
      if (dashRdy > 0) dashRdy -= dt;
    }
    // score with rolling digits
    if (dt <= 0) dScore = S.score; else { const ds = S.score - dScore; dScore += ds * Math.min(1, dt * 10); if (Math.abs(S.score - dScore) < 1) dScore = S.score; }
    const dig = String(LIVE.fn['ui.digits'](Math.round(dScore), 8)), sx = Math.max(pw + 14, 66);
    tx('SC', sx, 4, K.dim);
    for (let i = 0; i < dig.length; i++) {
      if (dig[i] !== lastDig[i]) bump[i % 24] = .12; const b = bump[i % 24]; if (b > 0) bump[i % 24] -= dt;
      tx(dig[i], sx + 14 + i * 6, 4 - (b > 0 ? Math.round(b / .12 * 2) : 0), b > 0 ? K.white : K.txt);
    }
    lastDig = dig;
    // multiplier + combo
    const mx = sx + 18 + dig.length * 6 + 6, mult = +S.mult || 1, ms = 'x' + (mult % 1 ? mult.toFixed(1) : mult);
    tx(ms, mx, 4, mult > 1 ? GFX.mix(K.yel, K.white, S.beat) : K.dim2);
    const cf = typeof S.comboT === 'number' ? clamp(S.comboT, 0, 1) : S.combo > 0 ? ((S.combo % 10) || 10) / 10 : 0, bx = mx + ms.length * 6 + 4;
    GFX.rect(bx, 6, 34, 3, K.hl); GFX.rect(bx, 6, 34 * cf, 3, mult > 1 ? K.yel : K.org);
    if (S.combo > 1) tx(String(S.combo | 0), bx + 37, 4, K.org);
    // boss bar / sector name
    const B = S.boss, mid0 = bx + 60, mid1 = 412;
    if (B && !B.dead && B.maxhp > 0) {
      if (B !== bossRef) { bossRef = B; bossF = bossT = 1; }
      const f = clamp(B.hp / B.maxhp, 0, 1); bossF += (f - bossF) * Math.min(1, dt * 14 || 1); bossT = Math.max(bossF, bossT - dt * .25);
      const nm = String(B.name || (B.T && B.T.name) || 'BOSS').toUpperCase(), w = mid1 - mid0;
      tx(clip(nm, Math.floor(w / 6) - 6), mid0, 1, (S.frame & 16) ? K.red : K.red2);
      txr(Math.ceil(f * 100) + '%', mid1, 1, K.txt);
      GFX.rect(mid0, 10, w, 5, K.dred); GFX.rect(mid0, 10, w * bossT, 5, rgb(255, 230, 230));
      const fw = w * bossF; for (let x = 0; x < fw; x += 4) GFX.rect(mid0 + x, 10, Math.min(3, fw - x), 5, GFX.mix(K.red, K.org, x / w));
      GFX.frame(mid0 - 1, 9, w + 2, 7, K.red);
    } else {
      bossRef = null; const sn = sectorName();
      if (sn) txc(clip(sn, Math.floor((mid1 - mid0) / 6)), (mid0 + mid1) / 2, 4, K.dim);
    }
    txr('SEC ' + (S.sector + 1) + (bossRef ? ' BOSS' : ' W' + (S.wave + 1)), W - 5, 4, bossRef ? K.red2 : K.cyan);
    // low hp vignette
    if (p && p.hp > 0 && Math.ceil(p.hp) <= 1) {
      const pu = .5 + .5 * Math.sin(S.t * 8);
      for (let k = 0; k < 6; k++) { const a = (1 - k / 6) * .3 * pu;
        GFX.rectA(0, 17 + k, W, 1, K.red, a); GFX.rectA(0, 261 - k, W, 1, K.red, a); GFX.rectA(k, 17, 1, 245, K.red, a); GFX.rectA(W - 1 - k, 17, 1, 245, K.red, a); }
    }
    // active bugs, blinking on the bottom line
    const bugs = PATCH.bugs();
    if (bugs.length) {
      const s = bugs.map(id => PATCH.all[id] ? PATCH.all[id].name : id).join('   ');
      GFX.rectA(0, 262, W, 8, K.black, .75);
      const c = (S.t * 3 | 0) & 1 ? K.red : rgb(150, 20, 40);
      tx('BUG' + (bugs.length > 1 ? 'S' : ' '), 3, 263, K.white);
      tx(clip(s, 73), 30, 263, c);
    }
    LIVE.fn['ui.hudpost'](0, 16); if (bugs.length) LIVE.fn['ui.hudpost'](262, 270);
  }

  // =====================================================================================================
  //  OVERLAY: banners, live-patch ticker, toasts, touch sticks, mute / fps
  // =====================================================================================================
  const banners = [], ticks = [], toasts = [];
  let showFps = false, fps = 60;
  function banner(title, sub, secs) {
    banners.push({ title: String(title == null ? '' : title), sub: sub == null ? '' : String(sub), d: +secs > 0 ? +secs : 2.2, t: 0 });
    if (banners.length > 5) banners.splice(1, 1);
  }
  function toast(text, sub, c, d) { toasts.push({ text, sub: sub || '', c, d: d || 2.6, t: 0 }); if (toasts.length > 3) toasts.shift(); }
  BUS.on('patch', en => {
    if (S.mode !== 'play' || !en) return;
    const ops = diffLines(split(en.before), split(en.after)).filter(o => o.op !== ' '), p = PATCH.all[en.tag];
    const mi = ops.filter(o => o.op === '-').slice(0, 2), pl = ops.filter(o => o.op === '+').slice(0, 2);
    ticks.push({ name: en.name, pname: p ? p.name : (en.tag || 'ANON PATCH'), bug: !!(p && p.kind === 'bug'), lines: mi.concat(pl), more: ops.length - mi.length - pl.length, t: 0, gen: LIVE.gen });
    if (ticks.length > 3) ticks.shift();
  });
  BUS.on('panic', (e, en) => { toast('EXCEPTION - ROLLED BACK ' + (en && en.name || '?'), clip(String(e && e.message || e || ''), 60), K.red, 3); sfx('glitch'); });
  BUS.on('patch:cure', p => { if (p && p.kind === 'bug' && S.mode === 'play') toast('PATCH REVERTED', p.name, K.grn, 2.4); });
  function drawBanner(dt) {
    const b = banners[0]; if (!b) return; b.t += dt; if (b.t >= b.d) { banners.shift(); return; }
    const tin = sstep(0, 1, b.t / .3), tout = sstep(0, 1, (b.d - b.t) / .32), e = Math.min(tin, tout);
    let sc = 3; while (sc > 1 && GFX.textW(b.title, sc) > W - 20) sc--;
    const th = 8 * sc, y = 62, bh = th + (b.sub ? 24 : 12), by = y - 6, h = Math.max(1, bh * e), hy = by + (bh - h) / 2;
    GFX.rectA(0, hy, W, h, K.black, .62);
    const lw = W * e; GFX.rect((W - lw) / 2, hy - 1, lw, 1, K.cyan); GFX.rect((W - lw) / 2, hy + h, lw, 1, K.mag);
    if (e < .25) return;
    const tw = GFX.textW(b.title, sc), x = Math.round((W - tw) / 2 - (1 - tin) * 140 + (1 - tout) * 140);
    if (e < 1) { GFX.text(b.title, x - 3, y, K.mag, sc); GFX.text(b.title, x + 3, y, K.cyan, sc); }
    GFX.text(b.title, x + 1, y + 2, K.black, sc);
    GFX.textFx(b.title, x, y, sc, (px, py, u, v) => (py & 1) && v > .15 ? GFX.mix(K.white, K.cyan, v) : GFX.mix(K.white, K.cyan, v * .6));
    if (e < 1) tear(hy | 0, (hy + h) | 0, (1 - e) * 26);
    if (b.sub) { const n = Math.floor((b.t - .2) * 45); if (n > 0) txc(b.sub.slice(0, n), W / 2, y + th + 6, K.yel); }
  }
  function drawTicks(dt) {
    let y = 258; const bugRow = PATCH.bugs().length && S.mode === 'play'; if (bugRow) y = 254;
    for (let i = ticks.length - 1; i >= 0; i--) {
      const k = ticks[i]; k.t += dt; if (k.t > 3.2) { ticks.splice(i, 1); continue; }
      const n = k.lines.length, h = 13 + n * 9 + (k.more > 0 ? 9 : 0) + 2, w = 236, a = sstep(0, .18, k.t) * sstep(3.2, 2.9, k.t), x = 4 - (1 - a) * 240;
      y -= h; if (y < 20) break;
      const ac = k.bug ? K.red : K.grn;
      GFX.rectA(x, y, w, h, K.panel, .78); GFX.frame(x, y, w, h, ac); GFX.rect(x + 1, y + 1, w - 2, 10, GFX.scale(ac, .35));
      tx(clip((k.bug ? 'BUG ' : 'LIVE PATCH ') + k.name, 26), x + 4, y + 2, K.white); txr('#' + k.gen, x + w - 4, y + 2, K.dim2);
      for (let j = 0; j < n; j++) { const o = k.lines[j], s = o.s.replace(/^\s+/, '');
        tx(o.op + ' ' + clip(s, 36), x + 4, y + 13 + j * 9, o.op === '-' ? (k.bug ? rgb(150, 90, 100) : K.red2) : ac); }
      if (k.more > 0) tx('  ... ' + k.more + ' MORE LINE' + (k.more > 1 ? 'S' : ''), x + 4, y + 13 + n * 9, K.dim);
      y -= 3;
    }
  }
  function drawToasts(dt) {
    for (let i = 0; i < toasts.length; i++) {
      const o = toasts[i]; o.t += dt; if (o.t > o.d) { toasts.splice(i--, 1); continue; }
      const a = sstep(0, .15, o.t) * sstep(o.d, o.d - .3, o.t), w = Math.max(GFX.textW(o.text, 1), GFX.textW(o.sub, 1)) + 16, h = o.sub ? 24 : 14;
      const x = (W - w) / 2, y = 22 + i * 28 - (1 - a) * 30;
      GFX.rectA(x, y, w, h, K.black, .8 * a); GFX.frame(x, y, w, h, o.c);
      if (o.t < .35 && (S.frame & 2)) GFX.rectA(x, y, w, h, o.c, .35);
      txc(o.text, W / 2, y + 3, o.t < .35 && (S.frame & 4) ? K.white : o.c);
      if (o.sub) txc(o.sub, W / 2, y + 13, K.dim2);
    }
  }
  function drawSticks() {
    if (!IN.touch || S.mode !== 'play') return;
    const st = IN.sticks;
    for (let i = 0; i < 2; i++) {
      const s = st[i], c = i ? K.mag : K.cyan;
      if (s.on) {
        let dx = s.x - s.ox, dy = s.y - s.oy; const l = Math.hypot(dx, dy); if (l > 26) { dx *= 26 / l; dy *= 26 / l; }
        GFX.circ(s.ox, s.oy, 26, GFX.scale(c, .7)); GFX.circ(s.ox, s.oy, 27, GFX.scale(c, .3));
        GFX.glow(s.ox + dx, s.oy + dy, 14, c, .5); GFX.disc(s.ox + dx, s.oy + dy, 8, GFX.scale(c, .6)); GFX.circ(s.ox + dx, s.oy + dy, 8, c);
      } else {
        const hx = i ? 410 : 70, hy = 210;
        GFX.circ(hx, hy, 22, GFX.scale(c, .22)); txc(i ? 'AIM' : 'MOVE', hx, hy - 3, GFX.scale(c, .35));
      }
    }
  }
  function overlay(dt) {
    dt = dt || 0;
    if (IN.hit('Backquote')) showFps = !showFps;
    if (dt > 0) fps += (1 / dt - fps) * .05;
    drawSticks();
    if (S.mode !== 'patch') drawTicks(dt); else ticks.length = 0;
    drawBanner(dt);
    drawToasts(dt);
    if (S.opt.mute) txr('MUTE', W - 3, S.mode === 'play' ? 18 : 262, K.dim);
    if (showFps) txs((fps + .5 | 0) + ' FPS  GEN ' + LIVE.gen, 3, S.mode === 'play' ? 18 : 262, fps < 50 ? K.red : K.grn);
  }

  return { hud, overlay, banner, toast, diff: diffLines, K };
})();
