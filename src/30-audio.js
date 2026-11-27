// ===== 30-audio.js : AU — procedural softsynth, tracker and sfx. Zero samples, zero worklets. =====
// Music is synthesized in JS on the main thread, in small chunks, into AudioBuffers that are scheduled ~0.3 s ahead.
// The sequencer (pattern generators = LIVE 'mu.*' functions) also runs on a virtual clock when there is no audio,
// so S.beat / S.bar / S.step always tick. SFX are pre-rendered (lazily) into AudioBuffers and fired instantly.
const AU = (() => {
  const LOOK = .32, CHUNK = 1024, BLK = 64;
  const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
  let nseed = 0x2545F491;                                                    // audio-only noise RNG (not gameplay)
  const nrand = () => { nseed ^= nseed << 13; nseed ^= nseed >>> 17; nseed ^= nseed << 5; return (nseed >>> 0) / 2147483648 - 1; };
  const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
  const m2f = n => 440 * Math.pow(2, (n - 69) / 12);

  // ---------------------------------------------------------------- notation parsing
  const PCL = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const QUAL = { '': [0, 4, 7], m: [0, 3, 7], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], 7: [0, 4, 7, 10], sus4: [0, 5, 7], sus2: [0, 2, 7],
    dim: [0, 3, 6], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], m6: [0, 3, 7, 9] };
  const acc = s => s === '#' ? 1 : s === 'b' ? -1 : 0;
  function note(t) { const m = /^([a-g])([#b]?)(\d)$/.exec(t); return m ? PCL[m[1]] + acc(m[2]) + (+m[3] + 1) * 12 : -1; }
  function chord(t) { const m = /^([A-G])([#b]?)(.*)$/.exec(t); if (!m) return { r: 48, n: QUAL[''], name: t };
    return { r: 48 + (PCL[m[1].toLowerCase()] + acc(m[2]) + 12) % 12, n: QUAL[m[3]] || QUAL[''], name: t }; }
  const prog = s => s.trim().split(/\s+/).map(b => b.split(',').map(chord));
  const mel = s => s.trim().split(/\s+/).map(t => t === '.' ? -1 : t === '-' ? -2 : note(t));

  // ---------------------------------------------------------------- instruments (w: 1 saw, 2 pulse, 3 fm)
  const LEADS = {
    saw2: { w: 1, d2: .85, det: .12, cut: 2300, env: 2.2, fd: .22, k: 1.2, a: .006, d: .3, s: .72, r: .16, vib: .2, vr: 5.5, glide: .04, v: .2, sd: .32, sv: .22 },
    chip: { w: 2, duty: .25, pwm: .1, pr: .6, cut: 6500, env: .6, fd: .2, k: 1.7, a: .003, d: .16, s: .62, r: .07, vib: .14, vr: 6.2, glide: .02, v: .15, sd: .28, sv: .14 },
    fm: { w: 3, ratio: 2, fi: 1.7, fi0: .3, cut: 7000, env: .3, fd: .25, k: 1.8, a: .004, d: .35, s: .55, r: .18, vib: .16, vr: 5, glide: .03, v: .21, sd: .3, sv: .24 },
    soft: { w: 2, duty: .5, pwm: .05, pr: .3, cut: 1100, env: 1.2, fd: .3, k: 1.6, a: .03, d: .6, s: .7, r: .45, vib: .18, vr: 4.5, glide: .06, v: .22, sd: .4, sv: .4 }
  };
  const BASSES = {
    saw: { w: 1, sub: .6, cut: 300, env: 5, fd: .13, k: .9, a: .003, d: .2, s: .5, r: .06, glide: 0, v: .34 },
    chip: { w: 2, duty: .5, cut: 1600, env: 1.4, fd: .1, k: 1.6, a: .002, d: .14, s: .6, r: .04, glide: 0, v: .23 },
    reese: { w: 1, d2: 1, det: .22, sub: .5, cut: 380, env: 2.5, fd: .3, k: 1.1, a: .004, d: .4, s: .8, r: .08, glide: .03, v: .27 },
    deep: { w: 1, sub: 1, cut: 180, env: 1.5, fd: .3, k: 1.6, a: .02, d: .8, s: .7, r: .3, glide: .05, v: .38 }
  };
  const ARPS = {
    sq: { w: 2, duty: .25, cut: 4200, env: 1.2, fd: .06, k: 1.5, a: .001, d: .09, s: 0, r: .03, v: .14, sd: .5, sv: .15 },
    sq8: { w: 2, duty: .125, cut: 7000, env: .5, fd: .05, k: 1.7, a: .001, d: .07, s: 0, r: .03, v: .13, sd: .4, sv: .1 },
    saw: { w: 1, cut: 1300, env: 3.5, fd: .08, k: 1, a: .001, d: .12, s: 0, r: .03, v: .15, sd: .45, sv: .15 },
    bell: { w: 3, ratio: 3.5, fi: 1.8, fi0: .05, cut: 9000, env: 0, fd: .15, k: 2, a: .001, d: .35, s: 0, r: .12, v: .13, sd: .45, sv: .35 }
  };
  const PADS = {
    warm: { cut: 1250, det: .007, lfo: .25, v: .055, sv: .5, sd: .08 },
    bright: { cut: 2600, det: .009, lfo: .3, v: .045, sv: .45, sd: .1 },
    dark: { cut: 650, det: .011, lfo: .35, v: .065, sv: .55, sd: .05 }
  };
  const KITS = [{ k: 'k0', s: 's0' }, { k: 'k1', s: 's0' }, { k: 'k2', s: 's1' }];

  // ---------------------------------------------------------------- songs (original compositions)
  // groove strings: one char per 16th. k kick s snare c clap h hat o open hat g ghost snare.
  // f = fill (last bar of every 4), F = big fill (every 8): '-' keep, s snare, t tom, k kick, x kick+snare, c clap, '.' silent
  const SONGS = {
    title: { key: 'A minor', bpm: 112, auto: 1, pump: .55, kit: 0, L: 'saw2', B: 'saw', A: 'sq', P: 'warm', dly: 3, fb: .42, dm: .3, rv: .32, vol: 1,
      prog: 'Am F C G Am F Dm Esus4,E',
      k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.', o: '..............x.', g: '.......x.......x', c: '',
      f: '------------s.ss', F: '--------s.s.tttt',
      bass: 'r.ror.ror.ror.5a', arp: '0123432101234532',
      lead: `a4 - - c5 - - e5 - - - a5 - - - g5 -   e5 - - - c5 - - - . . a4 - c5 - d5 -
             e5 - - g5 - - e5 - - - d5 - c5 - - -   d5 - - - - - . . b4 - c5 - d5 - g4 -
             a4 - - c5 - - e5 - - - a5 - - - b5 -   c6 - - - a5 - - - f5 - - - a5 - c6 -
             d6 - - - c6 - a5 - f5 - - - e5 - d5 -   e5 - - - - - g#5 - b5 - - - g#5 - - -` },
    s0: { key: 'E minor', bpm: 124, floor: .15, resume: 1, pump: .3, kit: 2, L: 'chip', B: 'chip', A: 'sq8', P: 'bright', dly: 3, fb: .3, dm: .25, rv: .2, vol: 1,
      prog: 'Em C G D Em C Am B7',
      k: 'x...x...x...x...', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', o: '..x...x...x...x.', g: '...........x....', c: '',
      f: '------------ssss', F: '--------s.s.s.ss',
      bass: 'r.o.r.o.r.o.r.o.r.o.r.o.5.o.3.7.', arp: '0242024213531353',
      lead: `e5 . e5 . g5 . b5 - - - a5 . g5 . f#5 .   e5 - - - . . c5 . e5 . g5 - - - . .
             d5 . d5 . g5 . b5 - - - c6 . b5 . a5 .   f#5 - - - - - a5 - d5 - - - . . . .
             e5 . e5 . g5 . b5 - - - a5 . g5 . f#5 .   g5 - - - e5 - c5 - e5 - g5 - c6 - - -
             c6 . b5 . a5 . e5 - - - a5 . c6 . e6 .   d#6 - - - - - b5 - f#5 - - - a5 - d#5 -` },
    s1: { key: 'G dorian', bpm: 132, floor: .2, resume: 1, swing: .14, pump: .3, kit: 0, L: 'fm', B: 'saw', A: 'saw', P: 'warm', dly: 2, fb: .35, dm: .22, rv: .25, vol: 1,
      prog: 'Gm7 C7 Gm7 C7 Ebmaj7 F Gm7 D7',
      k: 'x.....x...x..x..', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '......x.......x.', g: '.x.....x.x....x.', c: '....x.......x...',
      f: '------------s.sk', F: '--------t.t.ttss',
      bass: 'r..o.7.rr..5.o7.', arp: '0.2.1.3.2.4.3.1.',
      lead: `d5 - - f5 - g5 - - . . bb5 - a5 - g5 -   e5 - - - . . g5 - bb5 - - - a5 - g5 -
             f5 - d5 - - - bb4 - c5 - d5 - - - . .   e5 - g5 - c6 - - - bb5 - g5 - e5 - c5 -
             d5 - - - g5 - - - bb5 - - - d6 - - -   c6 - - - a5 - f5 - c5 - - - . . a4 -
             bb4 - d5 - g5 - - - f5 - d5 - bb4 - g4 -   a4 - - - f#5 - - - a5 - c6 - d6 - - -` },
    s2: { key: 'D phrygian', bpm: 140, floor: .25, resume: 1, pump: .5, kit: 1, L: 'saw2', B: 'reese', A: 'sq', P: 'dark', dly: 3, fb: .45, dm: .28, rv: .3, vol: 1,
      prog: 'Dm Eb Dm Eb Bb C Dm A',
      k: 'x..x..x...x..x..', s: '....x.......x...', h: '..x...x...x...x.', o: '', g: '...........x...x', c: '',
      f: '------------xsss', F: '--------ssssssss',
      bass: 'r.rr.rr.r.rr.ro.', arp: '0102010201020103',
      lead: `a4 - - - d5 - - - f5 - eb5 - d5 - - -   g5 - - - bb5 - - - g5 - f5 - eb5 - - -
             d5 - f5 - a5 - - - d6 - - - c6 - a5 -   bb5 - - - g5 - - - eb5 - - - . . . .
             f5 - - - d5 - f5 - bb5 - - - a5 - f5 -   g5 - - - e5 - - - c5 - e5 - g5 - - -
             a5 - - - f5 - - - d5 - - - a4 - - -   c#5 - - - e5 - - - a5 - - - - - . .` },
    s3: { key: 'B minor', bpm: 148, floor: .3, resume: 1, pump: .6, kit: 0, L: 'saw2', B: 'saw', A: 'sq', P: 'bright', dly: 3, fb: .4, dm: .26, rv: .28, vol: 1,
      prog: 'Bm G D A Bm G Em F#',
      k: 'x...x...x...x...', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', o: '..x...x...x...x.', g: '', c: '....x.......x...',
      f: '------------ssss', F: '--------s.s.ssss',
      bass: 'rrorrorrorrorror', arp: '0125012501250125',
      lead: `f#5 - - - b5 - - - a5 - f#5 - d5 - - -   b4 - - - d5 - - - g5 - - - f#5 - d5 -
             a5 - - - f#5 - - - d5 - e5 - f#5 - a5 -   c#6 - - - - - b5 - a5 - - - e5 - - -
             f#5 - - - b5 - - - c#6 - d6 - c#6 - b5 -   d6 - - - b5 - - - g5 - - - b5 - d6 -
             e6 - - - d6 - b5 - g5 - - - e5 - g5 -   f#5 - - - a#5 - - - c#6 - - - - - - -` },
    s4: { key: 'F# harmonic minor', bpm: 156, floor: .35, resume: 1, pump: .35, kit: 2, L: 'chip', B: 'chip', A: 'saw', P: 'dark', dly: 2, fb: .3, dm: .2, rv: .22, vol: 1,
      prog: 'F#m D Bm C#7 F#m D E C#7',
      k: 'x.x.......x..x..', s: '....x.......x...', h: 'x.xxx.xxx.xxx.xx', o: '', g: '.......x.x......', c: '',
      f: '----------s.ssss', F: '--------tttttttt',
      bass: 'r.r..r.or.r..5.o', arp: '5420542054205421',
      lead: `f#5 . a5 . c#6 . a5 . f#5 . e5 . f#5 - - -   f#5 . a5 . d6 . a5 . f#5 . e5 . d5 - - -
             d5 . f#5 . b5 . f#5 . d5 . c#5 . b4 - - -   f5 - - - g#5 - - - b5 - - - c#6 - - -
             c#6 - - - a5 - - - f#5 - g#5 - a5 - c#6 -   d6 - - - c#6 - - - a5 - - - f#5 - - -
             e5 - g#5 - b5 - - - e6 - - - d6 - b5 -   c#6 - - - b5 - - - g#5 - - - f5 - - -` },
    s5: { key: 'C minor', bpm: 164, floor: .4, resume: 1, pump: .45, kit: 1, L: 'saw2', B: 'reese', A: 'sq', P: 'dark', dly: 3, fb: .38, dm: .25, rv: .25, vol: 1,
      prog: 'Cm Ab Eb Bb Cm Ab Fm G',
      k: 'x.........x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..........x.....', g: '.......x.....x..', c: '',
      f: '------------ssss', F: '--------s.ssk.ss',
      bass: 'r-----r-r-----o-', arp: '0.3.2.4.0.3.2.5.',
      lead: `g5 - - - c6 - - - eb6 - d6 - c6 - g5 -   ab5 - - - c6 - - - eb6 - - - c6 - - -
             bb5 - - - g5 - - - eb5 - f5 - g5 - bb5 -   d6 - - - - - c6 - bb5 - - - f5 - - -
             c6 - - - eb6 - - - g6 - f6 - eb6 - d6 -   c6 - - - ab5 - - - eb5 - - - ab5 - c6 -
             c6 - - - ab5 - f5 - c6 - - - f6 - eb6 -   d6 - - - b5 - - - g5 - - - b5 - d6 -` },
    boss: { key: 'A phrygian dominant', bpm: 150, floor: .6, pump: .35, kit: 1, L: 'saw2', B: 'reese', A: 'saw', P: 'dark', dly: 3, fb: .45, dm: .25, rv: .35, vol: 1,
      prog: 'Am Am Bb Bb Am Am E E',
      k: 'x.....x..x......', s: '........x.......', h: 'x.x.x.x.x.x.x.x.', o: '', g: '..............x.', c: '........x.......',
      f: '------------tttt', F: '--------kkkkssss',
      bass: 'b-.rb-.rb-.r5.o.', arp: '0303030304040404',
      lead: `a5 - - - - - - - - - - - e5 - - -   f5 - - - - - e5 - - - c5 - - - - -
             d5 - - - - - - - f5 - - - bb5 - - -   a5 - - - - - f5 - - - d5 - - - - -
             a5 - - - c6 - - - e6 - - - - - - -   f6 - - - e6 - - - c6 - - - a5 - - -
             g#5 - - - b5 - - - e6 - - - - - - -   f6 - - - e6 - - - d6 - - - b5 - g#5 -` },
    final: { key: 'D minor', bpm: 172, floor: .7, pump: .5, kit: 0, L: 'saw2', B: 'saw', A: 'sq', P: 'bright', dly: 3, fb: .4, dm: .25, rv: .3, vol: 1,
      prog: 'Dm Bb Gm A Dm F C A7',
      k: 'x...x...x...x...', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', o: '..x...x...x...x.', g: '...x.......x....', c: '....x.......x...',
      f: '------------ssss', F: '--------ssssssss',
      bass: 'r.ror.ror.ror.ro', arp: '0123452301234523',
      lead: `d5 - - - a5 - - - f5 - - - d6 - - -   d6 - - - c6 - - - bb5 - - - f5 - - -
             g5 - - - bb5 - - - d6 - - - g6 - - -   e6 - - - - - - - c#6 - - - a5 - - -
             d6 - - - e6 - - - f6 - - - a6 - - -   a6 - - - g6 - - - f6 - - - c6 - - -
             e6 - - - g6 - - - e6 - d6 - c6 - - -   c#6 - - - e6 - - - g6 - - - a6 - - -` },
    patch: { key: 'C major / F lydian', bpm: 84, fix: .75, calm: 1, tone: .3, pump: .2, kit: 0, L: 'soft', B: 'deep', A: 'bell', P: 'warm', dly: 3, fb: .5, dm: .35, rv: .45, vol: 1.1,
      prog: 'Fmaj7 Em7 Dm7 Cmaj7',
      k: 'x.........x.....', s: '........x.......', h: '..x...x...x...x.', o: '', g: '', c: '', f: '----------------',
      bass: 'r-------5---r---', arp: '0.2.4.3.5.3.4.2.',
      lead: `e5 - - - - - - - c5 - - - a4 - - -   b4 - - - - - - - d5 - - - - - - -
             a4 - - - c5 - - - f5 - - - e5 - - -   d5 - - - - - - - - - - - . . . .` },
    over: { key: 'A minor', bpm: 70, fix: .7, calm: 1, tone: .55, pump: .1, kit: 1, L: 'soft', B: 'deep', A: 'bell', P: 'dark', dly: 4, fb: .5, dm: .35, rv: .5, vol: 1.1,
      prog: 'Am G F E',
      k: 'x.......x.......', s: '........x.......', h: '....x.......x...', o: '', g: '', c: '', f: '----------------',
      bass: 'r-------r---5---', arp: '0...1...2...4...',
      lead: `e5 - - - - - - - c5 - - - - - - -   d5 - - - - - - - b4 - - - - - - -
             c5 - - - - - - - a4 - - - - - - -   g#4 - - - - - - - b4 - - - - - - -` },
    win: { key: 'C major', bpm: 120, auto: 1, pump: .45, kit: 0, L: 'saw2', B: 'saw', A: 'sq', P: 'bright', dly: 3, fb: .4, dm: .28, rv: .32, vol: 1,
      prog: 'C G Am F C G F Ab,Bb',
      k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.', o: '', g: '', c: '....x.......x...',
      f: '------------ssss', F: '--------s.s.tttt',
      bass: 'r.rro.r.r.rro.ra', arp: '0245024502450245',
      lead: `g5 - - - e5 - g5 - c6 - - - - - - -   b5 - - - g5 - b5 - d6 - - - - - - -
             c6 - - - a5 - c6 - e6 - - - d6 - c6 -   a5 - - - - - - - f5 - - - g5 - a5 -
             g5 - - - e5 - g5 - c6 - - - e6 - - -   d6 - - - b5 - - - g5 - - - b5 - d6 -
             c6 - - - a5 - - - f5 - - - a5 - c6 -   c6 - - - eb6 - - - d6 - - - f6 - - -` }
  };
  for (const k in SONGS) { const s = SONGS[k]; s.name = k; s.prog = prog(s.prog); s.lead = mel(s.lead); }
  const IDLE = { name: '', bpm: 120, prog: [[chord('A')]] };

  // ---------------------------------------------------------------- LIVE pattern generators (patchable!)
  const base = {};
  const def = (n, a, b) => { base[n] = LIVE.def(n, a, b); };
  def('mu.tempo', 'song,bar,step', `// tempo in BPM, asked on every 16th step
const HALF=1, DRIFT=0, PUSH=0;
let bpm = song.bpm * HALF + PUSH;
if (DRIFT) bpm *= 1 + DRIFT * Math.sin((bar * 16 + step) * .09);
return bpm;`);
  def('mu.chord', 'song,bar,step', `// harmony: the chord of this bar ('Am,G' = two chords in one bar)
const LOOP = song.prog.length;
const b = song.prog[bar % LOOP];
return b[(step * b.length) >> 4];`);
  def('mu.drums', 'song,bar,step,I', `// drum machine, one char per 16th ('x' = hit). returns a bitmask:
// 1 kick  2 snare  4 hat  8 open hat  16 clap  32 tom  64 crash  128 ghost snare
const SHIFT=0, FILL_EVERY=4, HAT_AT=.1, OPEN_AT=.4, GHOST_AT=.6, CRASH_EVERY=8;
const s = (step + SHIFT) & 15, on = p => p && p[s] === 'x';
let m = 0;
if (on(song.k)) m |= 1;
if (on(song.s)) m |= 2;
if (on(song.c)) m |= 16;
if (I > HAT_AT && on(song.h)) m |= 4;
if (I > OPEN_AT && on(song.o)) m |= 8;
if (I > GHOST_AT && on(song.g)) m |= 128;
if (bar % FILL_EVERY === FILL_EVERY - 1 && song.f) {
  const f = (bar % (FILL_EVERY * 2) === FILL_EVERY * 2 - 1 && song.F) || song.f, c = f[s];
  if (c !== '-') m = (m & 12) | ({ s: 2, t: 32, k: 1, x: 3, c: 16 }[c] || 0);
}
if (step === 0 && bar % CRASH_EVERY === 0) m |= 64;
return m;`);
  def('mu.bass', 'song,bar,step,ch,nx', `// bassline, one char per 16th (pattern loops):
// r root  o octave  5 fifth  3 third  7 seventh  b low root  a approach (semitone under next chord)  - tie  . rest
const OCT=-12;
const p = song.bass, c = p[(bar * 16 + step) % p.length];
if (c === '-') return -2;
if (c === '.') return -1;
const r = ch.r + OCT, n = ch.n;
if (c === 'o') return r + 12;
if (c === '5') return r + n[2];
if (c === '3') return r + n[1];
if (c === '7') return r + (n[3] || 10);
if (c === 'b') return r - 12;
if (c === 'a') return nx.r + OCT - 1;
return r;`);
  def('mu.arp', 'song,bar,step,ch', `// arpeggiator: digit = chord tone counted upward through octaves, '.' = rest
const OCT=12, RATE=1;
if (step % RATE) return -1;
const c = song.arp[(bar * 16 + step) % song.arp.length];
if (c === '.') return -1;
const i = +c, n = ch.n, k = n.length;
return ch.r + OCT + n[i % k] + 12 * ((i / k) | 0);`);
  def('mu.lead', 'song,bar,step', `// lead melody: one note per 16th (-1 rest, -2 hold)
const TRANSPOSE=0, OCT=0;
const m = song.lead;
if (!m) return -1;
const n = m[(bar * 16 + step) % m.length];
return n < 0 ? n : n + TRANSPOSE + OCT * 12;`);
  def('mu.tune', 'n,ch', `// MIDI note -> Hz. every oscillator asks here (ch: 0 bass 1 lead 2 arp 3 pad)
const A4=440, SOUR=0;
const off = SOUR * ((n * 7 + ch * 5) % 5 - 2) / 2;
return A4 * Math.pow(2, (n - 69 + off) / 12);`);
  def('mu.mix', 'song,bar,I,m', `// arrangement: which layers play at intensity I (0..1). 'auto' songs build up by themselves
const HAT_AT=.08, PAD_AT=.15, ARP_AT=.35, LEAD_AT=.6, W=.12;
let i = song.auto ? [.25, .5, .85, 1][Math.min(3, (bar + 1) >> 2)] : Math.max(I, song.floor || 0);
if (song.fix != null) i = song.fix;
if (song.auto && bar % 32 >= 28) i = .45;
m.int = i;
m.drum = song.auto && bar < 1 ? 0 : 1;
m.bass = 1;
m.hat = sstep(HAT_AT - W, HAT_AT + W, i);
m.pad = sstep(PAD_AT - W, PAD_AT + W, i);
m.arp = sstep(ARP_AT - W, ARP_AT + W, i);
m.lead = sstep(LEAD_AT - W, LEAD_AT + W, i);`);
  def('mu.master', 'm', `// master bus: bit depth, sample-hold, tape wow (semitones), brightness
const BITS=16, HOLD=1, WOW=0, TONE=1;
m.bits = BITS;
m.hold = HOLD;
m.wow = WOW;
m.tone = TONE;`);

  // safe call: a broken patch must never kill the music; fall back to the original code and roll the patch back
  function call(nm, a, b, c, d, e) {
    try { return LIVE.fn[nm](a, b, c, d, e); } catch (err) { heal(nm, err); return base[nm](a, b, c, d, e); }
  }
  function heal(nm, err) {
    try {
      const L = LIVE.log, D = LIVE._d && LIVE._d[nm];
      for (let i = L.length - 1; i >= 0; i--) { const en = L[i]; if (en.name !== nm || !D) continue; const k = D.p.indexOf(en.p);
        if (k >= 0) { D.p.splice(k, 1); LIVE._re(nm); L.splice(i, 1); BUS.emit('panic', err, en); return; } }
      LIVE.revert(nm); BUS.emit('panic', err, { name: nm, tag: '', before: '', after: '' });
    } catch (e) { }
  }

  // ---------------------------------------------------------------- bug patches
  const bug = (id, name, desc, edits, weight) => PATCH.def({ id, name, desc, kind: 'bug', weight: weight || 1, max: 1,
    apply() { let ok = false; for (const e of edits) ok = LIVE.patch(e[0], e[1], e[2]) || ok; return ok; } });
  bug('au_detune', '0xA440: DETUNE', 'mu.tune  SOUR=0 -> SOUR=.45  +  mu.master WOW=0 -> WOW=.3 : oscillators drift out of tune',
    [['mu.tune', 'SOUR=0', 'SOUR=.45'], ['mu.master', 'WOW=0', 'WOW=.3']]);
  bug('au_halftime', '0x0B70: HALFTIME', 'mu.tempo  HALF=1 -> HALF=.5 : the music clock runs at half speed', [['mu.tempo', 'HALF=1', 'HALF=.5']], .8);
  bug('au_drift', '0x7D21: CLOCK_DRIFT', 'mu.tempo  DRIFT=0 -> DRIFT=.16 : the tempo wobbles +-16%', [['mu.tempo', 'DRIFT=0', 'DRIFT=.16']]);
  bug('au_bitrot', '0x8B17: BITROT', 'mu.master  BITS=16 -> BITS=5, HOLD=1 -> HOLD=4 : 5-bit crushed audio', [['mu.master', 'BITS=16', 'BITS=5'], ['mu.master', 'HOLD=1', 'HOLD=4']]);
  bug('au_skew', '0x5E0F: STEP_SKEW', 'mu.drums  SHIFT=0 -> SHIFT=3 : drum pattern slips three 16ths', [['mu.drums', 'SHIFT=0', 'SHIFT=3']], .8);

  // ---------------------------------------------------------------- drum samples (synthesized once per sample rate)
  function svf(b, type, fc, K, sr) {
    const G = Math.tan(PI * Math.min(fc, sr * .45) / sr), a1 = 1 / (1 + G * (G + K)), a2 = G * a1, a3 = G * a2; let i1 = 0, i2 = 0;
    for (let i = 0; i < b.length; i++) { const v0 = b[i], v3 = v0 - i2, v1 = a1 * i1 + a2 * v3, v2 = i2 + a2 * i1 + a3 * v3; i1 = 2 * v1 - i1; i2 = 2 * v2 - i2;
      b[i] = type === 0 ? v2 : type === 1 ? v1 * K : v0 - K * v1 - v2; }
    return b;
  }
  function norm(b, sr, pk) { let m = 0; for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > m) m = a; }
    const k = m > 1e-9 ? (pk || 1) / m : 0, nf = Math.min(b.length, sr * .004 | 0);
    for (let i = 0; i < b.length; i++) b[i] *= k; for (let i = 0; i < nf; i++) b[b.length - 1 - i] *= i / nf; return b; }
  function buildKit(sr) {
    const D = {}, buf = d => new Float32Array(Math.ceil(d * sr));
    const kick = (d, f0, f1, pr, ar, drive, click) => { const b = buf(d); let ph = 0;
      for (let i = 0; i < b.length; i++) { const t = i / sr; ph += (f1 + f0 * Math.exp(-t * pr)) / sr;
        b[i] = Math.tanh(Math.sin(TAU * ph) * Math.exp(-t * ar) * drive) + click * nrand() * Math.exp(-t * 600); }
      return norm(b, sr); };
    D.k0 = kick(.42, 170, 46, 36, 7, 1.8, .22);
    D.k1 = kick(.75, 130, 38, 20, 3.6, 2.6, .14);
    D.k2 = kick(.22, 260, 55, 55, 13, 5, .1);
    D.tom = kick(.4, 75, 105, 15, 9, 1.3, .04);
    { const b = buf(.32), n = buf(.32); let ph = 0;
      for (let i = 0; i < b.length; i++) { const t = i / sr; ph += (175 + 70 * Math.exp(-t * 40)) / sr; b[i] = Math.sin(TAU * ph) * Math.exp(-t * 28) * .7; n[i] = nrand() * Math.exp(-t * 13); }
      svf(n, 2, 1100, 1.4, sr); svf(n, 0, 9000, 1.2, sr); for (let i = 0; i < b.length; i++) b[i] += n[i] * 1.1; D.s0 = norm(b, sr); }
    { const b = buf(.2), hs = Math.max(1, Math.round(sr / 11000)); let hv = 0;
      for (let i = 0; i < b.length; i++) { const t = i / sr; if (i % hs === 0) hv = nrand(); b[i] = (hv * .8 + (Math.sin(TAU * 230 * t) > 0 ? .3 : -.3) * Math.exp(-t * 30)) * Math.exp(-t * 19); }
      D.s1 = norm(b, sr); }
    { const b = buf(.32), T0 = [0, .011, .022, .031];
      for (let i = 0; i < b.length; i++) { const t = i / sr; let e = t > .031 ? .55 * Math.exp(-(t - .031) * 15) : 0;
        for (const t0 of T0) if (t >= t0) e = Math.max(e, Math.exp(-(t - t0) * 180)); b[i] = nrand() * e; }
      svf(b, 1, 1300, .9, sr); D.clap = norm(b, sr); }
    const metal = (d, ar, hp, att) => { const b = buf(d), fr = [263, 400, 421, 474, 587, 845], ph = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < b.length; i++) { const t = i / sr; let x = 0;
        for (let k = 0; k < 6; k++) { ph[k] += fr[k] * 2.4 / sr; if (ph[k] >= 1) ph[k] -= 1; x += ph[k] < .5 ? 1 : -1; }
        b[i] = (x * .1 + nrand() * .6) * Math.exp(-t * ar) * (att ? Math.min(1, t / att) : 1); }
      svf(b, 2, hp, 1.3, sr); svf(b, 2, hp * .8, 1.3, sr); return norm(b, sr); };
    D.hat = metal(.09, 55, 7500); D.ohat = metal(.45, 7.5, 6500); D.crash = metal(1.5, 2.6, 4000, .004);
    return D;
  }

  // ---------------------------------------------------------------- the synth engine (one per sample rate)
  function mkEngine(sr) {
    const bd = BLK / sr;
    let song = null, name = null, pend = null, hasPend = false, bar = 0, st = 0, toNext = 0, bpm = 120, stepLen = sr * 15 / 120, fresh = false;
    let Itar = .5, Is = .5, chord = IDLE.prog[0][0], nxc = chord, onStep = null, ready = false, DR = null;
    const mem = {};
    const mix = { int: .5, drum: 1, hat: 1, bass: 1, arp: 0, pad: 0, lead: 0 }, lg = { drum: 1, hat: 1, bass: 1, arp: 0, pad: 0, lead: 0 };
    const mst = { bits: 16, hold: 1, wow: 0, tone: 1 };
    const mkV = P => ({ P, st: 0, env: 0, g: 0, f: 110, ft: 110, ph: 0, ph2: .37, sp: 0, i1: 0, i2: 0, fe: 0, age: 0, vp: 0, pw: 0, gl: .7071, gr: .7071 });
    const vB = mkV(BASSES.saw), vL = mkV(LEADS.saw2), vA = mkV(ARPS.sq);
    const pad = []; for (let i = 0; i < 4; i++) pad.push({ n: 57 + i * 4, f: 220, ft: 220, p1: i * .29 % 1, p2: i * .61 % 1 });
    let padP = PADS.warm, pg = 0, pL1 = 0, pL2 = 0, pR1 = 0, pR2 = 0, plfo = 0;
    const dv = []; for (let i = 0; i < 12; i++) dv.push({ s: null, pos: 0, inc: 1, g: 0, gl: 0, gr: 0, sd: 0, sv: 0, fade: false, grp: 0, t: 0 });
    let dvt = 0;
    const bL = new Float32Array(BLK), bR = new Float32Array(BLK), bD = new Float32Array(BLK), bV = new Float32Array(BLK),
      pLb = new Float32Array(BLK), pRb = new Float32Array(BLK), rL = new Float32Array(BLK), rR = new Float32Array(BLK);
    let dlL = null, dlR = null, dlN = 0, dw = 0, dT = sr * .3, dfb = 0, combs = null, aps = null;
    let duck = 0, wowPh = 0, wowM = 1, toneM = 1, dcL = 0, dcR = 0, dxL = 0, dxR = 0, lL1 = 0, lL2 = 0, lR1 = 0, lR2 = 0, hc = 0, hL = 0, hR = 0, tsec = 0;

    function prepare() {
      if (ready) return; DR = buildKit(sr);
      dlN = Math.ceil(sr * 1.6); dlL = new Float32Array(dlN); dlR = new Float32Array(dlN);
      const sc = sr / 44100, CL = [1116, 1188, 1277, 1356], AL = [556, 441];
      combs = []; for (let c = 0; c < 2; c++) for (const l of CL) { const n = Math.round((l + c * 23) * sc); combs.push({ b: new Float32Array(n), n, i: 0, fs: 0, c }); }
      aps = []; for (let c = 0; c < 2; c++) for (const l of AL) { const n = Math.round((l + c * 23) * sc); aps.push({ b: new Float32Array(n), n, i: 0, c }); }
      ready = true;
    }
    const setPan = (v, p) => { v.gl = Math.cos((p + 1) * PI / 4); v.gr = Math.sin((p + 1) * PI / 4); };

    function swap() {
      hasPend = false;
      if (song && song.resume) mem[name] = bar & ~7;
      if (pend === 'title' || pend === 'over') for (const k in mem) delete mem[k];
      name = pend; song = name ? SONGS[name] : null; st = 0;
      for (const v of [vB, vL, vA]) if (v.st && v.st < 3) v.st = 3;
      if (song) { IDLE.bpm = song.bpm; bar = song.resume ? mem[name] || 0 : 0; vB.P = BASSES[song.B]; vL.P = LEADS[song.L]; vA.P = ARPS[song.A]; padP = PADS[song.P]; fresh = true; }
      else bar = 0;
    }
    function padTo(ch) {
      const t = [], n = ch.n;
      for (let i = 0; i < 4; i++) { let x = ch.r + n[i % n.length] + (i >= n.length ? 12 : 0); while (x < 53) x += 12; while (x > 70) x -= 12; t.push(x); }
      t.sort((a, b) => a - b); pad.sort((a, b) => a.n - b.n);
      for (let i = 0; i < 4; i++) { const p = pad[i]; p.n = t[i]; const f = +call('mu.tune', t[i], 3); p.ft = f > 10 && f < 12000 ? f : m2f(t[i]); }
    }
    function mono(v, n, chn) {
      if (n === -2 || n == null) return;
      if (!(n >= 0 && n < 128)) { if (v.st && v.st < 3) v.st = 3; return; }
      const f = +call('mu.tune', n, chn); v.ft = f > 10 && f < 12000 ? f : m2f(n);
      if (!v.P.glide || v.st === 0 || v.st === 3) v.f = v.ft;
      v.st = 1; v.fe = 1; v.age = 0;
      if (chn === 2) setPan(v, v.gl > v.gr ? .45 : -.45); else if (chn === 1) setPan(v, .08); else setPan(v, 0);
    }
    function hit(s, g, pan, sd, sv, grp, inc) {
      if (!s || g < 1e-4) return;
      let best = null;
      for (const d of dv) { if (d.s && grp && d.grp === grp) d.fade = true; if (!best && !d.s) best = d; }
      if (!best) { best = dv[0]; for (const d of dv) if (d.t < best.t) best = d; }
      best.s = s; best.pos = 0; best.inc = inc || 1; best.g = g; best.gl = Math.cos((pan + 1) * PI / 4); best.gr = Math.sin((pan + 1) * PI / 4);
      best.sd = sd; best.sv = sv; best.fade = false; best.grp = grp; best.t = ++dvt;
    }
    function drums(m) {
      if (!ready) return;
      const K = KITS[song.kit | 0], gd = lg.drum, gh = lg.hat * (st & 1 ? .65 : 1);
      if (m & 1) hit(DR[K.k], .82 * gd, 0, 0, .04, 1);
      if (m & 2) hit(DR[K.s], .46 * gd, .05, .08, .25, 2);
      if (m & 128) hit(DR[K.s], .12 * gd, .2, .05, .1, 2);
      if (m & 16) hit(DR.clap, .36 * gd, -.12, .1, .3, 3);
      if (m & 4) hit(DR.hat, .15 * gh, .28, .02, 0, 4);
      if (m & 8) hit(DR.ohat, .12 * lg.hat, .28, .04, .05, 4);
      if (m & 32) hit(DR.tom, .38 * gd, -.5 + .12 * (st & 7), .05, .15, 5, 1.4 - .07 * (st & 7));
      if (m & 64) hit(DR.crash, .2 * gd, -.25, .05, .2, 6);
    }

    function doStep(off) {
      if (hasPend && ((st & 3) === 0 || !song)) swap();
      const sg = song;
      call('mu.master', mst);
      if (sg) {
        if ((st & 3) === 0) call('mu.mix', sg, bar, Is, mix);
        const ch = call('mu.chord', sg, bar, st);
        if (ch && ch.n && ch !== chord) { chord = ch; padTo(ch); }
        const nx = call('mu.chord', sg, bar + 1, 0); nxc = nx && nx.n ? nx : chord;
        let dm = call('mu.drums', sg, bar, st, mix.int) | 0;
        if (fresh && !sg.calm) dm |= 64;
        fresh = false;
        drums(dm);
        if (dm & 1) duck = 1;
        mono(vB, call('mu.bass', sg, bar, st, chord, nxc), 0);
        mono(vA, call('mu.arp', sg, bar, st, chord), 2);
        mono(vL, call('mu.lead', sg, bar, st), 1);
      } else { mix.drum = mix.hat = mix.bass = mix.arp = mix.pad = mix.lead = 0; }
      if (onStep) onStep(st, bar, off);
      if (++st > 15) { st = 0; bar++; }
      Is += (Itar - Is) * .12;
      const b = +call('mu.tempo', sg || IDLE, bar, st);
      if (b >= 30 && b <= 320) bpm = b;
      const sw = sg && sg.swing || 0;
      stepLen = sr * 15 / bpm * (sw ? (st & 1 ? 1 - sw : 1 + sw) : 1);
    }

    // --- voices
    function rMono(v, lgain) {
      const P = v.P;
      if (v.st === 1) { v.env += bd / P.a; if (v.env >= 1) { v.env = 1; v.st = 2; } }
      else if (v.st === 2) v.env = P.s + (v.env - P.s) * Math.exp(-bd / P.d);
      else if (v.st === 3) { v.env *= Math.exp(-bd / P.r); if (v.env < 1e-4) { v.env = 0; v.st = 0; } }
      v.fe *= Math.exp(-bd / P.fd);
      v.f += (v.ft - v.f) * (P.glide ? 1 - Math.exp(-bd / P.glide) : 1);
      v.age += bd;
      const g1 = v.env * lgain * P.v;
      let g = v.g;
      if (g1 < 1e-5 && g < 1e-5) { v.g = 0; return; }
      let f = v.f * wowM;
      if (P.vib) { v.vp += bd * TAU * P.vr; f *= 1 + .0578 * P.vib * Math.min(1, Math.max(0, v.age - .18) * 3) * Math.sin(v.vp); }
      const dt = Math.min(.45, f / sr);
      let fc = P.cut * (1 + P.env * v.fe) * toneM; if (fc > sr * .42) fc = sr * .42;
      const G = Math.tan(PI * fc / sr), K = P.k, a1 = 1 / (1 + G * (G + K)), a2 = G * a1, a3 = G * a2;
      const dg = (g1 - g) / BLK, gl = v.gl, gr = v.gr, sd = P.sd || 0, sv = P.sv || 0;
      let ph = v.ph, ph2 = v.ph2, sp = v.sp, i1 = v.i1, i2 = v.i2;
      if (P.w === 1) {
        const d2 = P.d2 || 0, dt2 = dt * (1 + (P.det || 0) * .0578), sub = P.sub || 0;
        for (let j = 0; j < BLK; j++) {
          ph += dt; if (ph >= 1) ph -= 1;
          let x = 2 * ph - 1 - blep(ph, dt);
          if (d2) { ph2 += dt2; if (ph2 >= 1) ph2 -= 1; x += d2 * (2 * ph2 - 1 - blep(ph2, dt2)); }
          if (sub) { sp += dt * .5; if (sp >= 1) sp -= 1; x += sub * (4 * Math.abs(sp - .5) - 1); }
          const v3 = x - i2, v1 = a1 * i1 + a2 * v3, v2 = i2 + a2 * i1 + a3 * v3; i1 = 2 * v1 - i1; i2 = 2 * v2 - i2;
          const y = v2 * g; g += dg;
          bL[j] += y * gl; bR[j] += y * gr; bD[j] += y * sd; bV[j] += y * sv;
        }
      } else if (P.w === 2) {
        v.pw += bd * TAU * (P.pr || 0); const du = P.duty + (P.pwm || 0) * Math.sin(v.pw);
        for (let j = 0; j < BLK; j++) {
          ph += dt; if (ph >= 1) ph -= 1;
          let q = ph - du; if (q < 0) q += 1;
          const x = (ph < du ? 1 : -1) + blep(ph, dt) - blep(q, dt);
          const v3 = x - i2, v1 = a1 * i1 + a2 * v3, v2 = i2 + a2 * i1 + a3 * v3; i1 = 2 * v1 - i1; i2 = 2 * v2 - i2;
          const y = v2 * g; g += dg;
          bL[j] += y * gl; bR[j] += y * gr; bD[j] += y * sd; bV[j] += y * sv;
        }
      } else {
        const idx = P.fi * (P.fi0 + v.fe), dm = dt * P.ratio;
        for (let j = 0; j < BLK; j++) {
          ph += dt; if (ph >= 1) ph -= 1; ph2 += dm; if (ph2 >= 1) ph2 -= Math.floor(ph2);
          const x = Math.sin(TAU * ph + idx * Math.sin(TAU * ph2));
          const v3 = x - i2, v1 = a1 * i1 + a2 * v3, v2 = i2 + a2 * i1 + a3 * v3; i1 = 2 * v1 - i1; i2 = 2 * v2 - i2;
          const y = v2 * g; g += dg;
          bL[j] += y * gl; bR[j] += y * gr; bD[j] += y * sd; bV[j] += y * sv;
        }
      }
      v.ph = ph; v.ph2 = ph2; v.sp = sp; v.i1 = i1; v.i2 = i2; v.g = g;
    }
    function rPad(pump) {
      const g1 = lg.pad * pump * padP.v;
      if (g1 < 1e-5 && pg < 1e-5) { pg = 0; return; }
      pLb.fill(0); pRb.fill(0);
      const gk = 1 - Math.exp(-bd / .07), det = padP.det;
      for (let k = 0; k < 4; k++) {
        const p = pad[k]; p.f += (p.ft - p.f) * gk;
        const d1 = p.f * wowM * (1 + det) / sr, d2 = p.f * wowM * (1 - det) / sr; let p1 = p.p1, p2 = p.p2;
        for (let j = 0; j < BLK; j++) { p1 += d1; if (p1 >= 1) p1 -= 1; p2 += d2; if (p2 >= 1) p2 -= 1; pLb[j] += p1 - .5; pRb[j] += p2 - .5; }
        p.p1 = p1; p.p2 = p2;
      }
      plfo += bd * TAU * .13;
      let fc = padP.cut * (1 + padP.lfo * Math.sin(plfo)) * toneM; if (fc > sr * .42) fc = sr * .42;
      const G = Math.tan(PI * fc / sr), K = 1.3, a1 = 1 / (1 + G * (G + K)), a2 = G * a1, a3 = G * a2;
      let g = pg; const dg = (g1 - g) / BLK, sd = padP.sd, sv = padP.sv;
      for (let j = 0; j < BLK; j++) {
        let v3 = pLb[j] - pL2, v1 = a1 * pL1 + a2 * v3, v2 = pL2 + a2 * pL1 + a3 * v3; pL1 = 2 * v1 - pL1; pL2 = 2 * v2 - pL2; const yl = v2 * g;
        v3 = pRb[j] - pR2; v1 = a1 * pR1 + a2 * v3; v2 = pR2 + a2 * pR1 + a3 * v3; pR1 = 2 * v1 - pR1; pR2 = 2 * v2 - pR2; const yr = v2 * g;
        g += dg; bL[j] += yl; bR[j] += yr; bD[j] += (yl + yr) * sd; bV[j] += (yl + yr) * sv;
      }
      pg = g;
    }
    function rDrums() {
      for (const d of dv) {
        const s = d.s; if (!s) continue;
        let pos = d.pos, g = d.g; const inc = d.inc, gl = d.gl, gr = d.gr, sd = d.sd, sv = d.sv, fade = d.fade, end = s.length - 1;
        for (let j = 0; j < BLK; j++) {
          const i = pos | 0; if (i >= end) { d.s = null; break; }
          const y = (s[i] + (s[i + 1] - s[i]) * (pos - i)) * g; pos += inc;
          if (fade) { g *= .93; if (g < 1e-4) { d.s = null; break; } }
          bL[j] += y * gl; bR[j] += y * gr; bD[j] += y * sd; bV[j] += y * sv;
        }
        d.pos = pos; d.g = g;
      }
    }
    function rFx() {
      const sg = song || IDLE, fb = sg.fb || .35, dm = sg.dm || .25, rv = sg.rv || .25;
      // ping-pong delay, tempo synced
      let tgt = (sg.dly || 3) * sr * 15 / bpm; if (tgt > dlN - 4) tgt = dlN - 4;
      dT += (tgt - dT) * .05;
      const da = 1 - Math.exp(-TAU * 3500 / sr), T = dT;
      for (let j = 0; j < BLK; j++) {
        let rp = dw - T; if (rp < 0) rp += dlN; const i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 >= dlN ? 0 : i0 + 1;
        const yl = dlL[i0] + (dlL[i1] - dlL[i0]) * fr, yr = dlR[i0] + (dlR[i1] - dlR[i0]) * fr;
        dfb += (yr - dfb) * da;
        dlL[dw] = bD[j] + dfb * fb; dlR[dw] = yl * fb;
        if (++dw >= dlN) dw = 0;
        bL[j] += yl * dm; bR[j] += yr * dm; bV[j] += (yl + yr) * .08;
      }
      // freeverb-style reverb (8 combs + 4 allpasses)
      rL.fill(0); rR.fill(0);
      for (const c of combs) {
        const b = c.b, n = c.n, o = c.c ? rR : rL; let i = c.i, fs = c.fs;
        for (let j = 0; j < BLK; j++) { const y = b[i]; fs = y * .7 + fs * .3; b[i] = bV[j] * .02 + fs * .8 + 1e-20; if (++i >= n) i = 0; o[j] += y; }
        c.i = i; c.fs = fs;
      }
      for (const a of aps) {
        const b = a.b, n = a.n, o = a.c ? rR : rL; let i = a.i;
        for (let j = 0; j < BLK; j++) { const bo = b[i], x = o[j]; b[i] = x + bo * .5; o[j] = bo - x; if (++i >= n) i = 0; }
        a.i = i;
      }
      for (let j = 0; j < BLK; j++) { bL[j] += rL[j] * rv; bR[j] += rR[j] * rv; }
    }

    function render(L, R, o, nb) {
      if (!ready) prepare();
      for (let b = 0; b < nb; b++, o += BLK) {
        while (toNext < BLK) { doStep(o + Math.max(0, toNext | 0)); toNext += stepLen; }
        toNext -= BLK; tsec += bd;
        // control rate
        const k = 1 - Math.exp(-bd / .3);
        lg.drum += (mix.drum - lg.drum) * k; lg.hat += (mix.hat - lg.hat) * k; lg.bass += (mix.bass - lg.bass) * k;
        lg.arp += (mix.arp - lg.arp) * k; lg.pad += (mix.pad - lg.pad) * k; lg.lead += (mix.lead - lg.lead) * k;
        duck *= Math.exp(-bd / .13);
        const sg = song || IDLE, pump = 1 - (sg.pump || 0) * duck;
        wowPh += bd * TAU * .9; wowM = mst.wow ? Math.pow(2, mst.wow * (Math.sin(wowPh) + .35 * Math.sin(wowPh * 5.3)) / 12) : 1;
        const tone = Math.max(.02, Math.min(1, (+mst.tone || 1) * (sg.tone || 1)));
        toneM = .35 + .65 * tone;
        bL.fill(0); bR.fill(0); bD.fill(0); bV.fill(0);
        rDrums();
        rMono(vB, lg.bass * (1 - (sg.pump || 0) * .6 * duck));
        rMono(vA, lg.arp * pump);
        rMono(vL, lg.lead);
        rPad(pump);
        rFx();
        // master: DC block, tone lowpass, crusher, gain, soft clip
        const lpOn = tone < .999, la = 1 - Math.exp(-TAU * 20000 * Math.pow(tone, 1.6) / sr);
        const bits = Math.max(2, Math.min(16, +mst.bits || 16)), hold = Math.max(1, Math.min(16, mst.hold | 0 || 1)), crush = bits < 16 || hold > 1, q = Math.pow(2, bits - 1);
        const MG = .78 * (sg.vol || 1);
        for (let j = 0; j < BLK; j++) {
          let l = bL[j], r = bR[j];
          dcL = l - dxL + .9975 * dcL; dxL = l; l = dcL;
          dcR = r - dxR + .9975 * dcR; dxR = r; r = dcR;
          if (lpOn) { lL1 += (l - lL1) * la; lL2 += (lL1 - lL2) * la; l = lL2; lR1 += (r - lR1) * la; lR2 += (lR1 - lR2) * la; r = lR2; }
          l *= MG; r *= MG;
          if (crush) { if (++hc >= hold) { hc = 0; hL = Math.round(l * q) / q; hR = Math.round(r * q) / q; } l = hL; r = hR; }
          l = l > 1.5 ? 1 : l < -1.5 ? -1 : l - .148148 * l * l * l;
          r = r > 1.5 ? 1 : r < -1.5 ? -1 : r - .148148 * r * r * r;
          L[o + j] = l; R[o + j] = r;
        }
      }
    }
    // virtual clock: run the sequencer only (no synthesis) — keeps S.beat alive without audio
    function advance(n) { while (toNext <= n) { n -= Math.max(0, toNext); toNext = 0; doStep(0); toNext += stepLen; } toNext -= n; }
    return {
      sr, prepare, render, advance,
      music(n) { if (hasPend ? pend === n : n === name) return; pend = n; hasPend = true; },
      setI(x) { Itar = x; },
      set onStep(f) { onStep = f; },
      get state() { return { name: hasPend ? pend : name, bar, st, Is, Itar, mem: Object.assign({}, mem), toNext: toNext / sr }; },
      load(s) { pend = s.name; hasPend = !!s.name; if (hasPend) swap(); bar = s.bar; st = s.st; Is = s.Is; Itar = s.Itar; Object.assign(mem, s.mem); toNext = s.toNext * sr; fresh = false; },
      get bpm() { return bpm; }, get song() { return name; }, get bar() { return bar; }, get step() { return st; }, lg, mix, mst
    };
  }

  // ---------------------------------------------------------------- SFX: sfxr-style layered one-shots
  // T(b,sr,o): o {t start, d dur, f Hz, e end Hz (exp sweep), w sq|saw|tri|sin|nz|fm, v vol, a attack, p decay power,
  //               duty, vr/vd vibrato Hz/semitones, arp [semis], ar arp rate, fm ratio, fi index, crush levels, lp/bp/hp (+lp2.. end), q}
  function T(b, sr, o) {
    const s0 = Math.round((o.t || 0) * sr), n = Math.min(b.length - s0, Math.round(o.d * sr));
    const f0 = o.f, lr = Math.log((o.e || o.f) / f0), w = o.w || 'sq', v = o.v == null ? 1 : o.v, a = Math.max(.0015, o.a || 0), p = o.p == null ? 1 : o.p, duty = o.duty || .5;
    const ft = o.lp ? 0 : o.bp ? 1 : o.hp ? 2 : -1, fa = o.lp || o.bp || o.hp, fz = o.lp2 || o.bp2 || o.hp2 || fa, K = 1 / (o.q || .8);
    let ph = 0, mph = 0, hold = 1, hv = 0, i1 = 0, i2 = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n, t = i / sr;
      let f = f0 * Math.exp(lr * x);
      if (o.arp) f *= Math.pow(2, o.arp[((t * o.ar) | 0) % o.arp.length] / 12);
      if (o.vd) f *= Math.pow(2, o.vd * Math.sin(TAU * o.vr * t) / 12);
      let y;
      if (w === 'nz') { hold += f / sr; if (hold >= 1) { hold -= Math.floor(hold); hv = nrand(); } y = hv; }
      else {
        ph += f / sr; ph -= Math.floor(ph);
        if (w === 'sq') y = ph < duty ? 1 : -1; else if (w === 'saw') y = 2 * ph - 1; else if (w === 'tri') y = 4 * Math.abs(ph - .5) - 1;
        else if (w === 'fm') { mph += f * (o.fm || 2) / sr; y = Math.sin(TAU * ph + (o.fi || 2) * (1 - x) * Math.sin(TAU * mph)); }
        else y = Math.sin(TAU * ph);
      }
      if (o.crush) y = Math.round(y * o.crush) / o.crush;
      if (ft >= 0) {
        const fc = Math.min(sr * .45, fa * Math.pow(fz / fa, x)), G = Math.tan(PI * fc / sr), a1 = 1 / (1 + G * (G + K)), a2 = G * a1, a3 = G * a2;
        const v3 = y - i2, v1 = a1 * i1 + a2 * v3, v2 = i2 + a2 * i1 + a3 * v3; i1 = 2 * v1 - i1; i2 = 2 * v2 - i2;
        y = ft === 0 ? v2 : ft === 1 ? v1 * K : y - K * v1 - v2;
      }
      b[s0 + i] += y * Math.min(1, t / a) * Math.pow(1 - x, p) * v;
    }
  }
  const NT = s => 523.25 * Math.pow(2, s / 12);       // semitones above C5
  // name: [vol, min gap s, max voices, music duck, length s, recipe]
  const SFXD = {
    shoot: [.3, .04, 4, 0, .08, b => [{ d: .07, f: 1500, e: 420, w: 'sq', duty: .3, p: 1.6 }, { d: .025, f: 30000, w: 'nz', v: .35, p: 2, hp: 3000 }]],
    shoot2: [.32, .045, 4, 0, .11, b => [{ d: .1, f: 820, e: 150, w: 'saw', p: 1.2, lp: 6000, lp2: 800 }, { d: .05, f: 30000, w: 'nz', v: .5, p: 2, lp: 5000 }, { d: .08, f: 140, e: 60, w: 'sin', v: .6, p: 1 }]],
    laser: [.42, .07, 3, 0, .3, b => [{ d: .28, f: 2600, e: 160, w: 'fm', fm: 1.5, fi: 4, p: 1, vr: 30, vd: .7 }, { d: .28, f: 2610, e: 165, w: 'saw', v: .3, p: 1.2, lp: 6000, lp2: 1200 }]],
    hit: [.3, .025, 5, 0, .06, b => [{ d: .05, f: 1900, e: 950, w: 'sq', duty: .5, v: .7, p: 2 }, { d: .03, f: 30000, w: 'nz', v: .7, p: 3, hp: 2500 }]],
    kill: [.42, .028, 6, 0, .2, b => [{ d: .19, f: 30000, w: 'nz', p: 1.6, lp: 9000, lp2: 500 }, { d: .14, f: 560, e: 70, w: 'sq', duty: .4, v: .75, p: 1.2 }, { d: .1, f: 2400, w: 'nz', v: .4, p: 1 }]],
    bigkill: [.75, .09, 3, .35, .75, b => [{ d: .7, f: 140, e: 30, w: 'sin', p: 1.3 }, { d: .65, f: 30000, w: 'nz', v: .9, p: 1.8, lp: 9000, lp2: 250 }, { t: .02, d: .45, f: 3000, e: 300, w: 'nz', v: .45, p: 1.1 }, { d: .2, f: 600, e: 50, w: 'sq', v: .4, p: 1 }]],
    hurt: [.7, .14, 2, .4, .34, b => [{ d: .32, f: 440, e: 80, w: 'saw', p: 1, vr: 38, vd: 1.6, crush: 5 }, { d: .14, f: 30000, w: 'nz', v: .7, p: 2 }, { d: .3, f: 220, e: 55, w: 'sq', v: .4, p: 1 }]],
    dash: [.42, .09, 2, 0, .24, b => [{ d: .23, f: 30000, w: 'nz', a: .03, p: 1.4, bp: 300, bp2: 4500, q: 3 }, { d: .18, f: 170, e: 520, w: 'tri', v: .35, a: .02, p: 1.5 }]],
    pickup: [.32, .03, 4, 0, .1, b => [{ d: .045, f: 1320, w: 'sq', duty: .25, v: .8, p: .8 }, { t: .045, d: .055, f: 1980, w: 'sq', duty: .25, v: .8, p: 1.2 }]],
    patch: [.55, .2, 2, 0, .5, b => [0, 4, 7, 12, 16].map((s, i) => ({ t: i * .055, d: .26, f: NT(s), w: 'sq', duty: .5, v: .5, p: 1.5 })).concat([{ d: .5, f: NT(-12), w: 'tri', v: .4, a: .02, p: 1.2 }])],
    bug: [.6, .2, 2, .2, .5, b => [{ d: .48, f: 110, e: 70, w: 'sq', duty: .5, v: .8, p: .8, arp: [0, 13, 6, 18, 1, 11], ar: 28 }, { d: .48, f: 113, e: 73, w: 'saw', v: .5, p: .9, lp: 1600 }, { d: .3, f: 2000, w: 'nz', v: .25, p: 1, crush: 3 }]],
    cure: [.65, .2, 2, 0, .75, b => [{ d: .5, f: 300, e: 2400, w: 'saw', v: .4, a: .03, p: 1, lp: 1000, lp2: 9000 }].concat([0, 4, 7, 12].map((s, i) => ({ t: .12 + i * .08, d: .4, f: NT(s + 12), w: 'fm', fm: 3.01, fi: 1.5, v: .5, p: 2 })))],
    boss: [.85, .5, 1, .5, 1.5, b => [{ d: 1.45, f: 55, e: 41, w: 'saw', a: .08, p: .7, lp: 300, lp2: 1400, vr: 6, vd: .3 }, { d: 1.45, f: 55.7, e: 41.5, w: 'saw', a: .08, p: .7, lp: 400, lp2: 900 }, { d: 1.4, f: 30000, w: 'nz', v: .5, a: .3, p: 1.5, lp: 600 }, { d: .5, f: 90, e: 30, w: 'sin', v: .8, p: 1 }]],
    warn: [.5, .25, 2, 0, .5, b => [880, 660, 880, 660].map((f, i) => ({ t: i * .12, d: .11, f, w: 'sq', duty: .5, v: .7, p: .4 }))],
    explode: [.6, .06, 4, .2, .48, b => [{ d: .45, f: 100, e: 30, w: 'sin', p: 1.3 }, { d: .45, f: 30000, w: 'nz', v: .85, p: 1.6, lp: 6000, lp2: 200 }, { t: .01, d: .25, f: 1200, e: 150, w: 'nz', v: .4, p: 1 }]],
    select: [.42, .05, 2, 0, .13, b => [{ d: .05, f: 660, w: 'sq', duty: .5, v: .7, p: .8 }, { t: .05, d: .075, f: 990, w: 'sq', duty: .5, v: .7, p: 1.2 }]],
    move: [.28, .03, 2, 0, .035, b => [{ d: .03, f: 1250, w: 'sq', duty: .25, p: 1.6 }]],
    back: [.42, .05, 2, 0, .13, b => [{ d: .05, f: 880, w: 'sq', duty: .5, v: .7, p: .8 }, { t: .05, d: .075, f: 587, w: 'sq', duty: .5, v: .7, p: 1.2 }]],
    levelup: [.55, .3, 1, .2, .62, b => [0, 4, 7, 12, 16, 19, 24].map((s, i) => ({ t: i * .06, d: i === 6 ? .26 : .1, f: NT(s - 12), w: 'sq', duty: .25, v: .6, p: 1 })).concat([0, 4, 7, 12, 16, 19, 24].map((s, i) => ({ t: i * .06 + .03, d: .1, f: NT(s), w: 'tri', v: .3, p: 1 })))],
    glitch: [.45, .08, 3, 0, .26, b => [{ d: .25, f: 400, w: 'sq', duty: .5, v: .6, p: .5, arp: [0, 19, 7, 31, -5, 24, 12], ar: 55, crush: 2 }, { d: .25, f: 1500, w: 'nz', v: .5, p: .6, arp: [0, 24, -12, 12], ar: 40, crush: 3 }]],
    charge: [.45, .1, 3, 0, .62, b => [{ d: .6, f: 180, e: 1400, w: 'saw', a: .45, p: .25, vr: 14, vd: .4, lp: 600, lp2: 5000 }, { d: .6, f: 360, e: 2800, w: 'sq', duty: .2, v: .3, a: .5, p: .3 }]],
    spawn: [.3, .04, 4, 0, .32, b => [{ d: .3, f: 30000, w: 'nz', a: .22, p: .3, bp: 800, bp2: 6000, q: 4 }, { d: .3, f: 300, e: 1250, w: 'sin', v: .5, a: .2, p: .4 }]],
    shield: [.42, .08, 3, 0, .34, b => [{ d: .33, f: 1200, w: 'fm', fm: 2.76, fi: 3, p: 1.6 }, { d: .25, f: 2400, w: 'sin', v: .35, p: 2, vr: 18, vd: .3 }]],
    combo: [.38, .05, 3, 0, .11, b => [{ d: .1, f: 880, w: 'sq', duty: .5, p: 1.2, arp: [0, 7, 12], ar: 30 }]],
    type: [.2, .022, 3, 0, .03, b => [{ d: .025, f: 30000, w: 'nz', v: .8, p: 3, hp: 3500 }, { d: .01, f: 2100, w: 'sq', v: .4, p: 1 }]]
  };
  function renderSfx(nm, sr) {
    const D = SFXD[nm]; if (!D) return null;
    const b = new Float32Array(Math.ceil(D[4] * sr));
    for (const o of D[5]()) T(b, sr, o);
    let x1 = 0, y1 = 0; for (let i = 0; i < b.length; i++) { const x = b[i]; y1 = x - x1 + .997 * y1; x1 = x; b[i] = y1; }   // DC block
    return norm(b, sr, 1);
  }

  // ---------------------------------------------------------------- WebAudio plumbing
  let ctx = null, master = null, musG = null, sfxG = null, dead = !AC, muted = false, live = false, fails = 0, force = false;
  const running = () => !!(ctx && !dead && (force || ctx.state === 'running'));
  let eng = mkEngine(48000), esr = 48000, pool = null, poolI = 0, playF = 0, Lb = null, Rb = null, chunkT = 0;
  const sbuf = {}, sq = [], rl = {}, voices = [];
  let sfxEnv = 0, lvl = 0, curLvl = 0, fbT = 0;
  const EVN = 256, evT = new Float64Array(EVN), evS = new Int16Array(EVN), evB = new Int32Array(EVN); let evH = 0, evN = 0;
  const LVN = 64, lvT = new Float64Array(LVN), lvV = new Float32Array(LVN); let lvH = 0, lvN = 0;
  const stat = { chunks: 0, resyncs: 0, renderMs: 0, frames: 0 };
  const pushEv = (t, s, b) => { if (evN >= EVN) { evH = (evH + 1) % EVN; evN--; } const i = (evH + evN) % EVN; evT[i] = t; evS[i] = s; evB[i] = b; evN++; };
  const wire = () => { eng.onStep = (s, b, off) => pushEv(live ? chunkT + off / esr : -1, s, b); };
  wire();

  function init(ext) {
    if (dead && !ext) return;
    try {
      if (!ctx || ext) {
        if (ext) { ctx = ext; dead = false; } else { try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); } }
        master = ctx.createGain(); musG = ctx.createGain(); sfxG = ctx.createGain();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -4; comp.knee.value = 4; comp.ratio.value = 16; comp.attack.value = .002; comp.release.value = .15;
        musG.connect(master); sfxG.connect(master); master.connect(comp); comp.connect(ctx.destination);
        sfxG.gain.value = .9;
        muted = muted || !!(S.opt && S.opt.mute); master.gain.value = muted ? 0 : 1;
        const sr = ctx.sampleRate; esr = sr > 50000 ? sr / 2 : sr;
        if (esr !== eng.sr) { const s = eng.state; eng = mkEngine(esr); eng.load(s); wire(); }
        eng.prepare();
        pool = []; const np = Math.ceil(LOOK * 2 * esr / CHUNK) + 6;
        for (let i = 0; i < np; i++) pool.push(ctx.createBuffer(2, CHUNK, esr));
        Lb = new Float32Array(CHUNK); Rb = new Float32Array(CHUNK);
        for (const k in SFXD) if (!sbuf[k]) sq.push(k);
        if (!ext) try { const u = ctx.createBufferSource(); u.buffer = ctx.createBuffer(1, 1, sr); u.connect(ctx.destination); u.start(0); } catch (e) { }   // iOS unlock
      }
      if (!ext && ctx.state !== 'running' && ctx.resume) { const p = ctx.resume(); if (p && p.catch) p.catch(() => { }); }
    } catch (e) { dead = true; ctx = null; }
  }

  function chunk() {
    const t0 = performance.now();
    chunkT = playF / esr;
    eng.render(Lb, Rb, 0, CHUNK / BLK);
    let ss = 0; for (let i = 0; i < CHUNK; i += 4) ss += Lb[i] * Lb[i] + Rb[i] * Rb[i];
    if (lvN >= LVN) { lvH = (lvH + 1) % LVN; lvN--; } const li = (lvH + lvN) % LVN; lvT[li] = chunkT; lvV[li] = Math.sqrt(ss / (CHUNK / 2)); lvN++;
    const buf = pool[poolI]; poolI = (poolI + 1) % pool.length;
    if (buf.copyToChannel) { buf.copyToChannel(Lb, 0); buf.copyToChannel(Rb, 1); } else { buf.getChannelData(0).set(Lb); buf.getChannelData(1).set(Rb); }
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(musG); src.start(chunkT);
    playF += CHUNK; stat.chunks++; stat.renderMs += performance.now() - t0;
  }
  function pump() {
    const t = ctx.currentTime;
    if (playF / esr < t + .012) { if (playF) stat.resyncs++; playF = Math.ceil((t + .05) * esr); }
    let k = Math.ceil(LOOK * esr / CHUNK) + 2;
    while (playF / esr < t + LOOK && k-- > 0) chunk();
  }

  function update(dt) {
    dt = dt > 0 ? Math.min(dt, .25) : 0;
    S.beat = S.beat > .004 ? S.beat * Math.exp(-dt * 8) : 0;
    sfxEnv *= Math.exp(-dt * 7);
    try {
      const on = running() && !muted;
      if (on !== live) { live = on; evN = 0; lvN = 0; playF = 0; }
      if (live) pump(); else eng.advance(dt * eng.sr);
      const now = live ? ctx.currentTime - Math.min(.2, Math.max(0, ctx.outputLatency || ctx.baseLatency || 0)) : Infinity;
      while (evN && evT[evH] <= now) { const s = evS[evH]; S.step = s; S.bar = evB[evH]; if ((s & 3) === 0) S.beat = 1; evH = (evH + 1) % EVN; evN--; }
      if (live) { while (lvN && lvT[lvH] <= now) { curLvl = lvV[lvH]; lvH = (lvH + 1) % LVN; lvN--; } } else curLvl = 0;
      // lazy sfx pre-render, ~2 ms per frame
      if (ctx && sq.length) { const t0 = performance.now(); while (sq.length && performance.now() - t0 < 2) { const k = sq.shift(); if (!sbuf[k]) mkBuf(k); } }
      if (voices.length) { const t = ctx.currentTime; for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1); }
      fails = 0;
    } catch (e) {
      if (++fails > 3) { dead = true; live = false; }
      fbT += dt; if (fbT > .5) { fbT -= .5; S.beat = 1; S.step = (S.step + 4) & 15; if (!S.step) S.bar++; }   // last-resort metronome
    }
    const music = live ? Math.min(1, curLvl * 2.4) : S.beat * .35;
    lvl += ((music + sfxEnv * .6) - lvl) * Math.min(1, dt * 20);
    A.level = Math.max(0, Math.min(1, lvl));
  }

  function mkBuf(nm) {
    try { const d = renderSfx(nm, ctx.sampleRate), b = ctx.createBuffer(1, d.length, ctx.sampleRate);
      if (b.copyToChannel) b.copyToChannel(d, 0); else b.getChannelData(0).set(d); sbuf[nm] = b; return b; } catch (e) { return null; }
  }
  function kill(v, t) { try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, .006); v.src.stop(t + .04); } catch (e) { } }
  function sfx(nm, o) {
    const D = SFXD[nm]; if (!D || muted || !running()) return;
    try {
      const t = ctx.currentTime, r = rl[nm] || (rl[nm] = { last: -9 });
      if (t - r.last < D[1] && t >= r.last) return; r.last = t;
      const buf = sbuf[nm] || mkBuf(nm); if (!buf) return;
      let n = 0, old = null; for (const v of voices) if (v.nm === nm && v.end > t) { n++; if (!old) old = v; }
      if (n >= D[2] && old) { kill(old, t); voices.splice(voices.indexOf(old), 1); }
      if (voices.length >= 28) { kill(voices[0], t); voices.shift(); }
      const vol = Math.max(0, Math.min(2, o && o.vol != null ? +o.vol || 0 : 1)) * D[0], rate = Math.max(.25, Math.min(4, o && o.pitch ? +o.pitch || 1 : 1));
      const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; src.playbackRate.value = rate; g.gain.value = vol; src.connect(g);
      let tail = g; if (o && o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, +o.pan || 0)); g.connect(p); tail = p; }
      tail.connect(sfxG); src.start(t);
      src.onended = () => { try { tail.disconnect(); if (tail !== g) g.disconnect(); } catch (e) { } };
      voices.push({ nm, src, g, end: t + buf.duration / rate });
      sfxEnv = Math.max(sfxEnv, vol);
      if (D[3]) { const gp = musG.gain; gp.cancelScheduledValues(t); gp.setValueAtTime(gp.value, t); gp.linearRampToValueAtTime(1 - D[3], t + .015); gp.setTargetAtTime(1, t + .09, .22); }
    } catch (e) { }
  }

  const A = {
    level: 0,
    init,
    update,
    music(n) { if (n != null && !SONGS[n]) return; try { eng.music(n == null ? null : n); } catch (e) { } },
    intensity(x) { eng.setI(Math.max(0, Math.min(1, +x || 0))); },
    sfx,
    mute(b) { muted = !!b; try { if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, .03); } catch (e) { } },
    get bpm() { return eng.bpm; }, get song() { return eng.song; }, get ready() { return live; },
    songs: Object.keys(SONGS), sfxNames: Object.keys(SFXD),
    _dev: { mkEngine, renderSfx, SONGS, SFXD, stat, attach(c) { force = true; init(c); }, get ctx() { return ctx; }, get eng() { return eng; }, get voices() { return voices.length; } }
  };
  return A;
})();
