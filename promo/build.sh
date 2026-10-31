#!/bin/bash
# ナレーションの音声 12 本から PR 動画（動きあり版）を作る
#   使い方: bash build.sh <音声フォルダ> "<クレジット>" <出力.mp4>
#   音声フォルダには n1.wav 〜 n12.wav（script.json の n1〜n12 の順）。サンプリング周波数は何でもよい
#   例: bash build.sh voice_tsumugi "VOICEVOX:春日部つむぎ" PR動画_春日部つむぎ.mp4
set -e
cd "$(dirname "$0")"
VDIR="$1"; CREDIT="$2"; OUT="${3:-PR.mp4}"
[ -f grain0.png ] || python3 make_grain.py
# 操作の録画を 1 コマずつの画像にする（30 コマ/秒）
if [ ! -f fr/counts.json ]; then
  python3 - <<'PY'
import subprocess, os, json, glob
c = {}
for f in sorted(glob.glob('rec/*.webm')):
    n = os.path.basename(f)[:-5]; os.makedirs('fr/' + n, exist_ok=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', f, '-vf', 'fps=30', '-q:v', '3', 'fr/%s/%%05d.jpg' % n], check=True)
    c[n] = len(os.listdir('fr/' + n))
json.dump(c, open('fr/counts.json', 'w')); print(c)
PY
fi
# 声を 48kHz にそろえ、音量を整える
mkdir -p .v48
for i in $(seq 1 12); do
  ffmpeg -loglevel error -y -i "$VDIR/n$i.wav" -af "highpass=f=70,loudnorm=I=-18:TP=-2:LRA=7" -ar 48000 -ac 1 ".v48/n$i.wav"
done
python3 - <<'PY'
import json, wave
d = {}
for i in range(1, 13):
    w = wave.open('.v48/n%d.wav' % i)
    d['n%d' % i] = round(w.getnframes() / w.getframerate() + 0.1, 2)
json.dump(d, open('dur.json', 'w')); print(d)
PY
export DUR_FILE=dur.json CREDIT="$CREDIT"
node timing.mjs
python3 mix.py .v48 .audio.wav
node render.mjs
ffmpeg -loglevel error -y -framerate 30 -i frames/f%05d.jpg -i .audio.wav -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart "$OUT"
rm -rf frames .v48 .audio.wav
echo "できました: $OUT"
