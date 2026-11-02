const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
(async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({acceptDownloads:true}); await ctx.addInitScript(require('./nojobs.js')); const p=await ctx.newPage();
 const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 await p.goto('file:///home/user/myproject2/defect-counter.html'); await p.click('h1');
 const ev=f=>p.evaluate(f); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 await p.keyboard.press('Numpad1'); await p.keyboard.press('Digit1');
 ok(await ev(()=>total())===2,'numpad & main digits count');
 // 1 * then Enter cancels
 await p.click('#resetBtn'); await sleep(300); await p.keyboard.press('NumpadEnter');
 ok(await ev(()=>total())===2 && !(await ev(()=>!!confirmState)),'reset button then Enter cancels (no reset)');
 ok(await ev(()=>state.downtime.running)===false,'Enter in confirm does not toggle downtime');
 // main kbd * (Shift+8 US) then * confirm
 await p.keyboard.press('Shift+Digit8'); ok(await ev(()=>state.brk.running),'main-keyboard * starts break');
 ok(await ev(()=>total())===2,'Shift+8 did not count as 8');
 await p.keyboard.press('Numpad1'); ok(await ev(()=>total())===3,'digits count during break');
 await sleep(300); await p.keyboard.press('NumpadMultiply'); ok(await ev(()=>!state.brk.running),'* again ends break');
 await p.click('#resetBtn'); await sleep(300); await p.keyboard.press('NumpadMultiply');
 ok(await ev(()=>total())===0,'reset button + * executes reset');
 // 4 ctrl keys
 await p.keyboard.press('Control+Minus'); ok(!(await ev(()=>minusMode)),'Ctrl+- ignored');
 await p.keyboard.press('Control+Digit1'); ok(await ev(()=>total())===0,'Ctrl+1 ignored');
 // 5 . shift confirm
 await p.keyboard.press('Period'); ok(await ev(()=>pickOpen && state.currentShift==='製品A'),'. opens product picker, no silent switch');
 await p.keyboard.press('Digit2'); await p.keyboard.press('Enter'); ok(await ev(()=>state.currentShift)==='製品B' && !(await ev(()=>pickOpen)),'number 2 + Enter switches to 製品B');
 // 7 multi undo & zero minus
 await p.keyboard.press('Digit1'); await p.keyboard.press('Digit2'); await p.keyboard.press('Digit2');
 await p.keyboard.press('Minus'); await p.keyboard.press('Digit3'); // zero -> no-op
 await p.keyboard.press('Digit0'); await p.waitForTimeout(120); await p.keyboard.press('Digit0'); await p.waitForTimeout(120); // 人が押す速さ（すぐ続く 0 は「00」キーとして1回にする）
 ok(JSON.stringify(await ev(()=>state.counts))===JSON.stringify({t1:1,t2:0}),'multi-level undo, 0-count minus does not eat history: '+JSON.stringify(await ev(()=>state.counts)));
 await p.keyboard.press('Digit0'); await p.waitForTimeout(120); await p.keyboard.press('Digit0'); await p.waitForTimeout(120); // 人が押す速さ（すぐ続く 0 は「00」キーとして1回にする）
 ok(await ev(()=>total())===0,'undo exhausts gracefully');
 // 2 hourly consistency incl. cross-hour undo & minus
 await ev(()=>{ const h=new Date(); h.setMinutes(0,0,0); const T=x=>new Date(h.getTime()+x).toISOString();
   state.shiftStart=T(-7200000); state.counts={t1:1,t2:1};
   state.log=[{ts:T(-5000000),typeId:'t1',delta:1,shift:'製品A'},{ts:T(-60000),typeId:'t1',delta:1,shift:'製品A'},
     {ts:T(60000),typeId:'t1',delta:-1,shift:'製品B'},{ts:T(-4000000),typeId:'t2',delta:1,shift:'製品A'},
     {ts:T(70000),typeId:'t2',delta:-1,shift:'製品B'},{ts:T(80000),typeId:'t2',delta:1,undo:true,shift:'製品B'}]; });
 const hr=await ev(()=>hourlyData().map(r=>r.total));
 ok(hr.reduce((a,b)=>a+b,0)===await ev(()=>total()) && hr.every(v=>v>=0),'hourly sums to total: '+JSON.stringify(hr));
 // 3 delete-all blocked
 await ev(()=>{openSettings(); draftTypes=[]; renderTypeRows();}); await p.click('#saveSettingsBtn');
 ok(await ev(()=>state.types.length)===5 && await ev(()=>settingsOpen),'cannot save zero types');
 await p.keyboard.press('Escape'); ok(await ev(()=>settingsOpen),'Esc with changes asks first');
 await p.keyboard.press('Escape'); ok(!(await ev(()=>settingsOpen)),'2nd Esc discards');
 // two-step delete for type with counts
 await ev(()=>openSettings()); const delBtns=p.locator('#typeRows .typerow-controls > button:last-child');
 await delBtns.first().click(); ok(await ev(()=>draftTypes.length)===5,'first delete click only arms');
 await delBtns.first().click(); ok(await ev(()=>draftTypes.length)===4,'second click deletes');
 await p.click('#saveSettingsBtn');
 // 12 NaN repair
 await ev(()=>{ localStorage.setItem(STORE_KEY, JSON.stringify({...state, downtime:{running:true,currentStart:null,events:[{start:'x',end:null}]}})); });
 await p.reload(); ok(!(await p.textContent('#downTimer')).includes('NaN'),'corrupt downtime repaired');
 // + key: CSV save removed -> no download, explanatory notice, counts untouched
 let downloaded=false; p.on('download',()=>{downloaded=true;});
 const tBefore=await ev(()=>total());
 await p.click('h1'); await p.keyboard.press('NumpadAdd'); await p.keyboard.press('Shift+Equal'); await p.waitForTimeout(500);
 ok(!downloaded && await ev(()=>total())===tBefore, '+ key no longer saves anything and does not count');
 ok((await p.textContent('#toast')).includes('Excelファイルに出力'), '+ key shows where to get data now');
 ok(!(await p.$('#saveBtn')), 'CSV button removed from footer');
 ok(await ev(()=>typeof doSaveCsv==='undefined'), 'CSV code removed');
 // 19 select not rebuilt on count
 const same=await ev(()=>{const o=$('shiftSelect').options[0]; applyDelta(state.types[0].id,1); return o===$('shiftSelect').options[0];});
 ok(same,'select options not rebuilt on count');
 // 17 aria
 const aria=await ev(()=>{const t=state.types[0];return {got:document.querySelector(`.tile[data-type-id="${t.id}"]`).getAttribute('aria-label'), want:`${t.name} 現在${state.counts[t.id]||0}${unit()}`};});
 ok(aria.got===aria.want,`aria-label updated for the counted tile (${aria.got})`);
 // charts render
 for (const m of ['pie','hourly','downlog']) { await ev(m=>openChart(m),m); await ev(()=>closeChart()); }
 // storage sync
 const p2=await ctx.newPage(); await p2.goto('file:///home/user/myproject2/defect-counter.html');
 await p2.evaluate(()=>applyDelta(state.types[0].id,1)); await sleep(200);
 ok(await ev(()=>state.counts[state.types[0].id])===await p2.evaluate(()=>state.counts[state.types[0].id]),'other tab change synced');
 // small screen sticky
 await p.setViewportSize({width:390,height:800}); ok(await ev(()=>getComputedStyle(document.querySelector('.topbar')).position)==='static','topbar not sticky on phone');
 console.log('errors:',errs);
 await b.close();
})();
