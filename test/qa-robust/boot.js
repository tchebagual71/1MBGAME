#!/usr/bin/env node
// Boot-path matrix for the shipped files. Usage: node test/qa-robust/boot.js [index.html|dist/dev.html] [filter]
const fs = require('fs'), path = require('path');
const { ROOT, launch, serve, collect, sleep } = require('./lib');
const FILE = process.argv[2] || 'index.html', FILTER = process.argv[3] || '';
const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const NO_GL = `(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { return /webgl/.test(t) ? null : g.call(this, t, o); }; })();`;
const NO_AC = `delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined;`;
const THROW_AC = `window.AudioContext = window.webkitAudioContext = function () { throw new Error('NotAllowed: no audio for you'); };`;
const RESUME_REJECT = `(() => { const A = window.AudioContext; window.AudioContext = function (o) { const c = new A(o); c.resume = () => Promise.reject(new Error('resume denied')); return c; }; })();`;
const NO_DS = `delete window.DecompressionStream; window.DecompressionStream = undefined;`;
const DS_NORAW = `(() => { const D = window.DecompressionStream; window.DecompressionStream = function (f) { if (f !== 'gzip' && f !== 'deflate') throw new TypeError('Unsupported format ' + f); return new D(f); }; })();`;
const NO_LS = `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });`;
const NO_RAF_GAMEPAD = `navigator.getGamepads = undefined;`;

// frame-level probe: returns state of the game in the given frame
async function probe(fr) {
  return fr.evaluate(() => { const M = window.__SM; if (!M) return { sm: false, body: document.body ? document.body.innerText.slice(0, 200) : '' };
    return { sm: true, frame: M.S.frame, mode: M.S.mode, post: M.POST.mode, err: M.S.err ? String(M.S.err) : null, au: !!M.AU.ready, cv: [document.querySelector('canvas').width, document.querySelector('canvas').height] }; });
}

async function runCase(b, srv, c) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 }, c.ctx || {}));
  if (c.init) await ctx.addInitScript(c.init);
  const page = await ctx.newPage(); const errs = collect(page);
  const res = { name: c.name, ok: false, notes: [] };
  try {
    await page.goto(c.url(srv), { waitUntil: 'load' });
    let fr = page.mainFrame();
    if (c.frame) { await sleep(300); fr = page.frames().find(f => f !== page.mainFrame()) || fr; }
    let p = null;
    for (let i = 0; i < 40; i++) { await sleep(150); p = await probe(fr).catch(e => ({ sm: false, e: String(e) })); if (p.sm && p.frame > 10) break; }
    if (!p || !p.sm) { res.notes.push('no __SM: ' + JSON.stringify(p)); if (c.expectFail && p && /DECRUNCH|BOOT/.test(p.body || '')) { res.ok = !errs.length; res.notes.push('graceful message'); } }
    else {
      const f0 = p.frame; await sleep(600); const p2 = await probe(fr); res.notes.push(`mode=${p2.mode} post=${p2.post} cv=${p2.cv} frames+${p2.frame - f0}`);
      // start a run and play a little
      await fr.evaluate(() => { const M = window.__SM; M.RUN.start(); M.DIR.debug.skipTo(1, 1); });
      if (c.during) await c.during(page, fr, res);
      await sleep(c.playMs || 1500);
      const p3 = await probe(fr); res.notes.push(`play: mode=${p3.mode} frames=${p3.frame}`);
      res.ok = p2.frame > f0 && !p3.err && (p3.mode === 'play' || p3.mode === 'pause' || p3.mode === 'patch' || p3.mode === 'over') && (!c.check || await c.check(page, fr, res));
    }
  } catch (e) { res.notes.push('EXC ' + e.message.split('\n')[0]); }
  if (errs.length) { res.ok = false; res.notes.push(...errs.slice(0, 6)); }
  await ctx.close();
  return res;
}

const host = (inner) => `<!DOCTYPE html><html><body style="margin:0"><iframe ${inner} style="width:900px;height:500px;border:0"></iframe></body></html>`;
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const fileUrl = () => 'file://' + path.join(ROOT, FILE);
const cases = [
  { name: 'file://', url: fileUrl },
  { name: 'http://', url: s => s.url + '/' + FILE },
  { name: 'iframe sandbox=allow-scripts (http)', frame: true, url: s => s.url + '/host-sb.html' },
  { name: 'iframe sandbox=allow-scripts (file)', frame: true, url: () => 'file://' + path.join(ROOT, 'test/qa-robust/out/host-sb-file.html') },
  { name: 'iframe srcdoc', frame: true, url: s => s.url + '/host-srcdoc.html' },
  { name: 'iframe srcdoc + sandbox', frame: true, url: s => s.url + '/host-srcdoc-sb.html' },
  { name: 'localStorage throws', init: NO_LS, url: fileUrl },
  { name: 'WebGL disabled (getContext null)', init: NO_GL, url: fileUrl, check: async (pg, fr, r) => (await probe(fr)).post === '2d' || (r.notes.push('post mode ' + (await probe(fr)).post), false) },
  { name: 'AudioContext missing', init: NO_AC, url: fileUrl, during: async pg => { await pg.mouse.click(400, 300); } },
  { name: 'AudioContext throws', init: THROW_AC, url: fileUrl, during: async pg => { await pg.mouse.click(400, 300); await pg.keyboard.press('KeyX'); } },
  { name: 'AudioContext.resume rejects', init: RESUME_REJECT, url: fileUrl, during: async pg => { await pg.mouse.click(400, 300); } },
  { name: 'no navigator.getGamepads', init: NO_RAF_GAMEPAD, url: fileUrl },
  { name: 'DecompressionStream missing', init: NO_DS, url: fileUrl, packedOnly: true },
  { name: 'DecompressionStream w/o deflate-raw', init: DS_NORAW, url: fileUrl, packedOnly: true },
  { name: 'viewport 160x90', ctx: { viewport: { width: 160, height: 90 } }, url: fileUrl },
  { name: 'viewport 3840x2160 dpr1', ctx: { viewport: { width: 3840, height: 2160 } }, url: fileUrl },
  { name: 'portrait 390x844 dpr3 touch', ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, url: fileUrl },
  { name: 'dpr2 1280x720', ctx: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 }, url: fileUrl },
  { name: 'resize storm', url: fileUrl, during: async pg => { for (const [w, h] of [[300, 900], [1600, 400], [10, 10], [1, 1], [1200, 800], [960, 540]]) { await pg.setViewportSize({ width: w, height: h }); await sleep(60); } } },
];
(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out/host-sb-file.html'), host(`sandbox="allow-scripts" src="../../../${FILE}"`));
  const srv = await serve({ '/host-sb.html': host(`sandbox="allow-scripts" src="/${FILE}"`), '/host-srcdoc.html': host(`srcdoc="${esc(html)}"`), '/host-srcdoc-sb.html': host(`sandbox="allow-scripts" srcdoc="${esc(html)}"`) });
  const b = await launch(); let fails = 0;
  for (const c of cases) { if (FILTER && !c.name.includes(FILTER)) continue; if (c.packedOnly && FILE !== 'index.html') continue;
    const r = await runCase(b, srv, c); if (!r.ok) fails++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name.padEnd(40) + ' ' + r.notes.join(' ; ')); }
  // --disable-webgl at the browser level
  if (!FILTER || 'disable-webgl'.includes(FILTER)) { const b2 = await launch(['--disable-webgl', '--disable-3d-apis']); const r = await runCase(b2, srv, { name: 'chromium --disable-webgl', url: fileUrl, check: async (pg, fr) => (await probe(fr)).post === '2d' }); if (!r.ok) fails++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name.padEnd(40) + ' ' + r.notes.join(' ; ')); await b2.close(); }
  await b.close(); srv.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
