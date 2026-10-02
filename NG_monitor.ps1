# NG MONITOR - v78 不具合修正（ログ消失・誤って「正常」表示・二重起動・表示倍率の違うモニターでの位置ズレ ほか）
# Windows PowerShell 5.1 / Windows 10・11 用
try {
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -AssemblyName System.Drawing -ErrorAction Stop
# 画面部品を1つも作る前に、必ずここで呼ぶ必要がある（後から呼ぶとエラーになる）
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)

# 画面の座標を、どのモニターでも実際のピクセルでそろえる。
# 表示倍率（100%・125%・150%など）が違うモニターを並べていると、従来の方法では
# 「選んだ範囲」と「実際に読み取る範囲」がずれることがあったため、モニターごとの
# 表示倍率に対応した方法を優先して使う（古いWindowsでは従来の方法に戻る）。
if (-not ([System.Management.Automation.PSTypeName]'DpiHelper77').Type) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DpiHelper77 {
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    public static string Enable() {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "PerMonitorV2"; } catch (Exception) {}
        try { if (SetProcessDpiAwareness(2) == 0) return "PerMonitor"; } catch (Exception) {}
        try { if (SetProcessDPIAware()) return "System"; } catch (Exception) {}
        return "Unchanged";
    }
}
"@
}
$script:dpiMode=[DpiHelper77]::Enable()

# ---- 二重起動の防止 ----
# 2つ起動すると、ブザーが二重に鳴る・設定ファイルを上書きし合う・もう片方の画面を
# カメラ映像と間違えて検査する、といった問題が起きるため、1つだけにする。
$script:instanceMutex=New-Object System.Threading.Mutex($false,'Local\NG_MONITOR_SINGLE_INSTANCE')
$script:ownsInstance=$false
try { $script:ownsInstance=$script:instanceMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $script:ownsInstance=$true }
if(-not $script:ownsInstance) {
    [void][System.Windows.Forms.MessageBox]::Show("NGモニターはすでに起動しています。`r`n`r`nタスクバー、または画面右下の通知領域（トレイ）のアイコンから開いてください。",'NG モニター',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information)
    return
}

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
if (-not ([System.Management.Automation.PSTypeName]'NgVision77').Type) {
Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
// NOTE: Windows PowerShell 5.1 compiles this with the C# 5 compiler.
// Do not use C# 6+ syntax ($"...", =>, out var, ?., nameof).
public static class NgVision77 {
    // Pixels are first box-averaged 2x2 (Downsample) and then every cell is
    // evaluated: this halves camera noise, which matters most in dark scenes.
    public const int Step = 1;
    public const int Shrink = 2;

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
        return RatioImage(buf, bmp.Width, bmp.Height, stride, bpp, target.R, target.G, target.B, sensitivity, hueMode);
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
        return AutoTuneImage(okBuf, ngBuf, ok.Width, ok.Height, s1, b1, current.R, current.G, current.B);
    }

    // ---------- Full-resolution entry points (denoise, then judge) ----------
    public static byte[] Downsample(byte[] buf, int w, int h, int stride, int bpp, int f, out int dw, out int dh) {
        dw = Math.Max(1, w / f); dh = Math.Max(1, h / f);
        byte[] o = new byte[dw * dh * 4];
        for (int y = 0; y < dh; y++) {
            for (int x = 0; x < dw; x++) {
                int sr = 0, sg = 0, sb = 0, n = 0;
                for (int yy = y * f; yy < Math.Min(h, y * f + f); yy++) {
                    for (int xx = x * f; xx < Math.Min(w, x * f + f); xx++) {
                        int i = yy * stride + xx * bpp;
                        if (i + 2 >= buf.Length) continue;
                        sb += buf[i]; sg += buf[i + 1]; sr += buf[i + 2]; n++;
                    }
                }
                int o0 = (y * dw + x) * 4;
                if (n > 0) { o[o0] = (byte)(sb / n); o[o0 + 1] = (byte)(sg / n); o[o0 + 2] = (byte)(sr / n); }
                o[o0 + 3] = 255;
            }
        }
        return o;
    }

    public static double RatioImage(byte[] buf, int w, int h, int stride, int bpp,
                                    int tr, int tg, int tb, double sensitivity, bool hueMode) {
        int dw, dh;
        byte[] d = Downsample(buf, w, h, stride, bpp, Shrink, out dw, out dh);
        return RatioBuf(d, dw, dh, dw * 4, 4, tr, tg, tb, sensitivity, hueMode);
    }

    // Same as AutoTuneBuf, but on the denoised image; the changed-region box is
    // returned in full-resolution pixel coordinates.
    public static double[] AutoTuneImage(byte[] okBuf, byte[] ngBuf, int w, int h, int stride, int bpp,
                                         int curR, int curG, int curB) {
        int dw, dh;
        byte[] o = Downsample(okBuf, w, h, stride, bpp, Shrink, out dw, out dh);
        byte[] n = Downsample(ngBuf, w, h, stride, bpp, Shrink, out dw, out dh);
        double[] r = AutoTuneBuf(o, n, dw, dh, dw * 4, 4, curR, curG, curB);
        if (r == null) return null;
        r[8] = r[8] * Shrink; r[9] = r[9] * Shrink;
        r[10] = Math.Min(w - 1, r[10] * Shrink + Shrink - 1); r[11] = Math.Min(h - 1, r[11] * Shrink + Shrink - 1);
        return r;
    }

    // ---------- Pure algorithms (testable on any platform) ----------
    public static double RgbThreshold(double sensitivity) { return 20.0 + Clamp(sensitivity, 0, 100) / 100.0 * 130.0; }
    public static double HueThreshold(double sensitivity) { return 8.0 + Clamp(sensitivity, 0, 100) / 100.0 * 52.0; }

    // A target with little saturation (white/grey/black) has no reliable hue,
    // so hue mode silently falls back to RGB distance for it.
    public static bool IsChromatic(int r, int g, int b) {
        double h, s, v;
        RgbToHsv(r, g, b, out h, out s, out v);
        return s >= 0.20 && v >= 0.06;
    }

    // Distance of one pixel from the target, in the unit of the active mode
    // (RGB: Euclidean 0-441, hue: degrees + weighted saturation). Pixels that can
    // never match in hue mode (grey, white, near-black) get a huge distance.
    static double Dist(int r, int g, int b, int tr, int tg, int tb, bool useHue, double th, double ts, double minSat) {
        if (useHue) {
            double ph, ps, pv;
            RgbToHsv(r, g, b, out ph, out ps, out pv);
            if (pv < 0.05 || ps < minSat) return 1e9;
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
public static class NgWin77 {
    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    static uint myPid = GetCurrentProcessId();

    // Keep the PC and the display awake while monitoring: a sleeping PC or a
    // switched-off display cannot be inspected.
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
    public static void KeepAwake(bool on) {
        const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x1, ES_DISPLAY_REQUIRED = 0x2;
        SetThreadExecutionState(on ? (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) : ES_CONTINUOUS);
    }

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

// "Compare with the normal picture" detection.
// The area is split into a grid of small blocks (about 400 blocks); each block's
// average colour is compared with the recorded normal picture(s).
//  - averaging whole blocks removes most camera noise (important in the dark)
//  - how much each block normally flickers is learned from several OK frames
//  - moderate overall brightness drift (camera exposure) is compensated
//  - grey / infra-red night pictures are compared on brightness only
//  - several normal pictures (e.g. day and night) can be recorded; the closest one is used
// The score is the percentage of blocks that differ from normal (0-100).
public static class NgDiff77 {
    public static void GridFor(int w, int h, out int gw, out int gh) {
        double bs = Math.Max(3.0, Math.Sqrt((double)w * h / 400.0));
        gw = Math.Max(1, (int)Math.Ceiling(w / bs));
        gh = Math.Max(1, (int)Math.Ceiling(h / bs));
    }

    public static float[] BlockMeans(Bitmap bmp, int gw, int gh) {
        int stride, bpp;
        byte[] buf = NgVision77.ReadPixels(bmp, out stride, out bpp);
        return BlockMeansBuf(buf, bmp.Width, bmp.Height, stride, bpp, gw, gh);
    }

    public static float[] BlockMeansBuf(byte[] buf, int w, int h, int stride, int bpp, int gw, int gh) {
        int nb = gw * gh;
        double[] acc = new double[nb * 3];
        int[] cnt = new int[nb];
        for (int y = 0; y < h; y++) {
            int by = Math.Min(gh - 1, (int)((long)y * gh / h));
            int row = y * stride;
            for (int x = 0; x < w; x++) {
                int i = row + x * bpp;
                if (i + 2 >= buf.Length) continue;
                int b = by * gw + Math.Min(gw - 1, (int)((long)x * gw / w));
                acc[b * 3] += buf[i + 2]; acc[b * 3 + 1] += buf[i + 1]; acc[b * 3 + 2] += buf[i];
                cnt[b]++;
            }
        }
        float[] m = new float[nb * 3];
        for (int b = 0; b < nb; b++) {
            if (cnt[b] == 0) continue;
            m[b * 3] = (float)(acc[b * 3] / cnt[b]);
            m[b * 3 + 1] = (float)(acc[b * 3 + 1] / cnt[b]);
            m[b * 3 + 2] = (float)(acc[b * 3 + 2] / cnt[b]);
        }
        return m;
    }

    static double Y(float[] m, int b) { return 0.299 * m[b * 3] + 0.587 * m[b * 3 + 1] + 0.114 * m[b * 3 + 2]; }

    // Per-block difference between two block pictures, plus each block's brightness
    // (max of both) which is used to lower the threshold in dark blocks.
    public static float[] BlockDist(float[] refm, float[] cur, float[] brightOut) {
        int nb = refm.Length / 3;
        double[] ratios = new double[nb];
        double colR = 0, colC = 0;
        for (int b = 0; b < nb; b++) {
            double yr = Y(refm, b), yc = Y(cur, b);
            ratios[b] = (yr + 6.0) / (yc + 6.0);
            colR += Math.Sqrt(Sq(refm[b * 3] - yr) + Sq(refm[b * 3 + 2] - yr));
            colC += Math.Sqrt(Sq(cur[b * 3] - yc) + Sq(cur[b * 3 + 2] - yc));
        }
        Array.Sort(ratios);
        // Only moderate drift is compensated, so a lamp that lights up the whole
        // area is still seen as a change.
        double g = Math.Max(0.75, Math.Min(1.33, ratios[nb / 2]));
        bool useColour = colR / nb >= 4.0 && colC * g / nb >= 4.0;
        float[] d = new float[nb];
        for (int b = 0; b < nb; b++) {
            double yr = Y(refm, b), yc = Y(cur, b) * g;
            double dist = Math.Abs(yr - yc);
            if (useColour) {
                double crR = refm[b * 3] - yr, cbR = refm[b * 3 + 2] - yr;
                double crC = cur[b * 3] * g - yc, cbC = cur[b * 3 + 2] * g - yc;
                dist += Math.Sqrt(Sq(crR - crC) + Sq(cbR - cbC));
            }
            d[b] = (float)dist;
            if (brightOut != null) brightOut[b] = (float)Math.Max(yr, yc);
        }
        return d;
    }

    // From several frames of the normal state: { average picture, per-block noise }.
    public static float[][] BuildReference(float[][] frames) {
        int n3 = frames[0].Length, nb = n3 / 3;
        float[] mean = new float[n3];
        foreach (float[] f in frames) for (int i = 0; i < n3; i++) mean[i] += f[i] / frames.Length;
        float[] noise = new float[nb];
        foreach (float[] f in frames) {
            float[] d = BlockDist(mean, f, null);
            for (int b = 0; b < nb; b++) if (d[b] > noise[b]) noise[b] = d[b];
        }
        return new float[][] { mean, noise };
    }

    public static double Threshold(double sensitivity, double noise, double brightness) {
        double s = Math.Max(0, Math.Min(100, sensitivity));
        double baseThr = 4.0 + (100.0 - s) * 0.30;              // sens 50 -> 19 (of 255)
        double darkFactor = 0.45 + 0.55 * Math.Min(1.0, brightness / 90.0); // dark blocks: smaller changes count
        return baseThr * darkFactor + 1.5 * noise;
    }

    public static double Score(float[] refm, float[] noise, float[] cur, double sensitivity, float[] map) {
        int nb = refm.Length / 3;
        float[] bright = new float[nb];
        float[] d = BlockDist(refm, cur, bright);
        double sum = 0;
        for (int b = 0; b < nb; b++) {
            double thr = Threshold(sensitivity, noise[b], bright[b]);
            // Blown-out (saturated) blocks cannot follow exposure changes and lose
            // their tint, so they need a clearly larger change to count.
            if (MaxCh(refm, b) >= 248 || MaxCh(cur, b) >= 248) thr = thr * 2.0 + 20.0;
            double ramp = Math.Max(2.0, 0.25 * thr);
            double v = (d[b] - thr) / (2.0 * ramp) + 0.5;
            if (v < 0) v = 0; else if (v > 1) v = 1;
            if (map != null) map[b] = (float)v;
            sum += v;
        }
        return 100.0 * sum / nb;
    }

    // refs = { means0, noise0, means1, noise1, ... }: the closest normal picture wins.
    public static double ScoreMulti(float[][] refs, float[] cur, double sensitivity, float[] map) {
        double best = double.MaxValue;
        float[] tmp = map == null ? null : new float[map.Length];
        for (int k = 0; k + 1 < refs.Length; k += 2) {
            if (refs[k].Length != cur.Length) continue;
            double s = Score(refs[k], refs[k + 1], cur, sensitivity, tmp);
            if (s < best) {
                best = s;
                if (map != null) Array.Copy(tmp, map, map.Length);
            }
        }
        return best == double.MaxValue ? -1 : best;
    }

    // With an NG sample: the sensitivity that separates OK frames from NG best.
    // Returns { sensitivity, okMax, ngScore }.
    public static double[] Tune(float[][] refs, float[][] okFrames, float[] ng) {
        double[] best = null; double bestScore = double.MinValue;
        for (int s = 0; s <= 100; s += 5) {
            double okMax = 0;
            if (okFrames != null) foreach (float[] f in okFrames) okMax = Math.Max(okMax, ScoreMulti(refs, f, s, null));
            double ngS = ScoreMulti(refs, ng, s, null);
            double score = (ngS - okMax) - 0.02 * Math.Abs(s - 50) - (okMax > 0.5 ? 5 : 0);
            if (score > bestScore) { bestScore = score; best = new double[] { s, okMax, ngS }; }
        }
        return best;
    }

    // Compact storage for the settings file (1/16 steps, 2 bytes each).
    public static string Pack(float[] v) {
        byte[] b = new byte[v.Length * 2];
        for (int i = 0; i < v.Length; i++) {
            int q = (int)Math.Round(Math.Max(0, Math.Min(4095.0, v[i])) * 16.0);
            b[i * 2] = (byte)(q & 255); b[i * 2 + 1] = (byte)(q >> 8);
        }
        return Convert.ToBase64String(b);
    }
    public static float[] Unpack(string s) {
        byte[] b = Convert.FromBase64String(s);
        float[] v = new float[b.Length / 2];
        for (int i = 0; i < v.Length; i++) v[i] = (b[i * 2] | (b[i * 2 + 1] << 8)) / 16.0f;
        return v;
    }

    static double Sq(double v) { return v * v; }
    static double MaxCh(float[] m, int b) { return Math.Max(m[b * 3], Math.Max(m[b * 3 + 1], m[b * 3 + 2])); }
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
$script:imageDir = Join-Path $PSScriptRoot 'ng_images'
$script:saveImages = $true        # NGの時に画像を保存する（このPCの設定）
$script:autoStart = $false        # 起動したら自動で監視を始める（このPCの設定）
$script:settingsDirty = $false    # 設定が変わった → 少し待ってから自動保存する
$script:dirtySince = [datetime]::MinValue
$script:autoSaveFailed = $false
$script:pendingLogRows = New-Object System.Collections.ArrayList   # まだCSVに書けていないログの行
$script:logWriteBlocked = $false
$script:okFrameCount = 10         # 「正常」を記録する時に撮る枚数（約1.5秒）
$script:maxDiffRefs = 6           # 1つのエリアに記録できる「正常」の見本の数（昼・夜など）

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
    $ratioText=$(if($null -ne $ratio){([double]$ratio).ToString([System.Globalization.CultureInfo]::InvariantCulture)}else{''})
    $durationText=$(if($null -ne $durationSec){([math]::Round($durationSec,1)).ToString([System.Globalization.CultureInfo]::InvariantCulture)}else{''})
    $areaNameSafe=([string]$areaName) -replace '"','""'
    $row=('"'+$timestamp+'","'+$areaNameSafe+'","'+$eventType+'","'+$ratioText+'","'+$durationText+'"')
    if($script:pendingLogRows.Count -lt 10000) { [void]$script:pendingLogRows.Add($row) }
    [void](Flush-NGLog)
}

function Flush-NGLog {
    # ログのCSVをExcelで開いたままにすると、書き込めずに記録が消えていた。
    # 書けなかった行は覚えておき、Excelを閉じた後に自動で書き込む。
    if($script:pendingLogRows.Count -eq 0) { return $true }
    try {
        Write-NGLogHeaderIfNeeded
        Add-Content -LiteralPath $script:logPath -Value ([string[]]$script:pendingLogRows.ToArray([string])) -Encoding UTF8 -ErrorAction Stop
        $script:pendingLogRows.Clear()
        $script:logWriteBlocked=$false
        return $true
    } catch {
        $script:logWriteBlocked=$true
        return $false
    }
}

function Save-PendingLogOnExit {
    # 終了する時まで書き込めなかった行は、別のファイルに残す（記録を失わないように）
    if(Flush-NGLog) { return }
    try {
        $alt=Join-Path $PSScriptRoot ('ng_monitor_log_未書き込み_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'.csv')
        Set-Content -LiteralPath $alt -Value (@('"日時","エリア","種別","一致率(%)","継続時間(秒)"')+[string[]]$script:pendingLogRows.ToArray([string])) -Encoding UTF8 -ErrorAction Stop
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
        Move-Item -LiteralPath $tmp -Destination $path -Force -ErrorAction Stop
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
        $proc=Start-Process -FilePath $psExe -ArgumentList $argList -WindowStyle Hidden -PassThru -ErrorAction Stop
        if($null -eq $proc) { return $false }
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
        # 判定のしかた：'diff' = 正常な映像と比べる（おすすめ）／ 'color' = 色で判定する（従来）
        Mode='diff'
        Direction='appear'
        Sensitivity=50
        NGThreshold=15
        HueMatchMode=$false
        DiffSensitivity=50     # 「比べる」の感度（大きいほど小さな違いでもNG）
        DiffThreshold=3        # 「比べる」で、映像のこの割合（%）以上が変わったらNG
        DiffGridW=0
        DiffGridH=0
        DiffRefs=(New-Object System.Collections.ArrayList)   # 正常の見本（各要素は {平均, ゆらぎ} の組）。昼・夜など複数可
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
        LastMap=$null
        Occluded=$false
        CaptureFailed=$false
        DiffRefArray=$null
        DiffOkFrames=$null
        DiffNgMeans=$null
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
    $a.DiffOkFrames=$null; $a.DiffNgMeans=$null
    $a.TuneText=$null; $a.TuneColor=$null
}

function Clear-DiffReference($a) {
    # 範囲の大きさが変わると、記録した「正常」の見本は使えなくなる
    $a.DiffRefs.Clear()
    $a.DiffRefArray=$null
    $a.DiffOkFrames=$null
    $a.DiffNgMeans=$null
    $a.LastMap=$null
}

function Update-DiffRefArray($a) {
    # 判定用に {平均0, ゆらぎ0, 平均1, ゆらぎ1, ...} の形へ並べ直しておく
    if($a.DiffRefs.Count -eq 0) { $a.DiffRefArray=$null; return }
    $arr=New-Object 'float[][]' ($a.DiffRefs.Count*2)
    for($i=0;$i -lt $a.DiffRefs.Count;$i++) { $arr[2*$i]=$a.DiffRefs[$i][0]; $arr[2*$i+1]=$a.DiffRefs[$i][1] }
    $a.DiffRefArray=$arr
}

function Test-AreaReady($a) {
    if($a.Mode -eq 'diff') { return ($a.DiffRefs.Count -gt 0) }
    return $true
}

function Get-JudgeThreshold($a) {
    if($a.Mode -eq 'diff') { return [double]$a.DiffThreshold }
    return [double]$a.NGThreshold
}

function Get-JudgeDirection($a) {
    if($a.Mode -eq 'diff') { return 'appear' }   # 「比べる」は、違いが大きいほどNG
    return $a.Direction
}

function Get-AreaRatio($bmp,$a,[switch]$WithMap) {
    # 色で判定：指定した色に一致する割合（%）
    # 比べる　：正常の見本と違っている部分の割合（%）。見本が無ければ $null
    if($a.Mode -eq 'diff') {
        if(-not $a.DiffRefArray) { Update-DiffRefArray $a }
        if(-not $a.DiffRefArray) { return $null }
        $means=[NgDiff77]::BlockMeans($bmp,$a.DiffGridW,$a.DiffGridH)
        $map=$null
        if($WithMap) { $map=New-Object 'float[]' ($a.DiffGridW*$a.DiffGridH) }
        $score=[NgDiff77]::ScoreMulti($a.DiffRefArray,$means,[double]$a.DiffSensitivity,$map)
        if($WithMap) { $a.LastMap=$map }
        if($score -lt 0) { return $null }
        return [math]::Round($score,1)
    }
    return [math]::Round([NgVision77]::Ratio($bmp,$a.Color,[double]$a.Sensitivity,[bool]$a.HueMatchMode),1)
}

function Test-RatioIsNG($a,$ratio) {
    if($null -eq $ratio) { return $false }
    if((Get-JudgeDirection $a) -eq 'disappear') { return ($ratio -lt (Get-JudgeThreshold $a)) }
    return ($ratio -ge (Get-JudgeThreshold $a))
}

function Update-AreaJudgement($a,$ratio,$nowTime,$nowText) {
    # 1回の読み取りだけで決めず、
    #  ・しきい値付近で OK/NG がパタパタ切り替わらないよう、解除には少し余裕（ヒステリシス）を持たせる
    #  ・ConfirmFrames 回続けて同じ結果になったら確定する（映像の乱れ・一瞬の映り込みを無視）
    # 新しくNGが確定した時だけ $true を返す。
    $a.LastRatio=$ratio
    if($null -eq $ratio) { return $false }
    $t=Get-JudgeThreshold $a
    if((Get-JudgeDirection $a) -eq 'disappear') {
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

function Update-SampleRatios($a) {
    # 記録したOK/NGの見本を、今の設定で判定したら何%になるか（メーターの▼の位置）
    try {
        if($a.Mode -eq 'diff') {
            if(-not $a.DiffRefArray) { Update-DiffRefArray $a }
            $a.OkRatio=$null; $a.NgRatio=$null
            if($a.DiffRefArray -and $a.DiffOkFrames) {
                $mx=0.0
                foreach($fr in $a.DiffOkFrames) { $mx=[Math]::Max($mx,[NgDiff77]::ScoreMulti($a.DiffRefArray,$fr,[double]$a.DiffSensitivity,$null)) }
                $a.OkRatio=[math]::Round($mx,1)
            }
            if($a.DiffRefArray -and $a.DiffNgMeans) {
                $a.NgRatio=[math]::Round([NgDiff77]::ScoreMulti($a.DiffRefArray,$a.DiffNgMeans,[double]$a.DiffSensitivity,$null),1)
            }
        } else {
            $a.OkRatio=$(if($a.OkSnap){Get-AreaRatio $a.OkSnap $a}else{$null})
            $a.NgRatio=$(if($a.NgSnap){Get-AreaRatio $a.NgSnap $a}else{$null})
        }
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

function Test-AreaOccluded($rect) {
    # このアプリ自身の画面（本体・ポップアップ・確認画面）が監視エリアの上に重なっていると、
    # カメラ映像ではなくこのアプリの画面を検査してしまう。重なりを検出する。
    try { return [NgWin77]::CoveredByOwnWindow($rect.X,$rect.Y,$rect.Width,$rect.Height) } catch { return $false }
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

function Capture-DiffFrames($a,$count,$intervalMs,$label) {
    # 何枚か続けて撮り、ブロックごとの平均色の一覧（float[][]）を返す。
    # 1枚だけでなく何枚も撮ることで、「普段からちらつく部分」も覚えられる。
    $rect=$a.Rect
    $hid=$false
    if($f.Visible -and (Test-AreaOccluded $rect)) {
        $f.Hide()
        $hid=$true
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 250
    }
    $frames=New-Object 'float[][]' $count
    $g2.Group.Enabled=$false   # 記録中にボタンを二重に押されないように
    try {
        for($i=0;$i -lt $count;$i++) {
            $bmp=GrabBitmap $rect
            try { $frames[$i]=[NgDiff77]::BlockMeans($bmp,$a.DiffGridW,$a.DiffGridH) } finally { $bmp.Dispose() }
            if($label) { SetStatusPanel $colorReady $textOnReady ($label+'（'+($i+1)+'/'+$count+'）…画面を動かさないでください') }
            [System.Windows.Forms.Application]::DoEvents()
            if($i -lt $count-1) { Start-Sleep -Milliseconds $intervalMs }
        }
    } finally {
        $g2.Group.Enabled=$true
        if($hid) { $f.Show(); $f.Activate() }
    }
    return ,$frames
}

function Get-SafeFileName($name) {
    $safe=[string]$name
    foreach($ch in [System.IO.Path]::GetInvalidFileNameChars()) { $safe=$safe.Replace([string]$ch,'_') }
    return $safe
}

function Save-NGImage($a,$nowTime) {
    # NGの瞬間の画面（エリア＋周り）を、赤い枠をつけて保存する。後から原因を確認できる。
    if(-not $script:saveImages) { return }
    try {
        $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen
        $m=80
        $x0=[Math]::Max($vs.X,$a.Rect.X-$m); $y0=[Math]::Max($vs.Y,$a.Rect.Y-$m)
        $x1=[Math]::Min($vs.Right,$a.Rect.Right+$m); $y1=[Math]::Min($vs.Bottom,$a.Rect.Bottom+$m)
        if($x1 -le $x0 -or $y1 -le $y0) { return }
        $bmp=GrabBitmap (New-Object System.Drawing.Rectangle($x0,$y0,($x1-$x0),($y1-$y0)))
        try {
            $g=[System.Drawing.Graphics]::FromImage($bmp)
            $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::Red,3)
            $g.DrawRectangle($pen,($a.Rect.X-$x0),($a.Rect.Y-$y0),$a.Rect.Width,$a.Rect.Height)
            $pen.Dispose(); $g.Dispose()
            $dir=Join-Path $script:imageDir ($nowTime.ToString('yyyy-MM-dd'))
            if(-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
            $file=Join-Path $dir ($nowTime.ToString('HHmmss_fff')+'_'+(Get-SafeFileName $a.Name)+'.png')
            $bmp.Save($file,[System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $bmp.Dispose() }
    } catch {
        Write-ErrorLogThrottled ('NG画像の保存に失敗: '+$_.Exception.Message)
    }
}

function Remove-OldNGImages {
    # 30日より古いNG画像は自動で削除する（ディスクがいっぱいにならないように）
    try {
        if(-not (Test-Path -LiteralPath $script:imageDir)) { return }
        $limit=(Get-Date).Date.AddDays(-30)
        foreach($d in @(Get-ChildItem -LiteralPath $script:imageDir -Directory -ErrorAction SilentlyContinue)) {
            $day=[datetime]::MinValue
            if([datetime]::TryParseExact($d.Name,'yyyy-MM-dd',[System.Globalization.CultureInfo]::InvariantCulture,[System.Globalization.DateTimeStyles]::None,[ref]$day) -and $day -lt $limit) {
                Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
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
            Mode=$a.Mode
            DiffSensitivity=$a.DiffSensitivity; DiffThreshold=$a.DiffThreshold
            DiffGridW=$a.DiffGridW; DiffGridH=$a.DiffGridH
            DiffRefs=@($a.DiffRefs | ForEach-Object { [PSCustomObject]@{ Means=[NgDiff77]::Pack($_[0]); Noise=[NgDiff77]::Pack($_[1]) } })
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
        # いったん別名で書いてから置き換える（書き込み中に電源が切れても設定ファイルが壊れないように）
        $tmp=$path+'.tmp'
        $cur | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $tmp -Encoding UTF8 -ErrorAction Stop
        Move-Item -LiteralPath $tmp -Destination $path -Force -ErrorAction Stop
        $script:settingsPath=$path
        Remember-LastSettingsPath $path
        return $true
    } catch { return $false }
}

function Mark-SettingsDirty {
    # 設定が変わったら、少し待ってから自動で保存する（スライダーを動かすたびに保存しないように）
    $script:settingsDirty=$true
    $script:dirtySince=Get-Date
}

function Save-SettingsIfDirty([switch]$Now) {
    if(-not $script:settingsDirty) { return }
    if(-not $Now -and ((Get-Date)-$script:dirtySince).TotalSeconds -lt 2) { return }
    $script:settingsDirty=$false
    if(Save-SettingsFile $script:settingsPath) {
        $script:autoSaveFailed=$false
    } elseif(-not $script:autoSaveFailed) {
        $script:autoSaveFailed=$true
        SetStatusPanel $colorIdle $textOnError ('設定を自動保存できませんでした（'+$script:settingsPath+'）。「別名で保存」で保存先を変えてください。')
    }
}

function Read-SettingsData($path) {
    # 古い形式（名前付きで複数保存する Profiles 形式）も読めるようにしておく
    $raw=Get-Content -LiteralPath $path -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
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
            # 以前のバージョンで作った設定は「色で判定」のまま動かす
            $newArea.Mode=$(if($ad.Mode -eq 'diff'){'diff'}else{'color'})
            $newArea.DiffSensitivity=ClampInt $ad.DiffSensitivity 0 100 50
            $newArea.DiffThreshold=ClampInt $ad.DiffThreshold 1 100 3
            $gw=0; $gh=0
            [NgDiff77]::GridFor($rect.Width,$rect.Height,[ref]$gw,[ref]$gh)
            $newArea.DiffGridW=$gw; $newArea.DiffGridH=$gh
            if(([int]$ad.DiffGridW -eq $gw) -and ([int]$ad.DiffGridH -eq $gh)) {
                foreach($rd in @($ad.DiffRefs)) {
                    if($null -eq $rd -or -not $rd.Means -or -not $rd.Noise) { continue }
                    try {
                        $means=[NgDiff77]::Unpack([string]$rd.Means)
                        $noise=[NgDiff77]::Unpack([string]$rd.Noise)
                        if($means.Length -eq $gw*$gh*3 -and $noise.Length -eq $gw*$gh) {
                            $pair=New-Object 'float[][]' 2
                            $pair[0]=$means; $pair[1]=$noise
                            [void]$newArea.DiffRefs.Add($pair)
                        }
                    } catch {}
                }
            }
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
        $newArea.Mode='color'
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
        $b=$f.Bounds
        if($f.WindowState -ne [System.Windows.Forms.FormWindowState]::Normal) { $b=$f.RestoreBounds }
        # ミニ表示中は、ミニの小さな大きさではなく、ふだんの大きさを覚えておく
        if($script:miniMode -and $script:fullSize) { $b=New-Object System.Drawing.Rectangle($b.X,$b.Y,$script:fullSize.Width,$script:fullSize.Height) }
        [PSCustomObject]@{ X=$b.X; Y=$b.Y; W=$b.Width; H=$b.Height; Mini=$script:miniMode; TopMost=$f.TopMost; AutoStart=$script:autoStart; SaveImages=$script:saveImages } |
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
$saveBtn=New-Button '別名で保存' $accentBlue $null 9 110 34
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

# 判定のしかた
$modeRow=New-Row
$modeLabel=New-Label '判定のしかた：' 9.5 -Bold
$rbModeDiff=New-Object System.Windows.Forms.RadioButton
$rbModeDiff.Text='正常な映像と比べる（おすすめ・かんたん）'
$rbModeColor=New-Object System.Windows.Forms.RadioButton
$rbModeColor.Text='色で判定する（従来の方法）'
foreach($rb in @($rbModeDiff,$rbModeColor)) {
    $rb.AutoSize=$true; $rb.Font=UIFont 9.5; $rb.ForeColor=$textPrimary; $rb.Enabled=$false
    $rb.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    $rb.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 3),(Px 12),(Px 3))
}
$rbModeDiff.Checked=$true
Add-Controls $modeRow @($modeLabel,$rbModeDiff,$rbModeColor)
$modeRow.Margin=New-Object System.Windows.Forms.Padding(0,(Px 8),0,(Px 2))
$g2.Body.Controls.Add($modeRow)

# 記録（かんたん設定）
$tuneTitle=New-Label '★ かんたん設定' 10 -Bold ([System.Drawing.Color]::FromArgb(255,210,90))
$tuneTitle.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 8),(Px 3),(Px 1))
$g2.Body.Controls.Add($tuneTitle)
$tuneHint=New-Label '' 8.5 -color $textSecondary
$tuneHint.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$g2.Body.Controls.Add($tuneHint)
$tuneRow=New-Row
$recordOkBtn=New-Button '① 正常な状態を記録' $colorGreenBtn $null 9.5 170 36
$addOkBtn=New-Button '＋ 別の正常も追加（昼・夜など）' ([System.Drawing.Color]::FromArgb(30,110,60)) $null 9 170 36
$recordNgBtn=New-Button '② 異常を記録（任意）' $colorRedBtn $null 9.5 150 36
Add-Controls $tuneRow @($recordOkBtn,$addOkBtn,$recordNgBtn)
$g2.Body.Controls.Add($tuneRow)
$tuneResultLabel=New-Label '' 9 -color $textPrimary
$tuneResultLabel.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$g2.Body.Controls.Add($tuneResultLabel)

# 今の値のメーター
$meterTitle=New-Label '' 9 -Bold
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

# 詳しい設定（ふだんは隠しておく）
$advancedCheck=New-Object System.Windows.Forms.CheckBox
$advancedCheck.Text='詳しい設定を表示する（ふつうは不要です）'
$advancedCheck.AutoSize=$true; $advancedCheck.Font=UIFont 9 -Bold; $advancedCheck.ForeColor=$accentBlue
$advancedCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 10),(Px 3),(Px 2))
$g2.Body.Controls.Add($advancedCheck)
$advancedPanel=New-Column
$advancedPanel.Visible=$false
$g2.Body.Controls.Add($advancedPanel)

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

$sensRow=New-Row
$sensLabel=New-Label '検出の感度：'
$sensTrack=New-Slider 0 100 50 260
$sensTrack.Enabled=$false
$sensPercentLabel=New-Label '50' 9.5 -Bold
Add-Controls $sensRow @($sensLabel,$sensTrack,$sensPercentLabel)
$sensHint=New-Label '' 8 -color $textSecondary
$sensHint.MaximumSize=New-Object System.Drawing.Size((Px 720),0)

$hueModeCheck=New-Object System.Windows.Forms.CheckBox
$hueModeCheck.Text='明るさの変化に強くする（色味で判定。白・灰色・黒は一致とみなさない）'
$hueModeCheck.AutoSize=$true; $hueModeCheck.Font=UIFont 9; $hueModeCheck.ForeColor=$textPrimary; $hueModeCheck.Enabled=$false
$hueModeCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 4),(Px 3),(Px 4))

$ngRow=New-Row
$ngLabel=New-Label '一致率のしきい値：'
$ngTrack=New-Slider 1 100 15 260
$ngTrack.Enabled=$false
$ngPercentLabel=New-Label '15%' 9.5 -Bold
Add-Controls $ngRow @($ngLabel,$ngTrack,$ngPercentLabel)
$ngHint=New-Label '' 8 -color $textSecondary

$confirmRow=New-Row
$confirmLabel=New-Label 'NGと判定するまでの回数：'
$confirmBox=New-Number 1 20 2 0 1 70
$confirmBox.Enabled=$false
$confirmUnit=New-Label '回続けてNGならNG確定（一瞬の映像の乱れ・人の横切りを無視）' 8.5 -color $textSecondary
Add-Controls $confirmRow @($confirmLabel,$confirmBox,$confirmUnit)

$clearRefsBtn=New-Button '記録した正常の見本をすべて消す' ([System.Drawing.Color]::FromArgb(120,50,50)) $null 8.5 150 30
Add-Controls $advancedPanel @($dirRow,$sensRow,$sensHint,$hueModeCheck,$ngRow,$ngHint,$confirmRow,$clearRefsBtn)

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
function New-Check($text) {
    $c=New-Object System.Windows.Forms.CheckBox
    $c.Text=$text
    $c.AutoSize=$true; $c.Font=UIFont 9; $c.ForeColor=$textPrimary
    $c.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    $c.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 4),(Px 3),(Px 4))
    return $c
}
$autoStartCheck=New-Check '起動したら自動で監視をスタートする（PCの再起動後もそのまま監視）'
$g4.Body.Controls.Add($autoStartCheck)
$imageRow=New-Row
$saveImagesCheck=New-Check 'NGの時の画面を画像で保存する（30日分）'
$saveImagesCheck.Checked=$true
$openImagesBtn=New-Button '画像フォルダを開く' $colorGrayBtn $null 8.5 120 30
Add-Controls $imageRow @($saveImagesCheck,$openImagesBtn)
$g4.Body.Controls.Add($imageRow)
$logRow=New-Row
$logEnabledCheck=New-Check 'NGログを記録する（発生・解除の日時をCSVに残す）'
$logEnabledCheck.Checked=$script:loggingEnabled
$openLogBtn=New-Button 'ログを開く' $colorGrayBtn $null 8.5 100 30
Add-Controls $logRow @($logEnabledCheck,$openLogBtn)
$g4.Body.Controls.Add($logRow)
$topMostCheck=New-Check 'この画面を常に手前に表示する'
$topMostCheck.Checked=$true
$g4.Body.Controls.Add($topMostCheck)
$intervalRow=New-Row
$intervalLabel=New-Label '監視の間隔：'
$intervalBox=New-Number 0.1 5.0 ([decimal]$script:monitorIntervalSec) 1 0.1 70
$intervalUnitLabel=New-Label '秒ごとにチェック（短いほど検知は速く、PCの負荷は上がります）' 8.5 -color $textSecondary
Add-Controls $intervalRow @($intervalLabel,$intervalBox,$intervalUnitLabel)
$g4.Body.Controls.Add($intervalRow)
$settingsPathLabel=New-Label '' 8 -color $textSecondary
$settingsPathLabel.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$g4.Body.Controls.Add($settingsPathLabel)

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
        if([System.Windows.Forms.SystemInformation]::VirtualScreen.IntersectsWith($r)) {
            $f.StartPosition=[System.Windows.Forms.FormStartPosition]::Manual
            if($r.Width -ge $f.MinimumSize.Width -and $r.Height -ge (Px 400)) {
                $f.Bounds=$r
            } else {
                # 保存されていた大きさが小さすぎる時（以前のバージョンの不具合）は、位置だけ使う
                $f.Location=$r.Location
            }
            $script:fullSize=$f.Size
        }
        if($null -ne $savedWindow.TopMost) { $topMostCheck.Checked=[bool]$savedWindow.TopMost; $f.TopMost=[bool]$savedWindow.TopMost }
        if($null -ne $savedWindow.AutoStart) { $script:autoStart=[bool]$savedWindow.AutoStart }
        if($null -ne $savedWindow.SaveImages) { $script:saveImages=[bool]$savedWindow.SaveImages }
    } catch {}
}
$autoStartCheck.Checked=$script:autoStart
$saveImagesCheck.Checked=$script:saveImages

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

function UpdateNGHintText($a) {
    if($a -and $a.Mode -eq 'diff') {
        $ngHint.Text='映像のうち、この割合（%）以上が正常と違っていたらNG'
    } elseif($a -and $a.Direction -eq 'disappear') {
        $ngHint.Text='一致率がこの値を下回ったらNG判定（色が消えた時）'
    } else {
        $ngHint.Text='一致率がこの値以上でNG判定（色が出た時）'
    }
}

function Update-ColorLabel($a) {
    if($a -and $a.Mode -eq 'diff') {
        $n=$a.DiffRefs.Count
        $colorLabel.Text=$(if($n -gt 0){'正常の見本：'+$n+'枚 記録済み'}else{'正常の見本：まだ記録していません'})
        $colorLabel.ForeColor=$(if($n -gt 0){[System.Drawing.Color]::FromArgb(140,220,150)}else{[System.Drawing.Color]::FromArgb(255,190,110)})
    } elseif($a) {
        $colorLabel.Text=('検出する色：■ R'+$a.Color.R+' G'+$a.Color.G+' B'+$a.Color.B)
        $colorLabel.ForeColor=$(if($a.Color.GetBrightness() -lt 0.15){$textPrimary}else{$a.Color})
    } else {
        $colorLabel.Text='－'
        $colorLabel.ForeColor=$textPrimary
    }
}

function Update-TuneLabel($a) {
    if(-not $a) { $tuneResultLabel.Text=''; return }
    if($a.TuneText) {
        $tuneResultLabel.ForeColor=$a.TuneColor
        $tuneResultLabel.Text=$a.TuneText
    } elseif($a.Mode -eq 'diff') {
        if($a.DiffRefs.Count -gt 0) {
            $tuneResultLabel.ForeColor=[System.Drawing.Color]::FromArgb(140,220,150)
            $tuneResultLabel.Text='設定できています。「▶ 監視スタート」で監視できます。'
        } else {
            $tuneResultLabel.ForeColor=[System.Drawing.Color]::FromArgb(255,190,110)
            $tuneResultLabel.Text='画面が正常な時に「① 正常な状態を記録」を押してください。'
        }
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

function Update-ModeUI($a) {
    # 判定のしかたに合わせて、ボタン・説明・スライダーの意味を切り替える
    $diff=(-not $a) -or ($a.Mode -eq 'diff')
    $addOkBtn.Visible=$diff
    $eyedropBtn.Visible=-not $diff
    $dirRow.Visible=-not $diff
    $hueModeCheck.Visible=-not $diff
    $clearRefsBtn.Visible=$diff
    if($diff) {
        $tuneHint.Text='画面が正常な時に「① 正常な状態を記録」を押すだけで設定完了です。昼と夜で映り方が変わる場合は、夜にも「＋ 別の正常も追加」を押してください。異常を画面に出せる場合は「② 異常を記録」で、感度も自動で合わせます。'
        $recordOkBtn.Text='① 正常な状態を記録'
        $recordNgBtn.Text='② 異常を記録（任意）'
        $meterTitle.Text='正常と違っている部分の割合（黄色い線＝しきい値、緑▼＝記録した正常、赤▼＝記録した異常）'
        $sensLabel.Text='違いの感度：'
        $sensHint.Text='感度を上げる → 小さな違いでもNGにする ／ 下げる → はっきりした違いだけNGにする。映像の赤い部分が「違う」と判断された場所です。'
        $ngLabel.Text='NGにする変化の割合：'
    } else {
        $tuneHint.Text='画面に「正常」が映っている時に①を、「異常」が映っている時に②を押すだけで、色・感度・しきい値・検知の条件を自動で決めます。'
        $recordOkBtn.Text='① 正常（OK）の状態を記録'
        $recordNgBtn.Text='② 異常（NG）の状態を記録'
        $meterTitle.Text='今の一致率（黄色い線＝しきい値、緑▼＝記録したOK、赤▼＝記録したNG）'
        $sensLabel.Text='検出の感度：'
        $sensHint.Text='感度を上げる → 少し違う色も「一致」とみなす（一致率が上がる）／ 下げる → ほぼ同じ色だけを「一致」とみなす'
        $ngLabel.Text='一致率のしきい値：'
    }
    UpdateNGHintText $a
}

function LoadAreaSettingsIntoSliders {
    $a=Get-SelectedArea
    $script:suppressEvents=$true
    try {
        $en=($null -ne $a)
        foreach($c in @($rbModeDiff,$rbModeColor,$rbAppear,$rbDisappear,$sensTrack,$ngTrack,$hueModeCheck,$confirmBox,$secBox,$typeCombo,$volTrack,$test,$highlightBtn,$eyedropBtn,$recordOkBtn,$addOkBtn,$recordNgBtn,$clearRefsBtn)) { $c.Enabled=$en }
        if($en) {
            if($a.Mode -eq 'diff') { $rbModeDiff.Checked=$true } else { $rbModeColor.Checked=$true }
            if($a.Direction -eq 'disappear') { $rbDisappear.Checked=$true } else { $rbAppear.Checked=$true }
            $sens=$(if($a.Mode -eq 'diff'){$a.DiffSensitivity}else{$a.Sensitivity})
            $thr=$(if($a.Mode -eq 'diff'){$a.DiffThreshold}else{$a.NGThreshold})
            $sensTrack.Value=$sens
            $sensPercentLabel.Text=$sens.ToString()
            $ngTrack.Value=$thr
            $ngPercentLabel.Text=$thr.ToString()+'%'
            $hueModeCheck.Checked=$a.HueMatchMode
            $confirmBox.Value=[decimal]$a.ConfirmFrames
            $recordNgBtn.Enabled=($a.Mode -ne 'diff') -or ($a.DiffRefs.Count -gt 0)
            $addOkBtn.Enabled=($a.DiffRefs.Count -gt 0)
            $clearRefsBtn.Enabled=($a.DiffRefs.Count -gt 0)
            $g2.Group.Text=('② 検出の設定：'+$a.Name)
            $g3.Group.Text=('③ ブザー：'+$a.Name)
            $areaSettingsLabel.Text=($a.Name+' の設定を編集中')
            $secBox.Value=[decimal]$a.BuzzerSeconds
            $typeCombo.SelectedIndex=[Math]::Max(0,[Math]::Min(7,$a.BuzzerType))
            $volTrack.Value=$a.BuzzerVolume
            $volPercentLabel.Text=$a.BuzzerVolume.ToString()+'%'
        } else {
            $rbModeDiff.Checked=$true
            $rbAppear.Checked=$true
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
        Update-ModeUI $a
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
    if(-not (Test-AreaReady $a)) {
        $meterValueLabel.Text='未設定'
        $meterValueLabel.ForeColor=[System.Drawing.Color]::FromArgb(255,190,110)
        return
    }
    if($a.Occluded -or ($null -eq $a.LastRatio)) {
        $meterValueLabel.Text='－'
        $meterValueLabel.ForeColor=$textSecondary
        return
    }
    $isNG=Test-RatioIsNG $a $a.LastRatio
    $prefix=$(if($a.Mode -eq 'diff'){'違い '}else{''})
    $meterValueLabel.Text=($prefix+$a.LastRatio.ToString('0.0')+'%　→ '+$(if($isNG){'NG'}else{'OK'}))
    $meterValueLabel.ForeColor=$(if($isNG){[System.Drawing.Color]::FromArgb(255,120,120)}else{[System.Drawing.Color]::FromArgb(140,220,150)})
}

function Draw-DiffOverlay($bmp,$a) {
    # 「正常と違う」と判断したブロックを赤く塗って、何を見て判定しているか分かるようにする
    if(-not $a.LastMap -or $a.DiffGridW -le 0) { return }
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    $br=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(130,255,40,40))
    try {
        $gw=$a.DiffGridW; $gh=$a.DiffGridH
        for($b=0;$b -lt $a.LastMap.Length;$b++) {
            if($a.LastMap[$b] -lt 0.5) { continue }
            $bx=$b % $gw; $by=[int][Math]::Floor($b/$gw)
            $x0=[int][Math]::Floor($bx*$bmp.Width/$gw); $x1=[int][Math]::Floor(($bx+1)*$bmp.Width/$gw)
            $y0=[int][Math]::Floor($by*$bmp.Height/$gh); $y1=[int][Math]::Floor(($by+1)*$bmp.Height/$gh)
            $g.FillRectangle($br,$x0,$y0,[Math]::Max(1,$x1-$x0),[Math]::Max(1,$y1-$y0))
        }
    } finally { $br.Dispose(); $g.Dispose() }
}

function Update-LiveRatioFromPreview {
    # 設定を変えた直後に、今のプレビュー画像で計算し直す（新しく撮影はしない）
    $a=Get-SelectedArea
    if(-not $a -or $script:running) { return }
    UpdateAreaPreview
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
        $hidden=Test-AreaOccluded $a.Rect
        if($script:running) {
            # 監視中は、監視タイマーが計算した値・違いの場所をそのまま使う
        } elseif($hidden) {
            $a.Occluded=$true
            $a.LastRatio=$null
            $a.LastMap=$null
        } else {
            $a.Occluded=$false
            $a.LastRatio=Get-AreaRatio $bmp $a -WithMap
        }
        if($a.Mode -eq 'diff' -and -not $hidden -and -not $script:eyedropper) { Draw-DiffOverlay $bmp $a }
        $old=$areaPreviewBox.Image
        $areaPreviewBox.Image=$bmp
        if($old) { $old.Dispose() }
        if(-not (Test-AreaOnScreen $a.Rect)) {
            $info+="`r`n⚠ 画面の外にはみ出しています。「範囲を選び直す」で選び直してください。"
        } elseif($hidden) {
            $info+="`r`n⚠ この画面の下に隠れています。この画面を動かすか「ミニ表示」にしてください。"
        } elseif($a.Mode -eq 'diff' -and $a.DiffRefs.Count -gt 0) {
            $info+="`r`n赤い部分＝正常と違うと判断した場所"
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
    try { [NgWin77]::KeepAwake($false) } catch {}
    Update-RunButtons
    $areaList.Invalidate()
    if($reasonText) { SetStatusPanel $colorIdle $textOnIdle $reasonText }
}

function Set-AreaRect($a,$rect) {
    # 範囲が変わったら、その範囲用の見本・作業用の画像は作り直す
    $a.Rect=$rect
    Clear-AreaBuffers $a
    Clear-DiffReference $a
    $gw=0; $gh=0
    [NgDiff77]::GridFor($rect.Width,$rect.Height,[ref]$gw,[ref]$gh)
    $a.DiffGridW=$gw; $a.DiffGridH=$gh
}

function Test-CanRecord($a) {
    if(-not $a) { return $false }
    if(-not (Test-AreaOnScreen $a.Rect)) {
        [void](Show-Message '監視範囲が画面の外にはみ出しています。先に「範囲を選び直す」で選び直してください。' ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return $false
    }
    return $true
}

function Record-DiffOK($a,[switch]$Append) {
    # 「正常」の見本を記録する。約1.5秒のあいだに何枚か撮り、平均と「普段のちらつき」を覚える。
    if(-not (Test-CanRecord $a)) { return $false }
    if($Append -and $a.DiffRefs.Count -ge $script:maxDiffRefs) {
        [void](Show-Message ('正常の見本は '+$script:maxDiffRefs+' 枚までです。「詳しい設定」の「記録した正常の見本をすべて消す」で消してから記録し直してください。') ([System.Windows.Forms.MessageBoxIcon]::Information))
        return $false
    }
    if($a.DiffGridW -le 0) { Set-AreaRect $a $a.Rect }
    try {
        $frames=Capture-DiffFrames $a $script:okFrameCount 150 ($a.Name+'：正常な状態を記録中')
    } catch {
        [void](Show-Message ('画面を撮影できませんでした。'+"`r`n"+$_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return $false
    }
    $ref=[NgDiff77]::BuildReference($frames)
    Reset-AreaWithLog $a 'NG解除（正常の見本を記録）'
    if(-not $Append) { $a.DiffRefs.Clear(); $a.DiffOkFrames=$null; $a.DiffNgMeans=$null }
    [void]$a.DiffRefs.Add($ref)
    Update-DiffRefArray $a
    $all=New-Object System.Collections.ArrayList
    if($a.DiffOkFrames) { foreach($fr in $a.DiffOkFrames) { [void]$all.Add($fr) } }
    foreach($fr in $frames) { [void]$all.Add($fr) }
    $a.DiffOkFrames=[float[][]]$all.ToArray([float[]])
    Update-SampleRatios $a
    $n=$a.DiffRefs.Count
    $a.TuneColor=[System.Drawing.Color]::FromArgb(140,220,150)
    $a.TuneText=('正常の見本を記録しました（全部で '+$n+' 枚）。これで監視できます。'+"`r`n"+'異常を画面に出せる場合は「② 異常を記録」を押すと、感度をさらに合わせられます。')
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $areaList.Invalidate()
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：正常の見本を記録しました（'+$n+'枚）')
    return $true
}

function Record-DiffNG($a) {
    # 「異常」を1回見せてもらい、正常と異常がいちばんはっきり分かれる感度・しきい値にする
    if(-not (Test-CanRecord $a)) { return }
    if($a.DiffRefs.Count -eq 0) {
        [void](Show-Message '先に、画面が正常な時に「① 正常な状態を記録」を押してください。' ([System.Windows.Forms.MessageBoxIcon]::Information))
        return
    }
    try {
        $frames=Capture-DiffFrames $a 3 150 ($a.Name+'：異常な状態を記録中')
    } catch {
        [void](Show-Message ('画面を撮影できませんでした。'+"`r`n"+$_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return
    }
    $ng=[NgDiff77]::BuildReference($frames)[0]   # 3枚の平均
    $a.DiffNgMeans=$ng
    $okFrames=$a.DiffOkFrames
    if(-not $okFrames) { $okFrames=New-Object 'float[][]' 0 }
    $res=[NgDiff77]::Tune($a.DiffRefArray,$okFrames,$ng)
    $okMax=[math]::Round($res[1],1); $ngScore=[math]::Round($res[2],1)
    if(($ngScore-$okMax) -lt 1.5) {
        $a.TuneColor=[System.Drawing.Color]::FromArgb(255,150,150)
        $a.TuneText='正常と異常の映像にほとんど違いがありませんでした。異常がきちんと画面に映っている時に押し直すか、範囲をもっと小さく囲んでください。'
        Update-SampleRatios $a
        Update-TuneLabel $a
        $meterBox.Invalidate()
        return
    }
    Reset-AreaWithLog $a 'NG解除（自動調整）'
    $a.DiffSensitivity=[int]$res[0]
    $a.DiffThreshold=[Math]::Max(1,[Math]::Min(100,[int][Math]::Round(($okMax+$ngScore)/2)))
    $gap=$ngScore-$okMax
    if($gap -ge 15) { $quality='◎ 正常と異常の差が大きく、安定して判定できます。'; $qc=[System.Drawing.Color]::FromArgb(140,220,150) }
    elseif($gap -ge 5) { $quality='○ 判定できます。'; $qc=[System.Drawing.Color]::FromArgb(140,220,150) }
    else { $quality='△ 差が小さいため、誤判定のおそれがあります。異常の部分だけを小さく囲み直すと安定します。'; $qc=[System.Drawing.Color]::FromArgb(255,190,110) }
    $a.TuneColor=$qc
    $a.TuneText=('自動調整しました：正常時 '+$okMax+'% ／ 異常時 '+$ngScore+'% → '+$a.DiffThreshold+'% 以上違ったらNG（感度 '+$a.DiffSensitivity+'）'+"`r`n"+$quality)
    Update-SampleRatios $a
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $areaList.Invalidate()
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：自動調整が完了しました')
}

function Invoke-AutoTune($a) {
    $res=[NgVision77]::AutoTune($a.OkSnap,$a.NgSnap,$a.Color)
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
            Set-AreaRect $a (New-Object System.Drawing.Rectangle(($a.Rect.X+$cx0),($a.Rect.Y+$cy0),$crop.Width,$crop.Height))
            $res2=[NgVision77]::AutoTune($a.OkSnap,$a.NgSnap,$a.Color)
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
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：自動調整が完了しました')
}

function Record-ColorSample($kind) {
    $a=Get-SelectedArea
    if(-not (Test-CanRecord $a)) { return }
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

function New-AreaName {
    # 「エリアN」が今ある名前と重ならないようにする（エリア2を消した後などに同じ名前が2つできていた）
    do {
        $script:areaCounter++
        $name='エリア'+$script:areaCounter
    } while(@($script:areas | Where-Object { $_.Name -eq $name }).Count -gt 0)
    return $name
}

function Update-SettingsPathLabel {
    $settingsPathLabel.Text=('設定は自動で保存されます：'+$script:settingsPath)
}

function Set-AreaMode($mode) {
    $a=Get-SelectedArea
    if(-not $a -or $a.Mode -eq $mode) { return }
    Reset-AreaWithLog $a 'NG解除（判定のしかたを変更）'
    $a.Mode=$mode
    $a.TuneText=$null
    $a.LastRatio=$null
    $a.LastMap=$null
    Update-SampleRatios $a
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $areaList.Invalidate()
    Mark-SettingsDirty
    $msg=$(if($mode -eq 'diff'){'：「正常な映像と比べる」にしました'}else{'：「色で判定する」にしました。「かんたん設定」でOK/NGを記録してください'})
    SetStatusPanel $colorReady $textOnReady ($a.Name+$msg)
}

function Start-AreaSetupWizard($a) {
    # エリアを追加した直後に、質問1つで設定を終わらせる
    $ans=Show-Message ($a.Name+" を追加しました。`r`n`r`n今、このエリアの映像は「正常」ですか？`r`n`r`n「はい」を押すと、今の映像を正常の見本として記録して、設定が完了します。`r`n（約2秒かかります。その間、画面を動かさないでください）`r`n`r`n今が正常でない場合は「いいえ」を押し、正常になってから②の「① 正常な状態を記録」を押してください。") ([System.Windows.Forms.MessageBoxIcon]::Question) ([System.Windows.Forms.MessageBoxButtons]::YesNo)
    if($ans -eq [System.Windows.Forms.DialogResult]::Yes) {
        if(Record-DiffOK $a) {
            SetStatusPanel $colorReady $textOnReady ($a.Name+'：設定完了！「▶ 監視スタート」で監視できます。')
        }
    } else {
        SetStatusPanel $colorReady $textOnReady ($a.Name+'を追加しました。画面が正常な時に「① 正常な状態を記録」を押してください。')
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
        $swColor=$(if($a.Mode -eq 'diff'){[System.Drawing.Color]::FromArgb(88,166,255)}else{$a.Color})
        $swBrush=New-Object System.Drawing.SolidBrush($swColor)
        $e.Graphics.FillRectangle($swBrush,($b.X+$pad),($b.Y+[int](($b.Height-$sw)/2)),$sw,$sw)
        $swBrush.Dispose()
        $textY=$b.Y+[int](($b.Height-$script:areaListNameFont.Height)/2)
        $dirText=$(if($a.Mode -eq 'diff'){'[比]'}elseif($a.Direction -eq 'disappear'){'[消]'}else{'[出]'})
        $e.Graphics.DrawString(($dirText+' '+$a.Name),$script:areaListNameFont,$script:areaListNameBrush,($b.X+$pad*2+$sw),$textY)
        $word=$(if($a.Mode -eq 'diff'){'違い '}else{'一致率 '})
        $ratioText=$(if($null -ne $a.LastRatio -and -not $a.Occluded){$word+$a.LastRatio.ToString('0.0')+'%'}else{$word+'－'})
        $ratioText+=(' ／ しきい値 '+(Get-JudgeThreshold $a)+'%')
        $e.Graphics.DrawString($ratioText,$script:areaListNameFont,$script:areaListSubBrush,($b.X+[int]($b.Width*0.40)),$textY)
        if(-not (Test-AreaReady $a)) { $st='未設定'; $br=$script:areaListWarnBrush }
        elseif($a.Occluded) { $st='重なり'; $br=$script:areaListWarnBrush }
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
    # 「比べる」の値は小さいことが多いので、目盛りの最大を自動で合わせる（色で判定は 0～100%）
    $scale=100.0
    if($a.Mode -eq 'diff') {
        $want=[Math]::Max(10.0,(Get-JudgeThreshold $a)*4.0)
        foreach($v in @($a.LastRatio,$a.NgRatio)) { if($null -ne $v) { $want=[Math]::Max($want,[double]$v*1.2) } }
        $scale=[Math]::Min(100.0,[Math]::Ceiling($want/10.0)*10.0)
    }
    if($null -ne $a.LastRatio -and -not $a.Occluded) {
        $fillW=[int]($inner*[Math]::Min($scale,[double]$a.LastRatio)/$scale)
        $isNG=Test-RatioIsNG $a $a.LastRatio
        $fillColor=$(if($isNG){[System.Drawing.Color]::FromArgb(210,60,60)}else{[System.Drawing.Color]::FromArgb(46,160,67)})
        $br=New-Object System.Drawing.SolidBrush($fillColor)
        $g.FillRectangle($br,$pad,($pad+(Px 8)),$fillW,($h-2*$pad-(Px 8)))
        $br.Dispose()
    }
    # 記録したOK/NGの位置（▼）
    foreach($m in @(@($a.OkRatio,[System.Drawing.Color]::FromArgb(140,220,150)),@($a.NgRatio,[System.Drawing.Color]::FromArgb(255,120,120)))) {
        if($null -eq $m[0]) { continue }
        $x=$pad+[int]($inner*[Math]::Min($scale,[double]$m[0])/$scale)
        $br=New-Object System.Drawing.SolidBrush($m[1])
        $pts=[System.Drawing.Point[]]@((New-Object System.Drawing.Point(($x-(Px 5)),0)),(New-Object System.Drawing.Point(($x+(Px 5)),0)),(New-Object System.Drawing.Point($x,(Px 8))))
        $g.FillPolygon($br,$pts)
        $br.Dispose()
    }
    # しきい値の線
    $tx=$pad+[int]($inner*[Math]::Min($scale,(Get-JudgeThreshold $a))/$scale)
    $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,210,60),(Px 3))
    $g.DrawLine($pen,$tx,0,$tx,$h)
    $pen.Dispose()
    if($scale -lt 100) {
        $fnt=UIFont 7.5
        $txt=('最大 '+$scale+'%')
        $sz=$g.MeasureString($txt,$fnt)
        $g.DrawString($txt,$fnt,$script:areaListSubBrush,($w-$sz.Width-(Px 2)),($h-$sz.Height))
        $fnt.Dispose()
    }
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
            Update-SettingsPathLabel
            SetStatusPanel $colorReady $textOnReady ('設定を保存しました：'+[System.IO.Path]::GetFileName($dlg.FileName)+'（これからはこのファイルに自動保存します）')
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
            Update-SettingsPathLabel
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
            # 「色で判定」に切り替えた時のために、範囲の平均色も覚えておく
            $bmp=GrabBitmap $script:area
            $rgb=[NgVision77]::AverageColor($bmp)
            $bmp.Dispose()
            $newArea=New-MonitorArea (New-AreaName) $script:area ([System.Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2]))
            Set-AreaRect $newArea $script:area
            [void]$script:areas.Add($newArea)
            $areaList.SelectedIndex=-1
            RefreshAreaListUI
            $areaList.SelectedIndex=$script:areas.Count-1
            Mark-SettingsDirty
            Start-AreaSetupWizard $newArea
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
            Clear-AreaSamples $a
            Set-AreaRect $a $script:area
            RefreshAreaListUI
            Mark-SettingsDirty
            if($a.Mode -eq 'diff') { Start-AreaSetupWizard $a }
            else { SetStatusPanel $colorReady $textOnReady ($a.Name+'の範囲を選び直しました。「かんたん設定」をやり直してください。') }
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
        Mark-SettingsDirty
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
    Mark-SettingsDirty
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
    $rgb=[NgVision77]::AverageColorAt([System.Drawing.Bitmap]$img,$ix,$iy,2)
    $a.Color=[System.Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2])
    Update-SampleRatios $a
    Mark-SettingsDirty
    Set-Eyedropper $false
    Update-ColorLabel $a
    Update-TuneLabel $a
    Update-LiveRatioFromPreview
    SetStatusPanel $colorReady $textOnReady ($a.Name+'の検出する色を R'+$rgb[0]+' G'+$rgb[1]+' B'+$rgb[2]+' に変更しました')
})

$recordOkBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    if($a.Mode -eq 'diff') {
        if($a.DiffRefs.Count -gt 0) {
            $ans=Show-Message ("記録済みの正常の見本（"+$a.DiffRefs.Count+"枚）を、今の映像で置き換えます。よろしいですか？`r`n`r`n（昼・夜など、今までの見本も残したい場合は「いいえ」を押して「＋ 別の正常も追加」を使ってください）") ([System.Windows.Forms.MessageBoxIcon]::Question) ([System.Windows.Forms.MessageBoxButtons]::YesNo)
            if($ans -ne [System.Windows.Forms.DialogResult]::Yes) { return }
        }
        [void](Record-DiffOK $a)
    } else {
        Record-ColorSample 'OK'
    }
})
$addOkBtn.Add_Click({
    $a=Get-SelectedArea
    if($a) { [void](Record-DiffOK $a -Append) }
})
$recordNgBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    if($a.Mode -eq 'diff') { Record-DiffNG $a } else { Record-ColorSample 'NG' }
})
$clearRefsBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    $ans=Show-Message ($a.Name+' の正常の見本をすべて消しますか？（消した後は記録し直すまで監視できません）') ([System.Windows.Forms.MessageBoxIcon]::Question) ([System.Windows.Forms.MessageBoxButtons]::YesNo)
    if($ans -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    Reset-AreaWithLog $a 'NG解除（見本の削除）'
    Clear-DiffReference $a
    $a.TuneText=$null
    Update-SampleRatios $a
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $areaList.Invalidate()
    Mark-SettingsDirty
})
$rbModeDiff.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbModeDiff.Checked) { return }
    Set-AreaMode 'diff'
})
$rbModeColor.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbModeColor.Checked) { return }
    Set-AreaMode 'color'
})
$advancedCheck.Add_CheckedChanged({ $advancedPanel.Visible=$advancedCheck.Checked })

$sensTrack.Add_ValueChanged({
    $sensPercentLabel.Text=$sensTrack.Value.ToString()
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    if($a.Mode -eq 'diff') { $a.DiffSensitivity=$sensTrack.Value } else { $a.Sensitivity=$sensTrack.Value }
    Update-SampleRatios $a
    Update-LiveRatioFromPreview
    Mark-SettingsDirty
})
$hueModeCheck.Add_CheckedChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.HueMatchMode=$hueModeCheck.Checked
    Update-SampleRatios $a
    Update-LiveRatioFromPreview
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：'+$(if($hueModeCheck.Checked){'明るさの変化に強い判定（色味）にしました'}else{'通常の判定（明るさも考慮）に戻しました'}))
})
$rbAppear.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbAppear.Checked) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.Direction='appear'
    Reset-AreaWithLog $a 'NG解除（設定変更）'
    UpdateNGHintText $a
    Update-LiveRatioFromPreview
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：色が「出たら」NGにする設定にしました')
})
$rbDisappear.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbDisappear.Checked) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.Direction='disappear'
    Reset-AreaWithLog $a 'NG解除（設定変更）'
    UpdateNGHintText $a
    Update-LiveRatioFromPreview
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：色が「消えたら」NGにする設定にしました')
})
$ngTrack.Add_ValueChanged({
    $ngPercentLabel.Text=$ngTrack.Value.ToString()+'%'
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    if($a.Mode -eq 'diff') { $a.DiffThreshold=$ngTrack.Value } else { $a.NGThreshold=$ngTrack.Value }
    Mark-SettingsDirty
    Update-MeterLabel
    $meterBox.Invalidate()
    $areaList.Invalidate()
})
$confirmBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.ConfirmFrames=[int]$confirmBox.Value
    Mark-SettingsDirty
})
$intervalBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $script:monitorIntervalSec=[double]$intervalBox.Value
    $timer.Interval=[int]([math]::Round($script:monitorIntervalSec*1000))
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ('監視間隔を '+$script:monitorIntervalSec+'秒 に変更しました')
})
$secBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.BuzzerSeconds=[int]$secBox.Value
    Mark-SettingsDirty
})
$typeCombo.Add_SelectedIndexChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.BuzzerType=$typeCombo.SelectedIndex
    Mark-SettingsDirty
})
$volTrack.Add_ValueChanged({
    $volPercentLabel.Text=$volTrack.Value.ToString()+'%'
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.BuzzerVolume=$volTrack.Value
    Mark-SettingsDirty
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
$autoStartCheck.Add_CheckedChanged({ $script:autoStart=$autoStartCheck.Checked; Save-WindowState })
$saveImagesCheck.Add_CheckedChanged({ $script:saveImages=$saveImagesCheck.Checked; Save-WindowState })
$openImagesBtn.Add_Click({
    try {
        if(-not (Test-Path -LiteralPath $script:imageDir)) { [void](New-Item -ItemType Directory -Path $script:imageDir -Force) }
        Start-Process -FilePath $script:imageDir -ErrorAction Stop
    } catch {
        [void](Show-Message '画像フォルダを開けませんでした。' ([System.Windows.Forms.MessageBoxIcon]::Warning))
    }
})
$openLogBtn.Add_Click({
    try {
        [void](Flush-NGLog)
        Write-NGLogHeaderIfNeeded
        Start-Process -FilePath $script:logPath -ErrorAction Stop
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
    $notReady=@($script:areas | Where-Object { -not (Test-AreaReady $_) } | ForEach-Object { $_.Name })
    if($notReady.Count -gt 0) {
        [void](Show-Message (($notReady -join '、')+" は、まだ正常の見本を記録していません。`r`n`r`n一覧でそのエリアを選び、画面が正常な時に②の「① 正常な状態を記録」を押してください。") ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return
    }
    Save-SettingsIfDirty -Now
    foreach($a in $script:areas) { Reset-AreaRuntime $a; $a.LastRatio=$null }
    try { [NgWin77]::KeepAwake($true) } catch {}
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
        $newNGs=New-Object System.Collections.ArrayList
        $notReady=New-Object System.Collections.ArrayList
        $offScreen=New-Object System.Collections.ArrayList
        foreach($a in $script:areas) {
            if(-not (Test-AreaReady $a)) {
                # 監視中に見本を消した・追加したばかり等。判定できないので知らせる（以前は「すべて正常」と表示していた）
                $a.LastRatio=$null
                [void]$notReady.Add($a.Name)
            } elseif(-not (Test-AreaOnScreen $a.Rect)) {
                # モニターが外れた・配置が変わった。画面外は真っ黒に写り、誤ってNGになるため判定しない
                $a.CaptureFailed=$true
                [void]$offScreen.Add($a.Name)
            } elseif(Test-AreaOccluded $a.Rect) {
                # 自分の画面を検査してしまわないよう、重なっている間は判定しない（前の状態を保つ）
                $a.Occluded=$true
                [void]$occluded.Add($a.Name)
            } else {
                $a.Occluded=$false
                try {
                    $bmp=GrabBitmapForArea $a
                    $ratio=Get-AreaRatio $bmp $a -WithMap:(-not $script:miniMode)
                    $a.CaptureFailed=$false
                    if(Update-AreaJudgement $a $ratio $nowTime $nowText) { [void]$newNGs.Add($a) }
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

        foreach($a in $newNGs) { Save-NGImage $a $nowTime }
        if($newNGs.Count -gt 0) {
            # 新しくNGになったエリアがあれば、そのエリアの音で鳴らす
            $newNG=$newNGs[0]
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
        } elseif($offScreen.Count -gt 0) {
            SetStatusPanel $colorWarn $textOnWarn ('⚠ 「'+($offScreen -join '、')+'」が画面の外にあり監視できません。モニターの接続・配置を確認し、「範囲を選び直す」をしてください。')
        } elseif($notReady.Count -gt 0) {
            SetStatusPanel $colorWarn $textOnWarn ('⚠ 「'+($notReady -join '、')+'」は正常の見本が無いため監視できていません。「① 正常な状態を記録」を押してください。')
        } elseif($script:logWriteBlocked) {
            SetStatusPanel $colorWarn $textOnWarn '監視中（すべて正常）｜ ⚠ ログのCSVが開かれていて書き込めません。Excelを閉じると自動で書き込みます。'
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
        Save-SettingsIfDirty
        if($script:pendingLogRows.Count -gt 0) { [void](Flush-NGLog) }
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
    Save-PendingLogOnExit
    try { [NgWin77]::KeepAwake($false) } catch {}
    Save-SettingsIfDirty -Now
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
Update-SettingsPathLabel
Remove-OldNGImages
if($script:autoStart -and $script:areas.Count -gt 0) {
    # 起動直後は画面（カメラの映像）が出そろうまで少し待ってから始める
    $autoStartTimer=New-Object System.Windows.Forms.Timer
    $autoStartTimer.Interval=3000
    $autoStartTimer.Add_Tick({
        $autoStartTimer.Stop()
        if(-not $script:running) { $start.PerformClick() }
    })
    $f.Add_Shown({ SetStatusPanel $colorReady $textOnReady '3秒後に自動で監視をスタートします…'; $autoStartTimer.Start() })
}
$timer.Start()
$previewTimer.Start()

[void]$f.ShowDialog()
$notifyIcon.Dispose()
try { $script:instanceMutex.ReleaseMutex() } catch {}

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
