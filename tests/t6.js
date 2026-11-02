const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
(async()=>{
 const b=await chromium.launch(); const errs=[];
 async function shot(w,h,nine,name){
  const p=await b.newPage({viewport:{width:w,height:h}}); p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file:///home/user/myproject2/defect-counter.html');
  await p.evaluate(nine=>{ localStorage.clear(); state=loadState();
    if(nine){ const extra=[["t6",6,"バリ","teal"],["t7",7,"欠け","pink"],["t8",8,"色ムラ","brown"],["t9",9,"その他の不良（長い名前のテスト）","coral"]];
      extra.forEach(([id,key,name,color])=>state.types.push({id,key,name,color})); }
    const c={t1:23,t2:11,t3:7,t4:3,t5:1,t6:5,t7:0,t8:2,t9:1}; state.types.forEach(t=>state.counts[t.id]=c[t.id]); renderAll(); },nine);
  const m=await p.evaluate(()=>({sw:document.documentElement.scrollWidth, sh:document.documentElement.scrollHeight, iw:innerWidth, ih:innerHeight,
    tiles:[...document.querySelectorAll('.tile')].map(t=>Math.round(t.getBoundingClientRect().bottom)), foot:Math.round(document.querySelector('.footer-actions').getBoundingClientRect().bottom),
    side:Math.round(document.querySelector('.side').getBoundingClientRect().bottom), bd:getComputedStyle(document.querySelector('.breakdown')).display}));
  console.log(name, JSON.stringify(m));
  await p.screenshot({path:name+'.png'}); await p.close();
 }
 await shot(1920,1080,false,'fhd5'); await shot(1920,1080,true,'fhd9'); await shot(1366,768,true,'hd9'); await shot(1280,600,true,'small9'); await shot(390,844,false,'phone');
 console.log('errors',errs); await b.close();
})();
