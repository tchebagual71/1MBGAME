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
// a throwing handler does not starve the others: all run, then the first error is rethrown (so the frame's self-heal still sees it)
const BUS = { _h: {}, on(ev, fn) { (BUS._h[ev] || (BUS._h[ev] = [])).push(fn); return fn; },
  off(ev, fn) { const h = BUS._h[ev], i = h ? h.indexOf(fn) : -1; if (i >= 0) h.splice(i, 1); },
  emit(ev, a, b, c) { const h = BUS._h[ev]; if (!h) return; let err = null; for (let i = 0; i < h.length; i++) { try { h[i](a, b, c); } catch (e) { if (!err) err = e; } } if (err) throw err; } };

// global game state
const S = { t: 0, dt: 0, frame: 0, mode: '', score: 0, hi: 0, combo: 0, mult: 1, sector: 0, wave: 0, diff: 1, kills: 0, runTime: 0,
  shake: 0, flash: 0, glitch: 0, beat: 0, bar: 0, step: 0, player: null, boss: null, err: null,
  genome: { gen: 0, ids: [], hi: 0 }, opt: { crt: true, mute: false } };

// ---------- LIVE: the self-modifying code registry ----------
// Every hot gameplay/visual/audio routine is stored as SOURCE TEXT, compiled with a direct eval (so it closes over
// the whole bundle scope) and can be string-patched + recompiled at runtime. Always call through LIVE.fn[name](...).
// notifications from kernel internals must never abort the operation that sent them
const tell = (ev, a, b) => { try { BUS.emit(ev, a, b); } catch (e) { console.error(e); } };
const LIVE = {
  fn: {}, src: {}, log: [], gen: 0, _d: {}, _tag: '', _app: 0, _seq: 0,
  // compiled code carries a sourceURL so stack traces name the live function ("live:wpn.fire") — panic() uses that
  _c(args, body, name) { return eval('(function(' + args + '){' + body + '\n})' + (name ? '\n//# sourceURL=live:' + String(name).replace(/[^\w.$-]/g, '_') : '')); },
  // (re)define. Re-defining an existing name keeps its patch list and re-applies it onto the new base.
  def(name, args, body) { const old = LIVE._d[name], f = LIVE._c(args, body, name); LIVE._d[name] = { args, base: body, p: old ? old.p : [] }; LIVE.src[name] = body; LIVE.fn[name] = f;
    if (old && old.p.length) LIVE._re(name); return LIVE.fn[name]; },
  // string find = first literal occurrence, string repl = literal text ('$' is NOT special); RegExp lastIndex is reset so /g and /y are stateless
  _ap(s, p) { if (p.find instanceof RegExp) p.find.lastIndex = 0; const r = typeof p.repl === 'function' ? s.replace(p.find, p.repl) : s.replace(p.find, () => p.repl);
    if (p.find instanceof RegExp) p.find.lastIndex = 0; return r; },
  // rebuild from base + surviving patches. A patch that no longer matches (or no longer compiles) stays in the list but
  // dormant (p.on=false): it re-activates by itself if a later rebuild makes it match again.
  _re(name) {
    const d = LIVE._d[name]; let s = d.base, f = null;
    for (const p of d.p) { const s2 = LIVE._ap(s, p); p.on = s2 !== s; s = s2; }
    try { f = LIVE._c(d.args, s, name); } catch (e) { f = null; }
    if (!f) { s = d.base; for (const p of d.p) { const s2 = LIVE._ap(s, p); p.on = false; if (s2 === s) continue; try { LIVE._c(d.args, s2); s = s2; p.on = true; } catch (e) { } } f = LIVE._c(d.args, s, name); }
    LIVE.src[name] = s; LIVE.fn[name] = f; LIVE.gen++;
  },
  // patch(name, find, repl[, tag]) — find: string (first occurrence) or RegExp; repl: string (literal) or function. Returns bool.
  patch(name, find, repl, tag) {
    const d = LIVE._d[name]; if (!d) return false;
    const p = { find, repl, tag: tag || LIVE._tag || '', app: LIVE._app, seq: 0, on: true }, cur = LIVE.src[name]; let s;
    try { s = LIVE._ap(cur, p); } catch (e) { return false; }
    if (typeof s !== 'string' || s === cur) return false;
    let f; try { f = LIVE._c(d.args, s, name); } catch (e) { return false; }
    p.seq = ++LIVE._seq; d.p.push(p); LIVE.src[name] = s; LIVE.fn[name] = f; LIVE.gen++;
    const en = { t: S.t, name, tag: p.tag, before: cur, after: s, p }; LIVE.log.push(en); if (LIVE.log.length > 64) LIVE.log.shift();
    tell('patch', en); return true;
  },
  _drop(pred) { const ch = []; for (const name in LIVE._d) { const d = LIVE._d[name], k = d.p.length; d.p = d.p.filter(p => !pred(p)); if (d.p.length !== k) { LIVE._re(name); ch.push(name); } } return ch; },
  revertTag(tag) { const n = LIVE._drop(p => p.tag === tag).length; if (n) tell('revert', tag); return n; },
  revertApp(app) { return app ? LIVE._drop(p => p.app === app).length : 0; },   // undo every edit made by one PATCH.apply call
  revert(name) { const d = LIVE._d[name]; if (d && d.p.length) { d.p = []; LIVE._re(name); } },
  revertAll() { for (const name in LIVE._d) LIVE.revert(name); LIVE.log.length = 0; },
  // roll back one LIVE edit and, if it belonged to a PATCH application, that whole application (all its edits),
  // keeping PATCH.active / p.n consistent. Returns the log entry describing it.
  _undo(name, p) {
    let en = null; for (let i = LIVE.log.length - 1; i >= 0; i--) if (LIVE.log[i].p === p) { en = LIVE.log[i]; break; }
    if (!en) en = { t: S.t, name, tag: p.tag, before: LIVE.src[name], after: LIVE.src[name], p };
    if (p.app) LIVE._drop(q => q.app === p.app); else LIVE._drop(q => q === p);
    for (let i = LIVE.log.length - 1; i >= 0; i--) { const q = LIVE.log[i].p; if (q === p || (p.app && q && q.app === p.app)) LIVE.log.splice(i, 1); }
    const P = p.app && p.tag && PATCH.all[p.tag];
    if (P && P.n > 0) { P.n--; const k = PATCH.active.lastIndexOf(p.tag); if (k >= 0) PATCH.active.splice(k, 1); if (!P.n && P.revert) try { P.revert(); } catch (e) { } }
    return en;
  },
  // newest patch on `name` (or on any of the names in `set`) — by application order
  _newest(set) { let b = null, bn = ''; for (const n in LIVE._d) if (!set || set[n]) for (const p of LIVE._d[n].p) if (!b || p.seq > b.seq) { b = p; bn = n; } return b ? [bn, b] : null; },
  // a specific live function misbehaved: roll back its newest patch. Returns true if something was rolled back.
  heal(name, e) { const h = LIVE._newest({ [name]: 1 }); if (!h) return false; tell('panic', e, LIVE._undo(h[0], h[1])); return true; },
  // called by the main loop when a frame throws: roll back the newest patch of a live function that is on the error's
  // stack; if the stack names none (or none is patched), the newest patch overall (self-healing code)
  panic(e) {
    const on = {}; String(e && e.stack || '').replace(/live:([\w.$-]+)/g, (m, n) => (on[n] = 1, m));
    const h = LIVE._newest(on) || LIVE._newest(null);
    if (h) { tell('panic', e, LIVE._undo(h[0], h[1])); return true; }
    if (!S.err) console.error(e); S.err = e; return false;
  }
};

// ---------- PATCH: catalog of upgrades ('up') and hostile corruptions ('bug') — all implemented as LIVE source edits ----------
const PATCH = {
  all: {}, active: [], _app: 0,
  def(p) { p.n = 0; p.kind = p.kind || 'up'; p.weight = p.weight == null ? 1 : +p.weight || 0; p.max = p.max == null ? 1 : p.max; PATCH.all[p.id] = p; return p; },
  can(p) { try { return p.n < p.max && (!p.can || !!p.can()); } catch (e) { return false; } },
  // weight<=0 patches are never offered (they can still be applied explicitly by id)
  offer(n, kind) { kind = kind || 'up'; const pool = Object.values(PATCH.all).filter(p => p.kind === kind && p.weight > 0 && PATCH.can(p)), out = [];
    while (out.length < n && pool.length) { let tot = 0; for (const p of pool) tot += p.weight; let r = rnd() * tot, i = 0; for (; i < pool.length - 1; i++) { r -= pool[i].weight; if (r <= 0) break; } out.push(pool.splice(i, 1)[0]); }
    return out; },
  // all LIVE edits made during one apply share an application id: a failed/partial apply is rolled back completely,
  // and LIVE.panic removes whole applications (p.n and PATCH.active are decremented accordingly)
  apply(id) { const p = PATCH.all[id]; if (!p || !PATCH.can(p)) return false; const pt = LIVE._tag, pa = LIVE._app, app = LIVE._app = ++PATCH._app; LIVE._tag = id;
    let ok; try { ok = p.apply() !== false; } catch (e) { ok = false; } LIVE._tag = pt; LIVE._app = pa;
    if (!ok) { LIVE.revertApp(app); return false; }
    p.n++; PATCH.active.push(id); tell('patch:apply', p); return true; },
  // cure removes every stack of the patch
  cure(id) { const p = PATCH.all[id]; if (!p || !p.n) return false; LIVE.revertTag(id); if (p.revert) try { p.revert(); } catch (e) { } p.n = 0; PATCH.active = PATCH.active.filter(x => x !== id); tell('patch:cure', p); return true; },
  infect() { const c = PATCH.offer(1, 'bug')[0]; return c && PATCH.apply(c.id) ? c : null; },
  bugs() { return PATCH.active.filter(id => PATCH.all[id] && PATCH.all[id].kind === 'bug'); },
  reset() { for (const id in PATCH.all) { const p = PATCH.all[id]; if (p.n && p.revert) try { p.revert(); } catch (e) { } p.n = 0; } PATCH.active = []; LIVE.revertAll(); }
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
// SELF.html is re-serialised from the document's ORIGINAL pieces (html/body open tags, <meta>/<title>, the <script>s) in the exact
// shape tools/build.js writes, captured before the kernel touches the DOM — so an export is byte-identical to the shipped file
// except for the genome script, regardless of parse progress, trailing whitespace or nodes injected by extensions.
const SELF = { html: (() => {
    const d = document, open = el => { const s = el.cloneNode(false).outerHTML; return s.slice(0, s.lastIndexOf('</')); };
    try { const head = [...d.head.children].filter(e => /^(META|TITLE)$/.test(e.tagName)).map(e => e.outerHTML).join(''),
        body = [...d.body.children].filter(e => e.tagName === 'SCRIPT').map(e => e.outerHTML).join('');
      if (!/id="?genome/.test(body)) throw 0;
      return '<!DOCTYPE html>\n' + open(d.documentElement) + '<head>' + head + '</head>' + open(d.body) + body + '</body></html>\n';
    } catch (e) { return '<!DOCTYPE html>\n' + d.documentElement.outerHTML; } })(),
  // sanitised genome: {gen>=0 int, ids: unique strings, hi>=0}
  norm(g) { g = g && typeof g === 'object' ? g : {}; const ids = Array.isArray(g.ids) ? g.ids.filter((x, i, a) => typeof x === 'string' && x.length < 64 && a.indexOf(x) === i).slice(0, 16) : [];
    return { gen: Math.max(0, Math.min(1e6, Math.floor(+g.gen) || 0)), ids, hi: Math.max(0, Math.min(1e15, Math.floor(+g.hi) || 0)) }; },
  build(genome) { const js = 'window.__GENOME=' + JSON.stringify(SELF.norm(genome)).replace(/</g, '\\u003c');
    return SELF.html.replace(/(<script id="?genome"?>)[^<]*(<\/script>)/, (m, a, b) => a + js + b); },
  export(genome) { try { const g = SELF.norm(genome), a = document.createElement('a'), u = URL.createObjectURL(new Blob([SELF.build(g)], { type: 'text/html' }));
      a.href = u; a.download = 'selfmod-gen' + g.gen + '.html'; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(u); } catch (e) { } }, 60000); return true; } catch (e) { return false; } },
  fullscreen() { try { const d = document, r = d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen ? d.documentElement.requestFullscreen() : null;
      if (r && r.catch) r.catch(() => { }); } catch (e) { } } };

// ---------- canvas ----------
document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none';
const CV = document.createElement('canvas'); CV.style.cssText = 'position:fixed;display:block;cursor:crosshair;outline:none;touch-action:none'; document.body.appendChild(CV);
const VIEW = { w: W, h: H, dpr: 1 };
function fit() { const iw = innerWidth || W, ih = innerHeight || H, s = Math.min(iw / W, ih / H), w = Math.max(1, Math.floor(W * s)), h = Math.max(1, Math.floor(H * s));
  CV.style.width = w + 'px'; CV.style.height = h + 'px'; CV.style.left = ((iw - w) >> 1) + 'px'; CV.style.top = ((ih - h) >> 1) + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1); VIEW.w = Math.max(W, Math.round(w * dpr)); VIEW.h = Math.max(H, Math.round(h * dpr)); VIEW.dpr = dpr; BUS.emit('resize'); }
addEventListener('resize', fit); addEventListener('orientationchange', () => setTimeout(fit, 120));

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
    // gamepad (standard mapping): L stick / d-pad move, R stick aim+fire, A/B/LB/RB dash, LT/RT fire, A = Enter, Start = Escape,
    // d-pad also produces Arrow* hits for menus. getGamepads may throw (permissions policy in iframes) or hold nulls.
    let gp = null; try { gp = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) { gp = null; }
    let pad = null; if (gp) for (let i = 0; i < gp.length; i++) { const g = gp[i]; if (g && g.connected !== false && g.axes && g.axes.length >= 2) { pad = g; break; } }
    if (pad) { const g = pad, dz = v => (v = +v || 0, Math.abs(v) < .22 ? 0 : v), B = g.buttons || [];
      const lx = dz(g.axes[0]), ly = dz(g.axes[1]), rx = dz(g.axes[2]), ry = dz(g.axes[3]);
      let bits = 0; for (let i = 0; i < B.length && i < 17; i++) if (B[i] && (B[i].pressed || B[i] === 1)) bits |= 1 << i;
      const dx = (bits >> 15 & 1) - (bits >> 14 & 1), dy = (bits >> 13 & 1) - (bits >> 12 & 1);
      if (lx || ly) { mx = lx; my = ly; } else if (dx || dy) { mx = dx; my = dy; } if (rx || ry) { ax = rx; ay = ry; stick = true; }
      const np = bits & ~IN._pad; IN._pad = bits; if (np) IN.any = true; if (np & 0x33) IN.dash = true; if (np & 1) IN._h.Enter = 1; if (np & 0x200) IN._h.Escape = 1;
      if (np & 0x1000) IN._h.ArrowUp = 1; if (np & 0x2000) IN._h.ArrowDown = 1; if (np & 0x4000) IN._h.ArrowLeft = 1; if (np & 0x8000) IN._h.ArrowRight = 1;
      if (bits & 0xc0) fire = true; } else IN._pad = 0;
    let l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; } IN.mvx = mx; IN.mvy = my;
    if (stick) { l = Math.hypot(ax, ay); IN.ax = ax / l; IN.ay = ay / l; IN.mode = 'stick'; fire = true; }
    IN.fire = fire; if (IN._h.Space || IN._h.ShiftLeft || IN._h.ShiftRight) IN.dash = true;
  }
};
(() => {
  const gesture = () => { try { BUS.emit('gesture'); } catch (e) { console.error(e); } };
  const release = () => { IN._d = {}; IN._mb = 0; for (const s of IN.sticks) { s.on = false; s.id = -1; } };
  // e.code is '' on some virtual keyboards: derive it from e.key for the keys the game uses
  const code = e => e.code || (e.key === ' ' ? 'Space' : /^[a-z]$/i.test(e.key) ? 'Key' + e.key.toUpperCase() : /^\d$/.test(e.key) ? 'Digit' + e.key : e.key || '');
  addEventListener('keydown', e => { if (e.metaKey || e.ctrlKey) return; const c = code(e); if (!IN._d[c]) { IN._hq[c] = 1; IN._aq = true; } IN._d[c] = 1; gesture();
    if (/^(Arrow|Space|Tab|Escape|Enter|Backspace)/.test(c)) e.preventDefault(); });
  // macOS swallows keyups of other keys while Cmd is held: releasing Meta clears everything to avoid stuck keys
  addEventListener('keyup', e => { if (e.key === 'Meta' || e.key === 'OS') IN._d = {}; else IN._d[code(e)] = 0; });
  addEventListener('blur', () => { release(); BUS.emit('blur'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { release(); BUS.emit('blur'); } else BUS.emit('visible'); });
  let lastTouch = -1e9;
  // e.buttons resyncs the held mask (a mouseup outside an iframe is never delivered); bit order: DOM buttons 1=L,2=R,4=M -> 1<<button
  const mm = e => { const p = IN.toFb(e.clientX, e.clientY); IN.mx = p[0]; IN.my = p[1]; IN.mode = 'mouse';
    if (performance.now() - lastTouch > 800) IN.touch = false;
    if (e.buttons != null) { const b = e.buttons; IN._mb = (b & 1) | (b & 4 ? 2 : 0) | (b & 2 ? 4 : 0); } };
  addEventListener('mousemove', mm);
  addEventListener('mousedown', e => { if (performance.now() - lastTouch < 800) return;   // compat mouse events after a touch
    mm(e); IN._mb |= 1 << e.button; if (e.button === 0) IN._cq = true; if (e.button === 2) IN._dq = true; IN._aq = true; gesture(); e.preventDefault(); });
  addEventListener('mouseup', e => { IN._mb &= ~(1 << e.button); });
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });          // trackpad pinch-zoom
  addEventListener('gesturestart', e => e.preventDefault());                                             // iOS Safari pinch
  // touch: each finger is owned by the stick of the half it STARTED on, by identifier, until it lifts (crossing the middle is fine);
  // extra fingers only move the pointer. touchcancel releases without producing a tap.
  const sweep = e => { if (e.touches) for (const s of IN.sticks) if (s.on && ![...e.touches].some(t => t.identifier === s.id)) { s.on = false; s.id = -1; } };
  const ts = e => { IN.touch = true; lastTouch = performance.now(); gesture(); sweep(e); for (const t of e.changedTouches) { const p = IN.toFb(t.clientX, t.clientY), s = IN.sticks[p[0] < W / 2 ? 0 : 1];
      IN.mx = p[0]; IN.my = p[1]; if (!s.on) { s.on = true; s.id = t.identifier; s.ox = s.x = p[0]; s.oy = s.y = p[1]; s.t0 = performance.now(); } } if (e.cancelable) e.preventDefault(); };
  const tm = e => { lastTouch = performance.now(); for (const t of e.changedTouches) for (const s of IN.sticks) if (s.on && s.id === t.identifier) { const p = IN.toFb(t.clientX, t.clientY); s.x = p[0]; s.y = p[1]; } if (e.cancelable) e.preventDefault(); };
  const te = (e, cancel) => { lastTouch = performance.now(); for (const t of e.changedTouches) for (let i = 0; i < 2; i++) { const s = IN.sticks[i]; if (s.on && s.id === t.identifier) { s.on = false; s.id = -1;
        if (!cancel && performance.now() - s.t0 < 250 && Math.hypot(s.x - s.ox, s.y - s.oy) < 8) { IN._cq = true; IN._aq = true; IN.mx = s.x; IN.my = s.y; if (i === 1) IN._dq = true; } } }
    // a lost touchend (e.g. finger lifted during a system gesture) would leave a stick stuck: drop sticks whose finger is gone
    sweep(e); if (e.cancelable) e.preventDefault(); };
  const o = { passive: false }; addEventListener('touchstart', ts, o); addEventListener('touchmove', tm, o); addEventListener('touchend', e => te(e, false), o); addEventListener('touchcancel', e => te(e, true), o);
})();
