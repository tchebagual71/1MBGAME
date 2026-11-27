// ===== 70-post.js : POST — WebGL CRT presenter (live-generated shader) with Canvas2D fallback =====
const POST = (() => {
  const BW = 240, BH = 135;                                  // bloom buffer size (half res)
  const u8 = new Uint8Array(fb.buffer, fb.byteOffset, fb.length * 4);
  const st = { mode: 'none', cpu: 0, frames: 0, compiles: 0, fails: 0, lost: 0 };
  let cv = null, gl = null, lost = false, lastGen = -1, wasCrt = true, kickPhos = true;
  let vbo = null, tSrc = null, tP = [null, null], fP = [null, null], tB = [null, null], fB = [null, null], pp = 0;
  let pDown = null, pBlur = null, pBasic = null;
  const live = { 0: { src: null, p: null }, 1: { src: null, p: null }, phos: { src: null, p: null } };
  let c2 = null, off = null, offC = null, img = null;       // 2D fallback

  // ---------- live shader sources (the player can read and patch these) ----------
  LIVE.def('post.frag', 'CRT', `const CURV=.011, SCAN=.52, MASK=.18, BEAM=.55, BLOOM=.34, CA=.45, VIG=.22, NOISE=.020, FLICK=.008, GAIN=1.04;
const GLITCH=1, HSYNC=0, ROLL=0, SWAP='rgb';
const f = v => (+v).toFixed(4);
return \`#define CRT \${CRT ? 1 : 0}
const float CURV=\${f(CURV)}, SCAN=\${f(SCAN)}, MASK=\${f(MASK)}, BEAM=\${f(BEAM)}, BLOOM=\${f(BLOOM)};
const float CA=\${f(CA)}, VIG=\${f(VIG)}, NOISE=\${f(NOISE)}, FLICK=\${f(FLICK)}, GAIN=\${f(GAIN)};
const float GLITCH=\${f(GLITCH)}, HSYNC=\${f(HSYNC)}, ROLL=\${f(ROLL)};
void main() {
  vec2 o = gl_FragCoord.xy / uOut;
  vec2 c = vec2(o.x * 2. - 1., 1. - o.y * 2.) * (1. - .006 * uBeat);
  float r2 = dot(c, c);
#if CRT
  c *= 1. + CURV * r2;                         // barrel
#endif
  vec2 q = c * .5 + .5, p = q * RES + uShake;  // fb pixel coords, row 0 on top
  p.x += HSYNC * (sin(p.y * .05 + uTime * 6.) * 2.5 + step(.93, sin(p.y * .011 - uTime * 1.9)) * 11.);
  p.y = mod(p.y + ROLL * uTime * 9., RES.y);
  float scan = fract(p.y), sp, bu;
#if CRT
  p = glitch(p, uGlitch * GLITCH, sp, bu);
  vec2 ca = c * CA * r2 * .5 + vec2(sp, 0.);
#else
  p = glitch(p, uGlitch * GLITCH * .6, sp, bu);
  vec2 ca = vec2(sp, 0.);
#endif
  vec3 col = vec3(img(p + ca).r, img(p).g, img(p - ca).b);
  float edge = 1.;
#if CRT
  float lum = dot(col, vec3(.299, .587, .114)), k = uScale.y;
  float a = SCAN * smoothstep(2., 3.6, k) * sinc(1. / k);
  float w = (1. - a * .5 * (1. + cos(6.2832 * scan))) / (1. - .5 * a);
  vec3 m = grille(gl_FragCoord.xy, MASK * smoothstep(3., 5., k));
  col *= mix(w * m, vec3(1.), smoothstep(.3, 1., lum) * BEAM);
  col += texture2D(uBloom, p / RES).rgb * BLOOM;
  col *= (1. - VIG * r2 * r2 * .25) * (1. + FLICK * sin(uTime * 83.)) * GAIN;
  col += (hash(gl_FragCoord.xy + fract(uTime * 7.) * 431.) - .5) * NOISE;
  edge = corner(q);
#endif
  col = mix(col, vec3(hash(floor(gl_FragCoord.xy / 2.) + fract(uTime) * 97.)), bu * .45);
  col = col * (1. + .01 * uBeat) + uFlash;
  gl_FragColor = vec4(col.\${SWAP} * edge, 1.);
}\`;`);

  LIVE.def('post.phos', '', `const DECAY=.28;   // phosphor persistence per 60 Hz frame
return \`const float DECAY=\${(+DECAY).toFixed(4)};
void main() {
  vec2 uv = gl_FragCoord.xy / RES;
  vec3 s = texture2D(uImg, uv).rgb, o = texture2D(uBloom, uv).rgb * pow(DECAY, uK);
  gl_FragColor = vec4(max(s, o), 1.);
}\`;`);

  PATCH.def({ id: 'post.hsync', name: '0x15C0: HSYNC_LOSS', kind: 'bug', weight: 1,
    desc: 'post.frag  HSYNC=0 -> HSYNC=1 : horizontal sync drifts, raster wobbles and tears',
    apply() { return LIVE.patch('post.frag', 'HSYNC=0,', 'HSYNC=1,'); } });
  PATCH.def({ id: 'post.swap', name: '0xC0DE: CHANNEL_SWAP', kind: 'bug', weight: 1,
    desc: "post.frag  SWAP='rgb' -> SWAP='bgr' : red and blue guns cross-wired",
    apply() { return LIVE.patch('post.frag', "SWAP='rgb'", "SWAP='bgr'"); } });
  PATCH.def({ id: 'post.ghost', name: '0x9E05: PHOSPHOR_LEAK', kind: 'bug', weight: .8,
    desc: 'post.phos  DECAY=.28 -> DECAY=.86 : phosphor never lets go, everything leaves ghosts',
    can() { return S.opt.crt !== false; },
    apply() { return LIVE.patch('post.phos', 'DECAY=.28', 'DECAY=.86'); } });

  // ---------- static GLSL ----------
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform sampler2D uImg, uBloom;\nuniform vec2 uOut, uScale, uShake, uSz, uDir;\nuniform float uTime, uFlash, uGlitch, uBeat, uK;\n' +
    'const vec2 RES = vec2(' + W + '., ' + H + '.);\n';
  const LIB = `
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sinc(float x) { x *= 3.14159; return x < .001 ? 1. : sin(x) / x; }
vec2 sharp(vec2 p) { vec2 fi = floor(p), d = p - fi - .5, rr = .5 - .5 / uScale; d = (d - clamp(d, -rr, rr)) * uScale + .5; return (fi + d) / RES; }
vec3 img(vec2 p) { vec2 uv = sharp(p); vec2 s = step(vec2(0.), uv) * step(uv, vec2(1.)); return texture2D(uImg, uv).rgb * s.x * s.y; }
vec3 grille(vec2 fc, float m) { float t = mod(floor(fc.x), 3.);
  vec3 g = vec3(t < .5 ? 1. : 1. - m, abs(t - 1.) < .5 ? 1. : 1. - m, t > 1.5 ? 1. : 1. - m); return g / (1. - 2. * m / 3.); }
float corner(vec2 q) { float rad = .035 * uOut.y; vec2 hp = abs(q - .5) * uOut, hs = .5 * uOut - rad;
  return clamp(.5 - (length(max(hp - hs, 0.)) - rad), 0., 1.); }
vec2 glitch(vec2 p, float g, out float sp, out float bu) {
  sp = 0.; bu = 0.;
  if (g < .002) return p;
  float ts = floor(uTime * 14.);
  float bh = 2. + floor(hash(vec2(ts, 1.7)) * 14.), band = floor(p.y / bh);
  float k = step(1. - .6 * g * sqrt(g), hash(vec2(band, ts)));                       // torn bands
  p.x += k * (hash(vec2(band, ts + 5.3)) - .5) * (3. + 70. * g * g);
  p.x += (hash(vec2(floor(p.y), floor(uTime * 60.))) - .5) * g * g * 2.5;          // line jitter
  vec2 blk = floor(p / vec2(24., 10.));
  if (hash(blk + vec2(ts * 1.37, ts * .71)) < .2 * g * g)                            // block displacement
    p += floor((vec2(hash(blk + 1.3), hash(blk + 2.1)) - .5) * vec2(48., 12.));
  float burst = step(1. - .3 * g * g * g, hash(vec2(floor(uTime * 5.), 9.1)));      // roll + static burst
  p.y = mod(p.y + burst * fract(uTime * 5.) * RES.y * .4 * g, RES.y);
  bu = burst * g;
  sp = g * (.8 + 5. * g) * (hash(vec2(ts, 4.2)) < .5 ? -1. : 1.) + k * g * 3.;
  return p;
}
`;
  const VS = 'attribute vec2 aP;\nvoid main() { gl_Position = vec4(aP, 0., 1.); }';
  const DOWN = HEAD + `void main() { vec3 c = texture2D(uImg, gl_FragCoord.xy / uSz).rgb;
  gl_FragColor = vec4(c * c * (.6 + .4 * c), 1.); }`;
  const BLUR = HEAD + `void main() { vec2 uv = gl_FragCoord.xy / uSz, d = uDir / uSz;
  vec3 c = texture2D(uImg, uv).rgb * .227 + (texture2D(uImg, uv + d * 1.385).rgb + texture2D(uImg, uv - d * 1.385).rgb) * .316
    + (texture2D(uImg, uv + d * 3.231).rgb + texture2D(uImg, uv - d * 3.231).rgb) * .0703;
  gl_FragColor = vec4(c, 1.); }`;
  const BASIC = HEAD + LIB + `void main() { vec2 o = gl_FragCoord.xy / uOut; vec2 p = vec2(o.x, 1. - o.y) * RES + uShake;
  gl_FragColor = vec4(img(p) + uFlash, 1.); }`;
  const UNI = ['uImg', 'uBloom', 'uOut', 'uScale', 'uShake', 'uSz', 'uDir', 'uTime', 'uFlash', 'uGlitch', 'uBeat', 'uK'];

  // ---------- GL helpers ----------
  function shader(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { st.log = gl.getShaderInfoLog(s); gl.deleteShader(s); return null; } return s; }
  function program(fsrc) {
    const v = shader(gl.VERTEX_SHADER, VS), f = v && shader(gl.FRAGMENT_SHADER, fsrc); st.compiles++;
    if (!f) { if (v) gl.deleteShader(v); st.fails++; return null; }
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { st.log = gl.getProgramInfoLog(p); gl.deleteProgram(p); st.fails++; return null; }
    const P = { p, u: {} }; gl.useProgram(p); for (const n of UNI) P.u[n] = gl.getUniformLocation(p, n);
    gl.uniform1i(P.u.uImg, 0); gl.uniform1i(P.u.uBloom, 1); return P;
  }
  function tex(w, h) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); return t; }
  function fbo(t) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return ok ? f : null; }

  function setupGL() {
    live[0] = { src: null, p: null }; live[1] = { src: null, p: null }; live.phos = { src: null, p: null }; lastGen = -1; kickPhos = true;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER);
    vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    tSrc = tex(W, H);
    for (let i = 0; i < 2; i++) { tP[i] = tex(W, H); fP[i] = fbo(tP[i]); tB[i] = tex(BW, BH); fB[i] = fbo(tB[i]); }
    pDown = program(DOWN); pBlur = program(BLUR); pBasic = program(BASIC);
    return !!pBasic;
  }
  // (re)compile live programs when their source text changed; a broken patch keeps the old program
  function liveProg(key, name, arg) {
    const e = live[key], s = LIVE.src[name];
    if (e.src !== s) { e.src = s; let txt = null; try { txt = LIVE.fn[name](arg); } catch (err) { }
      const P = typeof txt === 'string' ? program(HEAD + LIB + txt) : null;
      if (P) { if (e.p) gl.deleteProgram(e.p.p); e.p = P; } else if (!P && typeof txt !== 'string') st.fails++; }
    return e.p;
  }
  function pass(P, f, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.viewport(0, 0, w, h); gl.useProgram(P.p); return P.u; }
  function bind(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

  function sizeCanvas() { if (cv && (cv.width !== VIEW.w || cv.height !== VIEW.h)) { cv.width = VIEW.w; cv.height = VIEW.h; } }

  function init(canvas) {
    cv = canvas || CV; sizeCanvas();
    BUS.on('resize', sizeCanvas);
    const opt = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    for (const m of ['webgl2', 'webgl', 'experimental-webgl']) { try { gl = cv.getContext(m, opt); } catch (e) { gl = null; } if (gl) { st.mode = m === 'experimental-webgl' ? 'webgl' : m; break; } }
    if (gl) {
      cv.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; st.lost++; }, false);
      cv.addEventListener('webglcontextrestored', () => { lost = false; try { setupGL(); } catch (e) { } }, false);
      let ok = false; try { ok = setupGL(); } catch (e) { ok = false; }
      if (!ok && !gl.isContextLost()) { st.mode = 'none'; gl = null; }
      return st.mode;
    }
    try { c2 = cv.getContext('2d', { alpha: false }); } catch (e) { c2 = null; }
    if (c2) { off = document.createElement('canvas'); off.width = W; off.height = H; offC = off.getContext('2d');
      img = new ImageData(new Uint8ClampedArray(fb.buffer, fb.byteOffset, fb.length * 4), W, H); st.mode = '2d'; }
    return st.mode;
  }

  function presentGL(dt) {
    const crt = S.opt.crt !== false, ow = cv.width, oh = cv.height;
    if (LIVE.gen !== lastGen || crt !== wasCrt) { lastGen = LIVE.gen; liveProg(crt ? 1 : 0, 'post.frag', crt ? 1 : 0); if (crt) liveProg('phos', 'post.phos'); }
    const M = live[crt ? 1 : 0].p || pBasic;
    bind(0, tSrc); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, u8);
    let image = tSrc;
    if (crt && pDown && pBlur && fB[0] && fB[1]) {
      const PH = live.phos.p;
      if (PH && fP[0] && fP[1]) {
        if (!wasCrt) kickPhos = true;
        const u = pass(PH, fP[pp ^ 1], W, H); bind(1, tP[pp]);
        gl.uniform1f(u.uK, kickPhos ? 99 : clamp(dt * 60, .2, 4)); gl.drawArrays(gl.TRIANGLES, 0, 3);
        pp ^= 1; image = tP[pp]; kickPhos = false;
      }
      let u = pass(pDown, fB[0], BW, BH); bind(0, image); gl.uniform2f(u.uSz, BW, BH); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(pBlur.p); gl.uniform2f(pBlur.u.uSz, BW, BH);
      for (let i = 0; i < 2; i++) { const r = i ? 2.2 : 1;            // two separable gaussian iterations, second one wider
        u = pass(pBlur, fB[1], BW, BH); bind(0, tB[0]); gl.uniform2f(u.uDir, r, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        u = pass(pBlur, fB[0], BW, BH); bind(0, tB[1]); gl.uniform2f(u.uDir, 0, r); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    }
    wasCrt = crt;
    const u = pass(M, null, ow, oh); bind(0, image); bind(1, tB[0]);
    const sh = S.shake > .05 ? S.shake : 0, an = Math.random() * TAU, sm = sh * (.6 + .4 * Math.random());
    gl.uniform2f(u.uOut, ow, oh); gl.uniform2f(u.uScale, Math.max(1, ow / W), Math.max(1, oh / H));
    gl.uniform2f(u.uShake, Math.cos(an) * sm, Math.sin(an) * sm);
    gl.uniform1f(u.uTime, S.t % 3600); gl.uniform1f(u.uFlash, clamp(S.flash || 0, 0, 1)); gl.uniform1f(u.uGlitch, clamp(S.glitch || 0, 0, 1)); gl.uniform1f(u.uBeat, clamp(S.beat || 0, 0, 1));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function present2D() {
    const w = cv.width, h = cv.height, sx = w / W, sy = h / H;
    offC.putImageData(img, 0, 0);
    c2.imageSmoothingEnabled = false; c2.fillStyle = '#000'; c2.fillRect(0, 0, w, h);
    const sh = S.shake > .05 ? S.shake : 0, an = Math.random() * TAU, dx = Math.round(Math.cos(an) * sh * sx), dy = Math.round(Math.sin(an) * sh * sy);
    c2.drawImage(off, dx, dy, w, h);
    const g = clamp(S.glitch || 0, 0, 1), n = g > .05 ? Math.round(g * g * 10 + Math.random() * g * 3) : 0;
    for (let i = 0; i < n; i++) { const y = Math.random() * H | 0, bh = 1 + Math.random() * 12 | 0, o = (Math.random() - .5) * (4 + 60 * g * g);
      c2.drawImage(off, 0, y, W, bh, Math.round(dx + o * sx), Math.round(dy + y * sy), w, Math.ceil(bh * sy)); }
    const fl = clamp(S.flash || 0, 0, 1);
    if (fl > .01) { c2.globalAlpha = fl; c2.fillStyle = '#fff'; c2.fillRect(0, 0, w, h); c2.globalAlpha = 1; }
  }

  function present(dt) {
    if (!cv) return;
    const t0 = performance.now();
    try { sizeCanvas();
      if (gl) { if (!lost && !gl.isContextLost()) presentGL(dt || S.dt || 1 / 60); }
      else if (c2) present2D();
    } catch (e) { st.err = String(e); }
    const ms = performance.now() - t0; st.cpu = st.frames++ ? st.cpu * .95 + ms * .05 : ms;
  }

  return { init, present, stats: st, get mode() { return st.mode; } };
})();
