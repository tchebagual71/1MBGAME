const UI = (() => ({ banner() { },
  hud() { const p = S.player; if (!p) return; GFX.rectA(0, 0, W, 16, C.black, .7);
    for (let i = 0; i < p.maxhp; i++) GFX.rect(4 + i * 7, 4, 5, 7, i < p.hp ? C.red : C.dim);
    GFX.text('SCORE ' + S.score + '  x' + S.mult + ' (' + S.combo + ')  BUGS:' + PATCH.bugs().map(id => PATCH.all[id].name).join(','), 60, 4, C.white);
    GFX.rect(4, 13, 40 * (1 - p.dashCd / p.dashMax), 2, C.cyan); },
  overlay() { } }))();
SCENE.def('title', { update() { }, draw() { } });
