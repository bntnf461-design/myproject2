registerManual({
  "id": "WI-B-005",
  "docNo": "WI-B-005",
  "title": "箱詰め作業",
  "category": "梱包",
  "process": "梱包工程",
  "line": "Bライン",
  "product": "PK-200 梱包箱",
  "revision": "1",
  "issued": "2026-08-01",
  "updated": "2026-08-01",
  "author": "伊藤",
  "checker": "",
  "inspector": "",
  "approver": "",
  "purpose": "製品をキズなく箱詰めし、数量違いを防ぐ。",
  "cautions": [
    "カッター使用後は必ず刃を戻す"
  ],
  "ppe": [
    "作業用手袋"
  ],
  "tools": [
    { "name": "カッター", "qty": "1本" }
  ],
  "materials": [],
  "steps": [
    {
      "title": "製品を箱に入れる",
      "detail": "仕切りの中に 1 個ずつ入れる。",
      "points": [
        { "text": "向きをそろえる", "reason": "キズ防止のため", "kind": "quality", "video": { "src": "", "start": "", "end": "" } }
      ],
      "time": 20,
      "image": "",
      "video": { "src": "videos/sample.mp4", "start": "0:00", "end": "0:10" }
    },
    {
      "title": "数量を確認してふたを閉じる",
      "detail": "",
      "points": [
        { "text": "指差しで 10 個を数える", "reason": "数量違いを防ぐため", "kind": "quality", "video": { "src": "", "start": "", "end": "" } },
        { "text": "ふたで指をはさまない", "reason": "けが防止のため", "kind": "safety", "video": { "src": "", "start": "", "end": "" } }
      ],
      "time": 15,
      "image": "",
      "video": { "src": "videos/sample.mp4", "start": "0:10", "end": "0:20" }
    }
  ],
  "revisions": [
    { "rev": "1", "date": "2026-08-01", "content": "新規制定", "by": "伊藤" }
  ]
});
