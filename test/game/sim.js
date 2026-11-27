// injected into the page: bot + simulation driver
window.__sim = function (frames, opt = {}) {
  const { S, LIVE, PATCH, ENT, SCENE, IN, RUN, BUS } = window.__SM, { GAME, POST } = window.__G;
  const out = { errs: [], nan: 0, maxEnt: 0, maxE: 0, maxP: 0, maxEs: 0, panics: 0, died: false, kills: {}, ms: 0 };
  const onPanic = (e, en) => { out.panics++; out.errs.push('PANIC ' + en.name + ' ' + (e && e.message)); };
  BUS._h.panic = (BUS._h.panic || []).concat([onPanic]);
  const onKill = (e, src) => { if (e.team === 1) out.kills[e.type] = (out.kills[e.type] || 0) + 1; };
  BUS._h.kill = (BUS._h.kill || []).concat([onKill]);
  const t0 = performance.now(), dt = 1 / 60;
  for (let f = 0; f < frames; f++) {
    S.dt = dt; S.t += dt; S.frame++; S.shake *= .9; S.flash *= .9;
    const p = S.player;
    // ---- bot ----
    IN.mode = 'stick'; IN.fire = opt.fire !== false; IN.dash = false; IN.click = false;
    if (p && !p.dead) {
      let tgt = null, bd = 1e9; ENT.each(1, e => { if (e.warp > 0) return; const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (d < bd) { bd = d; tgt = e; } });
      if (tgt) { const dx = tgt.x - p.x, dy = tgt.y - p.y, l = Math.hypot(dx, dy) || 1; IN.ax = dx / l; IN.ay = dy / l; }
      let mx = (240 - p.x) * .004, my = (141 - p.y) * .004;
      if (opt.passive) { mx = 0; my = 0; }
      else {
        ENT.each(1, e => { if (e.warp > 0) return; const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1; const want = opt.aggro ? 30 : 70; if (d < want) { mx += dx / d * (want - d) / want * 2; my += dy / d * (want - d) / want * 2; } else if (opt.aggro && e.type === 'mutator') { mx -= dx / d * .8; my -= dy / d * .8; } });
        let danger = 0;
        ENT.each(3, b => { const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1; if (d < 40) { const k = (40 - d) / 40; mx += dx / d * k * 3; my += dy / d * k * 3; if (d < 12) danger++; } });
        if (danger && p.dashCd <= 0) IN.dash = true;
        if (opt.dashSpam && f % 30 === 0) IN.dash = true;
      }
      const l = Math.hypot(mx, my); IN.mvx = l > 1 ? mx / l : mx; IN.mvy = l > 1 ? my / l : my;
    }
    try { SCENE.cur.update(dt); SCENE.cur.draw(dt); } catch (e) { out.errs.push(String(e && e.stack || e).slice(0, 300)); LIVE.panic(e); if (out.errs.length > 20) break; }
    if (SCENE.name !== 'play') { out.scene = SCENE.name; if (opt.stopOnOver) break; RUN.start(); }
    if (f % 10 === 0) {
      let ne = 0, np = 0, nes = 0;
      for (const e of ENT.list) { if (!(Number.isFinite(e.x) && Number.isFinite(e.y))) { out.nan++; if (out.nan < 4) out.errs.push('NaN ' + e.type + ' team ' + e.team); } if (e.team === 1) ne++; else if (e.team === 2) np++; else if (e.team === 3) nes++; }
      out.maxEnt = Math.max(out.maxEnt, ENT.list.length); out.maxE = Math.max(out.maxE, ne); out.maxP = Math.max(out.maxP, np); out.maxEs = Math.max(out.maxEs, nes);
    }
    if (p && p.dead) out.died = true;
  }
  out.ms = (performance.now() - t0) / frames;
  BUS._h.panic = BUS._h.panic.filter(h => h !== onPanic); BUS._h.kill = BUS._h.kill.filter(h => h !== onKill);
  POST.present(dt);
  out.score = S.score; out.hp = S.player && S.player.hp; out.mult = S.mult;
  return out;
};
