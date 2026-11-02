const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const URL='file:///home/user/myproject2/defect-counter.html';
const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
(async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1920,height:1080}}); await ctx.addInitScript(require('./nojobs.js'));
 const errs=[]; const watch=p=>{p.on('pageerror',e=>errs.push(p.url().slice(-8)+': '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});};
 const c=await ctx.newPage(); watch(c); await c.goto(URL); await c.click('h1');
 // counter records into history
 await c.keyboard.press('Numpad1'); await c.keyboard.press('Numpad2'); await c.keyboard.press('Numpad0');
 await c.keyboard.press('NumpadEnter'); await c.waitForTimeout(1200); await c.keyboard.press('NumpadEnter');
 let h=await c.evaluate(()=>JSON.parse(localStorage.getItem('defectCounterHistory')));
 ok(h.d.length===3 && h.w.length===1, `history recorded: d=${h.d.length} w=${h.w.length}`);
 await c.click('#resetBtn'); await c.waitForTimeout(300); await c.keyboard.press('NumpadMultiply');
 h=await c.evaluate(()=>JSON.parse(localStorage.getItem('defectCounterHistory')));
 ok(await c.evaluate(()=>total())===0 && h.d.length===3, 'reset clears counts but keeps history');
 // seed 30 days of synthetic history
 await c.evaluate(()=>{
   const H={v:1,shifts:['製品A','製品B','製品C'],types:{},d:[],w:[]}; state.types.forEach(t=>H.types[t.id]={n:t.name,c:t.color});
   let seed=7; const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
   const today=new Date(); today.setHours(0,0,0,0);
   for(let day=29; day>=0; day--){ const base=today.getTime()-day*86400000;
     for(let si=0;si<3;si++){ const n=Math.floor(rnd()*12)+(si===1?8:2) + (day===12&&si===0?60:0);
       for(let i=0;i<n;i++){ const ts=base+ (8+rnd()*9)*3600000; const r=rnd(); const id=r<.45?'t1':r<.7?'t2':r<.85?'t3':r<.95?'t4':'t5'; H.d.push([Math.round(ts/1000),id,1,si,0]); }
       if(rnd()<.6){ const s=base+(9+rnd()*7)*3600000; H.w.push([Math.round(s/1000),Math.round((s+(5+rnd()*50)*60000)/1000),si]); } } }
   H.d.sort((a,b)=>a[0]-b[0]); localStorage.setItem('defectCounterHistory',JSON.stringify(H)); hist=H;
 });
 // report tab
 const r=await ctx.newPage(); watch(r); await r.goto(URL+'#report'); await r.waitForTimeout(400);
 ok(await r.evaluate(()=>document.body.classList.contains('report-mode') && getComputedStyle(document.querySelector('.wrap')).display==='none'),'report mode hides counter');
 await r.keyboard.press('Numpad1'); ok(await r.evaluate(()=>total())===0,'numpad does nothing in report tab');
 await r.click('#rpPlay'); // pause
 const n=await r.evaluate(()=>rpSlides.length); console.log('slides in playlist:', n, await r.evaluate(()=>rpSlides.map(s=>s.id+':'+(s.scope||'ALL')).slice(0,12).join(' ')));
 // capture each slide type once (for ALL scope) mid-animation and final
 const ids=['summary','pie','pareto','daily','trend','hourly','down','cmpDefect','cmpMix','cmpDown'];
 for(const id of ids){ const idx=await r.evaluate(id=>rpSlides.findIndex(s=>s.id===id),id); if(idx<0){console.log('missing',id);continue;}
   await r.evaluate(i=>rpShow(i),idx); await r.waitForTimeout(350); await r.screenshot({path:`rp_${id}_mid.png`}); await r.waitForTimeout(1900); await r.screenshot({path:`rp_${id}.png`}); }
 // exclusion by mouse: click the day with the spike (day 12 ago)
 const spike=await r.evaluate(()=>dkey(Date.now()-12*86400000));
 const before=await r.evaluate(()=>rpAgg(null).total);
 await r.click(`button[data-ex="exDefect"][data-k="${spike}"]`);
 const after=await r.evaluate(()=>rpAgg(null).total);
 ok(after<before && await r.evaluate(k=>rp.exDefect.includes(k),spike), `exclude day by click: ${before} -> ${after}`);
 await r.screenshot({path:'rp_panel_excluded.png'});
 await r.click(`button[data-ex="exDefect"][data-k="${spike}"]`); ok(await r.evaluate(()=>rpAgg(null).total)===before,'click again re-includes');
 // live sync: count in counter tab -> report updates
 await c.bringToFront(); await c.click('h1'); const t0=await r.evaluate(()=>rpData.items.length);
 await c.keyboard.press('Numpad3'); await r.waitForTimeout(1200);
 ok(await r.evaluate(()=>rpData.items.length)===t0+1,'report reflects new count from counter tab');
 // presets & slide deselect
 await r.bringToFront(); await r.click('button[data-preset="7d"]'); ok(await r.evaluate(()=>rp.preset)==='7d','preset click');
 await r.click('#rpAllOff'); ok(await r.evaluate(()=>rpSlides.length)===0,'deselect all -> empty playlist');
 await r.click('#rpAllOn'); await r.uncheck('input[data-slide="trend"]'); ok(!(await r.evaluate(()=>rpSlides.some(s=>s.id==='trend'))),'uncheck removes slide');
 await r.uncheck('#rpSplit'); ok(await r.evaluate(()=>rpSlides.every(s=>s.scope===null)),'split off -> combined slides');
 // keymap
 await c.bringToFront(); await c.click('h1'); await c.keyboard.press('NumpadDivide'); await c.keyboard.press('Numpad8');
 ok(await c.evaluate(()=>keymapOpen),'menu 8 opens keymap'); await c.screenshot({path:'keymap.png'});
 await c.emulateMedia({media:'print'}); await c.screenshot({path:'keymap_print.png'}); await c.emulateMedia({media:'screen'});
 await c.keyboard.press('NumpadDivide'); ok(!(await c.evaluate(()=>keymapOpen)),'/ closes keymap');
 console.log('errors:',errs); await b.close();
})();
