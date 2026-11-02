const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
(async()=>{
 const b=await chromium.launch(); const p=await b.newPage();
 await p.goto('file:///home/user/myproject2/defect-counter.html');
 console.log(await p.evaluate(()=>{
   const o=$('shiftSelect').options[0]; applyDelta('t1',1); applyDelta('t1',1);
   return {sameOption:o===$('shiftSelect').options[0], aria:document.querySelector('.tile[data-type-id="t1"]').getAttribute('aria-label')};
 }));
 await b.close();
})();
