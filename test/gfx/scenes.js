// test scenes for GFX — concatenated after kernel + 10-gfx.js inside the bundle scope
const TEST = (() => {
  const out = document.createElement('canvas'); out.width = W; out.height = H; out.id = 'out';
  CV.style.display = 'none'; document.body.appendChild(out);
  const zoom = +(new URLSearchParams(location.search).get('z') || 1);
  out.style.cssText = `width:${W * zoom}px;height:${H * zoom}px;image-rendering:pixelated;display:block`;
  const ctx = out.getContext('2d'), img = ctx.createImageData(W, H), u32 = new Uint32Array(img.data.buffer);
  const present = () => { u32.set(fb); ctx.putImageData(img, 0, 0); };
  const bg = () => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fb[y * W + x] = rgb(10 + (x >> 4 & 1) * 6, 12, 22 + (y >> 4 & 1) * 6); };
  const scenes = {
    font1() {
      GFX.clear(C.dark); let y = 2;
      let s = ''; for (let c = 32; c < 127; c++) s += String.fromCharCode(c);
      GFX.text(s.slice(0, 48), 2, y, C.white); GFX.text(s.slice(48), 2, y + 10, C.white);
      let e = ''; for (let c = 127; c < 148; c++) e += String.fromCharCode(c); GFX.text(e, 2, y + 20, C.yellow);
      GFX.text('0O 1lI| 5S 2Z 8B rn m ;: ,. `\' "" {}[]() <> ~-_= #*', 2, 34, C.cyan);
      GFX.text("LIVE.def('wpn.fire', 'p,ax,ay', `const RATE=6, N=1, SPREAD=.12;`);\nfor (let i = 0; i < N; i++) { GAME.shoot(p.x, p.y, ax*SPD, ay*SPD, {dmg:DMG}); }\nif (x !== y && a[i] >= 0x7f || !ok) return fn?.(e) ?? null; // comment\n- old line: const DMG=1;\n+ new line: const DMG=2;  — 0xDEAD: INVERT_AXIS … ♥☠→█", 2, 46, C.green);
      GFX.text('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789\nthe quick brown fox jumps over the lazy dog: glyph jpqy', 2, 90, C.white);
      GFX.text(s.slice(0, 40), 2, 112, C.white, 2); GFX.text(s.slice(40, 80), 2, 132, C.white, 2); GFX.text(s.slice(80) + e, 2, 152, C.orange, 2);
      GFX.text('SCALE 1.5 TEXT 0123', 2, 174, C.magenta, 1.5);
      GFX.textC('CENTERED\nMULTI LINE', 240, 192, C.white); GFX.textR('RIGHT ALIGNED\nok', 478, 192, C.yellow);
      GFX.textO('OUTLINED TEXT', 2, 215, C.white, 2, C.red);
      GFX.textS('SHADOW', 300, 215, C.cyan, 2, C.blue);
      GFX.text('clipped edge text ->>>>>', 400, 240, C.white); GFX.text('<<<< clipped', -30, 240, C.white); GFX.text('BOTTOM CLIP', 200, 266, C.white);
    },
    fontfx() {
      bg();
      GFX.textFx('SELF.MOD', 20, 10, 7, (x, y, u, v) => GFX.hsv(.55 + u * .4 + v * .1, .8, 1 - v * .5));
      GFX.textFx('SELF.MOD', 20, 80, 5, (x, y, u, v) => (y & 1) ? GFX.mix(C.yellow, C.red, v) : GFX.mix(C.white, C.orange, v));
      GFX.textFx('Rg@%&/\\0', 20, 140, 6, (x, y, u, v) => GFX.mix(C.cyan, C.magenta, u));
      GFX.textFx('XWAVY13', 20, 200, 4, C.green);
      GFX.textFx('xyz', 300, 200, 3, C.white);
    },
    prims() {
      bg();
      GFX.rect(4, 4, 40, 20, C.red); GFX.rectA(24, 14, 40, 20, C.cyan, .5); GFX.frame(70, 4, 40, 20, C.yellow); GFX.frame(115, 4, 1, 1, C.white); GFX.rectAdd(120, 4, 30, 20, rgb(80, 80, 0));
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; GFX.line(200, 40, 200 + Math.cos(a) * 34, 40 + Math.sin(a) * 34, GFX.hsv(i / 24, 1, 1)); }
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; GFX.lineA(290, 40, 290 + Math.cos(a) * 34, 40 + Math.sin(a) * 34, rgb(90, 40, 20)); }
      for (let r = 1; r <= 8; r++) { GFX.circ(10 + r * r * 1.2 + r * 6, 70, r, C.white); GFX.disc(10 + r * r * 1.2 + r * 6, 95, r, C.cyan); }
      GFX.circ(140, 82, 14.5, C.yellow); GFX.disc(180, 82, 14.5, C.magenta); GFX.circA(220, 82, 14, C.green, 3); GFX.discA(228, 88, 10, rgb(100, 0, 100));
      GFX.tri(250, 70, 300, 100, 260, 110, C.orange); GFX.tri(300, 70, 350, 70, 325, 110, C.blue); GFX.triA(320, 80, 370, 100, 330, 115, rgb(120, 120, 0));
      // glows
      const cols = [C.cyan, C.magenta, C.yellow, C.red, C.green, C.orange, C.blue, C.white];
      for (let i = 0; i < 8; i++) GFX.glow(30 + i * 55, 150, 6 + i * 3, cols[i]);
      for (let i = 0; i < 8; i++) { GFX.glow(30 + i * 55, 200, 14, cols[i], .5); GFX.disc(30 + i * 55, 200, 2, C.white); }
      GFX.glowLine(20, 235, 460, 225, C.red, 4); GFX.line(20, 235, 460, 225, C.white);
      GFX.glowLine(400, 90, 470, 130, C.cyan, 3);
      GFX.glowLine(380, 20, 390, 110, C.green, 2.5);
      GFX.bolt(20, 255, 460, 255, C.cyan, 6); GFX.pDraw();
      GFX.boltNow(400, 20, 440, 80, C.magenta, 8, 7);
    },
    shapes() {
      bg(); let i = 0;
      for (const k in GFX.SH) { const x = 30 + (i % 8) * 58, y = 30 + (i / 8 | 0) * 70;
        GFX.shape(GFX.SH[k], x, y, 0, 18, C.white); GFX.text(k, x - 20, y + 22, C.dim);
        GFX.fill(GFX.SH[k], x, y + 150, S.t, 12, GFX.hsv(i / 16, .8, .9)); GFX.shapeG(GFX.SH[k], x + 0, y + 150, 0, 14, C.cyan);
        i++; }
      GFX.shapeG(GFX.SH.ship, 440, 130, -.6, 20, C.green);
      let j = 0; for (const k in GFX.SPR) { const x = 30 + j * 40; GFX.spr(k, x, 125, 0, 1); GFX.spr(k, x, 145, .5, 2, C.orange); GFX.spr(k, x + 15, 125, 0, 1, C.white, 2); j++; }
      GFX.sprDef('test', 8, 4, (x, y) => (x + y) & 1 ? C.red : 0); GFX.spr('test', 340, 145, .3, 3);
    },
    parts() {
      bg(); GFX.pClear();
      GFX.burst(80, 100, 120, C.orange, 120, .8, { grav: 80 });
      GFX.burst(200, 100, 200, C.cyan, 200, .6, { size: 2.5, c2: C.white });
      GFX.burst(330, 100, 60, C.magenta, 160, .7, { spread: .8, ang: -PI / 2, size: 1.5 });
      GFX.ring(420, 100, 4, 50, C.yellow, .6); GFX.ring(420, 200, 2, 30, C.cyan, .4);
      GFX.floatText('+1250', 80, 200, C.yellow); GFX.floatText('x8 COMBO', 200, 200, C.magenta, 1.2); GFX.floatText('CRIT!', 300, 200, C.red);
      for (let k = 0; k < 40; k++) GFX.spark(20 + k * 11, 250, 0, -60 - k, GFX.hsv(k / 40, 1, 1), 1, 1 + (k & 3));
      for (let f = 0; f < 12; f++) GFX.pUpdate(1 / 60);
      GFX.bolt(20, 160, 150, 170, C.cyan); GFX.bolt(150, 170, 250, 150, C.white, 10); GFX.bolt(260, 140, 460, 20, C.magenta, 8); GFX.pUpdate(1/60);
      GFX.pDraw();
      GFX.text('particles: ' + GFX.pCount(), 2, 2, C.white);
    }
  };
  return { scenes, present, run(n) { scenes[n](); present(); return true; } };
})();
window.TEST = TEST; window.GFX = GFX; window.__K = { fb, S, W, H, rgb, C };
