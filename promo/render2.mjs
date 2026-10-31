import { chromium } from 'playwright';
import fs from 'fs';
const DUR=JSON.parse(fs.readFileSync(process.env.DUR_FILE||'dur.json'));const T=JSON.parse(fs.readFileSync('timing.json'));
const FPS=30, N=Math.ceil(T.total*FPS);
const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1920,height:1080}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(([d,c])=>{window.DUR=d;if(c)window.CREDIT=c;},[DUR,process.env.CREDIT||'']);
await p.goto('file://'+process.cwd()+'/pr2.html');await p.waitForTimeout(1500);
// 粒子の画像を先に読み込んでおく
await p.evaluate(async()=>{for(let i=0;i<6;i++){await new Promise(r=>{const im=new Image();im.onload=r;im.src='grain'+i+'.png';});}});
const t0=Date.now();
for(let i=0;i<N;i++){await p.evaluate(t=>render(t),i/FPS);await p.screenshot({path:'frames2/f'+String(i).padStart(5,'0')+'.jpg',type:'jpeg',quality:90});}
console.log('frames',N,'in',Math.round((Date.now()-t0)/1000),'s',errs);await b.close();
