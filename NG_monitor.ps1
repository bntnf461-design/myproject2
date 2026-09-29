# NG MONITOR - v76 検査精度の改善（かんたん自動調整・連続判定）・画面の使いやすさ改善・不具合修正
# Windows PowerShell 5.1 / Windows 10・11 用
try {
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -AssemblyName System.Drawing -ErrorAction Stop
# 画面部品を1つも作る前に、必ずここで呼ぶ必要がある（後から呼ぶとエラーになる）
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)

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

# 画面の色を読み取って判定する部分（高速化のためC#で書いている）
# ・一致率の計算、スポイトでの色の取得、OK/NGの見本からの自動調整
if (-not ([System.Management.Automation.PSTypeName]'NgVision76').Type) {
Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
// NOTE: Windows PowerShell 5.1 compiles this with the C# 5 compiler.
// Do not use C# 6+ syntax ($"...", =>, out var, ?., nameof).
public static class NgVision76 {
    public const int Step = 2;

    // ---------- Bitmap helpers (Windows only) ----------
    public static byte[] ReadPixels(Bitmap bmp, out int stride, out int bpp) {
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try {
            bpp = 4;
            stride = Math.Abs(data.Stride);
            byte[] buf = new byte[stride * bmp.Height];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);
            return buf;
        } finally {
            bmp.UnlockBits(data);
        }
    }

    public static double Ratio(Bitmap bmp, Color target, double sensitivity, bool hueMode) {
        int stride, bpp;
        byte[] buf = ReadPixels(bmp, out stride, out bpp);
        return RatioBuf(buf, bmp.Width, bmp.Height, stride, bpp, target.R, target.G, target.B, sensitivity, hueMode);
    }

    public static int[] AverageColor(Bitmap bmp) {
        int stride, bpp;
        byte[] buf = ReadPixels(bmp, out stride, out bpp);
        return AverageBuf(buf, bmp.Width, bmp.Height, stride, bpp, 0, 0, bmp.Width, bmp.Height);
    }

    // Average colour of a small square around (cx,cy): used by the colour picker.
    public static int[] AverageColorAt(Bitmap bmp, int cx, int cy, int radius) {
        int stride, bpp;
        byte[] buf = ReadPixels(bmp, out stride, out bpp);
        int x0 = Math.Max(0, cx - radius), y0 = Math.Max(0, cy - radius);
        int x1 = Math.Min(bmp.Width, cx + radius + 1), y1 = Math.Min(bmp.Height, cy + radius + 1);
        return AverageBuf(buf, bmp.Width, bmp.Height, stride, bpp, x0, y0, x1, y1);
    }

    public static double[] AutoTune(Bitmap ok, Bitmap ng, Color current) {
        if (ok.Width != ng.Width || ok.Height != ng.Height) return null;
        int s1, b1, s2, b2;
        byte[] okBuf = ReadPixels(ok, out s1, out b1);
        byte[] ngBuf = ReadPixels(ng, out s2, out b2);
        return AutoTuneBuf(okBuf, ngBuf, ok.Width, ok.Height, s1, b1, current.R, current.G, current.B);
    }

    // ---------- Pure algorithms (testable on any platform) ----------
    public static double RgbThreshold(double sensitivity) { return 20.0 + Clamp(sensitivity, 0, 100) / 100.0 * 130.0; }
    public static double HueThreshold(double sensitivity) { return 8.0 + Clamp(sensitivity, 0, 100) / 100.0 * 52.0; }

    // A target with little saturation (white/grey/black) has no reliable hue,
    // so hue mode silently falls back to RGB distance for it.
    public static bool IsChromatic(int r, int g, int b) {
        double h, s, v;
        RgbToHsv(r, g, b, out h, out s, out v);
        return s >= 0.20 && v >= 0.12;
    }

    // Distance of one pixel from the target, in the unit of the active mode
    // (RGB: Euclidean 0-441, hue: degrees + weighted saturation). Pixels that can
    // never match in hue mode (grey, white, near-black) get a huge distance.
    static double Dist(int r, int g, int b, int tr, int tg, int tb, bool useHue, double th, double ts, double minSat) {
        if (useHue) {
            double ph, ps, pv;
            RgbToHsv(r, g, b, out ph, out ps, out pv);
            if (pv < 0.10 || ps < minSat) return 1e9;
            double hd = Math.Abs(ph - th);
            if (hd > 180) hd = 360 - hd;
            return hd + Math.Abs(ps - ts) * 100.0 * 0.3;
        }
        double dr = r - tr, dg = g - tg, db = b - tb;
        return Math.Sqrt(dr * dr + dg * dg + db * db);
    }

    // Percentage (0-100) of pixels that match the target colour.
    // Each pixel scores 1 inside the tolerance, 0 outside, with a short linear
    // ramp in between so a 1-point slider change never makes the value jump.
    public static double RatioBuf(byte[] buf, int w, int h, int stride, int bpp,
                                  int tr, int tg, int tb, double sensitivity, bool hueMode) {
        bool useHue = hueMode && IsChromatic(tr, tg, tb);
        double th, ts, tv;
        RgbToHsv(tr, tg, tb, out th, out ts, out tv);
        double minSat = Math.Max(0.08, ts * 0.35);
        double thr = useHue ? HueThreshold(sensitivity) : RgbThreshold(sensitivity);
        double ramp = useHue ? 6.0 : 12.0;
        double sum = 0; long total = 0;
        for (int y = 0; y < h; y += Step) {
            int row = y * stride;
            for (int x = 0; x < w; x += Step) {
                int idx = row + x * bpp;
                if (idx + 2 >= buf.Length) continue;
                double dist = Dist(buf[idx + 2], buf[idx + 1], buf[idx], tr, tg, tb, useHue, th, ts, minSat);
                double score = (thr + ramp - dist) / (2.0 * ramp);
                if (score > 1) score = 1; else if (score < 0) score = 0;
                sum += score; total++;
            }
        }
        if (total == 0) return 0;
        return 100.0 * sum / total;
    }

    public static int[] AverageBuf(byte[] buf, int w, int h, int stride, int bpp, int x0, int y0, int x1, int y1) {
        long sr = 0, sg = 0, sb = 0, n = 0;
        for (int y = y0; y < y1; y++) {
            int row = y * stride;
            for (int x = x0; x < x1; x++) {
                int idx = row + x * bpp;
                if (idx + 2 >= buf.Length) continue;
                sb += buf[idx]; sg += buf[idx + 1]; sr += buf[idx + 2]; n++;
            }
        }
        if (n == 0) return new int[] { 0, 0, 0 };
        return new int[] { (int)(sr / n), (int)(sg / n), (int)(sb / n) };
    }

    // Finds the colour / mode / sensitivity that best separates an OK sample from an NG sample.
    // Returns { R, G, B, hueMode(0/1), sensitivity, okRatio, ngRatio, changedPercent,
    //           changedX0, changedY0, changedX1, changedY1 } or null when the two
    // samples are practically identical.
    public static double[] AutoTuneBuf(byte[] okBuf, byte[] ngBuf, int w, int h, int stride, int bpp,
                                       int curR, int curG, int curB) {
        // 1) Which pixels changed between OK and NG?
        double maxDiff = 0;
        for (int y = 0; y < h; y += Step) {
            int row = y * stride;
            for (int x = 0; x < w; x += Step) {
                int i = row + x * bpp;
                if (i + 2 >= okBuf.Length || i + 2 >= ngBuf.Length) continue;
                double d = PixelDiff(okBuf, ngBuf, i);
                if (d > maxDiff) maxDiff = d;
            }
        }
        if (maxDiff < 25) return null;
        double cut = Math.Max(25.0, maxDiff * 0.35);
        var changedIdx = new System.Collections.Generic.List<int>();
        long okR = 0, okG = 0, okB = 0, ngR = 0, ngG = 0, ngB = 0, total = 0;
        int bx0 = w, by0 = h, bx1 = -1, by1 = -1;
        for (int y = 0; y < h; y += Step) {
            int row = y * stride;
            for (int x = 0; x < w; x += Step) {
                int i = row + x * bpp;
                if (i + 2 >= okBuf.Length || i + 2 >= ngBuf.Length) continue;
                total++;
                if (PixelDiff(okBuf, ngBuf, i) < cut) continue;
                changedIdx.Add(i);
                okB += okBuf[i]; okG += okBuf[i + 1]; okR += okBuf[i + 2];
                ngB += ngBuf[i]; ngG += ngBuf[i + 1]; ngR += ngBuf[i + 2];
                if (x < bx0) bx0 = x; if (y < by0) by0 = y;
                if (x > bx1) bx1 = x; if (y > by1) by1 = y;
            }
        }
        int changed = changedIdx.Count;
        if (changed == 0 || total == 0) return null;
        int[][] candidates = new int[][] {
            new int[] { (int)(ngR / changed), (int)(ngG / changed), (int)(ngB / changed) },
            new int[] { (int)(okR / changed), (int)(okG / changed), (int)(okB / changed) },
            new int[] { curR, curG, curB }
        };
        // 2) For each candidate colour and mode, put the colour tolerance half way
        //    between the typical OK pixel and the typical NG pixel (widest safety
        //    margin against lighting / camera gain changes), then keep the best.
        double[] best = null;
        double bestScore = double.MinValue;
        foreach (int[] c in candidates) {
            for (int mode = 0; mode <= 1; mode++) {
                bool hue = mode == 1;
                if (hue && !IsChromatic(c[0], c[1], c[2])) continue;
                double th, ts, tv;
                RgbToHsv(c[0], c[1], c[2], out th, out ts, out tv);
                double minSat = Math.Max(0.08, ts * 0.35);
                double[] dOk = new double[changed], dNg = new double[changed];
                for (int k = 0; k < changed; k++) {
                    int i = changedIdx[k];
                    dOk[k] = Dist(okBuf[i + 2], okBuf[i + 1], okBuf[i], c[0], c[1], c[2], hue, th, ts, minSat);
                    dNg[k] = Dist(ngBuf[i + 2], ngBuf[i + 1], ngBuf[i], c[0], c[1], c[2], hue, th, ts, minSat);
                }
                Array.Sort(dOk); Array.Sort(dNg);
                double mOk = Math.Min(dOk[changed / 2], hue ? 200.0 : 441.0);
                double mNg = Math.Min(dNg[changed / 2], hue ? 200.0 : 441.0);
                double mid = (mOk + mNg) / 2.0;
                double sens = hue ? (mid - 8.0) / 0.52 : (mid - 20.0) / 1.3;
                sens = Math.Round(Clamp(sens, 0, 100));
                double rOk = RatioBuf(okBuf, w, h, stride, bpp, c[0], c[1], c[2], sens, hue);
                double rNg = RatioBuf(ngBuf, w, h, stride, bpp, c[0], c[1], c[2], sens, hue);
                double scale = hue ? 200.0 : 441.0;
                double marginPct = 100.0 * Math.Abs(mOk - mNg) / scale;
                double score = Math.Abs(rNg - rOk) + 0.1 * marginPct;
                if (score > bestScore) {
                    bestScore = score;
                    best = new double[] { c[0], c[1], c[2], mode, sens, rOk, rNg, 100.0 * changed / total,
                                          bx0, by0, Math.Min(w - 1, bx1 + Step - 1), Math.Min(h - 1, by1 + Step - 1) };
                }
            }
        }
        return best;
    }

    static double PixelDiff(byte[] a, byte[] b, int i) {
        double db = a[i] - b[i], dg = a[i + 1] - b[i + 1], dr = a[i + 2] - b[i + 2];
        return Math.Sqrt(dr * dr + dg * dg + db * db);
    }

    static double Clamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

    public static void RgbToHsv(int r, int g, int b, out double h, out double s, out double v) {
        double rn = r / 255.0, gn = g / 255.0, bn = b / 255.0;
        double max = Math.Max(rn, Math.Max(gn, bn));
        double min = Math.Min(rn, Math.Min(gn, bn));
        v = max;
        double delta = max - min;
        s = (max <= 0) ? 0 : (delta / max);
        if (delta <= 0.00001) { h = 0; return; }
        if (max == rn) h = 60.0 * (((gn - bn) / delta) % 6.0);
        else if (max == gn) h = 60.0 * (((bn - rn) / delta) + 2.0);
        else h = 60.0 * (((rn - gn) / delta) + 4.0);
        if (h < 0) h += 360.0;
    }
}

// Is any window of this app (main window, pop-ups, message boxes) actually on
// top of the given screen rectangle? Checks a 3x3 grid of points, so a window
// that merely overlaps but lies *behind* the camera viewer is not counted.
public static class NgWin76 {
    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    static uint myPid = GetCurrentProcessId();

    public static bool CoveredByOwnWindow(int x, int y, int w, int h) {
        for (int i = 0; i <= 2; i++) {
            for (int j = 0; j <= 2; j++) {
                POINT p;
                p.X = x + (Math.Max(1, w) - 1) * i / 2;
                p.Y = y + (Math.Max(1, h) - 1) * j / 2;
                IntPtr hw = WindowFromPoint(p);
                if (hw == IntPtr.Zero) continue;
                IntPtr root = GetAncestor(hw, 2); // GA_ROOT
                if (root == IntPtr.Zero) root = hw;
                uint pid;
                GetWindowThreadProcessId(root, out pid);
                if (pid == myPid) return true;
            }
        }
        return false;
    }
}
'@
}

# ---- 表示倍率（125%・150%など）に合わせて部品の大きさをそろえる ----
$script:uiScale=1.0
try {
    $dpiGfx=[System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
    $script:uiScale=[Math]::Max(1.0,[double]$dpiGfx.DpiX/96.0)
    $dpiGfx.Dispose()
} catch {}
function Px($v) { return [int][Math]::Round([double]$v*$script:uiScale) }
function UIFont([double]$size,[switch]$Bold) {
    $style=$(if($Bold){[System.Drawing.FontStyle]::Bold}else{[System.Drawing.FontStyle]::Regular})
    return (New-Object System.Drawing.Font('Meiryo UI',[single]$size,$style))
}

# ---- 色の定義（状態がひと目でわかるように） ----
$colorIdle      = [System.Drawing.Color]::FromArgb(235,235,235)   # 灰色：まだ何もしていない
$colorReady     = [System.Drawing.Color]::FromArgb(255,244,204)   # 黄色：準備できた
$colorRunning   = [System.Drawing.Color]::FromArgb(214,245,214)   # 緑色：正常に監視中
$colorWarn      = [System.Drawing.Color]::FromArgb(255,196,120)   # 橙色：監視できていないエリアがある
$colorAlarm     = [System.Drawing.Color]::FromArgb(255,76,76)     # 赤色：異常検知！
$colorGreenBtn  = [System.Drawing.Color]::FromArgb(46,160,67)
$colorRedBtn    = [System.Drawing.Color]::FromArgb(200,45,45)
$colorBlueBtn   = [System.Drawing.Color]::FromArgb(0,112,192)
$colorYellowBtn = [System.Drawing.Color]::FromArgb(255,193,7)
$colorGrayBtn   = [System.Drawing.Color]::FromArgb(60,80,102)
$textOnReady    = [System.Drawing.Color]::FromArgb(90,70,0)
$textOnIdle     = [System.Drawing.Color]::FromArgb(60,60,60)
$textOnError    = [System.Drawing.Color]::FromArgb(150,30,30)
$textOnRunning  = [System.Drawing.Color]::FromArgb(20,90,20)
$textOnWarn     = [System.Drawing.Color]::FromArgb(90,40,0)

# ---- ダーク系の背景テーマ ----
$formBgDark    = [System.Drawing.Color]::FromArgb(13,20,32)
$cardBgDark    = [System.Drawing.Color]::FromArgb(22,34,50)
$headerBgDark  = [System.Drawing.Color]::FromArgb(16,24,38)
$accentBlue    = [System.Drawing.Color]::FromArgb(88,166,255)
$textPrimary   = [System.Drawing.Color]::FromArgb(226,232,240)
$textSecondary = [System.Drawing.Color]::FromArgb(148,163,184)
$inputBgDark   = [System.Drawing.Color]::FromArgb(32,46,64)

# ---- 状態 ----
$script:area = $null
$script:running = $false
$script:buzzerUntil = $null
$script:buzzerProcess = $null
$buzzerTypeNames = @('電子音（ピッ、ピッ）','低音（ブー）','サイレン（ピーポー）','高音アラーム（キーン）','警告音（ピポピポ）','断続ブザー（プッ、プッ）','ソフトチャイム（ポーン）','救急車サイレン（速め）')
$script:areas = New-Object System.Collections.ArrayList   # 監視エリアの一覧（New-MonitorArea で作る）
$script:areaCounter = 0   # 「エリアN」の自動採番用
$script:monitorIntervalSec = 0.2   # 画面をチェックする間隔（秒）
$script:exiting = $false
$script:trayBalloonShown = $false
$script:logPath = Join-Path $PSScriptRoot 'ng_monitor_log.csv'
$script:errorLogPath = Join-Path $PSScriptRoot 'ng_monitor_error.log'
$script:windowStatePath = Join-Path $PSScriptRoot 'ng_monitor_window.json'
$script:loggingEnabled = $true
$script:miniMode = $false
$script:eyedropper = $false
$script:lastErrorLogAt = [datetime]::MinValue
$script:lastErrorDialogAt = [datetime]::MinValue
$script:lastStatusText = $null
$script:suppressEvents = $false

# ================== ログ ==================
function Write-ErrorLog($text) {
    try {
        $ts=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $script:errorLogPath -Value ("`r`n[$ts]`r`n"+$text) -Encoding UTF8
    } catch {}
}

function Write-ErrorLogThrottled($text) {
    # 監視中に同じエラーが0.2秒ごとに出てもログが膨れないよう、1分に1回までにする
    if(((Get-Date)-$script:lastErrorLogAt).TotalSeconds -lt 60) { return }
    $script:lastErrorLogAt=Get-Date
    Write-ErrorLog $text
}

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
        $ratioText=$(if($null -ne $ratio){([double]$ratio).ToString([System.Globalization.CultureInfo]::InvariantCulture)}else{''})
        $durationText=$(if($null -ne $durationSec){([math]::Round($durationSec,1)).ToString([System.Globalization.CultureInfo]::InvariantCulture)}else{''})
        $areaNameSafe=([string]$areaName) -replace '"','""'
        $row=('"'+$timestamp+'","'+$areaNameSafe+'","'+$eventType+'","'+$ratioText+'","'+$durationText+'"')
        Add-Content -LiteralPath $script:logPath -Value $row -Encoding UTF8
    } catch {}
}

function Close-OpenNGEpisodes($reason) {
    # 監視停止時などに、記録中のNGが「発生」のまま残らないよう解除ログを残す
    if(-not $reason) { $reason='NG解除（監視停止）' }
    $nowTime=Get-Date
    $nowText=$nowTime.ToString('yyyy-MM-dd HH:mm:ss')
    foreach($a in $script:areas) {
        if($a.WasNG) {
            $durationSec=$(if($a.NGSince){($nowTime-$a.NGSince).TotalSeconds}else{$null})
            Write-NGLogRow $nowText $a.Name $reason $null $durationSec
        }
        Reset-AreaRuntime $a
    }
}

# ================== ブザー ==================
function Get-BuzzerSoundPath($type,$volume) {
    # 種類・音量ごとに別のファイルにする。鳴っている最中のファイルを上書きしようとして
    # 失敗し、別の音（BUZZER.wav）が鳴ってしまう問題を防ぐ。
    $type=[Math]::Max(0,[Math]::Min(7,[int]$type))
    $volume=[Math]::Max(0,[Math]::Min(100,[int]$volume))
    try {
        $path=Join-Path ([System.IO.Path]::GetTempPath()) ('ngmonitor_buzzer_t{0}_v{1}.wav' -f $type,$volume)
        if((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path).Length -gt 1000)) { return $path }
        $bytes=[BuzzGen]::Build($type,([double]$volume/100.0),44100)
        $tmp=$path+'.tmp'
        [IO.File]::WriteAllBytes($tmp,$bytes)
        Move-Item -LiteralPath $tmp -Destination $path -Force
        return $path
    } catch {
        return (Join-Path $PSScriptRoot 'BUZZER.wav')
    }
}

function BuzzStop {
    # 専用の小さなプロセスで鳴らしているので、そのプロセスを止める
    # （System.Media が無いPCでも鳴らせる・鳴りっぱなしを防ぐため）
    try {
        if($script:buzzerProcess) {
            Stop-Process -Id ([int]$script:buzzerProcess) -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    $script:buzzerProcess=$null
    $script:buzzerUntil=$null
}

function BuzzStart($seconds,$type,$volume) {
    BuzzStop
    $soundPath=Get-BuzzerSoundPath $type $volume
    if (-not (Test-Path -LiteralPath $soundPath)) { return $false }
    $worker=Join-Path $PSScriptRoot 'BuzzerWorker.ps1'
    if (-not (Test-Path -LiteralPath $worker)) { return $false }
    try {
        $sec=[Math]::Max(1,[int]$seconds)
        $argList=@('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+$worker+'"'),'-Seconds',$sec,'-SoundPath',('"'+$soundPath+'"'))
        $psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        if (-not (Test-Path -LiteralPath $psExe)) { $psExe='powershell.exe' }
        $proc=Start-Process -FilePath $psExe -ArgumentList $argList -WindowStyle Hidden -PassThru
        $script:buzzerProcess=$proc.Id
        $script:buzzerUntil=(Get-Date).AddSeconds($sec)
        return $true
    } catch {
        $script:buzzerProcess=$null
        $script:buzzerUntil=$null
        return $false
    }
}

function Update-BuzzerState {
    if($script:buzzerProcess) {
        try {
            if(-not (Get-Process -Id ([int]$script:buzzerProcess) -ErrorAction SilentlyContinue)) { $script:buzzerProcess=$null; $script:buzzerUntil=$null }
        } catch {}
    }
    if($script:buzzerUntil -and (Get-Date) -ge $script:buzzerUntil) { BuzzStop }
}

# ================== 監視エリア ==================
function New-MonitorArea($name,$rect,$color) {
    return [PSCustomObject]@{
        Name=$name
        Rect=$rect
        Color=$color
        Direction='appear'
        Sensitivity=50
        NGThreshold=15
        HueMatchMode=$false
        ConfirmFrames=2        # この回数だけ続けてNGになったらNG確定（瞬間的なノイズを無視）
        BuzzerSeconds=2
        BuzzerType=0
        BuzzerVolume=80
        # ---- 以下は動作中だけ使う値（保存しない） ----
        WasNG=$false
        NGSince=$null
        NGStreak=0
        OKStreak=0
        LastRatio=$null
        Occluded=$false
        CaptureFailed=$false
        OkSnap=$null
        NgSnap=$null
        OkRatio=$null
        NgRatio=$null
        TuneText=$null
        TuneColor=$null
        MonBmp=$null
        MonGfx=$null
        MonBmpSize=(New-Object System.Drawing.Size(0,0))
    }
}

function Reset-AreaRuntime($a) {
    $a.WasNG=$false
    $a.NGSince=$null
    $a.NGStreak=0
    $a.OKStreak=0
    $a.Occluded=$false
    $a.CaptureFailed=$false
}

function Clear-AreaSamples($a) {
    try { if($a.OkSnap) { $a.OkSnap.Dispose() } } catch {}
    try { if($a.NgSnap) { $a.NgSnap.Dispose() } } catch {}
    $a.OkSnap=$null; $a.NgSnap=$null
    $a.OkRatio=$null; $a.NgRatio=$null
    $a.TuneText=$null; $a.TuneColor=$null
}

function Update-SampleRatios($a) {
    # 記録したOK/NGの見本を、今の設定で判定したら何%になるか（メーターの▼の位置）
    try {
        $a.OkRatio=$(if($a.OkSnap){Get-AreaRatio $a.OkSnap $a}else{$null})
        $a.NgRatio=$(if($a.NgSnap){Get-AreaRatio $a.NgSnap $a}else{$null})
    } catch { $a.OkRatio=$null; $a.NgRatio=$null }
}

function Reset-AreaWithLog($a,$reason) {
    # 判定の途中経過をリセットする。NG中だった場合は「解除」のログを残す。
    if($a.WasNG) {
        $durationSec=$(if($a.NGSince){((Get-Date)-$a.NGSince).TotalSeconds}else{$null})
        Write-NGLogRow (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $a.Name $reason $null $durationSec
    }
    Reset-AreaRuntime $a
}

function Clear-AreaBuffers($a) {
    try { if($a.MonGfx) { $a.MonGfx.Dispose() } } catch {}
    try { if($a.MonBmp) { $a.MonBmp.Dispose() } } catch {}
    $a.MonGfx=$null; $a.MonBmp=$null
    $a.MonBmpSize=New-Object System.Drawing.Size(0,0)
}

function Dispose-MonitorArea($a) {
    Clear-AreaBuffers $a
    Clear-AreaSamples $a
}

function GrabBitmap($rect) {
    $bmp=New-Object System.Drawing.Bitmap($rect.Width,$rect.Height)
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($rect.Location,[System.Drawing.Point]::Empty,$rect.Size) }
    finally { $g.Dispose() }
    return $bmp
}

# 監視ループ専用：エリアごとにBitmapを使い回してCPU・メモリの負担を減らす
function GrabBitmapForArea($a) {
    $rect=$a.Rect
    if(($null -eq $a.MonBmp) -or ($a.MonBmpSize.Width -ne $rect.Width) -or ($a.MonBmpSize.Height -ne $rect.Height)) {
        Clear-AreaBuffers $a
        $a.MonBmp=New-Object System.Drawing.Bitmap($rect.Width,$rect.Height)
        $a.MonGfx=[System.Drawing.Graphics]::FromImage($a.MonBmp)
        $a.MonBmpSize=$rect.Size
    }
    $a.MonGfx.CopyFromScreen($rect.Location,[System.Drawing.Point]::Empty,$rect.Size)
    return $a.MonBmp
}

function Get-AreaRatio($bmp,$a) {
    return [math]::Round([NgVision76]::Ratio($bmp,$a.Color,[double]$a.Sensitivity,[bool]$a.HueMatchMode),1)
}

function Test-RatioIsNG($a,$ratio) {
    if($null -eq $ratio) { return $false }
    if($a.Direction -eq 'disappear') { return ($ratio -lt $a.NGThreshold) }
    return ($ratio -ge $a.NGThreshold)
}

function Update-AreaJudgement($a,$ratio,$nowTime,$nowText) {
    # 1回の読み取りだけで決めず、
    #  ・しきい値付近で OK/NG がパタパタ切り替わらないよう、解除には少し余裕（ヒステリシス）を持たせる
    #  ・ConfirmFrames 回続けて同じ結果になったら確定する（映像の乱れ・一瞬の映り込みを無視）
    # 新しくNGが確定した時だけ $true を返す。
    $a.LastRatio=$ratio
    $t=[double]$a.NGThreshold
    if($a.Direction -eq 'disappear') {
        $margin=[Math]::Min(3.0,(100.0-$t)*0.25)
        $rawNG=$(if($a.WasNG){$ratio -lt ($t+$margin)}else{$ratio -lt $t})
    } else {
        $margin=[Math]::Min(3.0,$t*0.25)
        $rawNG=$(if($a.WasNG){$ratio -ge ($t-$margin)}else{$ratio -ge $t})
    }
    if($rawNG) { $a.NGStreak=$a.NGStreak+1; $a.OKStreak=0 } else { $a.OKStreak=$a.OKStreak+1; $a.NGStreak=0 }
    $need=[Math]::Max(1,[int]$a.ConfirmFrames)
    if((-not $a.WasNG) -and $a.NGStreak -ge $need) {
        $a.WasNG=$true
        $a.NGSince=$nowTime
        Write-NGLogRow $nowText $a.Name 'NG発生' $ratio $null
        return $true
    }
    if($a.WasNG -and $a.OKStreak -ge $need) {
        $durationSec=$(if($a.NGSince){($nowTime-$a.NGSince).TotalSeconds}else{$null})
        Write-NGLogRow $nowText $a.Name 'NG解除' $ratio $durationSec
        $a.WasNG=$false
        $a.NGSince=$null
    }
    return $false
}

function Test-AreaOccluded($rect) {
    # このアプリ自身の画面（本体・ポップアップ・確認画面）が監視エリアの上に重なっていると、
    # カメラ映像ではなくこのアプリの画面を検査してしまう。重なりを検出する。
    try { return [NgWin76]::CoveredByOwnWindow($rect.X,$rect.Y,$rect.Width,$rect.Height) } catch { return $false }
}

function Test-AreaOnScreen($rect) {
    $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen
    return $vs.Contains($rect)
}

function Capture-AreaUnobstructed($rect) {
    # 本体の画面が重なっている時は、一瞬だけ画面を隠してから撮影する
    $hid=$false
    if($f.Visible -and (Test-AreaOccluded $rect)) {
        $f.Hide()
        $hid=$true
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 250
    }
    try { return (GrabBitmap $rect) }
    finally {
        if($hid) { $f.Show(); $f.Activate() }
    }
}

# ================== 設定の保存・読み込み ==================
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

function Get-CurrentSettingsObject {
    $areaObjs=@()
    foreach($a in $script:areas) {
        $areaObjs += [PSCustomObject]@{
            Name=$a.Name
            X=$a.Rect.X; Y=$a.Rect.Y; W=$a.Rect.Width; H=$a.Rect.Height
            ColorR=$a.Color.R; ColorG=$a.Color.G; ColorB=$a.Color.B
            Sensitivity=$a.Sensitivity; NGThreshold=$a.NGThreshold; HueMatchMode=$a.HueMatchMode
            Direction=$a.Direction
            ConfirmFrames=$a.ConfirmFrames
            BuzzerSeconds=$a.BuzzerSeconds; BuzzerType=$a.BuzzerType; BuzzerVolume=$a.BuzzerVolume
        }
    }
    return [PSCustomObject]@{
        IntervalSec=$script:monitorIntervalSec
        Areas=$areaObjs
    }
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

function Read-SettingsData($path) {
    # 古い形式（名前付きで複数保存する Profiles 形式）も読めるようにしておく
    $raw=Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if($null -eq $raw) { return $null }
    $names=@($raw.PSObject.Properties.Name)
    if($names -contains 'Profiles') {
        $pnames=@($raw.Profiles.PSObject.Properties.Name)
        if($pnames.Count -eq 0) { return $null }
        $name=$(if($raw.LastUsed -and ($pnames -contains $raw.LastUsed)){$raw.LastUsed}else{$pnames[0]})
        return $raw.Profiles.$name
    }
    if(($names -contains 'Areas') -or ($names -contains 'BuzzerSeconds') -or ($names -contains 'AreaSet')) { return $raw }
    return $null
}

function Load-SettingsFile($path) {
    try {
        if([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) { return $false }
        $data=Read-SettingsData $path
        if($null -eq $data) { return $false }
        Apply-SettingsObject $data
        $script:settingsPath=$path
        Remember-LastSettingsPath $path
        return $true
    } catch {
        Write-ErrorLog ('設定ファイルの読み込みに失敗: '+$path+"`r`n"+$_.Exception.ToString())
        return $false
    }
}

function ClampInt($value,$min,$max,$default) {
    if($null -eq $value) { return $default }
    try { return [Math]::Max($min,[Math]::Min($max,[int]$value)) } catch { return $default }
}

function Apply-SettingsObject($data) {
    if($null -eq $data) { return }
    # 先に新しいエリア一覧を全部作ってから入れ替える（途中で失敗しても今の設定が壊れないように）
    $newAreas=New-Object System.Collections.ArrayList
    # 旧バージョン（全エリア共通設定）からの移行用の既定値
    $legacySensitivity=ClampInt $data.Sensitivity 0 100 50
    $legacyNGThreshold=ClampInt $data.NGThreshold 1 100 15
    $legacyHueMode=$(if($null -ne $data.HueMatchMode){[bool]$data.HueMatchMode}else{$false})
    $legacyBuzzerSeconds=ClampInt $data.BuzzerSeconds 1 60 2
    $legacyBuzzerType=ClampInt $data.BuzzerType 0 7 0
    $legacyBuzzerVolume=ClampInt $data.BuzzerVolume 0 100 80

    if($null -ne $data.Areas -and @($data.Areas).Count -gt 0) {
        $n=0
        foreach($ad in @($data.Areas)) {
            $n++
            $rect=New-Object System.Drawing.Rectangle([int]$ad.X,[int]$ad.Y,(ClampInt $ad.W 1 100000 1),(ClampInt $ad.H 1 100000 1))
            $color=[System.Drawing.Color]::FromArgb((ClampInt $ad.ColorR 0 255 0),(ClampInt $ad.ColorG 0 255 0),(ClampInt $ad.ColorB 0 255 0))
            $areaName=$(if($ad.Name){[string]$ad.Name}else{'エリア'+$n})
            $newArea=New-MonitorArea $areaName $rect $color
            $newArea.Sensitivity=ClampInt $ad.Sensitivity 0 100 $legacySensitivity
            $newArea.NGThreshold=ClampInt $ad.NGThreshold 1 100 $legacyNGThreshold
            $newArea.HueMatchMode=$(if($null -ne $ad.HueMatchMode){[bool]$ad.HueMatchMode}else{$legacyHueMode})
            $newArea.Direction=$(if($ad.Direction -eq 'disappear'){'disappear'}else{'appear'})
            $newArea.ConfirmFrames=ClampInt $ad.ConfirmFrames 1 20 2
            $newArea.BuzzerSeconds=ClampInt $ad.BuzzerSeconds 1 60 $legacyBuzzerSeconds
            $newArea.BuzzerType=ClampInt $ad.BuzzerType 0 7 $legacyBuzzerType
            $newArea.BuzzerVolume=ClampInt $ad.BuzzerVolume 0 100 $legacyBuzzerVolume
            [void]$newAreas.Add($newArea)
        }
    } elseif($data.AreaSet -eq $true) {
        # 旧形式（単一エリア）からの移行
        $rect=New-Object System.Drawing.Rectangle([int]$data.AreaX,[int]$data.AreaY,(ClampInt $data.AreaW 1 100000 1),(ClampInt $data.AreaH 1 100000 1))
        $color=[System.Drawing.Color]::FromArgb((ClampInt $data.ColorR 0 255 0),(ClampInt $data.ColorG 0 255 0),(ClampInt $data.ColorB 0 255 0))
        $newArea=New-MonitorArea 'エリア1' $rect $color
        $newArea.Sensitivity=$legacySensitivity
        $newArea.NGThreshold=$legacyNGThreshold
        $newArea.HueMatchMode=$legacyHueMode
        $newArea.BuzzerSeconds=$legacyBuzzerSeconds
        $newArea.BuzzerType=$legacyBuzzerType
        $newArea.BuzzerVolume=$legacyBuzzerVolume
        [void]$newAreas.Add($newArea)
    }

    if($null -ne $data.IntervalSec) {
        try { $script:monitorIntervalSec=[Math]::Max(0.1,[Math]::Min(5.0,[Math]::Round([double]$data.IntervalSec,1))) } catch {}
    }
    Close-OpenNGEpisodes 'NG解除（設定の読み込み）'
    foreach($old in $script:areas) { Dispose-MonitorArea $old }
    $script:areas.Clear()
    foreach($na in $newAreas) { [void]$script:areas.Add($na) }
    $script:areaCounter=$script:areas.Count
}

function LoadLastUsedSettingsIfAny {
    try {
        if(-not (Test-Path -LiteralPath $script:settingsPath)) { return $false }
        $data=Read-SettingsData $script:settingsPath
        if($null -eq $data) { return $false }
        Apply-SettingsObject $data
        return $true
    } catch {
        Write-ErrorLog ('前回の設定の読み込みに失敗: '+$script:settingsPath+"`r`n"+$_.Exception.ToString())
    }
    return $false
}

function Save-WindowState {
    try {
        $b=$(if($script:miniMode -and $script:fullSize){New-Object System.Drawing.Rectangle($f.Left,$f.Top,$script:fullSize.Width,$script:fullSize.Height)}else{$f.Bounds})
        if($f.WindowState -ne [System.Windows.Forms.FormWindowState]::Normal) { $b=$f.RestoreBounds }
        [PSCustomObject]@{ X=$b.X; Y=$b.Y; W=$b.Width; H=$b.Height; Mini=$script:miniMode; TopMost=$f.TopMost } |
            ConvertTo-Json | Set-Content -LiteralPath $script:windowStatePath -Encoding UTF8
    } catch {}
}

function Read-WindowState {
    try {
        if(Test-Path -LiteralPath $script:windowStatePath) {
            return (Get-Content -LiteralPath $script:windowStatePath -Raw -Encoding UTF8 | ConvertFrom-Json)
        }
    } catch {}
    return $null
}

# ================== エリアを選ぶ画面 ==================
function PickArea {
    $script:area=$null
    $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $f.Hide()

    $overlay = New-Object System.Windows.Forms.Form
    $overlay.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $overlay.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $overlay.Location = New-Object System.Drawing.Point($screen.X,$screen.Y)
    $overlay.Size = New-Object System.Drawing.Size($screen.Width,$screen.Height)
    $overlay.TopMost = $true
    $overlay.ShowInTaskbar = $false
    $overlay.BackColor = [System.Drawing.Color]::Black
    $overlay.Opacity = 0.15
    $overlay.Cursor = [System.Windows.Forms.Cursors]::Cross
    $overlay.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
    $overlay.KeyPreview = $true

    $msg = New-Object System.Windows.Forms.Label
    $msg.Text = 'マウスをドラッグして、監視したい部分（例：ランプ）をできるだけ小さく四角く囲んでください　　（キャンセルは ESC キー）'
    $msg.AutoSize = $true
    $msg.BackColor = [System.Drawing.Color]::White
    $msg.ForeColor = [System.Drawing.Color]::Black
    $msg.Font = UIFont 14 -Bold
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
            if ($script:selection.Width -ge 10 -and $script:selection.Height -ge 10) {
                $script:area=New-Object System.Drawing.Rectangle(
                    ($script:selection.X+$screen.X),
                    ($script:selection.Y+$screen.Y),
                    $script:selection.Width,
                    $script:selection.Height)
                $overlay.Close()
            } else {
                # 小さすぎる時は、何も起きないのではなく理由を表示する
                $msg.BackColor=[System.Drawing.Color]::Yellow
                $msg.Text='範囲が小さすぎます。10×10ピクセル以上の大きさで囲んでください　　（キャンセルは ESC キー）'
                $script:selection=New-Object System.Drawing.Rectangle
                $overlay.Invalidate()
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

    try { [void]$overlay.ShowDialog() }
    finally {
        $overlay.Dispose()
        $f.Show()
        $f.Activate()
    }
}

# ================== 小さなダイアログ ==================
function Show-Message($text,$icon,$buttons) {
    if(-not $icon) { $icon=[System.Windows.Forms.MessageBoxIcon]::Information }
    if(-not $buttons) { $buttons=[System.Windows.Forms.MessageBoxButtons]::OK }
    # 本体が「常に手前」でも隠れないよう、必ず本体を親にして表示する
    return [System.Windows.Forms.MessageBox]::Show($f,$text,'NG モニター',$buttons,$icon)
}

function Show-TextInput($title,$prompt,$default) {
    $d=New-Object System.Windows.Forms.Form
    $d.Text=$title
    $d.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::None
    $d.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::FixedDialog
    $d.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterParent
    $d.MaximizeBox=$false; $d.MinimizeBox=$false; $d.ShowInTaskbar=$false
    $d.Font=UIFont 10
    $lbl=New-Object System.Windows.Forms.Label
    $lbl.AutoSize=$true; $lbl.Text=$prompt
    $lbl.Location=New-Object System.Drawing.Point((Px 14),(Px 14))
    $d.Controls.Add($lbl)
    $tb=New-Object System.Windows.Forms.TextBox
    $tb.Text=$default
    $tb.MaxLength=40
    $tb.Location=New-Object System.Drawing.Point((Px 14),(Px 44))
    $tb.Width=Px 300
    $d.Controls.Add($tb)
    $ok=New-Object System.Windows.Forms.Button
    $ok.Text='OK'; $ok.DialogResult=[System.Windows.Forms.DialogResult]::OK
    $ok.Size=New-Object System.Drawing.Size((Px 100),(Px 32))
    $ok.Location=New-Object System.Drawing.Point((Px 104),(Px 84))
    $d.Controls.Add($ok)
    $cancel=New-Object System.Windows.Forms.Button
    $cancel.Text='キャンセル'; $cancel.DialogResult=[System.Windows.Forms.DialogResult]::Cancel
    $cancel.Size=New-Object System.Drawing.Size((Px 100),(Px 32))
    $cancel.Location=New-Object System.Drawing.Point((Px 214),(Px 84))
    $d.Controls.Add($cancel)
    $d.AcceptButton=$ok; $d.CancelButton=$cancel
    $d.ClientSize=New-Object System.Drawing.Size((Px 330),(Px 130))
    $result=$null
    if($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { $result=$tb.Text.Trim() }
    $d.Dispose()
    return $result
}

function Show-AreaHighlight($rect) {
    # 周辺を含めて撮影した画像に、監視範囲の枠を直接描き込んで表示する
    # （画面に別ウィンドウを重ねる方式は環境によって座標がずれたため使わない）
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
        $bmp=Capture-AreaUnobstructed $captureRect

        $g=[System.Drawing.Graphics]::FromImage($bmp)
        $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,255,0),3)
        $g.DrawRectangle($pen,($rect.X-$cx),($rect.Y-$cy),$rect.Width,$rect.Height)
        $pen.Dispose()
        $g.Dispose()

        $dlg=New-Object System.Windows.Forms.Form
        $dlg.Text='監視範囲の位置（黄色い枠の内側）'
        $dlg.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::None
        $dlg.Font=UIFont 9
        $dlg.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::FixedDialog
        $dlg.MaximizeBox=$false
        $dlg.MinimizeBox=$false
        $dlg.ShowInTaskbar=$false
        $dlg.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterScreen
        $dlg.TopMost=$true
        $dlg.BackColor=$cardBgDark

        $picW=[Math]::Min((Px 760),[Math]::Max((Px 260),$cw))
        $picH=[Math]::Min((Px 560),[Math]::Max((Px 200),[int]($ch*($picW/$cw))))
        $pic=New-Object System.Windows.Forms.PictureBox
        $pic.Location=New-Object System.Drawing.Point((Px 15),(Px 15))
        $pic.Size=New-Object System.Drawing.Size($picW,$picH)
        $pic.SizeMode=[System.Windows.Forms.PictureBoxSizeMode]::Zoom
        $pic.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
        $pic.Image=$bmp
        $dlg.Controls.Add($pic)

        $info=New-Object System.Windows.Forms.Label
        $info.AutoSize=$true
        $info.Font=UIFont 8.5
        $info.ForeColor=$textSecondary
        $info.Text=('監視範囲：X='+$rect.X+' Y='+$rect.Y+'　サイズ：'+$rect.Width+'×'+$rect.Height+' px')
        $info.Location=New-Object System.Drawing.Point((Px 15),($pic.Bottom+(Px 10)))
        $dlg.Controls.Add($info)

        $closeBtn=New-Object System.Windows.Forms.Button
        $closeBtn.Text='閉じる'
        $closeBtn.Size=New-Object System.Drawing.Size((Px 110),(Px 32))
        $closeBtn.Location=New-Object System.Drawing.Point(($pic.Right-(Px 110)),($info.Bottom+(Px 10)))
        $closeBtn.Font=UIFont 9 -Bold
        $closeBtn.BackColor=$colorBlueBtn
        $closeBtn.ForeColor=[System.Drawing.Color]::White
        $closeBtn.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
        $closeBtn.FlatAppearance.BorderSize=0
        $closeBtn.DialogResult=[System.Windows.Forms.DialogResult]::OK
        $dlg.Controls.Add($closeBtn)
        $dlg.AcceptButton=$closeBtn
        $dlg.CancelButton=$closeBtn

        $dlg.ClientSize=New-Object System.Drawing.Size(($pic.Right+(Px 15)),($closeBtn.Bottom+(Px 15)))
        [void]$dlg.ShowDialog($f)
        $pic.Image=$null
        $bmp.Dispose()
        $dlg.Dispose()
    } catch {
        Write-ErrorLog ('位置確認の表示に失敗: '+$_.Exception.ToString())
    }
}

# ================== 画面部品を作るための小さな関数 ==================
function Apply-RoundedRegion($ctrl) {
    try {
        $radius=[int]$ctrl.Tag
        $w=$ctrl.Width; $h=$ctrl.Height; $d=$radius*2
        if($w -le $d -or $h -le $d) { return }
        $path=New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0,0,$d,$d,180,90)
        $path.AddArc($w-$d,0,$d,$d,270,90)
        $path.AddArc($w-$d,$h-$d,$d,$d,0,90)
        $path.AddArc(0,$h-$d,$d,$d,90,90)
        $path.CloseFigure()
        $old=$ctrl.Region
        $ctrl.Region=New-Object System.Drawing.Region($path)
        $path.Dispose()
        if($old) { $old.Dispose() }
    } catch {}
}

function Set-RoundedRegion($ctrl,$radius) {
    # 大きさが変わった時（文字の長さ・表示倍率）にも角丸を作り直す
    $ctrl.Tag=(Px $radius)
    Apply-RoundedRegion $ctrl
    $ctrl.Add_SizeChanged({ Apply-RoundedRegion $this })
}

function New-Label($text,[double]$size=9,[switch]$Bold,$color) {
    if($null -eq $color) { $color=$textPrimary }
    $l=New-Object System.Windows.Forms.Label
    $l.AutoSize=$true
    $l.Text=$text
    $l.Font=UIFont $size -Bold:$Bold
    $l.ForeColor=$color
    $l.BackColor=[System.Drawing.Color]::Transparent
    $l.Anchor=[System.Windows.Forms.AnchorStyles]::Left   # 行の中で上下中央にそろえる
    $l.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 3),(Px 3),(Px 3))
    return $l
}

function New-Button($text,$bg,$fg,[double]$size=9,$minW=90,$h=32) {
    if($null -eq $fg) { $fg=[System.Drawing.Color]::White }
    $b=New-Object System.Windows.Forms.Button
    $b.Text=$text
    $b.Font=UIFont $size -Bold
    $b.BackColor=$bg
    $b.ForeColor=$fg
    $b.UseVisualStyleBackColor=$false
    $b.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
    $b.FlatAppearance.BorderSize=0
    $b.AutoSize=$true
    $b.AutoSizeMode=[System.Windows.Forms.AutoSizeMode]::GrowOnly
    $b.MinimumSize=New-Object System.Drawing.Size((Px $minW),(Px $h))
    $b.Padding=New-Object System.Windows.Forms.Padding((Px 8),0,(Px 8),0)
    $b.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 3),(Px 3),(Px 3))
    $b.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    $b.Cursor=[System.Windows.Forms.Cursors]::Hand
    Set-RoundedRegion $b 7
    return $b
}

function New-Row {
    $p=New-Object System.Windows.Forms.FlowLayoutPanel
    $p.FlowDirection=[System.Windows.Forms.FlowDirection]::LeftToRight
    $p.WrapContents=$false
    $p.AutoSize=$true
    $p.AutoSizeMode=[System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $p.Margin=New-Object System.Windows.Forms.Padding(0,(Px 2),0,(Px 2))
    $p.BackColor=[System.Drawing.Color]::Transparent
    return $p
}

function New-Column {
    $p=New-Row
    $p.FlowDirection=[System.Windows.Forms.FlowDirection]::TopDown
    return $p
}

function Add-Controls($parent,[object[]]$controls) {
    foreach($c in $controls) { [void]$parent.Controls.Add($c) }
}

function New-Group($title) {
    $g=New-Object System.Windows.Forms.GroupBox
    $g.Text=$title
    $g.Font=UIFont 9.5 -Bold
    $g.ForeColor=$accentBlue
    $g.BackColor=$cardBgDark
    $g.AutoSize=$true
    $g.AutoSizeMode=[System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $g.MinimumSize=New-Object System.Drawing.Size((Px 750),0)
    $g.Padding=New-Object System.Windows.Forms.Padding((Px 10),(Px 4),(Px 10),(Px 8))
    $g.Margin=New-Object System.Windows.Forms.Padding((Px 10),(Px 5),(Px 10),(Px 5))
    $body=New-Column
    $body.Location=New-Object System.Drawing.Point($g.DisplayRectangle.Left,$g.DisplayRectangle.Top)
    [void]$g.Controls.Add($body)
    return @{ Group=$g; Body=$body }
}

function New-Slider($min,$max,$value,$width) {
    $t=New-Object System.Windows.Forms.TrackBar
    $t.Minimum=$min; $t.Maximum=$max; $t.Value=$value
    $t.TickFrequency=10
    $t.TickStyle=[System.Windows.Forms.TickStyle]::None
    $t.Width=Px $width
    $t.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    $t.BackColor=$cardBgDark
    Stop-WheelChange $t
    return $t
}

function New-Number($min,$max,$value,$decimals,$increment,$width) {
    $n=New-Object System.Windows.Forms.NumericUpDown
    $n.Minimum=$min; $n.Maximum=$max; $n.DecimalPlaces=$decimals; $n.Increment=$increment
    $n.Value=$value
    $n.Width=Px $width
    $n.Font=UIFont 9.5
    $n.TextAlign=[System.Windows.Forms.HorizontalAlignment]::Center
    $n.BackColor=$inputBgDark
    $n.ForeColor=$textPrimary
    $n.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    try { $n.Controls[1].BackColor=$inputBgDark; $n.Controls[1].ForeColor=$textPrimary } catch {}
    Stop-WheelChange $n
    return $n
}

function Stop-WheelChange($ctrl) {
    # 画面をマウスホイールでスクロールしている途中に、たまたまスライダーの上を通って
    # しきい値などが勝手に変わってしまう事故を防ぐ。ホイールは画面のスクロールに使う。
    $ctrl.Add_MouseWheel({
        try { ([System.Windows.Forms.HandledMouseEventArgs]$_).Handled=$true } catch {}
        try {
            $y=-$settingsFlow.AutoScrollPosition.Y-$_.Delta
            $settingsFlow.AutoScrollPosition=New-Object System.Drawing.Point(0,[Math]::Max(0,$y))
        } catch {}
    })
}

# ================== メイン画面 ==================
Resolve-LastSettingsPath
$script:loadedAtStartup = LoadLastUsedSettingsIfAny

$f=New-Object System.Windows.Forms.Form
$f.Text='NG モニター（異常検知ブザー）'
$f.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::None
$f.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterScreen
$f.TopMost=$true
$f.Font=UIFont 9
$f.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::Sizable
$f.BackColor=$formBgDark
$f.ClientSize=New-Object System.Drawing.Size((Px 800),(Px 900))

# --- ヘッダー ---
$header=New-Object System.Windows.Forms.Panel
$header.Dock=[System.Windows.Forms.DockStyle]::Top
$header.Height=Px 50
$header.BackColor=$headerBgDark
$f.Controls.Add($header)

$title=New-Label 'NG モニター' 13 -Bold ([System.Drawing.Color]::White)
$title.Location=New-Object System.Drawing.Point((Px 14),(Px 11))
$header.Controls.Add($title)

$headerButtons=New-Row
$miniBtn=New-Button 'ミニ表示' $colorGrayBtn $null 9 100 34
$loadBtn=New-Button '設定を読み込む' $colorGrayBtn $null 9 120 34
$saveBtn=New-Button '設定を保存' $accentBlue $null 9 110 34
Add-Controls $headerButtons @($miniBtn,$loadBtn,$saveBtn)
$header.Controls.Add($headerButtons)
$header.Add_Layout({
    $ps=$headerButtons.PreferredSize
    $headerButtons.Location=New-Object System.Drawing.Point(($header.ClientSize.Width-$ps.Width-(Px 8)),[Math]::Max(0,[int](($header.ClientSize.Height-$ps.Height)/2)))
})

# --- 開始・停止と状態表示（いつも見える位置に置く） ---
$topBar=New-Object System.Windows.Forms.Panel
$topBar.Dock=[System.Windows.Forms.DockStyle]::Top
$topBar.BackColor=$formBgDark
$f.Controls.Add($topBar)
$topBar.BringToFront()

$start=New-Button '▶  監視スタート' $colorGreenBtn $null 11 100 50
$silence=New-Button '音だけ止める' $colorYellowBtn ([System.Drawing.Color]::FromArgb(60,45,0)) 10 100 50
$stop=New-Button '■  停止' $colorRedBtn $null 11 100 50
foreach($b in @($start,$silence,$stop)) { $b.AutoSize=$false; $topBar.Controls.Add($b) }

$statusPanel=New-Object System.Windows.Forms.Panel
$statusPanel.BackColor=$colorIdle
$topBar.Controls.Add($statusPanel)
$status=New-Object System.Windows.Forms.Label
$status.Dock=[System.Windows.Forms.DockStyle]::Fill
$status.TextAlign=[System.Drawing.ContentAlignment]::MiddleCenter
$status.Font=UIFont 12 -Bold
$status.ForeColor=$textOnIdle
$statusPanel.Controls.Add($status)
Set-RoundedRegion $statusPanel 10

$topBar.Height=(Px 8)+(Px 50)+(Px 8)+(Px 70)+(Px 8)
$topBar.Add_Layout({
    $w=$topBar.ClientSize.Width-(Px 24)
    $gap=Px 8
    $sw=[int]($w*0.24)
    $bw=[int](($w-$sw-2*$gap)/2)
    $start.SetBounds((Px 12),(Px 8),$bw,(Px 50))
    $silence.SetBounds(($start.Right+$gap),(Px 8),$sw,(Px 50))
    $stop.SetBounds(($silence.Right+$gap),(Px 8),($w-$bw-$sw-2*$gap),(Px 50))
    $statusPanel.SetBounds((Px 12),($start.Bottom+(Px 8)),$w,(Px 70))
})

# --- 設定（スクロールできる） ---
$settingsFlow=New-Object System.Windows.Forms.FlowLayoutPanel
$settingsFlow.Dock=[System.Windows.Forms.DockStyle]::Fill
$settingsFlow.FlowDirection=[System.Windows.Forms.FlowDirection]::TopDown
$settingsFlow.WrapContents=$false
$settingsFlow.AutoScroll=$true
$settingsFlow.BackColor=$formBgDark
$settingsFlow.Padding=New-Object System.Windows.Forms.Padding(0,0,0,(Px 10))
$f.Controls.Add($settingsFlow)
$settingsFlow.BringToFront()   # Fill の部品は最後に配置する（上の2つの下の残り全部を使う）

# ---------- ① 監視エリア ----------
$g1=New-Group '① 監視エリア（カメラ映像の中で、見張りたい部分）'
$settingsFlow.Controls.Add($g1.Group)

$row=New-Row
$pick=New-Button '＋ エリアを追加' $colorBlueBtn $null 9.5 150 36
$repickBtn=New-Button '範囲を選び直す' $colorGrayBtn $null 9 110 36
$renameBtn=New-Button '名前を変更' $colorGrayBtn $null 9 100 36
$deleteAreaBtn=New-Button '削除' ([System.Drawing.Color]::FromArgb(120,50,50)) $null 9 80 36
$areaCountLabel=New-Label 'まだエリアがありません' 9 -Bold $textSecondary
Add-Controls $row @($pick,$repickBtn,$renameBtn,$deleteAreaBtn,$areaCountLabel)
$g1.Body.Controls.Add($row)

$pickHint=New-Label '「＋ エリアを追加」を押し、ランプなど見張りたい部分だけをドラッグで小さく囲みます。複数のカメラ・場所を追加できます。' 8.5 -color $textSecondary
$pickHint.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$g1.Body.Controls.Add($pickHint)

$areaList=New-Object System.Windows.Forms.ListBox
$areaList.DrawMode=[System.Windows.Forms.DrawMode]::OwnerDrawFixed
$areaList.ItemHeight=Px 30
$areaList.IntegralHeight=$false
$areaList.Size=New-Object System.Drawing.Size((Px 720),((Px 30)*4+(Px 4)))
$areaList.BackColor=$inputBgDark
$areaList.ForeColor=$textPrimary
$areaList.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
$areaList.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 4),(Px 3),(Px 3))
$g1.Body.Controls.Add($areaList)

# ---------- ② 検出の設定 ----------
$g2=New-Group '② 検出の設定'
$settingsFlow.Controls.Add($g2.Group)

$areaSettingsLabel=New-Label '（①の一覧からエリアを選ぶと、ここで設定できます）' 9.5 -Bold $accentBlue
$g2.Body.Controls.Add($areaSettingsLabel)

$previewRow=New-Row
$areaPreviewBox=New-Object System.Windows.Forms.PictureBox
$areaPreviewBox.Size=New-Object System.Drawing.Size((Px 200),(Px 150))
$areaPreviewBox.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
$areaPreviewBox.BackColor=$inputBgDark
$areaPreviewBox.SizeMode=[System.Windows.Forms.PictureBoxSizeMode]::Zoom
$areaPreviewBox.Margin=New-Object System.Windows.Forms.Padding((Px 3))
$previewCol=New-Column
$areaPreviewInfoLabel=New-Label '一覧でエリアを選ぶと、左に今の映像が表示されます' 8.5 -color $textSecondary
$areaPreviewInfoLabel.MaximumSize=New-Object System.Drawing.Size((Px 500),0)
$colorLabel=New-Label '検出する色：－' 9 -Bold
$colorLabel.Anchor=[System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Top
$previewBtnRow=New-Row
$highlightBtn=New-Button '画面で位置を確認' $colorGrayBtn $null 8.5 120 30
$eyedropBtn=New-Button 'スポイトで色を選ぶ' $colorGrayBtn $null 8.5 120 30
Add-Controls $previewBtnRow @($highlightBtn,$eyedropBtn)
Add-Controls $previewCol @($areaPreviewInfoLabel,$colorLabel,$previewBtnRow)
Add-Controls $previewRow @($areaPreviewBox,$previewCol)
$g2.Body.Controls.Add($previewRow)

# かんたん自動調整
$tuneTitle=New-Label '★ かんたん自動調整（おすすめ）' 10 -Bold ([System.Drawing.Color]::FromArgb(255,210,90))
$tuneTitle.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 10),(Px 3),(Px 1))
$g2.Body.Controls.Add($tuneTitle)
$tuneHint=New-Label '画面に「正常」が映っている時に①を、「異常」が映っている時に②を押すだけで、色・感度・しきい値・検知の条件を自動で決めます。' 8.5 -color $textSecondary
$tuneHint.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$g2.Body.Controls.Add($tuneHint)
$tuneRow=New-Row
$recordOkBtn=New-Button '① 正常（OK）の状態を記録' $colorGreenBtn $null 9.5 200 36
$recordNgBtn=New-Button '② 異常（NG）の状態を記録' $colorRedBtn $null 9.5 200 36
Add-Controls $tuneRow @($recordOkBtn,$recordNgBtn)
$g2.Body.Controls.Add($tuneRow)
$tuneResultLabel=New-Label '' 9 -color $textPrimary
$tuneResultLabel.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$g2.Body.Controls.Add($tuneResultLabel)

# 今の一致率メーター
$meterTitle=New-Label '今の一致率（黄色い線＝しきい値、緑▼＝記録したOK、赤▼＝記録したNG）' 9 -Bold
$meterTitle.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 10),(Px 3),(Px 1))
$g2.Body.Controls.Add($meterTitle)
$meterRow=New-Row
$meterBox=New-Object System.Windows.Forms.PictureBox
$meterBox.Size=New-Object System.Drawing.Size((Px 460),(Px 34))
$meterBox.BackColor=$inputBgDark
$meterBox.Anchor=[System.Windows.Forms.AnchorStyles]::Left
$meterBox.Margin=New-Object System.Windows.Forms.Padding((Px 3))
$meterValueLabel=New-Label '－' 11 -Bold
Add-Controls $meterRow @($meterBox,$meterValueLabel)
$g2.Body.Controls.Add($meterRow)

# 手動で調整
$manualTitle=New-Label '手動で調整する（自動調整の結果を微調整したい場合）' 9 -Bold $accentBlue
$manualTitle.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 12),(Px 3),(Px 1))
$g2.Body.Controls.Add($manualTitle)

$dirRow=New-Row
$directionLabel=New-Label '検知の条件：'
$rbAppear=New-Object System.Windows.Forms.RadioButton
$rbAppear.Text='色が出たらNG（点灯・混入検知）'
$rbDisappear=New-Object System.Windows.Forms.RadioButton
$rbDisappear.Text='色が消えたらNG（部品なし検知）'
foreach($rb in @($rbAppear,$rbDisappear)) {
    $rb.AutoSize=$true; $rb.Font=UIFont 9; $rb.ForeColor=$textPrimary; $rb.Enabled=$false
    $rb.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    $rb.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 3),(Px 12),(Px 3))
}
$rbAppear.Checked=$true
Add-Controls $dirRow @($directionLabel,$rbAppear,$rbDisappear)
$g2.Body.Controls.Add($dirRow)

$sensRow=New-Row
$sensLabel=New-Label '検出の感度：'
$sensTrack=New-Slider 0 100 50 260
$sensTrack.Enabled=$false
$sensPercentLabel=New-Label '50' 9.5 -Bold
Add-Controls $sensRow @($sensLabel,$sensTrack,$sensPercentLabel)
$g2.Body.Controls.Add($sensRow)
$sensHint=New-Label '感度を上げる → 少し違う色も「一致」とみなす（一致率が上がる）／ 下げる → ほぼ同じ色だけを「一致」とみなす' 8 -color $textSecondary
$sensHint.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$g2.Body.Controls.Add($sensHint)

$hueModeCheck=New-Object System.Windows.Forms.CheckBox
$hueModeCheck.Text='明るさの変化に強くする（色味で判定。白・灰色・黒は一致とみなさない）'
$hueModeCheck.AutoSize=$true; $hueModeCheck.Font=UIFont 9; $hueModeCheck.ForeColor=$textPrimary; $hueModeCheck.Enabled=$false
$hueModeCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 4),(Px 3),(Px 4))
$g2.Body.Controls.Add($hueModeCheck)

$ngRow=New-Row
$ngLabel=New-Label '一致率のしきい値：'
$ngTrack=New-Slider 1 100 15 260
$ngTrack.Enabled=$false
$ngPercentLabel=New-Label '15%' 9.5 -Bold
Add-Controls $ngRow @($ngLabel,$ngTrack,$ngPercentLabel)
$g2.Body.Controls.Add($ngRow)
$ngHint=New-Label '一致率がこの値以上でNG判定（色が出た時）' 8 -color $textSecondary
$g2.Body.Controls.Add($ngHint)

$confirmRow=New-Row
$confirmLabel=New-Label 'NGと判定するまでの回数：'
$confirmBox=New-Number 1 20 2 0 1 70
$confirmBox.Enabled=$false
$confirmUnit=New-Label '回続けてNGならNG確定（一瞬の映像の乱れ・人の横切りを無視）' 8.5 -color $textSecondary
Add-Controls $confirmRow @($confirmLabel,$confirmBox,$confirmUnit)
$g2.Body.Controls.Add($confirmRow)

# ---------- ③ ブザー ----------
$g3=New-Group '③ ブザー（エリアごとに設定）'
$settingsFlow.Controls.Add($g3.Group)
$buzzRow1=New-Row
$secLabel=New-Label '長さ：'
$secBox=New-Number 1 60 2 0 1 70
$secBox.Enabled=$false
$secUnitLabel=New-Label '秒　　音の種類：'
$typeCombo=New-Object System.Windows.Forms.ComboBox
$typeCombo.DropDownStyle=[System.Windows.Forms.ComboBoxStyle]::DropDownList
$typeCombo.Font=UIFont 9
$typeCombo.BackColor=$inputBgDark
$typeCombo.ForeColor=$textPrimary
$typeCombo.Enabled=$false
$typeCombo.Width=Px 230
$typeCombo.Anchor=[System.Windows.Forms.AnchorStyles]::Left
[void]$typeCombo.Items.AddRange($buzzerTypeNames)
$typeCombo.SelectedIndex=0
Add-Controls $buzzRow1 @($secLabel,$secBox,$secUnitLabel,$typeCombo)
$g3.Body.Controls.Add($buzzRow1)
$buzzRow2=New-Row
$volLabel=New-Label '音量：'
$volTrack=New-Slider 0 100 80 200
$volTrack.Enabled=$false
$volPercentLabel=New-Label '80%' 9.5 -Bold
$test=New-Button '音を試す' $colorYellowBtn ([System.Drawing.Color]::FromArgb(60,45,0)) 9 110 32
$test.Enabled=$false
Add-Controls $buzzRow2 @($volLabel,$volTrack,$volPercentLabel,$test)
$g3.Body.Controls.Add($buzzRow2)

# ---------- ④ その他 ----------
$g4=New-Group '④ その他'
$settingsFlow.Controls.Add($g4.Group)
$intervalRow=New-Row
$intervalLabel=New-Label '監視の間隔：'
$intervalBox=New-Number 0.1 5.0 ([decimal]$script:monitorIntervalSec) 1 0.1 70
$intervalUnitLabel=New-Label '秒ごとにチェック（短いほど検知は速く、PCの負荷は上がります）' 8.5 -color $textSecondary
Add-Controls $intervalRow @($intervalLabel,$intervalBox,$intervalUnitLabel)
$g4.Body.Controls.Add($intervalRow)
$logRow=New-Row
$logEnabledCheck=New-Object System.Windows.Forms.CheckBox
$logEnabledCheck.Text='NGログを記録する（発生・解除の日時をCSVに残す）'
$logEnabledCheck.AutoSize=$true; $logEnabledCheck.Font=UIFont 9; $logEnabledCheck.ForeColor=$textPrimary
$logEnabledCheck.Checked=$script:loggingEnabled
$logEnabledCheck.Anchor=[System.Windows.Forms.AnchorStyles]::Left
$openLogBtn=New-Button 'ログを開く' $colorGrayBtn $null 8.5 100 30
Add-Controls $logRow @($logEnabledCheck,$openLogBtn)
$g4.Body.Controls.Add($logRow)
$topMostCheck=New-Object System.Windows.Forms.CheckBox
$topMostCheck.Text='この画面を常に手前に表示する'
$topMostCheck.AutoSize=$true; $topMostCheck.Font=UIFont 9; $topMostCheck.ForeColor=$textPrimary
$topMostCheck.Checked=$true
$topMostCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 4),(Px 3),(Px 4))
$g4.Body.Controls.Add($topMostCheck)

# ---- 起動時の大きさ・位置（前回の位置を覚えておく） ----
$f.MinimumSize=New-Object System.Drawing.Size((Px 600),(Px 150))
$contentH=0
foreach($g in @($g1.Group,$g2.Group,$g3.Group,$g4.Group)) { $contentH+=$g.PreferredSize.Height+$g.Margin.Vertical }
if($contentH -lt (Px 300)) { $contentH=Px 1000 }   # 念のため：大きさを計算できなかった時
$wa=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$wantH=$header.Height+$topBar.Height+$contentH+(Px 20)
$f.ClientSize=New-Object System.Drawing.Size((Px 800),[Math]::Min($wantH,$wa.Height-(Px 60)))
$script:fullSize=$f.Size
$savedWindow=Read-WindowState
if($savedWindow) {
    try {
        $r=New-Object System.Drawing.Rectangle([int]$savedWindow.X,[int]$savedWindow.Y,[int]$savedWindow.W,[int]$savedWindow.H)
        if([System.Windows.Forms.SystemInformation]::VirtualScreen.IntersectsWith($r) -and $r.Width -ge $f.MinimumSize.Width -and $r.Height -ge $f.MinimumSize.Height) {
            $f.StartPosition=[System.Windows.Forms.FormStartPosition]::Manual
            $f.Bounds=$r
            $script:fullSize=$f.Size
        }
        if($null -ne $savedWindow.TopMost) { $topMostCheck.Checked=[bool]$savedWindow.TopMost; $f.TopMost=[bool]$savedWindow.TopMost }
    } catch {}
}

# ================== 画面を更新する関数 ==================
function SetStatusPanel($bg,$fg,$text) {
    # 同じ内容なら書き換えない（0.2秒ごとの書き換えによるちらつき防止）
    $key=[string]$bg.ToArgb()+'|'+$text
    if($script:lastStatusText -eq $key) { return }
    $script:lastStatusText=$key
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

function Get-SelectedArea {
    $idx=$areaList.SelectedIndex
    if($idx -ge 0 -and $idx -lt $script:areas.Count) { return $script:areas[$idx] }
    return $null
}

function RefreshAreaListUI {
    $sel=$areaList.SelectedIndex
    $script:suppressEvents=$true
    try {
        $areaList.Items.Clear()
        foreach($a in $script:areas) { [void]$areaList.Items.Add($a.Name) }
        if($sel -ge $script:areas.Count) { $sel=$script:areas.Count-1 }
        if($sel -lt 0 -and $script:areas.Count -gt 0) { $sel=0 }
        $areaList.SelectedIndex=$sel
    } finally { $script:suppressEvents=$false }
    if($script:areas.Count -gt 0) {
        $areaCountLabel.Text=$script:areas.Count.ToString()+'個のエリア'
        $areaCountLabel.ForeColor=$colorGreenBtn
    } else {
        $areaCountLabel.Text='まだエリアがありません'
        $areaCountLabel.ForeColor=$textSecondary
    }
    $hasSel=($areaList.SelectedIndex -ge 0)
    $repickBtn.Enabled=$hasSel; $renameBtn.Enabled=$hasSel; $deleteAreaBtn.Enabled=$hasSel
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $areaList.Invalidate()
}

function UpdateNGHintText($direction) {
    if($direction -eq 'disappear') {
        $ngHint.Text='一致率がこの値を下回ったらNG判定（色が消えた時）'
    } else {
        $ngHint.Text='一致率がこの値以上でNG判定（色が出た時）'
    }
}

function Update-ColorLabel($a) {
    if($a) {
        $colorLabel.Text=('検出する色：■ R'+$a.Color.R+' G'+$a.Color.G+' B'+$a.Color.B)
        $colorLabel.ForeColor=$(if($a.Color.GetBrightness() -lt 0.15){$textPrimary}else{$a.Color})
    } else {
        $colorLabel.Text='検出する色：－'
        $colorLabel.ForeColor=$textPrimary
    }
}

function Update-TuneLabel($a) {
    if(-not $a) { $tuneResultLabel.Text=''; return }
    if($a.TuneText) {
        $tuneResultLabel.ForeColor=$a.TuneColor
        $tuneResultLabel.Text=$a.TuneText
    } elseif($a.OkSnap -and -not $a.NgSnap) {
        $tuneResultLabel.ForeColor=$textPrimary
        $tuneResultLabel.Text='正常（OK）の状態を記録しました。次に、画面に異常（NG）の状態を出してから「② 異常（NG）の状態を記録」を押してください。'
    } elseif($a.NgSnap -and -not $a.OkSnap) {
        $tuneResultLabel.ForeColor=$textPrimary
        $tuneResultLabel.Text='異常（NG）の状態を記録しました。次に、画面に正常（OK）の状態を出してから「① 正常（OK）の状態を記録」を押してください。'
    } else {
        $tuneResultLabel.ForeColor=$textSecondary
        $tuneResultLabel.Text='（まだ記録していません）'
    }
}

function LoadAreaSettingsIntoSliders {
    $a=Get-SelectedArea
    $script:suppressEvents=$true
    try {
        $en=($null -ne $a)
        foreach($c in @($rbAppear,$rbDisappear,$sensTrack,$ngTrack,$hueModeCheck,$confirmBox,$secBox,$typeCombo,$volTrack,$test,$highlightBtn,$eyedropBtn,$recordOkBtn,$recordNgBtn)) { $c.Enabled=$en }
        if($en) {
            if($a.Direction -eq 'disappear') { $rbDisappear.Checked=$true } else { $rbAppear.Checked=$true }
            UpdateNGHintText $a.Direction
            $sensTrack.Value=$a.Sensitivity
            $sensPercentLabel.Text=$a.Sensitivity.ToString()
            $ngTrack.Value=$a.NGThreshold
            $ngPercentLabel.Text=$a.NGThreshold.ToString()+'%'
            $hueModeCheck.Checked=$a.HueMatchMode
            $confirmBox.Value=[decimal]$a.ConfirmFrames
            $g2.Group.Text=('② 検出の設定：'+$a.Name)
            $g3.Group.Text=('③ ブザー：'+$a.Name)
            $areaSettingsLabel.Text=($a.Name+' の設定を編集中')
            $secBox.Value=[decimal]$a.BuzzerSeconds
            $typeCombo.SelectedIndex=[Math]::Max(0,[Math]::Min(7,$a.BuzzerType))
            $volTrack.Value=$a.BuzzerVolume
            $volPercentLabel.Text=$a.BuzzerVolume.ToString()+'%'
        } else {
            $rbAppear.Checked=$true
            UpdateNGHintText 'appear'
            $sensTrack.Value=50; $sensPercentLabel.Text='50'
            $ngTrack.Value=15; $ngPercentLabel.Text='15%'
            $hueModeCheck.Checked=$false
            $confirmBox.Value=2
            $g2.Group.Text='② 検出の設定'
            $g3.Group.Text='③ ブザー（エリアごとに設定）'
            $areaSettingsLabel.Text='（①の一覧からエリアを選ぶと、ここで設定できます）'
            $secBox.Value=2
            $typeCombo.SelectedIndex=0
            $volTrack.Value=80; $volPercentLabel.Text='80%'
        }
        Update-ColorLabel $a
        Update-TuneLabel $a
        Set-Eyedropper $false
    } finally {
        $script:suppressEvents=$false
    }
}

function Update-MeterLabel {
    $a=Get-SelectedArea
    if(-not $a) { $meterValueLabel.Text='－'; $meterValueLabel.ForeColor=$textPrimary; return }
    if($a.Occluded -or ($null -eq $a.LastRatio)) {
        $meterValueLabel.Text='－'
        $meterValueLabel.ForeColor=$textSecondary
        return
    }
    $isNG=Test-RatioIsNG $a $a.LastRatio
    $meterValueLabel.Text=($a.LastRatio.ToString('0.0')+'%　→ '+$(if($isNG){'NG'}else{'OK'}))
    $meterValueLabel.ForeColor=$(if($isNG){[System.Drawing.Color]::FromArgb(255,120,120)}else{[System.Drawing.Color]::FromArgb(140,220,150)})
}

function Update-LiveRatioFromPreview {
    # 設定を変えた直後に、今のプレビュー画像で一致率を計算し直す（新しく撮影はしない）
    $a=Get-SelectedArea
    if(-not $a -or $script:running) { return }
    try {
        if($areaPreviewBox.Image -and -not (Test-AreaOccluded $a.Rect)) { $a.LastRatio=Get-AreaRatio ([System.Drawing.Bitmap]$areaPreviewBox.Image) $a }
    } catch {}
    Update-MeterLabel
    $meterBox.Invalidate()
    $areaList.Invalidate()
}

function UpdateAreaPreview {
    $a=Get-SelectedArea
    if(-not $a) {
        if($areaPreviewBox.Image) { $old=$areaPreviewBox.Image; $areaPreviewBox.Image=$null; $old.Dispose() }
        $areaPreviewInfoLabel.Text='一覧でエリアを選ぶと、左に今の映像が表示されます'
        Update-MeterLabel
        $meterBox.Invalidate()
        return
    }
    $info=($a.Name+'　位置 X='+$a.Rect.X+' Y='+$a.Rect.Y+'　大きさ '+$a.Rect.Width+'×'+$a.Rect.Height)
    try {
        $bmp=GrabBitmap $a.Rect
        $old=$areaPreviewBox.Image
        $areaPreviewBox.Image=$bmp
        if($old) { $old.Dispose() }
        $hidden=Test-AreaOccluded $a.Rect
        if(-not $script:running) {
            $a.Occluded=$hidden
            $a.LastRatio=$(if($hidden){$null}else{Get-AreaRatio $bmp $a})
        }
        if(-not (Test-AreaOnScreen $a.Rect)) {
            $info+="`r`n⚠ 画面の外にはみ出しています。「範囲を選び直す」で選び直してください。"
        } elseif($hidden) {
            $info+="`r`n⚠ この画面の下に隠れています。この画面を動かすか「ミニ表示」にしてください。"
        }
    } catch {
        $info+="`r`n⚠ この範囲の画面を読み取れません。"
    }
    if($script:eyedropper) { $info+="`r`n→ 左の映像の中で、検出したい色の場所をクリックしてください" }
    $areaPreviewInfoLabel.Text=$info
    Update-MeterLabel
    $meterBox.Invalidate()
}

function Set-Eyedropper($on) {
    $script:eyedropper=[bool]$on
    if($script:eyedropper) {
        $eyedropBtn.Text='スポイトをやめる'
        $areaPreviewBox.Cursor=[System.Windows.Forms.Cursors]::Cross
    } else {
        $eyedropBtn.Text='スポイトで色を選ぶ'
        $areaPreviewBox.Cursor=[System.Windows.Forms.Cursors]::Default
    }
}

function Set-MiniMode($on) {
    if($on -eq $script:miniMode) { return }
    if($on) {
        if($f.WindowState -eq [System.Windows.Forms.FormWindowState]::Normal) { $script:fullSize=$f.Size }
        $script:miniMode=$true
        Set-Eyedropper $false
        $settingsFlow.Visible=$false
        $f.ClientSize=New-Object System.Drawing.Size($f.ClientSize.Width,($header.Height+$topBar.Height))
        $miniBtn.Text='詳細表示'
    } else {
        $script:miniMode=$false
        $settingsFlow.Visible=$true
        if($script:fullSize) { $f.Size=$script:fullSize }
        $miniBtn.Text='ミニ表示'
        UpdateAreaPreview
    }
}

function Update-RunButtons {
    $start.Enabled=-not $script:running
    $start.Text=$(if($script:running){'監視中…'}else{'▶  監視スタート'})
    $start.BackColor=$(if($script:running){[System.Drawing.Color]::FromArgb(40,90,50)}else{$colorGreenBtn})
    $stop.Enabled=$script:running -or ($null -ne $script:buzzerProcess)
    $silence.Enabled=($null -ne $script:buzzerProcess)
}

function Stop-Monitoring($reasonText) {
    $script:running=$false
    BuzzStop
    Close-OpenNGEpisodes
    Update-RunButtons
    $areaList.Invalidate()
    if($reasonText) { SetStatusPanel $colorIdle $textOnIdle $reasonText }
}

function Invoke-AutoTune($a) {
    $res=[NgVision76]::AutoTune($a.OkSnap,$a.NgSnap,$a.Color)
    if($null -eq $res) {
        Update-SampleRatios $a
        $a.TuneColor=[System.Drawing.Color]::FromArgb(255,150,150)
        $a.TuneText='OKとNGの映像にほとんど違いがありませんでした。NGの状態がきちんと画面に映っている時に「② 異常（NG）の状態を記録」を押し直してください。'
        Update-TuneLabel $a
        $meterBox.Invalidate()
        return
    }
    # 変化した部分が監視範囲の一部だけなら、そこだけに絞り込むと背景の影響が消えて安定する
    $bx0=[int]$res[8]; $by0=[int]$res[9]; $bx1=[int]$res[10]; $by1=[int]$res[11]
    $bw=$bx1-$bx0+1; $bh=$by1-$by0+1
    $fullArea=[double]$a.Rect.Width*$a.Rect.Height
    $tightened=$false
    if(($bw*$bh) -lt ($fullArea*0.6)) {
        $ans=Show-Message ("変化があったのは、監視範囲の一部分だけでした。`r`n`r`n監視範囲を、変化した部分（＋少しの余白）だけに絞り込みますか？`r`n背景の影響を受けなくなり、判定がより安定します。（おすすめ：はい）") ([System.Windows.Forms.MessageBoxIcon]::Question) ([System.Windows.Forms.MessageBoxButtons]::YesNo)
        if($ans -eq [System.Windows.Forms.DialogResult]::Yes) {
            $mx=[Math]::Max(4,[int]($bw*0.2)); $my=[Math]::Max(4,[int]($bh*0.2))
            $cx0=[Math]::Max(0,$bx0-$mx); $cy0=[Math]::Max(0,$by0-$my)
            $cx1=[Math]::Min($a.Rect.Width-1,$bx1+$mx); $cy1=[Math]::Min($a.Rect.Height-1,$by1+$my)
            $crop=New-Object System.Drawing.Rectangle($cx0,$cy0,($cx1-$cx0+1),($cy1-$cy0+1))
            $okCrop=$a.OkSnap.Clone($crop,$a.OkSnap.PixelFormat)
            $ngCrop=$a.NgSnap.Clone($crop,$a.NgSnap.PixelFormat)
            $a.OkSnap.Dispose(); $a.NgSnap.Dispose()
            $a.OkSnap=$okCrop; $a.NgSnap=$ngCrop
            $a.Rect=New-Object System.Drawing.Rectangle(($a.Rect.X+$cx0),($a.Rect.Y+$cy0),$crop.Width,$crop.Height)
            Clear-AreaBuffers $a
            $res2=[NgVision76]::AutoTune($a.OkSnap,$a.NgSnap,$a.Color)
            if($null -ne $res2) { $res=$res2 }
            $tightened=$true
        }
    }
    $a.Color=[System.Drawing.Color]::FromArgb([int]$res[0],[int]$res[1],[int]$res[2])
    $a.HueMatchMode=([int]$res[3] -eq 1)
    $a.Sensitivity=[int]$res[4]
    $rOk=[math]::Round($res[5],1); $rNg=[math]::Round($res[6],1)
    Reset-AreaWithLog $a 'NG解除（自動調整）'
    $a.Direction=$(if($rNg -gt $rOk){'appear'}else{'disappear'})
    $a.NGThreshold=[Math]::Max(1,[Math]::Min(100,[int][Math]::Round(($rOk+$rNg)/2)))
    $gap=[Math]::Abs($rNg-$rOk)
    if($gap -ge 30) { $quality='◎ OKとNGの差が大きく、安定して判定できます。'; $qc=[System.Drawing.Color]::FromArgb(140,220,150) }
    elseif($gap -ge 12) { $quality='○ 判定できます。'; $qc=[System.Drawing.Color]::FromArgb(140,220,150) }
    else { $quality='△ OKとNGの差が小さいため、誤判定のおそれがあります。範囲をもっと小さく囲む・照明を安定させる等を試してください。'; $qc=[System.Drawing.Color]::FromArgb(255,190,110) }
    $dirText=$(if($a.Direction -eq 'appear'){'色が出たらNG'}else{'色が消えたらNG'})
    $text=('自動調整しました：OK時 '+$rOk+'% ／ NG時 '+$rNg+'% → しきい値 '+$a.NGThreshold+'%（'+$dirText+'）')
    if($tightened) { $text+='　範囲を絞り込みました。' }
    $a.TuneColor=$qc
    $a.TuneText=($text+"`r`n"+$quality)
    Update-SampleRatios $a
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $areaList.Invalidate()
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：自動調整が完了しました')
}

function Record-Sample($kind) {
    $a=Get-SelectedArea
    if(-not $a) { return }
    if(-not (Test-AreaOnScreen $a.Rect)) {
        [void](Show-Message '監視範囲が画面の外にはみ出しています。先に「範囲を選び直す」で選び直してください。' ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return
    }
    try {
        $bmp=Capture-AreaUnobstructed $a.Rect
    } catch {
        [void](Show-Message ('画面を撮影できませんでした。'+"`r`n"+$_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return
    }
    # 1枚目と2枚目で範囲の大きさが違う（途中で範囲を選び直した）場合は古い方を捨てる
    foreach($snap in @($a.OkSnap,$a.NgSnap)) {
        if($snap -and ($snap.Width -ne $bmp.Width -or $snap.Height -ne $bmp.Height)) { Clear-AreaSamples $a; break }
    }
    if($kind -eq 'OK') {
        if($a.OkSnap) { $a.OkSnap.Dispose() }
        $a.OkSnap=$bmp
    } else {
        if($a.NgSnap) { $a.NgSnap.Dispose() }
        $a.NgSnap=$bmp
    }
    $a.TuneText=$null
    Update-SampleRatios $a
    if($a.OkSnap -and $a.NgSnap) {
        Invoke-AutoTune $a
    } else {
        Update-TuneLabel $a
        $meterBox.Invalidate()
        SetStatusPanel $colorReady $textOnReady ($a.Name+'：'+$(if($kind -eq 'OK'){'正常（OK）'}else{'異常（NG）'})+'の状態を記録しました')
    }
}

# ================== イベント ==================
$areaList.Add_DrawItem({
    $e=$_
    $e.DrawBackground()
    if($e.Index -ge 0 -and $e.Index -lt $script:areas.Count) {
        $a=$script:areas[$e.Index]
        $b=$e.Bounds
        $pad=Px 6
        $sw=Px 18
        $swBrush=New-Object System.Drawing.SolidBrush($a.Color)
        $e.Graphics.FillRectangle($swBrush,($b.X+$pad),($b.Y+[int](($b.Height-$sw)/2)),$sw,$sw)
        $swBrush.Dispose()
        $textY=$b.Y+[int](($b.Height-$script:areaListNameFont.Height)/2)
        $dirText=$(if($a.Direction -eq 'disappear'){'[消]'}else{'[出]'})
        $e.Graphics.DrawString(($dirText+' '+$a.Name),$script:areaListNameFont,$script:areaListNameBrush,($b.X+$pad*2+$sw),$textY)
        $ratioText=$(if($null -ne $a.LastRatio -and -not $a.Occluded){'一致率 '+$a.LastRatio.ToString('0.0')+'%'}else{'一致率 －'})
        $ratioText+=(' ／ しきい値 '+$a.NGThreshold+'%')
        $e.Graphics.DrawString($ratioText,$script:areaListNameFont,$script:areaListSubBrush,($b.X+[int]($b.Width*0.40)),$textY)
        if($a.Occluded) { $st='重なり'; $br=$script:areaListWarnBrush }
        elseif($a.CaptureFailed) { $st='読取不可'; $br=$script:areaListWarnBrush }
        elseif(-not $script:running) { $st='待機'; $br=$script:areaListSubBrush }
        elseif($a.WasNG) { $st='NG'; $br=$script:areaListNgBrush }
        elseif($a.NGStreak -gt 0) { $st='確認中'; $br=$script:areaListWarnBrush }
        else { $st='OK'; $br=$script:areaListOkBrush }
        $stSize=$e.Graphics.MeasureString($st,$script:areaListStatusFont)
        $e.Graphics.DrawString($st,$script:areaListStatusFont,$br,($b.Right-$stSize.Width-$pad),$textY)
    }
    $e.DrawFocusRectangle()
})
$script:areaListNameFont=UIFont 9.5
$script:areaListStatusFont=UIFont 9.5 -Bold
$script:areaListNameBrush=New-Object System.Drawing.SolidBrush($textPrimary)
$script:areaListSubBrush=New-Object System.Drawing.SolidBrush($textSecondary)
$script:areaListOkBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(140,220,150))
$script:areaListNgBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,140,140))
$script:areaListWarnBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,196,120))

$meterBox.Add_Paint({
    $g=$_.Graphics
    $w=$meterBox.ClientSize.Width; $h=$meterBox.ClientSize.Height
    $g.Clear($inputBgDark)
    $a=Get-SelectedArea
    if(-not $a) { return }
    $pad=Px 3
    $inner=$w-2*$pad
    if($null -ne $a.LastRatio -and -not $a.Occluded) {
        $fillW=[int]($inner*[Math]::Min(100.0,[double]$a.LastRatio)/100.0)
        $isNG=Test-RatioIsNG $a $a.LastRatio
        $fillColor=$(if($isNG){[System.Drawing.Color]::FromArgb(210,60,60)}else{[System.Drawing.Color]::FromArgb(46,160,67)})
        $br=New-Object System.Drawing.SolidBrush($fillColor)
        $g.FillRectangle($br,$pad,($pad+(Px 8)),$fillW,($h-2*$pad-(Px 8)))
        $br.Dispose()
    }
    # 記録したOK/NGの位置（▼）
    foreach($m in @(@($a.OkRatio,[System.Drawing.Color]::FromArgb(140,220,150)),@($a.NgRatio,[System.Drawing.Color]::FromArgb(255,120,120)))) {
        if($null -eq $m[0]) { continue }
        $x=$pad+[int]($inner*[Math]::Min(100.0,[double]$m[0])/100.0)
        $br=New-Object System.Drawing.SolidBrush($m[1])
        $pts=[System.Drawing.Point[]]@((New-Object System.Drawing.Point(($x-(Px 5)),0)),(New-Object System.Drawing.Point(($x+(Px 5)),0)),(New-Object System.Drawing.Point($x,(Px 8))))
        $g.FillPolygon($br,$pts)
        $br.Dispose()
    }
    # しきい値の線
    $tx=$pad+[int]($inner*[double]$a.NGThreshold/100.0)
    $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,210,60),(Px 3))
    $g.DrawLine($pen,$tx,0,$tx,$h)
    $pen.Dispose()
})

$areaList.Add_SelectedIndexChanged({
    if($script:suppressEvents) { return }
    $hasSel=($areaList.SelectedIndex -ge 0)
    $repickBtn.Enabled=$hasSel; $renameBtn.Enabled=$hasSel; $deleteAreaBtn.Enabled=$hasSel
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
})

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
            SetStatusPanel $colorReady $textOnReady ('設定を保存しました：'+[System.IO.Path]::GetFileName($dlg.FileName))
        } else {
            SetStatusPanel $colorIdle $textOnError '設定の保存に失敗しました。保存先を確認してください。'
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
        if($wasRunning) { Stop-Monitoring $null }
        if(Load-SettingsFile $dlg.FileName) {
            $script:suppressEvents=$true
            try { $intervalBox.Value=[decimal]$script:monitorIntervalSec } finally { $script:suppressEvents=$false }
            $timer.Interval=[int]([math]::Round($script:monitorIntervalSec*1000))
            $areaList.SelectedIndex=-1
            RefreshAreaListUI
            $msg='設定を読み込みました：'+[System.IO.Path]::GetFileName($dlg.FileName)
            if($wasRunning) { $msg+='（監視は停止しました。内容を確認して再度スタートしてください）' }
            SetStatusPanel $colorReady $textOnReady $msg
        } else {
            SetStatusPanel $colorIdle $textOnError '設定ファイルの読み込みに失敗しました（形式が違う・壊れている可能性）。'
        }
    }
    $dlg.Dispose()
})

$miniBtn.Add_Click({ Set-MiniMode (-not $script:miniMode) })

$pick.Add_Click({
    $timer.Stop(); $previewTimer.Stop()
    try {
        PickArea
        if($script:area) {
            # 最初の検出色は範囲の平均色。精度を上げるには「かんたん自動調整」を使う。
            $bmp=GrabBitmap $script:area
            $rgb=[NgVision76]::AverageColor($bmp)
            $bmp.Dispose()
            $script:areaCounter++
            $newArea=New-MonitorArea ('エリア'+$script:areaCounter) $script:area ([System.Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2]))
            [void]$script:areas.Add($newArea)
            $areaList.SelectedIndex=-1
            RefreshAreaListUI
            $areaList.SelectedIndex=$script:areas.Count-1
            SetStatusPanel $colorReady $textOnReady ($newArea.Name+'を追加しました。次は②の「かんたん自動調整」をしてください。')
        }
    } catch {
        SetStatusPanel $colorIdle $textOnError '範囲の追加に失敗しました。もう一度お試しください。'
        Write-ErrorLog ('エリア追加に失敗: '+$_.Exception.ToString())
    } finally {
        $script:area=$null
        $timer.Start(); $previewTimer.Start()
    }
})

$repickBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    $timer.Stop(); $previewTimer.Stop()
    try {
        PickArea
        if($script:area) {
            Reset-AreaWithLog $a 'NG解除（範囲の選び直し）'
            Clear-AreaBuffers $a
            Clear-AreaSamples $a
            $a.Rect=$script:area
            RefreshAreaListUI
            SetStatusPanel $colorReady $textOnReady ($a.Name+'の範囲を選び直しました。「かんたん自動調整」をやり直すことをおすすめします。')
        }
    } finally {
        $script:area=$null
        $timer.Start(); $previewTimer.Start()
    }
})

$renameBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    $newName=Show-TextInput '名前を変更' 'エリアの新しい名前（例：1号機ランプ）' $a.Name
    if($newName) {
        $a.Name=$newName
        RefreshAreaListUI
        SetStatusPanel $colorReady $textOnReady ('名前を「'+$newName+'」に変更しました')
    }
})

$deleteAreaBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    $ans=Show-Message ($a.Name+' を削除しますか？') ([System.Windows.Forms.MessageBoxIcon]::Question) ([System.Windows.Forms.MessageBoxButtons]::YesNo)
    if($ans -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    Reset-AreaWithLog $a 'NG解除（エリア削除）'
    Dispose-MonitorArea $a
    $script:areas.Remove($a)
    RefreshAreaListUI
    if($script:areas.Count -eq 0 -and $script:running) {
        Stop-Monitoring ($a.Name+'を削除しました。監視対象が無くなったため、監視を停止しました。')
    } else {
        SetStatusPanel $colorIdle $textOnIdle ($a.Name+'を削除しました。')
    }
})

$highlightBtn.Add_Click({
    $a=Get-SelectedArea
    if($a) { Show-AreaHighlight $a.Rect }
})

$eyedropBtn.Add_Click({ Set-Eyedropper (-not $script:eyedropper); UpdateAreaPreview })

$areaPreviewBox.Add_MouseClick({
    if(-not $script:eyedropper) { return }
    $a=Get-SelectedArea
    $img=$areaPreviewBox.Image
    if(-not $a -or -not $img) { return }
    # 拡大表示（Zoom）の余白を考えて、クリック位置を画像の座標に直す
    $pw=$areaPreviewBox.ClientSize.Width; $ph=$areaPreviewBox.ClientSize.Height
    $scale=[Math]::Min($pw/[double]$img.Width,$ph/[double]$img.Height)
    $ox=($pw-$img.Width*$scale)/2.0; $oy=($ph-$img.Height*$scale)/2.0
    $ix=[int](($_.X-$ox)/$scale); $iy=[int](($_.Y-$oy)/$scale)
    if($ix -lt 0 -or $iy -lt 0 -or $ix -ge $img.Width -or $iy -ge $img.Height) { return }
    $rgb=[NgVision76]::AverageColorAt([System.Drawing.Bitmap]$img,$ix,$iy,2)
    $a.Color=[System.Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2])
    Update-SampleRatios $a
    Set-Eyedropper $false
    Update-ColorLabel $a
    Update-TuneLabel $a
    Update-LiveRatioFromPreview
    SetStatusPanel $colorReady $textOnReady ($a.Name+'の検出する色を R'+$rgb[0]+' G'+$rgb[1]+' B'+$rgb[2]+' に変更しました')
})

$recordOkBtn.Add_Click({ Record-Sample 'OK' })
$recordNgBtn.Add_Click({ Record-Sample 'NG' })

$sensTrack.Add_ValueChanged({
    $sensPercentLabel.Text=$sensTrack.Value.ToString()
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.Sensitivity=$sensTrack.Value
    Update-SampleRatios $a
    Update-LiveRatioFromPreview
})
$hueModeCheck.Add_CheckedChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.HueMatchMode=$hueModeCheck.Checked
    Update-SampleRatios $a
    Update-LiveRatioFromPreview
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：'+$(if($hueModeCheck.Checked){'明るさの変化に強い判定（色味）にしました'}else{'通常の判定（明るさも考慮）に戻しました'}))
})
$rbAppear.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbAppear.Checked) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.Direction='appear'
    Reset-AreaWithLog $a 'NG解除（設定変更）'
    UpdateNGHintText 'appear'
    Update-LiveRatioFromPreview
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：色が「出たら」NGにする設定にしました')
})
$rbDisappear.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbDisappear.Checked) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.Direction='disappear'
    Reset-AreaWithLog $a 'NG解除（設定変更）'
    UpdateNGHintText 'disappear'
    Update-LiveRatioFromPreview
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：色が「消えたら」NGにする設定にしました')
})
$ngTrack.Add_ValueChanged({
    $ngPercentLabel.Text=$ngTrack.Value.ToString()+'%'
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.NGThreshold=$ngTrack.Value
    Update-MeterLabel
    $meterBox.Invalidate()
    $areaList.Invalidate()
})
$confirmBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.ConfirmFrames=[int]$confirmBox.Value
})
$intervalBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $script:monitorIntervalSec=[double]$intervalBox.Value
    $timer.Interval=[int]([math]::Round($script:monitorIntervalSec*1000))
    SetStatusPanel $colorReady $textOnReady ('監視間隔を '+$script:monitorIntervalSec+'秒 に変更しました')
})
$secBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.BuzzerSeconds=[int]$secBox.Value
})
$typeCombo.Add_SelectedIndexChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.BuzzerType=$typeCombo.SelectedIndex
})
$volTrack.Add_ValueChanged({
    $volPercentLabel.Text=$volTrack.Value.ToString()+'%'
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.BuzzerVolume=$volTrack.Value
})
$test.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    if(BuzzStart $a.BuzzerSeconds $a.BuzzerType $a.BuzzerVolume) {
        SetStatusPanel $colorReady $textOnReady ($a.Name+'：テスト再生中　｜　'+$buzzerTypeNames[$a.BuzzerType]+' / '+$a.BuzzerVolume+'% / '+$a.BuzzerSeconds+'秒')
    } else {
        SetStatusPanel $colorIdle $textOnError '音を再生できませんでした。BuzzerWorker.ps1 が同じフォルダにあるか、音声設定を確認してください。'
    }
    Update-RunButtons
})
$silence.Add_Click({
    BuzzStop
    Update-RunButtons
})
$stop.Add_Click({ Stop-Monitoring '停止しました' })
$logEnabledCheck.Add_CheckedChanged({ $script:loggingEnabled=$logEnabledCheck.Checked })
$topMostCheck.Add_CheckedChanged({ $f.TopMost=$topMostCheck.Checked })
$openLogBtn.Add_Click({
    try {
        Write-NGLogHeaderIfNeeded
        Start-Process -FilePath $script:logPath
    } catch {
        [void](Show-Message 'ログファイルを開けませんでした。' ([System.Windows.Forms.MessageBoxIcon]::Warning))
    }
})
$start.Add_Click({
    if($script:areas.Count -eq 0) {
        [void](Show-Message '先に「＋ エリアを追加」を押して、監視したい場所を四角く囲んでください。' ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return
    }
    $offScreen=@($script:areas | Where-Object { -not (Test-AreaOnScreen $_.Rect) } | ForEach-Object { $_.Name })
    if($offScreen.Count -gt 0) {
        $ans=Show-Message (($offScreen -join '、')+" は画面の外にはみ出しているため、正しく監視できません。`r`n（モニターの構成が変わった可能性があります）`r`n`r`nこのまま監視をスタートしますか？") ([System.Windows.Forms.MessageBoxIcon]::Warning) ([System.Windows.Forms.MessageBoxButtons]::YesNo)
        if($ans -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    }
    foreach($a in $script:areas) { Reset-AreaRuntime $a; $a.LastRatio=$null }
    # この画面が監視エリアに重なっていると正しく検査できないので、自動でミニ表示にする
    $overlap=$false
    foreach($a in $script:areas) { if(Test-AreaOccluded $a.Rect) { $overlap=$true } }
    if($overlap) { Set-MiniMode $true }
    $script:running=$true
    Update-RunButtons
    $msg=$script:areas.Count.ToString()+'箇所の監視を開始しました'
    if($overlap) { $msg+='（この画面が監視エリアに重なっていたため、ミニ表示にしました）' }
    SetStatusPanel $colorRunning $textOnRunning $msg
})

# ================== 監視タイマー ==================
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=[int]([math]::Round($script:monitorIntervalSec*1000))
$timer.Add_Tick({
    try {
        Update-BuzzerState
        Update-RunButtons
        if(-not $script:running -or $script:areas.Count -eq 0) { return }
        $nowTime=Get-Date
        $nowText=$nowTime.ToString('yyyy-MM-dd HH:mm:ss')
        $ngAreas=New-Object System.Collections.ArrayList
        $occluded=New-Object System.Collections.ArrayList
        $failed=New-Object System.Collections.ArrayList
        $newNG=$null
        foreach($a in $script:areas) {
            if(Test-AreaOccluded $a.Rect) {
                # 自分の画面を検査してしまわないよう、重なっている間は判定しない（前の状態を保つ）
                $a.Occluded=$true
                [void]$occluded.Add($a.Name)
            } else {
                $a.Occluded=$false
                try {
                    $bmp=GrabBitmapForArea $a
                    $ratio=Get-AreaRatio $bmp $a
                    $a.CaptureFailed=$false
                    if((Update-AreaJudgement $a $ratio $nowTime $nowText) -and -not $newNG) { $newNG=$a }
                } catch {
                    # 画面ロック中・リモートデスクトップ切断中などは画面を読み取れない。黙って止まらず知らせる。
                    $a.CaptureFailed=$true
                    [void]$failed.Add($a.Name)
                    Write-ErrorLogThrottled ('画面の読み取りに失敗（'+$a.Name+'）: '+$_.Exception.Message)
                }
            }
            if($a.WasNG) { [void]$ngAreas.Add($a) }
        }
        $areaList.Invalidate()
        if(-not $script:miniMode) { Update-MeterLabel; $meterBox.Invalidate() }

        if($newNG) {
            # 新しくNGになったエリアがあれば、そのエリアの音で鳴らす
            [void](BuzzStart $newNG.BuzzerSeconds $newNG.BuzzerType $newNG.BuzzerVolume)
            Update-RunButtons
            if($script:notifyIcon -and $f.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
                try {
                    $script:notifyIcon.BalloonTipTitle='NGモニター：検知'
                    $script:notifyIcon.BalloonTipText=($newNG.Name+' でNGを検知しました。')
                    $script:notifyIcon.ShowBalloonTip(4000)
                } catch {}
            }
        }
        if($ngAreas.Count -gt 0) {
            $names=(($ngAreas | ForEach-Object { $_.Name }) -join '、')
            SetStatusPanel $colorAlarm ([System.Drawing.Color]::White) ('⚠ NG検知！　'+$names)
        } elseif($occluded.Count -gt 0) {
            SetStatusPanel $colorWarn $textOnWarn ('⚠ この画面が「'+($occluded -join '、')+'」に重なっていて監視できません。画面を動かしてください。')
        } elseif($failed.Count -gt 0) {
            SetStatusPanel $colorWarn $textOnWarn ('⚠ 画面を読み取れません（'+($failed -join '、')+'）。画面ロック・スリープ・リモート切断を確認してください。')
        } else {
            SetStatusPanel $colorRunning $textOnRunning ($script:areas.Count.ToString()+'箇所を監視中　｜　すべて正常')
        }
    } catch {
        Write-ErrorLogThrottled ('監視中のエラー: '+$_.Exception.ToString())
    }
})

# エリアプレビュー専用の軽量タイマー（選んでいる1エリアだけ、0.5秒ごと）
$previewTimer=New-Object System.Windows.Forms.Timer
$previewTimer.Interval=500
$previewTimer.Add_Tick({
    try {
        if($script:miniMode -or -not $f.Visible -or $f.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) { return }
        UpdateAreaPreview
        if(-not $script:running) { $areaList.Invalidate() }
    } catch {}
})

# ================== タスクトレイ（最小化しても監視を続ける） ==================
$notifyIcon=New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon=[System.Drawing.SystemIcons]::Application
$notifyIcon.Text='NGモニター：待機中'
$notifyIcon.Visible=$true
$script:notifyIcon=$notifyIcon

$trayMenu=New-Object System.Windows.Forms.ContextMenuStrip
$menuOpen=$trayMenu.Items.Add('画面を開く')
$menuStart=$trayMenu.Items.Add('監視スタート')
$menuSilence=$trayMenu.Items.Add('音だけ止める')
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
$menuSilence.Add_Click({ BuzzStop; Update-RunButtons })
$menuStop.Add_Click({ Stop-Monitoring '停止しました' })
$menuExit.Add_Click({
    $script:exiting=$true
    $f.Close()
})

$f.Add_Resize({
    # 最小化してもフォームをHideしない。タスクバーに残したまま監視を継続する。
    if($f.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
        if(-not $script:trayBalloonShown) {
            try {
                $notifyIcon.BalloonTipTitle='NGモニター'
                $notifyIcon.BalloonTipText='最小化しました。監視はそのまま続きます。'
                $notifyIcon.ShowBalloonTip(3000)
            } catch {}
            $script:trayBalloonShown=$true
        }
    } else {
        $script:trayBalloonShown=$false
    }
})

function Cleanup-OnExit {
    try { $timer.Stop() } catch {}
    try { $previewTimer.Stop() } catch {}
    BuzzStop
    Close-OpenNGEpisodes 'NG解除（アプリ終了）'
    Save-WindowState
    $notifyIcon.Visible=$false
    foreach($a in $script:areas) { Dispose-MonitorArea $a }
    if($areaPreviewBox.Image) { $old=$areaPreviewBox.Image; $areaPreviewBox.Image=$null; $old.Dispose() }
}

$f.Add_FormClosing({
    param($sender,$e)
    if(-not $script:exiting -and $e.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
        $result=Show-Message "NGモニターを終了しますか？`r`n`r`n終了すると監視も停止します。" ([System.Windows.Forms.MessageBoxIcon]::Question) ([System.Windows.Forms.MessageBoxButtons]::YesNo)
        if($result -ne [System.Windows.Forms.DialogResult]::Yes) { $e.Cancel=$true; return }
    }
    $script:exiting=$true
    Cleanup-OnExit
})

[System.Windows.Forms.Application]::add_ThreadException({
    param($sender,$e)
    Write-ErrorLog ('(動作中のエラー・自動で継続)'+"`r`n"+$e.Exception.ToString())
    # 同じエラーが繰り返しても、確認画面が何枚も積み重ならないようにする
    if(((Get-Date)-$script:lastErrorDialogAt).TotalSeconds -lt 60) { return }
    $script:lastErrorDialogAt=Get-Date
    try {
        [void][System.Windows.Forms.MessageBox]::Show(
            "動作中に問題が発生しましたが、アプリはそのまま続行します。`r`n（内容は ng_monitor_error.log に記録しました）`r`n`r`n"+$e.Exception.Message,
            'NG モニター - 注意',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning)
    } catch {}
})

# ================== 起動 ==================
RefreshAreaListUI
Update-RunButtons
if($script:loadedAtStartup -and $script:areas.Count -gt 0) {
    SetStatusPanel $colorReady $textOnReady ('前回の設定を読み込みました（'+$script:areas.Count+'箇所）。「監視スタート」で開始できます。')
} else {
    SetStatusPanel $colorIdle $textOnIdle '「＋ エリアを追加」で監視する場所を選んでください'
}
if($savedWindow -and $savedWindow.Mini) { $f.Add_Shown({ Set-MiniMode $true }) }
$timer.Start()
$previewTimer.Start()

[void]$f.ShowDialog()
$notifyIcon.Dispose()

} catch {
    # 想定外のエラーで終了する場合、黙って落ちるのではなく必ず画面とログに残す
    $errText = $_.Exception.ToString()
    try {
        $logPath = Join-Path $PSScriptRoot 'ng_monitor_error.log'
        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $logPath -Value ("`r`n[$ts]`r`n" + $errText + "`r`n(行: " + $_.InvocationInfo.ScriptLineNumber + ")") -Encoding UTF8
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
