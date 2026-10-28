# 起動した時の「前回の設定の読み込み」が動くかのテスト。
# 起動時は、ファイルの上から順に実行されるため、読み込みの時点でまだ定義されていない関数を
# 使うと失敗する（v79～v84 では Set-AreaGrids が後ろにあり、前回の設定が読み込まれていなかった）。
# ここでは、起動時の読み込みより前に定義されている関数だけを使って、同じ処理を再現する。
# 実行：powershell -ExecutionPolicy Bypass -File tests\test_startup.ps1   （PowerShell 7 でも可）
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
$call=$ast.Find({ $args[0] -is [System.Management.Automation.Language.AssignmentStatementAst] -and $args[0].Extent.Text -like '$script:loadedAtStartup*LoadLastUsedSettingsIfAny*' },$true)
if(-not $call) { 'FAIL startup call not found'; exit 1 }
$n=0
foreach($fd in $ast.FindAll({$args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    if($fd.Extent.StartOffset -lt $call.Extent.StartOffset) { . ([scriptblock]::Create($fd.Extent.Text)); $n++ }
}
"functions defined before the startup load: $n"
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('ngs_'+[guid]::NewGuid()); New-Item -ItemType Directory $tmp | Out-Null
$script:areas=New-Object System.Collections.ArrayList; $script:areaCounter=0; $script:monitorIntervalSec=0.2
$script:logPath=Join-Path $tmp 'log.csv'; $script:errorLogPath=Join-Path $tmp 'err.log'; $script:loggingEnabled=$true
$script:pendingLogRows=New-Object System.Collections.ArrayList; $script:maxMasks=20
$script:today=@{ Date=(Get-Date).Date; Count=0; TotalSec=0.0; Last=$null }
$script:settingsPath=Join-Path $tmp 'settings.json'
$json='{"IntervalSec":0.5,"Areas":[{"Id":"0123456789abcdef0123456789abcdef","Name":"1号機","X":10,"Y":20,"W":90,"H":60,"ColorR":1,"ColorG":2,"ColorB":3,"Mode":"diff","DiffSensitivity":60,"DiffThreshold":0.2,"DiffGridW":0,"DiffGridH":0,"DiffRefs":[],"Masks":[{"X":1,"Y":2,"W":10,"H":10}],"ScheduleOn":true,"ScheduleStart":"20:00","ScheduleEnd":"06:00","ScheduleDays":127,"NGDelaySec":30,"RepeatMin":5},{"Name":"エリア2","X":0,"Y":0,"W":40,"H":40,"Mode":"color","NGThreshold":30}]}'
Set-Content $script:settingsPath $json -Encoding UTF8
$fail=0
function T($name,$cond){ if($cond){"PASS $name"}else{"FAIL $name"; $script:fail++} }
$ok=LoadLastUsedSettingsIfAny
T 'previous settings load at startup' ($ok -eq $true)
T 'both areas restored' ($script:areas.Count -eq 2 -and $script:areas[0].Name -eq '1号機' -and $script:areas[1].Mode -eq 'color')
T 'grids, mask, schedule, id restored' ($script:areas[0].DiffFineW -gt 0 -and $script:areas[0].Masks.Count -eq 1 -and $script:areas[0].ScheduleOn -and $script:areas[0].NGDelaySec -eq 30 -and $script:areas[0].Id -eq '0123456789abcdef0123456789abcdef')
T 'interval restored' ($script:monitorIntervalSec -eq 0.5)
T 'no error logged' (-not (Test-Path $script:errorLogPath))
if(Test-Path $script:errorLogPath) { Get-Content $script:errorLogPath -Encoding UTF8 | Select-Object -First 5 }
Remove-Item $tmp -Recurse -Force
"--- failures: $fail ---"; if($fail){exit 1}
