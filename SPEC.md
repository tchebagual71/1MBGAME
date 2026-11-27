# SELF.MOD — build contract

A single self-extracting `.html` (≤ 1 MB) containing a complete arena twin-stick shooter rendered in software
with old-school demoscene effects, whose gameplay **is** self-modifying code: every hot routine lives as source
text in the `LIVE` registry and upgrades / enemy "bugs" are literal string patches that get recompiled at runtime.
The player is a process inside a machine. You clear waves in SECTORS, choose **patches** (shown as real source diffs)
between waves, fight a boss per sector, while MUTATOR enemies inject **bugs** into the running program
(controls, visuals, music, weapon) until killed. Original game: no existing IP, names, art or music.

Fiction/tone: terse hacker/demoscene. 1990 cracktro meets debugger. Text is UPPERCASE mostly.

## Layout

    src/00-kernel.js   (done — READ IT FIRST, it is short and authoritative)
    src/10-gfx.js      const GFX   drawing primitives, font, sprites, particles
    src/20-fx.js       const FX    full-screen demo effects (backgrounds), JIT-compiled through LIVE
    src/30-audio.js    const AU    softsynth, tracker music, sfx
    src/40-game.js     const GAME  player, weapons, bullets, enemies, pickups, collisions, gameplay patches
    src/50-dir.js      const DIR   sectors, wave director, bosses
    src/60-ui.js       const UI    scenes boot/title/patch/pause/over/win, HUD, overlay
    src/70-post.js     const POST  WebGL CRT presenter (+2D fallback)
    src/99-main.js     (done)      RUN, 'play' scene, main loop
    tools/build.js     node tools/build.js  -> dist/dev.html (plain) + index.html (packed)
    tools/smoke.js     playwright smoke runner (see header)

All files are concatenated into ONE strict-mode function scope. Therefore:

* Each module file is exactly `const NAME = (() => { ... return {...}; })();` — **no other top-level identifiers**.
* Kernel globals available everywhere: `W H PI TAU fb clamp lerp sstep rgb C srand rnd rndr rndi pick BUS S LIVE PATCH
  ENT T_PLAYER T_ENEMY T_PSHOT T_ESHOT T_PICK T_FX SCENE STORE SELF CV VIEW IN` and from main `RUN`.
* Other modules' namespaces are in scope at call time (not at module-init time for later files — don't call a
  later-numbered module while your IIFE body is executing; do it lazily inside functions).
* No external resources, no network, no images/fonts/audio files: everything procedural. No `import`, no libraries.
* Don't minify. Keep comments modest. Target ≤ ~1500 lines per module. Plain ES2020, must run in Chrome/Firefox/Safari.
* Must work from `file://` and inside sandboxed iframes: wrap `localStorage` (use `STORE`), fullscreen, audio in try/catch.
* Performance: 60 fps at 480×270 on a mid laptop / recent phone. Avoid per-frame allocation in hot loops.
* Never use `Math.random` for gameplay — use `rnd()`. (Visual-only noise may use either.)

## Framebuffer

`fb` is `Uint32Array(480*270)`, pixel = `0xAABBGGRR` (use `rgb(r,g,b)`), alpha always 255. World coords == fb pixel
coords, the arena is exactly one screen; playable area is x∈[8,472], y∈[20,262] (top 16 px belong to the HUD).
Frame order (main loop): `IN.poll → AU.update(dt) → scene.update(dt) → scene.draw(dt) → UI.overlay(dt) → POST.present(dt)`.
`play` scene: update = `DIR.update(dt); GAME.update(dt)`; draw = `FX.draw(dt); GAME.draw(); UI.hud(dt)`.

## LIVE (self-modifying code) — the heart of the game

    LIVE.def(name, 'a,b', 'body source')      // compile + register; call via LIVE.fn[name](a,b) EVERY time (never cache the fn)
    LIVE.patch(name, find, repl)  -> bool      // find: string|RegExp, repl: string|function. Recompiles. false if no match / syntax error
    LIVE.src[name]                             // current source text (show it to the player!)
    LIVE.revertTag(tag) / LIVE.revert(name)    // un-patch
    LIVE.log                                   // [{t,name,tag,before,after}] newest last; BUS 'patch' fires with the entry
    LIVE.gen                                   // increments on every recompilation

Bodies are compiled by a direct `eval` inside the bundle scope, so live code can reference every kernel global and
module namespace. Write live bodies as readable, short (5–40 lines), nicely formatted source, with named tunable
constants at the top (`const RATE=6, N=1, SPREAD=.12;`) — players will literally read them in the patch screen and
patches will `find/replace` those tokens. If a frame throws, the main loop calls `LIVE.panic` which rolls back the most
recent patch (BUS 'panic'), so a bad patch combo self-heals — but still test your patches.

Naming: `wpn.*` `ply.*` `ai.<enemy>` (GAME) · `fx.<effect>` (FX) · `mu.*` (AU) · `boss.*` `dir.*` (DIR) · `ui.*` (UI) · `post.*` (POST).

## PATCH catalog

    PATCH.def({ id:'spread3', name:'FORK()', desc:'N=1 -> N=3 : fire three projectiles', kind:'up'|'bug',
                weight:1, max:1, can(){return true}, apply(){ return LIVE.patch('wpn.fire','N=1','N=3'); }, revert(){} })

`apply()` must do its work through `LIVE.patch` (the kernel tags those edits with the patch id so `PATCH.cure(id)` /
run reset can undo them). Return false if nothing applied. `max>1` patches should use a RegExp + function replacer so
they stack (`/DMG=(\d+)/, (m,a)=>'DMG='+(+a+1)`). `revert()` only for non-LIVE side effects (avoid those).
`PATCH.offer(n,'up')` → n distinct applicable patches. `PATCH.infect()` → applies a random bug, returns it or null.
`PATCH.cure(id)`, `PATCH.bugs()` → active bug ids, `PATCH.active`, `PATCH.all`.
**Every module registers patches for its own live functions**: GAME ≥ 24 upgrades + ≥ 6 bugs; FX ≥ 4 bugs (visual
corruption that keeps the game readable) ; AU ≥ 3 bugs (detune, tempo, bit-crush…) + 1–2 fun ups optional;
UI/POST ≥ 1 bug each (e.g. HUD digits scrambled, CRT h-sync loss). Bugs must be unfair-looking but survivable, and
fully undone on cure. Bug `name`s look like error codes/mnemonics ("0xDEAD: INVERT_AXIS").

## ENT

    ENT.def(type, { r, hp, team, layer, score, init(e), update(e,dt), draw(e), hurt(e,dmg,src) /*return false = immune*/, die(e,src) })
    ENT.spawn(type,x,y,props) -> e   {type,T,x,y,vx,vy,r,hp,maxhp,team,layer,age,flash,dead,...}
    ENT.damage(e,dmg,src)  ENT.kill(e,src)  ENT.count(team)  ENT.each(team,fn)  ENT.nearest(x,y,team,maxd)  ENT.clear()
    teams: T_PLAYER 0, T_ENEMY 1, T_PSHOT 2, T_ESHOT 3, T_PICK 4, T_FX 5.  layers 0..4 (0 decals,1 pickups,2 enemies,3 player,4 shots)

`e.flash>0` → draw white (hit flash). BUS events from kernel: `hurt(e,dmg,src)`, `kill(e,src)`, `patch(entry)`, `revert(tag)`,
`panic(err,entry)`, `patch:apply(p)`, `patch:cure(p)`, `scene(name,prev)`, `gesture`, `blur`, `resize`.

## S (shared state) — who writes what

`S.t` (global seconds), `S.dt`, `S.frame`, `S.mode` scene name (kernel) · `S.score S.combo S.mult S.kills S.player`
(GAME) · `S.sector S.wave S.diff S.boss` (DIR; `S.boss` = boss entity or null, must expose `hp,maxhp,name`) ·
`S.shake` (anyone: `S.shake=Math.max(S.shake,6)`; pixels, kernel decays) · `S.flash` (0..1 white flash, kernel decays) ·
`S.glitch` (0..1; POST renders glitch; GAME/DIR set it, whoever sets it decays it — convention: GAME owns decay:
`S.glitch` decays toward `min(.5, 0.12*PATCH.bugs().length)` in GAME.update) · `S.beat` (0..1 pulse on each beat),
`S.bar`, `S.step` (AU; everybody may use S.beat to sync visuals — do it!) · `S.hi`, `S.genome` (main) · `S.opt.crt/mute`.

## IN

`IN.mvx,IN.mvy` move vector (|v|≤1) · `IN.aimFrom(px,py)` then `IN.ax,IN.ay` unit aim · `IN.fire` held · `IN.dash`
pressed this frame · `IN.click` (LMB/tap this frame, at `IN.mx,IN.my` fb coords) · `IN.any` any key/button/tap this
frame · `IN.hit(code)` / `IN.key(code)` with KeyboardEvent.code · `IN.touch` (touch device in use) · `IN.sticks[0|1]`
`{on,ox,oy,x,y}` virtual sticks in fb coords (UI draws them) · `IN.mode` 'mouse'|'stick'.
Controls: WASD move, mouse aim + LMB fire, or arrow keys aim+fire; Space/Shift/RMB dash; Esc/P pause; M mute;
F fullscreen; C toggle CRT. Touch: left half = move stick, right half = aim stick (auto-fire), tap right = dash.
Menus must be fully operable by keyboard (arrows/WASD + Enter/Space, digits 1-3), mouse click AND touch tap.

---

# Module contracts

## GFX (10-gfx.js)

All coords may be fractional/out of range — every primitive clips safely. Colors are fb-format uint32.

    GFX.clear(c)                      GFX.fade(k)            // multiply whole fb by k (0..1), fast
    GFX.pset(x,y,c)  GFX.add(x,y,c)   // add = saturating additive
    GFX.rect(x,y,w,h,c)  GFX.rectA(x,y,w,h,c,a)  GFX.frame(x,y,w,h,c)       // filled, alpha-blended filled, 1px outline
    GFX.line(x0,y0,x1,y1,c)  GFX.lineA(x0,y0,x1,y1,c)                        // solid, additive
    GFX.circ(x,y,r,c)  GFX.disc(x,y,r,c)  GFX.glow(x,y,r,c,a=1)              // outline, filled, additive soft radial glow
    GFX.tri(x0,y0,x1,y1,x2,y2,c)
    GFX.shape(pts,x,y,rot,scale,c,add=false)   // closed wireframe polygon; pts flat [x0,y0,x1,y1,...] model coords
    GFX.fill(pts,x,y,rot,scale,c)              // filled convex polygon
    GFX.text(str,x,y,c,scale=1) -> width   GFX.textW(str,scale=1)   GFX.textC(str,cx,y,c,scale=1)   GFX.textR(str,rx,y,c,scale=1)
        // built-in 6×8 cell bitmap font (5×7 glyphs), full ASCII 32..126 plus a few glyphs via chars \x7f.. (block, arrow, heart, skull ok).
        // '\n' = newline (9px*scale). scale may be fractional ≥1 (nearest). Must be FAST (HUD + source listings: ~2000 chars/frame).
    GFX.textFx(str,x,y,scale,fn)      // per-pixel shaded big text: fn(px,py,u,v) -> color (for logos: gradients, plasma fill)
    GFX.hsv(h,s,v) -> c   GFX.mix(c1,c2,t) -> c   GFX.scale(c,k) -> c
    GFX.spr(name,x,y,rot=0,scale=1,tint)   GFX.sprDef(name,w,h,pixels|fn(x,y)->c)   // centered, 0 = transparent; rot/scale nearest
    // particles (pooled, additive, ≥ 3000): 
    GFX.burst(x,y,n,c,speed=60,life=.5,opts)   // opts {grav,drag,size,spread,ang}
    GFX.spark(x,y,vx,vy,c,life,size)   GFX.ring(x,y,r0,r1,c,life)   // expanding shockwave ring
    GFX.floatText(str,x,y,c,life=.8)  // rising score popups
    GFX.pUpdate(dt)  GFX.pDraw()  GFX.pClear()
    GFX.bolt(x0,y0,x1,y1,c,jag=6)     // jagged lightning line (additive)
    GFX.copy(dst,src) / GFX.snap() -> Uint32Array copy of fb, GFX.blit(buf,a) alpha-blit full-screen buffer back

Also pre-define a library of procedural sprites/vector shapes useful to GAME/DIR/UI exposed as `GFX.SH` (flat point
arrays, roughly radius 1 so they scale): `ship, dart, diamond, hex, star, cross, arrow, skull, chip, eye, gear, bolt, tri, square`.

## FX (20-fx.js) — demoscene backgrounds

    FX.def(name,{init(),draw(t,dt)})   FX.set(name, fadeSeconds=.6)   FX.draw(dt)   FX.names   FX.cur
    FX.dim     // 0..1 global brightness. play uses ~.38 (set by DIR), title/win use up to 1. Gameplay objects must stay readable:
               // when FX.dim≤.4 max channel value written should be ≲ 110.
    FX.kick(k) // transient punch (flash/zoom/hue shift) — DIR/GAME call on big events; also auto-react to S.beat.

`FX.draw` overwrites every pixel of fb (crossfades when switching). Each effect's per-pixel kernel is generated source
compiled through `LIVE.def('fx.<name>', …)` (tunable constants at top) so it can be patched — this is the JIT /
"code that writes code" demo trick: build specialized inner loops from expression templates. Budget ≤ 4 ms/frame
each (use lookup tables, half-res + 2× upscale where needed, incremental math).
Required effects (names fixed — DIR references them):
`plasma, tunnel, rotozoom, fire, starfield, copper` (raster/copper bars + sine waves), `voxel` (heightfield landscape
flyover), `metaballs, moire, twister, lens` (or `dotsphere`), `feedback` (zoom-rotate feedback), `kefrens`, `matrix`
(falling hex/code rain using GFX.text-like glyphs of the game's OWN live source), `boot` (decrunch raster flicker).
Each sector should feel like a different demo part. Make them gorgeous: palette design matters.

## AU (30-audio.js)

    AU.init()            // idempotent; called on first user gesture. Create AudioContext here (try/catch; game must run with no audio).
    AU.update(dt)        // every frame: schedule ahead, set S.beat (1 on beat then decays), S.bar, S.step
    AU.music(name)       // 'title' | 's0'..'s5' (sector themes) | 'boss' | 'final' | 'patch' (calm) | 'over' | 'win' | null. Crossfade/ switch on bar.
    AU.intensity(x)      // 0..1 layer mixing (DIR drives it: more enemies → more layers)
    AU.sfx(name, o)      // o {vol,pitch,pan}; names: shoot shoot2 laser hit kill bigkill hurt dash pickup patch bug cure boss warn
                         //   explode select move back levelup glitch charge spawn shield combo type
    AU.mute(bool)        AU.level  // 0..1 current output RMS-ish for visual sync
Pure synthesis: a small tracker (patterns of notes → voices: saw/square/tri/noise/FM, filters, envelopes, delay/reverb-ish),
chiptune × synthwave × demoscene. Robust architecture suggestion: render audio in chunks on the main thread into
AudioBuffers scheduled ahead (≈0.2–0.4 s lookahead), or precomputed loops per pattern; avoid AudioWorklet (file:// issues).
Pattern/sequence generators are LIVE functions (`mu.bass`, `mu.lead`, `mu.drums`, `mu.tempo`…) so bugs can mutate the
music. Must never throw if AudioContext is unavailable; sfx must be rate-limited (shoot fires 10+/s). Unknown sfx names are ignored.

## GAME (40-game.js)

    GAME.reset()   GAME.update(dt)   GAME.draw()
    GAME.shoot(x,y,vx,vy,o) -> e     // o {team:T_ESHOT|T_PSHOT, dmg=1, r=2, c, life=4, pierce=0, bounce=0, homing=0, kind:'orb'|'bolt'|'beam'|...}
    GAME.spawnEnemy(type,x,y,o) -> e // with spawn telegraph (≈.6 s warp-in during which it is harmless) 
    GAME.explode(x,y,r,dmg,team)     // area damage + visuals
    GAME.dropBits(x,y,n)             // xp/score pickups ("bits") that magnet to the player
    GAME.player                      // == S.player; {x,y,hp,maxhp,inv,dashCd,...}
    GAME.enemyTypes                  // names

GAME.update order: `ENT.update(dt)`, collisions, `GFX.pUpdate(dt)`, combo/mult decay, S.glitch decay. GAME.draw: `ENT.draw(); GFX.pDraw()`.
Player: tight controls (accel/friction via LIVE `ply.move`), dash with i-frames, hp (default 5), brief invulnerability on hit,
emits `BUS.emit('player:dead')` on death (big explosion; main switches to 'over' after 1.6 s). Weapon = LIVE `wpn.fire(p,ax,ay)`
(+ `wpn.bullet` per-frame bullet behaviour, `ply.dash`, `ply.hurt`) — designed to be patched: rate, count, spread, damage, speed,
pierce, bounce, homing, crit, chain lightning, orbitals, explosive rounds, lifesteal, dash-nova, magnet, overclock etc.
Upgrades must combine multiplicatively/fun (a build should feel broken by sector 4). Each patch's desc shows the actual edit.
Enemy types (names fixed, DIR spawns them by name; each has LIVE `ai.<type>(e,p,dt)`; hp/speed scale with `S.diff`):
`gnat` (swarm chaser, 1hp) · `drifter` (bouncing, medium) · `turret` (stationary, aimed bursts) · `worm` (segmented sine crawler)
· `splitter` (splits into 2–3 `shard`) · `shard` · `charger` (telegraph then dash) · `orbiter` (circles player, shoots)
· `mine` (proximity fuse, explodes) · `sniper` (laser telegraph line, then beam) · `weaver` (emits spiral bullets)
· `mutator` (BUG CARRIER: on spawn-in calls `PATCH.infect()`, shows the bug name over itself, tries to flee; killing it
`PATCH.cure(id)` → big satisfying "PATCH REVERTED" moment; if PATCH.infect returns null it's just an enemy).
Kills: score = T.score × S.mult, combo meter, drop bits, particles, `AU.sfx`, tiny `S.shake`. Enemy contact dmg 1.
Enemies must be visually distinct wireframe/vector shapes with glow (GFX.shape/glow), readable on busy backgrounds.
Entities with `e.boss=true` are bosses (defined by DIR): GAME's collision code must treat them like any T_ENEMY (circle `r`).
Player bullets hit T_ENEMY; enemy bullets (T_ESHOT) and enemy bodies hit the player. GAME handles ALL collisions.

## DIR (50-dir.js)

    DIR.reset()   DIR.update(dt)   DIR.sectors   DIR.state   // {phase:'intro'|'wave'|'clear'|'boss'|'outro', ...}
6 sectors × (4 waves + boss), then the final boss; whole run ≈ 15–20 min. Each sector: `{name, sub, fx, music, palette, waves, boss}`
e.g. SECTOR 0 "BOOT SECTOR" / fx plasma. DIR sets `S.sector,S.wave,S.diff`, `FX.set(...)`, `FX.dim=.38`, `AU.music('s'+i)`,
`AU.intensity`, calls `UI.banner(title, sub)` for wave/sector/boss announcements, spawns via `GAME.spawnEnemy` with composed
wave scripts (formations, edges, timed trickles, mixed types; never spawn on top of the player; cap ~60 live enemies).
When a wave is cleared (not after boss intro waves…): short breather, then `SCENE.go('patch')` — UI applies the chosen patch and
returns to `'play'`; DIR resumes with the next wave (DIR.update only runs during play). After each boss: heal player a bit,
2 patch picks in a row (call `SCENE.go('patch', {picks:2})`), next sector. After the final boss: `BUS.emit('run:win')`.
Bosses: 6 sector bosses + final boss "KERNEL" defined via `ENT.def('boss.<name>', …)` with `boss:true`, `name`, multi-phase
bullet patterns (via `GAME.shoot`), telegraphed attacks, adds, each with LIVE `boss.<name>` pattern functions; visuals with
GFX primitives (big, animated, multi-part, glowing). Bosses 3+ and final boss rewrite the game against you mid-fight
(`PATCH.infect()` at phase changes, cured when the phase/boss ends; final boss may even patch `fx.*`, swap FX, and
"revert" one of YOUR upgrades temporarily via `PATCH.cure` + re-`PATCH.apply` later). Set `S.boss`, call `AU.music('boss')`.
After a win, `S.diff` and an endless "LOOP n" is NOT required.

## UI (60-ui.js)

    UI.hud(dt)          // during play: hp pips, score, mult/combo bar, SECTOR/WAVE, dash cooldown, boss bar (S.boss), active bug list (blinking red)
    UI.overlay(dt)      // every frame, every scene: banners, live-patch ticker, touch sticks, mute/fps indicators, panic toast
    UI.banner(title, sub, seconds=2.2)
    scenes via SCENE.def: 'boot','title','patch','pause','over','win'

* `boot`: 2–3 s fake cruncher/decrunch intro (raster flicker `FX 'boot'`, "DECRUNCHING… LINKING LIVE CODE…" listing real
  `Object.keys(LIVE.src)` names + byte sizes), skippable → `title`.
* `title`: cracktro-grade: big shaded logo "SELF.MOD" (GFX.textFx), copper bars, sine scroller with greets/instructions,
  bouncing things, rotating FX backgrounds (`FX.dim≈.8`), hi-score, "BUILD GEN n" (S.genome.gen, inherited patch names),
  menu: START / HOW TO PLAY / (EXPORT BUILD if S.genome.gen>0 nothing special) . Start → `RUN.start()`. `AU.music('title')`.
* `patch` (enter(prev,arg) arg = {picks:n} optional): draw the frozen game dimmed beneath (call `FX.draw(dt); GAME.draw()` then darken),
  show 3 cards from `PATCH.offer(3)`; selecting one shows/animates the REAL diff: apply via `PATCH.apply(id)` and read the newest
  `LIVE.log` entry (`before`/`after`) to render a unified diff with -/+ lines typed out over the live source listing
  ("RECOMPILING… OK"), then `SCENE.go('play')` (or next pick). If `PATCH.offer` returns nothing, just return to play. `AU.music('patch')`
  on enter and restore previous music on leave is DIR/AU's concern: simply call `AU.music('patch')` on enter and `BUS.emit('patch:done')` on leave (DIR restores music).
* `pause`: resume / restart / quit to title; shows current build (active patches) and a scrollable/animated listing of live source.
* `over`: "SEGMENTATION FAULT" style core-dump screen with stats (score, sector, kills, time, patches), new hi-score fanfare,
  options: RETRY (`RUN.start()`), TITLE, EXPORT MUTATED BUILD (`RUN.export()` — downloads a copy of the game HTML with your
  patches baked into its genome; explain in one line).
* `win`: end-part demo: credits/greets scroller over effects, final stats, export build, back to title.
* overlay live-patch ticker: on BUS `patch` (during play) show a small corner panel for ~3 s with fn name and the changed
  line(s) `- old` / `+ new` (red for bug tags i.e. `PATCH.all[tag]?.kind==='bug'`, green for ups); on BUS `panic` show
  "EXCEPTION — ROLLED BACK <fn>"; on `patch:cure` show "PATCH REVERTED".
Text must be readable at 480×270: 6×8 font, 80×33 chars; keep important text ≥ scale 1 with dark backing.

## POST (70-post.js)

    POST.init(CV)        // get WebGL (webgl2 or webgl1) on the kernel canvas; fall back to 2D putImageData+drawImage scaling
    POST.present(dt)     // upload fb (480×270 RGBA) as texture and draw the CRT pass to the canvas (backing size VIEW.w×VIEW.h; BUS 'resize')
CRT shader: gentle barrel curvature (≤ 2 %; mouse mapping is linear), scanlines + aperture grille that scale correctly at any
size (no moiré at small sizes — fade them out when rows < 2 device px), soft bloom/halation (cheap multi-tap), chromatic
aberration at edges, vignette, subtle noise/flicker, phosphor persistence (ping-pong feedback buffer optional), `S.shake` (offset in
fb px, random direction per frame), `S.flash` (white add), `S.glitch` 0..1 (row tearing, RGB split, block displacement, bursts),
`S.beat` micro-pulse. `S.opt.crt=false` → clean nearest-neighbour presentation (still shake/flash). Shader constants generated
through LIVE `post.*` if practical (≥1 bug patch e.g. h-sync loss / colour-channel swap that stays playable). Handle context loss.
Must look crisp, not blurry; the image must stay bright.

## Testing

`node tools/build.js` bundles whatever `src/NN-*.js` exist. While other modules are still being written, test yours in
isolation: make a private harness dir `test/<yourmodule>/` with stub namespaces + the real kernel (see tools/build.js
for how to concatenate), run with playwright (`require('playwright')` works globally; chromium.launch() no options;
do NOT npm install anything), take screenshots (deviceScaleFactor 1) and LOOK at them with the Read tool. `node --check src/<file>` before finishing.
`window.__SM` = {S,LIVE,PATCH,ENT,SCENE,IN,RUN,BUS,fb} is exposed for tests.
Only edit your own module file (and your test dir). If you believe the kernel/spec is wrong, report it — do not edit kernel or other modules.
