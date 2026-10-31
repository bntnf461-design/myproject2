# ナレーションを自然にする：会話調の原稿・文ごとに合成して間を調整・声の質感を整える
import pyopenjtalk, numpy as np, wave, json, sys, re, subprocess, os
from pyopenjtalk import HTSEngine
VOICE=sys.argv[1]; OUT=sys.argv[2]; MARINE=len(sys.argv)>3 and sys.argv[3]=='marine'
SPEED=float(os.environ.get('SPEED','0.97')); HALF=float(os.environ.get('HALF','0'))
LINES=json.load(open('script.json',encoding='utf-8'))
os.makedirs(OUT,exist_ok=True)
eng=HTSEngine(VOICE.encode()); eng.set_speed(SPEED)
if HALF: eng.add_half_tone(HALF)
sr=eng.get_sampling_frequency()
GAP_SENT=0.42  # 文と文の間
def synth(text):
    labels=pyopenjtalk.extract_fullcontext(text, run_marine=MARINE) if MARINE else pyopenjtalk.extract_fullcontext(text)
    x=np.asarray(eng.synthesize(labels),dtype=np.float64); eng.refresh()
    # 前後の無音を詰める
    thr=np.max(np.abs(x))*0.02; idx=np.where(np.abs(x)>thr)[0]
    return x[max(0,idx[0]-int(.03*sr)):idx[-1]+int(.06*sr)] if len(idx) else x
durs={}
for key,text in LINES.items():
    parts=[p for p in re.split(r'\|',text) if p.strip()]
    sents=[]
    for p in parts: sents+= [s for s in re.findall(r'[^。？！]+[。？！]?',p) if s.strip()]
    buf=[]
    for i,s in enumerate(sents):
        buf.append(synth(s))
        if i<len(sents)-1: buf.append(np.zeros(int(GAP_SENT*sr)))
    x=np.concatenate(buf); x=x/np.max(np.abs(x))*0.8
    raw=f'{OUT}/{key}_raw.wav'
    with wave.open(raw,'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((x*32767).astype(np.int16).tobytes())
    # 声の質感：低い雑音を切り、耳につく高音を少し抑え、ごく小さな部屋の響き
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',raw,'-af',
      'highpass=f=90,lowpass=f=9500,equalizer=f=3200:t=q:w=1.2:g=-2.5,equalizer=f=220:t=q:w=1:g=1.5,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120,aecho=0.85:0.6:28|47:0.10|0.06,loudnorm=I=-18:TP=-2:LRA=7',
      '-ar','48000',f'{OUT}/{key}.wav'],check=True)
    os.remove(raw)
    durs[key]=round(len(x)/sr+0.15,2)
json.dump(durs,open(f'{OUT}/dur.json','w'))
print(json.dumps(durs))
