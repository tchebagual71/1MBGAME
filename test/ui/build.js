#!/usr/bin/env node
// Builds test/ui/index.html: kernel + every real src module that exists and parses (stubs for missing ones) + test hook + main.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..', '..'), src = path.join(root, 'src');
const mods = { '10-gfx.js': 'GFX', '20-fx.js': 'FX', '30-audio.js': 'AU', '40-game.js': 'GAME', '50-dir.js': 'DIR', '60-ui.js': 'UI', '70-post.js': 'POST' };
const force = (process.env.STUB || '').split(',').filter(Boolean);   // e.g. STUB=AU,GAME
const parts = [fs.readFileSync(path.join(src, '00-kernel.js'), 'utf8')], used = [];
for (const f in mods) {
  const p = path.join(src, f); let ok = fs.existsSync(p) && !force.includes(mods[f]);
  if (ok) try { cp.execSync('node --check ' + JSON.stringify(p), { stdio: 'pipe' }); } catch (e) { ok = false; }
  if (ok) { parts.push(fs.readFileSync(p, 'utf8')); used.push(f); }
  else { parts.push(fs.readFileSync(path.join(__dirname, 'stubs', mods[f] + '.js'), 'utf8')); used.push('STUB:' + mods[f]); }
}
parts.push(fs.readFileSync(path.join(__dirname, 'hook.js'), 'utf8'));
parts.push(fs.readFileSync(path.join(src, '99-main.js'), 'utf8'));
const code = "(()=>{'use strict';\n" + parts.join('\n;\n') + '\n})();';
try { new Function(code); } catch (e) { console.error('SYNTAX', e.message); process.exit(1); }
fs.writeFileSync(path.join(__dirname, 'index.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><title>ui test</title></head><body style="margin:0;background:#000"><script id="genome">window.__GENOME=null</script><script>' + code.replace(/<\/script/gi, '<\\/script') + '</script></body></html>');
console.log('built test/ui/index.html with', used.join(' '));
