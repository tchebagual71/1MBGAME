#!/usr/bin/env node
// Build test/dir/out.html: kernel + real src modules that pass node --check (else stubs/NN-*.js) + 50-dir + 99-main
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '../..'), real = f => path.join(root, 'src', f), stub = f => path.join(__dirname, 'stubs', f);
const mods = ['00-kernel.js', '10-gfx.js', '20-fx.js', '30-audio.js', '40-game.js', '50-dir.js', '60-ui.js', '70-post.js', '99-main.js'];
const force = (process.env.STUB || '').split(',');
const used = [];
const files = mods.map(m => { const r = real(m), key = m.slice(3, -3);
  let ok = fs.existsSync(r) && !force.includes(key); if (ok) { try { cp.execSync('node --check ' + r); } catch (e) { ok = false; } }
  if (ok) { used.push(m); return r; } if (fs.existsSync(stub(m))) { used.push('STUB:' + m); return stub(m); } throw new Error('missing ' + m); });
const code = "(()=>{'use strict';\n" + files.map(f => fs.readFileSync(f, 'utf8')).join('\n;\n') + '\n})();';
new Function(code);
fs.writeFileSync(path.join(__dirname, 'out.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000"><script id="genome">window.__GENOME=null</script><script>' + code.replace(/<\/script/gi, '<\\/script') + '</script></body></html>');
console.log(used.join(' '));
