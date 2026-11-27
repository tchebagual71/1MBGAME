// shared helpers for the robustness suite
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..');
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];
const launch = (extra) => chromium.launch({ args: ARGS.concat(extra || []) });

// tiny static server over the repo root (+ optional virtual files)
function serve(virt) {
  virt = virt || {};
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    if (virt[u] != null) { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end(virt[u]); }
    const f = path.join(ROOT, path.normalize(u));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, url: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() })));
}

// attach console/pageerror collectors; warnings from the GL driver are ignored
function collect(page, tag) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE.ERROR ' + m.text().slice(0, 400)); });
  page.on('crash', () => errs.push('CRASH'));
  return errs;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { ROOT, ARGS, launch, serve, collect, sleep, chromium };
