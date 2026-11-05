// 日報（index.html）の自動テスト
//   NODE_PATH=$(npm root -g) node tests/run.js          … 全部
//   NODE_PATH=$(npm root -g) node tests/run.js h1 qr    … 名前に h1 か qr を含むテストだけ
// Playwright（Chromium）が必要。ファイルの場所はこのフォルダからの相対で決める。
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
// ふだんの起動は作業画面。帳票の欄を直接さわるテストのため、#form を付けて帳票のタブで開く
const URL = "file://" + path.join(ROOT, "index.html") + "#form";
// Playwright は日本語名のファイルを setInputFiles で渡せないことがあるので、英数字名にコピーして使う
const TEMPLATE = path.join(os.tmpdir(), "nippo-master-template.xlsx");
fs.copyFileSync(path.join(ROOT, "templates", "マスタ登録_雛形.xlsx"), TEMPLATE);
const QR_042 = "A0DGL35TS    ,A3I,A7813   ,A8508   ,AA32.00 ,AB20.00 ,AD175 ,B0R7Z446SX042,B42,BB2026/10/18,BR2N9A,00271A21261061,010020";
const MODEL = "ZC45PN-ARDR";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- 道具 ----------
async function open(ctx, now) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => { p.errors.push(e.message); if (process.env.SHOWERR) console.log("PAGEERR", e.message); });
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
async function scanQR(p, s) { await p.keyboard.type(s, { delay: 1 }); await p.keyboard.press("Enter"); await p.waitForTimeout(250); }
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
  eq(await v(p, "topics"), "", "QRの文字が欄に残らない" + p.errors.join(" / "));
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
  await p.click("#chkPrint");   // 入れ忘れの確認が出るので「このまま印刷」
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

// ---------- 使いやすさの査定で直したところ ----------
// カウンターの画面が開いているように見せる（このパソコンのカウンターの保存データの代わり）
async function fakeCounter(p, state) {
  await p.evaluate(st => {
    localStorage.setItem("defectCounterState", JSON.stringify(st));
    localStorage.setItem("defectCounterHistory", JSON.stringify({ d: [], shifts: st.shifts, j: [], w: [], b: [] }));
    const alive = () => localStorage.setItem("defectCounterActiveTab", JSON.stringify({ id: "x", t: Date.now() }));
    alive(); setInterval(alive, 1000);
  }, state);
}

test("最後のロットで良品＋不良が作業枚数を超えたら、先に数えた不良から前のロットへ移す（取り消しもできる）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  const sec = (h, m) => Math.floor(new Date(2026, 9, 21, h, m).getTime() / 1000);
  const types = { t1: { n: "キズ" }, t2: { n: "ハマ" }, t3: { n: "その他" } };
  const write = (d) => { const fp = path.join(os.tmpdir(), "counter-rebal.json");
    fs.writeFileSync(fp, JSON.stringify({ state: { types: [], job: {}, downtime: {} }, hist: { shifts: ["X"], types, d, w: [], j: [], b: [] } })); return fp; };
  const d1 = [[sec(9, 0), "t1", 1, 0, 0], [sec(9, 5), "t1", 1, 0, 0]];
  const d2 = d1.concat([[sec(10, 0), "t2", 1, 0, 0], [sec(10, 5), "t1", 1, 0, 0], [sec(10, 10), "t3", 1, 0, 0]]);
  await fill(p, "r1_lotSoban", "A"); await fill(p, "r1_good", 100);
  await p.setInputFiles("#counterFallback", write(d1)); await p.waitForTimeout(300);
  eq(await v(p, "r1_kizu"), "2", "1行目にキズ2");
  await fill(p, "r2_lotSoban", "B");
  await p.setInputFiles("#counterFallback", write(d2)); await p.waitForTimeout(300);
  eq([await v(p, "r2_ori_hama"), await v(p, "r2_kizu"), await v(p, "r2_proc_other")].join(","), "1,1,1", "2行目に3個");
  await fill(p, "r2_good", 13); await fill(p, "r2_qty", 15); await p.waitForTimeout(300);
  eq(await v(p, "r2_ori_hama"), "", "先に数えたハマが2行目から消える");
  eq(await v(p, "r1_ori_hama"), "1", "前のロット（1行目）へ移る");
  eq(await v(p, "r2_kizu") + "," + await v(p, "r2_proc_other"), "1,1", "あとの不良は残る");
  ok((await p.textContent("#msg")).includes("前の素板"), "知らせる");
  await p.click("#msg button"); await p.waitForTimeout(300);
  eq(await v(p, "r2_ori_hama") + "," + await v(p, "r1_ori_hama"), "1,", "取り消すと元に戻り、また移さない");
  await fill(p, "r2_qty", 14); await p.waitForTimeout(300);
  eq(await v(p, "r1_ori_hama") + "," + await v(p, "r1_kizu"), "1,3", "数を変えると、先に数えた順に2個移す");
  eq(await v(p, "r2_proc_other"), "1", "最後に数えたものは残る");
});

// ---------- 読み忘れ・読む順番の間違い・計算の食い違い・完成と訂正 ----------
const qrOf = (lot, qty) => `A0DGL35TS    ,A3I,A7813   ,A8508   ,AA32.00 ,AB20.00 ,AD${qty} ,B0${lot},B42,BR2N9A`;

test("素板の枚数を超えたら、QRの読み忘れを知らせる", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p); await setDate(p, "2026-10-21");
  await p.click("body"); await scanQR(p, qrOf("LOTA", 175));
  await pickModel(p, 1); await fill(p, "r1_good", 130); await fill(p, "r1_qty", 130);
  await pickModel(p, 2); await fill(p, "r2_good", 60); await fill(p, "r2_qty", 60);
  await p.waitForTimeout(200);
  const m = await p.textContent("#msg");
  ok(m.includes("読み忘れ") && m.includes("2行目"), "知らせ：" + m);
});

test("QRを遅れて読んだら、どの行から新しい素板かを選べる", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p); await setDate(p, "2026-10-21");
  await p.click("body"); await scanQR(p, qrOf("LOTA", 175));
  await pickModel(p, 1); await fill(p, "r1_good", 130); await fill(p, "r1_qty", 130);
  await pickModel(p, 2); await fill(p, "r2_good", 60); await fill(p, "r2_qty", 60);
  await pickModel(p, 3); await fill(p, "r3_good", 20); await fill(p, "r3_qty", 20);
  await p.click("body"); await scanQR(p, qrOf("LOTB", 175));
  ok(await p.evaluate(() => document.getElementById("pickDlg").open), "選ぶ画面が出る");
  ok((await p.textContent("#pickList .rec")).includes("2行目から"), "おすすめは2行目から");
  await p.click("#pickList .rec"); await p.waitForTimeout(200);
  eq(await v(p, "r1_lotSoban") + "," + await v(p, "r2_lotSoban") + "," + await v(p, "r3_lotSoban") + "," + await v(p, "r4_lotSoban"), "LOTA,LOTB,LOTB,", "2〜3行目がLOTB、4行目は作らない");
});

test("読む順番を間違えたら、読んだ素板から選び直せる（手打ちなし）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.click("body"); await scanQR(p, qrOf("LOTB", 175));
  await p.click("body"); await scanQR(p, qrOf("LOTA", 175));
  eq(await v(p, "r1_lotSoban") + "," + await v(p, "r2_lotSoban"), "LOTB,LOTA", "間違えた順");
  await p.focus('[name="r1_good"]');
  await p.click('#rowTools [data-rt="lot"]');
  await p.uncheck("#pickAll");
  await p.click("#pickList button >> text=LOTA"); await p.waitForTimeout(100);
  await p.focus('[name="r2_good"]');
  await p.click('#rowTools [data-rt="lot"]');
  await p.click("#pickList button >> text=LOTB"); await p.waitForTimeout(100);
  eq(await v(p, "r1_lotSoban") + "," + await v(p, "r2_lotSoban"), "LOTA,LOTB", "入れ替わる");
});

test("完成の前に、計算の食い違い（当残・前日の端数・カウンターの不良数）を知らせる", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  await setDate(p, "2026-10-21");
  await fill(p, "prevGood", 10);
  await fill(p, "r1_good", 102);
  await fill(p, "sb1_to", 5);
  await p.evaluate(() => { const f = document.forms.nippo.elements; f.cntImported.value = JSON.stringify({ kizu: 3 }); f.r1_kizu.value = 2; f.r1_kizu.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.waitForTimeout(300);
  await p.click("#btnDone");
  const t = await p.textContent("#doneList");
  ok(t.includes("当残：入力は 5 枚、計算では"), "当残：" + t);
  ok(t.includes("前日の良品端数：入力は 10 枚、前日の日報では 13 枚"), "端数");
  ok(t.includes("不良数（キズ）：不良数カウンターでは 3 個、日報では 2 個"), "カウンター");
});

test("完成すると入力できなくなり、訂正すると元の値つきで記録が残る", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await fill(p, "r1_lotSoban", "A"); await fill(p, "r1_good", 102);
  await p.waitForTimeout(200);
  await p.click("#btnDone"); await p.click("#doneOnly"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.forms.nippo.elements.r1_good.disabled), "完成後は入力できない");
  ok((await p.textContent("#doneBar")).includes("完成済み"), "完成済みの表示");
  ok((await p.textContent("#doneStamp")).includes("完成"), "印刷にも完成の日時");
  await p.click("#btnFix");
  await fill(p, "r1_good", 100); await p.waitForTimeout(200);
  await p.click("#btnDone"); await p.click("#doneOnly"); await p.waitForTimeout(200);
  ok((await p.textContent("#fixArea")).includes("1行目 良品枚数 102 → 100"), "訂正の記録：" + await p.textContent("#fixArea"));
  ok(await p.evaluate(() => document.forms.nippo.elements.r1_good.disabled), "訂正の完成でまた入力できなくなる");
  // 訂正をやめると、完成したときの値に戻る
  await p.click("#btnFix"); await fill(p, "r1_good", 50); await p.waitForTimeout(200);
  await p.click("#btnFixCancel"); await p.waitForTimeout(200);
  eq(await v(p, "r1_good"), "100", "訂正をやめると元に戻る");
  // 保存されていて、開き直しても完成のまま
  await p.reload(); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.forms.nippo.elements.r1_good.disabled), "開き直しても完成のまま");
});

// ---------- 良品の合計から明細を作る ----------
test("良品の合計から明細を作る：見本10/21（パレット満タン・素板の切り替わりで分け、不良は最後の行）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  await setDate(p, "2026-10-21");
  eq(await v(p, "gt1_model"), MODEL, "最初の型式は前日から");
  await p.click("body"); await scanQR(p, QR_042);
  await fill(p, "gt1_good", 270); await p.dispatchEvent('[name="gt1_good"]', "change"); await p.waitForTimeout(300);
  const row = async r => [await v(p, `r${r}_lotSoban`), await v(p, `r${r}_lotCut`), await v(p, `r${r}_good`)].join(" ");
  eq(await row(1), "R7Z446SX061 261020-08NK 102", "1行目");
  eq(await row(2), "R7Z446SX042 261020-08NK 20", "2行目");
  eq(await row(3), "R7Z446SX042 261021-01NK 135", "3行目");
  eq(await row(4), "R7Z446SX042 261021-02NK 13", "4行目");
  eq(await v(p, "r5_model"), "", "5行目は無い");
  await fill(p, "r2_kizu", 1); await fill(p, "r3_ori_hama", 1); await fill(p, "r4_proc_other", 5);
  await p.click("#btnBuild"); await p.waitForTimeout(300);
  eq([await v(p, "r4_kizu"), await v(p, "r4_ori_hama"), await v(p, "r4_proc_other"), await v(p, "r2_kizu")].join(","), "1,1,5,", "不良は最後の行へまとめる");
  eq(await v(p, "r4_qty"), "20", "最後の行の作業枚数");
  eq(await v(p, "t_qty") + "/" + await v(p, "t_good"), "277/270", "合計");
  eq(await v(p, "sb1_to"), "0", "当残");
});

test("良品の合計：手で直した行は作り直さない／型式が変わると新しい連番", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p);
  await addModel(p, { name: "TEST-B", pallet: "青PL", wheel: "", cap: 100, local: "" });
  await p.reload(); await setDate(p, "2026-10-21");
  await fill(p, "gt1_model", MODEL); await fill(p, "gt1_good", 200);
  await fill(p, "gt2_model", "TEST-B"); await fill(p, "gt2_good", 50);
  await p.dispatchEvent('[name="gt2_good"]', "change"); await p.waitForTimeout(300);
  const row = async r => [await v(p, `r${r}_model`), await v(p, `r${r}_lotCut`), await v(p, `r${r}_good`)].join(" ");
  eq(await row(1), MODEL + " 261021-01NK 135", "1行目");
  eq(await row(2), MODEL + " 261021-02NK 65", "2行目");
  eq(await row(3), "TEST-B 261021-03NK 50", "型式が変わると次の連番");
  await fill(p, "r2_good", 60); await p.waitForTimeout(200);
  await p.click("body"); await scanQR(p, qrOf("LOTZ", 175)); await p.waitForTimeout(300);
  eq(await v(p, "r2_good"), "60", "手で直した値は残る");
  ok((await p.textContent("#gtInfo")).includes("手で直した行"), "作り直さないことを知らせる");
  await p.click("#btnDone");
  ok((await p.textContent("#doneList")).includes("良品の合計（" + MODEL + "）：入力は 200 枚、明細の良品枚数の合計は 195 枚"), "合計の食い違いを知らせる");
});

// ---------- 前日と違う型式・当残・カウンターの作業数・共有フォルダ・端数の紙 ----------
test("前日と違う型式から始める日は、端数を引き継がず新しい連番", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  await addModel(p, { name: "TEST-B", pallet: "青PL", wheel: "", cap: 100, local: "" });
  await p.reload(); await setDate(p, "2026-10-21");
  await fill(p, "gt1_model", "TEST-B"); await fill(p, "gt1_good", 50); await p.dispatchEvent('[name="gt1_good"]', "change"); await p.waitForTimeout(300);
  eq(await v(p, "r1_model") + " " + await v(p, "r1_lotCut") + " " + await v(p, "r1_good"), "TEST-B 261021-01NK 50", "端数を引き継がない");
  eq(await p.inputValue("#prevGoodHead"), "", "見出し（印刷）に前日の端数を出さない");
  ok((await p.textContent("#prevInfo")).includes("引き継ぎません"), "引き継がないことを表示");
});

test("当残を数えて入れると、最後の素板の使用数を超えた不良を前の素板の行へ移す", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  await setDate(p, "2026-10-21");
  await p.click("body"); await scanQR(p, QR_042);
  await fill(p, "gt1_good", 270); await p.dispatchEvent('[name="gt1_good"]', "change"); await p.waitForTimeout(300);
  await fill(p, "r4_kizu", 1); await fill(p, "r4_ori_hama", 1); await fill(p, "r4_proc_other", 5);
  await fill(p, "sb1_to", 2); await p.dispatchEvent('[name="sb1_to"]', "change"); await p.waitForTimeout(300);
  eq(await v(p, "r1_kizu") + "," + await v(p, "r1_ori_hama"), "1,1", "2個が前の素板（1行目）へ");
  eq(await v(p, "r4_qty"), "18", "最後の行の作業枚数");
  ok((await p.textContent("#gtInfo")).includes("前の素板の行へ移しました"), "知らせる");
});

test("良品の合計を、カウンターのその作業の作業数へあとから書き込む", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p);
  await addModel(p, { name: "TEST-B", pallet: "", wheel: "", cap: 100, local: "" });
  const sec = (h, m) => Math.floor(new Date(2026, 9, 21, h, m).getTime() / 1000);
  await p.evaluate(({ a, b, c, d }) => {
    localStorage.setItem("defectCounterHistory", JSON.stringify({ shifts: ["ZC45PN-ARDR", "TEST-B"], types: {}, w: [], b: [], p: {},
      j: [[a, b, 0, "j1", null], [b, c, 1, "j2", null]], d: [[a + 60, "t1", 1, 0, 0], [a + 120, "t1", 1, 0, 0], [b + 60, "t1", 1, 1, 0]] }));
    localStorage.setItem("defectCounterState", JSON.stringify({ types: [], shifts: ["ZC45PN-ARDR", "TEST-B"], job: { running: false }, lastJob: { id: "j2", prod: null } }));
  }, { a: sec(8, 45), b: sec(10, 0), c: sec(12, 0), d: 0 });
  await p.reload(); await setDate(p, "2026-10-21");
  await fill(p, "gt1_model", MODEL); await fill(p, "gt1_good", 100); await p.dispatchEvent('[name="gt1_good"]', "change");
  await fill(p, "gt2_model", "TEST-B"); await fill(p, "gt2_good", 50); await p.dispatchEvent('[name="gt2_good"]', "change");
  await p.waitForTimeout(400);
  const h = await p.evaluate(() => JSON.parse(localStorage.getItem("defectCounterHistory")));
  eq(h.j[0][4] + "," + h.j[1][4], "102,51", "作業数＝良品＋その作業の不良");
  eq(h.p["2026-10-21|" + MODEL], 102, "日ごとの生産数");
  eq(await p.evaluate(() => JSON.parse(localStorage.getItem("defectCounterState")).lastJob.prod), 51, "最後の作業の作業数も");
});

test("良品の合計の②に型式を入れると、作業中のカウンターを切り替える", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p);
  await addModel(p, { name: "TEST-B", pallet: "", wheel: "", cap: 100, local: "" });
  await p.evaluate(() => {
    localStorage.setItem("defectCounterState", JSON.stringify({ types: [], shifts: ["ZC45PN-ARDR", "TEST-B"], features: { jobs: true }, job: { running: true, shift: "ZC45PN-ARDR" }, counts: {}, downtime: {}, brk: {} }));
    localStorage.setItem("defectCounterHistory", JSON.stringify({ d: [], w: [], j: [], b: [], shifts: [] }));
  });
  await p.reload();
  await p.evaluate(() => localStorage.setItem("defectCounterActiveTab", JSON.stringify({ id: "x", t: Date.now() })));
  await fill(p, "gt1_model", MODEL); await fill(p, "gt2_model", "TEST-B"); await p.dispatchEvent('[name="gt2_model"]', "change");
  await p.waitForTimeout(300);
  const k = await p.evaluate(() => JSON.parse(localStorage.getItem("defectCounterKeyForward") || "null"));
  ok(k && k.code === "NumpadAdd", "カウンターへ作業終了のキーを送る：" + JSON.stringify(k));
});

test("共有フォルダに日報を1日1ファイルで保存する", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.evaluate(() => {
    window.__files = {};
    const dir = { name: "共有", getFileHandle: async (n) => ({ createWritable: async () => { let buf = ""; return { write: async (t) => { buf += t; }, close: async () => { window.__files[n] = buf; } }; } }) };
    window.showDirectoryPicker = async () => dir;
  });
  await p.click("#btnSettings"); await p.click("#btnShareDir"); await p.waitForTimeout(100);
  await p.click("#dlgSave");
  await fill(p, "topics", "共有テスト"); await p.waitForTimeout(2600);
  const f = await p.evaluate(() => window.__files["Nライン日報_2026-10-21.json"] || "");
  ok(f.includes("共有テスト"), "ファイルに書かれる");
  ok((await p.textContent("#shareStatus")).includes("共有フォルダ ✓"), "状態の表示");
});

test("端数の素板があるときだけ、バーコード付きの紙を一緒に印刷する（A3＋A4）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.evaluate(() => { window.print = () => {}; });
  await p.click("#btnPrint"); await p.waitForTimeout(100);
  eq(await p.evaluate(() => document.body.classList.contains("with-label")), false, "端数がなければ印刷しない");
  await p.evaluate(() => { const c = document.getElementById("chk"); if (c.open) c.close(); });
  await p.click("body"); await scanQR(p, QR_042);
  await fill(p, "r1_good", 100); await fill(p, "r1_qty", 100); await p.waitForTimeout(200);
  await p.click("#btnPrint"); await p.waitForTimeout(100);
  await p.evaluate(() => { const c = document.getElementById("chk"); if (c.open) c.close(); });
  ok(await p.evaluate(() => document.body.classList.contains("with-label")), "端数があれば印刷する");
  const t = await p.textContent("#labelPage");
  ok(t.includes("R7Z446SX042") && t.includes("75") && t.includes("DGL35TS") && t.includes("2N9A"), "中身：" + t);
  ok(await p.evaluate(() => !!document.querySelector("#labelPage .bc svg rect")), "バーコード");
  ok(await p.evaluate(() => !!document.querySelector("#labelPage .qr svg path")), "QRコード");
  const pdf = path.join(os.tmpdir(), "nippo-label-test.pdf");
  await p.pdf({ path: pdf, preferCSSPageSize: true });
  const pages = (fs.readFileSync(pdf, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  eq(pages, 2, "日報（A3）＋端数の紙（A4）");
});

test("次の日に端数の紙のQRを読むと、新しいパレットにせず前日から続く素板として確かめる", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  await setDate(p, "2026-10-21");
  await p.click("body"); await scanQR(p, "A0DGL35TS    ,A3I,A7813   ,A8508   ,AA32.00 ,AB20.00 ,AD102 ,B0R7Z446SX061,B42,BR2N9A,ZH1");
  ok((await p.textContent("#msg")).includes("前日から続く素板"), "確かめた知らせ");
  eq(await v(p, "sb1_lots"), "", "新しいパレットとして足さない");
  await p.click("body"); await scanQR(p, "A0DGL35TS    ,A3I,A7813   ,A8508   ,AA32.00 ,AB20.00 ,AD90  ,B0R7Z446SX061,B42,BR2N9A,ZH1");
  ok((await p.textContent("#msg")).includes("前残（102 枚）と違います"), "枚数が違えば知らせる");
});

// ---------- 前の素板へ・前日の値・投入時間・板乗せの斜線・終業 ----------
test("作業枚数を手で入れたときも、超えた不良は前の素板パレットの最後の行へ移す（1つ上の行ではない）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  const sec = (h, m) => Math.floor(new Date(2026, 9, 21, h, m).getTime() / 1000);
  const fp = path.join(os.tmpdir(), "counter-rebal2.json");
  fs.writeFileSync(fp, JSON.stringify({ state: { types: [], job: {}, downtime: {} }, hist: { shifts: ["X"], types: { t1: { n: "キズ" } },
    d: [[sec(10, 0), "t1", 1, 0, 0], [sec(10, 5), "t1", 1, 0, 0]], w: [], j: [], b: [] } }));
  await fill(p, "r1_lotSoban", "A"); await fill(p, "r1_good", 100);
  await fill(p, "r2_lotSoban", "B"); await fill(p, "r2_good", 135);
  await fill(p, "r3_lotSoban", "B");
  await p.setInputFiles("#counterFallback", fp); await p.waitForTimeout(300);
  eq(await v(p, "r3_kizu"), "2", "3行目にキズ2");
  await fill(p, "r3_good", 13); await fill(p, "r3_qty", 14); await p.waitForTimeout(300);
  eq(await v(p, "r1_kizu") + "," + await v(p, "r2_kizu") + "," + await v(p, "r3_kizu"), "1,,1", "前の素板（1行目・A）へ移す");
});

test("新しい日は、作業者・確認者・検視台などを前日の値から入れる（年月度マークは同じ月だけ）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  for (const [n, x] of [["worker_kensa", "鈴木"], ["worker_stock", "アルクナ"], ["m1_mark", "2026.10"], ["m1_checker", "佐々木"], ["kenshidai", "78.9"]]) await fill(p, n, x);
  await p.waitForTimeout(700);
  await setDate(p, "2026-10-21");
  eq([await v(p, "worker_kensa"), await v(p, "worker_stock"), await v(p, "m1_mark"), await v(p, "m1_checker"), await v(p, "kenshidai")].join(","), "鈴木,アルクナ,2026.10,佐々木,78.9", "前日の値");
  await setDate(p, "2026-11-02");
  eq(await v(p, "m1_mark") + "|" + await v(p, "m1_checker"), "|佐々木", "月が変わったら年月度マークは入れない");
});

test("投入時間を、稼働の時間から休憩を引いて自動で入れる／板乗せが空なら斜線", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await fill(p, "worker_kensa", "鈴木");
  await fill(p, "kadoS", "08:45"); await fill(p, "kadoE", "12:30");
  await p.evaluate(() => { const f = document.forms.nippo.elements; f.kadoEvents.value = JSON.stringify([{ s: "12:00", e: "12:30", c: "E", src: "manual" }]); f.kadoS.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.waitForTimeout(200);
  eq(await v(p, "tonyu_kensa") + "|" + await v(p, "tonyu_stock"), "3.3|", "検査だけ 3.3 時間（195 分）");
  ok(await p.evaluate(() => document.forms.nippo.elements.worker_itanose.parentNode.classList.contains("slash")), "板乗せは斜線");
  await fill(p, "worker_itanose", "田中"); await p.waitForTimeout(100);
  ok(!(await p.evaluate(() => document.forms.nippo.elements.worker_itanose.parentNode.classList.contains("slash"))), "入れたら斜線を消す");
});

test("終業ボタン：最後に入れる数字を1つの画面で入れ、確認・完成へ進む", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  await setDate(p, "2026-10-21");
  await p.click("body"); await scanQR(p, QR_042);
  await p.click("#btnEnd");
  ok(await p.evaluate(() => document.getElementById("endDlg").open), "終業の画面が出る");
  await p.fill('#endBody [data-bind="gt1_good"]', "270"); await p.dispatchEvent('#endBody [data-bind="gt1_good"]', "change");
  await p.fill('#endBody [data-bind="sb1_to"]', "0"); await p.dispatchEvent('#endBody [data-bind="sb1_to"]', "change");
  await p.fill('#endBody [data-bind="kenshidai"]', "78.9");
  await p.waitForTimeout(300);
  eq(await v(p, "r4_lotCut") + " " + await v(p, "r4_good"), "261021-02NK 13", "明細ができる");
  eq(await v(p, "kenshidai"), "78.9", "日報の欄に入る");
  await p.click("#endGo"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById("doneDlg").open), "完成の確認へ進む");
});

// ---------- 作業画面 ----------
test("作業画面：ふだんは作業画面で開き、良品の合計・当残を入れると明細と「あと入れるもの」が出る", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await makePrevDay(p);
  await setDate(p, "2026-10-21");
  await p.click("body"); await scanQR(p, QR_042);
  await p.goto(URL.replace("#form", "#work")); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.body.classList.contains("view-work")), "作業画面で開く");
  ok(!(await p.isVisible("#nippo")), "帳票は隠れている");
  await p.fill('#work [data-bind="gt1_good"]', "270"); await p.dispatchEvent('#work [data-bind="gt1_good"]', "change"); await p.waitForTimeout(300);
  eq(await v(p, "r4_lotCut") + " " + await v(p, "r4_good"), "261021-02NK 13", "帳票の明細ができる");
  ok((await p.textContent("#wRows")).includes("261021-02NK"), "作業画面に明細の要約");
  ok((await p.textContent("#wTodo")).includes("パレット№"), "あと入れるもの");
  await p.fill('#work [data-bind="sb1_to"]', "0"); await p.dispatchEvent('#work [data-bind="sb1_to"]', "change"); await p.waitForTimeout(200);
  eq(await v(p, "sb1_to"), "0", "当残が帳票に入る");
  await p.click("#wTodo button >> text=1行目のパレット№"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.body.classList.contains("view-form")), "帳票の欄へ移るときはタブを切り替える");
  await p.click('#viewTabs [data-view="work"]');
  await p.click("#wDone"); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById("doneDlg").open), "完成の確認へ");
  eq(p.errors.join(), "", "ページのエラー");
});

test("カウンターの停止を日報で直す（60分→30分）：元の値を残し、取り込み直しても戻らない／削除も戻らない", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  const sec = (h, m) => Math.floor(new Date(2026, 9, 21, h, m).getTime() / 1000);
  const data = { state: { types: [], job: {}, downtime: {} },
    hist: { shifts: ["X"], types: {}, d: [], j: [[sec(8, 45), sec(12, 30), 0, "j1", 1]], b: [],
      w: [[sec(10, 0), sec(11, 0), 0, "w1", 0, "段取り"], [sec(11, 30), sec(11, 40), 0, "w2", 0, "故障"]] } };
  const fpath = path.join(os.tmpdir(), "counter-adjust.json");
  fs.writeFileSync(fpath, JSON.stringify(data));
  await p.setInputFiles("#counterFallback", fpath); await p.waitForTimeout(300);
  ok((await p.textContent("#kadoSum")).includes("P（段取り）60分"), "取込直後は60分");
  await p.fill('#kadoEv input[data-k="min"]', "30");
  await p.dispatchEvent('#kadoEv input[data-k="min"]', "change"); await p.waitForTimeout(100);
  let evs = JSON.parse(await v(p, "kadoEvents"));
  const e1 = evs.find(e => e.id === "w1");
  eq(e1.e, "10:30", "終了が 10:30 に");
  eq(e1.os + "-" + e1.oe, "10:00-11:00", "元の値を残す");
  ok((await p.textContent("#kadoEv")).includes("元 10:00〜11:00・60分"), "元の値を表示");
  // 2件目を削除してから1件目をもう一度直しても、削除は残る
  await p.click('#kadoEv button[data-del="1"]'); await p.waitForTimeout(100);
  await p.fill('#kadoEv input[data-k="min"]', "25");
  await p.dispatchEvent('#kadoEv input[data-k="min"]', "change"); await p.waitForTimeout(100);
  await p.setInputFiles("#counterFallback", fpath); await p.waitForTimeout(300);
  evs = JSON.parse(await v(p, "kadoEvents")).filter(e => !e.del);
  eq(evs.length, 1, "削除したものは戻らない");
  eq(evs[0].e, "10:25", "直した値は取り込み直しでも残る");
  ok((await p.textContent("#kadoSum")).includes("P（段取り）25分"), "集計も25分");
  await p.click('#kadoEv button[data-revert="0"]'); await p.waitForTimeout(100);
  eq(JSON.parse(await v(p, "kadoEvents")).find(e => e.id === "w1").e, "11:00", "カウンターの値に戻せる");
});

test("U1：数字の欄はホイールや↑↓で値が変わらない（↑↓は上下の行へ）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await fill(p, "r2_ware", 5);
  const b = await p.locator('[name="r2_ware"]').boundingBox();
  await p.mouse.move(b.x + 10, b.y + 10); await p.mouse.wheel(0, 300); await p.waitForTimeout(200);
  eq(await v(p, "r2_ware"), "5", "ホイールのあとの値");
  await p.click('[name="r2_ware"]'); await p.keyboard.press("ArrowUp");
  eq(await v(p, "r2_ware"), "5", "↑のあとの値");
  eq(await p.evaluate(() => document.activeElement.name), "r1_ware", "↑で上の行へ");
});

test("U2：登録されていない型式では、カウンターを切り替えず製造種類にも足さない", async ctx => {
  const p = await open(ctx, "2026-10-22T09:00:00");
  await importMaster(p);
  await fakeCounter(p, { features: { jobs: true }, shifts: [MODEL], types: [], counts: {}, job: { running: true, shift: MODEL } });
  await p.reload(); await p.waitForTimeout(800);
  await pickModel(p, 1, "ZC45PN-ARD");
  await p.waitForTimeout(5500);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem("defectCounterState")));
  ok(!st.shifts.includes("ZC45PN-ARD"), "打ち間違いの型式がカウンターに足された");
  eq(await p.locator('#cntBar button[data-cnt]').count(), 0, "切り替えボタンが出ない");
  ok(await p.evaluate(() => document.forms.nippo.elements.r1_model.classList.contains("unreg")), "未登録の型式が赤くならない");
});

test("U3：素板QRの読み取りを取り消せる（使用素板・明細とも元に戻る）／読んだ素板を一覧から外せる", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p);
  await setDate(p, "2026-10-21");
  await pickModel(p, 1);
  await scanQR(p, QR_042);
  await scanQR(p, QR_042.replace("SX042", "SX043"));
  eq(await v(p, "r2_lotSoban"), "R7Z446SX043", "2つ目のQRで2行目");
  await p.click("#msg button");
  await p.waitForTimeout(200);
  eq(await v(p, "r2_lotSoban"), "", "取り消すと2行目が空に戻る");
  eq(JSON.parse(await v(p, "sb1_lots")).length, 1, "使用素板も1パレットに戻る");
  await p.click('#lotList button[data-lb="1"]');
  await p.waitForTimeout(200);
  eq(await v(p, "sb1_lots"), "", "一覧の取消で使用素板から外れる");
  eq(p.errors.join(), "", "ページのエラー");
});

test("U4：行を消す・行を入れる（取り消しもできる）", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await importMaster(p);
  await setDate(p, "2026-10-21");
  await pickModel(p, 1); await fill(p, "r1_good", 50);
  await pickModel(p, 2); await fill(p, "r2_kizu", 3); await fill(p, "r2_pallet", "P2");
  await p.click('[name="r1_good"]');
  await p.click('#rowTools button[data-rt="del"]'); await p.waitForTimeout(200);
  eq(await v(p, "r1_kizu"), "3", "下の行が上へ");
  eq(await v(p, "r1_pallet"), "P2", "パレット№も上へ");
  eq(await v(p, "r2_model"), "", "2行目は空");
  await p.click("#msg button"); await p.waitForTimeout(200);
  eq(await v(p, "r2_kizu"), "3", "取り消しで元に戻る");
  await p.click('[name="r2_kizu"]');
  await p.click('#rowTools button[data-rt="ins"]'); await p.waitForTimeout(200);
  eq(await v(p, "r2_model"), "", "入れた行は空");
  eq(await v(p, "r3_kizu"), "3", "下へずれる");
});

test("U5：印刷の前に入れ忘れを知らせ、項目からその欄へ移れる", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await importMaster(p);
  await setDate(p, "2026-10-21");
  await pickModel(p, 1);
  await p.click("#btnPrint");
  const items = await p.$$eval("#chkList button", b => b.map(x => x.textContent));
  ok(items.includes("1行目のパレット№") && items.includes("検視台 高さ調整実施"), "入れ忘れの一覧：" + items.join("、"));
  eq(await p.evaluate(() => window.__prints), 0, "確認中は印刷しない");
  await p.click("#chkList button >> text=検視台 高さ調整実施");
  eq(await p.evaluate(() => document.activeElement.name), "kenshidai", "押した項目の欄へ移る");
});

test("U5b：作業者・投入時間はどれか1つでよい／レ点・1PL超過・未登録の型式も印刷の前に知らせる", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.evaluate(() => { window.print = () => {}; });
  await importMaster(p);
  await setDate(p, "2026-10-21");
  await pickModel(p, 1); await fill(p, "r1_good", 140); await fill(p, "r1_kizu", 2);
  await pickModel(p, 2, "ZC45PN-ARD");
  await fill(p, "worker_kensa", "鈴木"); await fill(p, "tonyu_kensa", 3);
  await p.waitForTimeout(200);
  await p.click("#btnPrint");
  const items = await p.$$eval("#chkList button", b => b.map(x => x.textContent));
  const has = t => items.some(x => x.includes(t));
  ok(!has("作業者") && !has("投入時間"), "検査に入っていれば作業者・投入時間は出ない：" + items.join("、"));
  ok(has("処置廃棄のレ点（キズ）"), "レ点：" + items.join("、"));
  ok(has("1行目の良品枚数が1PLを超えています"), "1PL超過");
  ok(has("2行目の型式「ZC45PN-ARD」が登録されていません"), "未登録の型式");
});

test("U6：設定を保存しないで閉じるときは確かめる", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  p.removeAllListeners("dialog");
  let asked = "";
  p.on("dialog", d => { asked += d.message(); d.type() === "confirm" ? d.dismiss() : d.accept(); });
  await p.click("#btnSettings");
  await p.setInputFiles("#mImport", TEMPLATE); await p.waitForTimeout(300);
  await p.click("#dlgClose");
  ok(/保存しないで閉じますか/.test(asked), "確認が出ない");
  ok(await p.evaluate(() => document.getElementById("dlg").open), "キャンセルしたら開いたまま");
});

test("U7：カウンターが開いていないときは、テンキーの数字を日報に入れない", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.click('[name="r1_kizu"]');
  await p.keyboard.press("Numpad5");
  eq(await v(p, "r1_kizu"), "", "日報に入らない");
  ok(/カウンターの画面が開いていない/.test(await p.textContent("#msg")), "知らせが出る");
});

test("U8：Enter で次の欄へ／作業日の Enter で型式へ／F2 でいまの行へ", async ctx => {
  const p = await open(ctx, "2026-10-21T08:00:00");
  await p.click('[name="worker_itanose"]'); await p.keyboard.press("Enter");
  eq(await p.evaluate(() => document.activeElement.name), "worker_kensa", "Enter で次の欄");
  await p.click('[name="workDate"]'); await p.keyboard.press("Enter");
  eq(await p.evaluate(() => document.activeElement.name), "r1_model", "作業日の Enter で型式");
  await p.click('[name="topics"]'); await p.keyboard.press("F2");
  eq(await p.evaluate(() => document.activeElement.name), "r1_model", "F2 でいまの行");
});

// 本物の不良数カウンターとの連携。COUNTER_HTML=…/defect-counter.html を指定したときだけ動かす
const COUNTER = process.env.COUNTER_HTML;
if (COUNTER) test("カウンター連携：型式の追加・作業開始・不良の取込・休憩・型式の切り替え（作業数の入力）", async ctx => {
  const c = await ctx.newPage(); c.errors = []; c.on("pageerror", e => c.errors.push(e.message));
  await c.goto("file://" + path.resolve(COUNTER)); await c.waitForTimeout(800);
  const n = await open(ctx);
  await importMaster(n);
  await addModel(n, { name: "TEST-B", pallet: "青PL", wheel: "", cap: 100, local: "" });
  await n.reload(); await n.bringToFront(); await n.waitForTimeout(1200);
  const cst = () => n.evaluate(() => JSON.parse(localStorage.getItem("defectCounterState")));
  let st = await cst();
  ok(st.shifts.includes(MODEL) && st.shifts.includes("TEST-B"), "カウンターに型式が追加されていない：" + st.shifts.join(","));
  await pickModel(n, 1); await n.waitForTimeout(300);
  await n.click('#cntBar button[data-cnt="start"]'); await n.waitForTimeout(2500);
  st = await cst();
  eq(st.job.running && st.job.shift, MODEL, "カウンターで作業開始");
  await n.click("body");
  for (const k of ["Numpad1", "Numpad1"]) { await n.keyboard.press(k); await n.waitForTimeout(250); }
  await n.keyboard.press("NumpadMultiply"); await n.waitForTimeout(1300); await n.keyboard.press("NumpadMultiply");
  await n.waitForTimeout(1500);
  eq(await v(n, "r1_kizu"), "2", "不良が1行目に入る");
  ok(JSON.parse((await v(n, "kadoEvents")) || "[]").some(e => e.c === "E"), "休憩が E として入る");
  await fill(n, "r1_good", 100); await n.waitForTimeout(300);
  eq(await v(n, "r1_qty"), "102", "1行目の作業枚数");
  await pickModel(n, 2, "TEST-B");
  await n.waitForTimeout(5000);
  st = await cst();
  eq(st.lastJob && st.lastJob.prod, 102, "前の作業の作業数");
  eq(st.job.running && st.job.shift, "TEST-B", "カウンターが新しい型式で作業開始");
  eq(c.errors.concat(n.errors).join(), "", "ページのエラー");
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
