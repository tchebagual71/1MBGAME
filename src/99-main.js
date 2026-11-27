// ===== 99-main.js : run control, play scene, main loop =====
const RUN = {
  deadT: 0,
  start() {
    PATCH.reset(); ENT.clear();
    S.score = 0; S.combo = 0; S.mult = 1; S.sector = 0; S.wave = 0; S.diff = 1; S.kills = 0; S.runTime = 0; S.shake = 0; S.flash = 0; S.glitch = 0; S.boss = null; S.player = null; RUN.deadT = 0;
    GAME.reset(); DIR.reset();
    for (const id of S.genome.ids) PATCH.apply(id);          // inherited mutations from an exported build
    SCENE.go('play', 'new');
  },
  // genome of the build you would export right now
  genome() { const ids = []; for (const id of PATCH.active) if (PATCH.all[id].kind === 'up' && ids.length < 4 && !ids.includes(id)) ids.push(id); return { gen: S.genome.gen + 1, ids, hi: Math.max(S.hi, S.score) }; },
  export() { return SELF.export(RUN.genome()); },
  saveHi() { if (S.score > S.hi) { S.hi = S.score; STORE.set('hi', S.hi); return true; } return false; }
};

SCENE.def('play', {
  update(dt) {
    if (IN.hit('Escape') || IN.hit('KeyP')) { if (!RUN.deadT) return SCENE.go('pause'); }
    S.runTime += dt;
    DIR.update(dt); GAME.update(dt);
    if (RUN.deadT) { RUN.deadT -= dt; if (RUN.deadT <= 0) { RUN.deadT = 0; RUN.saveHi(); SCENE.go('over'); } }
  },
  draw(dt) { FX.draw(dt); GAME.draw(); UI.hud(dt); }
});
BUS.on('player:dead', () => { if (!RUN.deadT) RUN.deadT = 1.6; });
BUS.on('run:win', () => { RUN.saveHi(); SCENE.go('win'); });
BUS.on('blur', () => { if (SCENE.name === 'play' && !RUN.deadT) SCENE.go('pause'); });

(() => {
  // inherited genome: sanitised; ids that no longer exist (or are not upgrades) are dropped
  try { const g = window.__GENOME; if (g && typeof g === 'object') { const n = SELF.norm(g); n.ids = n.ids.filter(id => PATCH.all[id] && PATCH.all[id].kind === 'up').slice(0, 4); S.genome = n; } } catch (e) { }
  window.__SM = { S, LIVE, PATCH, ENT, SCENE, IN, RUN, BUS, fb, GFX, FX, AU, GAME, DIR, UI, POST };   // debug/test handle
  S.hi = Math.max(STORE.get('hi', 0), S.genome.hi);
  fit(); POST.init(CV);
  BUS.on('gesture', () => AU.init());
  SCENE.go(SCENE.all.boot ? 'boot' : 'title');
  let last = performance.now(), errN = 0, pErr = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(.05, Math.max(.001, (now - last) / 1000)); last = now;
    S.dt = dt; S.t += dt; S.frame++;
    S.shake = S.shake > .05 ? S.shake * Math.pow(.002, dt) : 0; S.flash = S.flash > .01 ? S.flash * Math.pow(.001, dt) : 0;
    try { IN.poll(); } catch (e) { console.error(e); }
    if (IN.hit('KeyM')) { S.opt.mute = !S.opt.mute; AU.mute(S.opt.mute); }
    if (IN.hit('KeyF')) SELF.fullscreen();
    if (IN.hit('KeyC')) S.opt.crt = !S.opt.crt;
    try { AU.update(dt); SCENE.cur.update(dt); SCENE.cur.draw(dt); UI.overlay(dt); errN = 0; }
    catch (e) { if (!LIVE.panic(e) && ++errN > 120) { errN = 0; try { SCENE.go('title'); } catch (e2) { } } }   // self-heal: roll back the guilty patch
    try { POST.present(dt); } catch (e) { if (!pErr) console.error(e); pErr = true; }
  }
  requestAnimationFrame(frame);
})();
