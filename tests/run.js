// 日報（index.html）の自動テスト
//   NODE_PATH=$(npm root -g) node tests/run.js          … 全部
//   NODE_PATH=$(npm root -g) node tests/run.js h1 qr    … 名前に h1 か qr を含むテストだけ
// Playwright（Chromium）が必要。ファイルの場所はこのフォルダからの相対で決める。
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html");
const TEMPLATE = path.join(ROOT, "templates", "マスタ登録_雛形.xlsx");
const QR_042 = "A0DGL35TS    ,A3I,A7813   ,A8508   ,AA32.00 ,AB20.00 ,AD175 ,B0R7Z446SX042,B42,BB2026/10/18,BR2N9A,00271A21261061,010020";
const MODEL = "ZC45PN-ARDR";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- 道具 ----------
async function open(ctx, now) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("dialog", d => d.accept());
  if (now) await p.clock.setFixedTime(new Date(now));
  await p.goto(URL);
  return p;
}
const v = (p, n) => p.evaluate(n => document.forms.nippo.elements[n].value, n);
async function setDate(p, d) {
  await p.evaluate(d => { const e = document.forms.nippo.elements.workDate; e.value = d; e.dispatchEvent(new Event("change", { bubbles: true })); }, d);
  await p.waitForTimeout(600);
}
async function fill(p, n, val) { await p.fill(`[name="${n}"]`, String(val)); }
async function pickModel(p, r, m = MODEL) { await fill(p, `r${r}_model`, m); await p.dispatchEvent(`[name="r${r}_model"]`, "change"); }
async function importMaster(p) {
  await p.click("#btnSettings");
  await p.setInputFiles("#mImport", TEMPLATE);
  await p.waitForTimeout(300);
  await p.click("#dlgSave");
}
async function addModel(p, m) {
  await p.evaluate(m => { const k = "nline-nippo-master"; const d = JSON.parse(localStorage.getItem(k) || "{}"); d.models = (d.models || []).concat([m]); localStorage.setItem(k, JSON.stringify(d)); }, m);
}
async function scanQR(p, s) { await p.keyboard.type(s, { delay: 3 }); await p.keyboard.press("Enter"); await p.waitForTimeout(250); }
const savedKeys = p => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("nline-nippo:") && k !== "nline-nippo:last").sort());
const saved = (p, d) => p.evaluate(d => JSON.parse(localStorage.getItem("nline-nippo:" + d) || "null"), d);
function eq(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label}: 期待 ${JSON.stringify(expected)}／実際 ${JSON.stringify(actual)}`);
}
function ok(cond, label) { if (!cond) throw new Error(label); }

// 前日 10/20：ロット 261020-08NK に良品13、素板 R7Z446SX061 の当残102
async function makePrevDay(p) {
  await importMaster(p);
  await setDate(p, "2026-10-20");
  await pickModel(p, 1);
  await fill(p, "r1_lotCut", "261020-08NK");
  await fill(p, "r1_good", 13);
  await fill(p, "r1_qty", 73);
  await fill(p, "r1_lotSoban", "R7Z446SX061");
  await fill(p, "sb1_name", "DGL35TS");
  await p.evaluate(() => { const f = document.forms.nippo.elements; f.sb1_lots.value = JSON.stringify([{ lot: "R7Z446SX061", qty: "175" }]); f.r1_qty.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.waitForTimeout(700);
}

// ---------- テスト ----------
test("見本10/21の再現（引継ぎ・QR・採番・合計・当残・歩留）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  await setDate(p, "2026-10-21");
  eq(await v(p, "prevLot"), "261020-08NK", "前日ロット");
  eq(await v(p, "prevGood"), "13", "前日端数");
  eq(await v(p, "r1_lotSoban"), "R7Z446SX061", "1行目の素板ロット");
  eq(await v(p, "sb1_mae"), "102", "前残");
  await fill(p, "r1_good", 102);
  await p.click('[name="topics"]');
  await scanQR(p, QR_042);
  eq(await v(p, "topics"), "", "QRの文字が欄に残らない");
  eq(await v(p, "r2_lotSoban"), "R7Z446SX042", "2行目の素板ロット");
  eq(await v(p, "r2_lotCut"), "261020-08NK", "2行目のロット");
  eq(await v(p, "r2_good"), "20", "2行目の良品");
  await pickModel(p, 3);
  await pickModel(p, 4);
  eq(await v(p, "r3_lotCut"), "261021-01NK", "3行目のロット");
  eq(await v(p, "r4_lotCut"), "261021-02NK", "4行目のロット");
  await fill(p, "r4_good", 13);
  await fill(p, "r4_kizu", 1); await fill(p, "r4_ori_hama", 1); await fill(p, "r4_proc_other", 5);
  await p.waitForTimeout(200);
  eq(await v(p, "r4_qty"), "20", "4行目の作業枚数");
  eq(await v(p, "t_qty"), "277", "作業枚数合計");
  eq(await v(p, "t_good"), "270", "良品合計");
  eq(await v(p, "t_yield"), "97.4%", "歩留（紙と同じく小数1桁で切り捨て）");
  eq(await v(p, "sb1_to"), "0", "当残");
  eq(p.errors.join(), "", "ページのエラー");
});

test("印刷：A3横1枚・シール欄55mm", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.emulateMedia({ media: "print" });
  await p.setViewportSize({ width: Math.round(408 * 96 / 25.4), height: 600 });
  const m = await p.evaluate(() => ({
    h: document.querySelector(".sheet").getBoundingClientRect().height,
    seals: [...document.querySelectorAll(".seal")].map(s => [s.getBoundingClientRect().width, s.getBoundingClientRect().height])
  }));
  ok(m.h <= 285 * 96 / 25.4, "A3の高さ（285mm）に収まらない：" + (m.h * 25.4 / 96).toFixed(1) + "mm");
  eq(m.seals.length, 6, "シール欄の数");
  m.seals.forEach(([w, h]) => ok(Math.abs(w * 25.4 / 96 - 55) < 0.3 && Math.abs(h * 25.4 / 96 - 55) < 0.3, "シール欄が55mmでない"));
  const pdf = path.join(os.tmpdir(), "nippo-print-test.pdf");
  await p.pdf({ path: pdf, format: "A3", landscape: true, preferCSSPageSize: true });
  const pages = (fs.readFileSync(pdf, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  eq(pages, 1, "印刷のページ数");
});

test("H1：起動すると今日の日報を開く（前回の日付ではなく）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await fill(p, "topics", "21日の入力"); await p.waitForTimeout(700);
  await p.close();
  const q = await open(ctx, "2026-10-22T08:00:00");
  eq(await v(q, "workDate"), "2026-10-22", "起動時の作業日");
  eq(await v(q, "topics"), "", "前日の内容が出ていない");
});

test("H2：日付を打っている途中の日付で保存しない／開いただけでは保存しない", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.click('[name="workDate"]');
  await p.keyboard.type("20261022", { delay: 30 });
  await p.keyboard.press("Tab");
  await p.waitForTimeout(800);
  const keys = await savedKeys(p);
  ok(keys.every(k => /^nline-nippo:20\d\d-\d\d-\d\d$/.test(k)), "おかしな日付の保存がある：" + keys.join(", "));
  await setDate(p, "2026-10-23"); await setDate(p, "2026-10-22");
  ok(!(await savedKeys(p)).includes("nline-nippo:2026-10-23"), "開いただけの 10/23 が保存された");
});

test("H2：引継ぎは入力のある日報から（空の日報は飛ばす）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  // 何も入力しない日を保存させても、引継ぎ元にならない
  await p.evaluate(() => localStorage.setItem("nline-nippo:2026-10-21", JSON.stringify({ workDate: "2026-10-21" })));
  await setDate(p, "2026-10-22");
  eq(await v(p, "prevLot"), "261020-08NK", "空の日報を飛ばして 10/20 から引継ぐ");
});

test("H3：ボタンやレ点の上でQRを読んでも、ボタンが押されずレ点も変わらない", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await p.click("#btnPrint");
  await scanQR(p, QR_042);
  eq(await p.evaluate(() => window.__prints), 1, "印刷の回数（クリックの1回だけ）");
  eq(await v(p, "r1_lotSoban"), "R7Z446SX042", "QRは読めている");
  await p.click('[name="dispose_ware"]');
  await scanQR(p, QR_042.replace("SX042", "SX043"));
  eq(await p.isChecked('[name="dispose_ware"]'), true, "レ点が変わらない");
  eq(await v(p, "r2_lotSoban"), "R7Z446SX043", "2つ目のQRも読めている");
});

test("H4：同じ日報を2つのタブで開いても、入力が消えない", async ctx => {
  const a = await open(ctx, "2026-10-21T08:00:00");
  const b = await open(ctx, "2026-10-21T08:00:00");
  await a.bringToFront();
  await fill(a, "r1_kizu", 2); await a.waitForTimeout(700);
  await b.bringToFront();
  const bEditable = await b.isEditable('[name="topics"]');
  if (bEditable) { await fill(b, "topics", "B"); await b.waitForTimeout(700); }
  const d = await saved(a, "2026-10-21");
  eq(d && d.r1_kizu, "2", "タブAの入力が残る");
});

test("M2：日報でないJSONを読み込んでも、画面と保存が消えない", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await fill(p, "topics", "残す"); await p.waitForTimeout(700);
  const f = path.join(os.tmpdir(), "not-nippo.json");
  fs.writeFileSync(f, JSON.stringify({ app: "defect-counter", hist: { d: [] } }));
  await p.setInputFiles("#fileImport", f); await p.waitForTimeout(300);
  eq(await v(p, "workDate"), "2026-10-21", "作業日");
  eq(await v(p, "topics"), "残す", "入力");
});

test("M1：型式が変わったら新しい連番", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p);
  await addModel(p, { name: "TEST-B", pallet: "青PL", wheel: "", cap: 100, local: "" });
  await p.reload();
  await setDate(p, "2026-10-21");
  await pickModel(p, 1); await fill(p, "r1_good", 50);
  await pickModel(p, 2, "TEST-B");
  eq(await v(p, "r1_lotCut"), "261021-01NK", "1行目");
  eq(await v(p, "r2_lotCut"), "261021-02NK", "型式が変わった2行目");
  eq(await v(p, "r2_good"), "100", "2行目の良品の初期値は1PL");
});

test("M5：1PLを超えたら警告", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p);
  await setDate(p, "2026-10-21");
  await pickModel(p, 1); await fill(p, "r1_good", 140); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.forms.nippo.elements.r1_good.classList.contains("over")), "1PL超過の印がない");
});

test("M3：カウンターの段取りを手で直しても、取り込み直しで二重にならない", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  const sec = (h, m) => Math.floor(new Date(2026, 9, 21, h, m).getTime() / 1000);
  const data = { state: { types: [], job: {}, downtime: {} },
    hist: { shifts: ["X"], types: {}, d: [], w: [[sec(9, 0), sec(9, 20), 0, "w1", 0, "段取り"]], j: [[sec(8, 45), sec(12, 30), 0, "j1", 1]], b: [] } };
  const f = path.join(os.tmpdir(), "counter-test.json");
  fs.writeFileSync(f, JSON.stringify(data));
  await p.setInputFiles("#counterFallback", f); await p.waitForTimeout(300);
  await p.fill('#kadoEv input[data-k="e"]', "09:25");
  await p.dispatchEvent('#kadoEv input[data-k="e"]', "change");
  await p.setInputFiles("#counterFallback", f); await p.waitForTimeout(300);
  const evs = JSON.parse(await v(p, "kadoEvents"));
  eq(evs.length, 1, "段取りの件数");
  eq(evs[0].e, "09:25", "手で直した時刻が残る");
});

test("〃：上の行と同じ型式・ロットNo.・パレット形態・ローカルコードは〃で表示（値はそのまま・選ぶと見える）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p);
  await setDate(p, "2026-10-21");
  await pickModel(p, 1); await pickModel(p, 2); await pickModel(p, 3);
  await fill(p, "r1_good", 100); await fill(p, "r2_good", 35);
  await fill(p, "r1_lotSoban", "R7Z446SX061"); await fill(p, "r2_lotSoban", "R7Z446SX061"); await fill(p, "r3_lotSoban", "R7Z446SX042");
  await p.waitForTimeout(200);
  const ditto = (n) => p.evaluate(n => document.forms.nippo.elements[n].parentNode.classList.contains("ditto"), n);
  eq(await ditto("r1_model"), false, "1行目の型式");
  eq(await ditto("r2_model"), true, "2行目の型式");
  eq(await ditto("r2_lotCut"), true, "2行目の切面ロット（同じ 01NK）");
  eq(await ditto("r3_lotCut"), false, "3行目の切面ロット（02NK に変わる）");
  eq(await ditto("r2_lotSoban"), true, "2行目の素板ロット");
  eq(await ditto("r3_lotSoban"), false, "3行目の素板ロット（変わる）");
  eq(await ditto("r1_palletType"), false, "1行目のパレット形態");
  eq(await ditto("r2_palletType"), true, "2行目のパレット形態");
  eq(await ditto("r2_localCode"), true, "2行目のローカルコード");
  eq(await v(p, "r2_palletType"), "赤PL", "パレット形態の値はそのまま");
  eq(await v(p, "r2_model"), MODEL, "値はそのまま");
  await p.click('[name="r2_model"]');
  const color = await p.evaluate(() => getComputedStyle(document.forms.nippo.elements.r2_model).color);
  ok(color !== "rgba(0, 0, 0, 0)", "選ぶと値が見える");
});

// ---------- 実行 ----------
(async () => {
  const only = process.argv.slice(2).map(s => s.toLowerCase());
  const list = tests.filter(t => !only.length || only.some(o => t.name.toLowerCase().includes(o)));
  const browser = await chromium.launch();
  let fail = 0;
  for (const t of list) {
    const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
    try { await t.fn(ctx); console.log("✔ " + t.name); }
    catch (e) { fail++; console.log("✘ " + t.name + "\n    " + e.message.split("\n")[0]); }
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${list.length - fail} / ${list.length} 成功`);
  process.exit(fail ? 1 : 0);
})();
