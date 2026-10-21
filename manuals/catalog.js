/* =========================================================
   要領書の目録（ここだけ編集すれば一覧に表示されます）
   - siteName : 画面上部に表示する工場名・部署名
   - levels   : 一覧で絞り込む順番（工場に合わせて並べ替え・削除できます）
                line=ライン / product=製品 / process=工程 / category=作業区分
   - files    : manuals フォルダに置いた要領書ファイル名を並べる
   ========================================================= */
window.CATALOG = {
  siteName: "○○工場 作業要領書",
  levels: ["line", "product", "process"],
  files: [
    "sample-001.js",
    "sample-002.js",
    "sample-003.js"
  ]
};
