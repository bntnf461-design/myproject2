import json,re,sys,glob,os
D=os.path.dirname(os.path.abspath(__file__))
APP='/home/user/myproject2/defect-counter.html'
d={}
for f in sorted(glob.glob(D+'/d*.tsv')):
    for ln in open(f,encoding='utf-8').read().split('\n'):
        if not ln.strip(): continue
        k,v=(ln.split('\t',1)+[''])[:2]
        d[k]=v.strip()
import unicodedata
P='\u3000\u3001\u3002\u300c\u300d\u300e\u300f\uff08\uff09\uff1a\uff0f\u30fb\uff5c\u301c'
for k,v in list(d.items()):
    k2=k.strip(P)
    if len(k2)>=2 and k2!=k and k2 not in d:
        d[k2]=v.strip(' )(:,.“”/|·–-')
eng=open(D+'/engine.js',encoding='utf-8').read()
js=json.dumps(d,ensure_ascii=False,sort_keys=True,separators=(',',':'))
eng=eng.replace('/*I18N-DICT*/{}/*/I18N-DICT*/','/*I18N-DICT*/'+js+'/*/I18N-DICT*/')
s=open(APP,encoding='utf-8').read()
block='<script id="i18n">\n'+eng+'</script>\n'
if '<script id="i18n">' in s:
    s=re.sub(r'<script id="i18n">\n.*?</script>\n',lambda m:block,s,count=1,flags=re.S)
else:
    s=s.replace('<script>\n// ファイル名の後ろに #report',block+'<script>\n// ファイル名の後ろに #report',1)
open(APP,'w',encoding='utf-8').write(s)
print('entries',len(d),'block',len(block))
