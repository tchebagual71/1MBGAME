const AU = (() => { const log = []; let t = 0;
  return { log, level: 0, init() { }, update(dt) { t += dt; const b = (t * 2) % 1; S.beat = Math.max(0, 1 - b * 4); S.step = (t * 8) | 0; S.bar = (t / 2) | 0; },
    music(n) { log.push('music:' + n); }, intensity() { }, sfx(n) { log.push('sfx:' + n); if (log.length > 400) log.splice(0, 200); }, mute() { } }; })();
