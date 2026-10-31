import { chromium } from 'playwright';
import fs from 'fs';
const DUR=JSON.parse(fs.readFileSync(process.env.DUR_FILE||'dur.json'));
const b=await chromium.launch({executablePath:process.env.CHROME||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage();await p.addInitScript(d=>{window.DUR=d;},DUR);
await p.goto('file://'+process.cwd()+'/pr3.html');await p.waitForTimeout(500);
fs.writeFileSync('timing.json',JSON.stringify(await p.evaluate(()=>({total:TOTAL,voice:VOICE_AT}))));await b.close();
