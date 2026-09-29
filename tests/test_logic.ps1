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
$want='New-MonitorArea','Reset-AreaRuntime','Clear-AreaSamples','Clear-DiffReference','Update-DiffRefArray','Test-AreaReady','Get-JudgeThreshold','Get-JudgeDirection','Test-RatioIsNG','Update-AreaJudgement','Update-SampleRatios','Reset-AreaWithLog','Clear-AreaBuffers','Dispose-MonitorArea','Get-CurrentSettingsObject','Save-SettingsFile','Read-SettingsData','Load-SettingsFile','ClampInt','Apply-SettingsObject','Close-OpenNGEpisodes','Write-NGLogRow','Write-NGLogHeaderIfNeeded','Write-ErrorLog','Remember-LastSettingsPath','Mark-SettingsDirty','Save-SettingsIfDirty','Set-AreaRect','Get-SafeFileName'
foreach($fd in $ast.FindAll({$args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)) { if($want -contains $fd.Name){ . ([scriptblock]::Create($fd.Extent.Text)) } }
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('ngt_'+[guid]::NewGuid()); New-Item -ItemType Directory $tmp | Out-Null
$script:areas=New-Object System.Collections.ArrayList; $script:areaCounter=0; $script:monitorIntervalSec=0.2
$script:logPath=Join-Path $tmp 'log.csv'; $script:errorLogPath=Join-Path $tmp 'err.log'; $script:loggingEnabled=$true
$script:lastPathPointerFile=Join-Path $tmp 'last.txt'; $script:settingsPath=Join-Path $tmp 'settings.json'
function SetStatusPanel { }
$fail=0
function T($name,$cond){ if($cond){"PASS $name"}else{"FAIL $name"; $script:fail++} }

# --- area with two recorded normal references (compare mode) ---
$rect=New-Object System.Drawing.Rectangle(100,200,90,60)
$a=New-MonitorArea '1号機 "ランプ"' $rect ([System.Drawing.Color]::FromArgb(10,20,30))
Set-AreaRect $a $rect
$gw=$a.DiffGridW; $gh=$a.DiffGridH
$rnd=[Random]::new(3)
function Frame($base){ $m=New-Object 'float[]' ($gw*$gh*3); for($i=0;$i -lt $m.Length;$i++){ $m[$i]=$base+$rnd.Next(-3,4) }; return ,$m }
foreach($base in 40,120){ $fr=New-Object 'float[][]' 5; for($i=0;$i -lt 5;$i++){ $fr[$i]=Frame $base }; [void]$a.DiffRefs.Add([NgDiff77]::BuildReference($fr)) }
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
$script:areas.Clear()
T 'load settings' (Load-SettingsFile $script:settingsPath)
$a2=$script:areas[0]; $b2=$script:areas[1]
T 'two areas restored' ($script:areas.Count -eq 2)
T 'name with quotes restored' ($a2.Name -eq '1号機 "ランプ"')
T 'mode diff restored' ($a2.Mode -eq 'diff')
T 'two references restored' ($a2.DiffRefs.Count -eq 2)
$maxErr=0; for($i=0;$i -lt $origMeans.Length;$i++){ $maxErr=[Math]::Max($maxErr,[Math]::Abs($origMeans[$i]-$a2.DiffRefs[1][0][$i])) }
T "reference values preserved (max error $maxErr)" ($maxErr -le 0.05)
T 'diff sensitivity/threshold restored' ($a2.DiffSensitivity -eq 65 -and $a2.DiffThreshold -eq 7 -and $a2.ConfirmFrames -eq 3 -and $a2.BuzzerType -eq 4)
T 'colour area restored' ($b2.Mode -eq 'color' -and $b2.Direction -eq 'disappear' -and $b2.NGThreshold -eq 40)
T 'area is ready' (Test-AreaReady $a2)
Update-DiffRefArray $a2
$score=[NgDiff77]::ScoreMulti($a2.DiffRefArray,(Frame 120),50,$null)
T "normal frame scores ~0 against restored refs ($([math]::Round($score,1)))" ($score -lt 1)
$score=[NgDiff77]::ScoreMulti($a2.DiffRefArray,(Frame 200),50,$null)
T "very different frame scores high ($([math]::Round($score,1)))" ($score -gt 50)

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
Remove-Item $tmp -Recurse -Force
"--- failures: $fail ---"; if($fail){exit 1}
