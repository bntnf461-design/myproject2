registerManual({
  "id": "WI-Q-010",
  "docNo": "WI-Q-010",
  "title": "始業前点検（検査装置）",
  "category": "点検",
  "process": "最終検査工程",
  "line": "共通",
  "product": "",
  "revision": "1",
  "issued": "2026-09-01",
  "updated": "2026-09-01",
  "author": "高橋",
  "checker": "",
  "approver": "",
  "purpose": "検査装置が正常であることを始業前に確認し、検査ミスを防ぐ。",
  "cautions": [
    "点検中は装置の非常停止ボタンが押せる位置に立つ"
  ],
  "ppe": [
    "保護メガネ"
  ],
  "tools": [
    { "name": "限度見本（OK品・NG品）", "qty": "各1個" }
  ],
  "materials": [],
  "steps": [
    {
      "title": "装置の電源を入れる",
      "detail": "主電源 → 操作盤の順に入れる。",
      "points": [
        { "text": "操作盤に異常表示が出ていないか確認", "reason": "", "kind": "" }
      ],
      "time": 30,
      "image": "",
      "video": { "src": "videos/sample.mp4", "start": "", "end": "" }
    },
    {
      "title": "OK品・NG品で判定を確認する",
      "detail": "限度見本を流し、OK品は合格、NG品は不合格となることを確認する。",
      "points": [
        { "text": "NG品が必ず不合格になること", "reason": "不良品の見逃しを防ぐため", "kind": "quality" }
      ],
      "time": 60,
      "image": "",
      "video": { "src": "", "start": "", "end": "" }
    },
    {
      "title": "点検表に記入する",
      "detail": "結果・時刻・氏名を記入する。異常時は班長へ報告。",
      "points": [],
      "time": 20,
      "image": "",
      "video": { "src": "", "start": "", "end": "" }
    }
  ],
  "revisions": [
    { "rev": "1", "date": "2026-09-01", "content": "新規制定", "by": "高橋" }
  ]
});
