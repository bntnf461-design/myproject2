const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const URL='file:///home/user/myproject2/defect-counter.html';
(async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1600,height:900},acceptDownloads:true}); const errs=[];
 const c=await ctx.newPage(); c.on('pageerror',e=>errs.push(e.message)); await c.goto(URL);
 await c.evaluate(()=>{const H={v:1,shifts:['製品A','製品B'],types:{},d:[],w:[]};const t=new Date();t.setHours(9,0,0,0);
   for(let d=0;d<7;d++)for(let i=0;i<5+d;i++)H.d.push([Math.round((t.getTime()-d*86400000+i*600000)/1000),['t1','t2','t3'][i%3],1,d%2,0]);
   // one undo on today: +1 then -1 on t4 -> net zero
   H.d.push([Math.round(t.getTime()/1000)+5000,'t4',1,0,0]); H.d.push([Math.round(t.getTime()/1000)+5010,'t4',-1,0,1]);
   H.w.push([Math.round((t.getTime()-86400000+3600000)/1000),Math.round((t.getTime()-86400000+3600000+1500000)/1000),0]);
   H.d.sort((a,b)=>a[0]-b[0]); localStorage.setItem('defectCounterHistory',JSON.stringify(H));});
 const r=await ctx.newPage(); r.on('pageerror',e=>errs.push(e.message)); await r.goto(URL+'#report'); await r.waitForTimeout(400);
 await r.click('button[data-preset="7d"]');
 const ex=await r.evaluate(()=>dkey(Date.now()-3*86400000)); await r.click(`button[data-ex="exDefect"][data-k="${ex}"]`); await r.click(`button[data-ex="exDown"][data-k="${ex}"]`);
 const expected=await r.evaluate(()=>rpAgg(null).total);
 const [dl]=await Promise.all([r.waitForEvent('download'), r.click('#rpExcel')]);
 await dl.saveAs('xl_out/export.xlsx');
 console.log('filename:', dl.suggestedFilename(), '| expected total', expected, '| excluded', ex);
 console.log('notice:', await r.textContent('#rpKeyNote'));
 await r.evaluate(()=>{document.querySelector('#rpPanel').scrollTop=0}); await r.locator('#rpPanel').screenshot({path:'panel_excel.png'});
 console.log('errors', errs); await b.close();
})();
