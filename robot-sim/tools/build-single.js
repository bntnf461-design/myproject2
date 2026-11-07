// node tools/build-single.js
// index.html と css・js・three.js を 1 つの HTML（robot-sim.html）にまとめる。
// できたファイルは単体で配布でき、ダブルクリックで開けます（オフライン動作）。
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const safeJs = s => s.replace(/<\/script/gi, '<\\/script');

// CSS
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) =>
  `<style>\n${fs.readFileSync(path.join(root, href), 'utf8')}\n</style>`);
// CDN 予備の読み込みは不要（three.js を埋め込むため）
html = html.replace(/<script>window\.THREE \|\| document\.write\([^\n]*<\/script>\n?/, '');
// JS
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
  `<script>/* ${src} */\n${safeJs(fs.readFileSync(path.join(root, src), 'utf8'))}\n</script>`);
if (/<script src=|<link rel="stylesheet"/.test(html)) throw new Error('埋め込めなかった外部ファイルがあります');
html = html.replace('<head>', '<head>\n<!-- robot-sim 単一ファイル版（tools/build-single.js で生成。編集は元のファイルで行うこと） -->');
const out = path.join(root, 'robot-sim.html');
fs.writeFileSync(out, html);
console.log(`${out}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
