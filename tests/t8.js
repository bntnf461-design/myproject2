const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const URL='file:///home/user/myproject2/defect-counter.html';
const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
(async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1600,height:900}}); await ctx.addInitScript(require('./nojobs.js')); const errs=[];
 const mk=async u=>{const p=await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message)); await p.goto(u); return p;};
 const c=await mk(URL); await c.waitForTimeout(300);
 const r=await mk(URL+'#report'); await r.waitForTimeout(500);
 const tot=()=>c.evaluate(()=>total());
 // mouse op in report, then numpad
 await r.click('#rpNext'); await r.keyboard.press('Numpad1'); await r.keyboard.press('Numpad2'); await r.waitForTimeout(300);
 ok(await tot()===2, 'numpad in report tab counts in counter tab: total='+await tot());
 ok((await r.textContent('#rpKeyNote')).includes('汚れ'), 'report shows what was sent: '+await r.textContent('#rpKeyNote'));
 // Enter must not activate the focused button, but toggles downtime in counter
 const idx0=await r.evaluate(()=>rpIndex); await r.focus('#rpNext'); await r.keyboard.press('NumpadEnter'); await r.waitForTimeout(300);
 ok(await r.evaluate(()=>rpIndex)===idx0, 'Enter did not press the focused 次へ button');
 ok(await c.evaluate(()=>state.downtime.running), 'Enter from report toggled downtime in counter');
 await r.keyboard.press('Enter'); await r.waitForTimeout(300); ok(!(await c.evaluate(()=>state.downtime.running)),'Enter again stops downtime');
 // undo + minus mode via report
 await r.keyboard.press('Numpad0'); await r.waitForTimeout(200); ok(await tot()===1,'0 (undo) forwarded');
 await r.keyboard.press('NumpadSubtract'); await r.keyboard.press('Numpad1'); await r.waitForTimeout(300); ok(await tot()===0,'minus mode + 1 forwarded');
 // * then * resets via report (confirm flow)
 await r.keyboard.press('Numpad3'); await r.waitForTimeout(200); await r.keyboard.press('NumpadMultiply'); await r.waitForTimeout(350);
 ok(await c.evaluate(()=>state.brk.running),'* via report starts break');
 await r.keyboard.press('Numpad1'); await r.waitForTimeout(200); ok(await tot()===2,'digits count during break (via report)');
 await r.keyboard.press('NumpadMultiply'); await r.waitForTimeout(300); ok(await c.evaluate(()=>!state.brk.running),'* via report ends break');
 await r.keyboard.press('Numpad0'); await r.waitForTimeout(300);
 ok(await tot()===1,'undo after break');
 // date input typing is not hijacked
 await r.click('#rpFrom'); await r.keyboard.press('Numpad1'); await r.waitForTimeout(200); ok(await tot()===1,'typing in date input is not forwarded');
 // second counter tab: no double counting
 const c2=await mk(URL); await c2.waitForTimeout(300);
 await r.bringToFront(); await r.click('#rpPrev'); await r.keyboard.press('Numpad1'); await r.waitForTimeout(400);
 const t1=await c.evaluate(()=>total()), t2=await c2.evaluate(()=>total());
 ok(await c2.evaluate(()=>JSON.parse(localStorage.getItem('defectCounterState')).counts.t1)===1, `single count with 2 counter tabs (tab1 view ${t1}, tab2 view ${t2})`);
 // counter closed -> warning in report
 await c.close(); await c2.close(); await r.evaluate(()=>localStorage.setItem('defectCounterActiveTab', JSON.stringify({id:'x',t:Date.now()-60000})));
 await r.keyboard.press('Numpad1'); await r.waitForTimeout(200);
 ok((await r.textContent('#rpKeyNote')).includes('開いていない'),'warns when counter tab is not open');
 await r.screenshot({path:'rp_keynote.png'});
 console.log('errors',errs); await b.close();
})();
