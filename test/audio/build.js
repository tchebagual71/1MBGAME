#!/usr/bin/env node
// Build test/audio/harness.html = real kernel + 30-audio.js in one strict scope, exposing internals to window.__T
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const rd = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const code = "(()=>{'use strict';\n" + rd('00-kernel.js') + '\n;\n' + rd('30-audio.js') + '\n;\nwindow.__T = { AU, S, LIVE, PATCH, BUS };\n})();';
const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>AU harness</title></head><body><script>' +
  code.replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
fs.writeFileSync(path.join(__dirname, 'harness.html'), html);
console.log('harness.html', html.length, 'bytes');
