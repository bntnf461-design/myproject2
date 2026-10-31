# PR 動画の材料（作業要領書 × 動画・動きあり版）

製品の ZIP には入りません（`.gitattributes` で除外）。PR 動画を作り直すための材料と手順です。

## 中身

| ファイル | 内容 |
|---|---|
| `pr3.html` | 動画の絵と動き（時間 t を渡すとその瞬間の絵になる） |
| `script.json` / `text.json` | ナレーション原稿（n1〜n12。`|` は文の区切り）と、字幕の文 |
| `L_fg_g.png` / `R_fg_g.png` | 元の写真から切り抜いた人物（色味を落ち着かせ、細かい粒子を加えたもの）。左＝これまで、右＝これから |
| `L_bg_g.jpg` / `R_bg_g.jpg` | 人物を消して埋めた背景（少しピントをぼかす）。人物と背景を別々に動かして奥行きを出す |
| `bg_L.jpg` / `bg_R.jpg` / `bg_ui.jpg` | ぼかした全体の背景 |
| `rec/*.webm` | アプリを実際に操作した録画（架空の「ガラスの外観検査」の要領書。マウスの矢印と押した印つき） |
| `build.sh` | 声 12 本 → 完成した MP4 まで一度に作る |
| `mix.py` | 声と BGM（自作の和音）を合わせる。声の間は BGM を小さくする |
| `tts2.py` | Open JTalk（声「Mei」）でナレーションを作る（予備） |

## 春日部つむぎ（VOICEVOX）の声で作り直す

1. VOICEVOX CORE（Python 版）と、声のモデル・辞書・ONNX Runtime を用意する（GitHub `VOICEVOX/voicevox_core` のリリースにあるダウンローダーで取得できる）
2. `script.json` の n1〜n12 を、**春日部つむぎ（ノーマル）**で 1 本ずつ WAV にする（`|` は文の区切りなので取り除いてよい。読み方は「エクセル」「一本」で書いてある）
3. `voice_tsumugi/n1.wav` 〜 `n12.wav` として置く
4. `bash build.sh voice_tsumugi "VOICEVOX:春日部つむぎ" PR動画_春日部つむぎ.mp4`
   - 最後の画面に「VOICEVOX:春日部つむぎ」と表示される（**利用規約で表示が必要**）
   - 場面の長さは声の長さに合わせて自動で決まる（約 90 秒。書き出しに 10 分ほどかかる）
   - Chromium の場所が違う場合は `CHROME=/path/to/chrome` を付ける

必要なもの：Node.js と Playwright（このフォルダで `npm i playwright`）、Python 3（numpy・Pillow）、ffmpeg（libx264・libvpx）、日本語フォント（IPAPGothic など）

## 注意

- 写真は依頼者からいただいたもの（AI で作られた画像）。人物の顔は大きく映さず、手元・作業・画面を中心に見せている。より本物らしくするには、実際の工場で撮った写真・動画に差し替えるのがいちばん効果がある
- 製品の画面は架空のデータで撮影しており、社内の Excel の中身は使っていない
- 声「Mei」を使う場合は、最後の画面に「HTS Voice "Mei" © Nagoya Institute of Technology（CC BY 3.0）」の表示が必要（`CREDIT` を空にすると自動でこの表示）
- 「お問い合わせ：〇〇〇〇」は仮の文字（`pr3.html` の終わりの場面）
