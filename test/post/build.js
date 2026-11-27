#!/usr/bin/env node
// Builds test/post/index.html = kernel + 70-post.js + driver.js in one strict scope (like tools/build.js).
// ?nogl in the URL makes getContext('webgl*') return null to exercise the 2D fallback.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const parts = ['src/00-kernel.js', 'src/70-post.js', 'test/post/driver.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8'));
const code = "(()=>{'use strict';\n" + parts.join('\n;\n') + '\n})();';
const pre = "<script>if(/nogl/.test(location.search)){const g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,o){return /webgl/.test(t)?null:g.call(this,t,o)}}</script>";
fs.writeFileSync(path.join(__dirname, 'index.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000">' + pre + '<script>' + code + '</script></body></html>');
console.log('built test/post/index.html');
