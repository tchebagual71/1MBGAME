const AU = (() => { const counts = {}; return { counts, level: 0, init() { }, update(dt) { S.beat = Math.max(0, S.beat - dt * 4); if ((S.t * 2 | 0) !== ((S.t - dt) * 2 | 0)) S.beat = 1; },
  music() { }, intensity() { }, mute() { }, sfx(n) { counts[n] = (counts[n] || 0) + 1; } }; })();
