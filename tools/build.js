#!/usr/bin/env node
// SELF.MOD build: concatenate src/NN-*.js into one strict-mode scope ->
//   dist/dev.html  plain, readable
//   index.html     self-extracting: deflate-raw + base64 payload, inflated at boot by DecompressionStream
//                  (with a small pure-JS inflate fallback for browsers that lack it)
// Deterministic (sorted inputs, no timestamps), fails loudly on syntax errors, verifies its own output, enforces the 1 MB cap.
// Usage: node tools/build.js [--quiet]
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), vm = require('vm');
const root = path.join(__dirname, '..'), src = path.join(root, 'src'), QUIET = process.argv.includes('--quiet');
const CAP = 1048576;
const die = (msg, code) => { console.error('BUILD FAILED: ' + msg); process.exit(code || 1); };
const log = s => { if (!QUIET) console.log(s); };

// ---------- sources ----------
const files = fs.readdirSync(src).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
if (!files.length) die('no src/NN-*.js modules');
const mods = files.map(f => ({ f, s: fs.readFileSync(path.join(src, f), 'utf8') }));
// per-file syntax check with real file/line info (each module is a self-contained statement list)
let bad = 0;
for (const m of mods) { try { new vm.Script(m.s, { filename: 'src/' + m.f }); } catch (e) { bad++; console.error((e.stack || String(e)).split('\n').slice(0, 5).join('\n') + '\n'); } }
if (bad) die(bad + ' module(s) have syntax errors');
const code = "(()=>{'use strict';\n" + mods.map(m => m.s).join('\n;\n') + '\n})();';
try { new vm.Script(code, { filename: 'bundle.js' }); } catch (e) { console.error(e.stack || String(e)); die('bundle syntax error (strict-mode / cross-module redeclaration?)'); }
// "<!--" inside a <script> can switch the HTML tokenizer into the script-data-escaped states, where the closing tag is not seen
if (/<!--/.test(code)) die('source contains "<!--" — that sequence is unsafe inside an inline <script>; rewrite it (e.g. "<" + "!--")');

// ---------- document shell (kernel's SELF.html re-serialises exactly this shape — keep in sync with 00-kernel.js) ----------
const GENOME = '<script id="genome">window.__GENOME=null</script>';
const head = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>SELF.MOD</title></head><body style="margin:0;background:#000">' + GENOME;
const tail = '</body></html>\n';

// ---------- dev.html ----------
// "</script" may only appear inside strings/regexes/comments, where "<\/script" means the same thing
const nEsc = (code.match(/<\/script/gi) || []).length;
const devCode = code.replace(/<\/(script)/gi, '<\\/$1');
const dev = head + '<script>' + devCode + '</script>' + tail;

// ---------- packed index.html ----------
// pure-JS raw-DEFLATE decoder (RFC 1951), used only when DecompressionStream('deflate-raw') is unavailable. Verified below.
const INFLATE = `function(d){let p=0,b=0,n=0,o=new Uint8Array(d.length*4+1024),L=0;
const g=k=>{while(n<k){b|=d[p++]<<n;n+=8}const v=b&((1<<k)-1);b>>>=k;n-=k;return v},
w=x=>{if(L>=o.length){const t=new Uint8Array(o.length*2);t.set(o);o=t}o[L++]=x},
h=l=>{const c=new Uint16Array(16),f=new Uint16Array(16),s=new Uint16Array(l.length);for(const x of l)c[x]++;c[0]=0;for(let i=1;i<16;i++)f[i]=f[i-1]+c[i-1];for(let i=0;i<l.length;i++)if(l[i])s[f[l[i]]++]=i;return[c,s]},
y=([c,s])=>{let v=0,f=0,i=0;for(let l=1;l<16;l++){v|=g(1);const k=c[l];if(v-f<k)return s[i+v-f];i+=k;f=(f+k)<<1;v<<=1}throw Error('bad huffman code')},
LB=[],LE=[],DB=[],DE=[];
for(let i=0,v=3;i<29;i++){const e=i<8?0:(i-4)>>2;LB[i]=i==28?258:v;LE[i]=i==28?0:e;v+=1<<e}
for(let i=0,v=1;i<30;i++){const e=i<4?0:(i-2)>>1;DB[i]=v;DE[i]=e;v+=1<<e}
let F;do{F=g(1);const T=g(2);
if(T==0){p-=n>>3;b=n=0;const N=d[p]|d[p+1]<<8;p+=4;for(let i=0;i<N;i++)w(d[p++])}
else if(T==3)throw Error('bad block type');
else{let A,B;if(T==1){const l=[];for(let i=0;i<288;i++)l[i]=i<144?8:i<256?9:i<280?7:8;A=h(l);B=h(Array(30).fill(5))}
else{const hl=g(5)+257,hd=g(5)+1,hc=g(4)+4,O=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],c=Array(19).fill(0);for(let i=0;i<hc;i++)c[O[i]]=g(3);
const C=h(c),l=[];while(l.length<hl+hd){const s=y(C);if(s<16)l.push(s);else{const r=s==16?3+g(2):s==17?3+g(3):11+g(7),v=s==16?l[l.length-1]:0;for(let i=0;i<r;i++)l.push(v)}}
A=h(l.slice(0,hl));B=h(l.slice(hl))}
for(;;){let s=y(A);if(s<256)w(s);else if(s==256)break;else{s-=257;let N=LB[s]+g(LE[s]);const q=y(B),D=DB[q]+g(DE[q]);for(;N>0;N--)w(o[L-D])}}}}while(!F);
return o.subarray(0,L)}`.replace(/\n/g, '');
const raw = Buffer.from(code, 'utf8');
const z = zlib.deflateRawSync(raw, { level: 9, memLevel: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY }).toString('base64');
const boot = '<script>/* SELF.MOD — this page is a self-extracting cruncher: the game below is deflated, inflated at boot, then keeps rewriting itself while it runs */' +
  '(async()=>{const say=(t,e)=>{document.body.textContent="";const q=document.createElement("pre");q.style.cssText="color:#f44;background:#000;font:16px monospace;padding:2em;white-space:pre-wrap";' +
  'q.textContent=t+": "+e+(e&&e.stack?"\\n"+e.stack:"");document.body.appendChild(q)};let s;' +
  'try{const b=atob(document.getElementById("z").textContent),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);' +
  'try{s=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text()}' +
  'catch(e){s=new TextDecoder().decode((' + INFLATE + ')(u))}}catch(e){return say("DECRUNCH ERROR",e)}' +
  'try{(0,eval)(s+"\\n//# sourceURL=selfmod.js")}catch(e){say("BOOT ERROR",e)}})()</script>';
const packed = head + '<script id="z" type="application/octet-stream">' + z + '</script>' + boot + tail;

// ---------- self-verification ----------
const once = (s, sub) => s.split(sub).length - 1;
for (const [nm, doc] of [['dev.html', dev], ['index.html', packed]]) {
  if (once(doc, GENOME) !== 1) die(nm + ': genome placeholder must occur exactly once');
  if (!doc.startsWith('<!DOCTYPE html>\n') || !doc.endsWith(tail)) die(nm + ': bad document shell');
}
// dev: the only "</script" occurrences must be the real closing tags (genome + main)
if (once(dev.toLowerCase(), '</script') !== 2) die('dev.html: stray </script in payload');
try { new vm.Script(devCode); } catch (e) { die('dev.html: escaped code no longer parses: ' + e.message); }
if (/[<>&"]/.test(z) || once(packed.toLowerCase(), '</script') !== 3) die('index.html: payload not HTML-safe');
const back = zlib.inflateRawSync(Buffer.from(z, 'base64'));
if (!back.equals(raw)) die('index.html: zlib round-trip mismatch');
const jsInflate = vm.runInNewContext('(' + INFLATE + ')', {});
const back2 = Buffer.from(jsInflate(new Uint8Array(Buffer.from(z, 'base64'))));
if (!back2.equals(raw)) die('index.html: JS inflate fallback mismatch');
try { new vm.Script(boot.slice(8, -9)); } catch (e) { die('bootstrap does not parse: ' + e.message); }
if (packed.length > CAP) die(`index.html is ${packed.length} bytes, over the ${CAP} byte cap`, 2);

// ---------- write ----------
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/dev.html'), dev);
fs.writeFileSync(path.join(root, 'index.html'), packed);

// ---------- report ----------
const kb = n => (n / 1024).toFixed(1).padStart(7) + ' KB';
log('module               lines      raw     deflated');
for (const m of mods) log(m.f.padEnd(18) + String(m.s.split('\n').length).padStart(7) + kb(m.s.length) + kb(zlib.deflateRawSync(Buffer.from(m.s), { level: 9 }).length));
log('-'.repeat(52));
log('bundle'.padEnd(18) + String(code.split('\n').length).padStart(7) + kb(raw.length) + kb(back.length && Buffer.from(z, 'base64').length));
log(`dist/dev.html  ${dev.length} bytes   (${nEsc} "</script" escaped)`);
log(`index.html     ${packed.length} bytes = ${(packed.length / CAP * 100).toFixed(1)}% of 1 MB   (payload ${z.length} b64, bootstrap ${boot.length} incl. ${INFLATE.length} inflate fallback)`);
log('verified: syntax, HTML-safety, zlib + JS-inflate round-trip, size cap');
