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

// 実機のバックアップ（master-data/ に置いたもの。git には入れない）を同梱した版：robot-sim-master.html
//   node tools/build-single.js [バックアップのフォルダ]
// 開くと自動で取り込まれる。社外に出さないこと。
const mdir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'master-data');
if (fs.existsSync(mdir)) {
  const KEEP = /\.JBI$|^(TOOL\.CND|VAR\.DAT|IONAME\.DAT|VARNAME\.DAT|SYSTEM\.SYS)$/i;
  const files = {};
  const walk = d => { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) walk(q); else if (KEEP.test(f)) files[f] = fs.readFileSync(q).toString('base64'); } };
  walk(mdir);
  const n = Object.keys(files).length;
  if (n) {
    const id = require('crypto').createHash('sha1').update(JSON.stringify(files)).digest('hex').slice(0, 12);
    const tag = `<script>/* 実機バックアップ（社外秘） */\nwindow.RS_MASTER_ID=${JSON.stringify(id)};window.RS_MASTER_FILES=${JSON.stringify(files)};\n</script>\n`;
    const i = html.indexOf('<script>/* js/app.js */');
    if (i < 0) throw new Error('app.js の位置が見つかりません');
    const out2 = path.join(root, 'robot-sim-master.html');
    fs.writeFileSync(out2, html.slice(0, i) + tag + html.slice(i));
    console.log(`${out2}  ${(fs.statSync(out2).size / 1024).toFixed(0)} KB（実機データ ${n} ファイル同梱。git には入れない）`);
  }
}
