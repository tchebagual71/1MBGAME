// fuzz the bootstrap's pure-JS inflate fallback against zlib (all block types / strategies / sizes)
const zlib = require('zlib'), fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const m = html.match(/s=new TextDecoder\(\)\.decode\(\((function\(d\)\{.*?return o\.subarray\(0,L\)\})\)\(u\)\)/);
if (!m) { console.error('inflate fallback not found in index.html'); process.exit(1); }
const inf = vm.runInNewContext('(' + m[1] + ')', {});
let seed = 1; const R = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const gens = [n => Buffer.alloc(n), n => Buffer.from(Array.from({ length: n }, () => R() * 256 | 0)), n => Buffer.from(Array.from({ length: n }, (_, i) => 'abcab'.charCodeAt(i % 5) + (R() < .02 ? 1 : 0))),
  n => Buffer.from(Array.from({ length: n }, () => 'SELF.MOD '.charCodeAt(R() * 9 | 0)))];
const S = zlib.constants; let n = 0, bad = 0;
for (const size of [0, 1, 2, 7, 100, 1000, 65535, 65536, 70000, 300000]) for (const g of gens) for (const level of [0, 1, 6, 9]) for (const strategy of [S.Z_DEFAULT_STRATEGY, S.Z_FIXED, S.Z_HUFFMAN_ONLY, S.Z_RLE, S.Z_FILTERED]) {
  const d = g(size), z = zlib.deflateRawSync(d, { level, strategy }); let out; try { out = Buffer.from(inf(new Uint8Array(z))); } catch (e) { out = null; }
  n++; if (!out || !out.equals(d)) { bad++; console.log('MISMATCH size', size, 'gen', gens.indexOf(g), 'level', level, 'strategy', strategy); } }
// mixed block types in one stream: compressible text interleaved with random (incompressible -> stored) runs
for (let k = 0; k < 20; k++) { const parts = []; for (let j = 0; j < 12; j++) parts.push(gens[(j + k) % 4](R() * 40000 | 0));
  const d = Buffer.concat(parts), z = zlib.deflateRawSync(d, { level: k % 10 }); let out; try { out = Buffer.from(inf(new Uint8Array(z))); } catch (e) { out = null; }
  n++; if (!out || !out.equals(d)) { bad++; console.log('MISMATCH mixed', k); } }
console.log(`${n} vectors, ${bad} mismatches`); process.exit(bad ? 1 : 0);
