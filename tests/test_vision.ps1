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
Check '白 240,240,240 vs 赤（色味重視）' ([NgVision77]::RatioImage($white,8,8,32,4,220,30,30,50,$true) -ge 5) $false ([NgVision77]::RatioImage($white,8,8,32,4,220,30,30,50,$true)) '%'

"=== 色で判定：赤ランプ（自動調整＋範囲の絞り込み、明るさ±20～30%） ==="
$bgA=@(55,58,62); $off=Scene $bgA @(70,25,25); $on=Scene $bgA @(230,40,40)
$t=[object[]][NgVision77]::AutoTuneImage($off,$on,$SW,$SH,$stride,4,0,0,0)
$m=6; $x0=[Math]::Max(0,$t[8]-$m);$y0=[Math]::Max(0,$t[9]-$m);$x1=[Math]::Min($SW-1,$t[10]+$m);$y1=[Math]::Min($SH-1,$t[11]+$m)
$c1=Crop $off $x0 $y0 $x1 $y1; $c2=Crop $on $x0 $y0 $x1 $y1
$t=[object[]][NgVision77]::AutoTuneImage($c1.b,$c2.b,$c1.w,$c1.h,$c1.w*4,4,$t[0],$t[1],$t[2])
$thr=($t[5]+$t[6])/2; $appear=$t[6] -gt $t[5]
foreach($case in @(@('消灯',(Scene $bgA @(70,25,25)),$false),@('点灯',(Scene $bgA @(230,40,40)),$true),@('消灯・明るめx1.3',(Scene $bgA @(70,25,25) 1.3),$false),@('点灯・暗めx0.8',(Scene $bgA @(230,40,40) 0.8),$true),@('消灯・ノイズ大',(Scene $bgA @(70,25,25) 1.0 25),$false))) {
    $cc=Crop $case[1] $x0 $y0 $x1 $y1
    $r=[NgVision77]::RatioImage($cc.b,$cc.w,$cc.h,$cc.w*4,4,[int]$t[0],[int]$t[1],[int]$t[2],$t[4],[bool]$t[3])
    Check $case[0] $(if($appear){$r -ge $thr}else{$r -lt $thr}) $case[2] $r '%'
}

# ---------------- 正常な映像と比べる（新方式） ----------------
function Means($buf) { return ,[NgDiff77]::BlockMeansBuf($buf,$SW,$SH,$stride,4,$script:gw,$script:gh) }
$gw=0;$gh=0; [NgDiff77]::GridFor($SW,$SH,[ref]$gw,[ref]$gh); $script:gw=$gw; $script:gh=$gh
function Reference($frames) {
    $arr=New-Object 'float[][]' $frames.Count
    for($i=0;$i -lt $frames.Count;$i++){ $arr[$i]=Means $frames[$i] }
    return ,[NgDiff77]::BuildReference($arr)
}
# 記録した正常の見本（{平均, ノイズ} の組）を並べる：Refs $見本1 $見本2 ...
function Refs {
    $r=New-Object 'float[][]' ($args.Count*2)
    for($i=0;$i -lt $args.Count;$i++){ $r[2*$i]=$args[$i][0]; $r[2*$i+1]=$args[$i][1] }
    return ,$r
}
$T=5; $S=50   # 初期値：変化した割合 5% 以上でNG、感度 50
function Judge($label,$refs,$buf,$expected) {
    $s=[NgDiff77]::ScoreMulti($refs,(Means $buf),$S,$null)
    Check $label ($s -ge $T) $expected $s '%'
}

"=== 比べる：明るい場所、OKを1回記録しただけ（初期設定のまま） ==="
$refs=Refs (Reference @((1..10 | % { Scene $bgA @(70,25,25) })))
Judge '消灯（正常）' $refs (Scene $bgA @(70,25,25)) $false
Judge '点灯（異常）' $refs (Scene $bgA @(230,40,40)) $true
Judge '露出の変化 x0.85' $refs (Scene $bgA @(70,25,25) 0.85) $false
Judge '露出の変化 x1.2' $refs (Scene $bgA @(70,25,25) 1.2) $false
Judge '部品が無くなった' $refs (Scene $bgA $null) $true

"=== 比べる：暗い場所（背景 14、ざらつき大）、OKを1回記録しただけ ==="
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
$avg=[NgVision77]::AverageBuf((Scene $bgD @(24,11,11) 1.0 7),$SW,$SH,$stride,4,0,0,$SW,$SH)
$rOff=[NgVision77]::RatioImage((Scene $bgD @(24,11,11) 1.0 7),$SW,$SH,$stride,4,$avg[0],$avg[1],$avg[2],50,$false)
$rOn=[NgVision77]::RatioImage((Scene $bgD @(60,18,18) 1.0 7),$SW,$SH,$stride,4,$avg[0],$avg[1],$avg[2],50,$false)
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
$s=[NgDiff77]::ScoreMulti($refs1,(Means (Scene @(30,30,30) @(45,45,45) 1.0 8 $true)),$S,$null)
"参考：昼の正常だけ記録した場合、夜の正常は 変化 {0:N1}% → NG扱いになる（夜の正常も記録する必要がある）" -f $s

"=== 比べる：NGも記録すると、感度としきい値を自動で決める ==="
$okFrames=@((1..10 | % { Scene $bgD @(24,11,11) 1.0 7 }))
$okMeans=New-Object 'float[][]' 10; for($i=0;$i -lt 10;$i++){ $okMeans[$i]=Means $okFrames[$i] }
$refs=Refs ([NgDiff77]::BuildReference($okMeans))
$tune=[NgDiff77]::Tune($refs,$okMeans,(Means (Scene $bgD @(45,15,15) 1.0 7)))
$S=$tune[0]; $T=[Math]::Max(1,[Math]::Round(($tune[1]+$tune[2])/2))
"自動調整：感度 {0} / OK時 {1:N1}% / NG時 {2:N1}% → しきい値 {3}%" -f $tune[0],$tune[1],$tune[2],$T
Judge '暗・消灯（正常）' $refs (Scene $bgD @(24,11,11) 1.0 7) $false
Judge '暗・ごくわずかに点灯 R45（異常）' $refs (Scene $bgD @(45,15,15) 1.0 7) $true

"=== 保存用の圧縮・復元 ==="
$v=[float[]]@(0,1.5,12.25,255,4000); $u=[NgDiff77]::Unpack([NgDiff77]::Pack($v))
Check '圧縮して戻しても同じ値' ((($v | % {$_}) -join ',') -ne (($u | % {$_}) -join ',')) $false 0 ''

"--- 失敗：$script:failures 件 ---"
if($script:failures -gt 0) { exit 1 }
