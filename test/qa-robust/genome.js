#!/usr/bin/env node
// Genome export round-trip: pristine SELF.html, byte-identical exports, gen n -> n+1 -> n+2, malformed genomes, download path.
const fs = require('fs'), path = require('path');
const { ROOT, launch, collect, sleep, serve } = require('./lib');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const rep = (ok, name, info) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(50) + ' ' + (info || '')); };
const GRE = /<script id="genome">[^<]*<\/script>/;
const strip = s => s.replace(GRE, '<script id="genome">#</script>');

(async () => {
  const b = await launch();
  const open = async (file, opts) => { const ctx = await b.newContext({ viewport: { width: 960, height: 540 }, acceptDownloads: true }); const p = await ctx.newPage(); const errs = collect(p);
    await p.goto('file://' + file); await p.waitForFunction(() => window.__SM && window.__SM.S.frame > 3, null, { timeout: 20000 }); return { ctx, p, errs }; };

  for (const f of ['index.html', 'dist/dev.html']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const { ctx, p, errs } = await open(path.join(ROOT, f));
    // SELF is not on __SM: verify it through the real export (download) path
    const exp = await p.evaluate(() => { const M = window.__SM, { RUN, PATCH, S } = M; RUN.start(); for (const id of ['rate', 'rate', 'fork', 'pierce', 'hp', 'b_invert', 'orbit']) PATCH.apply(id); S.score = 12345;
      return { g: RUN.genome() }; });
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.evaluate(() => window.__SM.RUN.export())]);
    const file1 = path.join(OUT, 'gen1-' + path.basename(f)); await dl.saveAs(file1); const gen1 = fs.readFileSync(file1, 'utf8');
    rep(strip(gen1) === strip(src), `[${f}] export byte-identical except genome`, `src ${src.length} b, export ${gen1.length} b, genome: ${gen1.match(GRE)[0].slice(0, 120)}`);
    rep(exp.g.gen === 1 && exp.g.ids.join() === 'rate,fork,pierce,hp' && exp.g.hi >= 12345, `[${f}] genome content (ups only, max 4, deduped)`, JSON.stringify(exp.g));
    rep(dl.suggestedFilename() === 'selfmod-gen1.html', `[${f}] download name`, dl.suggestedFilename());
    rep(!/<canvas|data-|<a /i.test(gen1) && gen1.startsWith('<!DOCTYPE html>\n<html lang="en"><head>'), `[${f}] pristine document (no canvas / injected nodes)`);
    await ctx.close(); if (errs.length) rep(false, `[${f}] errors`, errs.join(' || '));

    // boot gen1: BUILD GEN 1, inherited patches applied on new run, export again -> gen2
    const g1 = await open(file1);
    await g1.p.evaluate(() => window.__SM.SCENE.go('title')); await sleep(1500);
    await g1.p.screenshot({ path: path.join(OUT, 'gen1-title-' + path.basename(f) + '.png') });
    const st1 = await g1.p.evaluate(() => { const M = window.__SM; const g = M.S.genome; const mode = M.S.mode; M.RUN.start(); return { g, mode, active: M.PATCH.active.slice(), hi: M.S.hi }; });
    rep(st1.g.gen === 1 && st1.active.join() === 'rate,fork,pierce,hp' && st1.hi >= 12345, `[${f}] gen1 boots with inherited patches`, JSON.stringify(st1));
    await g1.p.evaluate(() => window.__SM.PATCH.apply('dmg'));
    const [dl2] = await Promise.all([g1.p.waitForEvent('download'), g1.p.evaluate(() => window.__SM.RUN.export())]);
    const file2 = path.join(OUT, 'gen2-' + path.basename(f)); await dl2.saveAs(file2); const gen2 = fs.readFileSync(file2, 'utf8');
    rep(strip(gen2) === strip(src) && gen2.length - src.length < 120, `[${f}] gen2 export identical, no growth`, `+${gen2.length - src.length} b vs shipped; ${gen2.match(GRE)[0]}`);
    await g1.ctx.close(); if (g1.errs.length) rep(false, `[${f}] gen1 errors`, g1.errs.join(' || '));
    const g2 = await open(file2); const st2 = await g2.p.evaluate(() => window.__SM.S.genome); rep(st2.gen === 2 && st2.ids.length === 4, `[${f}] gen2 boots`, JSON.stringify(st2)); await g2.ctx.close();
  }

  // malformed genomes
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const bad = { 'junk-ids': '{"gen":"x","ids":["nope",5,"rate","rate",null,{"a":1},"b_invert","constructor","__proto__"],"hi":-5}', number: '42', 'ids-string': '{"ids":"rate","gen":-3}',
    huge: '{"gen":1e99,"hi":1e300,"ids":' + JSON.stringify(Array.from({ length: 200 }, (_, i) => 'x' + i)) + '}', nul: 'null', proto: 'JSON.parse(\'{"__proto__":{"gen":5},"ids":["rate"]}\')' };
  for (const [k, v] of Object.entries(bad)) {
    const f = path.join(OUT, 'bad-' + k + '.html'); fs.writeFileSync(f, src.replace(GRE, '<script id="genome">window.__GENOME=' + v + '</script>'));
    const o = await open(f); await sleep(300);
    const r = await o.p.evaluate(() => { const M = window.__SM; M.RUN.start(); return { g: M.S.genome, active: M.PATCH.active.slice(), mode: M.S.mode }; });
    await sleep(500); const ok = !o.errs.length && r.mode === 'play' && Number.isFinite(r.g.gen) && r.g.gen >= 0 && r.g.ids.every(id => ['rate', 'fork'].includes(id)) && Number.isFinite(r.g.hi);
    rep(ok, `malformed genome: ${k}`, JSON.stringify(r) + ' ' + o.errs.join(' || ')); await o.ctx.close();
  }
  // syntax-broken genome script: the browser reports that script's SyntaxError, but the game must still boot clean
  { const f = path.join(OUT, 'bad-syntax.html'); fs.writeFileSync(f, src.replace(GRE, '<script id="genome">window.__GENOME={gen:</script>'));
    const o = await open(f); await sleep(500); const m = await o.p.evaluate(() => window.__SM.S.genome.gen);
    rep(m === 0 && o.errs.length === 1 && /SyntaxError|Unexpected/.test(o.errs[0]), 'syntax-broken genome: boots as gen 0', o.errs.join(' || ')); await o.ctx.close(); }

  // export from inside a sandboxed iframe (download blocked): must not throw or log errors
  { const srv = await serve({ '/h.html': '<!DOCTYPE html><iframe sandbox="allow-scripts" src="/index.html" style="width:900px;height:500px"></iframe>' });
    const ctx = await b.newContext({ viewport: { width: 960, height: 540 } }); const p = await ctx.newPage(); const errs = collect(p); await p.goto(srv.url + '/h.html'); await sleep(1500);
    const fr = p.frames().find(x => x !== p.mainFrame()); const r = await fr.evaluate(() => { const M = window.__SM; M.RUN.start(); M.PATCH.apply('rate'); return M.RUN.export(); }); await sleep(800);
    rep(!errs.length, 'export inside sandboxed iframe: no errors', 'returned ' + r + ' ' + errs.join(' || ')); await ctx.close(); srv.close(); }

  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
