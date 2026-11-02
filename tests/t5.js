const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
(async()=>{
 const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1200,height:800}});
 await p.goto('file:///home/user/myproject2/defect-counter.html');
 await p.evaluate(()=>{ const n=Date.now(); state.shiftStart=new Date(n-3*3600000).toISOString();
   state.downtime.events=[{start:new Date(n-2.5*3600000).toISOString(),end:new Date(n-2.1*3600000).toISOString()}];
   ['t1','t1','t2','t3'].forEach(id=>applyDelta(id,1)); openChart('hourly'); });
 await p.screenshot({path:'hourly.png'});
 await p.evaluate(()=>{closeChart(); askResetAll();}); await p.screenshot({path:'confirm.png'});
 await b.close();
})();
