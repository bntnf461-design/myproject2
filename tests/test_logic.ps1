# 設定の保存・読み込み、NG判定（連続回数・解除の余裕）、ログなど、画面以外の処理のテスト。
# NG_monitor.ps1 の中の関数をそのまま取り出して動かす。画面は不要。
# 実行：powershell -ExecutionPolicy Bypass -File tests\test_logic.ps1   （PowerShell 7 でも可）
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '..\NG_monitor.ps1'
$src=Get-Content $path -Raw -Encoding UTF8
$cs=[regex]::Match($src,"(?s)-TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if($PSVersionTable.PSEdition -eq 'Core') {
    Add-Type -ReferencedAssemblies System.Drawing,System.Drawing.Primitives,System.Drawing.Common,System.Runtime.InteropServices,System.Collections,System.Runtime -TypeDefinition $cs
} else {
    Add-Type -AssemblyName System.Drawing
    Add-Type -ReferencedAssemblies System.Drawing.dll -TypeDefinition $cs
}
$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$null,[ref]$null)
$want='New-MonitorArea','Reset-AreaRuntime','Clear-AreaSamples','Clear-DiffReference','Update-DiffRefArray','Test-AreaReady','Get-JudgeThreshold','Get-JudgeDirection','Test-RatioIsNG','Update-AreaJudgement','Update-SampleRatios','Reset-AreaWithLog','Clear-AreaBuffers','Dispose-MonitorArea','Get-CurrentSettingsObject','Save-SettingsFile','Read-SettingsData','Load-SettingsFile','ClampInt','Apply-SettingsObject','Close-OpenNGEpisodes','Write-NGLogRow','Write-NGLogHeaderIfNeeded','Write-ErrorLog','Remember-LastSettingsPath','Mark-SettingsDirty','Save-SettingsIfDirty','Set-AreaRect','Get-SafeFileName','Flush-NGLog','Save-PendingLogOnExit','New-AreaName','Set-AreaGrids','ClampDouble','Format-Percent','ConvertTo-PackedRef','ConvertFrom-PackedRef','Clear-MatchReference','ConvertTo-RefArray','Update-MatchArrays','Update-AreaMasks','Get-AdaptRate','Reset-TodayIfNeeded','Add-TodayEvent','Read-TodayStatsFromLog','Format-Duration','Get-TodaySummaryText'
foreach($fd in $ast.FindAll({$args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)) { if($want -contains $fd.Name){ . ([scriptblock]::Create($fd.Extent.Text)) } }
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('ngt_'+[guid]::NewGuid()); New-Item -ItemType Directory $tmp | Out-Null
$script:areas=New-Object System.Collections.ArrayList; $script:areaCounter=0; $script:monitorIntervalSec=0.2
$script:logPath=Join-Path $tmp 'log.csv'; $script:errorLogPath=Join-Path $tmp 'err.log'; $script:loggingEnabled=$true
$script:pendingLogRows=New-Object System.Collections.ArrayList; $script:logWriteBlocked=$false
$script:lastPathPointerFile=Join-Path $tmp 'last.txt'; $script:settingsPath=Join-Path $tmp 'settings.json'
$script:maxMasks=20; $script:running=$false; $script:today=@{ Date=(Get-Date).Date; Count=0; TotalSec=0.0; Last=$null }
function SetStatusPanel { }
$fail=0
function T($name,$cond){ if($cond){"PASS $name"}else{"FAIL $name"; $script:fail++} }

# --- area with two recorded normal references (compare mode) ---
$rect=New-Object System.Drawing.Rectangle(100,200,90,60)
$a=New-MonitorArea '1号機 "ランプ"' $rect ([System.Drawing.Color]::FromArgb(10,20,30))
Set-AreaRect $a $rect
$gw=$a.DiffGridW; $gh=$a.DiffGridH
$rnd=[Random]::new(3)
# 一様な明るさ $base の疑似画像（90x60）から {細かい, 粗い} のマス目平均を作る
function Frame($base){ $buf=New-Object 'byte[]' (90*60*4); for($i=0;$i -lt $buf.Length;$i++){ $buf[$i]=[byte][Math]::Max(0,[Math]::Min(255,$base+$rnd.Next(-3,4))) }; return ,[NgDiff79]::SampleBuf($buf,90,60,360,4,0,0,90,60) }
foreach($base in 40,120){ $fr=New-Object 'float[][][]' 5; for($i=0;$i -lt 5;$i++){ $fr[$i]=Frame $base }; [void]$a.DiffRefs.Add([NgDiff79]::BuildReference($fr,90,60)) }
$a.DiffSensitivity=65; $a.DiffThreshold=7; $a.ConfirmFrames=3; $a.BuzzerType=4
[void]$script:areas.Add($a)
$b=New-MonitorArea 'エリア2' (New-Object System.Drawing.Rectangle(0,0,40,40)) ([System.Drawing.Color]::FromArgb(200,30,30))
$b.Mode='color'; $b.Direction='disappear'; $b.NGThreshold=40; Set-AreaRect $b $b.Rect
[void]$script:areas.Add($b)
T 'grid computed' ($gw -gt 0 -and $gh -gt 0)
T 'save settings' (Save-SettingsFile $script:settingsPath)
$json=Get-Content $script:settingsPath -Raw
T 'no temp file left' (-not (Test-Path ($script:settingsPath+'.tmp')))

# --- reload ---
$origMeans=$a.DiffRefs[1][0]
T 'new references have the fine grid' ($a.DiffRefs[0].Length -eq 4 -and $a.DiffRefs[0][0].Length -eq $a.DiffFineW*$a.DiffFineH*3 -and $a.DiffFineW*$a.DiffFineH -gt 1000)
$script:areas.Clear()
T 'load settings' (Load-SettingsFile $script:settingsPath)
$a2=$script:areas[0]; $b2=$script:areas[1]
T 'two areas restored' ($script:areas.Count -eq 2)
T 'name with quotes restored' ($a2.Name -eq '1号機 "ランプ"')
T 'mode diff restored' ($a2.Mode -eq 'diff')
T 'two references restored' ($a2.DiffRefs.Count -eq 2)
$maxErr=0; for($i=0;$i -lt $origMeans.Length;$i++){ $maxErr=[Math]::Max($maxErr,[Math]::Abs($origMeans[$i]-$a2.DiffRefs[1][0][$i])) }
T "reference values preserved incl. fine grid (max error $maxErr)" ($maxErr -le 0.05 -and $origMeans.Length -gt 0)
T 'diff sensitivity/threshold restored' ($a2.DiffSensitivity -eq 65 -and $a2.DiffThreshold -eq 7 -and $a2.ConfirmFrames -eq 3 -and $a2.BuzzerType -eq 4)
T 'colour area restored' ($b2.Mode -eq 'color' -and $b2.Direction -eq 'disappear' -and $b2.NGThreshold -eq 40)
T 'area is ready' (Test-AreaReady $a2)
Update-DiffRefArray $a2
$fr=Frame 120; $score=[NgDiff79]::ScoreSample($a2.DiffRefArray,$fr[0],$fr[1],90,60,50,$null)
T "normal frame scores ~0 against restored refs ($([math]::Round($score,1)))" ($score -lt 1)
$fr=Frame 200; $score=[NgDiff79]::ScoreSample($a2.DiffRefArray,$fr[0],$fr[1],90,60,50,$null)
T "very different frame scores high ($([math]::Round($score,1)))" ($score -gt 50)

# --- v78 で保存した設定（細かいマス目なしの見本、しきい値3）もそのまま使える ---
$v78=$json | ConvertFrom-Json
foreach($rd in $v78.Areas[0].DiffRefs){ $rd.PSObject.Properties.Remove('FineMeans'); $rd.PSObject.Properties.Remove('FineNoise') }
$v78.Areas[0].DiffThreshold=3
Apply-SettingsObject $v78
$l=$script:areas[0]; Update-DiffRefArray $l
$fr=Frame 120; $s1=[NgDiff79]::ScoreSample($l.DiffRefArray,$fr[0],$fr[1],90,60,50,$null)
$fr=Frame 200; $s2=[NgDiff79]::ScoreSample($l.DiffRefArray,$fr[0],$fr[1],90,60,50,$null)
T "v78 references still judge correctly (normal $([math]::Round($s1,1))%, changed $([math]::Round($s2,1))%)" ($l.DiffRefs.Count -eq 2 -and $l.DiffRefs[0][0].Length -eq 0 -and $l.DiffThreshold -eq 3 -and $s1 -lt 1 -and $s2 -gt 50)

# --- 「異常の画面が出たらNG」の見本も保存・読み込みできる ---
$script:areas.Clear()
$m=New-MonitorArea '警報画面' $rect ([System.Drawing.Color]::Black); Set-AreaRect $m $rect; $m.Mode='match'; $m.MatchThreshold=88; $m.MatchSensitivity=40
$fr=New-Object 'float[][][]' 1; $fr[0]=Frame 200; [void]$m.MatchNgRefs.Add([NgDiff79]::BuildReference($fr,90,60))
$fr=New-Object 'float[][][]' 3; for($i=0;$i -lt 3;$i++){ $fr[$i]=Frame 40 }; [void]$m.MatchOkRefs.Add([NgDiff79]::BuildReference($fr,90,60))
[void]$script:areas.Add($m)
T 'save match settings' (Save-SettingsFile $script:settingsPath)
$script:areas.Clear()
T 'load match settings' (Load-SettingsFile $script:settingsPath)
$m2=$script:areas[0]
T 'mode / threshold / sensitivity restored' ($m2.Mode -eq 'match' -and $m2.MatchThreshold -eq 88 -and $m2.MatchSensitivity -eq 40)
T 'abnormal and normal screen samples restored' ($m2.MatchNgRefs.Count -eq 1 -and $m2.MatchOkRefs.Count -eq 1 -and (Test-AreaReady $m2))
Update-MatchArrays $m2
$fr=Frame 200; $hit=[NgDiff79]::MatchSample($m2.MatchNgArray,$m2.MatchOkArray,$fr[0],40)
$fr=Frame 40;  $miss=[NgDiff79]::MatchSample($m2.MatchNgArray,$m2.MatchOkArray,$fr[0],40)
T "restored samples still judge correctly (abnormal $([math]::Round($hit))%, normal $([math]::Round($miss))%)" ($hit -ge 90 -and $miss -lt 50)
T 'NG when the score reaches the threshold' ((Test-RatioIsNG $m2 88) -and -not (Test-RatioIsNG $m2 87.9))
$m3=New-MonitorArea 'y' $rect ([System.Drawing.Color]::Black); $m3.Mode='match'
T 'match area without samples is not ready' (-not (Test-AreaReady $m3))

# --- v81：除外する場所・明るさの自動追従の設定も保存・読み込みできる ---
$script:areas.Clear()
$x=New-MonitorArea 'アーム' $rect ([System.Drawing.Color]::Black); Set-AreaRect $x $rect
foreach($base in 40,120){ $fr=New-Object 'float[][][]' 5; for($i=0;$i -lt 5;$i++){ $fr[$i]=Frame $base }; [void]$x.DiffRefs.Add([NgDiff79]::BuildReference($fr,90,60)) }
[void]$x.Masks.Add((New-Object System.Drawing.Rectangle(5,6,20,30))); [void]$x.Masks.Add((New-Object System.Drawing.Rectangle(80,50,40,40)))
$x.AdaptDrift=$false
[void]$script:areas.Add($x)
T 'save masks' (Save-SettingsFile $script:settingsPath)
$script:areas.Clear()
T 'load masks' (Load-SettingsFile $script:settingsPath)
$x2=$script:areas[0]
T "masks restored and clipped to the area ($($x2.Masks.Count): $($x2.Masks[1]))" ($x2.Masks.Count -eq 2 -and $x2.Masks[0].Width -eq 20 -and $x2.Masks[1].Width -eq 10 -and $x2.Masks[1].Height -eq 10)
T 'adapt option restored' ($x2.AdaptDrift -eq $false)
Update-AreaMasks $x2
T 'mask cells computed' ($x2.MaskReady -and $null -ne $x2.FineMask -and $x2.FineMask.Length -eq $x2.DiffFineW*$x2.DiffFineH)
T 'old files without masks: adapt on, no masks' ((New-MonitorArea 'n' $rect ([System.Drawing.Color]::Black)).AdaptDrift -and $script:areas[0].Masks.Count -eq 2)
Set-AreaRect $x2 (New-Object System.Drawing.Rectangle(0,0,50,50))
T 'masks cleared when the area is picked again' ($x2.Masks.Count -eq 0 -and -not $x2.MaskReady)
# 監視中の自動追従は複製に対して行い、記録した見本（保存する方）は変えない
$y=New-MonitorArea 'y' $rect ([System.Drawing.Color]::Black); Set-AreaRect $y $rect
$fr=New-Object 'float[][][]' 5; for($i=0;$i -lt 5;$i++){ $fr[$i]=Frame 100 }; [void]$y.DiffRefs.Add([NgDiff79]::BuildReference($fr,90,60))
Update-DiffRefArray $y
$y.DiffRefArray[0][0]=999
T 'working copy is separate from the recorded reference' ($y.DiffRefs[0][0][0] -ne 999)
T 'no adaptation while stopped' ((Get-AdaptRate $y) -eq 0)
$script:running=$true; $script:monitorIntervalSec=0.2
T 'slow adaptation while monitoring' ([Math]::Abs((Get-AdaptRate $y)-0.002) -lt 1e-9)
$y.AdaptDrift=$false
T 'no adaptation when switched off' ((Get-AdaptRate $y) -eq 0)
$script:running=$false

# --- v81：今日のNGの集計（ログから読み直す） ---
$script:areas.Clear()
$d=Get-Date -Format 'yyyy-MM-dd'
$todayLog=Join-Path $tmp 'today.csv'
Set-Content $todayLog -Encoding UTF8 -Value @('"日時","エリア","種別","一致率(%)","継続時間(秒)"',
  ('"2000-01-01 10:00:00","old","NG発生","5",""'),
  ('"'+$d+' 08:00:00","A ""1""","NG発生","5",""'),
  ('"'+$d+' 08:01:30","A ""1""","NG解除","0.1","90"'),
  ('"'+$d+' 09:15:00","B","NG発生","5",""'),
  ('"'+$d+' 09:15:20","B","確認","5","20"'),
  ('"'+$d+' 09:16:00","B","NG解除（監視停止）","","60"'))
$keepLog=$script:logPath; $script:logPath=$todayLog
Read-TodayStatsFromLog
$script:logPath=$keepLog
T "today's NG count and time read from the log ($($script:today.Count) / $($script:today.TotalSec))" ($script:today.Count -eq 2 -and $script:today.TotalSec -eq 150 -and ([datetime]$script:today.Last).ToString('HH:mm') -eq '09:15')
$txt=Get-TodaySummaryText
T "summary text ($txt)" ($txt -like '*2回*' -and $txt -like '*2分30秒*' -and $txt -like '*09:15*')
T 'duration format' ((Format-Duration 5) -eq '5秒' -and (Format-Duration 3725) -eq '1時間2分')
# 判定がNGになったら今日の回数が増え、確認済みは新しいNGで消える
$j0=New-MonitorArea 'J0' $rect ([System.Drawing.Color]::Black); $j0.DiffThreshold=1; $j0.ConfirmFrames=1; $j0.Acked=$true
$c0=$script:today.Count
[void](Update-AreaJudgement $j0 5 (Get-Date) 't')
T 'new NG counted and not yet acknowledged' ($script:today.Count -eq $c0+1 -and $j0.WasNG -and -not $j0.Acked)

# --- references from a different-sized area are dropped, not misused ---
$raw=$json | ConvertFrom-Json; $raw.Areas[0].W=300
Apply-SettingsObject $raw
T 'refs dropped when size changed' ($script:areas[0].DiffRefs.Count -eq 0 -and -not (Test-AreaReady $script:areas[0]))

# --- v75 settings file keeps working (colour mode) ---
$v75='{"IntervalSec":0.3,"Areas":[{"Name":"エリア1","X":10,"Y":20,"W":50,"H":40,"ColorR":220,"ColorG":30,"ColorB":30,"Sensitivity":60,"NGThreshold":25,"HueMatchMode":true,"Direction":"appear","BuzzerSeconds":3,"BuzzerType":2,"BuzzerVolume":70}]}'
Set-Content (Join-Path $tmp 'v75.json') $v75 -Encoding UTF8
T 'load v75 file' (Load-SettingsFile (Join-Path $tmp 'v75.json'))
$c=$script:areas[0]
T 'v75 area becomes colour mode with its values' ($c.Mode -eq 'color' -and $c.NGThreshold -eq 25 -and $c.HueMatchMode -and $c.ConfirmFrames -eq 2 -and $script:monitorIntervalSec -eq 0.3)

# --- broken file does not wipe current areas ---
Set-Content (Join-Path $tmp 'bad.json') '{"Areas":[{"Name":"x","X":"abc"' -Encoding UTF8
T 'broken file rejected' (-not (Load-SettingsFile (Join-Path $tmp 'bad.json')))
T 'current areas kept' ($script:areas.Count -eq 1 -and $script:areas[0].Name -eq 'エリア1')

# --- judgement: confirm count + hysteresis (compare mode, threshold 7, 3 frames) ---
$j=New-MonitorArea 'J' $rect ([System.Drawing.Color]::Black); $j.DiffThreshold=7; $j.ConfirmFrames=3
$now=Get-Date; $txt='t'
$seq=@(8,9,2,8,8,8,6,6,6,5.0,4,4,4)
$out=foreach($r in $seq){ [void](Update-AreaJudgement $j $r $now $txt); if($j.WasNG){'N'}else{'.'} }
$states=-join $out
T "compare mode: blip ignored, NG after 3, held at 5-6 (hysteresis), cleared after 3 below: $states" ($states -eq '.....NNNNNN..')
"      sequence: $($seq -join ',')"
# --- colour mode 'disappear' uses the colour threshold ---
$k=New-MonitorArea 'K' $rect ([System.Drawing.Color]::Black); $k.Mode='color'; $k.Direction='disappear'; $k.NGThreshold=40
T 'colour/disappear: 30 is NG, 50 is OK' ((Test-RatioIsNG $k 30) -and -not (Test-RatioIsNG $k 50))
T 'compare: threshold/direction' ((Get-JudgeThreshold $j) -eq 7 -and (Get-JudgeDirection $j) -eq 'appear')
T 'no NG before refs recorded (null ratio)' (-not (Update-AreaJudgement $j $null $now $txt))
T 'file name sanitised' ((Get-SafeFileName 'a/b') -eq 'a_b')
$log=Get-Content $script:logPath -Encoding UTF8
T "log rows written ($($log.Count) lines)" ($log.Count -ge 3 -and $log[0] -like '"日時"*')

# --- ログのCSVがExcelで開かれていても、記録を失わない ---
$before=@(Get-Content $script:logPath -Encoding UTF8).Count
$lock=[System.IO.File]::Open($script:logPath,'Open','ReadWrite','None')
Write-NGLogRow 't1' 'L' 'NG発生' 12.5 $null
Write-NGLogRow 't2' 'L' 'NG解除' 1.0 3.2
T 'rows kept in memory while file is locked' ($script:logWriteBlocked -and $script:pendingLogRows.Count -eq 2)
$lock.Close()
T 'rows written after file is released' ((Flush-NGLog) -and $script:pendingLogRows.Count -eq 0 -and @(Get-Content $script:logPath -Encoding UTF8).Count -eq $before+2)

# --- 設定の保存に失敗した時は「失敗」と分かる ---
T 'save to a missing folder reports failure' (-not (Save-SettingsFile (Join-Path $tmp 'no_such_dir/x.json')))

# --- 新しいエリア名が重ならない ---
$script:areas.Clear()
foreach($n in 'エリア1','エリア3'){ [void]$script:areas.Add((New-MonitorArea $n $rect ([System.Drawing.Color]::Black))) }
$script:areaCounter=2
$n1=New-AreaName
T "new area name does not duplicate (got $n1)" ($n1 -eq 'エリア4')
Remove-Item $tmp -Recurse -Force
"--- failures: $fail ---"; if($fail){exit 1}
