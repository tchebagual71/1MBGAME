# SELF.MOD

A twin-stick arena shooter in a single self-extracting HTML file (about 165 KB, hard cap 1 MB). It has no external
assets: graphics, effects, music and sound are all generated in code.

You play a process loose inside a machine. You clear waves across six sectors, each ending in a boss; the last boss is
KERNEL. Between waves you choose **patches**: upgrades that are literal edits to the game's running source code, shown
to you as diffs. MUTATOR enemies and later bosses inject **bugs** into the program (inverted controls, aim jitter,
detuned music, broken CRT sync, and so on). A bug stays until you kill the enemy that carries it. When a run ends you can
export a copy of the game with your upgrades written into its genome.

## Playing

Open `index.html` in a current Chrome, Firefox or Safari. It works from `file://`, over HTTP, and inside sandboxed
iframes.

| Action | Keyboard / mouse | Touch | Gamepad |
|---|---|---|---|
| Move | WASD | left half: virtual stick | left stick / d-pad |
| Aim + fire | mouse + left button, or arrow keys | right half: virtual stick (auto-fire) | right stick (LT/RT also fire) |
| Dash (i-frames) | Space / Shift / right button | tap on the right half | A / B / LB / RB |
| Pause | Esc / P | — | Start |
| Menus | arrows/WASD + Enter/Space, digits 1-3, mouse click | tap | d-pad + A |
| Mute / CRT / fullscreen | M / C / F | menu entries | — |

Audio starts on the first key press, click or tap, as browsers require. The game pauses itself when the window loses
focus or the tab is hidden.

## How it works

All modules are concatenated into one strict-mode function scope (see `SPEC.md` for the full contract).

**LIVE registry: code stored as text.** Every routine that matters for gameplay, visuals or audio is registered with
`LIVE.def(name, args, body)`. The body stays a source string and is compiled with a direct `eval`, so it closes over
the whole bundle. Callers always go through `LIVE.fn[name]`. `LIVE.patch(name, find, repl)` edits that string (a
literal first match, or a RegExp with a function replacer for stackable edits such as `DMG=1 -> DMG=2`), then
recompiles it. An edit that no longer compiles is refused. Each compiled function carries a `//# sourceURL=live:<name>`
tag, so stack traces name the live function that threw.

**Patches.** `PATCH.def({id, kind:'up'|'bug', max, apply})` builds the catalog: about 30 upgrades and 27 bugs, spread across
the weapon, player, enemy AI, director, effects, music, HUD and CRT shader. `apply()` makes its edits through
`LIVE.patch`. All edits from one application share an application id, so a partial failure rolls back completely.
`PATCH.cure(id)` reverts every stack of a patch, and `RUN.start()` resets everything back to the base source. When an
edit is reverted, the function is rebuilt from its base text by replaying the surviving edits in their original order.

**Self-healing.** If a frame throws, the main loop calls `LIVE.panic(err)`. It finds the newest patch on a live function
named in the error's stack (or, failing that, the newest patch overall), removes that patch's whole application, keeps
`PATCH.active` consistent, and shows `EXCEPTION - ROLLED BACK <fn>`. The audio engine uses the same path through
`LIVE.heal(name)` when a music generator breaks.

**JIT'd effect kernels.** The 15 demoscene backgrounds (plasma, tunnel, rotozoom, fire, starfield, copper bars, voxel
landscape, metaballs, moire, twister, lens, feedback, kefrens bars, a matrix rain made from the game's own live source,
and a boot decrunch) are generated per-pixel loops. A template plus named tunables is expanded into a `fx.<name>`
source string and compiled through LIVE, so visual bugs can patch them while they run. Rendering goes into a 480x270
`Uint32Array` framebuffer.

**Live GLSL.** The CRT presenter (`70-post.js`) builds its fragment shader from the LIVE function `post.frag`. Patching
a constant there (h-sync loss, channel swap) recompiles the WebGL program on the next frame. Without WebGL it falls back
to Canvas2D, and it survives WebGL context loss and restore.

**Softsynth.** `30-audio.js` is a tracker and synthesizer that runs on the main thread. It has band-limited
oscillators, FM, filters, envelopes, delay and reverb, and renders 1024-sample chunks into `AudioBuffer`s scheduled
about 0.3 s ahead. Pattern generators (`mu.bass`, `mu.lead`, `mu.drums`, `mu.tempo`, `mu.master` and others) are LIVE
functions, so audio bugs (detune, halftime, bitrot, ...) are source patches too. Sound effects are synthesized once
into buffers. If `AudioContext` is missing or throws, the sequencer keeps running on a virtual clock so beat-synced
visuals still pulse.

**Self-extracting bootstrap.** `index.html` holds the bundle deflated (raw DEFLATE, base64) in a
`<script type="application/octet-stream">`. A small bootstrap inflates it with `DecompressionStream('deflate-raw')`, or
with a ~1.6 KB pure-JS inflater if that API is missing, then runs it with an indirect `eval`.

**Genome export.** At load the kernel captures `SELF.html`, a re-serialisation of the document's original pieces
taken before anything touches the DOM. It has the same shape the build writes, so it is byte-identical to the shipped
file. `RUN.export()` writes `window.__GENOME={gen, ids, hi}` into the `<script id="genome">` slot and downloads the
result. The new file boots as `BUILD GEN n+1` and applies the inherited upgrades (at most four) at the start of every
run. Exporting again from that copy produces gen n+2 and changes only the genome line. Unknown or malformed genome
entries are ignored.

## Building and testing

Requires Node 18+. Playwright with Chromium is needed only for the tests.

    node tools/build.js          # -> dist/dev.html (readable) + index.html (packed); prints per-module sizes
    node tools/check.js          # build + headless smoke of dev.html, index.html and the JS-inflate path; non-zero on any console error
    node tools/check.js --full   # also runs the robustness suite below
    node tools/smoke.js [html] [secs] [png] [script]   # ad-hoc scripted run + screenshot

The build is deterministic. It fails with file and line on syntax errors, rejects `<!--` in sources, escapes `</script`
in the dev build, and verifies that the payload inflates back to the exact source through both zlib and the bundled
JS inflater. It also enforces the 1 MB cap on `index.html`.

The robustness suite is in `test/qa-robust/`:

* `boot.js [file]`: boot matrix. Covers file://, http://, sandboxed and srcdoc iframes, throwing localStorage,
  WebGL disabled, missing or throwing AudioContext, missing DecompressionStream, tiny/huge/portrait viewports, DPR 1-3,
  and resize storms.
* `lifecycle.js`: audio-after-gesture, mute persistence, music switching storms, a 30 s page freeze, blur/hidden
  auto-pause and key release, touch, gamepad and pointer edge cases, and WebGL context loss.
* `fuzz.js [file] [ops] [seed]`: checks every patch (apply, stack, cure, reset exact), cure on pairs of patches that
  share a function, and kernel semantics. It then runs a random apply/cure/infect/reset soak interleaved with real game
  frames, with invariant checks.
* `genome.js`: export round-trips (gen 1 to gen 2), byte identity, and malformed genomes.
* `soak.js [file] [scale]`: about 25 simulated minutes across all scenes. Checks entity, particle, voice, handler,
  timer and heap bounds.
* `inflate.js`: checks the JS inflater against zlib over all block types.

## Layout

    src/00-kernel.js   framebuffer, BUS, S, LIVE, PATCH, ENT, SCENE, STORE, SELF, canvas fit, input (IN)
    src/10-gfx.js      GFX: primitives, bitmap font, sprites, particles
    src/20-fx.js       FX: JIT-generated demo effects
    src/30-audio.js    AU: softsynth, tracker, sfx
    src/40-game.js     GAME: player, weapons, enemies, collisions, gameplay patches
    src/50-dir.js      DIR: sectors, wave director, bosses
    src/60-ui.js       UI: boot/title/patch/pause/over/win scenes, HUD, overlays
    src/70-post.js     POST: WebGL CRT presenter with 2D fallback
    src/99-main.js     RUN, play scene, main loop
    tools/             build.js, check.js, smoke.js
    test/              per-module harnesses; qa-robust/ for the shipped build
    SPEC.md            module contracts
