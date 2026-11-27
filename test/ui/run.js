#!/usr/bin/env node
// node test/ui/run.js [crt=0]  -> screenshots in test/ui/shots, asserts scene transitions, no page errors
const path = require('path'); const { chromium } = require('playwright');
const CRT = process.argv[2] === '1';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
  await p.goto('file://' + path.join(__dirname, 'index.html'));
  const ev = f => p.evaluate(f), wait = s => p.waitForTimeout(s * 1000);
  const shot = async n => { await p.screenshot({ path: path.join(__dirname, 'shots', n + '.png') }); };
  const mode = () => ev('__T.S.mode');
  let fails = 0; const expect = async (want, what) => { const m = await mode(); if (m !== want) { fails++; console.log('FAIL', what, 'expected', want, 'got', m); } else console.log('ok', what, '->', m); };
  const click = (x, y) => p.mouse.click(x * 2, y * 2);
  if (!CRT) await ev('__T.S.opt.crt=false');
  await wait(.6); await shot('01-boot'); await expect('boot', 'boot');
  await wait(1.4); await shot('02-boot-link');
  await p.keyboard.press('KeyX'); await wait(.3); await expect('title', 'boot skip by key');
  await wait(1.2); await shot('03-title');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await wait(.4); await shot('04-howto');
  await p.keyboard.press('KeyQ'); await wait(.3); await expect('title', 'howto closed');
  // genome title variant
  await ev(`__T.S.genome={gen:3,ids:Object.keys(__T.PATCH.all).filter(k=>__T.PATCH.all[k].kind==='up').slice(0,3),hi:0}; __T.S.hi=123456`); await wait(4); await shot('05-title-gen');
  await ev('__T.S.genome={gen:0,ids:[],hi:0}');
  // mouse: click START (menu y 117 +16*0)
  await p.mouse.move(240 * 2, 140 * 2); await wait(.1); await click(240, 113); await wait(.3); await expect('play', 'title START click');
  await ev(`setInterval(()=>{const p=__T.S.player; if(p){p.inv=9; if(p.hp<1)p.hp=1;}},50)`);
  await wait(2.5); await shot('06-play-hud');
  // ticker + bugs + boss
  await ev(`__T.PATCH.apply('uiScramble'); __T.PATCH.apply('uiMirror')`); await wait(.5); await shot('07-ticker-bugs');
  await ev(`(()=>{const bugs=Object.values(__T.PATCH.all).filter(p=>p.kind==='bug'&&p.n===0).slice(0,1); for(const b of bugs) __T.PATCH.apply(b.id);})()`); await wait(.3); await shot('07b-ticker-gamebug');
  await ev(`__T.PATCH.cure('uiMirror')`); await wait(.3);
  await ev(`__T.S.boss={hp:600,maxhp:1000,name:'SECTOR WARDEN // 0xC0DE',dead:false}; __T.S.player.hp=1; __T.S.score=987654; __T.S.combo=23; __T.S.mult=4`);
  await wait(.8); await shot('08-hud-boss-lowhp');
  await ev(`__T.UI.banner('SECTOR 2','HEAP OVERFLOW  //  4 WAVES + BOSS')`); await wait(.12); await shot('09-banner-in'); await wait(.6); await shot('09b-banner');
  await ev(`__T.BUS.emit('panic', new Error('x is not a function'), {name:'wpn.fire'})`); await wait(.5); await shot('10-panic-toast');
  await ev(`__T.S.boss=null; __T.PATCH.cure('uiScramble')`);
  await ev(`__T.IN.touch=true; Object.assign(__T.IN.sticks[0],{on:true,ox:80,oy:200,x:98,y:190}); Object.assign(__T.IN.sticks[1],{on:true,ox:400,oy:190,x:385,y:170});`); await wait(.3); await shot('11-touch-sticks');
  await ev(`__T.IN.touch=false; __T.IN.sticks[0].on=false; __T.IN.sticks[1].on=false; __T.S.player.hp=5`);
  // patch scene
  await ev(`__T.SCENE.go('patch',{picks:2})`); await wait(.8); await expect('patch', 'go patch'); await shot('12-patch-cards');
  await p.mouse.move(240 * 2, 80 * 2); await wait(.3); await shot('13-patch-hover2');
  await p.keyboard.press('Digit2'); await wait(.55); await shot('14-patch-diff-mid'); await wait(.5); await shot('15-patch-diff-ok');
  await wait(1.2); await expect('patch', 'second pick'); await shot('16-patch-pick2');
  await click(10 + 74, 80); await wait(.15); await shot('16b-diff-click');
  await p.keyboard.press('Enter'); await wait(.1); await p.keyboard.press('Enter'); await wait(.3); await expect('play', 'patch done (skip)');
  // patch scene with empty offer
  await ev(`(()=>{const o=__T.PATCH.offer; __T.PATCH.offer=()=>[]; __T.SCENE.go('patch'); __T.PATCH.offer=o;})()`); await wait(.2); await expect('play', 'empty offer leaves');
  // failing patch
  await ev(`__T.PATCH.def({id:'zzfail',name:'BROKEN()',desc:'NOPE -> NADA',kind:'up',weight:1e9,apply(){return __T.LIVE.patch('ui.wave','NOT_THERE','X');}})`);
  await ev(`__T.SCENE.go('patch')`); await wait(.6); await p.keyboard.press('Digit1'); await wait(.5); await shot('17-link-error');
  await ev(`delete __T.PATCH.all.zzfail`); await p.keyboard.press('Enter'); await wait(.3); await expect('play', 'link error continue');
  // pause
  await p.keyboard.press('Escape'); await wait(.5); await expect('pause', 'esc pause'); await shot('18-pause');
  await p.keyboard.press('Escape'); await wait(.2); await expect('play', 'esc resume');
  await p.keyboard.press('KeyP'); await wait(.3); await click(80, 52 + 15 * 2 + 7); await wait(.3); await expect('title', 'pause quit click');
  await p.keyboard.press('Enter'); await wait(.4); await expect('play', 'title enter start');
  await p.keyboard.press('Escape'); await wait(.3); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await wait(.3); await expect('play', 'pause restart key');
  await p.keyboard.press('Escape'); await wait(.3); await click(80, 52 + 7); await wait(.3); await expect('play', 'pause resume click');
  // over (no new hi)
  await ev(`__T.S.score=500; __T.S.hi=99999; __T.S.kills=77; __T.S.runTime=312; __T.SCENE.go('over')`); await wait(1.2); await expect('over', 'over'); await shot('19-over');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await wait(.3); await shot('20-over-export');
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter'); await wait(.3); await expect('title', 'over TITLE key');
  await p.keyboard.press('Enter'); await wait(.3);
  await ev(`__T.S.score=150000; __T.S.hi=150000; __T.SCENE.go('over')`); await wait(1.4); await shot('21-over-newhi');
  await click(240, 134 + 9); await wait(.3); await expect('play', 'over RETRY click');
  await ev(`__T.SCENE.go('over')`); await wait(1); await click(240, 134 + 18 + 9); await wait(.3); await expect('title', 'over TITLE click');
  // win
  await ev(`__T.S.score=424242; __T.SCENE.go('win')`); await wait(3); await expect('win', 'win'); await shot('22-win');
  await click(386, 186 + 14 + 7); await wait(.3); await expect('title', 'win title click');
  await ev(`__T.SCENE.go('win')`); await wait(1.2); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await wait(.3); await expect('title', 'win title key');
  console.log('sfx/music log tail:', JSON.stringify((await ev('__T.AU.log||[]')).slice(-12)));
  for (const e of errs) console.log(e);
  console.log(errs.length || fails ? `FAIL errors=${errs.length} fails=${fails}` : 'ALL OK');
  await b.close(); process.exit(errs.length || fails ? 1 : 0);
})();
