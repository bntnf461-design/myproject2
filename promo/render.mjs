import { chromium } from 'playwright';
import fs from 'fs';
const DUR=JSON.parse(fs.readFileSync(process.env.DUR_FILE||'dur.json'));const TEXT=JSON.parse(fs.readFileSync('text.json'));
const NFR=JSON.parse(fs.readFileSync('fr/counts.json'));
const T=JSON.parse(fs.readFileSync('timing.json'));const FPS=30,N=Math.ceil(T.total*FPS);
const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1920,height:1080}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(([d,t,c,n])=>{window.DUR=d;window.TEXT=t;window.NFR=n;if(c)window.CREDIT=c;},[DUR,TEXT,process.env.CREDIT||'',NFR]);
await p.goto('file://'+process.cwd()+'/pr3.html');await p.evaluate(()=>READY);await p.waitForTimeout(800);
await p.evaluate(async()=>{for(let i=0;i<6;i++){await new Promise(r=>{const im=new Image();im.onload=r;im.src='grain'+i+'.png';});}});
fs.rmSync('frames',{recursive:true,force:true});fs.mkdirSync('frames');
for(let i=0;i<N;i++){await p.evaluate(t=>render(t),i/FPS);await p.screenshot({path:'frames/f'+String(i).padStart(5,'0')+'.jpg',type:'jpeg',quality:90});}
console.log('frames',N,errs);await b.close();
