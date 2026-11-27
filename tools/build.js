#!/usr/bin/env node
// Concatenate src/*.js into one scope -> dist/dev.html (plain) and index.html (self-extracting, deflate+base64).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.join(__dirname, '..'), src = path.join(root, 'src');
const files = fs.readdirSync(src).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
const code = "(()=>{'use strict';\n" + files.map(f => fs.readFileSync(path.join(src, f), 'utf8')).join('\n;\n') + '\n})();';
try { new Function(code); } catch (e) { console.error('SYNTAX ERROR in bundle: ' + e.message); for (const f of files) { try { new Function(fs.readFileSync(path.join(src, f), 'utf8')); } catch (e2) { console.error('  ' + f + ': ' + e2.message); } } process.exit(1); }
const head = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>SELF.MOD</title></head><body style="margin:0;background:#000"><script id="genome">window.__GENOME=null</script>';
const tail = '</body></html>\n';
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/dev.html'), head + '<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script>' + tail);
const z = zlib.deflateRawSync(Buffer.from(code, 'utf8'), { level: 9 }).toString('base64');
const boot = "<script>/* SELF.MOD — this page is a self-extracting cruncher: the game below is deflated, inflated at boot, then keeps rewriting itself while it runs */(async()=>{try{const b=atob(document.getElementById('z').textContent),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);const s=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();(0,eval)(s)}catch(e){document.body.innerHTML='<pre style=\"color:#f44;font:16px monospace;padding:2em\">DECRUNCH ERROR: '+e+'</pre>'}})()</script>";
const packed = head + '<script id="z" type="application/octet-stream">' + z + '</script>' + boot + tail;
fs.writeFileSync(path.join(root, 'index.html'), packed);
console.log(`modules: ${files.join(' ')}\nsource: ${code.length} bytes  ->  index.html: ${packed.length} bytes (${(packed.length / 1048576 * 100).toFixed(1)}% of 1MB)`);
if (packed.length > 1048576) { console.error('OVER 1MB BUDGET'); process.exit(2); }
