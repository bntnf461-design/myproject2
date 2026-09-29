# 判定部分（NG_monitor.ps1 の中の C# NgVision76）の動作確認テスト
# 疑似的なカメラ映像（ランプ点灯/消灯、ノイズ、白い反射、明るさの変化）で、
# 旧方式と新方式（かんたん自動調整）の判定を比べる。画面は不要。
# 実行：powershell -ExecutionPolicy Bypass -File tests\test_vision.ps1   （PowerShell 7 でも可）
$ErrorActionPreference='Stop'
$script:failures=0
$src=Get-Content (Join-Path $PSScriptRoot '..\NG_monitor.ps1') -Raw -Encoding UTF8
$cs=[regex]::Match($src,"(?s)-TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if($PSVersionTable.PSEdition -eq 'Core') {
    Add-Type -ReferencedAssemblies System.Drawing,System.Drawing.Primitives,System.Drawing.Common,System.Runtime.InteropServices,System.Collections,System.Runtime -TypeDefinition $cs
} else {
    Add-Type -ReferencedAssemblies System.Drawing.dll -TypeDefinition $cs
}
# old v75 hue-mode + rgb-mode, ported verbatim to byte buffers for comparison
Add-Type -TypeDefinition @"
using System;
public static class OldAlgo {
  static void RgbToHsv(int r,int g,int b,out double h,out double s,out double v){double rn=r/255.0,gn=g/255.0,bn=b/255.0;double max=Math.Max(rn,Math.Max(gn,bn));double min=Math.Min(rn,Math.Min(gn,bn));v=max;double d=max-min;s=(max<=0)?0:(d/max);if(d<=0.00001){h=0;return;}if(max==rn)h=60.0*(((gn-bn)/d)%6.0);else if(max==gn)h=60.0*(((bn-rn)/d)+2.0);else h=60.0*(((rn-gn)/d)+4.0);if(h<0)h+=360.0;}
  public static double Soft(byte[] buf,int w,int hgt,int stride,int tr,int tg,int tb,double sens){double thr=20+sens/100.0*130;double sum=0;long t=0;for(int y=0;y<hgt;y+=2)for(int x=0;x<w;x+=2){int i=y*stride+x*4;double db=buf[i]-tb,dg=buf[i+1]-tg,dr=buf[i+2]-tr;double dist=Math.Sqrt(dr*dr+dg*dg+db*db);sum+=100.0/(1.0+Math.Exp((dist-thr)/12.0));t++;}return sum/t;}
  public static double Hsv(byte[] buf,int w,int hgt,int stride,double targetHue,double targetSat,double sens){double thr=15+sens/100.0*45;double sum=0;long t=0;for(int y=0;y<hgt;y+=2)for(int x=0;x<w;x+=2){int i=y*stride+x*4;double h,s,v;RgbToHsv(buf[i+2],buf[i+1],buf[i],out h,out s,out v);double hd=Math.Abs(h-targetHue);if(hd>180)hd=360-hd;double dist=hd+Math.Abs(s-targetSat)*100.0*0.5;double sc=100.0/(1.0+Math.Exp((dist-thr)/8.0));if(v<0.06)sc=Math.Min(sc,5.0);sum+=sc;t++;}return sum/t;}
}
"@
$SW=100;$SH=100;$stride=$SW*4
$rng=[Random]::new(1)
function Scene($lampRGB,$gain=1.0,$noise=12,$glare=$true){
  $buf=[byte[]]::new($stride*$SH)
  for($y=0;$y -lt $SH;$y++){for($x=0;$x -lt $SW;$x++){
    $c=@(55,58,62)                                   # dark grey panel
    if($glare -and $x -ge 70 -and $y -lt 25){$c=@(235,235,235)} # white label / reflection
    if($x -ge 35 -and $x -lt 65 -and $y -ge 35 -and $y -lt 65){$c=$lampRGB}  # lamp 30x30
    $i=$y*$stride+$x*4
    $r=[Math]::Min(255,[Math]::Max(0,[int]($c[0]*$gain+$rng.Next(-$noise,$noise+1))))
    $g=[Math]::Min(255,[Math]::Max(0,[int]($c[1]*$gain+$rng.Next(-$noise,$noise+1))))
    $b=[Math]::Min(255,[Math]::Max(0,[int]($c[2]*$gain+$rng.Next(-$noise,$noise+1))))
    $buf[$i]=$b;$buf[$i+1]=$g;$buf[$i+2]=$r;$buf[$i+3]=255
  }}
  return ,$buf
}
$off=Scene @(70,25,25)
$on =Scene @(230,40,40)
$offBright=Scene @(70,25,25) 1.3

"--- 1) Hue-mode target saturation: HSL (old) vs HSV (pixels) ---"
foreach($c in @(@(220,30,30),@(255,150,150),@(100,10,10))){
  $col=[System.Drawing.Color]::FromArgb($c[0],$c[1],$c[2]); $hh=0;$s=0;$v=0
  [NgVision76]::RgbToHsv($c[0],$c[1],$c[2],[ref]$hh,[ref]$s,[ref]$v)
  "RGB($($c -join ',')): HSL sat={0:N2}  HSV sat={1:N2}" -f $col.GetSaturation(),$s
}
"--- 2) White pixel vs red target, hue mode, sens 50 ---"
$white=[byte[]]::new(4*4*4); for($i=0;$i -lt $white.Length;$i+=4){$white[$i]=240;$white[$i+1]=240;$white[$i+2]=240}
$red=[System.Drawing.Color]::FromArgb(220,30,30)
"old: {0:N1}%   new: {1:N1}%" -f [OldAlgo]::Hsv($white,4,4,16,$red.GetHue(),$red.GetSaturation(),50),[NgVision76]::RatioBuf($white,4,4,16,4,220,30,30,50,$true)

"--- 3) Typical setup: area average picked while lamp OFF, appear mode ---"
$avg=[NgVision76]::AverageBuf($off,$SW,$SH,$stride,4,0,0,$SW,$SH)
"reference colour (area average) = $($avg -join ',')"
"old RGB  OFF={0,5:N1}%  ON={1,5:N1}%   (sens 50)" -f [OldAlgo]::Soft($off,$SW,$SH,$stride,$avg[0],$avg[1],$avg[2],50),[OldAlgo]::Soft($on,$SW,$SH,$stride,$avg[0],$avg[1],$avg[2],50)

"--- 4) Auto-tune from one OK and one NG sample (whole area: only a 9-point gap, the lamp is 9% of the area) ---"
$t=[NgVision76]::AutoTuneBuf($off,$on,$SW,$SH,$stride,4,$avg[0],$avg[1],$avg[2]); $t=[object[]]$t
"colour=({0},{1},{2}) hue={3} sens={4}  OK={5:N1}%  NG={6:N1}%  changed={7:N1}%" -f $t
$thr=($t[5]+$t[6])/2; $appear=$t[6] -gt $t[5]
"threshold={0:N1}  direction={1}" -f $thr,$(if($appear){'appear'}else{'disappear'})
foreach($case in @(@('OFF',$off,$false),@('ON',$on,$true))){
  $r=[NgVision76]::RatioBuf($case[1],$SW,$SH,$stride,4,[int]$t[0],[int]$t[1],[int]$t[2],$t[4],[bool]$t[3])
  $ng=$(if($appear){$r -ge $thr}else{$r -lt $thr})
  "{0,-16} ratio={1,5:N1}%  judged={2}  expected={3}  {4}" -f $case[0],$r,$(if($ng){'NG'}else{'OK'}),$(if($case[2]){'NG'}else{'OK'}),$(if($ng -eq $case[2]){'PASS'}else{$script:failures++;'FAIL'})
}
"--- 5) Identical samples are rejected ---"
"result is null: $($null -eq [NgVision76]::AutoTuneBuf($off,$off,$SW,$SH,$stride,4,1,2,3))"
"--- 6) Tighten to the changed region, then tune again ---"
function Crop($buf,$x0,$y0,$x1,$y1){ $cw=$x1-$x0+1;$ch=$y1-$y0+1;$o=[byte[]]::new($cw*$ch*4); for($y=0;$y -lt $ch;$y++){ [Array]::Copy($buf,(($y+$y0)*$stride+$x0*4),$o,($y*$cw*4),($cw*4)) }; return @{b=$o;w=$cw;h=$ch} }
$m=6
$x0=[Math]::Max(0,$t[8]-$m);$y0=[Math]::Max(0,$t[9]-$m);$x1=[Math]::Min($SW-1,$t[10]+$m);$y1=[Math]::Min($SH-1,$t[11]+$m)
"changed bbox: ($($t[8]),$($t[9]))-($($t[10]),$($t[11]))  crop with margin: ($x0,$y0)-($x1,$y1)"
$c1=Crop $off $x0 $y0 $x1 $y1; $c2=Crop $on $x0 $y0 $x1 $y1
$t2=[object[]][NgVision76]::AutoTuneBuf($c1.b,$c2.b,$c1.w,$c1.h,$c1.w*4,4,$t[0],$t[1],$t[2])
"colour=({0},{1},{2}) hue={3} sens={4}  OK={5:N1}%  NG={6:N1}%" -f $t2
$thr=($t2[5]+$t2[6])/2; $appear=$t2[6] -gt $t2[5]
"threshold={0:N1}  direction={1}" -f $thr,$(if($appear){'appear'}else{'disappear'})
foreach($case in @(@('OFF',$off,$false),@('ON',$on,$true),@('OFF bright x1.3',$offBright,$false),@('ON dim x0.8',(Scene @(230,40,40) 0.8),$true),@('ON bright x1.2',(Scene @(230,40,40) 1.2),$true),@('OFF dim x0.7',(Scene @(70,25,25) 0.7),$false),@('OFF, noise 25',(Scene @(70,25,25) 1.0 25),$false))){
  $cc=Crop $case[1] $x0 $y0 $x1 $y1
  $r=[NgVision76]::RatioBuf($cc.b,$cc.w,$cc.h,$cc.w*4,4,[int]$t2[0],[int]$t2[1],[int]$t2[2],$t2[4],[bool]$t2[3])
  $ng=$(if($appear){$r -ge $thr}else{$r -lt $thr})
  "{0,-16} ratio={1,5:N1}%  judged={2}  expected={3}  {4}" -f $case[0],$r,$(if($ng){'NG'}else{'OK'}),$(if($case[2]){'NG'}else{'OK'}),$(if($ng -eq $case[2]){'PASS'}else{$script:failures++;'FAIL'})
}
"--- 7) Green lamp appears (hue change), exposure drifts +-30% ---"
$g0=Scene @(40,60,40); $g1=Scene @(40,200,60)
$t3=[object[]][NgVision76]::AutoTuneBuf($g0,$g1,$SW,$SH,$stride,4,0,0,0)
$c1=Crop $g0 30 30 71 71; $c2=Crop $g1 30 30 71 71
$t3=[object[]][NgVision76]::AutoTuneBuf($c1.b,$c2.b,$c1.w,$c1.h,$c1.w*4,4,$t3[0],$t3[1],$t3[2])
$thr=($t3[5]+$t3[6])/2; $appear=$t3[6] -gt $t3[5]
"colour=({0},{1},{2}) hue={3} sens={4}  OK={5:N1}%  NG={6:N1}%" -f $t3
foreach($case in @(@('OFF x0.7',(Scene @(40,60,40) 0.7),$false),@('OFF x1.3',(Scene @(40,60,40) 1.3),$false),@('ON x0.7',(Scene @(40,200,60) 0.7),$true),@('ON x1.3',(Scene @(40,200,60) 1.3),$true))){
  $cc=Crop $case[1] 30 30 71 71
  $r=[NgVision76]::RatioBuf($cc.b,$cc.w,$cc.h,$cc.w*4,4,[int]$t3[0],[int]$t3[1],[int]$t3[2],$t3[4],[bool]$t3[3])
  $ng=$(if($appear){$r -ge $thr}else{$r -lt $thr})
  "{0,-16} ratio={1,5:N1}%  judged={2}  expected={3}  {4}" -f $case[0],$r,$(if($ng){'NG'}else{'OK'}),$(if($case[2]){'NG'}else{'OK'}),$(if($ng -eq $case[2]){'PASS'}else{$script:failures++;'FAIL'})
}

"--- failures: $script:failures ---"
if($script:failures -gt 0) { exit 1 }
