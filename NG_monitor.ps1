# NG MONITOR - v75 「NG検知の割合」を「一致率のしきい値」に名称変更
# Windows PowerShell 5.1 / Windows 10・11 用
try {
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -AssemblyName System.Drawing -ErrorAction Stop
# 画面部品を1つも作る前に、必ずここで呼ぶ必要がある（後から呼ぶとエラーになる）
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop

# Prevent Windows DPI scaling from changing mouse coordinates in the area selector.
if (-not ([System.Management.Automation.PSTypeName]'DpiHelper').Type) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DpiHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
}
[DpiHelper]::SetProcessDPIAware() | Out-Null

# Use Windows winmm.dll directly; this works even when System.Media is unavailable.
if (-not ([System.Management.Automation.PSTypeName]'WinMM').Type) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinMM {
    [DllImport("winmm.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool PlaySound(string pszSound, IntPtr hmod, uint fdwSound);
}
"@
}
$script:buzzerUntil = $null

# 音を作るための小さなプログラム（種類・音量を反映したWAVファイルをその場で作る）
if (-not ([System.Management.Automation.PSTypeName]'BuzzGen').Type) {
Add-Type @"
using System;
using System.IO;
public static class BuzzGen {
    public static byte[] Build(int type, double volume, int sampleRate) {
        double duration = 0.9;
        int totalSamples = (int)(sampleRate * duration);
        short[] samples = new short[totalSamples];
        double v0 = Math.Max(0.0, Math.Min(1.0, volume));
        double amp = v0 * short.MaxValue * 0.9;
        for (int i = 0; i < totalSamples; i++) {
            double t = (double)i / sampleRate;
            double v = 0;
            switch (type) {
                case 0: // 電子音（ピッ、ピッ）
                    double cyclePos = t % 0.3;
                    v = (cyclePos < 0.15) ? Math.Sign(Math.Sin(2*Math.PI*1500*t)) : 0;
                    break;
                case 1: // 低音（ブー）
                    v = Math.Sign(Math.Sin(2*Math.PI*220*t));
                    break;
                case 2: // サイレン（ピーポー）
                    double freq = 900 + 350*Math.Sin(2*Math.PI*t/0.9);
                    v = Math.Sin(2*Math.PI*freq*t);
                    break;
                case 3: // 高音アラーム（キーン）
                    v = Math.Sin(2*Math.PI*2200*t);
                    break;
                case 4: // 警告音（ピポピポ）
                    double cyc4 = t % 0.4;
                    double freq4 = (cyc4 < 0.2) ? 1400.0 : 1000.0;
                    v = Math.Sign(Math.Sin(2*Math.PI*freq4*t));
                    break;
                case 5: // 断続ブザー（プッ、プッ）
                    double cyc5 = t % 0.6;
                    v = (cyc5 < 0.35) ? Math.Sign(Math.Sin(2*Math.PI*400*t)) : 0;
                    break;
                case 6: // ソフトチャイム（ポーン）
                    double chimeFreq = (t < 0.45) ? 880.0 : 659.0;
                    double env = Math.Min(1.0, t*20.0) * Math.Min(1.0, (duration-t)*8.0);
                    if (env < 0) env = 0;
                    v = Math.Sin(2*Math.PI*chimeFreq*t) * env;
                    break;
                case 7: // 救急車サイレン（速め）
                    double freq7 = 700 + 350*Math.Sin(2*Math.PI*t/0.35);
                    v = Math.Sin(2*Math.PI*freq7*t);
                    break;
                default:
                    v = Math.Sign(Math.Sin(2*Math.PI*1500*t));
                    break;
            }
            samples[i] = (short)(v * amp);
        }
        using (var ms = new MemoryStream())
        using (var bw = new BinaryWriter(ms)) {
            int byteRate = sampleRate * 2;
            int dataSize = samples.Length * 2;
            bw.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
            bw.Write(36 + dataSize);
            bw.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));
            bw.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
            bw.Write(16);
            bw.Write((short)1);
            bw.Write((short)1);
            bw.Write(sampleRate);
            bw.Write(byteRate);
            bw.Write((short)2);
            bw.Write((short)16);
            bw.Write(System.Text.Encoding.ASCII.GetBytes("data"));
            bw.Write(dataSize);
            for (int i = 0; i < samples.Length; i++) { bw.Write(samples[i]); }
            return ms.ToArray();
        }
    }
}
"@
}

$script:area = $null
$script:running = $false
$script:alarm = $false
$script:buzzerSeconds = 2
$script:buzzerTimer = $null
$script:buzzerProcess = $null
$script:buzzerType = 0
$script:buzzerVolume = 80
$script:sound = Join-Path $PSScriptRoot 'BUZZER.wav'
$script:tempSoundPath = Join-Path $env:TEMP 'ngmonitor_buzzer_tmp.wav'
$buzzerTypeNames = @('電子音（ピッ、ピッ）','低音（ブー）','サイレン（ピーポー）','高音アラーム（キーン）','警告音（ピポピポ）','断続ブザー（プッ、プッ）','ソフトチャイム（ポーン）','救急車サイレン（速め）')

function RegenerateSound($type,$volume) {
    if($null -eq $type) { $type=$script:buzzerType }
    if($null -eq $volume) { $volume=$script:buzzerVolume }
    try {
        $bytes=[BuzzGen]::Build([int]$type,([double]$volume/100.0),44100)
        [IO.File]::WriteAllBytes($script:tempSoundPath,$bytes)
        $script:sound=$script:tempSoundPath
    } catch {
        $script:sound=Join-Path $PSScriptRoot 'BUZZER.wav'
    }
}

# ---- 検出する色（エリアを選ぶと自動でこの色になる） ----
$script:targetColor = [System.Drawing.Color]::FromArgb(220,30,30)
$script:colorSet = $false
$script:sensitivity = 50   # 0-100（大きいほど似た色まで検知する）
$script:ngThreshold = 15   # 1-100（選択範囲のうち何%が検出色ならNGにするか）
$script:hueMatchMode = $false   # $true: 明るさに左右されにくい色味（Hue）ベースの判定を使う
$script:areas = New-Object System.Collections.ArrayList   # 複数エリア監視用（各要素：Name/Rect/Color/WasNG/MonBmp/MonGfx/MonBmpSize）
$script:areaCounter = 0   # 「エリアN」の自動採番用
$script:monitorIntervalSec = 0.2   # 画面をチェックする間隔（秒）
$script:exiting = $false
$script:trayBalloonShown = $false
$script:logPath = Join-Path $PSScriptRoot 'ng_monitor_log.csv'
$script:loggingEnabled = $true

function Write-NGLogHeaderIfNeeded {
    if(-not (Test-Path -LiteralPath $script:logPath)) {
        try {
            Set-Content -LiteralPath $script:logPath -Value '"日時","エリア","種別","一致率(%)","継続時間(秒)"' -Encoding UTF8
        } catch {}
    }
}

function Write-NGLogRow($timestamp,$areaName,$eventType,$ratio,$durationSec) {
    if(-not $script:loggingEnabled) { return }
    try {
        Write-NGLogHeaderIfNeeded
        $ratioText=$(if($null -ne $ratio){$ratio.ToString([System.Globalization.CultureInfo]::InvariantCulture)}else{''})
        $durationText=$(if($null -ne $durationSec){([math]::Round($durationSec,1)).ToString([System.Globalization.CultureInfo]::InvariantCulture)}else{''})
        $areaNameSafe=$areaName -replace '"','""'
        $row=('"'+$timestamp+'","'+$areaNameSafe+'","'+$eventType+'","'+$ratioText+'","'+$durationText+'"')
        Add-Content -LiteralPath $script:logPath -Value $row -Encoding UTF8
    } catch {}
}

function Close-OpenNGEpisodes {
    # 監視停止時に、記録中のNGが「発生」のまま残らないよう解除ログを残す
    $nowTime=Get-Date
    $nowText=$nowTime.ToString('yyyy-MM-dd HH:mm:ss')
    foreach($a in $script:areas) {
        if($a.WasNG) {
            $durationSec=$(if($a.NGSince){($nowTime-$a.NGSince).TotalSeconds}else{$null})
            Write-NGLogRow $nowText $a.Name 'NG解除（監視停止）' $null $durationSec
            $a.WasNG=$false
            $a.NGSince=$null
        }
    }
}

# ---- 色の定義（状態がひと目でわかるように） ----
$colorIdle      = [System.Drawing.Color]::FromArgb(235,235,235)   # 灰色：まだ何もしていない
$colorReady     = [System.Drawing.Color]::FromArgb(255,244,204)   # 黄色：準備できた
$colorRunning   = [System.Drawing.Color]::FromArgb(214,245,214)   # 緑色：正常に監視中
$colorAlarm     = [System.Drawing.Color]::FromArgb(255,76,76)     # 赤色：異常検知！
$colorGreenBtn  = [System.Drawing.Color]::FromArgb(46,160,67)
$colorRedBtn    = [System.Drawing.Color]::FromArgb(200,45,45)
$colorBlueBtn   = [System.Drawing.Color]::FromArgb(0,112,192)
$colorYellowBtn = [System.Drawing.Color]::FromArgb(255,193,7)

# ---- ダーク系の背景テーマ ----
$formBgDark    = [System.Drawing.Color]::FromArgb(13,20,32)
$cardBgDark    = [System.Drawing.Color]::FromArgb(22,34,50)
$headerBgDark  = [System.Drawing.Color]::FromArgb(16,24,38)
$accentBlue    = [System.Drawing.Color]::FromArgb(88,166,255)
$textPrimary   = [System.Drawing.Color]::FromArgb(226,232,240)
$textSecondary = [System.Drawing.Color]::FromArgb(148,163,184)
$inputBgDark   = [System.Drawing.Color]::FromArgb(32,46,64)

function BuzzStop {
    # Stop the dedicated buzzer worker process. This is deliberately used
    # instead of SoundPlayer/System.Media because some factory PCs do not
    # have System.Media available, and it prevents looping audio from being
    # left behind by repeated detections.
    try {
        if($script:buzzerProcess) {
            Stop-Process -Id ([int]$script:buzzerProcess) -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    $script:buzzerProcess=$null
    $script:buzzerUntil=$null
}

function BuzzStart($seconds) {
    if($null -eq $seconds) { $seconds=$script:buzzerSeconds }
    BuzzStop
    if (-not (Test-Path -LiteralPath $script:sound)) { return $false }
    try {
        $worker=Join-Path $PSScriptRoot 'BuzzerWorker.ps1'
        $sec=[int]$seconds
        $args=@('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+$worker+'"'),'-Seconds',$sec,'-SoundPath',('"'+$script:sound+'"'))
        $psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        if (-not (Test-Path -LiteralPath $psExe)) { $psExe='powershell.exe' }
        $proc=Start-Process -FilePath $psExe -ArgumentList $args -WindowStyle Hidden -PassThru
        $script:buzzerProcess=$proc.Id
        $script:buzzerUntil=(Get-Date).AddSeconds($sec)
        $script:buzzerSeconds=$sec
        return $true
    } catch {
        $script:buzzerProcess=$null
        $script:buzzerUntil=$null
        return $false
    }
}

function PickArea {
    $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $f.Hide()

    $overlay = New-Object System.Windows.Forms.Form
    $overlay.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $overlay.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $overlay.Location = New-Object System.Drawing.Point($screen.X,$screen.Y)
    $overlay.Size = New-Object System.Drawing.Size($screen.Width,$screen.Height)
    $overlay.TopMost = $true
    $overlay.BackColor = [System.Drawing.Color]::Black
    $overlay.Opacity = 0.15
    $overlay.Cursor = [System.Windows.Forms.Cursors]::Cross
    $overlay.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
    $overlay.KeyPreview = $true

    $msg = New-Object System.Windows.Forms.Label
    $msg.Text = 'マウスをドラッグして「検出したい色の部分（例：赤いランプ）」を四角く囲んでください　　（キャンセルは ESC キー）'
    $msg.AutoSize = $true
    $msg.BackColor = [System.Drawing.Color]::White
    $msg.ForeColor = [System.Drawing.Color]::Black
    $msg.Font = New-Object System.Drawing.Font('Meiryo UI',14,[System.Drawing.FontStyle]::Bold)
    $msg.Location = New-Object System.Drawing.Point(15,15)
    $overlay.Controls.Add($msg)

    $script:dragging = $false
    $script:p0 = $null
    $script:selection = New-Object System.Drawing.Rectangle

    $overlay.Add_MouseDown({
        if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            $script:p0 = $_.Location
            $script:dragging = $true
            $script:selection = New-Object System.Drawing.Rectangle($script:p0.X,$script:p0.Y,0,0)
            $overlay.Invalidate()
        }
    })
    $overlay.Add_MouseMove({
        if ($script:dragging) {
            $x=[Math]::Min($script:p0.X,$_.X)
            $y=[Math]::Min($script:p0.Y,$_.Y)
            $w=[Math]::Abs($_.X-$script:p0.X)
            $h=[Math]::Abs($_.Y-$script:p0.Y)
            $script:selection=New-Object System.Drawing.Rectangle($x,$y,$w,$h)
            $overlay.Invalidate()
        }
    })
    $overlay.Add_MouseUp({
        if ($script:dragging -and $_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            $script:dragging=$false
            if ($script:selection.Width -ge 20 -and $script:selection.Height -ge 20) {
                $script:area=New-Object System.Drawing.Rectangle(
                    ($script:selection.X+$screen.X),
                    ($script:selection.Y+$screen.Y),
                    $script:selection.Width,
                    $script:selection.Height)
                $overlay.Close()
            }
        }
    })
    $overlay.Add_Paint({
        if ($script:selection.Width -gt 0 -and $script:selection.Height -gt 0) {
            $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::Lime,4)
            $_.Graphics.DrawRectangle($pen,$script:selection)
            $pen.Dispose()
        }
    })
    $overlay.Add_KeyDown({ if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $overlay.Close() } })

    [void]$overlay.ShowDialog()
    $f.Show()
}

# 画面の色を高速に読み取るための小さなプログラム（GetPixelより大幅に高速）
if (-not ([System.Management.Automation.PSTypeName]'PixelScanner').Type) {
Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class PixelScanner {
    public static int[] AverageColor(Bitmap bmp, int step) {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, bmp.PixelFormat);
        try {
            int bpp = Math.Max(1, Image.GetPixelFormatSize(data.PixelFormat) / 8);
            int stride = data.Stride;
            int bytes = stride * bmp.Height;
            byte[] buf = new byte[bytes];
            Marshal.Copy(data.Scan0, buf, 0, bytes);
            long sumR=0, sumG=0, sumB=0, n=0;
            for (int y = 0; y < bmp.Height; y += step) {
                int row = y * stride;
                for (int x = 0; x < bmp.Width; x += step) {
                    int idx = row + x * bpp;
                    if (idx + 2 >= bytes) continue;
                    sumB += buf[idx]; sumG += buf[idx+1]; sumR += buf[idx+2];
                    n++;
                }
            }
            if (n == 0) return new int[] { 0, 0, 0 };
            return new int[] { (int)(sumR/n), (int)(sumG/n), (int)(sumB/n) };
        } finally {
            bmp.UnlockBits(data);
        }
    }
    public static double MatchRatio(Bitmap bmp, int step, int targetR, int targetG, int targetB, double threshold) {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, bmp.PixelFormat);
        try {
            int bpp = Math.Max(1, Image.GetPixelFormatSize(data.PixelFormat) / 8);
            int stride = data.Stride;
            int bytes = stride * bmp.Height;
            byte[] buf = new byte[bytes];
            Marshal.Copy(data.Scan0, buf, 0, bytes);
            long hit=0, total=0;
            for (int y = 0; y < bmp.Height; y += step) {
                int row = y * stride;
                for (int x = 0; x < bmp.Width; x += step) {
                    int idx = row + x * bpp;
                    if (idx + 2 >= bytes) continue;
                    double db = buf[idx]   - targetB;
                    double dg = buf[idx+1] - targetG;
                    double dr = buf[idx+2] - targetR;
                    double dist = Math.Sqrt(dr*dr + dg*dg + db*db);
                    if (dist <= threshold) hit++;
                    total++;
                }
            }
            if (total == 0) return 0;
            return 100.0 * hit / total;
        } finally {
            bmp.UnlockBits(data);
        }
    }
    // Sensitivity threshold with a smooth transition, avoiding large jumps
    // when sensitivity changes by only 1 point.
    public static double SoftMatchRatio(Bitmap bmp, int step, int targetR, int targetG, int targetB, double threshold, double softness) {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, bmp.PixelFormat);
        try {
            int bpp = Math.Max(1, Image.GetPixelFormatSize(data.PixelFormat) / 8);
            int stride = data.Stride;
            int bytes = stride * bmp.Height;
            byte[] buf = new byte[bytes];
            Marshal.Copy(data.Scan0, buf, 0, bytes);
            double sum=0; long total=0;
            double k = Math.Max(1.0, softness);
            for (int y=0; y<bmp.Height; y+=step) {
                int row=y*stride;
                for (int x=0; x<bmp.Width; x+=step) {
                    int idx=row+x*bpp;
                    if(idx+2>=bytes) continue;
                    double db=buf[idx]-targetB, dg=buf[idx+1]-targetG, dr=buf[idx+2]-targetR;
                    double dist=Math.Sqrt(dr*dr+dg*dg+db*db);
                    double score=100.0/(1.0+Math.Exp((dist-threshold)/k));
                    sum+=score; total++;
                }
            }
            if(total==0) return 0;
            return sum/total;
        } finally {
            bmp.UnlockBits(data);
        }
    }
    // Sensitivity-independent color similarity. This is a continuous score,
    // so changing the sensitivity slider does not change the displayed score.
    public static double AverageSimilarity(Bitmap bmp, int step, int targetR, int targetG, int targetB) {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, bmp.PixelFormat);
        try {
            int bpp = Math.Max(1, Image.GetPixelFormatSize(data.PixelFormat) / 8);
            int stride = data.Stride;
            int bytes = stride * bmp.Height;
            byte[] buf = new byte[bytes];
            Marshal.Copy(data.Scan0, buf, 0, bytes);
            double sum=0; long total=0;
            double maxDist=Math.Sqrt(3.0*255.0*255.0);
            for (int y=0; y<bmp.Height; y+=step) {
                int row=y*stride;
                for (int x=0; x<bmp.Width; x+=step) {
                    int idx=row+x*bpp;
                    if(idx+2>=bytes) continue;
                    double db=buf[idx]-targetB, dg=buf[idx+1]-targetG, dr=buf[idx+2]-targetR;
                    double dist=Math.Sqrt(dr*dr+dg*dg+db*db);
                    double sim=100.0*(1.0-dist/maxDist);
                    if(sim<0) sim=0;
                    sum+=sim; total++;
                }
            }
            if(total==0) return 0;
            return sum/total;
        } finally {
            bmp.UnlockBits(data);
        }
    }
    private static void RgbToHsv(int r, int g, int b, out double h, out double s, out double v) {
        double rn=r/255.0, gn=g/255.0, bn=b/255.0;
        double max=Math.Max(rn,Math.Max(gn,bn));
        double min=Math.Min(rn,Math.Min(gn,bn));
        v=max;
        double delta=max-min;
        s=(max<=0)?0:(delta/max);
        if(delta<=0.00001) { h=0; return; }
        if(max==rn) h=60.0*(((gn-bn)/delta)%6.0);
        else if(max==gn) h=60.0*(((bn-rn)/delta)+2.0);
        else h=60.0*(((rn-gn)/delta)+4.0);
        if(h<0) h+=360.0;
    }
    // 明るさ（Value）の影響を受けにくい、色味（Hue）ベースの一致率。
    // 暗い場所でランプ等が暗く写っても、色そのものは保たれやすいことを利用する。
    public static double HsvMatchRatio(Bitmap bmp, int step, double targetHue, double targetSat, double threshold, double softness) {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, bmp.PixelFormat);
        try {
            int bpp = Math.Max(1, Image.GetPixelFormatSize(data.PixelFormat) / 8);
            int stride = data.Stride;
            int bytes = stride * bmp.Height;
            byte[] buf = new byte[bytes];
            Marshal.Copy(data.Scan0, buf, 0, bytes);
            double sum=0; long total=0;
            double k=Math.Max(1.0, softness);
            for (int y=0; y<bmp.Height; y+=step) {
                int row=y*stride;
                for (int x=0; x<bmp.Width; x+=step) {
                    int idx=row+x*bpp;
                    if(idx+2>=bytes) continue;
                    int b=buf[idx], g=buf[idx+1], r=buf[idx+2];
                    double h,s,v;
                    RgbToHsv(r,g,b, out h, out s, out v);
                    double hueDiff=Math.Abs(h-targetHue);
                    if(hueDiff>180) hueDiff=360-hueDiff;
                    double satDiff=Math.Abs(s-targetSat)*100.0;
                    double dist=hueDiff+satDiff*0.5;
                    double score=100.0/(1.0+Math.Exp((dist-threshold)/k));
                    // ほぼ真っ黒（消灯・映り込みなし）は色味が不安定なので一致とみなさない
                    if(v<0.06) score=Math.Min(score,5.0);
                    sum+=score; total++;
                }
            }
            if(total==0) return 0;
            return sum/total;
        } finally {
            bmp.UnlockBits(data);
        }
    }
}
"@
}

function GrabBitmap($rect) {
    $bmp=New-Object System.Drawing.Bitmap($rect.Width,$rect.Height)
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Location,[System.Drawing.Point]::Empty,$rect.Size)
    $g.Dispose()
    return $bmp
}

# 監視ループ専用：Bitmap/Graphicsを使い回してGCの負荷（＝CPU負荷）を減らす
# エリアごとに専用バッファを持たせる（複数エリア対応）
$script:monBmp=$null
$script:monGfx=$null
$script:monBmpSize=New-Object System.Drawing.Size(0,0)
function GrabBitmapForMonitoring($rect) {
    if(($null -eq $script:monBmp) -or ($script:monBmpSize.Width -ne $rect.Width) -or ($script:monBmpSize.Height -ne $rect.Height)) {
        if($script:monGfx) { $script:monGfx.Dispose() }
        if($script:monBmp) { $script:monBmp.Dispose() }
        $script:monBmp=New-Object System.Drawing.Bitmap($rect.Width,$rect.Height)
        $script:monGfx=[System.Drawing.Graphics]::FromImage($script:monBmp)
        $script:monBmpSize=$rect.Size
    }
    $script:monGfx.CopyFromScreen($rect.Location,[System.Drawing.Point]::Empty,$rect.Size)
    return $script:monBmp
}

function GrabBitmapForArea($a) {
    $rect=$a.Rect
    if(($null -eq $a.MonBmp) -or ($a.MonBmpSize.Width -ne $rect.Width) -or ($a.MonBmpSize.Height -ne $rect.Height)) {
        if($a.MonGfx) { $a.MonGfx.Dispose() }
        if($a.MonBmp) { $a.MonBmp.Dispose() }
        $a.MonBmp=New-Object System.Drawing.Bitmap($rect.Width,$rect.Height)
        $a.MonGfx=[System.Drawing.Graphics]::FromImage($a.MonBmp)
        $a.MonBmpSize=$rect.Size
    }
    $a.MonGfx.CopyFromScreen($rect.Location,[System.Drawing.Point]::Empty,$rect.Size)
    return $a.MonBmp
}

function New-MonitorArea($name,$rect,$color) {
    return [PSCustomObject]@{
        Name=$name
        Rect=$rect
        Color=$color
        WasNG=$false
        NGSince=$null
        Direction='appear'
        Sensitivity=50
        NGThreshold=15
        HueMatchMode=$false
        BuzzerSeconds=2
        BuzzerType=0
        BuzzerVolume=80
        MonBmp=$null
        MonGfx=$null
        MonBmpSize=(New-Object System.Drawing.Size(0,0))
    }
}

function Dispose-MonitorArea($a) {
    try { if($a.MonGfx) { $a.MonGfx.Dispose() } } catch {}
    try { if($a.MonBmp) { $a.MonBmp.Dispose() } } catch {}
}

function RefreshAreaListUI {
    $areaList.Items.Clear()
    foreach($a in $script:areas) { [void]$areaList.Items.Add($a.Name) }
    if($script:areas.Count -gt 0) {
        $areaCountLabel.Text=$script:areas.Count.ToString()+'個のエリアを監視中'
        $areaCountLabel.ForeColor=$colorGreenBtn
    } else {
        $areaCountLabel.Text='まだエリアがありません'
        $areaCountLabel.ForeColor=$textSecondary
    }
    $areaList.Invalidate()
}

function SampleAreaColor($rect) {
    # 選んだエリアの平均色を計算し、それを検出色として使う
    try {
        $bmp=GrabBitmap $rect
        $rgb=[PixelScanner]::AverageColor($bmp,2)
        $bmp.Dispose()
        return [System.Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2])
    } catch { return $null }
}

function DetectionMatchRatio($bmp,$target,$sensitivity,$hueMode) {
    # 83%→84%のような1%差で一致率が急変しないよう、
    # 「一致/不一致」の二値判定ではなく、境界をなだらかにしたソフト一致率を使う。
    # 一致率としきい値の比較で、この同じ値を共通して使用する。
    if($hueMode) {
        $threshold = 15 + ([double]$sensitivity/100.0)*45
        $ratio=[PixelScanner]::HsvMatchRatio($bmp,2,$target.GetHue(),$target.GetSaturation(),$threshold,8.0)
    } else {
        $threshold = 20 + ([double]$sensitivity/100.0)*130
        $ratio=[PixelScanner]::SoftMatchRatio($bmp,2,$target.R,$target.G,$target.B,$threshold,12.0)
    }
    return [math]::Round($ratio,1)
}

function ColorMatchRatio($bmp,$target,$sensitivity,$hueMode) {
    return DetectionMatchRatio $bmp $target $sensitivity $hueMode
}

function SetStatusPanel($bg,$fg,$text) {
    $statusPanel.BackColor=$bg
    $status.ForeColor=$fg
    $status.Text=$text
    if($script:notifyIcon) {
        try {
            $tip='NGモニター: '+$text
            if($tip.Length -gt 63) { $tip=$tip.Substring(0,63) }
            $script:notifyIcon.Text=$tip
        } catch {}
    }
}

function Set-RoundedRegion($ctrl,$radius) {
    try {
        $w=$ctrl.Width; $h=$ctrl.Height; $d=$radius*2
        if($w -le 0 -or $h -le 0) { return }
        $path=New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0,0,$d,$d,180,90)
        $path.AddArc($w-$d,0,$d,$d,270,90)
        $path.AddArc($w-$d,$h-$d,$d,$d,0,90)
        $path.AddArc(0,$h-$d,$d,$d,90,90)
        $path.CloseFigure()
        $ctrl.Region=New-Object System.Drawing.Region($path)
    } catch {}
}

# ---- 設定の保存・読み込み（名前を付けて複数保存できる） ----
$script:settingsPath = Join-Path $PSScriptRoot 'ng_monitor_settings.json'
$script:lastPathPointerFile = Join-Path $PSScriptRoot 'ng_monitor_lastpath.txt'

function Remember-LastSettingsPath($path) {
    try { Set-Content -LiteralPath $script:lastPathPointerFile -Value $path -Encoding UTF8 } catch {}
}

function Resolve-LastSettingsPath {
    try {
        if(Test-Path -LiteralPath $script:lastPathPointerFile) {
            $p=(Get-Content -LiteralPath $script:lastPathPointerFile -Raw -Encoding UTF8).Trim()
            if($p -and (Test-Path -LiteralPath $p)) { $script:settingsPath=$p }
        }
    } catch {}
}

function Get-SettingsRoot {
    if(Test-Path -LiteralPath $script:settingsPath) {
        try {
            $raw=Get-Content -LiteralPath $script:settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if($raw -and ($raw.PSObject.Properties.Name -contains 'Profiles')) {
                return $raw
            }
            # 新形式：設定ファイルそのものが現在の設定を表す
            if($raw -and ($raw.PSObject.Properties.Name -contains 'BuzzerSeconds')) {
                return [PSCustomObject]@{ Profiles=[PSCustomObject]@{ '設定1'=$raw }; LastUsed='設定1' }
            }
        } catch {}
    }
    return [PSCustomObject]@{ Profiles=[PSCustomObject]@{}; LastUsed='' }
}

function Save-SettingsRoot($root) {
    try {
        $root | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $script:settingsPath -Encoding UTF8
        return $true
    } catch { return $false }
}

function Save-SettingsFile($path) {
    try {
        if([string]::IsNullOrWhiteSpace($path)) { return $false }
        $cur=Get-CurrentSettingsObject
        $cur | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $path -Encoding UTF8
        $script:settingsPath=$path
        Remember-LastSettingsPath $path
        return $true
    } catch { return $false }
}

function Load-SettingsFile($path) {
    try {
        if([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) { return $false }
        $raw=Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if($raw -and ($raw.PSObject.Properties.Name -contains 'Profiles')) {
            $names=@($raw.Profiles.PSObject.Properties.Name)
            if($names.Count -gt 0) {
                $name=$(if($raw.LastUsed -and ($names -contains $raw.LastUsed)){$raw.LastUsed}else{$names[0]})
                Apply-SettingsObject $raw.Profiles.$name
            } else { return $false }
        } elseif($raw -and ($raw.PSObject.Properties.Name -contains 'BuzzerSeconds')) {
            Apply-SettingsObject $raw
        } else { return $false }
        $script:settingsPath=$path
        Remember-LastSettingsPath $path
        return $true
    } catch { return $false }
}

function Get-ProfileNames {
    $root=Get-SettingsRoot
    if($root.Profiles) { return @($root.Profiles.PSObject.Properties.Name) }
    return @()
}

function Get-CurrentSettingsObject {
    $areaObjs=@()
    foreach($a in $script:areas) {
        $areaObjs += [PSCustomObject]@{
            Name=$a.Name
            X=$a.Rect.X; Y=$a.Rect.Y; W=$a.Rect.Width; H=$a.Rect.Height
            ColorR=$a.Color.R; ColorG=$a.Color.G; ColorB=$a.Color.B
            Sensitivity=$a.Sensitivity; NGThreshold=$a.NGThreshold; HueMatchMode=$a.HueMatchMode
            Direction=$a.Direction
            BuzzerSeconds=$a.BuzzerSeconds; BuzzerType=$a.BuzzerType; BuzzerVolume=$a.BuzzerVolume
        }
    }
    return [PSCustomObject]@{
        IntervalSec=$script:monitorIntervalSec
        Areas=$areaObjs
    }
}

function Apply-SettingsObject($data) {
    if($null -eq $data) { return }
    if($null -ne $data.IntervalSec)   { $script:monitorIntervalSec=[Math]::Max(0.1,[Math]::Min(5.0,[double]$data.IntervalSec)) }
    # 旧バージョン（全エリア共通設定）からの移行用の既定値
    $legacySensitivity=$(if($null -ne $data.Sensitivity){[Math]::Max(0,[Math]::Min(100,[int]$data.Sensitivity))}else{50})
    $legacyNGThreshold=$(if($null -ne $data.NGThreshold){[Math]::Max(1,[Math]::Min(100,[int]$data.NGThreshold))}else{15})
    $legacyHueMode=$(if($null -ne $data.HueMatchMode){[bool]$data.HueMatchMode}else{$false})
    $legacyBuzzerSeconds=$(if($null -ne $data.BuzzerSeconds){[Math]::Max(1,[Math]::Min(60,[int]$data.BuzzerSeconds))}else{2})
    $legacyBuzzerType=$(if($null -ne $data.BuzzerType){[Math]::Max(0,[Math]::Min(7,[int]$data.BuzzerType))}else{0})
    $legacyBuzzerVolume=$(if($null -ne $data.BuzzerVolume){[Math]::Max(0,[Math]::Min(100,[int]$data.BuzzerVolume))}else{80})

    Close-OpenNGEpisodes
    foreach($old in $script:areas) { Dispose-MonitorArea $old }
    $script:areas.Clear()

    if($null -ne $data.Areas -and @($data.Areas).Count -gt 0) {
        # 新形式：複数エリア
        $n=0
        foreach($ad in @($data.Areas)) {
            $n++
            $aw=[Math]::Max(1,[int]$ad.W)
            $ah=[Math]::Max(1,[int]$ad.H)
            $rect=New-Object System.Drawing.Rectangle([int]$ad.X,[int]$ad.Y,$aw,$ah)
            $cr=[Math]::Max(0,[Math]::Min(255,[int]$ad.ColorR))
            $cg=[Math]::Max(0,[Math]::Min(255,[int]$ad.ColorG))
            $cb=[Math]::Max(0,[Math]::Min(255,[int]$ad.ColorB))
            $color=[System.Drawing.Color]::FromArgb($cr,$cg,$cb)
            $areaName=$(if($ad.Name){$ad.Name}else{'エリア'+$n})
            $newArea=New-MonitorArea $areaName $rect $color
            $newArea.Sensitivity=$(if($null -ne $ad.Sensitivity){[Math]::Max(0,[Math]::Min(100,[int]$ad.Sensitivity))}else{$legacySensitivity})
            $newArea.NGThreshold=$(if($null -ne $ad.NGThreshold){[Math]::Max(1,[Math]::Min(100,[int]$ad.NGThreshold))}else{$legacyNGThreshold})
            $newArea.HueMatchMode=$(if($null -ne $ad.HueMatchMode){[bool]$ad.HueMatchMode}else{$legacyHueMode})
            $newArea.Direction=$(if($ad.Direction -eq 'disappear'){'disappear'}else{'appear'})
            $newArea.BuzzerSeconds=$(if($null -ne $ad.BuzzerSeconds){[Math]::Max(1,[Math]::Min(60,[int]$ad.BuzzerSeconds))}else{$legacyBuzzerSeconds})
            $newArea.BuzzerType=$(if($null -ne $ad.BuzzerType){[Math]::Max(0,[Math]::Min(7,[int]$ad.BuzzerType))}else{$legacyBuzzerType})
            $newArea.BuzzerVolume=$(if($null -ne $ad.BuzzerVolume){[Math]::Max(0,[Math]::Min(100,[int]$ad.BuzzerVolume))}else{$legacyBuzzerVolume})
            [void]$script:areas.Add($newArea)
        }
        $script:areaCounter=$script:areas.Count
    } elseif($data.AreaSet -eq $true) {
        # 旧形式（単一エリア）からの移行
        $aw=[Math]::Max(1,[int]$data.AreaW)
        $ah=[Math]::Max(1,[int]$data.AreaH)
        $rect=New-Object System.Drawing.Rectangle([int]$data.AreaX,[int]$data.AreaY,$aw,$ah)
        $cr=[Math]::Max(0,[Math]::Min(255,[int]$data.ColorR))
        $cg=[Math]::Max(0,[Math]::Min(255,[int]$data.ColorG))
        $cb=[Math]::Max(0,[Math]::Min(255,[int]$data.ColorB))
        $color=[System.Drawing.Color]::FromArgb($cr,$cg,$cb)
        $script:areaCounter=1
        $newArea=New-MonitorArea 'エリア1' $rect $color
        $newArea.Sensitivity=$legacySensitivity
        $newArea.NGThreshold=$legacyNGThreshold
        $newArea.HueMatchMode=$legacyHueMode
        $newArea.BuzzerSeconds=$legacyBuzzerSeconds
        $newArea.BuzzerType=$legacyBuzzerType
        $newArea.BuzzerVolume=$legacyBuzzerVolume
        [void]$script:areas.Add($newArea)
    }
}

function SaveNamedSettings($name) {
    if([string]::IsNullOrWhiteSpace($name)) { return $false }
    try {
        $root=Get-SettingsRoot
        $cur=Get-CurrentSettingsObject
        if($root.Profiles.PSObject.Properties.Name -contains $name) {
            $root.Profiles.$name = $cur
        } else {
            $root.Profiles | Add-Member -NotePropertyName $name -NotePropertyValue $cur -Force
        }
        $root.LastUsed = $name
        return (Save-SettingsRoot $root)
    } catch { return $false }
}

function LoadNamedSettings($name) {
    try {
        $root=Get-SettingsRoot
        if($root.Profiles.PSObject.Properties.Name -contains $name) {
            Apply-SettingsObject $root.Profiles.$name
            $root.LastUsed=$name
            Save-SettingsRoot $root | Out-Null
            return $true
        }
        return $false
    } catch { return $false }
}

function LoadLastUsedSettingsIfAny {
    try {
        if(-not (Test-Path -LiteralPath $script:settingsPath)) { return $false }
        $raw=Get-Content -LiteralPath $script:settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if($raw -and ($raw.PSObject.Properties.Name -contains 'Profiles')) {
            if($raw.LastUsed -and ($raw.Profiles.PSObject.Properties.Name -contains $raw.LastUsed)) {
                Apply-SettingsObject $raw.Profiles.($raw.LastUsed)
                return $true
            }
        } elseif($raw -and ($raw.PSObject.Properties.Name -contains 'BuzzerSeconds')) {
            Apply-SettingsObject $raw
            return $true
        }
    } catch {}
    return $false
}

function Show-NamePicker($names,$promptTitle) {
    $names=@($names)
    if($names.Count -eq 0) { return $null }
    $pf=New-Object System.Windows.Forms.Form
    $pf.Text=$promptTitle
    $pf.ClientSize=New-Object System.Drawing.Size(320,320)
    $pf.StartPosition='CenterParent'
    $pf.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::FixedDialog
    $pf.MaximizeBox=$false
    $pf.MinimizeBox=$false
    $pf.TopMost=$true
    $pf.Font=New-Object System.Drawing.Font('Meiryo UI',10)

    $lbl=New-Object System.Windows.Forms.Label
    $lbl.Text='読み込む設定を選んでください：'
    $lbl.Location=New-Object System.Drawing.Point(15,12)
    $lbl.Size=New-Object System.Drawing.Size(290,24)
    $pf.Controls.Add($lbl)

    $lb=New-Object System.Windows.Forms.ListBox
    $lb.Location=New-Object System.Drawing.Point(15,40)
    $lb.Size=New-Object System.Drawing.Size(290,200)
    $lb.Font=New-Object System.Drawing.Font('Meiryo UI',11)
    foreach($n in $names) { [void]$lb.Items.Add($n) }
    $lb.SelectedIndex=0
    $pf.Controls.Add($lb)

    $okBtn=New-Object System.Windows.Forms.Button
    $okBtn.Text='読み込む'
    $okBtn.Location=New-Object System.Drawing.Point(45,255)
    $okBtn.Size=New-Object System.Drawing.Size(110,36)
    $okBtn.DialogResult=[System.Windows.Forms.DialogResult]::OK
    $pf.Controls.Add($okBtn)

    $cancelBtn=New-Object System.Windows.Forms.Button
    $cancelBtn.Text='キャンセル'
    $cancelBtn.Location=New-Object System.Drawing.Point(165,255)
    $cancelBtn.Size=New-Object System.Drawing.Size(110,36)
    $cancelBtn.DialogResult=[System.Windows.Forms.DialogResult]::Cancel
    $pf.Controls.Add($cancelBtn)

    $pf.AcceptButton=$okBtn
    $pf.CancelButton=$cancelBtn

    $result=$pf.ShowDialog($f)
    $selected=$null
    if($result -eq [System.Windows.Forms.DialogResult]::OK -and $lb.SelectedItem) {
        $selected=$lb.SelectedItem.ToString()
    }
    $pf.Dispose()
    return $selected
}

Resolve-LastSettingsPath
LoadLastUsedSettingsIfAny | Out-Null
$script:suppressEvents = $false

function RefreshControlsFromSettings {
    $script:suppressEvents=$true
    try {
        $intervalBox.Value=[decimal]$script:monitorIntervalSec
        RefreshAreaListUI
    } finally {
        $script:suppressEvents=$false
    }
    if($script:areas.Count -gt 0) { $areaList.SelectedIndex=0 } else { LoadAreaSettingsIntoSliders }
    RegenerateSound
}

# ================== メイン画面 ==================
$f=New-Object System.Windows.Forms.Form
$f.Text='NG モニター（異常検知ブザー）'
$f.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::None
$f.StartPosition='CenterScreen'
$f.WindowState=[System.Windows.Forms.FormWindowState]::Normal
$f.TopMost=$true
$f.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$f.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::Sizable
$f.MaximizeBox=$true
$f.BackColor=$formBgDark

# --- ヘッダー部 ---
$headerPanel=New-Object System.Windows.Forms.Panel
$headerPanel.Location=New-Object System.Drawing.Point(0,0)
$headerPanel.Size=New-Object System.Drawing.Size(760,54)
$headerPanel.BackColor=$headerBgDark
$f.Controls.Add($headerPanel)
$headerPanel.Anchor=[System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

$title=New-Object System.Windows.Forms.Label
$title.Font=New-Object System.Drawing.Font('Meiryo UI',13,[System.Drawing.FontStyle]::Bold)
$title.AutoSize=$true
$title.Text='NG モニター'
$title.Location=New-Object System.Drawing.Point(20,12)
$title.ForeColor=[System.Drawing.Color]::White
$title.BackColor=[System.Drawing.Color]::Transparent
$headerPanel.Controls.Add($title)

$saveBtn=New-Object System.Windows.Forms.Button
$saveBtn.Text='設定を保存する'
$saveBtn.Size=New-Object System.Drawing.Size(150,36)
$saveBtn.Location=New-Object System.Drawing.Point(598,9)
$saveBtn.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$saveBtn.BackColor=$accentBlue
$saveBtn.ForeColor=[System.Drawing.Color]::White
$saveBtn.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$saveBtn.FlatAppearance.BorderSize=0
$headerPanel.Controls.Add($saveBtn)
Set-RoundedRegion $saveBtn 8

$loadBtn=New-Object System.Windows.Forms.Button
$loadBtn.Text='設定を読み込む'
$loadBtn.Size=New-Object System.Drawing.Size(150,36)
$loadBtn.Location=New-Object System.Drawing.Point(($saveBtn.Left-160),9)
$loadBtn.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$loadBtn.BackColor=[System.Drawing.Color]::FromArgb(60,80,102)
$loadBtn.ForeColor=[System.Drawing.Color]::White
$loadBtn.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$loadBtn.FlatAppearance.BorderSize=0
$headerPanel.Controls.Add($loadBtn)
Set-RoundedRegion $loadBtn 8

# --- ① 色とエリアの選択 ---
$grp1=New-Object System.Windows.Forms.GroupBox
$grp1.Text='① 検出したい色の部分を四角く囲んで選ぶ（複数追加可）'
$grp1.Location=New-Object System.Drawing.Point(12,64)
$grp1.Size=New-Object System.Drawing.Size(736,300)
$grp1.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$grp1.ForeColor=$accentBlue
$grp1.BackColor=$cardBgDark
$f.Controls.Add($grp1)
$grp1.Anchor=[System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

$pickHint=New-Object System.Windows.Forms.Label
$pickHint.Font=New-Object System.Drawing.Font('Meiryo UI',8)
$pickHint.AutoSize=$true
$pickHint.Text='ボタンを押して、検出したい部分をドラッグで四角く囲みます。複数のカメラ・場所を監視したい場合は、繰り返し押して追加できます。'
$pickHint.Location=New-Object System.Drawing.Point(18,24)
$pickHint.ForeColor=$textSecondary
$grp1.Controls.Add($pickHint)

$rowY=46
$pick=New-Object System.Windows.Forms.Button
$pick.Text='エリアを追加する'
$pick.Size=New-Object System.Drawing.Size(220,38)
$pick.Location=New-Object System.Drawing.Point(18,$rowY)
$pick.Font=New-Object System.Drawing.Font('Meiryo UI',9.5,[System.Drawing.FontStyle]::Bold)
$pick.BackColor=$colorBlueBtn
$pick.ForeColor=[System.Drawing.Color]::White
$pick.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$pick.FlatAppearance.BorderSize=0
$grp1.Controls.Add($pick)
Set-RoundedRegion $pick 9

$deleteAreaBtn=New-Object System.Windows.Forms.Button
$deleteAreaBtn.Text='選んだ項目を削除'
$deleteAreaBtn.Size=New-Object System.Drawing.Size(150,38)
$deleteAreaBtn.Location=New-Object System.Drawing.Point(($pick.Right+12),$rowY)
$deleteAreaBtn.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$deleteAreaBtn.BackColor=[System.Drawing.Color]::FromArgb(90,50,50)
$deleteAreaBtn.ForeColor=[System.Drawing.Color]::White
$deleteAreaBtn.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$deleteAreaBtn.FlatAppearance.BorderSize=0
$grp1.Controls.Add($deleteAreaBtn)
Set-RoundedRegion $deleteAreaBtn 8

$areaCountLabel=New-Object System.Windows.Forms.Label
$areaCountLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$areaCountLabel.AutoSize=$true
$areaCountLabel.Text='まだエリアがありません'
$areaCountLabel.Location=New-Object System.Drawing.Point(($deleteAreaBtn.Right+18),($rowY+11))
$areaCountLabel.ForeColor=$textSecondary
$grp1.Controls.Add($areaCountLabel)

$areaList=New-Object System.Windows.Forms.ListBox
$areaList.Location=New-Object System.Drawing.Point(18,($pick.Bottom+10))
$areaList.Size=New-Object System.Drawing.Size(700,84)
$areaList.DrawMode=[System.Windows.Forms.DrawMode]::OwnerDrawFixed
$areaList.ItemHeight=28
$areaList.BackColor=$inputBgDark
$areaList.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
$grp1.Controls.Add($areaList)
$script:areaListNameFont=New-Object System.Drawing.Font('Meiryo UI',9)
$script:areaListStatusFont=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$script:areaListNameBrush=New-Object System.Drawing.SolidBrush($textPrimary)
$script:areaListOkBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(140,220,150))
$script:areaListNgBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,140,140))
$areaList.Add_DrawItem({
    $_.DrawBackground()
    if($_.Index -ge 0 -and $_.Index -lt $script:areas.Count) {
        $a=$script:areas[$_.Index]
        $swBrush=New-Object System.Drawing.SolidBrush($a.Color)
        $_.Graphics.FillRectangle($swBrush,($_.Bounds.X+6),($_.Bounds.Y+4),20,20)
        $swBrush.Dispose()
        $dirText=$(if($a.Direction -eq 'disappear'){'[消]'}else{'[出]'})
        $_.Graphics.DrawString(($dirText+' '+$a.Name),$script:areaListNameFont,$script:areaListNameBrush,($_.Bounds.X+34),($_.Bounds.Y+5))
        $stText=$(if($a.WasNG){'NG'}else{'OK'})
        $stBrush=$(if($a.WasNG){$script:areaListNgBrush}else{$script:areaListOkBrush})
        $_.Graphics.DrawString($stText,$script:areaListStatusFont,$stBrush,($_.Bounds.Right-40),($_.Bounds.Y+5))
    }
    $_.DrawFocusRectangle()
})

$rowY=$areaList.Bottom+16
$areaSettingsLabel=New-Object System.Windows.Forms.Label
$areaSettingsLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$areaSettingsLabel.AutoSize=$true
$areaSettingsLabel.Text='（一覧からエリアを選ぶと、そのエリアの検出設定を編集できます）'
$areaSettingsLabel.Location=New-Object System.Drawing.Point(18,$rowY)
$areaSettingsLabel.ForeColor=$accentBlue
$grp1.Controls.Add($areaSettingsLabel)

$rowY=$areaSettingsLabel.Bottom+12
$directionLabel=New-Object System.Windows.Forms.Label
$directionLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$directionLabel.AutoSize=$true
$directionLabel.Text='検知の条件：'
$directionLabel.Location=New-Object System.Drawing.Point(18,($rowY+3))
$directionLabel.ForeColor=$textPrimary
$grp1.Controls.Add($directionLabel)

$rbAppear=New-Object System.Windows.Forms.RadioButton
$rbAppear.Font=New-Object System.Drawing.Font('Meiryo UI',8.5)
$rbAppear.AutoSize=$true
$rbAppear.Text='色が出たらNG（点灯・混入検知）'
$rbAppear.Checked=$true
$rbAppear.Enabled=$false
$rbAppear.ForeColor=$textPrimary
$rbAppear.Location=New-Object System.Drawing.Point(($directionLabel.Right+8),$rowY)
$grp1.Controls.Add($rbAppear)

$rbDisappear=New-Object System.Windows.Forms.RadioButton
$rbDisappear.Font=New-Object System.Drawing.Font('Meiryo UI',8.5)
$rbDisappear.AutoSize=$true
$rbDisappear.Text='色が消えたらNG（部品なし検知）'
$rbDisappear.Enabled=$false
$rbDisappear.ForeColor=$textPrimary
$rbDisappear.Location=New-Object System.Drawing.Point(($rbAppear.Right+20),$rowY)
$grp1.Controls.Add($rbDisappear)

$rowY=$rbAppear.Bottom+14
$sensLabel=New-Object System.Windows.Forms.Label
$sensLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$sensLabel.AutoSize=$true
$sensLabel.Text='検出の感度：'
$sensLabel.Location=New-Object System.Drawing.Point(18,($rowY+6))
$sensLabel.ForeColor=$textPrimary
$grp1.Controls.Add($sensLabel)

$sensTrack=New-Object System.Windows.Forms.TrackBar
$sensTrack.Minimum=0
$sensTrack.Maximum=100
$sensTrack.TickFrequency=10
$sensTrack.Value=50
$sensTrack.Enabled=$false
$sensTrack.Size=New-Object System.Drawing.Size(250,32)
$sensTrack.Location=New-Object System.Drawing.Point(($sensLabel.Right+14),$rowY)
$grp1.Controls.Add($sensTrack)

$sensPercentLabel=New-Object System.Windows.Forms.Label
$sensPercentLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$sensPercentLabel.AutoSize=$true
$sensPercentLabel.Text='50%'
$sensPercentLabel.Location=New-Object System.Drawing.Point(($sensTrack.Right+14),($rowY+6))
$sensPercentLabel.ForeColor=$textPrimary
$grp1.Controls.Add($sensPercentLabel)

$liveRatioLabel=New-Object System.Windows.Forms.Label
$liveRatioLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$liveRatioLabel.AutoSize=$true
$liveRatioLabel.Text='現在の一致率：－'
$liveRatioLabel.Location=New-Object System.Drawing.Point(($sensPercentLabel.Right+24),($rowY+6))
$liveRatioLabel.ForeColor=[System.Drawing.Color]::FromArgb(255,210,90)
$grp1.Controls.Add($liveRatioLabel)

$measureBtn=New-Object System.Windows.Forms.Button
$measureBtn.Text='測定'
$measureBtn.Size=New-Object System.Drawing.Size(56,24)
$measureBtn.Location=New-Object System.Drawing.Point(($liveRatioLabel.Right+10),($rowY+2))
$measureBtn.Font=New-Object System.Drawing.Font('Meiryo UI',8,[System.Drawing.FontStyle]::Bold)
$measureBtn.BackColor=[System.Drawing.Color]::FromArgb(60,80,102)
$measureBtn.ForeColor=[System.Drawing.Color]::White
$measureBtn.Enabled=$false
$measureBtn.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$measureBtn.FlatAppearance.BorderSize=0
$grp1.Controls.Add($measureBtn)
Set-RoundedRegion $measureBtn 6

$sensHint=New-Object System.Windows.Forms.Label
$sensHint.Font=New-Object System.Drawing.Font('Meiryo UI',7.5)
$sensHint.AutoSize=$true
$sensHint.Text='感度↓：検知しやすい／感度↑：誤検知を減らす'
$sensHint.Location=New-Object System.Drawing.Point(18,($sensTrack.Bottom+2))
$sensHint.ForeColor=$textSecondary
$grp1.Controls.Add($sensHint)

$hueModeCheck=New-Object System.Windows.Forms.CheckBox
$hueModeCheck.Font=New-Object System.Drawing.Font('Meiryo UI',8.5)
$hueModeCheck.AutoSize=$true
$hueModeCheck.Text='暗い場所でも検出しやすくする（色味を重視）'
$hueModeCheck.Checked=$false
$hueModeCheck.Enabled=$false
$hueModeCheck.ForeColor=$textPrimary
$hueModeCheck.Location=New-Object System.Drawing.Point(18,($sensHint.Bottom+8))
$grp1.Controls.Add($hueModeCheck)

$rowY=$hueModeCheck.Bottom+10
$ngLabel=New-Object System.Windows.Forms.Label
$ngLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$ngLabel.AutoSize=$true
$ngLabel.Text='一致率のしきい値：'
$ngLabel.Location=New-Object System.Drawing.Point(18,($rowY+6))
$ngLabel.ForeColor=$textPrimary
$grp1.Controls.Add($ngLabel)

$ngTrack=New-Object System.Windows.Forms.TrackBar
$ngTrack.Minimum=1
$ngTrack.Maximum=100
$ngTrack.TickFrequency=10
$ngTrack.Value=15
$ngTrack.Enabled=$false
$ngTrack.Size=New-Object System.Drawing.Size(250,32)
$ngTrack.Location=New-Object System.Drawing.Point(($ngLabel.Right+14),$rowY)
$grp1.Controls.Add($ngTrack)

$ngPercentLabel=New-Object System.Windows.Forms.Label
$ngPercentLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$ngPercentLabel.AutoSize=$true
$ngPercentLabel.Text='15%'
$ngPercentLabel.Location=New-Object System.Drawing.Point(($ngTrack.Right+14),($rowY+6))
$ngPercentLabel.ForeColor=$textPrimary
$grp1.Controls.Add($ngPercentLabel)

$ngHint=New-Object System.Windows.Forms.Label
$ngHint.Font=New-Object System.Drawing.Font('Meiryo UI',7.5)
$ngHint.AutoSize=$true
$ngHint.Text='一致率がこの値以上でNG判定'
$ngHint.Location=New-Object System.Drawing.Point(18,($ngTrack.Bottom+2))
$ngHint.ForeColor=$textSecondary
$grp1.Controls.Add($ngHint)

# プレビューは独立した1行として配置する（横幅の見積もり違いで文字と重ならないように）
$rowY=$ngHint.Bottom+16
$areaPreviewBox=New-Object System.Windows.Forms.PictureBox
$areaPreviewBox.Size=New-Object System.Drawing.Size(96,72)
$areaPreviewBox.Location=New-Object System.Drawing.Point(18,$rowY)
$areaPreviewBox.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
$areaPreviewBox.BackColor=$inputBgDark
$areaPreviewBox.SizeMode=[System.Windows.Forms.PictureBoxSizeMode]::Zoom
$grp1.Controls.Add($areaPreviewBox)

$areaPreviewInfoLabel=New-Object System.Windows.Forms.Label
$areaPreviewInfoLabel.Font=New-Object System.Drawing.Font('Meiryo UI',7.5)
$areaPreviewInfoLabel.AutoSize=$true
$areaPreviewInfoLabel.Text='一覧でエリアを選ぶと、ここに映像と位置が表示されます'
$areaPreviewInfoLabel.Location=New-Object System.Drawing.Point(($areaPreviewBox.Right+14),($rowY+4))
$areaPreviewInfoLabel.ForeColor=$textSecondary
$grp1.Controls.Add($areaPreviewInfoLabel)

$highlightBtn=New-Object System.Windows.Forms.Button
$highlightBtn.Text='画面で位置を確認'
$highlightBtn.Size=New-Object System.Drawing.Size(240,28)
$highlightBtn.Location=New-Object System.Drawing.Point(($areaPreviewBox.Right+14),($areaPreviewInfoLabel.Bottom+8))
$highlightBtn.Font=New-Object System.Drawing.Font('Meiryo UI',8,[System.Drawing.FontStyle]::Bold)
$highlightBtn.BackColor=[System.Drawing.Color]::FromArgb(60,80,102)
$highlightBtn.ForeColor=[System.Drawing.Color]::White
$highlightBtn.Enabled=$false
$highlightBtn.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$highlightBtn.FlatAppearance.BorderSize=0
$grp1.Controls.Add($highlightBtn)
Set-RoundedRegion $highlightBtn 7

function Show-AreaHighlight($rect) {
    # 画面に別ウィンドウを重ねて描く方式は、環境によって座標がずれる問題が
    # 繰り返し起きたため廃止。代わりに「周辺を含めて撮影した画像に、監視範囲の
    # 枠を直接描き込んで表示する」方式にする。別ウィンドウの座標合わせが
    # 一切不要になるため、この種のズレが原理的に起こらない。
    try {
        $margin=70
        $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen
        $cx=[Math]::Max($vs.X,$rect.X-$margin)
        $cy=[Math]::Max($vs.Y,$rect.Y-$margin)
        $cRight=[Math]::Min($vs.X+$vs.Width,$rect.X+$rect.Width+$margin)
        $cBottom=[Math]::Min($vs.Y+$vs.Height,$rect.Y+$rect.Height+$margin)
        $cw=[Math]::Max(10,$cRight-$cx)
        $ch=[Math]::Max(10,$cBottom-$cy)
        $captureRect=New-Object System.Drawing.Rectangle($cx,$cy,$cw,$ch)
        $bmp=GrabBitmap $captureRect

        $g=[System.Drawing.Graphics]::FromImage($bmp)
        $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,255,0),3)
        $bx=$rect.X-$cx
        $by=$rect.Y-$cy
        $g.DrawRectangle($pen,$bx,$by,$rect.Width,$rect.Height)
        $pen.Dispose()
        $g.Dispose()

        $dlg=New-Object System.Windows.Forms.Form
        $dlg.Text='監視範囲の位置（黄色い枠の内側）'
        $dlg.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::None
        $dlg.Font=New-Object System.Drawing.Font('Meiryo UI',9)
        $dlg.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::FixedDialog
        $dlg.MaximizeBox=$false
        $dlg.MinimizeBox=$false
        $dlg.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterScreen
        $dlg.TopMost=$true
        $dlg.BackColor=$cardBgDark

        $picW=[Math]::Min(760,[Math]::Max(260,$cw))
        $picH=[Math]::Min(560,[Math]::Max(200,[int]($ch*($picW/$cw))))
        $pic=New-Object System.Windows.Forms.PictureBox
        $pic.Location=New-Object System.Drawing.Point(15,15)
        $pic.Size=New-Object System.Drawing.Size($picW,$picH)
        $pic.SizeMode=[System.Windows.Forms.PictureBoxSizeMode]::Zoom
        $pic.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
        $pic.Image=$bmp
        $dlg.Controls.Add($pic)

        $info=New-Object System.Windows.Forms.Label
        $info.AutoSize=$true
        $info.Font=New-Object System.Drawing.Font('Meiryo UI',8.5)
        $info.ForeColor=$textSecondary
        $info.Text=('監視範囲：X='+$rect.X+' Y='+$rect.Y+'　サイズ：'+$rect.Width+'×'+$rect.Height+' px')
        $info.Location=New-Object System.Drawing.Point(15,($pic.Bottom+10))
        $dlg.Controls.Add($info)

        $closeBtn=New-Object System.Windows.Forms.Button
        $closeBtn.Text='閉じる'
        $closeBtn.Size=New-Object System.Drawing.Size(110,32)
        $closeBtn.Location=New-Object System.Drawing.Point(($pic.Right-110),($info.Bottom+10))
        $closeBtn.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
        $closeBtn.BackColor=$colorBlueBtn
        $closeBtn.ForeColor=[System.Drawing.Color]::White
        $closeBtn.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
        $closeBtn.FlatAppearance.BorderSize=0
        $closeBtn.DialogResult=[System.Windows.Forms.DialogResult]::OK
        $dlg.Controls.Add($closeBtn)
        $dlg.AcceptButton=$closeBtn

        $dlg.ClientSize=New-Object System.Drawing.Size(($pic.Right+15),($closeBtn.Bottom+15))
        [void]$dlg.ShowDialog($f)
        $bmp.Dispose()
        $dlg.Dispose()
    } catch {}
}

function UpdateAreaPreview {
    $idx=$areaList.SelectedIndex
    if($idx -lt 0 -or $idx -ge $script:areas.Count) {
        if($areaPreviewBox.Image) { $old=$areaPreviewBox.Image; $areaPreviewBox.Image=$null; $old.Dispose() }
        $areaPreviewInfoLabel.Text='一覧でエリアを選ぶと、ここに映像と位置が表示されます'
        $liveRatioLabel.Text='現在の一致率：－'
        $measureBtn.Enabled=$false
        return
    }
    $a=$script:areas[$idx]
    $measureBtn.Enabled=$true
    try {
        $bmp=GrabBitmap $a.Rect
        $old=$areaPreviewBox.Image
        $areaPreviewBox.Image=$bmp
        if($old) { $old.Dispose() }
        $areaPreviewInfoLabel.Text=($a.Name+'　X='+$a.Rect.X+' Y='+$a.Rect.Y+' '+$a.Rect.Width+'×'+$a.Rect.Height)
    } catch {}
}

function MeasureLiveRatio {
    # CPU・メモリ節約のため、常時計算はせず「測定」ボタンを押した時だけ計算する
    $idx=$areaList.SelectedIndex
    if($idx -lt 0 -or $idx -ge $script:areas.Count) { return }
    $a=$script:areas[$idx]
    try {
        $bmp=GrabBitmap $a.Rect
        $liveRatio=ColorMatchRatio $bmp $a.Color $sensTrack.Value $hueModeCheck.Checked
        $bmp.Dispose()
        $liveRatioLabel.Text='現在の一致率：'+$liveRatio+'%'
    } catch {}
}

$rowY=[Math]::Max($ngHint.Bottom,$highlightBtn.Bottom)+14
$intervalLabel=New-Object System.Windows.Forms.Label
$intervalLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$intervalLabel.AutoSize=$true
$intervalLabel.Text='監視の間隔：'
$intervalLabel.Location=New-Object System.Drawing.Point(18,($rowY+4))
$intervalLabel.ForeColor=$textPrimary
$grp1.Controls.Add($intervalLabel)

$intervalBox=New-Object System.Windows.Forms.NumericUpDown
$intervalBox.Minimum=0.1
$intervalBox.Maximum=5.0
$intervalBox.DecimalPlaces=1
$intervalBox.Increment=0.1
$intervalBox.Value=[decimal]$script:monitorIntervalSec
$intervalBox.Size=New-Object System.Drawing.Size(80,28)
$intervalBox.Location=New-Object System.Drawing.Point(($intervalLabel.Right+14),$rowY)
$intervalBox.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$intervalBox.TextAlign=[System.Windows.Forms.HorizontalAlignment]::Center
$intervalBox.BackColor=$inputBgDark
$intervalBox.ForeColor=$textPrimary
try { $intervalBox.Controls[0].BackColor=$inputBgDark; $intervalBox.Controls[0].ForeColor=$textPrimary } catch {}
$grp1.Controls.Add($intervalBox)

$intervalUnitLabel=New-Object System.Windows.Forms.Label
$intervalUnitLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$intervalUnitLabel.AutoSize=$true
$intervalUnitLabel.Text='秒ごとにチェック'
$intervalUnitLabel.Location=New-Object System.Drawing.Point(($intervalBox.Right+14),($rowY+4))
$intervalUnitLabel.ForeColor=$textPrimary
$grp1.Controls.Add($intervalUnitLabel)

$intervalHint=New-Object System.Windows.Forms.Label
$intervalHint.Font=New-Object System.Drawing.Font('Meiryo UI',7.5)
$intervalHint.AutoSize=$true
$intervalHint.Text='短いほど検知は速くなります（PC負荷は上がります）'
$intervalHint.Location=New-Object System.Drawing.Point(18,($intervalBox.Bottom+2))
$intervalHint.ForeColor=$textSecondary
$grp1.Controls.Add($intervalHint)

$grp1.Height=$intervalHint.Bottom+18

# --- ② ブザーの設定 ---
$grp2=New-Object System.Windows.Forms.GroupBox
$grp2.Text='② ブザーの設定（エリアごとに長さ・音の種類・音量）'
$grp2.Location=New-Object System.Drawing.Point(12,($grp1.Bottom+10))
$grp2.Size=New-Object System.Drawing.Size(736,190)
$grp2.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$grp2.ForeColor=$accentBlue
$grp2.BackColor=$cardBgDark
$f.Controls.Add($grp2)
$grp2.Anchor=[System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

$buzzerSettingsLabel=New-Object System.Windows.Forms.Label
$buzzerSettingsLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$buzzerSettingsLabel.AutoSize=$true
$buzzerSettingsLabel.Text='（①の一覧からエリアを選ぶと、そのエリアのブザー設定を編集できます）'
$buzzerSettingsLabel.Location=New-Object System.Drawing.Point(18,20)
$buzzerSettingsLabel.ForeColor=$accentBlue
$grp2.Controls.Add($buzzerSettingsLabel)

$rowY=$buzzerSettingsLabel.Bottom+12
$secLabel=New-Object System.Windows.Forms.Label
$secLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$secLabel.AutoSize=$true
$secLabel.Text='長さ：'
$secLabel.Location=New-Object System.Drawing.Point(18,($rowY+4))
$secLabel.ForeColor=$textPrimary
$grp2.Controls.Add($secLabel)

$secBox=New-Object System.Windows.Forms.NumericUpDown
$secBox.Minimum=1
$secBox.Maximum=60
$secBox.Value=2
$secBox.Enabled=$false
$secBox.DecimalPlaces=0
$secBox.Increment=1
$secBox.Size=New-Object System.Drawing.Size(75,28)
$secBox.Location=New-Object System.Drawing.Point(($secLabel.Right+10),$rowY)
$secBox.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$secBox.TextAlign=[System.Windows.Forms.HorizontalAlignment]::Center
$secBox.BackColor=$inputBgDark
$secBox.ForeColor=$textPrimary
try { $secBox.Controls[0].BackColor=$inputBgDark; $secBox.Controls[0].ForeColor=$textPrimary } catch {}
$grp2.Controls.Add($secBox)

$secUnitLabel=New-Object System.Windows.Forms.Label
$secUnitLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$secUnitLabel.AutoSize=$true
$secUnitLabel.Text='秒'
$secUnitLabel.Location=New-Object System.Drawing.Point(($secBox.Right+10),($rowY+4))
$secUnitLabel.ForeColor=$textPrimary
$grp2.Controls.Add($secUnitLabel)

$test=New-Object System.Windows.Forms.Button
$test.Text='音を試す（テスト再生）'
$test.Size=New-Object System.Drawing.Size(260,38)
$test.Location=New-Object System.Drawing.Point(($secUnitLabel.Right+18),($rowY-4))
$test.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$test.BackColor=$colorYellowBtn
$test.ForeColor=[System.Drawing.Color]::FromArgb(60,45,0)
$test.Enabled=$false
$test.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$test.FlatAppearance.BorderSize=0
$grp2.Controls.Add($test)
Set-RoundedRegion $test 8

$rowY=$secBox.Bottom+18
$typeLabel=New-Object System.Windows.Forms.Label
$typeLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$typeLabel.AutoSize=$true
$typeLabel.Text='音の種類：'
$typeLabel.Location=New-Object System.Drawing.Point(18,($rowY+4))
$typeLabel.ForeColor=$textPrimary
$grp2.Controls.Add($typeLabel)

$typeCombo=New-Object System.Windows.Forms.ComboBox
$typeCombo.DropDownStyle=[System.Windows.Forms.ComboBoxStyle]::DropDownList
$typeCombo.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$typeCombo.BackColor=$inputBgDark
$typeCombo.ForeColor=$textPrimary
$typeCombo.Enabled=$false
[void]$typeCombo.Items.AddRange($buzzerTypeNames)
$typeCombo.SelectedIndex=0
$typeCombo.Size=New-Object System.Drawing.Size(260,28)
$typeCombo.Location=New-Object System.Drawing.Point(($typeLabel.Right+10),$rowY)
$grp2.Controls.Add($typeCombo)

$volLabel=New-Object System.Windows.Forms.Label
$volLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9)
$volLabel.AutoSize=$true
$volLabel.Text='音量：'
$volLabel.Location=New-Object System.Drawing.Point(($typeCombo.Right+24),($rowY+4))
$volLabel.ForeColor=$textPrimary
$grp2.Controls.Add($volLabel)

$volTrack=New-Object System.Windows.Forms.TrackBar
$volTrack.Minimum=0
$volTrack.Maximum=100
$volTrack.TickFrequency=10
$volTrack.Value=80
$volTrack.Enabled=$false
$volTrack.Size=New-Object System.Drawing.Size(180,32)
$volTrack.Location=New-Object System.Drawing.Point(($volLabel.Right+8),($rowY-5))
$grp2.Controls.Add($volTrack)

$volPercentLabel=New-Object System.Windows.Forms.Label
$volPercentLabel.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$volPercentLabel.AutoSize=$true
$volPercentLabel.Text='80%'
$volPercentLabel.Location=New-Object System.Drawing.Point(($volTrack.Right+10),($rowY+4))
$volPercentLabel.ForeColor=$textPrimary
$grp2.Controls.Add($volPercentLabel)

$typeHint=New-Object System.Windows.Forms.Label
$typeHint.Font=New-Object System.Drawing.Font('Meiryo UI',7.5)
$typeHint.AutoSize=$true
$typeHint.Text='「音を試す」で現在の音を確認できます'
$typeHint.Location=New-Object System.Drawing.Point(18,($typeCombo.Bottom+12))
$typeHint.ForeColor=$textSecondary
$grp2.Controls.Add($typeHint)

$grp2.Height=$typeHint.Bottom+16

# --- ③ 開始・停止 ---
$grp3=New-Object System.Windows.Forms.GroupBox
$grp3.Text='③ 監視をスタート・ストップする'
$grp3.Location=New-Object System.Drawing.Point(12,($grp2.Bottom+10))
$grp3.Size=New-Object System.Drawing.Size(736,130)
$grp3.Font=New-Object System.Drawing.Font('Meiryo UI',9,[System.Drawing.FontStyle]::Bold)
$grp3.ForeColor=$accentBlue
$grp3.BackColor=$cardBgDark
$f.Controls.Add($grp3)
$grp3.Anchor=[System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

$logEnabledCheck=New-Object System.Windows.Forms.CheckBox
$logEnabledCheck.Font=New-Object System.Drawing.Font('Meiryo UI',8.5)
$logEnabledCheck.AutoSize=$true
$logEnabledCheck.Text='NGログを記録する（発生・解除の日時をCSVに残す）'
$logEnabledCheck.Checked=$script:loggingEnabled
$logEnabledCheck.ForeColor=$textPrimary
$logEnabledCheck.Location=New-Object System.Drawing.Point(18,22)
$grp3.Controls.Add($logEnabledCheck)

$openLogBtn=New-Object System.Windows.Forms.Button
$openLogBtn.Text='ログを開く'
$openLogBtn.Size=New-Object System.Drawing.Size(120,28)
$openLogBtn.Location=New-Object System.Drawing.Point(($logEnabledCheck.Right+16),($logEnabledCheck.Top-4))
$openLogBtn.Font=New-Object System.Drawing.Font('Meiryo UI',8.5,[System.Drawing.FontStyle]::Bold)
$openLogBtn.BackColor=[System.Drawing.Color]::FromArgb(60,80,102)
$openLogBtn.ForeColor=[System.Drawing.Color]::White
$openLogBtn.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$openLogBtn.FlatAppearance.BorderSize=0
$grp3.Controls.Add($openLogBtn)
Set-RoundedRegion $openLogBtn 7

$rowY=$logEnabledCheck.Bottom+14
$start=New-Object System.Windows.Forms.Button
$start.Text='▶  監視スタート'
$start.Location=New-Object System.Drawing.Point(18,$rowY)
$start.Size=New-Object System.Drawing.Size(345,46)
$start.Font=New-Object System.Drawing.Font('Meiryo UI',9.5,[System.Drawing.FontStyle]::Bold)
$start.BackColor=$colorGreenBtn
$start.ForeColor=[System.Drawing.Color]::White
$start.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$start.FlatAppearance.BorderSize=0
$grp3.Controls.Add($start)
Set-RoundedRegion $start 9

$stop=New-Object System.Windows.Forms.Button
$stop.Text='■  停止（音を止める）'
$stop.Location=New-Object System.Drawing.Point(372,$rowY)
$stop.Size=New-Object System.Drawing.Size(346,46)
$stop.Font=New-Object System.Drawing.Font('Meiryo UI',9.5,[System.Drawing.FontStyle]::Bold)
$stop.BackColor=$colorRedBtn
$stop.ForeColor=[System.Drawing.Color]::White
$stop.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
$stop.FlatAppearance.BorderSize=0
$grp3.Controls.Add($stop)
Set-RoundedRegion $stop 9

$grp3.Height=$start.Bottom+18

# --- 状態表示パネル ---
$statusPanel=New-Object System.Windows.Forms.Panel
$statusPanel.Location=New-Object System.Drawing.Point(12,($grp3.Bottom+10))
$statusPanel.Size=New-Object System.Drawing.Size(736,96)
$statusPanel.BackColor=$colorIdle
$statusPanel.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
$f.Controls.Add($statusPanel)
$statusPanel.Anchor=[System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$statusPanel.Add_Resize({ Set-RoundedRegion $statusPanel 12 })
Set-RoundedRegion $statusPanel 12

$status=New-Object System.Windows.Forms.Label
$status.Text=''
$status.Dock=[System.Windows.Forms.DockStyle]::Fill
$status.TextAlign=[System.Drawing.ContentAlignment]::MiddleCenter
$status.AutoEllipsis=$true
$status.Font=New-Object System.Drawing.Font('Meiryo UI',13,[System.Drawing.FontStyle]::Bold)
$status.ForeColor=[System.Drawing.Color]::FromArgb(60,60,60)
$statusPanel.Controls.Add($status)

$f.ClientSize=New-Object System.Drawing.Size(760,($statusPanel.Bottom+20))
[void]$f.Handle   # ウィンドウの実体を先に作らせてから、正しいサイズを取得する
$f.MinimumSize=$f.Size
$f.MaximumSize=New-Object System.Drawing.Size(1600,$f.Size.Height)

# ================== イベント ==================
$saveBtn.Add_Click({
    $dlg=New-Object System.Windows.Forms.SaveFileDialog
    $dlg.Title='設定ファイルを保存'
    $dlg.Filter='NGモニター設定 (*.json)|*.json|すべてのファイル (*.*)|*.*'
    $dlg.DefaultExt='json'
    $dlg.AddExtension=$true
    $dlg.OverwritePrompt=$true
    $dlg.FileName='NG_monitor_settings.json'
    try {
        if(Test-Path -LiteralPath $script:settingsPath) {
            $dir=[System.IO.Path]::GetDirectoryName($script:settingsPath)
            if($dir -and (Test-Path -LiteralPath $dir)) { $dlg.InitialDirectory=$dir }
            $dlg.FileName=[System.IO.Path]::GetFileName($script:settingsPath)
        } else {
            $docs=[Environment]::GetFolderPath('MyDocuments')
            if($docs -and (Test-Path -LiteralPath $docs)) { $dlg.InitialDirectory=$docs }
        }
    } catch {}
    if($dlg.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) {
        if(Save-SettingsFile $dlg.FileName) {
            $name=[System.IO.Path]::GetFileName($dlg.FileName)
            SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ('設定を保存しました：'+$name)
        } else {
            SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(150,30,30)) '設定の保存に失敗しました。'
        }
    }
    $dlg.Dispose()
})
$loadBtn.Add_Click({
    $dlg=New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title='設定ファイルを読み込む'
    $dlg.Filter='NGモニター設定 (*.json)|*.json|すべてのファイル (*.*)|*.*'
    $dlg.CheckFileExists=$true
    $dlg.Multiselect=$false
    try {
        if(Test-Path -LiteralPath $script:settingsPath) {
            $dir=[System.IO.Path]::GetDirectoryName($script:settingsPath)
            if($dir -and (Test-Path -LiteralPath $dir)) { $dlg.InitialDirectory=$dir }
        } else {
            $docs=[Environment]::GetFolderPath('MyDocuments')
            if($docs -and (Test-Path -LiteralPath $docs)) { $dlg.InitialDirectory=$docs }
        }
    } catch {}
    if($dlg.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) {
        $wasRunning=$script:running
        if(Load-SettingsFile $dlg.FileName) {
            if($wasRunning) {
                $script:running=$false
                $script:alarm=$false
                BuzzStop
            }
            RefreshControlsFromSettings
            $name=[System.IO.Path]::GetFileName($dlg.FileName)
            $msg='設定を読み込みました：'+$name
            if($wasRunning) { $msg+='（監視中に読み込んだため、監視は停止しました。内容を確認して再度スタートしてください）' }
            SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) $msg
        } else {
            SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(150,30,30)) '設定ファイルの読み込みに失敗しました。'
        }
    }
    $dlg.Dispose()
})
$secBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) { return }
    $script:areas[$idx].BuzzerSeconds=[int]$secBox.Value
    SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ($script:areas[$idx].Name+'のブザーの長さを '+[int]$secBox.Value+' 秒に変更しました')
})
$pick.Add_Click({
    $wasTimerRunning=$timer.Enabled
    if($wasTimerRunning) { $timer.Stop() }
    if($previewTimer) { $previewTimer.Stop() }
    PickArea
    if($script:area){
        $sampled=SampleAreaColor $script:area
        if($sampled) {
            $script:areaCounter++
            $newArea=New-MonitorArea ('エリア'+$script:areaCounter) $script:area $sampled
            [void]$script:areas.Add($newArea)
            RefreshAreaListUI
            $areaList.SelectedIndex=$script:areas.Count-1
            SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ($newArea.Name+'を追加しました。必要ならこのエリアの検出設定を調整してください。')
        } else {
            SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(60,60,60)) '色の取得に失敗しました。もう一度お試しください。'
        }
    }
    $script:area=$null
    if($wasTimerRunning) { $timer.Start() }
    if($previewTimer) { $previewTimer.Start() }
})
$deleteAreaBtn.Add_Click({
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) {
        SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(60,60,60)) '削除する項目を一覧から選んでください。'
        return
    }
    $removed=$script:areas[$idx]
    if($removed.WasNG) {
        $durationSec=$(if($removed.NGSince){((Get-Date)-$removed.NGSince).TotalSeconds}else{$null})
        Write-NGLogRow (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $removed.Name 'NG解除（エリア削除）' $null $durationSec
    }
    Dispose-MonitorArea $removed
    $script:areas.RemoveAt($idx)
    RefreshAreaListUI
    if($script:areas.Count -eq 0 -and $script:running) {
        $script:running=$false
        $script:alarm=$false
        BuzzStop
        SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(150,30,30)) ($removed.Name+'を削除しました。監視対象が無くなったため、監視を停止しました。')
    } else {
        SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(60,60,60)) ($removed.Name+'を削除しました。')
    }
})
function UpdateNGHintText($direction) {
    if($direction -eq 'disappear') {
        $ngHint.Text='一致率がこの値を下回ったらNG判定（色が消えた時）'
    } else {
        $ngHint.Text='一致率がこの値以上でNG判定（色が出た時）'
    }
}

function LoadAreaSettingsIntoSliders {
    $idx=$areaList.SelectedIndex
    $script:suppressEvents=$true
    try {
        if($idx -ge 0 -and $idx -lt $script:areas.Count) {
            $a=$script:areas[$idx]
            $rbAppear.Enabled=$true
            $rbDisappear.Enabled=$true
            if($a.Direction -eq 'disappear') { $rbDisappear.Checked=$true } else { $rbAppear.Checked=$true }
            UpdateNGHintText $a.Direction
            $sensTrack.Enabled=$true
            $ngTrack.Enabled=$true
            $hueModeCheck.Enabled=$true
            $sensTrack.Value=$a.Sensitivity
            $sensPercentLabel.Text=$a.Sensitivity.ToString()+'%'
            $ngTrack.Value=$a.NGThreshold
            $ngPercentLabel.Text=$a.NGThreshold.ToString()+'%'
            $hueModeCheck.Checked=$a.HueMatchMode
            $areaSettingsLabel.Text=($a.Name+' の検出設定を編集中')
            $secBox.Enabled=$true
            $typeCombo.Enabled=$true
            $volTrack.Enabled=$true
            $test.Enabled=$true
            $secBox.Value=[decimal]$a.BuzzerSeconds
            $typeCombo.SelectedIndex=[Math]::Max(0,[Math]::Min(7,$a.BuzzerType))
            $volTrack.Value=$a.BuzzerVolume
            $volPercentLabel.Text=$a.BuzzerVolume.ToString()+'%'
            $buzzerSettingsLabel.Text=($a.Name+' のブザー設定を編集中')
            $highlightBtn.Enabled=$true
        } else {
            $rbAppear.Enabled=$false
            $rbDisappear.Enabled=$false
            $rbAppear.Checked=$true
            UpdateNGHintText 'appear'
            $sensTrack.Enabled=$false
            $ngTrack.Enabled=$false
            $hueModeCheck.Enabled=$false
            $sensTrack.Value=50
            $sensPercentLabel.Text='50%'
            $ngTrack.Value=15
            $ngPercentLabel.Text='15%'
            $hueModeCheck.Checked=$false
            $areaSettingsLabel.Text='（一覧からエリアを選ぶと、そのエリアの検出設定を編集できます）'
            $secBox.Enabled=$false
            $typeCombo.Enabled=$false
            $volTrack.Enabled=$false
            $test.Enabled=$false
            $secBox.Value=2
            $typeCombo.SelectedIndex=0
            $volTrack.Value=80
            $volPercentLabel.Text='80%'
            $buzzerSettingsLabel.Text='（①の一覧からエリアを選ぶと、そのエリアのブザー設定を編集できます）'
            $highlightBtn.Enabled=$false
        }
    } finally {
        $script:suppressEvents=$false
    }
}

$areaList.Add_SelectedIndexChanged({ LoadAreaSettingsIntoSliders; UpdateAreaPreview })
$highlightBtn.Add_Click({
    $idx=$areaList.SelectedIndex
    if($idx -lt 0 -or $idx -ge $script:areas.Count) { return }
    Show-AreaHighlight $script:areas[$idx].Rect
})

$sensTrack.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) { return }
    $script:areas[$idx].Sensitivity=$sensTrack.Value
    $sensPercentLabel.Text=$sensTrack.Value.ToString()+'%'
})
$hueModeCheck.Add_CheckedChanged({
    if($script:suppressEvents) { return }
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) { return }
    $script:areas[$idx].HueMatchMode=$hueModeCheck.Checked
    $msg=$(if($hueModeCheck.Checked){$script:areas[$idx].Name+'：暗い場所向け（色味重視）の検出に切り替えました'}else{$script:areas[$idx].Name+'：通常の検出（明るさも考慮）に戻しました'})
    SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) $msg
})
$measureBtn.Add_Click({ MeasureLiveRatio })
$rbAppear.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbAppear.Checked) { return }
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) { return }
    $script:areas[$idx].Direction='appear'
    UpdateNGHintText 'appear'
    SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ($script:areas[$idx].Name+'：色が「出たら」NGにする設定にしました')
})
$rbDisappear.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbDisappear.Checked) { return }
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) { return }
    $script:areas[$idx].Direction='disappear'
    UpdateNGHintText 'disappear'
    SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ($script:areas[$idx].Name+'：色が「消えたら」NGにする設定にしました')
})
$ngTrack.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) { return }
    $script:areas[$idx].NGThreshold=$ngTrack.Value
    $ngPercentLabel.Text=$ngTrack.Value.ToString()+'%'
    SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ($script:areas[$idx].Name+'の一致率のしきい値を '+$ngTrack.Value+'% に変更しました')
})
$intervalBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $script:monitorIntervalSec=[double]$intervalBox.Value
    if($timer) { $timer.Interval=[int]([math]::Round($script:monitorIntervalSec*1000)) }
    SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ('監視間隔を '+$script:monitorIntervalSec+'秒 に変更しました')
})
$test.Add_Click({
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) {
        SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(60,60,60)) '先に①の一覧からエリアを選んでください。'
        return
    }
    $a=$script:areas[$idx]
    RegenerateSound $a.BuzzerType $a.BuzzerVolume
    if(BuzzStart $a.BuzzerSeconds) {
        SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ($a.Name+'：テスト再生中　｜　'+$buzzerTypeNames[$a.BuzzerType]+' / '+$a.BuzzerVolume+'% / '+$a.BuzzerSeconds+'秒')
    } else {
        SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(150,30,30)) '音を再生できませんでした。音声設定を確認してください。'
    }
})
$typeCombo.Add_SelectedIndexChanged({
    if($script:suppressEvents) { return }
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) { return }
    $script:areas[$idx].BuzzerType=$typeCombo.SelectedIndex
    SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ($script:areas[$idx].Name+'の音の種類を変更：'+$buzzerTypeNames[$typeCombo.SelectedIndex])
})
$volTrack.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $idx=$areaList.SelectedIndex
    if($idx -lt 0) { return }
    $script:areas[$idx].BuzzerVolume=$volTrack.Value
    $volPercentLabel.Text=$volTrack.Value.ToString()+'%'
    SetStatusPanel $colorReady ([System.Drawing.Color]::FromArgb(90,70,0)) ($script:areas[$idx].Name+'の音量を '+$volTrack.Value+'% に変更しました')
})
$stop.Add_Click({
    $script:running=$false
    $script:alarm=$false
    BuzzStop
    Close-OpenNGEpisodes
    SetStatusPanel $colorIdle ([System.Drawing.Color]::FromArgb(60,60,60)) '停止しました'
})
$logEnabledCheck.Add_CheckedChanged({
    $script:loggingEnabled=$logEnabledCheck.Checked
})
$openLogBtn.Add_Click({
    try {
        Write-NGLogHeaderIfNeeded
        Start-Process -FilePath $script:logPath
    } catch {
        [System.Windows.Forms.MessageBox]::Show('ログファイルを開けませんでした。','NG モニター',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    }
})
$start.Add_Click({
    if($script:areas.Count -eq 0) {
        [System.Windows.Forms.MessageBox]::Show('先に「エリアを追加する」を押して、検出したい色の場所を四角く囲んでください。','NG モニター',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
        return
    }
    $script:running=$true
    $script:alarm=$false
    SetStatusPanel $colorRunning ([System.Drawing.Color]::FromArgb(20,90,20)) ($script:areas.Count.ToString()+'箇所を監視中です … ブザー '+$script:buzzerSeconds+' 秒')
})

RegenerateSound

$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=[int]([math]::Round($script:monitorIntervalSec*1000))
$timer.Add_Tick({
    if($script:buzzerProcess) { try { if(-not (Get-Process -Id ([int]$script:buzzerProcess) -ErrorAction SilentlyContinue)) { $script:buzzerProcess=$null; $script:buzzerUntil=$null } } catch {} }
    if($script:buzzerUntil -and (Get-Date) -ge $script:buzzerUntil) { BuzzStop }
    if(-not $script:running -or $script:areas.Count -eq 0){return}
    try {
        $ngAreas=New-Object System.Collections.ArrayList
        $maxRatio=0
        $nowTime=Get-Date
        $nowText=$nowTime.ToString('yyyy-MM-dd HH:mm:ss')
        foreach($a in $script:areas) {
            $bmp=GrabBitmapForArea $a
            $ratio=ColorMatchRatio $bmp $a.Color $a.Sensitivity $a.HueMatchMode
            if($ratio -gt $maxRatio) { $maxRatio=$ratio }
            $isNGNow=$(if($a.Direction -eq 'disappear'){$ratio -lt $a.NGThreshold}else{$ratio -ge $a.NGThreshold})
            if($isNGNow -and -not $a.WasNG) {
                $a.NGSince=$nowTime
                Write-NGLogRow $nowText $a.Name 'NG発生' $ratio $null
            } elseif((-not $isNGNow) -and $a.WasNG) {
                $durationSec=$(if($a.NGSince){($nowTime-$a.NGSince).TotalSeconds}else{$null})
                Write-NGLogRow $nowText $a.Name 'NG解除' $ratio $durationSec
                $a.NGSince=$null
            }
            $a.WasNG=$isNGNow
            if($a.WasNG) { [void]$ngAreas.Add($a) }
        }
        $areaList.Invalidate()
        if($ngAreas.Count -gt 0) {
            $ngNamesText=(($ngAreas | ForEach-Object { $_.Name }) -join '、')
            if(-not $script:alarm) {
                $script:alarm=$true
                $triggerArea=$ngAreas[0]
                RegenerateSound $triggerArea.BuzzerType $triggerArea.BuzzerVolume
                BuzzStart $triggerArea.BuzzerSeconds
                if($script:notifyIcon -and $f.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
                    try {
                        $script:notifyIcon.BalloonTipTitle='NGモニター：検知'
                        $script:notifyIcon.BalloonTipText=($ngNamesText+' でNGを検知しました。ブザーが鳴っています。')
                        $script:notifyIcon.ShowBalloonTip(4000)
                    } catch {}
                }
            }
            SetStatusPanel $colorAlarm ([System.Drawing.Color]::White) ('⚠ NG検知！　｜　'+$ngNamesText+'　｜　ブザー '+$script:buzzerSeconds+'秒')
        } else {
            $script:alarm=$false
            SetStatusPanel $colorRunning ([System.Drawing.Color]::FromArgb(20,90,20)) ($script:areas.Count.ToString()+'箇所を監視中　｜　最大一致度 '+$maxRatio+'%')
        }
    } catch {}
})
$timer.Start()

# エリアプレビュー専用の軽量タイマー（監視スタート前でも位置・映像を確認できるように）
$previewTimer=New-Object System.Windows.Forms.Timer
$previewTimer.Interval=500
$previewTimer.Add_Tick({ UpdateAreaPreview })
$previewTimer.Start()

# ================== タスクトレイ（最小化しても監視を続ける） ==================
$notifyIcon=New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon=[System.Drawing.SystemIcons]::Application
$notifyIcon.Text='NGモニター：待機中'
$notifyIcon.Visible=$true
$script:notifyIcon=$notifyIcon

$trayMenu=New-Object System.Windows.Forms.ContextMenuStrip
$menuOpen=$trayMenu.Items.Add('画面を開く')
$menuStart=$trayMenu.Items.Add('監視スタート')
$menuStop=$trayMenu.Items.Add('停止')
[void]$trayMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$menuExit=$trayMenu.Items.Add('終了（アプリを完全に閉じる）')
$notifyIcon.ContextMenuStrip=$trayMenu

function ShowMainWindow {
    $f.ShowInTaskbar=$true
    $f.Show()
    $f.WindowState=[System.Windows.Forms.FormWindowState]::Normal
    $f.Activate()
}

$menuOpen.Add_Click({ ShowMainWindow })
$notifyIcon.Add_DoubleClick({ ShowMainWindow })
$menuStart.Add_Click({ $start.PerformClick() })
$menuStop.Add_Click({ $stop.PerformClick() })
$menuExit.Add_Click({
    $script:exiting=$true
    $notifyIcon.Visible=$false
    $f.Close()
})

$f.Add_Resize({
    # 最小化してもフォームをHideしない。Windowsのタスクバーに残したまま監視を継続する。
    # 以前のv35はHide()していたため、「最小化したら閉じた」と見える状態になっていた。
    if($f.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
        $f.ShowInTaskbar=$true
        if(-not $script:trayBalloonShown) {
            try {
                $notifyIcon.BalloonTipTitle='NGモニター'
                $notifyIcon.BalloonTipText='最小化しました。監視はそのまま続きます。'
                $notifyIcon.ShowBalloonTip(3000)
            } catch {}
            $script:trayBalloonShown=$true
        }
    } else {
        $f.ShowInTaskbar=$true
        $script:trayBalloonShown=$false
    }
})

$f.Add_FormClosing({
    param($sender,$e)
    if(-not $script:exiting -and $e.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
        $result = [System.Windows.Forms.MessageBox]::Show(
            $f,
            "NGモニターを終了しますか？`r`n`r`n終了すると監視も停止します。",
            '終了の確認',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )
        if($result -eq [System.Windows.Forms.DialogResult]::Yes) {
            $script:exiting=$true
            BuzzStop
            Close-OpenNGEpisodes
            $notifyIcon.Visible=$false
            if($script:monGfx) { $script:monGfx.Dispose() }
            if($script:monBmp) { $script:monBmp.Dispose() }
            foreach($a in $script:areas) { Dispose-MonitorArea $a }
            if($previewTimer) { $previewTimer.Stop() }
            if($areaPreviewBox.Image) { $areaPreviewBox.Image.Dispose() }
        } else {
            $e.Cancel=$true
        }
    } else {
        BuzzStop
        Close-OpenNGEpisodes
        $notifyIcon.Visible=$false
        if($script:monGfx) { $script:monGfx.Dispose() }
        if($script:monBmp) { $script:monBmp.Dispose() }
        foreach($a in $script:areas) { Dispose-MonitorArea $a }
        if($previewTimer) { $previewTimer.Stop() }
        if($areaPreviewBox.Image) { $areaPreviewBox.Image.Dispose() }
    }
})

[System.Windows.Forms.Application]::add_ThreadException({
    param($sender,$e)
    $errText=$e.Exception.ToString()
    try {
        $logPath=Join-Path $PSScriptRoot 'ng_monitor_error.log'
        $ts=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $logPath -Value ("`r`n[$ts] (動作中のエラー・自動で継続)`r`n"+$errText) -Encoding UTF8
    } catch {}
    try {
        [System.Windows.Forms.MessageBox]::Show(
            "動作中に問題が発生しましたが、アプリはそのまま続行します。`r`n（内容は ng_monitor_error.log に記録しました）`r`n`r`n"+$e.Exception.Message,
            'NG モニター - 注意',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
    } catch {}
})

[void]$f.ShowDialog()
$notifyIcon.Dispose()

} catch {
    # 想定外のエラーで終了する場合、黙って落ちるのではなく必ず画面とログに残す
    $errText = $_.Exception.ToString()
    try {
        $logPath = Join-Path $PSScriptRoot 'ng_monitor_error.log'
        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $logPath -Value ("`r`n[$ts]`r`n" + $errText) -Encoding UTF8
    } catch {}
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        [System.Windows.Forms.MessageBox]::Show(
            "NGモニターで予期しないエラーが発生し、終了しました。`r`n`r`n以下のエラー内容を開発者にお伝えください。`r`n（同じ内容は ng_monitor_error.log にも記録されています）`r`n`r`n" + $errText,
            'NG モニター - エラー',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    } catch {
        Write-Host "NGモニターでエラーが発生しました:"
        Write-Host $errText
        Write-Host "続行するには何かキーを押してください..."
        try { [void][System.Console]::ReadKey($true) } catch {}
    }
}
