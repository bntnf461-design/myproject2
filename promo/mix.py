import json, wave, numpy as np, sys
VDIR, OUT = sys.argv[1], sys.argv[2]
T=json.load(open('timing.json')); SR=48000; end=int(T['total']*SR); N=end+SR
voice=np.zeros(N); active=np.zeros(N)
for k,at in T['voice']:
    w=wave.open(f'{VDIR}/{k}.wav'); assert w.getframerate()==SR
    x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16)/32768.0
    if w.getnchannels()==2: x=x[::2]
    i=int(at*SR); voice[i:i+len(x)]+=x; active[i:i+len(x)]=1
t=np.arange(N)/SR
def note(m): return 440*2**((m-69)/12)
chords=[[48,55,64,67,71],[45,52,60,64,67],[41,48,57,64,69],[43,50,59,62,67]]
bar=4.0; bgm=np.zeros(N)
for ci in range(int(T['total']/bar)+2):
    ch=chords[ci%4]; s=int(ci*bar*SR); e=min(N,int((ci+1)*bar*SR+1.2*SR))
    if s>=N: break
    tt=np.arange(e-s)/SR; env=np.minimum(1,tt/1.2)*np.clip(1-(tt-bar)/1.2,0,1); seg=np.zeros(e-s)
    for m in ch:
        f=note(m)
        for h,a in ((1,1),(2,.35),(3,.12)):
            seg+=a*np.sin(2*np.pi*f*h*tt)+a*0.5*np.sin(2*np.pi*f*h*1.003*tt)
    bgm[s:e]+=seg*env
bgm=np.convolve(bgm,np.ones(24)/24,mode='same'); bgm/=np.max(np.abs(bgm))
duck=np.convolve(active,np.ones(int(.25*SR))/int(.25*SR),mode='same')
gain=0.15*(1-0.6*np.clip(duck,0,1))
fade=np.ones(N); fi=int(1.5*SR); fade[:fi]=np.linspace(0,1,fi); fo=int(3*SR); fade[end-fo:end]=np.linspace(1,0,fo); fade[end:]=0
mix=(voice*0.95+bgm*gain*fade)[:end]; mix=mix/max(1,np.max(np.abs(mix))/0.97)
st=np.stack([mix,mix],1)
w=wave.open(OUT,'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st*32767).astype(np.int16).tobytes()); w.close()
print(OUT, len(mix)/SR)
