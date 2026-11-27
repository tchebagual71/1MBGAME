// ===== 00-kernel.js : SELF.MOD kernel — framebuffer, LIVE code registry, entities, patches, input, scenes =====
const W = 480, H = 270, PI = Math.PI, TAU = PI * 2;
const fb = new Uint32Array(W * H);            // pixels are 0xAABBGGRR (little-endian RGBA)
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const rgb = (r, g, b) => (0xff000000 | (b & 255) << 16 | (g & 255) << 8 | (r & 255)) >>> 0;
const C = { black: rgb(0, 0, 0), white: rgb(255, 255, 255), cyan: rgb(60, 240, 255), magenta: rgb(255, 60, 220), yellow: rgb(255, 230, 70),
  red: rgb(255, 60, 70), green: rgb(80, 255, 120), orange: rgb(255, 150, 40), blue: rgb(70, 110, 255), dim: rgb(90, 100, 130), dark: rgb(20, 22, 34) };

// deterministic RNG (mulberry32)
let _seed = (Date.now() ^ 0x9e3779b9) >>> 0;
const srand = s => { _seed = (s >>> 0) || 1; };
const rnd = () => { _seed = _seed + 0x6D2B79F5 | 0; let t = Math.imul(_seed ^ _seed >>> 15, 1 | _seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rndr = (a, b) => a + rnd() * (b - a), rndi = n => rnd() * n | 0, pick = a => a[rnd() * a.length | 0];

// event bus
const BUS = { _h: {}, on(ev, fn) { (BUS._h[ev] || (BUS._h[ev] = [])).push(fn); }, emit(ev, a, b, c) { const h = BUS._h[ev]; if (h) for (let i = 0; i < h.length; i++) h[i](a, b, c); } };

// global game state
const S = { t: 0, dt: 0, frame: 0, mode: '', score: 0, hi: 0, combo: 0, mult: 1, sector: 0, wave: 0, diff: 1, kills: 0, runTime: 0,
  shake: 0, flash: 0, glitch: 0, beat: 0, bar: 0, step: 0, player: null, boss: null, err: null,
  genome: { gen: 0, ids: [], hi: 0 }, opt: { crt: true, mute: false } };

// ---------- LIVE: the self-modifying code registry ----------
// Every hot gameplay/visual/audio routine is stored as SOURCE TEXT, compiled with a direct eval (so it closes over
// the whole bundle scope) and can be string-patched + recompiled at runtime. Always call through LIVE.fn[name](...).
const LIVE = {
  fn: {}, src: {}, log: [], gen: 0, _d: {}, _tag: '',
  _c(args, body) { return eval('(function(' + args + '){' + body + '\n})'); },
  def(name, args, body) { const f = LIVE._c(args, body); LIVE._d[name] = { args, base: body, p: [] }; LIVE.src[name] = body; LIVE.fn[name] = f; return f; },
  _ap(s, p) { return typeof p.repl === 'function' ? s.replace(p.find, p.repl) : s.replace(p.find, () => p.repl); },
  _re(name) { // rebuild from base + surviving patches (a patch that no longer compiles is skipped)
    const d = LIVE._d[name]; let s = d.base, f = null;
    for (const p of d.p) { const s2 = LIVE._ap(s, p); if (s2 === s) continue; try { f = LIVE._c(d.args, s2); s = s2; } catch (e) { } }
    if (!f || s === d.base) f = LIVE._c(d.args, s);
    LIVE.src[name] = s; LIVE.fn[name] = f; LIVE.gen++;
  },
  // patch(name, find, repl[, tag]) — find: string (first occurrence) or RegExp; repl: string (literal) or function. Returns bool.
  patch(name, find, repl, tag) {
    const d = LIVE._d[name]; if (!d) return false;
    const p = { find, repl, tag: tag || LIVE._tag || '' }, cur = LIVE.src[name], s = LIVE._ap(cur, p);
    if (s === cur) return false;
    let f; try { f = LIVE._c(d.args, s); } catch (e) { return false; }
    d.p.push(p); LIVE.src[name] = s; LIVE.fn[name] = f; LIVE.gen++;
    const en = { t: S.t, name, tag: p.tag, before: cur, after: s, p }; LIVE.log.push(en); if (LIVE.log.length > 64) LIVE.log.shift();
    BUS.emit('patch', en); return true;
  },
  revertTag(tag) { let n = 0; for (const name in LIVE._d) { const d = LIVE._d[name], k = d.p.length; d.p = d.p.filter(p => p.tag !== tag); if (d.p.length !== k) { LIVE._re(name); n++; } } if (n) BUS.emit('revert', tag); return n; },
  revert(name) { const d = LIVE._d[name]; if (d && d.p.length) { d.p = []; LIVE._re(name); } },
  revertAll() { for (const name in LIVE._d) LIVE.revert(name); LIVE.log.length = 0; },
  // called by the main loop when a frame throws: roll back the most recent patch (self-healing code)
  panic(e) {
    for (let i = LIVE.log.length - 1; i >= 0; i--) { const en = LIVE.log[i], d = LIVE._d[en.name], k = d.p.indexOf(en.p);
      if (k >= 0) { d.p.splice(k, 1); LIVE._re(en.name); LIVE.log.splice(i, 1); BUS.emit('panic', e, en); return true; } }
    if (!S.err) console.error(e); S.err = e; return false;
  }
};

// ---------- PATCH: catalog of upgrades ('up') and hostile corruptions ('bug') — all implemented as LIVE source edits ----------
const PATCH = {
  all: {}, active: [],
  def(p) { p.n = 0; p.kind = p.kind || 'up'; p.weight = p.weight == null ? 1 : p.weight; p.max = p.max == null ? 1 : p.max; PATCH.all[p.id] = p; return p; },
  can(p) { return p.n < p.max && (!p.can || p.can()); },
  offer(n, kind) { kind = kind || 'up'; const pool = Object.values(PATCH.all).filter(p => p.kind === kind && PATCH.can(p)), out = [];
    while (out.length < n && pool.length) { let tot = 0; for (const p of pool) tot += p.weight; let r = rnd() * tot, i = 0; for (; i < pool.length - 1; i++) { r -= pool[i].weight; if (r <= 0) break; } out.push(pool.splice(i, 1)[0]); }
    return out; },
  apply(id) { const p = PATCH.all[id]; if (!p || !PATCH.can(p)) return false; const pt = LIVE._tag; LIVE._tag = id; let ok; try { ok = p.apply() !== false; } catch (e) { ok = false; } LIVE._tag = pt;
    if (ok) { p.n++; PATCH.active.push(id); BUS.emit('patch:apply', p); } return ok; },
  cure(id) { const p = PATCH.all[id]; if (!p || !p.n) return false; LIVE.revertTag(id); if (p.revert) p.revert(); p.n = 0; PATCH.active = PATCH.active.filter(x => x !== id); BUS.emit('patch:cure', p); return true; },
  infect() { const c = PATCH.offer(1, 'bug')[0]; return c && PATCH.apply(c.id) ? c : null; },
  bugs() { return PATCH.active.filter(id => PATCH.all[id].kind === 'bug'); },
  reset() { for (const id in PATCH.all) { const p = PATCH.all[id]; if (p.n && p.revert) p.revert(); p.n = 0; } PATCH.active = []; LIVE.revertAll(); }
};

// ---------- ENT: entities ----------
const T_PLAYER = 0, T_ENEMY = 1, T_PSHOT = 2, T_ESHOT = 3, T_PICK = 4, T_FX = 5;
const ENT = {
  T: {}, list: [],
  def(type, proto) { proto.type = type; ENT.T[type] = proto; return proto; },
  spawn(type, x, y, o) { const T = ENT.T[type]; if (!T) return null;
    const e = { type, T, x, y, vx: 0, vy: 0, r: T.r || 4, hp: T.hp || 1, maxhp: 0, team: T.team == null ? T_ENEMY : T.team, layer: T.layer == null ? 2 : T.layer, age: 0, flash: 0, dead: false };
    if (o) Object.assign(e, o); if (T.init) T.init(e); if (!e.maxhp) e.maxhp = e.hp; ENT.list.push(e); return e; },
  update(dt) { const L = ENT.list; for (let i = 0; i < L.length; i++) { const e = L[i]; if (e.dead) continue; e.age += dt; if (e.flash > 0) e.flash -= dt; if (e.T.update) e.T.update(e, dt); }
    let j = 0; for (let i = 0; i < L.length; i++) if (!L[i].dead) L[j++] = L[i]; L.length = j; },
  draw() { const L = ENT.list; for (let l = 0; l < 5; l++) for (let i = 0; i < L.length; i++) { const e = L[i]; if (e.layer === l && !e.dead && e.T.draw) e.T.draw(e); } },
  damage(e, d, src) { if (e.dead) return false; if (e.T.hurt && e.T.hurt(e, d, src) === false) return false; e.hp -= d; e.flash = .08; BUS.emit('hurt', e, d, src); if (e.hp <= 0) ENT.kill(e, src); return true; },
  kill(e, src) { if (e.dead) return; e.dead = true; if (e.T.die) e.T.die(e, src); BUS.emit('kill', e, src); },
  count(team) { let n = 0; for (const e of ENT.list) if (!e.dead && e.team === team) n++; return n; },
  each(team, fn) { const L = ENT.list; for (let i = 0, n = L.length; i < n; i++) { const e = L[i]; if (!e.dead && e.team === team) fn(e); } },
  nearest(x, y, team, maxd) { let b = null, bd = maxd == null ? 1e9 : maxd * maxd; for (const e of ENT.list) { if (e.dead || e.team !== team) continue; const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y); if (d < bd) { bd = d; b = e; } } return b; },
  clear(keep) { ENT.list = keep ? ENT.list.filter(keep) : []; }
};

// ---------- SCENE ----------
const SCENE = { all: {}, cur: null, name: '', def(name, sc) { SCENE.all[name] = sc; }, go(name, arg) { const prev = SCENE.name, sc = SCENE.all[name]; if (!sc) return; if (SCENE.cur && SCENE.cur.leave) SCENE.cur.leave(name); SCENE.cur = sc; SCENE.name = S.mode = name; if (sc.enter) sc.enter(prev, arg); BUS.emit('scene', name, prev); } };

// ---------- persistent store (safe on file:// and sandboxed frames) ----------
const STORE = { get(k, d) { try { const v = localStorage.getItem('selfmod.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('selfmod.' + k, JSON.stringify(v)); } catch (e) { } } };

// ---------- SELF: the document can rewrite and re-emit itself (genome export) ----------
const SELF = { html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
  build(genome) { return SELF.html.replace(/(<script id="?genome"?>)[^<]*(<\/script>)/, (m, a, b) => a + 'window.__GENOME=' + JSON.stringify(genome) + b); },
  export(genome) { try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([SELF.build(genome)], { type: 'text/html' })); a.download = 'selfmod-gen' + genome.gen + '.html'; a.click(); return true; } catch (e) { return false; } } };

// ---------- canvas ----------
document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none';
const CV = document.createElement('canvas'); CV.style.cssText = 'position:fixed;display:block;cursor:crosshair;outline:none;touch-action:none'; document.body.appendChild(CV);
const VIEW = { w: W, h: H, dpr: 1 };
function fit() { const iw = innerWidth || W, ih = innerHeight || H, s = Math.min(iw / W, ih / H), w = Math.max(1, Math.floor(W * s)), h = Math.max(1, Math.floor(H * s));
  CV.style.width = w + 'px'; CV.style.height = h + 'px'; CV.style.left = ((iw - w) >> 1) + 'px'; CV.style.top = ((ih - h) >> 1) + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1); VIEW.w = Math.max(W, Math.round(w * dpr)); VIEW.h = Math.max(H, Math.round(h * dpr)); VIEW.dpr = dpr; BUS.emit('resize'); }
addEventListener('resize', fit);

// ---------- IN: keyboard + mouse + touch twin-stick + gamepad ----------
const IN = {
  mx: W / 2, my: H / 2, mvx: 0, mvy: 0, ax: 1, ay: 0, fire: false, dash: false, click: false, any: false, touch: false, mode: 'mouse',
  sticks: [{ on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, t0: 0 }, { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, t0: 0 }],
  _d: {}, _h: {}, _hq: {}, _mb: 0, _cq: false, _dq: false, _aq: false, _pad: 0,
  key: c => !!IN._d[c], hit: c => !!IN._h[c],
  toFb(cx, cy) { const r = CV.getBoundingClientRect(); return [(cx - r.left) / (r.width || 1) * W, (cy - r.top) / (r.height || 1) * H]; },
  // unit aim vector from a world position (mouse → towards cursor; stick/keys → stick direction). Writes IN.ax/IN.ay.
  aimFrom(px, py) { if (IN.mode === 'mouse') { const dx = IN.mx - px, dy = IN.my - py, l = Math.hypot(dx, dy); if (l > .5) { IN.ax = dx / l; IN.ay = dy / l; } } return IN; },
  poll() {
    const k = IN._d; IN._h = IN._hq; IN._hq = {}; IN.click = IN._cq; IN._cq = false; IN.any = IN._aq; IN._aq = false; IN.dash = IN._dq; IN._dq = false;
    let mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), my = (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0);
    let ax = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0), ay = (k.ArrowDown ? 1 : 0) - (k.ArrowUp ? 1 : 0), fire = (IN._mb & 1) > 0, stick = false;
    if (ax || ay) stick = true;
    const s0 = IN.sticks[0], s1 = IN.sticks[1];
    if (s0.on) { mx = (s0.x - s0.ox) / 24; my = (s0.y - s0.oy) / 24; }
    if (s1.on) { const dx = s1.x - s1.ox, dy = s1.y - s1.oy; if (dx * dx + dy * dy > 36) { ax = dx; ay = dy; stick = true; } }
    const gp = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of gp) { if (!g || !g.axes || g.axes.length < 2) continue; const dz = v => Math.abs(v) < .22 ? 0 : v;
      const lx = dz(g.axes[0]), ly = dz(g.axes[1]), rx = dz(g.axes[2] || 0), ry = dz(g.axes[3] || 0);
      if (lx || ly) { mx = lx; my = ly; } if (rx || ry) { ax = rx; ay = ry; stick = true; }
      let bits = 0; for (let i = 0; i < g.buttons.length && i < 16; i++) if (g.buttons[i].pressed) bits |= 1 << i;
      const np = bits & ~IN._pad; IN._pad = bits; if (np & 0x33) IN.dash = true; if (np & 1) { IN.any = true; IN._h.Enter = 1; } if (np & 0x200) IN._h.Escape = 1; if (bits & 0xc0) fire = true; break; }
    let l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; } IN.mvx = mx; IN.mvy = my;
    if (stick) { l = Math.hypot(ax, ay); IN.ax = ax / l; IN.ay = ay / l; IN.mode = 'stick'; fire = true; }
    IN.fire = fire; if (IN._h.Space || IN._h.ShiftLeft || IN._h.ShiftRight) IN.dash = true;
  }
};
(() => {
  const gesture = () => BUS.emit('gesture');
  addEventListener('keydown', e => { if (e.metaKey || e.ctrlKey) return; if (!IN._d[e.code]) { IN._hq[e.code] = 1; IN._aq = true; } IN._d[e.code] = 1; gesture();
    if (/^(Arrow|Space|Tab|Escape|Enter)/.test(e.code)) e.preventDefault(); });
  addEventListener('keyup', e => { IN._d[e.code] = 0; });
  addEventListener('blur', () => { IN._d = {}; IN._mb = 0; BUS.emit('blur'); });
  const mm = e => { const p = IN.toFb(e.clientX, e.clientY); IN.mx = p[0]; IN.my = p[1]; IN.mode = 'mouse'; };
  addEventListener('mousemove', mm);
  addEventListener('mousedown', e => { mm(e); IN._mb |= 1 << e.button; if (e.button === 0) IN._cq = true; if (e.button === 2) IN._dq = true; IN._aq = true; gesture(); e.preventDefault(); });
  addEventListener('mouseup', e => { IN._mb &= ~(1 << e.button); });
  addEventListener('contextmenu', e => e.preventDefault());
  const ts = e => { IN.touch = true; gesture(); for (const t of e.changedTouches) { const p = IN.toFb(t.clientX, t.clientY), s = IN.sticks[p[0] < W / 2 ? 0 : 1];
      IN.mx = p[0]; IN.my = p[1]; if (!s.on) { s.on = true; s.id = t.identifier; s.ox = s.x = p[0]; s.oy = s.y = p[1]; s.t0 = performance.now(); } } e.preventDefault(); };
  const tm = e => { for (const t of e.changedTouches) for (const s of IN.sticks) if (s.on && s.id === t.identifier) { const p = IN.toFb(t.clientX, t.clientY); s.x = p[0]; s.y = p[1]; } e.preventDefault(); };
  const te = e => { for (const t of e.changedTouches) for (let i = 0; i < 2; i++) { const s = IN.sticks[i]; if (s.on && s.id === t.identifier) { s.on = false;
        if (performance.now() - s.t0 < 250 && Math.hypot(s.x - s.ox, s.y - s.oy) < 8) { IN._cq = true; IN._aq = true; IN.mx = s.x; IN.my = s.y; if (i === 1) IN._dq = true; } } } e.preventDefault(); };
  const o = { passive: false }; addEventListener('touchstart', ts, o); addEventListener('touchmove', tm, o); addEventListener('touchend', te, o); addEventListener('touchcancel', te, o);
})();
