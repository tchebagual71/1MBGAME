// test stub AU: records calls, fake 120bpm beat
const AU = (() => {
  let bt = 0; const log = { music: [], sfx: {}, intensity: 0 };
  return { log, level: 0, init() { }, mute() { },
    update(dt) { bt += dt; S.beat = Math.max(0, S.beat - dt * 4); if (bt >= .5) { bt -= .5; S.beat = 1; S.step++; } },
    music(n) { log.music.push(n); }, intensity(x) { if (!(x >= 0 && x <= 1)) throw new Error('bad intensity ' + x); log.intensity = x; },
    sfx(n) { log.sfx[n] = (log.sfx[n] || 0) + 1; } };
})();
