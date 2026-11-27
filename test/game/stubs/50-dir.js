// test DIR: cycles through every enemy type, keeps the arena busy
const DIR = (() => { window.__G = { get GAME() { return GAME; }, get GFX() { return GFX; }, get AU() { return AU; }, get POST() { return POST; }, get FX() { return FX; }, get DIR() { return DIR; } }; let t = 0, i = 0; const D = { on: true, max: 24, only: null, state: { phase: 'wave' }, sectors: [],
  reset() { t = 0; i = 0; S.diff = 1; },
  update(dt) { if (!D.on) return; t -= dt; const n = ENT.count(T_ENEMY);
    if (t <= 0 && n < D.max) { t = .35; const types = D.only || GAME.enemyTypes; const ty = types[i++ % types.length];
      const side = rndi(4), x = side === 0 ? 20 : side === 1 ? 460 : rndr(20, 460), y = side === 2 ? 30 : side === 3 ? 250 : rndr(30, 250);
      if (ty === 'mutator' && ENT.list.some(e => e.type === 'mutator' && !e.dead)) return;
      GAME.spawnEnemy(ty, x, y); } } }; return D; })();
