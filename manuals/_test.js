registerManual({
  "id": "WI-A-001",
  "docNo": "WI-A-001",
  "title": "ボルト締付け作業（ブラケット組付け）",
  "category": "組立",
  "process": "第2組立工程",
  "line": "Aライン",
  "product": "BR-1024 ブラケット",
  "revision": "2",
  "issued": "2026-04-01",
  "updated": "2026-10-01",
  "author": "山田",
  "checker": "佐藤",
  "approver": "鈴木",
  "purpose": "ブラケットを規定トルクで確実に締め付け、緩み・脱落を防止する。",
  "cautions": [
    "ナットランナーの回転部に手袋・袖を近づけない",
    "部品の落下に注意し、安全靴を必ず着用する"
  ],
  "ppe": [
    "保護メガネ",
    "作業用手袋（すべり止め付き）",
    "安全靴"
  ],
  "tools": [
    { "name": "ナットランナー（設定 25N·m）", "qty": "1台" },
    { "name": "トルクレンチ（確認用）", "qty": "1本" },
    { "name": "マーキングペン（黄）", "qty": "1本" }
  ],
  "materials": [
    { "name": "ブラケット BR-1024", "qty": "1個" },
    { "name": "六角ボルト M8×20", "qty": "4本" }
  ],
  "steps": [
    {
      "title": "部品を確認する",
      "detail": "ブラケットとボルトの品番・数量を部品表と照合する。",
      "points": [
        { "text": "品番を指差し呼称で確認する", "reason": "類似品の誤組付けを防ぐため", "kind": "quality" },
        { "text": "ボルトのねじ山に傷・異物がないか見る", "reason": "締付け不良の原因になるため", "kind": "quality" }
      ],
      "time": 10,
      "image": "",
      "video": { "src": "videos/_t.webm", "start": "0:00", "end": "0:06" }
    },
    {
      "title": "ブラケットを治具にセットする",
      "detail": "基準ピン2本に穴を合わせて、奥まで押し当てる。",
      "points": [
        { "text": "基準ピンに当たるまで奥へ押す", "reason": "位置ずれによる締付け不良を防ぐため", "kind": "quality" },
        { "text": "指を治具の隙間に入れない", "reason": "挟まれ防止のため", "kind": "safety", "video": { "src": "videos/_t.webm", "start": "0:08", "end": "0:12" } }
      ],
      "time": 8,
      "image": "",
      "video": { "src": "videos/_t.webm", "start": "0:06", "end": "0:12" }
    },
    {
      "title": "ボルトを仮締めする",
      "detail": "4本のボルトを手で2〜3山ねじ込む。",
      "points": [
        { "text": "対角の順番（①→③→②→④）で入れる", "reason": "片締めによる浮きを防ぐため", "kind": "quality" },
        { "text": "斜めに入っていないか手応えで確認", "reason": "かじり防止のため", "kind": "ease" }
      ],
      "time": 15,
      "image": "",
      "video": { "src": "videos/_t.webm", "start": "0:12", "end": "0:18" }
    },
    {
      "title": "ナットランナーで本締めする",
      "detail": "対角の順番で本締めし、ランプが緑になることを確認する。",
      "points": [
        { "text": "ランナーをボルトに対してまっすぐ当てる", "reason": "トルク不足・ねじ山破損を防ぐため", "kind": "quality" },
        { "text": "反力を両手でしっかり受ける", "reason": "手首のけが防止のため", "kind": "safety" },
        { "text": "赤ランプが点いたらラインを止めて班長に連絡", "reason": "不良品の流出防止のため", "kind": "quality" }
      ],
      "time": 20,
      "image": "",
      "video": { "src": "videos/_t.webm", "start": "0:18", "end": "0:24" }
    },
    {
      "title": "マーキングして次工程へ送る",
      "detail": "締付け済みのボルト頭に黄色のマーキングをする。",
      "points": [
        { "text": "ボルト頭からワークにかけて線を引く", "reason": "締付け済みの識別と緩み確認のため", "kind": "quality" }
      ],
      "time": 7,
      "image": "",
      "video": { "src": "videos/_t.webm", "start": "0:24", "end": "0:30" }
    }
  ],
  "revisions": [
    { "rev": "1", "date": "2026-04-01", "content": "新規制定", "by": "山田" },
    { "rev": "2", "date": "2026-10-01", "content": "手順4に赤ランプ時の対応を追加", "by": "山田" }
  ]
});
