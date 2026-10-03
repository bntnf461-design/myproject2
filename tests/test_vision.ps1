# 判定部分（NG_monitor.ps1 の中の C#）の動作確認テスト。画面は不要。
# 疑似的なカメラ映像（ランプ点灯/消灯、部品の有無、ノイズ、明るさの変化、
# 暗い場所、夜間の赤外線（白黒）映像）で、判定が正しいかを確かめる。
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

$SW=100; $SH=100; $stride=$SW*4
$rng=[Random]::new(1)
# 疑似カメラ映像：背景 $bg、中央30x30にランプ/部品 $obj（$null なら何も無い）
# $gain：明るさ（露出）の変化、$noise：映像のざらつき、$gray：赤外線（白黒）映像
function Scene($bg,$obj,$gain=1.0,$noise=12,$gray=$false,$glare=$true) {
    $buf=[byte[]]::new($stride*$SH)
    for($y=0;$y -lt $SH;$y++){ for($x=0;$x -lt $SW;$x++){
        $c=$bg
        if($glare -and $x -ge 70 -and $y -lt 25){ $c=@([int]($bg[0]*4+40),[int]($bg[1]*4+40),[int]($bg[2]*4+40)) }  # 白っぽい反射
        if($obj -and $x -ge 35 -and $x -lt 65 -and $y -ge 35 -and $y -lt 65){ $c=$obj }
        $r=$c[0]*$gain; $g=$c[1]*$gain; $b=$c[2]*$gain
        if($gray){ $l=0.299*$r+0.587*$g+0.114*$b; $r=$l; $g=$l; $b=$l }
        $i=$y*$stride+$x*4
        $buf[$i+2]=[byte][Math]::Min(255,[Math]::Max(0,[int]$r+$rng.Next(-$noise,$noise+1)))
        $buf[$i+1]=[byte][Math]::Min(255,[Math]::Max(0,[int]$g+$rng.Next(-$noise,$noise+1)))
        $buf[$i]  =[byte][Math]::Min(255,[Math]::Max(0,[int]$b+$rng.Next(-$noise,$noise+1)))
        $buf[$i+3]=255
    }}
    return ,$buf
}
function Check($label,$ng,$expected,$value,$unit) {
    $ok=($ng -eq $expected)
    if(-not $ok){ $script:failures++ }
    "{0,-34} {1,6:N1}{2}  判定={3}  期待={4}  {5}" -f $label,$value,$unit,$(if($ng){'NG'}else{'OK'}),$(if($expected){'NG'}else{'OK'}),$(if($ok){'PASS'}else{'FAIL'})
}
function Crop($buf,$x0,$y0,$x1,$y1){ $cw=$x1-$x0+1;$ch=$y1-$y0+1;$o=[byte[]]::new($cw*$ch*4); for($y=0;$y -lt $ch;$y++){ [Array]::Copy($buf,(($y+$y0)*$stride+$x0*4),$o,($y*$cw*4),($cw*4)) }; return @{b=$o;w=$cw;h=$ch} }

# ---------------- 色で判定（従来方式＋自動調整） ----------------
"=== 色で判定：白い反射は赤と一致しない ==="
$white=[byte[]]::new(8*8*4); for($i=0;$i -lt $white.Length;$i+=4){$white[$i]=240;$white[$i+1]=240;$white[$i+2]=240;$white[$i+3]=255}
Check '白 240,240,240 vs 赤（色味重視）' ([NgVision79]::RatioImage($white,8,8,32,4,220,30,30,50,$true) -ge 5) $false ([NgVision79]::RatioImage($white,8,8,32,4,220,30,30,50,$true)) '%'

"=== 色で判定：赤ランプ（自動調整＋範囲の絞り込み、明るさ±20～30%） ==="
$bgA=@(55,58,62); $off=Scene $bgA @(70,25,25); $on=Scene $bgA @(230,40,40)
$t=[object[]][NgVision79]::AutoTuneImage($off,$on,$SW,$SH,$stride,4,0,0,0)
$m=6; $x0=[Math]::Max(0,$t[8]-$m);$y0=[Math]::Max(0,$t[9]-$m);$x1=[Math]::Min($SW-1,$t[10]+$m);$y1=[Math]::Min($SH-1,$t[11]+$m)
$c1=Crop $off $x0 $y0 $x1 $y1; $c2=Crop $on $x0 $y0 $x1 $y1
$t=[object[]][NgVision79]::AutoTuneImage($c1.b,$c2.b,$c1.w,$c1.h,$c1.w*4,4,$t[0],$t[1],$t[2])
$thr=($t[5]+$t[6])/2; $appear=$t[6] -gt $t[5]
foreach($case in @(@('消灯',(Scene $bgA @(70,25,25)),$false),@('点灯',(Scene $bgA @(230,40,40)),$true),@('消灯・明るめx1.3',(Scene $bgA @(70,25,25) 1.3),$false),@('点灯・暗めx0.8',(Scene $bgA @(230,40,40) 0.8),$true),@('消灯・ノイズ大',(Scene $bgA @(70,25,25) 1.0 25),$false))) {
    $cc=Crop $case[1] $x0 $y0 $x1 $y1
    $r=[NgVision79]::RatioImage($cc.b,$cc.w,$cc.h,$cc.w*4,4,[int]$t[0],[int]$t[1],[int]$t[2],$t[4],[bool]$t[3])
    Check $case[0] $(if($appear){$r -ge $thr}else{$r -lt $thr}) $case[2] $r '%'
}

# ---------------- 正常な映像と比べる（v79） ----------------
function Sample($buf) { return ,[NgDiff79]::SampleBuf($buf,$SW,$SH,$stride,4,0,0,$SW,$SH) }
function Reference($frames) {
    $arr=New-Object 'float[][][]' $frames.Count
    for($i=0;$i -lt $frames.Count;$i++){ $arr[$i]=Sample $frames[$i] }
    return ,[NgDiff79]::BuildReference($arr,$SW,$SH)
}
# 記録した正常の見本（{細かい, ゆらぎ, 粗い, ゆらぎ} の組）を並べる：Refs $見本1 $見本2 ...
function Refs {
    $r=New-Object 'float[][]' ($args.Count*4)
    for($i=0;$i -lt $args.Count;$i++){ for($j=0;$j -lt 4;$j++){ $r[4*$i+$j]=$args[$i][$j] } }
    return ,$r
}
$T=0.15; $S=50   # 初期値：いちばん大きな「違う部分」が 0.15% 以上でNG、感度 50
function Judge($label,$refs,$buf,$expected) {
    $s=[NgDiff79]::ScoreImageBuf($refs,$buf,$SW,$SH,$stride,4,0,0,$SW,$SH,$S,$null)
    Check $label ($s -ge $T) $expected $s '%'
}

"=== 比べる：明るい場所、正常を1回記録しただけ（初期設定のまま） ==="
$refs=Refs (Reference @((1..10 | % { Scene $bgA @(70,25,25) })))
Judge '消灯（正常）' $refs (Scene $bgA @(70,25,25)) $false
Judge '点灯（異常）' $refs (Scene $bgA @(230,40,40)) $true
Judge '露出の変化 x0.85' $refs (Scene $bgA @(70,25,25) 0.85) $false
Judge '露出の変化 x1.2' $refs (Scene $bgA @(70,25,25) 1.2) $false
Judge '部品が無くなった' $refs (Scene $bgA $null) $true

"=== 比べる：暗い場所（背景 14、ざらつき大）、正常を1回記録しただけ ==="
$bgD=@(14,14,16)
$refs=Refs (Reference @((1..10 | % { Scene $bgD @(24,11,11) 1.0 7 })))
Judge '暗・消灯（正常）' $refs (Scene $bgD @(24,11,11) 1.0 7) $false
Judge '暗・うっすら点灯 R60（異常）' $refs (Scene $bgD @(60,18,18) 1.0 7) $true
Judge '暗・露出の変化 x1.2' $refs (Scene $bgD @(24,11,11) 1.2 7) $false
Judge '暗・露出の変化 x0.8' $refs (Scene $bgD @(24,11,11) 0.8 7) $false

"=== 比べる：暗い場所で、暗い部品が無くなった ==="
$refs=Refs (Reference @((1..10 | % { Scene $bgD @(38,38,42) 1.0 7 })))
Judge '暗・部品あり（正常）' $refs (Scene $bgD @(38,38,42) 1.0 7) $false
Judge '暗・部品なし（異常）' $refs (Scene $bgD $null 1.0 7) $true

"=== 旧方式（v75：範囲の平均色）で、同じ暗い場面 ==="
$avg=[NgVision79]::AverageBuf((Scene $bgD @(24,11,11) 1.0 7),$SW,$SH,$stride,4,0,0,$SW,$SH)
$rOff=[NgVision79]::RatioImage((Scene $bgD @(24,11,11) 1.0 7),$SW,$SH,$stride,4,$avg[0],$avg[1],$avg[2],50,$false)
$rOn=[NgVision79]::RatioImage((Scene $bgD @(60,18,18) 1.0 7),$SW,$SH,$stride,4,$avg[0],$avg[1],$avg[2],50,$false)
"参考：消灯 {0:N1}% / 点灯 {1:N1}% → ほとんど差が無く、しきい値では見分けられない" -f $rOff,$rOn

"=== 比べる：昼はカラー、夜は赤外線（白黒）になるカメラ。昼と夜の正常を1回ずつ記録 ==="
$dayRef=Reference @((1..10 | % { Scene $bgA @(70,25,25) }))
$nightRef=Reference @((1..10 | % { Scene @(30,30,30) @(45,45,45) 1.0 8 $true }))
$refs=Refs $dayRef $nightRef
Judge '昼・正常' $refs (Scene $bgA @(70,25,25)) $false
Judge '昼・異常（点灯）' $refs (Scene $bgA @(230,40,40)) $true
Judge '夜・正常（白黒）' $refs (Scene @(30,30,30) @(45,45,45) 1.0 8 $true) $false
Judge '夜・異常（白黒で明るく点灯）' $refs (Scene @(30,30,30) @(150,150,150) 1.0 8 $true) $true
$refs1=Refs $dayRef
$s=[NgDiff79]::ScoreImageBuf($refs1,(Scene @(30,30,30) @(45,45,45) 1.0 8 $true),$SW,$SH,$stride,4,0,0,$SW,$SH,$S,$null)
"参考：昼の正常だけ記録した場合、夜の正常は 違い {0:N1}% → NG扱いになる（夜の正常も記録する必要がある）" -f $s

"=== 比べる：異常も記録すると、感度としきい値を自動で決める ==="
$okS=New-Object 'float[][][]' 10; for($i=0;$i -lt 10;$i++){ $okS[$i]=Sample (Scene $bgD @(24,11,11) 1.0 7) }
$refs=Refs ([NgDiff79]::BuildReference($okS,$SW,$SH))
$ngS=Sample (Scene $bgD @(45,15,15) 1.0 7)
$tune=[NgDiff79]::Tune($refs,$okS,$ngS,$SW,$SH)
$S=$tune[0]; $T=[Math]::Round([Math]::Max(0.05,[Math]::Round(($tune[1]+$tune[2])/2/0.05)*0.05),2)
"自動調整：感度 {0} / 正常時 {1:N2}% / 異常時 {2:N2}% → しきい値 {3}%" -f $tune[0],$tune[1],$tune[2],$T
Judge '暗・消灯（正常）' $refs (Scene $bgD @(24,11,11) 1.0 7) $false
Judge '暗・ごくわずかに点灯 R45（異常）' $refs (Scene $bgD @(45,15,15) 1.0 7) $true

# ---------------- 模様のある背景・映像のずれ・時計表示・小さな異常（v79で改善） ----------------
Add-Type -TypeDefinition (Get-Content (Join-Path $PSScriptRoot 'SceneGen.cs') -Raw)
$GW=[SceneGen]::W; $GH=[SceneGen]::H; $GM=3; $BW=$GW+2*$GM; $BH=$GH+2*$GM
function Textured($title,$baseLevel,$contrast,$noise){
    [SceneGen]::Init(7,$baseLevel,$contrast)
    $smp=New-Object 'float[][][]' 10
    for($i=0;$i -lt 10;$i++){ $smp[$i]=[NgDiff79]::SampleBuf(([SceneGen]::Frame(100+$i,0,0,1.0,$noise,0,[int]($i/7),$GM)),$BW,$BH,$BW*4,4,$GM,$GM,$GW,$GH) }
    $r=[NgDiff79]::BuildReference($smp,$GW,$GH)
    "=== 比べる：$title（しきい値 0.15%） ==="
    foreach($c in @(
        @('正常',0,0,1.0,0,1,$false),@('正常・時計が進む',0,0,1.0,0,2,$false),@('正常・露出 x0.85',0,0,0.85,0,1,$false),
        @('正常・映像が1pxずれる',1,0,1.0,0,1,$false),@('正常・映像が2pxずれる',2,1,1.0,0,1,$false),@('正常・映像が3pxずれる',3,-2,1.0,0,1,$false),
        @('異常・小さな部品なし（範囲の0.3%）',0,0,1.0,1,1,$true),@('異常・小さなランプ点灯',0,0,1.0,2,1,$true),@('異常・物が入る',0,0,1.0,3,1,$true),
        @('異常・部品なし＋1pxずれ',1,0,1.0,1,1,$true),@('異常・部品なし＋2pxずれ',2,1,1.0,1,1,$true))) {
        $vals=foreach($k in 0..4){ [NgDiff79]::ScoreImageBuf($r,([SceneGen]::Frame(500+$k,$c[1],$c[2],$c[3],$noise,$c[4],$c[5],$GM)),$BW,$BH,$BW*4,4,$GM,$GM,$GW,$GH,50,$null) }
        $v=$(if($c[6]){($vals|Measure-Object -Minimum).Minimum}else{($vals|Measure-Object -Maximum).Maximum})
        Check $c[0] ($v -ge 0.15) $c[6] $v '%'
    }
}
Textured '明るい場所・模様のある背景' 90 60 8
Textured '暗い場所・模様のある背景' 18 14 6

# ---------------- 異常の時だけ出る画面が出たらNG（v80） ----------------
Add-Type -TypeDefinition (Get-Content (Join-Path $PSScriptRoot 'HmiGen.cs') -Raw)
$HW=[HmiGen]::W; $HH=[HmiGen]::H; $HBW=$HW+2*$GM; $HBH=$HH+2*$GM
function HmiRef([scriptblock]$make,$n){
    $a=New-Object 'float[][][]' $n
    for($i=0;$i -lt $n;$i++){ $a[$i]=[NgDiff79]::SampleBuf((& $make ($i+1)),$HBW,$HBH,$HBW*4,4,$GM,$GM,$HW,$HH) }
    return ,[NgDiff79]::BuildReference($a,$HW,$HH)
}
function Join-Refs { $r=New-Object 'float[][]' ($args.Count*4); for($i=0;$i -lt $args.Count;$i++){ for($j=0;$j -lt 4;$j++){ $r[4*$i+$j]=$args[$i][$j] } }; return ,$r }
$hNg=HmiRef { param($i) [HmiGen]::Frame(1,5,1,0,0,$GM,4) } 1                       # 異常の画面：1枚（画像ファイルから読み込んだ場合と同じ）
$hOk=HmiRef { param($i) [HmiGen]::Frame(10+$i,$i,0,0,0,$GM,4) } 10                  # 正常な画面：値が変わる10コマ
$hInfo=HmiRef { param($i) [HmiGen]::Frame(200+$i,$i*3,3,0,0,$GM,4) } 3             # 関係ない案内画面
$ngArr=Join-Refs $hNg
$setups=@(@('異常の画面だけ記録',(New-Object 'float[][]' 0)),@('異常＋正常な画面を記録',(Join-Refs $hOk)),@('異常＋正常＋案内画面も正常として記録',(Join-Refs $hOk $hInfo)))
foreach($su in $setups){
    "=== 異常の画面が出たらNG：$($su[0])（しきい値 90%） ==="
    $cases=@(@('正常（値が変化）',23,0,0,0,$false),@('正常（別の値）',41,0,0,0,$false),@('正常・2pxずれ',17,0,2,1,$false),
             @('異常の画面が出た',33,1,0,0,$true),@('異常の画面（別のメッセージ）',12,2,0,0,$true),@('異常の画面・2pxずれ',8,1,-2,2,$true),
             @('関係ない案内画面（同じ形・青）',30,3,0,0,$false))
    foreach($c in $cases){
        $v=[NgDiff79]::MatchImageBuf($ngArr,$su[1],([HmiGen]::Frame(100+$c[1],$c[1],$c[2],$c[3],$c[4],$GM,4)),$HBW,$HBH,$HBW*4,4,$GM,$GM,$HW,$HH,50,$null)
        Check $c[0] ($v -ge 90) $c[5] $v '%'
    }
}
"=== 参考：値が変わる画面を「正常な映像と比べる」で見ると ==="
$v=[NgDiff79]::ScoreImageBuf((Join-Refs $hOk),([HmiGen]::Frame(141,41,0,0,0,$GM,4)),$HBW,$HBH,$HBW*4,4,$GM,$GM,$HW,$HH,50,$null)
"参考：正常（別の値）が 違い {0:N2}% → {1}" -f $v,$(if($v -ge 0.15){'誤ってNGになる（このような画面には「異常の画面が出たらNG」が向いている）'}else{'OK'})

"=== v81：明るさがゆっくり変わる（1.0 → 0.55）。自動追従あり ==="
[SceneGen]::Init(7,90,60)
$smp=New-Object 'float[][][]' 10
for($i=0;$i -lt 10;$i++){ $smp[$i]=[NgDiff79]::SampleBuf(([SceneGen]::Frame(100+$i,0,0,1.0,8,0,0,$GM)),$BW,$BH,$BW*4,4,$GM,$GM,$GW,$GH) }
$dref=[NgDiff79]::BuildReference($smp,$GW,$GH)
$work=New-Object 'float[][]' 4; for($j=0;$j -lt 4;$j++){ $work[$j]=[float[]]$dref[$j].Clone() }
function ScA($refs,$buf,$fm,$cm,$rate){ [NgDiff79]::ScoreImageBufEx($refs,$buf,$BW,$BH,$BW*4,4,$GM,$GM,$GW,$GH,50,$null,$fm,$cm,$rate,0.075) }
$fpNo=0; $fpAd=0
for($t=0;$t -le 90;$t++){
    $g=1.0-0.45*$t/90
    if((ScA $dref ([SceneGen]::Frame(1000+$t,0,0,$g,8,0,0,$GM)) $null $null 0) -ge 0.15){ $fpNo++ }
    for($r=0;$r -lt 20;$r++){ $s=ScA $work ([SceneGen]::Frame(1000+$t,0,0,$g,8,0,0,$GM)) $null $null 0.002; if($r -eq 0 -and $s -ge 0.15){ $fpAd++ } }
}
"参考：自動追従なしだと 誤NG {0}/91 コマ" -f $fpNo
Check '自動追従あり：誤NG（91コマ中）' ($fpAd -gt 0) $false $fpAd 'コマ'
$v=ScA $work ([SceneGen]::Frame(3000,0,0,0.55,8,1,0,$GM)) $null $null 0.002
Check '暗くなった後：小さな部品なし' ($v -ge 0.15) $true $v '%'
$v=ScA $work ([SceneGen]::Frame(3001,0,0,0.55,8,4,0,$GM)) $null $null 0.002
Check '暗くなった後：ランプ点灯' ($v -ge 0.15) $true $v '%'
$held=0; for($r=0;$r -lt 300;$r++){ if((ScA $work ([SceneGen]::Frame(4000+$r,0,0,0.55,8,1,0,$GM)) $null $null 0.002) -ge 0.15){ $held++ } }
Check '部品なしが300回続いても覚え込まない' ($held -eq 300) $true $held '回NG'
Check '記録した見本は書き換わらない' ([NgDiff79]::ScoreImageBuf($dref,([SceneGen]::Frame(5,0,0,1.0,8,0,0,$GM)),$BW,$BH,$BW*4,4,$GM,$GM,$GW,$GH,50,$null) -ge 0.15) $false 0 ''

"=== v81：正常でも動くアーム。除外する場所を指定 ==="
$smp=New-Object 'float[][][]' 10
for($i=0;$i -lt 10;$i++){ $smp[$i]=[NgDiff79]::SampleBuf(([SceneGen]::Frame(100+$i,0,0,1.0,8,0,0,$GM,$i)),$BW,$BH,$BW*4,4,$GM,$GM,$GW,$GH) }
$aref=[NgDiff79]::BuildReference($smp,$GW,$GH)
$mx=0; for($k=0;$k -lt 20;$k++){ $mx=[Math]::Max($mx,(ScA $aref ([SceneGen]::Frame(2000+$k,0,0,1.0,8,0,0,$GM,13+$k)) $null $null 0)) }
"参考：除外しないと アームが動くだけで 違い 最大 {0:N2}%" -f $mx
$fw=0;$fh=0;[NgDiff79]::GridFor($GW,$GH,[NgDiff79]::FineCells,[ref]$fw,[ref]$fh); $cw=0;$ch=0;[NgDiff79]::GridFor($GW,$GH,[NgDiff79]::CoarseCells,[ref]$cw,[ref]$ch)
$fm=[NgDiff79]::CellMask($GW,$GH,$fw,$fh,[int[]]@(2,56,46,60)); $cm=[NgDiff79]::CellMask($GW,$GH,$cw,$ch,[int[]]@(2,56,46,60))
$mx=0; for($k=0;$k -lt 20;$k++){ $mx=[Math]::Max($mx,(ScA $aref ([SceneGen]::Frame(2000+$k,0,0,1.0,8,0,0,$GM,13+$k)) $fm $cm 0)) }
Check '除外あり：アームが動く（正常）' ($mx -ge 0.15) $false $mx '%'
$v=ScA $aref ([SceneGen]::Frame(2100,0,0,1.0,8,1,0,$GM,17)) $fm $cm 0
Check '除外あり：離れた場所の部品なし' ($v -ge 0.15) $true $v '%'
$v=ScA $aref ([SceneGen]::Frame(2101,0,0,1.0,8,4,0,$GM,19)) $fm $cm 0
Check '除外あり：除外のすぐ外のランプ点灯' ($v -ge 0.15) $true $v '%'
$o=New-Object 'float[][][]' 1; $o[0]=[NgDiff79]::SampleBuf(([SceneGen]::Frame(2200,0,0,1.0,8,0,0,$GM,25)),$BW,$BH,$BW*4,4,$GM,$GM,$GW,$GH)
$v=[NgDiff79]::ScoreSampleMasked($aref,$o[0][0],$o[0][1],$GW,$GH,50,$fm,$cm)
Check '除外あり：記録したコマの判定（メーターの▼）' ($v -ge 0.15) $false $v '%'

"=== v81：除外せず「長めに記録（150コマ）」でアームの動きを覚える ==="
$long=New-Object 'float[][][]' 150
for($i=0;$i -lt 150;$i++){ $long[$i]=[NgDiff79]::SampleBuf(([SceneGen]::Frame(5000+$i,0,0,1.0,8,0,0,$GM,$i)),$BW,$BH,$BW*4,4,$GM,$GM,$GW,$GH) }
$lref=[NgDiff79]::BuildReference($long,$GW,$GH)
$mx=0; for($k=0;$k -lt 20;$k++){ $mx=[Math]::Max($mx,(ScA $lref ([SceneGen]::Frame(2000+$k,0,0,1.0,8,0,0,$GM,13+$k)) $null $null 0)) }
Check '長めに記録：アームが動く（正常）' ($mx -ge 0.15) $false $mx '%'
$v=ScA $lref ([SceneGen]::Frame(2100,0,0,1.0,8,1,0,$GM,17)) $null $null 0
Check '長めに記録：部品なし' ($v -ge 0.15) $true $v '%'

"=== 保存用の圧縮・復元 ==="
$v=[float[]]@(0,1.5,12.25,255,4000); $u=[NgBlock79]::Unpack([NgBlock79]::Pack($v))
Check '圧縮して戻しても同じ値' ((($v | % {$_}) -join ',') -ne (($u | % {$_}) -join ',')) $false 0 ''

"--- 失敗：$script:failures 件 ---"
if($script:failures -gt 0) { exit 1 }
