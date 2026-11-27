#!/usr/bin/env node
// Build test/game/out.html: real kernel + (real gfx if usable else stub) + stubs + src/40-game.js + src/99-main.js
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '../..'), st = path.join(__dirname, 'stubs');
const real = f => path.join(root, 'src', f), stub = f => path.join(st, f);
let gfx = stub('10-gfx.js');
if (process.env.REALGFX && fs.existsSync(real('10-gfx.js'))) { try { cp.execSync('node --check ' + real('10-gfx.js')); gfx = real('10-gfx.js'); } catch (e) { } }
const files = [real('00-kernel.js'), gfx, stub('20-fx.js'), stub('30-audio.js'), real('40-game.js'), stub('50-dir.js'), stub('60-ui.js'), stub('70-post.js'), real('99-main.js')];
const code = "(()=>{'use strict';\n" + files.map(f => fs.readFileSync(f, 'utf8')).join('\n;\n') + '\n})();';
new Function(code);
fs.writeFileSync(path.join(__dirname, 'out.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><style>canvas{image-rendering:pixelated}</style></head><body><script id="genome">window.__GENOME=null</script><script>' + code.replace(/<\/script/gi, '<\\/script') + '</script></body></html>');
console.log('built with gfx=' + path.relative(root, gfx));
