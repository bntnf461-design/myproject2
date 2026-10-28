# NG MONITOR - v85 画面を整理して分かりやすく（よく使う物だけ表示・あまり使わない設定は折りたたみ）
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
if (-not ([System.Management.Automation.PSTypeName]'NgVision79').Type) {
Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
// NOTE: Windows PowerShell 5.1 compiles this with the C# 5 compiler.
// Do not use C# 6+ syntax ($"...", =>, out var, ?., nameof).
public static class NgVision79 {
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

    // For the "registered images" window: inside the area (ax,ay,aw,ah) keep the pixels
    // that count as the target colour and darken / grey out the others, so the user can
    // see where the colour is found. Same colour test as RatioBuf (per pixel, a guide).
    public static void MarkColor(Bitmap bmp, int ax, int ay, int aw, int ah, Color target, double sensitivity, bool hueMode) {
        int tr = target.R, tg = target.G, tb = target.B;
        bool useHue = hueMode && IsChromatic(tr, tg, tb);
        double th, ts, tv;
        RgbToHsv(tr, tg, tb, out th, out ts, out tv);
        double minSat = Math.Max(0.08, ts * 0.35);
        double thr = useHue ? HueThreshold(sensitivity) : RgbThreshold(sensitivity);
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        try {
            int stride = Math.Abs(data.Stride);
            byte[] buf = new byte[stride * bmp.Height];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);
            int x0 = Math.Max(0, ax), y0 = Math.Max(0, ay);
            int x1 = Math.Min(bmp.Width, ax + aw), y1 = Math.Min(bmp.Height, ay + ah);
            for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) {
                int i = y * stride + x * 4;
                double d = Dist(buf[i + 2], buf[i + 1], buf[i], tr, tg, tb, useHue, th, ts, minSat);
                if (d <= thr) continue;
                int l = (int)(0.3 * (0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i]));
                buf[i] = buf[i + 1] = buf[i + 2] = (byte)l;
            }
            Marshal.Copy(buf, 0, data.Scan0, buf.Length);
        } finally {
            bmp.UnlockBits(data);
        }
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
public static class NgWin79 {
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
public static class NgBlock79 {
    public static void GridFor(int w, int h, out int gw, out int gh) {
        double bs = Math.Max(3.0, Math.Sqrt((double)w * h / 400.0));
        gw = Math.Max(1, (int)Math.Ceiling(w / bs));
        gh = Math.Max(1, (int)Math.Ceiling(h / bs));
    }

    public static float[] BlockMeans(Bitmap bmp, int gw, int gh) {
        int stride, bpp;
        byte[] buf = NgVision79.ReadPixels(bmp, out stride, out bpp);
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
        // Colour is left out only when one picture is in colour and the other is not
        // (a camera that switches to black-and-white infrared at night). When both are
        // nearly colourless (a dim, greyish scene) colour is still compared, so a red
        // lamp that lights up at about the same brightness is not missed.
        double cr = colR / nb, cc = colC * g / nb, cMax = Math.Max(cr, cc);
        bool useColour = !(cMax >= 4.0 && Math.Min(cr, cc) < 0.35 * cMax);
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

// v79 "compare with the normal picture", second generation.
//  - two scales: a fine grid (about 4800 cells, for small defects) and the
//    coarse grid of v77 (about 400 blocks, for faint but large changes in the dark)
//  - the picture is captured with a few extra pixels around the area and
//    aligned (up to +-3 px) to the normal picture before comparing, so a
//    slightly shifted picture / shaking camera does not look like a change
//  - the score is the size of the LARGEST CONNECTED changed region (% of the
//    area), so scattered noise never adds up while a small solid defect counts
//  - each cell's learned flicker is spread to its neighbours and has a floor
// A reference ("normal picture") is { fine, fineNoise, coarse, coarseNoise };
// references recorded by v77/v78 have only the coarse pair (fine = empty).
public static class NgDiff79 {
    public const int FineCells = 4800, CoarseCells = 400, MaxShift = 3;

    public static void GridFor(int w, int h, int cells, out int gw, out int gh) {
        double bs = Math.Max(cells >= 1000 ? 1.0 : 3.0, Math.Sqrt((double)w * h / cells));
        gw = Math.Max(1, (int)Math.Ceiling(w / bs));
        gh = Math.Max(1, (int)Math.Ceiling(h / bs));
    }

    // ---- integral image: the mean of any rectangle in O(1) ----
    public sealed class Integral {
        public int W, H; public double[] R, G, B;
        public Integral(byte[] buf, int w, int h, int stride, int bpp) {
            W = w; H = h; int n = (w + 1) * (h + 1);
            R = new double[n]; G = new double[n]; B = new double[n];
            for (int y = 0; y < h; y++) {
                double sr = 0, sg = 0, sb = 0; int row = y * stride;
                for (int x = 0; x < w; x++) {
                    int i = row + x * bpp;
                    if (i + 2 < buf.Length) { sb += buf[i]; sg += buf[i + 1]; sr += buf[i + 2]; }
                    int o = (y + 1) * (w + 1) + (x + 1), u = y * (w + 1) + (x + 1);
                    R[o] = R[u] + sr; G[o] = G[u] + sg; B[o] = B[u] + sb;
                }
            }
        }
        public void Mean(int x0, int y0, int x1, int y1, float[] m, int b) {
            int s = W + 1; double n = (double)(x1 - x0) * (y1 - y0);
            if (n <= 0) { m[b * 3] = m[b * 3 + 1] = m[b * 3 + 2] = 0; return; }
            int a = y0 * s + x0, c = y0 * s + x1, d = y1 * s + x0, e = y1 * s + x1;
            m[b * 3]     = (float)((R[e] - R[c] - R[d] + R[a]) / n);
            m[b * 3 + 1] = (float)((G[e] - G[c] - G[d] + G[a]) / n);
            m[b * 3 + 2] = (float)((B[e] - B[c] - B[d] + B[a]) / n);
        }
    }

    // Brightness-only integral image, used for the (frequent) shift search.
    public sealed class LumIntegral {
        public int W, H; public double[] Y;
        public LumIntegral(byte[] buf, int w, int h, int stride, int bpp) {
            W = w; H = h; Y = new double[(w + 1) * (h + 1)];
            for (int y = 0; y < h; y++) {
                double s = 0; int row = y * stride;
                for (int x = 0; x < w; x++) {
                    int i = row + x * bpp;
                    if (i + 2 < buf.Length) s += 0.114 * buf[i] + 0.587 * buf[i + 1] + 0.299 * buf[i + 2];
                    Y[(y + 1) * (w + 1) + x + 1] = Y[y * (w + 1) + x + 1] + s;
                }
            }
        }
    }

    static int[] Edges(int len, int cells) {
        int[] e = new int[cells + 1];
        for (int i = 0; i <= cells; i++) e[i] = (int)(((long)i * len + cells - 1) / cells);
        return e;
    }

    static float[] LumMeans(LumIntegral li, int ox, int oy, int[] ex, int[] ey) {
        int gw = ex.Length - 1, gh = ey.Length - 1, s = li.W + 1;
        float[] m = new float[gw * gh];
        for (int by = 0; by < gh; by++) {
            int y0 = Math.Max(0, oy + ey[by]), y1 = Math.Min(li.H, oy + ey[by + 1]);
            for (int bx = 0; bx < gw; bx++) {
                int x0 = Math.Max(0, ox + ex[bx]), x1 = Math.Min(li.W, ox + ex[bx + 1]);
                double n = (double)(x1 - x0) * (y1 - y0);
                m[by * gw + bx] = n <= 0 ? 0f : (float)((li.Y[y1 * s + x1] - li.Y[y0 * s + x1] - li.Y[y1 * s + x0] + li.Y[y0 * s + x0]) / n);
            }
        }
        return m;
    }

    static double LumCost(float[] refY, float[] cur) { return LumCost(refY, cur, null); }

    static double LumCost(float[] refY, float[] cur, float[] mask) {
        double sr = 0, sc = 0; int n = 0;
        for (int b = 0; b < cur.Length; b++) { if (mask != null && mask[b] > 0.5f) continue; sr += refY[b]; sc += cur[b]; n++; }
        if (n == 0) return 0;
        double g = sc > 1 ? sr / sc : 1;
        g = Math.Max(0.75, Math.Min(1.33, g));
        double cost = 0;
        for (int b = 0; b < cur.Length; b++) { if (mask != null && mask[b] > 0.5f) continue; cost += Math.Min(40.0, Math.Abs(refY[b] - cur[b] * g)); }
        return cost / n;
    }

    // Cells (of a gw x gh grid over an iw x ih area) that the user excluded.
    // rects = { x, y, w, h, x, y, w, h, ... } in area pixels. A cell is excluded
    // when at least 30% of it is covered. Returns null when nothing is excluded.
    public static float[] CellMask(int iw, int ih, int gw, int gh, int[] rects) {
        if (rects == null || rects.Length < 4) return null;
        int[] ex = Edges(iw, gw), ey = Edges(ih, gh);
        float[] m = new float[gw * gh]; bool any = false;
        for (int by = 0; by < gh; by++) for (int bx = 0; bx < gw; bx++) {
            int x0 = ex[bx], x1 = ex[bx + 1], y0 = ey[by], y1 = ey[by + 1];
            double area = Math.Max(1, (x1 - x0) * (y1 - y0)), cov = 0;
            for (int r = 0; r + 3 < rects.Length; r += 4) {
                int ox = Math.Max(0, Math.Min(x1, rects[r] + rects[r + 2]) - Math.Max(x0, rects[r]));
                int oy = Math.Max(0, Math.Min(y1, rects[r + 1] + rects[r + 3]) - Math.Max(y0, rects[r + 1]));
                cov += ox * oy;
            }
            if (cov / area >= 0.3) { m[by * gw + bx] = 1f; any = true; }
        }
        return any ? m : null;
    }

    static void ApplyMask(float[] v, float[] mask) {
        if (mask == null || mask.Length != v.Length) return;
        for (int b = 0; b < v.Length; b++) if (mask[b] > 0.5f) v[b] = 0f;
    }

    // Find the picture shift (up to MaxShift px) that best matches the reference:
    // first every 2 px, then +-1 px around the best one.
    static void FindShift(LumIntegral li, float[] refY, int ix, int iy, int[] ex, int[] ey,
                          int dxMin, int dxMax, int dyMin, int dyMax, out int bdx, out int bdy) {
        FindShift(li, refY, ix, iy, ex, ey, dxMin, dxMax, dyMin, dyMax, null, out bdx, out bdy);
    }

    static void FindShift(LumIntegral li, float[] refY, int ix, int iy, int[] ex, int[] ey,
                          int dxMin, int dxMax, int dyMin, int dyMax, float[] mask, out int bdx, out int bdy) {
        bdx = 0; bdy = 0;
        double best = LumCost(refY, LumMeans(li, ix, iy, ex, ey), mask);
        int cx = 0, cy = 0;
        for (int pass = 0; pass < 2; pass++) {
            int step = pass == 0 ? 2 : 1, cx0 = cx, cy0 = cy;
            for (int dy = cy0 - step; dy <= cy0 + step; dy += step) for (int dx = cx0 - step; dx <= cx0 + step; dx += step) {
                if ((dx == 0 && dy == 0) || dx < dxMin || dx > dxMax || dy < dyMin || dy > dyMax) continue;
                double c = LumCost(refY, LumMeans(li, ix + dx, iy + dy, ex, ey), mask) + 0.01 * (Math.Abs(dx) + Math.Abs(dy));
                if (c < best) { best = c; bdx = dx; bdy = dy; }
            }
            cx = bdx; cy = bdy;
            if (pass == 0 && (dxMax - dxMin) > 4) {   // reach +-3: also try the far corners of the 2-px grid
                for (int dy = -2; dy <= 2; dy += 2) foreach (int dx in new int[] { -3, 3 }) {
                    if (dx < dxMin || dx > dxMax || dy < dyMin || dy > dyMax) continue;
                    double c = LumCost(refY, LumMeans(li, ix + dx, iy + dy, ex, ey), mask) + 0.01 * (Math.Abs(dx) + Math.Abs(dy));
                    if (c < best) { best = c; bdx = dx; bdy = dy; cx = dx; cy = dy; }
                }
            }
        }
    }

    static float[] ToLum(float[] m) {
        float[] y = new float[m.Length / 3];
        for (int b = 0; b < y.Length; b++) y[b] = (float)(0.299 * m[b * 3] + 0.587 * m[b * 3 + 1] + 0.114 * m[b * 3 + 2]);
        return y;
    }

    // Cell means of the inner window (ox,oy,iw,ih). Cell boundaries are the same
    // as NgBlock79.BlockMeansBuf, so v77/v78 coarse references stay valid.
    public static float[] Means(Integral ii, int ox, int oy, int iw, int ih, int gw, int gh) {
        float[] m = new float[gw * gh * 3];
        for (int by = 0; by < gh; by++) {
            int y0 = oy + (int)(((long)by * ih + gh - 1) / gh), y1 = oy + (int)(((long)(by + 1) * ih + gh - 1) / gh);
            for (int bx = 0; bx < gw; bx++) {
                int x0 = ox + (int)(((long)bx * iw + gw - 1) / gw), x1 = ox + (int)(((long)(bx + 1) * iw + gw - 1) / gw);
                ii.Mean(Math.Max(0, x0), Math.Max(0, y0), Math.Min(ii.W, x1), Math.Min(ii.H, y1), m, by * gw + bx);
            }
        }
        return m;
    }

    // { fine, coarse } cell means of the inner window, no alignment (used when recording).
    public static float[][] SampleBuf(byte[] buf, int bw, int bh, int stride, int bpp, int ix, int iy, int iw, int ih) {
        var ii = new Integral(buf, bw, bh, stride, bpp);
        int fw, fh, cw, ch;
        GridFor(iw, ih, FineCells, out fw, out fh); GridFor(iw, ih, CoarseCells, out cw, out ch);
        return new float[][] { Means(ii, ix, iy, iw, ih, fw, fh), Means(ii, ix, iy, iw, ih, cw, ch) };
    }
    public static float[][] Sample(Bitmap bmp, int ix, int iy, int iw, int ih) {
        int stride, bpp;
        byte[] buf = NgVision79.ReadPixels(bmp, out stride, out bpp);
        return SampleBuf(buf, bmp.Width, bmp.Height, stride, bpp, ix, iy, iw, ih);
    }

    // From several { fine, coarse } samples of the normal state build a reference.
    public static float[][] BuildReference(float[][][] samples, int iw, int ih) {
        int fw, fh, cw, ch;
        GridFor(iw, ih, FineCells, out fw, out fh); GridFor(iw, ih, CoarseCells, out cw, out ch);
        float[][] fine = new float[samples.Length][], coarse = new float[samples.Length][];
        for (int i = 0; i < samples.Length; i++) { fine[i] = samples[i][0]; coarse[i] = samples[i][1]; }
        float[][] f = OneScale(fine, fw, fh), c = OneScale(coarse, cw, ch);
        return new float[][] { f[0], f[1], c[0], c[1] };
    }

    static float[][] OneScale(float[][] frames, int gw, int gh) {
        int n3 = frames[0].Length, nb = n3 / 3;
        float[] mean = new float[n3];
        foreach (float[] fr in frames) for (int i = 0; i < n3; i++) mean[i] += fr[i] / frames.Length;
        float[] noise = new float[nb];
        foreach (float[] fr in frames) {
            float[] d = NgBlock79.BlockDist(mean, fr, null);
            for (int b = 0; b < nb; b++) if (d[b] > noise[b]) noise[b] = d[b];
        }
        // spread to neighbours (edges that happened to be still during recording)
        float[] spread = new float[nb];
        for (int y = 0; y < gh; y++) for (int x = 0; x < gw; x++) {
            float mx = 0;
            for (int yy = Math.Max(0, y - 1); yy <= Math.Min(gh - 1, y + 1); yy++)
                for (int xx = Math.Max(0, x - 1); xx <= Math.Min(gw - 1, x + 1); xx++) mx = Math.Max(mx, noise[yy * gw + xx]);
            spread[y * gw + x] = Math.Max(noise[y * gw + x], 0.6f * mx);
        }
        // floor: never assume a cell is quieter than the typical cell
        float[] sorted = (float[])spread.Clone(); Array.Sort(sorted);
        float floor = sorted[nb / 2];
        for (int b = 0; b < nb; b++) spread[b] = Math.Max(spread[b], floor);
        return new float[][] { mean, spread };
    }

    // Per-cell "how clearly changed" (0..1) for one scale.
    static float[] CellScores(float[] refm, float[] noise, float[] cur, double sens) {
        int nb = refm.Length / 3;
        float[] bright = new float[nb];
        float[] d = NgBlock79.BlockDist(refm, cur, bright);
        float[] v = new float[nb];
        for (int b = 0; b < nb; b++) {
            double thr = NgBlock79.Threshold(sens, noise[b], bright[b]);
            if (MaxCh(refm, b) >= 248 || MaxCh(cur, b) >= 248) thr = thr * 2.0 + 20.0;
            double ramp = Math.Max(2.0, 0.25 * thr);
            double s = (d[b] - thr) / (2.0 * ramp) + 0.5;
            v[b] = (float)(s < 0 ? 0 : (s > 1 ? 1 : s));
        }
        return v;
    }

    // Largest 8-connected region of changed cells: its weight as % of all cells.
    // keep (optional) receives 1 for the cells of that region (for the preview overlay).
    public static double LargestRegion(float[] v, int gw, int gh, float[] keep) {
        int nb = gw * gh;
        int[] label = new int[nb];
        int[] stack = new int[nb];
        double best = 0; int bestLabel = 0, next = 0;
        for (int s = 0; s < nb; s++) {
            if (v[s] < 0.5f || label[s] != 0) continue;
            next++; double mass = 0; int sp = 0; stack[sp++] = s; label[s] = next;
            while (sp > 0) {
                int c = stack[--sp]; mass += v[c];
                int cx = c % gw, cy = c / gw;
                for (int yy = Math.Max(0, cy - 1); yy <= Math.Min(gh - 1, cy + 1); yy++)
                    for (int xx = Math.Max(0, cx - 1); xx <= Math.Min(gw - 1, cx + 1); xx++) {
                        int q = yy * gw + xx;
                        if (label[q] == 0 && v[q] >= 0.5f) { label[q] = next; stack[sp++] = q; }
                    }
            }
            if (mass > best) { best = mass; bestLabel = next; }
        }
        if (keep != null) for (int b = 0; b < nb; b++) keep[b] = (bestLabel != 0 && label[b] == bestLabel) ? 1f : (v[b] >= 0.5f ? 0.5f : 0f);
        return 100.0 * best / nb;
    }

    // Score of already-aligned cell means against all references (closest wins).
    // refs = { fine0, fineNoise0, coarse0, coarseNoise0, fine1, ... } (fine may be empty for old references)
    public static double ScoreSample(float[][] refs, float[] fine, float[] coarse, int iw, int ih, double sens, float[] mapFine) {
        return ScoreSample2(refs, fine, coarse, null, null, iw, ih, sens, mapFine);
    }

    static float[] MinOf(float[] a, float[] b) {
        if (b == null) return a;
        float[] r = new float[a.Length];
        for (int i = 0; i < a.Length; i++) r[i] = Math.Min(a[i], b[i]);
        return r;
    }

    // fine2/coarse2 (optional): the same picture WITHOUT shift correction. A cell only
    // counts as changed if it differs both with and without the correction:
    //  - the camera picture moved a little  -> unchanged after correction
    //  - overlays of the viewer (clock, labels) did not move -> unchanged without it
    //  - a real defect                      -> changed either way
    static double ScoreSample2(float[][] refs, float[] fine, float[] coarse, float[] fine2, float[] coarse2, int iw, int ih, double sens, float[] mapFine) {
        return ScoreSample3(refs, fine, coarse, fine2, coarse2, iw, ih, sens, mapFine, null, null);
    }

    public static double ScoreSampleMasked(float[][] refs, float[] fine, float[] coarse, int iw, int ih, double sens, float[] fineMask, float[] coarseMask) {
        return ScoreSample3(refs, fine, coarse, null, null, iw, ih, sens, null, fineMask, coarseMask);
    }

    static float[] Cells(float[] refm, float[] noise, float[] a, float[] b, double sens, float[] mask) {
        float[] v = MinOf(CellScores(refm, noise, a, sens), b == null ? null : CellScores(refm, noise, b, sens));
        ApplyMask(v, mask);
        return v;
    }

    static double ScoreSample3(float[][] refs, float[] fine, float[] coarse, float[] fine2, float[] coarse2, int iw, int ih, double sens, float[] mapFine, float[] fineMask, float[] coarseMask) {
        int fw, fh, cw, ch;
        GridFor(iw, ih, FineCells, out fw, out fh); GridFor(iw, ih, CoarseCells, out cw, out ch);
        double best = double.MaxValue;
        float[] tmp = mapFine == null ? null : new float[mapFine.Length];
        for (int k = 0; k + 3 < refs.Length; k += 4) {
            double sc = 0;
            bool hasFine = refs[k].Length == fine.Length && refs[k].Length > 0;
            if (hasFine) sc = LargestRegion(Cells(refs[k], refs[k + 1], fine, fine2, sens, fineMask), fw, fh, tmp);
            if (refs[k + 2].Length == coarse.Length) {
                float[] cv = Cells(refs[k + 2], refs[k + 3], coarse, coarse2, sens, coarseMask);
                double cs = LargestRegion(cv, cw, ch, null);
                if (cs > sc) {
                    sc = cs;
                    if (tmp != null) UpsampleMap(cv, cw, ch, tmp, fw, fh);
                }
            } else if (!hasFine) continue;
            if (sc < best) { best = sc; if (mapFine != null) Array.Copy(tmp, mapFine, mapFine.Length); }
        }
        return best == double.MaxValue ? -1 : best;
    }

    static void UpsampleMap(float[] cv, int cw, int ch, float[] dst, int fw, int fh) {
        for (int y = 0; y < fh; y++) for (int x = 0; x < fw; x++)
            dst[y * fw + x] = cv[Math.Min(ch - 1, y * ch / fh) * cw + Math.Min(cw - 1, x * cw / fw)] >= 0.5f ? 1f : 0f;
    }

    // Full pipeline on a captured picture that includes a margin around the area:
    // find the shift (up to MaxShift px) that best matches each reference, then score.
    public static double ScoreImage(float[][] refs, Bitmap bmp, int ix, int iy, int iw, int ih, double sens, float[] mapFine) {
        int stride, bpp;
        byte[] buf = NgVision79.ReadPixels(bmp, out stride, out bpp);
        return ScoreImageBuf(refs, buf, bmp.Width, bmp.Height, stride, bpp, ix, iy, iw, ih, sens, mapFine);
    }

    public static double ScoreImageBuf(float[][] refs, byte[] buf, int bw, int bh, int stride, int bpp,
                                       int ix, int iy, int iw, int ih, double sens, float[] mapFine) {
        return ScoreImageBufEx(refs, buf, bw, bh, stride, bpp, ix, iy, iw, ih, sens, mapFine, null, null, 0, 0);
    }

    public static double ScoreImageEx(float[][] refs, Bitmap bmp, int ix, int iy, int iw, int ih, double sens, float[] mapFine,
                                      float[] fineMask, float[] coarseMask, double adaptRate, double adaptBelow) {
        int stride, bpp;
        byte[] buf = NgVision79.ReadPixels(bmp, out stride, out bpp);
        return ScoreImageBufEx(refs, buf, bmp.Width, bmp.Height, stride, bpp, ix, iy, iw, ih, sens, mapFine, fineMask, coarseMask, adaptRate, adaptBelow);
    }

    // fineMask / coarseMask (optional): cells the user excluded (1 = ignore).
    // adaptRate > 0: when the picture is clearly normal (score below adaptBelow), the
    // matching reference follows the picture very slowly, cell by cell, but only in
    // cells that look unchanged. Slow lighting drift over hours is followed; sudden
    // changes and anything judged NG are never absorbed. (The caller keeps the
    // recorded references untouched and passes working copies.)
    public static double ScoreImageBufEx(float[][] refs, byte[] buf, int bw, int bh, int stride, int bpp,
                                         int ix, int iy, int iw, int ih, double sens, float[] mapFine,
                                         float[] fineMask, float[] coarseMask, double adaptRate, double adaptBelow) {
        var ii = new Integral(buf, bw, bh, stride, bpp);
        var li = new LumIntegral(buf, bw, bh, stride, bpp);
        int fw, fh, cw, ch;
        GridFor(iw, ih, FineCells, out fw, out fh); GridFor(iw, ih, CoarseCells, out cw, out ch);
        int dxMin = -Math.Min(MaxShift, ix), dxMax = Math.Min(MaxShift, bw - ix - iw);
        int dyMin = -Math.Min(MaxShift, iy), dyMax = Math.Min(MaxShift, bh - iy - ih);
        int[] fex = Edges(iw, fw), fey = Edges(ih, fh), cex = Edges(iw, cw), cey = Edges(ih, ch);
        double best = double.MaxValue;
        int bestK = -1; float[] bestFine = null, bestCoarse = null, bestF2 = null, bestC2 = null;
        float[] tmp = mapFine == null ? null : new float[mapFine.Length];
        float[] fine0 = null, coarse0 = null;
        for (int k = 0; k + 3 < refs.Length; k += 4) {
            bool useFine = refs[k].Length == fw * fh * 3;
            float[] refY = ToLum(useFine ? refs[k] : refs[k + 2]);
            int bdx, bdy;
            FindShift(li, refY, ix, iy, useFine ? fex : cex, useFine ? fey : cey, dxMin, dxMax, dyMin, dyMax, useFine ? fineMask : coarseMask, out bdx, out bdy);
            float[] fine = Means(ii, ix + bdx, iy + bdy, iw, ih, fw, fh);
            float[] coarse = Means(ii, ix + bdx, iy + bdy, iw, ih, cw, ch);
            float[] f2 = null, c2 = null;
            if (bdx != 0 || bdy != 0) {
                if (fine0 == null) { fine0 = Means(ii, ix, iy, iw, ih, fw, fh); coarse0 = Means(ii, ix, iy, iw, ih, cw, ch); }
                f2 = fine0; c2 = coarse0;
            }
            float[][] one = new float[][] { refs[k], refs[k + 1], refs[k + 2], refs[k + 3] };
            double s = ScoreSample3(one, fine, coarse, f2, c2, iw, ih, sens, tmp, fineMask, coarseMask);
            if (s >= 0 && s < best) {
                best = s; bestK = k; bestFine = fine; bestCoarse = coarse; bestF2 = f2; bestC2 = c2;
                if (mapFine != null) Array.Copy(tmp, mapFine, mapFine.Length);
            }
        }
        if (bestK >= 0 && adaptRate > 0 && best < adaptBelow) {
            if (refs[bestK].Length == bestFine.Length && bestFine.Length > 0)
                Follow(refs[bestK], Cells(refs[bestK], refs[bestK + 1], bestFine, bestF2, sens, fineMask), bestFine, adaptRate);
            if (refs[bestK + 2].Length == bestCoarse.Length)
                Follow(refs[bestK + 2], Cells(refs[bestK + 2], refs[bestK + 3], bestCoarse, bestC2, sens, coarseMask), bestCoarse, adaptRate);
        }
        return best == double.MaxValue ? -1 : best;
    }

    static void Follow(float[] refm, float[] v, float[] cur, double rate) {
        int nb = v.Length;
        for (int b = 0; b < nb; b++) {
            if (v[b] > 0.1f) continue;          // looks changed: never learn it
            for (int c = 0; c < 3; c++) refm[b * 3 + c] += (float)(rate * (cur[b * 3 + c] - refm[b * 3 + c]));
        }
    }

    // ===== "the abnormal screen appeared" detection =====
    // ngRefs : references of the abnormal screen(s)   { fine, fineNoise, coarse, coarseNoise } x n
    // okRefs : references of the normal screen(s) (optional, may be empty)
    // Score (0-100) = how much the area looks like the abnormal screen. When a normal
    // screen is known, only the cells where the abnormal screen differs from the
    // normal one (e.g. the alarm banner / popup) are judged, so screens that share
    // the same layout do not match by accident.
    public static double MatchImage(float[][] ngRefs, float[][] okRefs, Bitmap bmp, int ix, int iy, int iw, int ih, double sens, float[] mapFine) {
        int stride, bpp;
        byte[] buf = NgVision79.ReadPixels(bmp, out stride, out bpp);
        return MatchImageBuf(ngRefs, okRefs, buf, bmp.Width, bmp.Height, stride, bpp, ix, iy, iw, ih, sens, mapFine);
    }

    public static double MatchImageBuf(float[][] ngRefs, float[][] okRefs, byte[] buf, int bw, int bh, int stride, int bpp,
                                       int ix, int iy, int iw, int ih, double sens, float[] mapFine) {
        return MatchImageBufEx(ngRefs, okRefs, buf, bw, bh, stride, bpp, ix, iy, iw, ih, sens, mapFine, null);
    }

    public static double MatchImageEx(float[][] ngRefs, float[][] okRefs, Bitmap bmp, int ix, int iy, int iw, int ih, double sens, float[] mapFine, float[] fineMask) {
        int stride, bpp;
        byte[] buf = NgVision79.ReadPixels(bmp, out stride, out bpp);
        return MatchImageBufEx(ngRefs, okRefs, buf, bmp.Width, bmp.Height, stride, bpp, ix, iy, iw, ih, sens, mapFine, fineMask);
    }

    public static double MatchImageBufEx(float[][] ngRefs, float[][] okRefs, byte[] buf, int bw, int bh, int stride, int bpp,
                                         int ix, int iy, int iw, int ih, double sens, float[] mapFine, float[] fineMask) {
        var ii = new Integral(buf, bw, bh, stride, bpp);
        var li = new LumIntegral(buf, bw, bh, stride, bpp);
        int fw, fh;
        GridFor(iw, ih, FineCells, out fw, out fh);
        int dxMin = -Math.Min(MaxShift, ix), dxMax = Math.Min(MaxShift, bw - ix - iw);
        int dyMin = -Math.Min(MaxShift, iy), dyMax = Math.Min(MaxShift, bh - iy - ih);
        int[] fex = Edges(iw, fw), fey = Edges(ih, fh);
        double best = -1;
        float[] tmp = mapFine == null ? null : new float[mapFine.Length];
        for (int k = 0; k + 3 < ngRefs.Length; k += 4) {
            if (ngRefs[k].Length != fw * fh * 3) continue;
            int bdx, bdy;
            FindShift(li, ToLum(ngRefs[k]), ix, iy, fex, fey, dxMin, dxMax, dyMin, dyMax, fineMask, out bdx, out bdy);
            float[] cur = Means(ii, ix + bdx, iy + bdy, iw, ih, fw, fh);
            double s = MatchCore(ngRefs[k], ngRefs[k + 1], okRefs, cur, sens, tmp, fineMask);
            if (s > best) { best = s; if (mapFine != null) Array.Copy(tmp, mapFine, mapFine.Length); }
        }
        return best;
    }

    // Already-aligned sample (used for recorded samples / tuning).
    public static double MatchSample(float[][] ngRefs, float[][] okRefs, float[] fine, double sens) {
        return MatchSampleMasked(ngRefs, okRefs, fine, sens, null);
    }

    public static double MatchSampleMasked(float[][] ngRefs, float[][] okRefs, float[] fine, double sens, float[] fineMask) {
        double best = -1;
        for (int k = 0; k + 3 < ngRefs.Length; k += 4) {
            if (ngRefs[k].Length != fine.Length) continue;
            best = Math.Max(best, MatchCore(ngRefs[k], ngRefs[k + 1], okRefs, fine, sens, null, fineMask));
        }
        return best;
    }

    // Cells where the abnormal screen clearly differs from EVERY recorded normal screen
    // (record other harmless screens, e.g. an info popup, as "normal" to exclude what they share).
    // Returns null when no normal screen is known (or they look the same): then all cells count.
    public static bool[] DistinctiveCells(float[] ngFine, float[][] okRefs, double sens) {
        if (okRefs == null) return null;
        int nb = ngFine.Length / 3, cnt = 0;
        bool[] mask = null;
        for (int j = 0; j + 3 < okRefs.Length; j += 4) {
            if (okRefs[j].Length != ngFine.Length) continue;
            float[] v = CellScores(okRefs[j], okRefs[j + 1], ngFine, sens);
            if (mask == null) { mask = new bool[nb]; for (int b = 0; b < nb; b++) mask[b] = true; }
            for (int b = 0; b < nb; b++) if (v[b] < 0.5f) mask[b] = false;
        }
        if (mask == null) return null;
        for (int b = 0; b < nb; b++) if (mask[b]) cnt++;
        if (cnt < Math.Max(4, nb / 500)) return null;
        return mask;
    }

    static double MatchCore(float[] ngFine, float[] ngNoise, float[][] okRefs, float[] cur, double sens, float[] map, float[] userMask) {
        int nb = ngFine.Length / 3;
        float[] v = CellScores(ngFine, ngNoise, cur, sens);      // 1 = this cell differs from the abnormal screen
        bool[] mask = DistinctiveCells(ngFine, okRefs, sens);
        double sum = 0; int n = 0;
        for (int b = 0; b < nb; b++) {
            bool use = (mask == null || mask[b]) && (userMask == null || userMask.Length != nb || userMask[b] <= 0.5f);
            if (map != null) map[b] = use ? 1f - v[b] : 0f;     // overlay: parts that look like the abnormal screen
            if (!use) continue;
            sum += 1.0 - v[b]; n++;
        }
        return n == 0 ? 0 : 100.0 * sum / n;
    }

    // With an NG sample: choose the LEAST sensitive setting that still separates
    // the NG sample clearly from the OK samples (most robust against everyday
    // variation that the short recording did not see).
    // okSamples / ng are { fine, coarse } pairs. Returns { sensitivity, okMax, ngScore }.
    public static double[] Tune(float[][] refs, float[][][] okSamples, float[][] ng, int iw, int ih) {
        return TuneMasked(refs, okSamples, ng, iw, ih, null, null);
    }

    public static double[] TuneMasked(float[][] refs, float[][][] okSamples, float[][] ng, int iw, int ih, float[] fineMask, float[] coarseMask) {
        double[] ok = new double[21], ngs = new double[21], gap = new double[21];
        double maxGap = 0;
        for (int i = 0; i <= 20; i++) {
            int s = i * 5;
            double okMax = 0;
            if (okSamples != null) foreach (float[][] o in okSamples) okMax = Math.Max(okMax, ScoreSampleMasked(refs, o[0], o[1], iw, ih, s, fineMask, coarseMask));
            ok[i] = okMax; ngs[i] = ScoreSampleMasked(refs, ng[0], ng[1], iw, ih, s, fineMask, coarseMask);
            gap[i] = ngs[i] - 3.0 * okMax;
            if (gap[i] > maxGap) maxGap = gap[i];
        }
        for (int i = 0; i <= 20; i++)
            if (maxGap > 0 && gap[i] >= 0.7 * maxGap && ok[i] <= 0.05) return new double[] { i * 5, ok[i], ngs[i] };
        int bi = 10;
        for (int i = 0; i <= 20; i++) if (gap[i] > gap[bi]) bi = i;
        return new double[] { bi * 5, ok[bi], ngs[bi] };
    }

    static double Y(float[] m, int b) { return 0.299 * m[b * 3] + 0.587 * m[b * 3 + 1] + 0.114 * m[b * 3 + 2]; }
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
$colorIdle      = [System.Drawing.Color]::FromArgb(27,38,56)      # 紺：まだ何もしていない
$colorReady     = [System.Drawing.Color]::FromArgb(56,46,14)      # 黄土：準備できた
$colorRunning   = [System.Drawing.Color]::FromArgb(15,51,38)      # 深緑：正常に監視中
$colorWarn      = [System.Drawing.Color]::FromArgb(74,44,10)      # 橙：監視できていないエリアがある
$colorAlarm     = [System.Drawing.Color]::FromArgb(214,40,52)     # 赤：異常検知！
$colorAcked     = [System.Drawing.Color]::FromArgb(92,30,36)      # くすんだ赤：NGを確認済み（元に戻るのを待っている）
$colorGreenBtn  = [System.Drawing.Color]::FromArgb(46,160,67)
$colorRedBtn    = [System.Drawing.Color]::FromArgb(200,45,45)
$colorBlueBtn   = [System.Drawing.Color]::FromArgb(0,112,192)
$colorYellowBtn = [System.Drawing.Color]::FromArgb(255,193,7)
$colorGrayBtn   = [System.Drawing.Color]::FromArgb(60,80,102)
$textOnReady    = [System.Drawing.Color]::FromArgb(253,224,138)
$textOnIdle     = [System.Drawing.Color]::FromArgb(203,213,225)
$textOnError    = [System.Drawing.Color]::FromArgb(255,157,157)
$textOnRunning  = [System.Drawing.Color]::FromArgb(110,231,183)
$textOnWarn     = [System.Drawing.Color]::FromArgb(245,180,83)
$textOnAcked    = [System.Drawing.Color]::FromArgb(255,208,208)

# ---- ダーク系の背景テーマ ----
$formBgDark    = [System.Drawing.Color]::FromArgb(7,11,20)
$cardBgDark    = [System.Drawing.Color]::FromArgb(14,22,38)
$headerBgDark  = [System.Drawing.Color]::FromArgb(11,17,30)
$accentBlue    = [System.Drawing.Color]::FromArgb(88,166,255)
$textPrimary   = [System.Drawing.Color]::FromArgb(226,232,240)
$textSecondary = [System.Drawing.Color]::FromArgb(148,163,184)
$inputBgDark   = [System.Drawing.Color]::FromArgb(27,38,56)

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
$script:maskMode = $false         # プレビューの上をドラッグして「除外する場所」を囲んでいる
$script:maskDragStart = $null
$script:maskDragNow = $null
$script:lastErrorLogAt = [datetime]::MinValue
$script:lastErrorDialogAt = [datetime]::MinValue
$script:lastStatusText = $null
$script:suppressEvents = $false
$script:imageDir = Join-Path $PSScriptRoot 'ng_images'
$script:refImageDir = Join-Path $PSScriptRoot 'ref_images'   # 登録した時の画面（エリアごとのフォルダ）
$script:lastRefImagePath = $null
$script:saveImages = $true        # NGの時に画像を保存する（このPCの設定）
$script:autoStart = $false        # 起動したら自動で監視を始める（このPCの設定）
$script:settingsDirty = $false    # 設定が変わった → 少し待ってから自動保存する
$script:dirtySince = [datetime]::MinValue
$script:autoSaveFailed = $false
$script:pendingLogRows = New-Object System.Collections.ArrayList   # まだCSVに書けていないログの行
$script:logWriteBlocked = $false
$script:okFrameCount = 10         # 「正常」を記録する時に撮る枚数（約1.5秒）
$script:longFrameCount = 150      # 「長めに記録」の時に撮る枚数（約30秒。動くアーム・人の出入りなども覚える）
$script:maxMasks = 20             # 1つのエリアに指定できる「除外する場所」の数
$script:today = @{ Date=(Get-Date).Date; Count=0; TotalSec=0.0; Last=$null }   # 今日のNGの集計（画面上部に表示）
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

function Reset-TodayIfNeeded {
    if($script:today.Date -ne (Get-Date).Date) { $script:today=@{ Date=(Get-Date).Date; Count=0; TotalSec=0.0; Last=$null } }
}

function Add-TodayEvent($eventType,$durationSec,$time) {
    # 今日のNGの回数・NGだった時間を数える（画面上部の「今日」の表示用）
    Reset-TodayIfNeeded
    if($time -and ([datetime]$time).Date -ne $script:today.Date) { return }
    $et=[string]$eventType
    if($et -eq 'NG発生') {
        $script:today.Count=$script:today.Count+1
        $script:today.Last=$time
    } elseif($et.StartsWith('NG解除') -and $null -ne $durationSec) {
        $script:today.TotalSec=$script:today.TotalSec+[double]$durationSec
    }
}

function Read-TodayStatsFromLog {
    # 起動した時に、今日のぶんをログのCSVから読み直す（再起動しても「今日」の集計が消えないように）
    $script:today=@{ Date=(Get-Date).Date; Count=0; TotalSec=0.0; Last=$null }
    try {
        if(-not (Test-Path -LiteralPath $script:logPath)) { return }
        $prefix='"'+(Get-Date -Format 'yyyy-MM-dd')
        $re=New-Object System.Text.RegularExpressions.Regex('^"([^"]*)","(?:[^"]|"")*","([^"]*)","[^"]*","([^"]*)"')
        foreach($line in [System.IO.File]::ReadAllLines($script:logPath,[System.Text.Encoding]::UTF8)) {
            if(-not $line.StartsWith($prefix)) { continue }
            $m=$re.Match($line)
            if(-not $m.Success) { continue }
            $t=[datetime]::MinValue
            if(-not [datetime]::TryParseExact($m.Groups[1].Value,'yyyy-MM-dd HH:mm:ss',[System.Globalization.CultureInfo]::InvariantCulture,[System.Globalization.DateTimeStyles]::None,[ref]$t)) { continue }
            $d=$null
            $dv=0.0
            if([double]::TryParse($m.Groups[3].Value,[System.Globalization.NumberStyles]::Float,[System.Globalization.CultureInfo]::InvariantCulture,[ref]$dv)) { $d=$dv }
            Add-TodayEvent $m.Groups[2].Value $d $t
        }
    } catch {}
}

function Format-Duration($sec) {
    $s=[int][Math]::Floor([double]$sec)
    if($s -lt 60) { return ($s.ToString()+'秒') }
    if($s -lt 3600) { return ([int][Math]::Floor($s/60)).ToString()+'分'+($s % 60).ToString()+'秒' }
    return ([int][Math]::Floor($s/3600)).ToString()+'時間'+([int][Math]::Floor(($s % 3600)/60)).ToString()+'分'
}

function Get-TodaySummaryText {
    Reset-TodayIfNeeded
    $now=Get-Date
    $total=[double]$script:today.TotalSec
    foreach($a in $script:areas) {
        if($a.WasNG -and $a.NGSince) {
            $from=$(if($a.NGSince -lt $script:today.Date){$script:today.Date}else{$a.NGSince})
            $total+=($now-$from).TotalSeconds
        }
    }
    $text='今日のNG：'+$script:today.Count+'回　｜　NGだった時間：'+(Format-Duration $total)
    if($script:today.Last) { $text+='　｜　最後のNG：'+([datetime]$script:today.Last).ToString('HH:mm') }
    return $text
}

function Write-NGLogRow($timestamp,$areaName,$eventType,$ratio,$durationSec) {
    Add-TodayEvent $eventType $durationSec (Get-Date)
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
        Id=[guid]::NewGuid().ToString('N')   # 登録した画像のフォルダ名（名前を変えても変わらない）
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
        DiffThreshold=0.15     # 「比べる」で、いちばん大きな「違う部分」が範囲のこの割合（%）以上ならNG
        DiffGridW=0            # 粗いマス目（約400）の数。v77/v78 の見本と同じ
        DiffGridH=0
        DiffFineW=0            # 細かいマス目（約4800）の数。小さな異常用
        DiffFineH=0
        # 「異常の画面が出たらNG」用
        MatchNgRefs=(New-Object System.Collections.ArrayList)   # 異常の画面の見本（複数可）
        MatchOkRefs=(New-Object System.Collections.ArrayList)   # 正常な画面の見本（任意・複数可）
        MatchSensitivity=50
        MatchThreshold=90      # 異常の画面との一致度がこの値（%）以上ならNG
        Masks=(New-Object System.Collections.ArrayList)   # 判定から外す場所（範囲の中の四角）。正常でも動くアーム・時計など
        AdaptDrift=$true       # 「比べる」：朝・夕方などの、ゆっくりした明るさの変化に自動で合わせる
        DiffRefs=(New-Object System.Collections.ArrayList)   # 正常の見本（各要素は {平均, ゆらぎ} の組）。昼・夜など複数可
        ConfirmFrames=2        # この回数だけ続けてNGになったらNG確定（瞬間的なノイズを無視）
        ScheduleOn=$false      # 決まった時間帯だけ監視する（例：20:00～翌6:00 に電源が入っていたら鳴らす）
        ScheduleStart='20:00'
        ScheduleEnd='06:00'    # 開始より前の時刻なら「翌日の」この時刻まで
        ScheduleDays=127       # 監視する曜日（日=1 月=2 火=4 水=8 木=16 金=32 土=64、開始時刻の曜日で判断）
        NGDelaySec=0           # NGの状態がこの秒数続いたら鳴らす（ドアの開けっぱなし等。0＝すぐ）
        RepeatMin=0            # NGの間、この分ごとに鳴らし直す（0＝1回だけ。「確認しました」で止まる）
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
        DiffOkFrames=$null     # 正常を記録した時の各コマ（{細かい, 粗い} の組の一覧）
        DiffNgMeans=$null      # 異常を記録した時の {細かい, 粗い}
        MatchNgArray=$null
        MatchOkArray=$null
        MatchNgSamples=$null   # 記録した異常の画面のコマ（この起動中だけ）
        MatchOkSamples=$null   # 記録した正常な画面のコマ（この起動中だけ）
        OkSnap=$null
        NgSnap=$null
        OkRatio=$null
        NgRatio=$null
        TuneText=$null
        TuneColor=$null
        MonBmp=$null
        MonGfx=$null
        MonBmpSize=(New-Object System.Drawing.Size(0,0))
        FineMask=$null         # 除外する場所を、判定のマス目ごとの印にしたもの
        CoarseMask=$null
        MaskReady=$false
        Acked=$false           # 今のNGを「確認しました」済み
        RawNGSince=$null       # NGの状態になり始めた時刻（待ち時間の計算用）
        LastBuzzAt=$null       # 最後に鳴らした時刻（鳴らし直し用）
        OutOfHours=$false      # 監視する時間帯の外
        Thumb=$null            # エリア一覧に出す小さな映像
        ThumbAt=[datetime]::MinValue
    }
}

function Reset-AreaRuntime($a) {
    $a.WasNG=$false
    $a.NGSince=$null
    $a.NGStreak=0
    $a.OKStreak=0
    $a.Occluded=$false
    $a.CaptureFailed=$false
    $a.Acked=$false
    $a.RawNGSince=$null
    $a.LastBuzzAt=$null
    $a.OutOfHours=$false
}

function ConvertTo-Minutes($text) {
    # 'HH:mm' → 0時からの分。読めない時は $null
    $m=[regex]::Match([string]$text,'^\s*(\d{1,2}):(\d{2})\s*$')
    if(-not $m.Success) { return $null }
    $h=[int]$m.Groups[1].Value; $mi=[int]$m.Groups[2].Value
    if($h -gt 23 -or $mi -gt 59) { return $null }
    return ($h*60+$mi)
}

function Test-AreaInSchedule($a,$now) {
    # 今が「監視する時間帯」の中かどうか。時間帯を使わない設定なら常に中。
    # 終了が開始より前（20:00～6:00 など）は日をまたぐ。曜日は「時間帯が始まった日」の曜日で見る。
    if(-not $a.ScheduleOn) { return $true }
    $st=ConvertTo-Minutes $a.ScheduleStart; $en=ConvertTo-Minutes $a.ScheduleEnd
    if($null -eq $st -or $null -eq $en) { return $true }
    $t=([datetime]$now).Hour*60+([datetime]$now).Minute
    $day=([datetime]$now).Date
    if($st -lt $en) { $in=($t -ge $st -and $t -lt $en) }
    elseif($st -gt $en) {
        if($t -ge $st) { $in=$true }
        elseif($t -lt $en) { $in=$true; $day=$day.AddDays(-1) }
        else { $in=$false }
    } else { $in=$true }   # 開始＝終了：一日中（曜日だけで決める）
    if(-not $in) { return $false }
    $bit=[int][Math]::Pow(2,[int]$day.DayOfWeek)
    return ((([int]$a.ScheduleDays) -band $bit) -ne 0)
}

function Get-ScheduleText($a) {
    if(-not $a.ScheduleOn) { return '' }
    $st=ConvertTo-Minutes $a.ScheduleStart; $en=ConvertTo-Minutes $a.ScheduleEnd
    $text=$(if($null -ne $st -and $null -ne $en -and $en -lt $st){$a.ScheduleStart+'～翌'+$a.ScheduleEnd}elseif($st -eq $en){'終日'}else{$a.ScheduleStart+'～'+$a.ScheduleEnd})
    $days=[int]$a.ScheduleDays
    if($days -ne 127) {
        $names=@('日','月','火','水','木','金','土')
        $sel=@(); for($i=0;$i -lt 7;$i++){ if(($days -band [int][Math]::Pow(2,$i)) -ne 0){ $sel+=$names[$i] } }
        $text+='（'+($sel -join '')+'）'
    }
    return $text
}

function Clear-AreaSamples($a) {
    try { if($a.OkSnap) { $a.OkSnap.Dispose() } } catch {}
    try { if($a.NgSnap) { $a.NgSnap.Dispose() } } catch {}
    $a.OkSnap=$null; $a.NgSnap=$null
    $a.OkRatio=$null; $a.NgRatio=$null
    $a.DiffOkFrames=$null; $a.DiffNgMeans=$null
    $a.MatchNgSamples=$null; $a.MatchOkSamples=$null
    $a.TuneText=$null; $a.TuneColor=$null
}

function Clear-MatchReference($a) {
    $a.MatchNgRefs.Clear(); $a.MatchOkRefs.Clear()
    $a.MatchNgArray=$null; $a.MatchOkArray=$null
    $a.MatchNgSamples=$null; $a.MatchOkSamples=$null
    $a.LastMap=$null
}

function ConvertTo-RefArray($list) {
    # 見本の一覧を {細かい, ゆらぎ, 粗い, ゆらぎ} x 枚数 の形に並べる
    $arr=New-Object 'float[][]' ($list.Count*4)
    for($i=0;$i -lt $list.Count;$i++) { for($j=0;$j -lt 4;$j++) { $arr[4*$i+$j]=$list[$i][$j] } }
    return ,$arr
}

function Update-MatchArrays($a) {
    $a.MatchNgArray=ConvertTo-RefArray $a.MatchNgRefs
    $a.MatchOkArray=ConvertTo-RefArray $a.MatchOkRefs
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
    # 判定用に {細かい0, ゆらぎ0, 粗い0, ゆらぎ0, 細かい1, ...} の形へ並べ直しておく。
    # 明るさの自動追従で少しずつ書き換わるので、記録した見本（保存する方）とは別の複製を使う。
    if($a.DiffRefs.Count -eq 0) { $a.DiffRefArray=$null; return }
    $arr=New-Object 'float[][]' ($a.DiffRefs.Count*4)
    for($i=0;$i -lt $a.DiffRefs.Count;$i++) { for($j=0;$j -lt 4;$j++) { $arr[4*$i+$j]=[float[]]$a.DiffRefs[$i][$j].Clone() } }
    $a.DiffRefArray=$arr
}

function Update-AreaMasks($a) {
    # 除外する場所（四角）を、判定のマス目ごとの「使わない」印に直しておく
    $a.FineMask=$null; $a.CoarseMask=$null; $a.MaskReady=$true
    if($a.Masks.Count -eq 0) { return }
    if($a.DiffFineW -le 0) { Set-AreaGrids $a }
    $list=New-Object 'System.Collections.Generic.List[int]'
    foreach($m in $a.Masks) { $list.Add([int]$m.X); $list.Add([int]$m.Y); $list.Add([int]$m.Width); $list.Add([int]$m.Height) }
    $r=$list.ToArray()
    $a.FineMask=[NgDiff79]::CellMask($a.Rect.Width,$a.Rect.Height,$a.DiffFineW,$a.DiffFineH,$r)
    $a.CoarseMask=[NgDiff79]::CellMask($a.Rect.Width,$a.Rect.Height,$a.DiffGridW,$a.DiffGridH,$r)
}

function Get-AdaptRate($a) {
    # 監視中だけ、見本を明るさのゆっくりした変化に合わせる（約100秒かけて追いつく速さ）。
    # 急な変化・NGと判断した部分は覚えない（NgDiff79.ScoreImageEx の中で判断）。
    if(-not $script:running -or -not $a.AdaptDrift) { return 0.0 }
    return [Math]::Min(0.02,[double]$script:monitorIntervalSec/100.0)
}

function Test-AreaReady($a) {
    if($a.Mode -eq 'diff') { return ($a.DiffRefs.Count -gt 0) }
    if($a.Mode -eq 'match') { return ($a.MatchNgRefs.Count -gt 0) }
    return $true
}

function Get-JudgeThreshold($a) {
    if($a.Mode -eq 'diff') { return [double]$a.DiffThreshold }
    if($a.Mode -eq 'match') { return [double]$a.MatchThreshold }
    return [double]$a.NGThreshold
}

function Get-JudgeDirection($a) {
    if($a.Mode -ne 'color') { return 'appear' }   # 「比べる」は違いが大きいほど、「異常の画面」は似ているほどNG
    return $a.Direction
}

function Get-AreaRatio($bmp,$a,[switch]$WithMap) {
    # 色で判定：指定した色に一致する割合（%）
    # 比べる　：正常の見本と違っている部分の割合（%）。見本が無ければ $null
    # 異常画面：異常の画面にどれだけ似ているか（%）。見本が無ければ $null
    if($a.Mode -eq 'match') {
        if(-not $a.MatchNgArray) { Update-MatchArrays $a }
        if($a.MatchNgRefs.Count -eq 0) { return $null }
        $off=Get-InnerOffset $bmp $a
        $map=$null
        if($WithMap) { $map=New-Object 'float[]' ($a.DiffFineW*$a.DiffFineH) }
        if(-not $a.MaskReady) { Update-AreaMasks $a }
        $score=[NgDiff79]::MatchImageEx($a.MatchNgArray,$a.MatchOkArray,$bmp,$off[0],$off[1],$a.Rect.Width,$a.Rect.Height,[double]$a.MatchSensitivity,$map,$a.FineMask)
        if($WithMap) { $a.LastMap=$map }
        if($score -lt 0) { return $null }
        return [math]::Round($score,1)
    }
    if($a.Mode -eq 'diff') {
        if(-not $a.DiffRefArray) { Update-DiffRefArray $a }
        if(-not $a.DiffRefArray) { return $null }
        $off=Get-InnerOffset $bmp $a
        $map=$null
        if($WithMap) { $map=New-Object 'float[]' ($a.DiffFineW*$a.DiffFineH) }
        if(-not $a.MaskReady) { Update-AreaMasks $a }
        $below=[Math]::Min(0.075,[double]$a.DiffThreshold*0.5)
        $score=[NgDiff79]::ScoreImageEx($a.DiffRefArray,$bmp,$off[0],$off[1],$a.Rect.Width,$a.Rect.Height,[double]$a.DiffSensitivity,$map,$a.FineMask,$a.CoarseMask,(Get-AdaptRate $a),$below)
        if($WithMap) { $a.LastMap=$map }
        if($score -lt 0) { return $null }
        return [math]::Round($score,2)
    }
    return [math]::Round([NgVision79]::Ratio($bmp,$a.Color,[double]$a.Sensitivity,[bool]$a.HueMatchMode),1)
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
    if($rawNG) {
        $a.NGStreak=$a.NGStreak+1; $a.OKStreak=0
        if(-not $a.RawNGSince) { $a.RawNGSince=$nowTime }
    } else { $a.OKStreak=$a.OKStreak+1; $a.NGStreak=0; $a.RawNGSince=$null }
    $need=[Math]::Max(1,[int]$a.ConfirmFrames)
    # 待ち時間：NGの状態が NGDelaySec 秒続いてから確定（ドアを開けてすぐ閉めた時などは鳴らさない）
    $waited=$(if($a.RawNGSince){(([datetime]$nowTime)-([datetime]$a.RawNGSince)).TotalSeconds}else{0})
    if((-not $a.WasNG) -and $a.NGStreak -ge $need -and $waited -ge [double]$a.NGDelaySec) {
        $a.WasNG=$true
        $a.NGSince=$nowTime
        $a.Acked=$false
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
        if(-not $a.MaskReady) { Update-AreaMasks $a }
        if($a.Mode -eq 'match') {
            if(-not $a.MatchNgArray) { Update-MatchArrays $a }
            $a.OkRatio=$null; $a.NgRatio=$null
            if($a.MatchNgRefs.Count -gt 0) {
                $sens=[double]$a.MatchSensitivity
                if($a.MatchOkSamples) {
                    $mx=0.0
                    foreach($fr in $a.MatchOkSamples) { $mx=[Math]::Max($mx,[NgDiff79]::MatchSampleMasked($a.MatchNgArray,$a.MatchOkArray,$fr[0],$sens,$a.FineMask)) }
                    $a.OkRatio=[math]::Round($mx,1)
                }
                if($a.MatchNgSamples) {
                    $mn=100.0
                    foreach($fr in $a.MatchNgSamples) { $mn=[Math]::Min($mn,[NgDiff79]::MatchSampleMasked($a.MatchNgArray,$a.MatchOkArray,$fr[0],$sens,$a.FineMask)) }
                    $a.NgRatio=[math]::Round($mn,1)
                }
            }
            return
        }
        if($a.Mode -eq 'diff') {
            if(-not $a.DiffRefArray) { Update-DiffRefArray $a }
            $a.OkRatio=$null; $a.NgRatio=$null
            $w=$a.Rect.Width; $h=$a.Rect.Height
            if($a.DiffRefArray -and $a.DiffOkFrames) {
                $mx=0.0
                foreach($fr in $a.DiffOkFrames) { $mx=[Math]::Max($mx,[NgDiff79]::ScoreSampleMasked($a.DiffRefArray,$fr[0],$fr[1],$w,$h,[double]$a.DiffSensitivity,$a.FineMask,$a.CoarseMask)) }
                $a.OkRatio=[math]::Round($mx,2)
            }
            if($a.DiffRefArray -and $a.DiffNgMeans) {
                $a.NgRatio=[math]::Round([NgDiff79]::ScoreSampleMasked($a.DiffRefArray,$a.DiffNgMeans[0],$a.DiffNgMeans[1],$w,$h,[double]$a.DiffSensitivity,$a.FineMask,$a.CoarseMask),2)
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
    try { if($a.Thumb) { $a.Thumb.Dispose() } } catch {}
    $a.Thumb=$null
}

function Update-AreaThumb($a,$bmp) {
    # エリア一覧のタイルに出す小さな映像を作る（判定の印を描く前の画像から）
    try {
        $off=Get-InnerOffset $bmp $a
        $tw=Px 160; $th=Px 72
        $s=[Math]::Min($tw/[double]$a.Rect.Width,$th/[double]$a.Rect.Height)
        $w=[Math]::Max(1,[int]($a.Rect.Width*$s)); $h=[Math]::Max(1,[int]($a.Rect.Height*$s))
        $t=New-Object System.Drawing.Bitmap($w,$h)
        $g=[System.Drawing.Graphics]::FromImage($t)
        try {
            $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::Bilinear
            $g.DrawImage($bmp,(New-Object System.Drawing.Rectangle(0,0,$w,$h)),(New-Object System.Drawing.Rectangle($off[0],$off[1],$a.Rect.Width,$a.Rect.Height)),[System.Drawing.GraphicsUnit]::Pixel)
        } finally { $g.Dispose() }
        $old=$a.Thumb
        $a.Thumb=$t
        $a.ThumbAt=Get-Date
        if($old) { $old.Dispose() }
    } catch {}
}

function GrabBitmap($rect) {
    $bmp=New-Object System.Drawing.Bitmap($rect.Width,$rect.Height)
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($rect.Location,[System.Drawing.Point]::Empty,$rect.Size) }
    finally { $g.Dispose() }
    return $bmp
}

# 監視ループ専用：エリアごとにBitmapを使い回してCPU・メモリの負担を減らす
function Get-CaptureRect($a) {
    # 「比べる」では、映像のわずかなずれを直すため、範囲の周り3ピクセルも一緒に撮る
    if($a.Mode -eq 'color') { return $a.Rect }
    $m=3
    $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen
    $x0=[Math]::Max($vs.X,$a.Rect.X-$m); $y0=[Math]::Max($vs.Y,$a.Rect.Y-$m)
    $x1=[Math]::Min($vs.Right,$a.Rect.Right+$m); $y1=[Math]::Min($vs.Bottom,$a.Rect.Bottom+$m)
    if($x1 -le $x0 -or $y1 -le $y0) { return $a.Rect }
    return (New-Object System.Drawing.Rectangle($x0,$y0,($x1-$x0),($y1-$y0)))
}

function Get-InnerOffset($bmp,$a) {
    # 撮った画像の中で、監視範囲そのものがどこから始まるか
    if($bmp.Width -eq $a.Rect.Width -and $bmp.Height -eq $a.Rect.Height) { return @(0,0) }
    $cap=Get-CaptureRect $a
    return @(($a.Rect.X-$cap.X),($a.Rect.Y-$cap.Y))
}

function GrabBitmapForArea($a) {
    $rect=Get-CaptureRect $a
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
    try { return [NgWin79]::CoveredByOwnWindow($rect.X,$rect.Y,$rect.Width,$rect.Height) } catch { return $false }
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

function Capture-DiffFrames($a,$count,$intervalMs,$label,$snapKind) {
    # 何枚か続けて撮り、マス目ごとの平均色（{細かい, 粗い} の組）の一覧を返す。
    # 1枚だけでなく何枚も撮ることで、「普段からちらつく部分」も覚えられる。
    $rect=Get-CaptureRect $a
    $hid=$false
    if($f.Visible -and (Test-AreaOccluded $a.Rect)) {
        $f.Hide()
        $hid=$true
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 250
    }
    $frames=New-Object 'float[][][]' $count
    $g2.Group.Enabled=$false   # 記録中にボタンを二重に押されないように
    try {
        for($i=0;$i -lt $count;$i++) {
            $bmp=GrabBitmap $rect
            try {
                $off=Get-InnerOffset $bmp $a
                $frames[$i]=[NgDiff79]::Sample($bmp,$off[0],$off[1],$a.Rect.Width,$a.Rect.Height)
            } finally { $bmp.Dispose() }
            if($i -eq 0 -and $snapKind) { [void](Save-RefImage $a $snapKind) }   # 何を登録したか、あとで見られるように
            if($label) { SetStatusPanel $colorReady $textOnReady ($label+'（'+($i+1)+'/'+$count+'）…このウィンドウやカメラの画面は動かさないでください') }
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

function Get-RefImageFolder($a) {
    return (Join-Path $script:refImageDir ([string]$a.Id))
}

function New-ContextShot($a) {
    # 今の画面から、エリア＋周り（60ピクセル）を撮り、エリアを赤い枠で囲んだ画像にする。
    # 返り値：@(画像, 画像の中のエリアの位置)
    $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen
    $m=60
    $ctx=[System.Drawing.Rectangle]::Intersect((New-Object System.Drawing.Rectangle(($a.Rect.X-$m),($a.Rect.Y-$m),($a.Rect.Width+2*$m),($a.Rect.Height+2*$m))),$vs)
    if($ctx.Width -le 0 -or $ctx.Height -le 0) { throw '範囲が画面の外です' }
    $src=Capture-AreaUnobstructed $ctx
    try {
        $inner=New-Object System.Drawing.Rectangle(($a.Rect.X-$ctx.X),($a.Rect.Y-$ctx.Y),$a.Rect.Width,$a.Rect.Height)
        return (Convert-RefImage $src $inner $true)
    } finally { $src.Dispose() }
}

function Convert-RefImage($src,$inner,$frame) {
    # 保存・表示しやすい大きさ（最大 900×700）に縮め、必要ならエリアに赤い枠を描く
    $sc=[Math]::Min(1.0,[Math]::Min(900.0/$src.Width,700.0/$src.Height))
    $w=[Math]::Max(1,[int]($src.Width*$sc)); $h=[Math]::Max(1,[int]($src.Height*$sc))
    $out=New-Object System.Drawing.Bitmap($w,$h)
    $g=[System.Drawing.Graphics]::FromImage($out)
    try {
        $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($src,0,0,$w,$h)
        $ir=New-Object System.Drawing.Rectangle([int]($inner.X*$sc),[int]($inner.Y*$sc),[Math]::Max(1,[int]($inner.Width*$sc)),[Math]::Max(1,[int]($inner.Height*$sc)))
        if($frame) {
            $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,60,60),2)
            $g.DrawRectangle($pen,($ir.X-2),($ir.Y-2),($ir.Width+3),($ir.Height+3))
            $pen.Dispose()
        }
    } finally { $g.Dispose() }
    return @($out,$ir)
}

function Save-RefImage($a,$kind,$bitmap) {
    # 登録した時の画面を画像で残す（あとで「どんな画面・色を登録したか」を確認できるように）。
    # $bitmap を渡さない時は、今の画面からエリア＋周りを撮る。返り値：保存したファイル（失敗したら $null）
    $script:lastRefImagePath=$null
    try {
        $dir=Get-RefImageFolder $a
        if(-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
        if($bitmap) { $shot=Convert-RefImage $bitmap (New-Object System.Drawing.Rectangle(0,0,$bitmap.Width,$bitmap.Height)) $false }
        else { $shot=New-ContextShot $a }
        $img=$shot[0]; $ir=$shot[1]
        try {
            $name=(Get-Date -Format 'yyyyMMdd_HHmmss_fff')+'_'+$kind+'_r'+$ir.X+'-'+$ir.Y+'-'+$ir.Width+'-'+$ir.Height+'.png'
            $path=Join-Path $dir $name
            $img.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $img.Dispose() }
        $script:lastRefImagePath=$path
        return $path
    } catch {
        Write-ErrorLogThrottled ('登録した画像の保存に失敗（'+$a.Name+'）: '+$_.Exception.Message)
        return $null
    }
}

function Get-RefImages($a) {
    # 保存した登録画像の一覧（古い順）：Path, Time, Kind, Inner（画像の中のエリアの位置）
    $list=New-Object System.Collections.ArrayList
    try {
        $dir=Get-RefImageFolder $a
        if(-not (Test-Path -LiteralPath $dir)) { return ,$list }
        foreach($fi in @(Get-ChildItem -LiteralPath $dir -Filter '*.png' -File | Sort-Object Name)) {
            $m=[regex]::Match($fi.Name,'^(\d{8}_\d{6})_\d{3}_([a-z_]+?)(?:_r(\d+)-(\d+)-(\d+)-(\d+))?\.png$')
            if(-not $m.Success) { continue }
            $t=[datetime]::ParseExact($m.Groups[1].Value,'yyyyMMdd_HHmmss',[System.Globalization.CultureInfo]::InvariantCulture)
            $inner=$null
            if($m.Groups[3].Success) { $inner=New-Object System.Drawing.Rectangle([int]$m.Groups[3].Value,[int]$m.Groups[4].Value,[int]$m.Groups[5].Value,[int]$m.Groups[6].Value) }
            [void]$list.Add([PSCustomObject]@{ Path=$fi.FullName; Time=$t; Kind=$m.Groups[2].Value; Inner=$inner })
        }
    } catch {}
    return ,$list
}

function Remove-RefImages($a,[string[]]$kinds,$keep) {
    # 種類（$kinds を省略すると全部）の登録画像を消す。$keep のファイルは残す
    foreach($ri in (Get-RefImages $a)) {
        if($keep -and $ri.Path -eq $keep) { continue }
        if($kinds -and ($kinds -notcontains $ri.Kind)) { continue }
        try { Remove-Item -LiteralPath $ri.Path -Force -ErrorAction Stop } catch {}
    }
}

function Remove-RefImageFolder($a) {
    try {
        $dir=Get-RefImageFolder $a
        if(Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop }
    } catch {}
}

function Get-RefKindText($kind) {
    switch($kind) {
        'area'       { return 'エリアを登録した時の画面' }
        'ok'         { return '正常として記録（比べる）' }
        'ok_add'     { return '追加した正常（昼・夜など）' }
        'ng'         { return '異常として記録（自動調整に使用）' }
        'match_ng'   { return '異常の画面として記録' }
        'match_ok'   { return '正常な画面として記録' }
        'match_file' { return '画像ファイルから読み込んだ異常の画面' }
        'color_ok'   { return '正常（OK）として記録（色で判定）' }
        'color_ng'   { return '異常（NG）として記録（色で判定）' }
    }
    return [string]$kind
}

function Test-RefKindUsed($a,$kind) {
    # 今の「判定のしかた」で使っている見本かどうか
    if($kind -eq 'area') { return $true }
    if($kind -like 'color_*') { return ($a.Mode -eq 'color') }
    if($kind -like 'match_*') { return ($a.Mode -eq 'match') }
    return ($a.Mode -eq 'diff')
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
            Id=$a.Id
            Name=$a.Name
            X=$a.Rect.X; Y=$a.Rect.Y; W=$a.Rect.Width; H=$a.Rect.Height
            ColorR=$a.Color.R; ColorG=$a.Color.G; ColorB=$a.Color.B
            Sensitivity=$a.Sensitivity; NGThreshold=$a.NGThreshold; HueMatchMode=$a.HueMatchMode
            Direction=$a.Direction
            Mode=$a.Mode
            DiffSensitivity=$a.DiffSensitivity; DiffThreshold=$a.DiffThreshold
            DiffGridW=$a.DiffGridW; DiffGridH=$a.DiffGridH
            DiffRefs=@($a.DiffRefs | ForEach-Object { ConvertTo-PackedRef $_ })
            MatchSensitivity=$a.MatchSensitivity; MatchThreshold=$a.MatchThreshold
            MatchNgRefs=@($a.MatchNgRefs | ForEach-Object { ConvertTo-PackedRef $_ })
            MatchOkRefs=@($a.MatchOkRefs | ForEach-Object { ConvertTo-PackedRef $_ })
            Masks=@($a.Masks | ForEach-Object { [PSCustomObject]@{ X=$_.X; Y=$_.Y; W=$_.Width; H=$_.Height } })
            AdaptDrift=[bool]$a.AdaptDrift
            ScheduleOn=[bool]$a.ScheduleOn; ScheduleStart=$a.ScheduleStart; ScheduleEnd=$a.ScheduleEnd; ScheduleDays=$a.ScheduleDays
            NGDelaySec=$a.NGDelaySec; RepeatMin=$a.RepeatMin
            ConfirmFrames=$a.ConfirmFrames
            BuzzerSeconds=$a.BuzzerSeconds; BuzzerType=$a.BuzzerType; BuzzerVolume=$a.BuzzerVolume
        }
    }
    return [PSCustomObject]@{
        IntervalSec=$script:monitorIntervalSec
        Areas=$areaObjs
    }
}

function ConvertTo-PackedRef($ref) {
    return [PSCustomObject]@{ Means=[NgBlock79]::Pack($ref[2]); Noise=[NgBlock79]::Pack($ref[3]); FineMeans=[NgBlock79]::Pack($ref[0]); FineNoise=[NgBlock79]::Pack($ref[1]) }
}

function ConvertFrom-PackedRef($rd,$a,[switch]$RequireFine) {
    # 保存した見本を読み戻す。範囲の大きさが違う・壊れている場合は $null
    if($null -eq $rd -or -not $rd.Means -or -not $rd.Noise) { return $null }
    try {
        $nc=$a.DiffGridW*$a.DiffGridH; $nf=$a.DiffFineW*$a.DiffFineH
        $means=[NgBlock79]::Unpack([string]$rd.Means)
        $noise=[NgBlock79]::Unpack([string]$rd.Noise)
        if($means.Length -ne $nc*3 -or $noise.Length -ne $nc) { return $null }
        $ref=New-Object 'float[][]' 4
        $ref[0]=New-Object 'float[]' 0; $ref[1]=New-Object 'float[]' 0   # v78 までの見本には細かいマス目が無い
        $ref[2]=$means; $ref[3]=$noise
        if($rd.FineMeans -and $rd.FineNoise) {
            $fm=[NgBlock79]::Unpack([string]$rd.FineMeans)
            $fz=[NgBlock79]::Unpack([string]$rd.FineNoise)
            if($fm.Length -eq $nf*3 -and $fz.Length -eq $nf) { $ref[0]=$fm; $ref[1]=$fz }
        }
        if($RequireFine -and $ref[0].Length -eq 0) { return $null }
        return ,$ref
    } catch { return $null }
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

function ClampDouble($value,$min,$max,$default) {
    if($null -eq $value) { return $default }
    try { return [Math]::Max([double]$min,[Math]::Min([double]$max,[double]$value)) } catch { return $default }
}

function ClampInt($value,$min,$max,$default) {
    if($null -eq $value) { return $default }
    try { return [Math]::Max($min,[Math]::Min($max,[int]$value)) } catch { return $default }
}

# 起動時の設定の読み込み（Apply-SettingsObject）からも使うので、それより前に置く
function Set-AreaGrids($a) {
    $gw=0; $gh=0
    [NgDiff79]::GridFor($a.Rect.Width,$a.Rect.Height,[NgDiff79]::CoarseCells,[ref]$gw,[ref]$gh)
    $a.DiffGridW=$gw; $a.DiffGridH=$gh
    [NgDiff79]::GridFor($a.Rect.Width,$a.Rect.Height,[NgDiff79]::FineCells,[ref]$gw,[ref]$gh)
    $a.DiffFineW=$gw; $a.DiffFineH=$gh
    $a.MaskReady=$false
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
            if(([string]$ad.Id) -match '^[0-9a-f]{32}$') { $newArea.Id=[string]$ad.Id }
            $newArea.Sensitivity=ClampInt $ad.Sensitivity 0 100 $legacySensitivity
            $newArea.NGThreshold=ClampInt $ad.NGThreshold 1 100 $legacyNGThreshold
            $newArea.HueMatchMode=$(if($null -ne $ad.HueMatchMode){[bool]$ad.HueMatchMode}else{$legacyHueMode})
            $newArea.Direction=$(if($ad.Direction -eq 'disappear'){'disappear'}else{'appear'})
            # 以前のバージョンで作った設定は「色で判定」のまま動かす
            $newArea.Mode=$(if($ad.Mode -eq 'diff' -or $ad.Mode -eq 'match'){[string]$ad.Mode}else{'color'})
            $newArea.DiffSensitivity=ClampInt $ad.DiffSensitivity 0 100 50
            # v78 までの「比べる」の値（初期値3）はそのまま使う。細かい判定の初期値は0.15
            $newArea.DiffThreshold=ClampDouble $ad.DiffThreshold 0.05 100 0.15
            Set-AreaGrids $newArea
            $gw=$newArea.DiffGridW; $gh=$newArea.DiffGridH
            $fn=$newArea.DiffFineW*$newArea.DiffFineH
            if(([int]$ad.DiffGridW -eq $gw) -and ([int]$ad.DiffGridH -eq $gh)) {
                foreach($rd in @($ad.DiffRefs)) {
                    if($null -eq $rd -or -not $rd.Means -or -not $rd.Noise) { continue }
                    try {
                        $means=[NgBlock79]::Unpack([string]$rd.Means)
                        $noise=[NgBlock79]::Unpack([string]$rd.Noise)
                        if($means.Length -eq $gw*$gh*3 -and $noise.Length -eq $gw*$gh) {
                            $ref=New-Object 'float[][]' 4
                            $ref[0]=New-Object 'float[]' 0; $ref[1]=New-Object 'float[]' 0   # v78 までの見本には細かいマス目が無い
                            $ref[2]=$means; $ref[3]=$noise
                            if($rd.FineMeans -and $rd.FineNoise) {
                                $fm=[NgBlock79]::Unpack([string]$rd.FineMeans)
                                $fz=[NgBlock79]::Unpack([string]$rd.FineNoise)
                                if($fm.Length -eq $fn*3 -and $fz.Length -eq $fn) { $ref[0]=$fm; $ref[1]=$fz }
                            }
                            [void]$newArea.DiffRefs.Add($ref)
                        }
                    } catch {}
                }
            }
            $newArea.MatchSensitivity=ClampInt $ad.MatchSensitivity 0 100 50
            $newArea.MatchThreshold=ClampDouble $ad.MatchThreshold 1 100 90
            if(([int]$ad.DiffGridW -eq $gw) -and ([int]$ad.DiffGridH -eq $gh)) {
                foreach($rd in @($ad.MatchNgRefs)) { $r2=ConvertFrom-PackedRef $rd $newArea -RequireFine; if($r2) { [void]$newArea.MatchNgRefs.Add($r2) } }
                foreach($rd in @($ad.MatchOkRefs)) { $r2=ConvertFrom-PackedRef $rd $newArea -RequireFine; if($r2) { [void]$newArea.MatchOkRefs.Add($r2) } }
            }
            # 除外する場所（範囲の中に収まるものだけ）
            $inner=New-Object System.Drawing.Rectangle(0,0,$rect.Width,$rect.Height)
            foreach($md in @($ad.Masks)) {
                if($null -eq $md -or $newArea.Masks.Count -ge $script:maxMasks) { continue }
                try {
                    $mr=[System.Drawing.Rectangle]::Intersect((New-Object System.Drawing.Rectangle([int]$md.X,[int]$md.Y,[int]$md.W,[int]$md.H)),$inner)
                    if($mr.Width -gt 0 -and $mr.Height -gt 0) { [void]$newArea.Masks.Add($mr) }
                } catch {}
            }
            $newArea.AdaptDrift=$(if($null -ne $ad.AdaptDrift){[bool]$ad.AdaptDrift}else{$true})
            $newArea.ConfirmFrames=ClampInt $ad.ConfirmFrames 1 20 2
            $newArea.ScheduleOn=$(if($null -ne $ad.ScheduleOn){[bool]$ad.ScheduleOn}else{$false})
            if($null -ne (ConvertTo-Minutes $ad.ScheduleStart)) { $newArea.ScheduleStart=[string]$ad.ScheduleStart }
            if($null -ne (ConvertTo-Minutes $ad.ScheduleEnd)) { $newArea.ScheduleEnd=[string]$ad.ScheduleEnd }
            $newArea.ScheduleDays=ClampInt $ad.ScheduleDays 0 127 127
            $newArea.NGDelaySec=ClampInt $ad.NGDelaySec 0 86400 0
            $newArea.RepeatMin=ClampInt $ad.RepeatMin 0 1440 0
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

function Show-Choice($title,$prompt,[string[]]$choices) {
    # 大きなボタンを縦に並べた選択画面。押したボタンの番号（0～）を返す。閉じたら最後の番号
    $d=New-Object System.Windows.Forms.Form
    $d.Text=$title
    $d.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::None
    $d.FormBorderStyle=[System.Windows.Forms.FormBorderStyle]::FixedDialog
    $d.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterParent
    $d.MaximizeBox=$false; $d.MinimizeBox=$false; $d.ShowInTaskbar=$false
    $d.Font=UIFont 10
    $lbl=New-Object System.Windows.Forms.Label
    $lbl.AutoSize=$true; $lbl.Text=$prompt
    $lbl.MaximumSize=New-Object System.Drawing.Size((Px 460),0)
    $lbl.Location=New-Object System.Drawing.Point((Px 16),(Px 14))
    $d.Controls.Add($lbl)
    $script:choiceResult=$choices.Count-1
    $y=$lbl.Bottom+(Px 14)
    for($i=0;$i -lt $choices.Count;$i++) {
        $b=New-Object System.Windows.Forms.Button
        $b.Text=$choices[$i]
        $b.Tag=$i
        $b.Font=UIFont 10 -Bold
        $b.Size=New-Object System.Drawing.Size((Px 460),(Px 44))
        $b.Location=New-Object System.Drawing.Point((Px 16),$y)
        $b.Add_Click({ $script:choiceResult=[int]$this.Tag; $this.FindForm().Close() })
        $d.Controls.Add($b)
        $y+=Px 52
    }
    $d.ClientSize=New-Object System.Drawing.Size((Px 492),($y+(Px 6)))
    [void]$d.ShowDialog($f)
    $d.Dispose()
    return $script:choiceResult
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
$statusPanel.Padding=New-Object System.Windows.Forms.Padding((Px 10))
# NGの時だけ出る「確認しました」ボタン（音を止め、表示を「確認済み」にする）
$ackBtn=New-Button '✔ 確認しました' ([System.Drawing.Color]::White) ([System.Drawing.Color]::FromArgb(170,20,32)) 11 150 50
$ackBtn.AutoSize=$false
$ackBtn.Dock=[System.Windows.Forms.DockStyle]::Right
$ackBtn.Width=Px 160
$ackBtn.Visible=$false
$statusPanel.Controls.Add($ackBtn)
Set-RoundedRegion $statusPanel 10
$summaryLabel=New-Object System.Windows.Forms.Label
$summaryLabel.AutoSize=$false
$summaryLabel.Font=UIFont 9
$summaryLabel.ForeColor=$textSecondary
$summaryLabel.BackColor=[System.Drawing.Color]::Transparent
$summaryLabel.TextAlign=[System.Drawing.ContentAlignment]::MiddleLeft
$topBar.Controls.Add($summaryLabel)

$topBar.Height=(Px 8)+(Px 50)+(Px 8)+(Px 78)+(Px 24)+(Px 4)
$topBar.Add_Layout({
    $w=$topBar.ClientSize.Width-(Px 24)
    $gap=Px 8
    $sw=[int]($w*0.24)
    $bw=[int](($w-$sw-2*$gap)/2)
    $start.SetBounds((Px 12),(Px 8),$bw,(Px 50))
    $silence.SetBounds(($start.Right+$gap),(Px 8),$sw,(Px 50))
    $stop.SetBounds(($silence.Right+$gap),(Px 8),($w-$bw-$sw-2*$gap),(Px 50))
    $statusPanel.SetBounds((Px 12),($start.Bottom+(Px 8)),$w,(Px 78))
    $summaryLabel.SetBounds((Px 16),($statusPanel.Bottom+(Px 2)),($w-(Px 8)),(Px 24))
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
$g1=New-Group '① 見張る場所（エリア）'
$settingsFlow.Controls.Add($g1.Group)

$row=New-Row
$pick=New-Button '＋ エリアを追加' $colorBlueBtn $null 9.5 150 36
$repickBtn=New-Button '範囲を選び直す' $colorGrayBtn $null 9 110 36
$renameBtn=New-Button '名前を変更' $colorGrayBtn $null 9 100 36
$deleteAreaBtn=New-Button '削除' ([System.Drawing.Color]::FromArgb(120,50,50)) $null 9 80 36
$areaCountLabel=New-Label 'まだエリアがありません' 9 -Bold $textSecondary
Add-Controls $row @($pick,$repickBtn,$renameBtn,$deleteAreaBtn,$areaCountLabel)
$g1.Body.Controls.Add($row)

$pickHint=New-Label '見張りたい部分だけを小さく囲むのがコツです。タイルをクリックで選択、右クリックでメニュー。' 8.5 -color $textSecondary
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
$areaList.Visible=$false   # 選択の管理だけに使う（表示は下のタイル）
$g1.Body.Controls.Add($areaList)

# エリアのタイル（今の映像・状態・メーターを並べて表示。クリックで選ぶ、ダブルクリックで画面上の位置を表示）
$tileBoard=New-Object System.Windows.Forms.PictureBox
$tileBoard.BackColor=$cardBgDark
$tileBoard.Size=New-Object System.Drawing.Size((Px 720),(Px 160))
$tileBoard.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 6),(Px 3),(Px 3))
$tileBoard.Cursor=[System.Windows.Forms.Cursors]::Hand
$g1.Body.Controls.Add($tileBoard)
$script:tileW=Px 172
$script:tileH=Px 160
$script:tileGap=Px 8

# ---------- ② 検出の設定 ----------
$g2=New-Group '② 見本と判定'
$settingsFlow.Controls.Add($g2.Group)

$areaSettingsLabel=New-Label '' 9.5 -Bold $accentBlue   # （表示はグループの見出しで行う）

$previewRow=New-Row
$areaPreviewBox=New-Object System.Windows.Forms.PictureBox
$areaPreviewBox.Size=New-Object System.Drawing.Size((Px 200),(Px 150))
$areaPreviewBox.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
$areaPreviewBox.BackColor=$inputBgDark
$areaPreviewBox.SizeMode=[System.Windows.Forms.PictureBoxSizeMode]::Zoom
$areaPreviewBox.Margin=New-Object System.Windows.Forms.Padding((Px 3))
$previewCol=New-Column
$areaPreviewInfoLabel=New-Label '①のタイルでエリアを選ぶと、左に今の映像が表示されます' 8.5 -color $textSecondary
$areaPreviewInfoLabel.MaximumSize=New-Object System.Drawing.Size((Px 500),0)
$colorLabel=New-Label '検出する色：－' 9 -Bold
$colorLabel.Anchor=[System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Top
$previewBtnRow=New-Row
$highlightBtn=New-Button '画面で位置を確認' $colorGrayBtn $null 8.5 110 30
$eyedropBtn=New-Button 'スポイトで色を選ぶ' $colorGrayBtn $null 8.5 120 30
$refImagesBtn=New-Button '登録した画像を見る' ([System.Drawing.Color]::FromArgb(30,90,140)) $null 8.5 120 30
Add-Controls $previewBtnRow @($refImagesBtn,$highlightBtn,$eyedropBtn)
$maskBtnRow=New-Row
$maskBtn=New-Button '除外する場所を指定' ([System.Drawing.Color]::FromArgb(70,70,110)) $null 8.5 120 30
$maskClearBtn=New-Button '除外を全部消す' $colorGrayBtn $null 8.5 100 30
Add-Controls $maskBtnRow @($maskBtn,$maskClearBtn)
$maskHint=New-Label '正常でも動く場所（アーム・人の通り道・時計など）は、上の映像の上をドラッグして囲むと判定から外せます。' 8 -color $textSecondary
$maskHint.MaximumSize=New-Object System.Drawing.Size((Px 700),0)
Add-Controls $previewCol @($areaPreviewInfoLabel,$colorLabel,$previewBtnRow)
Add-Controls $previewRow @($areaPreviewBox,$previewCol)
$g2.Body.Controls.Add($previewRow)

# 判定のしかた
$modeRow=New-Row
$modeLabel=New-Label '判定のしかた：' 9.5 -Bold
$rbModeDiff=New-Object System.Windows.Forms.RadioButton
$rbModeDiff.Text='正常な映像と比べる（おすすめ・かんたん）'
$rbModeMatch=New-Object System.Windows.Forms.RadioButton
$rbModeMatch.Text='異常の時だけ出る画面が出たらNG'
$rbModeColor=New-Object System.Windows.Forms.RadioButton
$rbModeColor.Text='色で判定する（従来の方法）'
foreach($rb in @($rbModeDiff,$rbModeMatch,$rbModeColor)) {
    $rb.AutoSize=$true; $rb.Font=UIFont 9.5; $rb.ForeColor=$textPrimary; $rb.Enabled=$false
    $rb.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    $rb.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 3),(Px 12),(Px 3))
}
$rbModeDiff.Checked=$true
$modeChoices=New-Column
Add-Controls $modeChoices @($rbModeDiff,$rbModeMatch,$rbModeColor)
$modeChoices.Visible=$false   # 選択は横の一覧（ComboBox）で行う（ラジオボタンは内部の状態として残す）
$modeCombo=New-Object System.Windows.Forms.ComboBox
$modeCombo.DropDownStyle=[System.Windows.Forms.ComboBoxStyle]::DropDownList
$modeCombo.Font=UIFont 10
$modeCombo.BackColor=$inputBgDark
$modeCombo.ForeColor=$textPrimary
$modeCombo.Width=Px 400
$modeCombo.Anchor=[System.Windows.Forms.AnchorStyles]::Left
$modeCombo.Enabled=$false
[void]$modeCombo.Items.AddRange(@('正常な映像と比べる（おすすめ）','異常の時だけ出る画面が出たらNG','色で判定する'))
$modeCombo.SelectedIndex=0
Stop-WheelChange $modeCombo
Add-Controls $modeRow @($modeLabel,$modeCombo,$modeChoices)
$modeRow.Margin=New-Object System.Windows.Forms.Padding(0,(Px 8),0,(Px 2))
$g2.Body.Controls.Add($modeRow)

# 記録（かんたん設定）
$tuneTitle=New-Label '★ かんたん設定' 10 -Bold ([System.Drawing.Color]::FromArgb(255,210,90))
$tuneTitle.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 8),(Px 3),(Px 1))
$tuneHint=New-Label '' 8.5 -color $textSecondary
$tuneHint.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$g2.Body.Controls.Add($tuneHint)
$tuneRow=New-Row
$recordOkBtn=New-Button '① 正常な状態を記録' $colorGreenBtn $null 9.5 170 36
$addOkBtn=New-Button '＋ 別の正常も追加（昼・夜など）' ([System.Drawing.Color]::FromArgb(30,110,60)) $null 9 170 36
$recordNgBtn=New-Button '② 異常を記録（任意）' $colorRedBtn $null 9.5 150 36
Add-Controls $tuneRow @($recordOkBtn,$addOkBtn,$recordNgBtn)
$g2.Body.Controls.Add($tuneRow)
$longRecordCheck=New-Object System.Windows.Forms.CheckBox
$longRecordCheck.Text='長めに記録する（約30秒）… アームや人など、正常でも動くものが映る場所向け'
$longRecordCheck.AutoSize=$true; $longRecordCheck.Font=UIFont 9; $longRecordCheck.ForeColor=$textPrimary
$longRecordCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 2),(Px 3),(Px 2))
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
$advancedCheck.Text='詳しい設定（感度・しきい値・除外する場所・長めに記録 など）を表示'
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

$adaptCheck=New-Object System.Windows.Forms.CheckBox
$adaptCheck.Text='朝・夕方など、ゆっくりした明るさの変化に自動で合わせる（おすすめ。急な変化・異常は覚えません）'
$adaptCheck.AutoSize=$true; $adaptCheck.Font=UIFont 9; $adaptCheck.ForeColor=$textPrimary; $adaptCheck.Enabled=$false
$adaptCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 4),(Px 3),(Px 4))
$clearRefsBtn=New-Button '記録した正常の見本をすべて消す' ([System.Drawing.Color]::FromArgb(120,50,50)) $null 8.5 150 30
Add-Controls $advancedPanel @($dirRow,$sensRow,$sensHint,$hueModeCheck,$ngRow,$ngHint,$confirmRow,$adaptCheck,$longRecordCheck,$maskBtnRow,$maskHint,$clearRefsBtn)

# ---------- ③ ブザー ----------
$g3=New-Group '③ 音と鳴らす条件'
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

# 鳴らす条件（時間帯・待ち時間・鳴らし直し）
$whenTitle=New-Label '鳴らす条件' 9.5 -Bold ([System.Drawing.Color]::FromArgb(255,210,90))
$whenCheck=New-Object System.Windows.Forms.CheckBox
$whenCheck.Text='鳴らす条件（時間帯・○秒続いたら・鳴らし直し）を表示'
$whenCheck.AutoSize=$true; $whenCheck.Font=UIFont 9 -Bold; $whenCheck.ForeColor=$accentBlue
$whenCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 8),(Px 3),(Px 2))
$g3.Body.Controls.Add($whenCheck)
$whenPanel=New-Column
$whenPanel.Visible=$false
$g3.Body.Controls.Add($whenPanel)
$schedCheck=New-Object System.Windows.Forms.CheckBox
$schedCheck.Text='決まった時間帯だけ監視する（例：20:00 を過ぎても機械の電源が入っていたら鳴らす）'
$schedCheck.AutoSize=$true; $schedCheck.Font=UIFont 9; $schedCheck.ForeColor=$textPrimary; $schedCheck.Enabled=$false
$schedCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 3),(Px 3),(Px 3))
$whenPanel.Controls.Add($schedCheck)
function New-TimePicker {
    $t=New-Object System.Windows.Forms.DateTimePicker
    $t.Format=[System.Windows.Forms.DateTimePickerFormat]::Custom
    $t.CustomFormat='HH:mm'
    $t.ShowUpDown=$true
    $t.Font=UIFont 10
    $t.Width=Px 80
    $t.Value=[datetime]::Today
    $t.Enabled=$false
    $t.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    Stop-WheelChange $t
    return $t
}
$schedRow=New-Row
$schedStartLabel=New-Label '　時間帯：'
$schedStart=New-TimePicker
$schedTilde=New-Label '～'
$schedEnd=New-TimePicker
$schedNote=New-Label '（終わりが始まりより前なら翌日まで。同じ時刻なら一日中）' 8.5 -color $textSecondary
Add-Controls $schedRow @($schedStartLabel,$schedStart,$schedTilde,$schedEnd,$schedNote)
$whenPanel.Controls.Add($schedRow)
$daysRow=New-Row
$daysLabel=New-Label '　曜日：'
Add-Controls $daysRow @($daysLabel)
$dayChecks=@()
foreach($dn in @('日','月','火','水','木','金','土')) {
    $c=New-Object System.Windows.Forms.CheckBox
    $c.Text=$dn; $c.AutoSize=$true; $c.Font=UIFont 9; $c.ForeColor=$textPrimary; $c.Enabled=$false; $c.Checked=$true
    $c.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    $c.Margin=New-Object System.Windows.Forms.Padding((Px 2),(Px 3),(Px 2),(Px 3))
    $dayChecks+=$c
    [void]$daysRow.Controls.Add($c)
}
$daysNote=New-Label '（夜をまたぐ時間帯は、始まった日の曜日）' 8.5 -color $textSecondary
[void]$daysRow.Controls.Add($daysNote)
$whenPanel.Controls.Add($daysRow)
$delayRow=New-Row
$delayLabel=New-Label 'NGの状態が'
$delayBox=New-Number 0 86400 0 0 10 80
$delayBox.Enabled=$false
$delayUnit=New-Label '秒 続いたら鳴らす（0＝すぐ。ドアの開けっぱなし等は 60～300 秒など）' 8.5 -color $textSecondary
Add-Controls $delayRow @($delayLabel,$delayBox,$delayUnit)
$whenPanel.Controls.Add($delayRow)
$repeatRow=New-Row
$repeatLabel=New-Label 'NGの間、'
$repeatBox=New-Number 0 1440 0 0 1 70
$repeatBox.Enabled=$false
$repeatUnit=New-Label '分ごとに鳴らし直す（0＝1回だけ。「確認しました」を押すと止まります）' 8.5 -color $textSecondary
Add-Controls $repeatRow @($repeatLabel,$repeatBox,$repeatUnit)
$whenPanel.Controls.Add($repeatRow)

# ---------- ④ その他 ----------
$g4=New-Group '④ その他'
$settingsFlow.Controls.Add($g4.Group)
$otherCheck=New-Object System.Windows.Forms.CheckBox
$otherCheck.Text='その他の設定（自動スタート・画像の保存・ログ・監視の間隔）を表示'
$otherCheck.AutoSize=$true; $otherCheck.Font=UIFont 9 -Bold; $otherCheck.ForeColor=$accentBlue
$otherCheck.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 3),(Px 3),(Px 2))
$g4.Body.Controls.Add($otherCheck)
$otherPanel=New-Column
$otherPanel.Visible=$false
$g4.Body.Controls.Add($otherPanel)
function New-Check($text) {
    $c=New-Object System.Windows.Forms.CheckBox
    $c.Text=$text
    $c.AutoSize=$true; $c.Font=UIFont 9; $c.ForeColor=$textPrimary
    $c.Anchor=[System.Windows.Forms.AnchorStyles]::Left
    $c.Margin=New-Object System.Windows.Forms.Padding((Px 3),(Px 4),(Px 3),(Px 4))
    return $c
}
$autoStartCheck=New-Check '起動したら自動で監視をスタートする（PCの再起動後もそのまま監視）'
$otherPanel.Controls.Add($autoStartCheck)
$imageRow=New-Row
$saveImagesCheck=New-Check 'NGの時の画面を画像で保存する（30日分）'
$saveImagesCheck.Checked=$true
$openImagesBtn=New-Button '画像フォルダを開く' $colorGrayBtn $null 8.5 120 30
Add-Controls $imageRow @($saveImagesCheck,$openImagesBtn)
$otherPanel.Controls.Add($imageRow)
$logRow=New-Row
$logEnabledCheck=New-Check 'NGログを記録する（発生・解除の日時をCSVに残す）'
$logEnabledCheck.Checked=$script:loggingEnabled
$openLogBtn=New-Button 'ログを開く' $colorGrayBtn $null 8.5 100 30
Add-Controls $logRow @($logEnabledCheck,$openLogBtn)
$otherPanel.Controls.Add($logRow)
$topMostCheck=New-Check 'この画面を常に手前に表示する'
$topMostCheck.Checked=$true
$otherPanel.Controls.Add($topMostCheck)
$intervalRow=New-Row
$intervalLabel=New-Label '監視の間隔：'
$intervalBox=New-Number 0.1 5.0 ([decimal]$script:monitorIntervalSec) 1 0.1 70
$intervalUnitLabel=New-Label '秒ごとにチェック（短いほど検知は速く、PCの負荷は上がります）' 8.5 -color $textSecondary
Add-Controls $intervalRow @($intervalLabel,$intervalBox,$intervalUnitLabel)
$otherPanel.Controls.Add($intervalRow)
$settingsPathLabel=New-Label '' 8 -color $textSecondary
$settingsPathLabel.MaximumSize=New-Object System.Drawing.Size((Px 720),0)
$otherPanel.Controls.Add($settingsPathLabel)

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
    Update-TileBoardSize
    $tileBoard.Invalidate()
}

function Format-Percent($v) {
    $d=[double]$v
    if($d -lt 10) { return ($d.ToString('0.0#')+'%') }
    return ($d.ToString('0.#')+'%')
}

function Set-ThresholdSliderRange($a) {
    # 色で判定：1～100%（1%きざみ）／ 比べる：0.05～20%（0.05%きざみ）
    if($a.Mode -eq 'diff') { $ngTrack.Minimum=1; $ngTrack.Maximum=400 } else { $ngTrack.Minimum=1; $ngTrack.Maximum=100 }
}

function Threshold-ToSlider($a,$t) {
    if($a.Mode -eq 'diff') { return [int][Math]::Round([double]$t/0.05) }
    return [int]$t
}

function Slider-ToThreshold($a,$v) {
    if($a.Mode -eq 'diff') { return [Math]::Round([int]$v*0.05,2) }
    return [int]$v
}

function UpdateNGHintText($a) {
    if($a -and $a.Mode -eq 'match') {
        $ngHint.Text='映っている画面が、記録した「異常の画面」にこの割合以上似ていたらNG（初期値 90%）'
    } elseif($a -and $a.Mode -eq 'diff') {
        $ngHint.Text='正常と違う部分のうち、いちばん大きなかたまりが範囲のこの割合以上ならNG（小さな部品の欠けは 0.1～0.5% 程度）'
    } elseif($a -and $a.Direction -eq 'disappear') {
        $ngHint.Text='一致率がこの値を下回ったらNG判定（色が消えた時）'
    } else {
        $ngHint.Text='一致率がこの値以上でNG判定（色が出た時）'
    }
}

function Update-ColorLabel($a) {
    if($a -and $a.Mode -eq 'match') {
        $n=$a.MatchNgRefs.Count; $m=$a.MatchOkRefs.Count
        $colorLabel.Text=$(if($n -gt 0){'異常の画面の見本：'+$n+'枚　正常な画面の見本：'+$m+'枚'}else{'異常の画面の見本：まだ記録していません'})
        $colorLabel.ForeColor=$(if($n -gt 0){[System.Drawing.Color]::FromArgb(140,220,150)}else{[System.Drawing.Color]::FromArgb(255,190,110)})
    } elseif($a -and $a.Mode -eq 'diff') {
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
    } elseif($a.Mode -eq 'match') {
        if($a.MatchNgRefs.Count -gt 0) {
            $tuneResultLabel.ForeColor=[System.Drawing.Color]::FromArgb(140,220,150)
            $tuneResultLabel.Text='設定できています。「▶ 監視スタート」で、異常の画面が出た時に鳴ります。'
        } else {
            $tuneResultLabel.ForeColor=[System.Drawing.Color]::FromArgb(255,190,110)
            $tuneResultLabel.Text='異常の画面が出ている時に「① 異常の画面を記録」を押すか、「＋ 画像ファイルから読み込む」で画像を読み込んでください。'
        }
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
    $mode=$(if($a){$a.Mode}else{'diff'})
    $diff=($mode -eq 'diff')
    $color=($mode -eq 'color')
    $addOkBtn.Visible=-not $color
    $eyedropBtn.Visible=$color
    $dirRow.Visible=$color
    $hueModeCheck.Visible=$color
    $clearRefsBtn.Visible=-not $color
    $maskBtnRow.Visible=-not $color
    $maskHint.Visible=-not $color
    $adaptCheck.Visible=$diff
    $longRecordCheck.Visible=$diff
    if($mode -eq 'match') {
        $tuneHint.Text='警報画面などが出ている時に「①」を押します。出ていない時は「＋ 画像ファイルから」で前に撮った画像を読み込めます。'
        $recordOkBtn.Text='① 異常の画面を記録'
        $addOkBtn.Text='＋ 画像ファイルから'
        $recordNgBtn.Text='② 正常な画面も記録（おすすめ）'
        $clearRefsBtn.Text='記録した見本（異常・正常）をすべて消す'
        $meterTitle.Text='異常の画面との一致度（黄色い線を超えたらNG）'
        $sensLabel.Text='見分けの感度：'
        $sensHint.Text='感度を上げる → 細かな違いも「別の画面」とみなす（一致度が下がる）／ 下げる → 多少違っても同じ画面とみなす'
        $ngLabel.Text='NGにする一致度：'
    } elseif($diff) {
        $addOkBtn.Text='＋ 昼・夜などを追加'
        $clearRefsBtn.Text='記録した正常の見本をすべて消す'
        $tuneHint.Text='画面が正常な時に「①」を押すだけで設定完了です。'
        $recordOkBtn.Text='① 正常な状態を記録'
        $recordNgBtn.Text='② 異常も記録（任意）'
        $meterTitle.Text='正常との違い（黄色い線を超えたらNG）'
        $sensLabel.Text='違いの感度：'
        $sensHint.Text='感度を上げる → 小さな違いでもNGにする ／ 下げる → はっきりした違いだけNGにする。映像の赤い部分が「違う」と判断された場所です。'
        $ngLabel.Text='NGにする変化の割合：'
    } else {
        $tuneHint.Text='正常な時に「①」、異常な時に「②」を押すと、色・しきい値を自動で決めます。'
        $recordOkBtn.Text='① 正常（OK）を記録'
        $recordNgBtn.Text='② 異常（NG）を記録'
        $meterTitle.Text='色の一致率（黄色い線がNGの境目）'
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
        foreach($c in @($rbModeDiff,$rbModeMatch,$rbModeColor,$rbAppear,$rbDisappear,$sensTrack,$ngTrack,$hueModeCheck,$confirmBox,$secBox,$typeCombo,$volTrack,$test,$highlightBtn,$eyedropBtn,$recordOkBtn,$addOkBtn,$recordNgBtn,$clearRefsBtn,$maskBtn,$maskClearBtn,$adaptCheck,$longRecordCheck,$schedCheck,$delayBox,$repeatBox,$refImagesBtn,$modeCombo)) { $c.Enabled=$en }
        if($en) {
            if($a.Mode -eq 'diff') { $rbModeDiff.Checked=$true } elseif($a.Mode -eq 'match') { $rbModeMatch.Checked=$true } else { $rbModeColor.Checked=$true }
            $modeCombo.SelectedIndex=$(if($a.Mode -eq 'diff'){0}elseif($a.Mode -eq 'match'){1}else{2})
            # 鳴らす条件を使っているエリアなら、折りたたまずに見せる
            if($a.ScheduleOn -or [int]$a.NGDelaySec -gt 0 -or [int]$a.RepeatMin -gt 0) { $whenCheck.Checked=$true }
            if($a.Direction -eq 'disappear') { $rbDisappear.Checked=$true } else { $rbAppear.Checked=$true }
            $sens=$(if($a.Mode -eq 'diff'){$a.DiffSensitivity}elseif($a.Mode -eq 'match'){$a.MatchSensitivity}else{$a.Sensitivity})
            $thr=Get-JudgeThreshold $a
            Set-ThresholdSliderRange $a
            $sensTrack.Value=$sens
            $sensPercentLabel.Text=$sens.ToString()
            $ngTrack.Value=[Math]::Max($ngTrack.Minimum,[Math]::Min($ngTrack.Maximum,(Threshold-ToSlider $a $thr)))
            $ngPercentLabel.Text=Format-Percent $thr
            $hueModeCheck.Checked=$a.HueMatchMode
            $confirmBox.Value=[decimal]$a.ConfirmFrames
            $adaptCheck.Checked=[bool]$a.AdaptDrift
            $maskClearBtn.Enabled=($a.Masks.Count -gt 0)
            $maskClearBtn.Text=$(if($a.Masks.Count -gt 0){'除外を全部消す（'+$a.Masks.Count+'か所）'}else{'除外を全部消す'})
            if($a.Mode -eq 'match') {
                $clearRefsBtn.Enabled=($a.MatchNgRefs.Count+$a.MatchOkRefs.Count) -gt 0
            } else {
                $recordNgBtn.Enabled=($a.Mode -ne 'diff') -or ($a.DiffRefs.Count -gt 0)
                $addOkBtn.Enabled=($a.DiffRefs.Count -gt 0)
                $clearRefsBtn.Enabled=($a.DiffRefs.Count -gt 0)
            }
            $g2.Group.Text=('② 見本と判定：'+$a.Name)
            $g3.Group.Text=('③ 音と鳴らす条件：'+$a.Name)
            $areaSettingsLabel.Text=($a.Name+' の設定を編集中')
            $schedCheck.Checked=[bool]$a.ScheduleOn
            $sm=ConvertTo-Minutes $a.ScheduleStart; if($null -eq $sm) { $sm=1200 }
            $em=ConvertTo-Minutes $a.ScheduleEnd; if($null -eq $em) { $em=360 }
            $schedStart.Value=[datetime]::Today.AddMinutes($sm)
            $schedEnd.Value=[datetime]::Today.AddMinutes($em)
            for($i=0;$i -lt 7;$i++) { $dayChecks[$i].Checked=(([int]$a.ScheduleDays -band [int][Math]::Pow(2,$i)) -ne 0) }
            $delayBox.Value=[decimal][Math]::Min(86400,[Math]::Max(0,[int]$a.NGDelaySec))
            $repeatBox.Value=[decimal][Math]::Min(1440,[Math]::Max(0,[int]$a.RepeatMin))
            $secBox.Value=[decimal]$a.BuzzerSeconds
            $typeCombo.SelectedIndex=[Math]::Max(0,[Math]::Min(7,$a.BuzzerType))
            $volTrack.Value=$a.BuzzerVolume
            $volPercentLabel.Text=$a.BuzzerVolume.ToString()+'%'
        } else {
            $rbModeDiff.Checked=$true
            $modeCombo.SelectedIndex=0
            $rbAppear.Checked=$true
            $sensTrack.Value=50; $sensPercentLabel.Text='50'
            $ngTrack.Minimum=1; $ngTrack.Maximum=100
            $ngTrack.Value=15; $ngPercentLabel.Text='15%'
            $hueModeCheck.Checked=$false
            $confirmBox.Value=2
            $g2.Group.Text='② 見本と判定（①でエリアを選んでください）'
            $g3.Group.Text='③ 音と鳴らす条件'
            $areaSettingsLabel.Text=''
            $secBox.Value=2
            $typeCombo.SelectedIndex=0
            $volTrack.Value=80; $volPercentLabel.Text='80%'
        }
        Update-ModeUI $a
        Update-ColorLabel $a
        Update-TuneLabel $a
        Set-Eyedropper $false
        Set-MaskMode $false
        Update-ScheduleEnabled
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
    $prefix=$(if($a.Mode -eq 'diff'){'違い '}elseif($a.Mode -eq 'match'){'一致 '}else{''})
    $meterValueLabel.Text=($prefix+(Format-Percent $a.LastRatio)+'　→ '+$(if($isNG){'NG'}else{'OK'}))
    $meterValueLabel.ForeColor=$(if($isNG){[System.Drawing.Color]::FromArgb(255,120,120)}else{[System.Drawing.Color]::FromArgb(140,220,150)})
}

function Draw-DiffOverlay($bmp,$a) {
    # 「正常と違う」と判断したブロックを赤く塗って、何を見て判定しているか分かるようにする
    # 赤＝NGの判定に使った「いちばん大きな違う部分」、橙＝それ以外の小さな違い
    if(-not $a.LastMap -or $a.DiffFineW -le 0) { return }
    $off=Get-InnerOffset $bmp $a
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    $brMain=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(140,255,40,40))
    $brSub=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90,255,170,40))
    try {
        $gw=$a.DiffFineW; $gh=$a.DiffFineH; $iw=$a.Rect.Width; $ih=$a.Rect.Height
        for($b=0;$b -lt $a.LastMap.Length;$b++) {
            $v=$a.LastMap[$b]
            if($v -lt 0.25) { continue }
            $bx=$b % $gw; $by=[int][Math]::Floor($b/$gw)
            $x0=$off[0]+[int][Math]::Ceiling($bx*$iw/$gw); $x1=$off[0]+[int][Math]::Ceiling(($bx+1)*$iw/$gw)
            $y0=$off[1]+[int][Math]::Ceiling($by*$ih/$gh); $y1=$off[1]+[int][Math]::Ceiling(($by+1)*$ih/$gh)
            $g.FillRectangle($(if($v -ge 0.75){$brMain}else{$brSub}),$x0,$y0,[Math]::Max(1,$x1-$x0),[Math]::Max(1,$y1-$y0))
        }
    } finally { $brMain.Dispose(); $brSub.Dispose(); $g.Dispose() }
}

function Draw-MaskOverlay($bmp,$a) {
    # 除外した場所を斜線で示す（ここは判定に使わない）
    if($a.Masks.Count -eq 0) { return }
    $off=Get-InnerOffset $bmp $a
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    $hb=New-Object System.Drawing.Drawing2D.HatchBrush([System.Drawing.Drawing2D.HatchStyle]::WideDownwardDiagonal,[System.Drawing.Color]::FromArgb(170,160,170,255),[System.Drawing.Color]::FromArgb(70,20,20,40))
    $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220,170,180,255),1)
    try {
        foreach($m in $a.Masks) {
            $r=New-Object System.Drawing.Rectangle(($m.X+$off[0]),($m.Y+$off[1]),$m.Width,$m.Height)
            $g.FillRectangle($hb,$r)
            $g.DrawRectangle($pen,$r)
        }
    } finally { $hb.Dispose(); $pen.Dispose(); $g.Dispose() }
}

function Convert-PreviewPoint($x,$y) {
    # プレビュー（拡大表示）の上の位置を、表示している画像の中の位置に直す。画像の外なら $null
    $img=$areaPreviewBox.Image
    if(-not $img) { return $null }
    $pw=$areaPreviewBox.ClientSize.Width; $ph=$areaPreviewBox.ClientSize.Height
    $scale=[Math]::Min($pw/[double]$img.Width,$ph/[double]$img.Height)
    if($scale -le 0) { return $null }
    $ox=($pw-$img.Width*$scale)/2.0; $oy=($ph-$img.Height*$scale)/2.0
    return @(([double]$x-$ox)/$scale,([double]$y-$oy)/$scale)
}

function Set-MaskMode($on) {
    $script:maskMode=[bool]$on
    $script:maskDragStart=$null; $script:maskDragNow=$null
    if($script:maskMode) {
        if($script:eyedropper) { Set-Eyedropper $false }
        $maskBtn.Text='除外の指定をやめる'
        $areaPreviewBox.Cursor=[System.Windows.Forms.Cursors]::Cross
    } else {
        $maskBtn.Text='除外する場所を指定'
        if(-not $script:eyedropper) { $areaPreviewBox.Cursor=[System.Windows.Forms.Cursors]::Default }
    }
    $areaPreviewBox.Invalidate()
}

function Add-AreaMask($a,$x0,$y0,$x1,$y1) {
    # 画像の中の位置（周りの余白込み）で囲んだ四角を、エリアの中の四角にして追加する
    $img=$areaPreviewBox.Image
    if(-not $img) { return $false }
    $off=Get-InnerOffset $img $a
    $l=[int][Math]::Floor([Math]::Min($x0,$x1))-$off[0]; $t=[int][Math]::Floor([Math]::Min($y0,$y1))-$off[1]
    $r=[int][Math]::Ceiling([Math]::Max($x0,$x1))-$off[0]; $b=[int][Math]::Ceiling([Math]::Max($y0,$y1))-$off[1]
    $rect=[System.Drawing.Rectangle]::Intersect((New-Object System.Drawing.Rectangle($l,$t,($r-$l),($b-$t))),(New-Object System.Drawing.Rectangle(0,0,$a.Rect.Width,$a.Rect.Height)))
    if($rect.Width -lt 2 -or $rect.Height -lt 2) { return $false }
    if($rect.Width*$rect.Height -ge 0.9*$a.Rect.Width*$a.Rect.Height) {
        [void](Show-Message 'エリアのほぼ全部を除外すると、何も判定できなくなります。動く部分だけを小さく囲んでください。' ([System.Windows.Forms.MessageBoxIcon]::Information))
        return $false
    }
    if($a.Masks.Count -ge $script:maxMasks) {
        [void](Show-Message ('除外する場所は '+$script:maxMasks+' か所までです。') ([System.Windows.Forms.MessageBoxIcon]::Information))
        return $false
    }
    [void]$a.Masks.Add($rect)
    $a.MaskReady=$false
    return $true
}

function Get-AreaState($a) {
    # タイルに出す状態：@(文字, 色)
    if(-not (Test-AreaReady $a)) { return @('未設定',[System.Drawing.Color]::FromArgb(245,180,83)) }
    if($a.Occluded) { return @('重なり',[System.Drawing.Color]::FromArgb(245,180,83)) }
    if($a.CaptureFailed) { return @('読取不可',[System.Drawing.Color]::FromArgb(245,180,83)) }
    if(-not $script:running) { return @('待機',$textSecondary) }
    if($a.OutOfHours) { return @('時間外',$textSecondary) }
    if($a.WasNG) { if($a.Acked) { return @('NG 確認済',[System.Drawing.Color]::FromArgb(255,150,150)) } else { return @('NG',[System.Drawing.Color]::FromArgb(255,93,93)) } }
    if($a.NGStreak -gt 0) {
        if([int]$a.NGDelaySec -gt 0 -and $a.RawNGSince) {
            $left=[int][Math]::Ceiling([double]$a.NGDelaySec-((Get-Date)-$a.RawNGSince).TotalSeconds)
            if($left -gt 0) { return @(('あと'+(Format-Duration $left)),[System.Drawing.Color]::FromArgb(251,191,36)) }
        }
        return @('確認中',[System.Drawing.Color]::FromArgb(251,191,36))
    }
    return @('OK',[System.Drawing.Color]::FromArgb(52,211,153))
}

function Get-MeterScale($a) {
    # 「比べる」の値は小さいことが多いので、目盛りの最大を自動で合わせる（ほかは 0～100%）
    if($a.Mode -ne 'diff') { return 100.0 }
    $want=[Math]::Max(0.5,(Get-JudgeThreshold $a)*4.0)
    foreach($v in @($a.LastRatio,$a.NgRatio)) { if($null -ne $v) { $want=[Math]::Max($want,[double]$v*1.2) } }
    foreach($step in @(0.5,1,2,5,10,20,50,100)) { if($step -ge $want) { return [double]$step } }
    return 100.0
}

function Get-NGReasonText($a) {
    $r=$a.LastRatio
    if($null -eq $r) { return '' }
    if($a.Mode -eq 'diff') { return ('正常と違う（違い '+(Format-Percent $r)+'）') }
    if($a.Mode -eq 'match') { return ('異常の画面が出ている（一致 '+(Format-Percent $r)+'）') }
    if($a.Direction -eq 'disappear') { return ('色が消えた（'+(Format-Percent $r)+'）') }
    return ('色が出た（'+(Format-Percent $r)+'）')
}

function Get-NGSinceText($a,$now) {
    if(-not $a.NGSince) { return '' }
    return (([datetime]$a.NGSince).ToString('HH:mm:ss')+' から（'+(Format-Duration ($now-$a.NGSince).TotalSeconds)+'）')
}

function New-RoundPath($r,$rad) {
    $d=[Math]::Max(2,$rad*2)
    $path=New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($r.X,$r.Y,$d,$d,180,90)
    $path.AddArc(($r.Right-$d),$r.Y,$d,$d,270,90)
    $path.AddArc(($r.Right-$d),($r.Bottom-$d),$d,$d,0,90)
    $path.AddArc($r.X,($r.Bottom-$d),$d,$d,90,90)
    $path.CloseFigure()
    return $path
}

function Get-TileColumns {
    return [Math]::Max(1,[int][Math]::Floor(($tileBoard.ClientSize.Width+$script:tileGap)/($script:tileW+$script:tileGap)))
}

function Get-TileRect($i) {
    $cols=Get-TileColumns
    $c=$i % $cols; $r=[int][Math]::Floor($i/$cols)
    return (New-Object System.Drawing.Rectangle(($c*($script:tileW+$script:tileGap)),($r*($script:tileH+$script:tileGap)),$script:tileW,$script:tileH))
}

function Update-TileBoardSize {
    $cols=Get-TileColumns
    $rows=[int][Math]::Ceiling(($script:areas.Count+1)/[double]$cols)
    $h=$rows*($script:tileH+$script:tileGap)-$script:tileGap
    if($tileBoard.Height -ne $h) { $tileBoard.Height=$h }
}

function Draw-AreaTile($g,$a,$r,$selected) {
    $st=Get-AreaState $a
    $stColor=$st[1]
    $pad=Px 7
    $path=New-RoundPath $r (Px 10)
    $bg=New-Object System.Drawing.SolidBrush($(if($a.WasNG -and $script:running -and -not $a.Acked){[System.Drawing.Color]::FromArgb(58,16,22)}else{$inputBgDark}))
    $g.FillPath($bg,$path); $bg.Dispose()
    $edge=$(if($selected){$accentBlue}elseif($a.WasNG -and $script:running){$stColor}else{[System.Drawing.Color]::FromArgb(40,54,78)})
    $pen=New-Object System.Drawing.Pen($edge,$(if($selected -or ($a.WasNG -and $script:running)){(Px 2)}else{1}))
    $g.DrawPath($pen,$path); $pen.Dispose(); $path.Dispose()
    # 映像
    $th=New-Object System.Drawing.Rectangle(($r.X+$pad),($r.Y+$pad),($r.Width-2*$pad),(Px 72))
    $tb=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(11,17,30))
    $g.FillRectangle($tb,$th); $tb.Dispose()
    if($a.Thumb) {
        try {
            $s=[Math]::Min($th.Width/[double]$a.Thumb.Width,$th.Height/[double]$a.Thumb.Height)
            $w=[int]($a.Thumb.Width*$s); $h=[int]($a.Thumb.Height*$s)
            $g.DrawImage($a.Thumb,($th.X+[int](($th.Width-$w)/2)),($th.Y+[int](($th.Height-$h)/2)),$w,$h)
        } catch {}
    } else {
        $g.DrawString('映像なし',$script:tileSmallFont,$script:areaListSubBrush,($th.X+(Px 6)),($th.Y+(Px 6)))
    }
    # 状態の札
    $pill=$st[0]
    $ps=$g.MeasureString($pill,$script:tilePillFont)
    $pr=New-Object System.Drawing.Rectangle(($th.X+(Px 4)),($th.Y+(Px 4)),([int]$ps.Width+(Px 8)),([int]$ps.Height+(Px 2)))
    $pp=New-RoundPath $pr ([int]($pr.Height/2))
    $pb=New-Object System.Drawing.SolidBrush($stColor)
    $g.FillPath($pb,$pp); $pb.Dispose(); $pp.Dispose()
    $g.DrawString($pill,$script:tilePillFont,$script:tilePillTextBrush,($pr.X+(Px 4)),($pr.Y+(Px 1)))
    # 判定のしかた
    $tag=$(if($a.Mode -eq 'diff'){'比べる'}elseif($a.Mode -eq 'match'){'異常画面'}else{'色'})
    $ts=$g.MeasureString($tag,$script:tileSmallFont)
    $tr=New-Object System.Drawing.RectangleF(($th.Right-$ts.Width-(Px 6)),($th.Y+(Px 4)),($ts.Width+(Px 2)),$ts.Height)
    $g.FillRectangle($script:tileTagBrush,$tr)
    $g.DrawString($tag,$script:tileSmallFont,$script:areaListNameBrush,($tr.X+(Px 1)),$tr.Y)
    # 名前
    $nr=New-Object System.Drawing.RectangleF(($r.X+$pad),($th.Bottom+(Px 4)),($r.Width-2*$pad),($script:tileNameFont.Height+(Px 2)))
    $g.DrawString($a.Name,$script:tileNameFont,$script:areaListNameBrush,$nr,$script:tileEllipsis)
    # メーター（黄色い線＝しきい値）
    $my=[int]$nr.Bottom+(Px 4)
    $mr=New-Object System.Drawing.Rectangle(($r.X+$pad),$my,($r.Width-2*$pad),(Px 6))
    $g.FillRectangle($script:tileMeterBgBrush,$mr)
    $scale=Get-MeterScale $a
    if($null -ne $a.LastRatio -and -not $a.Occluded) {
        $fw=[int]($mr.Width*[Math]::Min($scale,[double]$a.LastRatio)/$scale)
        $fb=New-Object System.Drawing.SolidBrush($(if(Test-RatioIsNG $a $a.LastRatio){[System.Drawing.Color]::FromArgb(255,93,93)}else{[System.Drawing.Color]::FromArgb(52,211,153)}))
        $g.FillRectangle($fb,$mr.X,$mr.Y,$fw,$mr.Height); $fb.Dispose()
    }
    $tx=$mr.X+[int]($mr.Width*[Math]::Min($scale,(Get-JudgeThreshold $a))/$scale)
    $g.FillRectangle($script:tileThrBrush,($tx-1),($my-(Px 3)),(Px 2),($mr.Height+(Px 6)))
    # 数値
    $word=$(if($a.Mode -eq 'diff'){'違い '}elseif($a.Mode -eq 'match'){'一致 '}else{'一致率 '})
    $val=$(if($null -ne $a.LastRatio -and -not $a.Occluded){Format-Percent $a.LastRatio}else{'－'})
    $vr=New-Object System.Drawing.RectangleF(($r.X+$pad),($mr.Bottom+(Px 4)),($r.Width-2*$pad),($script:tileSmallFont.Height+(Px 2)))
    $extra=''
    if($a.ScheduleOn) { $extra+='　'+(Get-ScheduleText $a) }
    if([int]$a.NGDelaySec -gt 0) { $extra+='　'+(Format-Duration $a.NGDelaySec)+'待ち' }
    $g.DrawString(($word+$val+' ／ '+(Format-Percent (Get-JudgeThreshold $a))+$extra),$script:tileSmallFont,$script:areaListSubBrush,$vr,$script:tileEllipsis)
}

function Draw-AddTile($g,$r) {
    $path=New-RoundPath $r (Px 10)
    $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70,90,120),(Px 2))
    $pen.DashStyle=[System.Drawing.Drawing2D.DashStyle]::Dash
    $g.DrawPath($pen,$path); $pen.Dispose(); $path.Dispose()
    $sf=New-Object System.Drawing.StringFormat
    $sf.Alignment=[System.Drawing.StringAlignment]::Center
    $sf.LineAlignment=[System.Drawing.StringAlignment]::Center
    $g.DrawString("＋`r`nエリアを追加",$script:tileNameFont,$script:areaListSubBrush,(New-Object System.Drawing.RectangleF($r.X,$r.Y,$r.Width,$r.Height)),$sf)
    $sf.Dispose()
}

function Update-IdleThumbs {
    # 監視していない時も、タイルの映像をときどき新しくする（2秒ごと、選んでいないエリア）
    $now=Get-Date
    $sel=Get-SelectedArea
    foreach($a in $script:areas) {
        if($a -eq $sel -or ($now-$a.ThumbAt).TotalSeconds -lt 2) { continue }
        if(-not (Test-AreaOnScreen $a.Rect) -or (Test-AreaOccluded $a.Rect)) { continue }
        try {
            $bmp=GrabBitmap (Get-CaptureRect $a)
            try { Update-AreaThumb $a $bmp } finally { $bmp.Dispose() }
        } catch {}
    }
}

function Update-TodaySummary {
    $t=Get-TodaySummaryText
    if($summaryLabel.Text -ne $t) { $summaryLabel.Text=$t }
}

function Update-LiveRatioFromPreview {
    # 設定を変えた直後に、今のプレビュー画像で計算し直す（新しく撮影はしない）
    $a=Get-SelectedArea
    if(-not $a -or $script:running) { return }
    UpdateAreaPreview
    $tileBoard.Invalidate()
}

function UpdateAreaPreview {
    $a=Get-SelectedArea
    if(-not $a) {
        if($areaPreviewBox.Image) { $old=$areaPreviewBox.Image; $areaPreviewBox.Image=$null; $old.Dispose() }
        $areaPreviewInfoLabel.Text='①のタイルでエリアを選ぶと、左に今の映像が表示されます'
        Update-MeterLabel
        $meterBox.Invalidate()
        return
    }
    $info=($a.Name+'　位置 X='+$a.Rect.X+' Y='+$a.Rect.Y+'　大きさ '+$a.Rect.Width+'×'+$a.Rect.Height)
    try {
        $bmp=GrabBitmap (Get-CaptureRect $a)
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
        if(-not $hidden) { Update-AreaThumb $a $bmp }
        if($a.Mode -ne 'color' -and -not $hidden -and -not $script:eyedropper) { Draw-DiffOverlay $bmp $a }
        if($a.Mode -ne 'color') { Draw-MaskOverlay $bmp $a }
        $old=$areaPreviewBox.Image
        $areaPreviewBox.Image=$bmp
        if($old) { $old.Dispose() }
        if(-not (Test-AreaOnScreen $a.Rect)) {
            $info+="`r`n⚠ 画面の外にはみ出しています。「範囲を選び直す」で選び直してください。"
        } elseif($hidden) {
            $info+="`r`n⚠ この画面の下に隠れています。この画面を動かすか「ミニ表示」にしてください。"
        } elseif($a.Mode -eq 'match' -and $a.MatchNgRefs.Count -gt 0) {
            $info+="`r`n赤い部分＝異常の画面と同じに見える場所"
        } elseif($a.Mode -eq 'diff' -and $a.DiffRefs.Count -gt 0) {
            $info+="`r`n赤い部分＝正常と違うと判断した場所（橙は小さすぎてNGにしない違い）"
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
    if($script:eyedropper -and $script:maskMode) { $script:maskMode=$false; $script:maskDragStart=$null; $maskBtn.Text='除外する場所を指定' }
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
    try { [NgWin79]::KeepAwake($false) } catch {}
    $ackBtn.Visible=$false
    Update-RunButtons
    $tileBoard.Invalidate()
    if($reasonText) { SetStatusPanel $colorIdle $textOnIdle $reasonText }
}

function Set-AreaRect($a,$rect) {
    # 範囲が変わったら、その範囲用の見本・作業用の画像は作り直す
    $a.Rect=$rect
    Clear-AreaBuffers $a
    Clear-DiffReference $a
    Clear-MatchReference $a
    $a.Masks.Clear()          # 除外する場所も範囲の中の位置なので、選び直したら消す
    Set-AreaGrids $a
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
    if($a.DiffFineW -le 0) { Set-AreaGrids $a }
    $count=$script:okFrameCount; $interval=150; $what='正常な状態を記録中'
    if($longRecordCheck.Checked) { $count=$script:longFrameCount; $interval=200; $what='正常な状態を長めに記録中（約30秒。いつも通り動かしたままでOK）' }
    try {
        $frames=Capture-DiffFrames $a $count $interval ($a.Name+'：'+$what) $(if($Append){'ok_add'}else{'ok'})
    } catch {
        [void](Show-Message ('画面を撮影できませんでした。'+"`r`n"+$_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return $false
    }
    $ref=[NgDiff79]::BuildReference($frames,$a.Rect.Width,$a.Rect.Height)
    Reset-AreaWithLog $a 'NG解除（正常の見本を記録）'
    if(-not $Append) {
        Remove-RefImages $a @('ok','ok_add','ng') $script:lastRefImagePath   # 置き換えた古い見本の画像
        $a.DiffRefs.Clear(); $a.DiffOkFrames=$null; $a.DiffNgMeans=$null
        # 記録し直したら、感度・しきい値も新しい判定方法の初期値に戻す
        $a.DiffSensitivity=50; $a.DiffThreshold=0.15
    }
    [void]$a.DiffRefs.Add($ref)
    Update-DiffRefArray $a
    $all=New-Object System.Collections.ArrayList
    if($a.DiffOkFrames) { foreach($fr in $a.DiffOkFrames) { [void]$all.Add($fr) } }
    # 長めに記録した時は、メーターの▼の計算が重くならないよう30コマ程度に間引いて覚える
    $step=[Math]::Max(1,[int][Math]::Ceiling($frames.Length/30.0))
    for($i=0;$i -lt $frames.Length;$i+=$step) { [void]$all.Add($frames[$i]) }
    $a.DiffOkFrames=[float[][][]]$all.ToArray([float[][]])
    Update-SampleRatios $a
    $n=$a.DiffRefs.Count
    $a.TuneColor=[System.Drawing.Color]::FromArgb(140,220,150)
    $a.TuneText=('正常の見本を記録しました（全部で '+$n+' 枚）。これで監視できます。'+"`r`n"+'異常を画面に出せる場合は「② 異常を記録」を押すと、感度をさらに合わせられます。')
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $tileBoard.Invalidate()
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
        $frames=Capture-DiffFrames $a 3 150 ($a.Name+'：異常な状態を記録中') 'ng'
    } catch {
        [void](Show-Message ('画面を撮影できませんでした。'+"`r`n"+$_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return
    }
    Remove-RefImages $a @('ng') $script:lastRefImagePath
    $avg=[NgDiff79]::BuildReference($frames,$a.Rect.Width,$a.Rect.Height)   # 3枚の平均
    $ng=New-Object 'float[][]' 2
    $ng[0]=$avg[0]; $ng[1]=$avg[2]
    $a.DiffNgMeans=$ng
    $okFrames=$a.DiffOkFrames
    if(-not $okFrames) { $okFrames=New-Object 'float[][][]' 0 }
    if(-not $a.MaskReady) { Update-AreaMasks $a }
    $res=[NgDiff79]::TuneMasked($a.DiffRefArray,$okFrames,$ng,$a.Rect.Width,$a.Rect.Height,$a.FineMask,$a.CoarseMask)
    $okMax=[math]::Round($res[1],2); $ngScore=[math]::Round($res[2],2)
    if(($ngScore-$okMax) -lt 0.1) {
        $a.TuneColor=[System.Drawing.Color]::FromArgb(255,150,150)
        $a.TuneText='正常と異常の映像にほとんど違いがありませんでした。異常がきちんと画面に映っている時に押し直すか、範囲をもっと小さく囲んでください。'
        Update-SampleRatios $a
        Update-TuneLabel $a
        $meterBox.Invalidate()
        return
    }
    Reset-AreaWithLog $a 'NG解除（自動調整）'
    $a.DiffSensitivity=[int]$res[0]
    # しきい値は正常と異常の真ん中（0.05%きざみ）
    $a.DiffThreshold=[Math]::Round([Math]::Max(0.05,[Math]::Min(20.0,[Math]::Round(($okMax+$ngScore)/2/0.05)*0.05)),2)
    $gap=$ngScore-$okMax
    if($gap -ge 1.0 -and $okMax -le 0.05) { $quality='◎ 正常と異常の差が大きく、安定して判定できます。'; $qc=[System.Drawing.Color]::FromArgb(140,220,150) }
    elseif($gap -ge 0.25) { $quality='○ 判定できます。'; $qc=[System.Drawing.Color]::FromArgb(140,220,150) }
    else { $quality='△ 差が小さいため、誤判定のおそれがあります。異常の部分だけを小さく囲み直すと安定します。'; $qc=[System.Drawing.Color]::FromArgb(255,190,110) }
    $a.TuneColor=$qc
    $a.TuneText=('自動調整しました：正常時 '+$okMax+'% ／ 異常時 '+$ngScore+'% → '+(Format-Percent $a.DiffThreshold)+' 以上違ったらNG（感度 '+$a.DiffSensitivity+'）'+"`r`n"+$quality)
    Update-SampleRatios $a
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $tileBoard.Invalidate()
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：自動調整が完了しました')
}

function Add-MatchReference($a,$list,$samples,[switch]$Ng) {
    $ref=[NgDiff79]::BuildReference($samples,$a.Rect.Width,$a.Rect.Height)
    if($Ng) {
        [void]$a.MatchNgRefs.Add($ref)
        $old=@(); if($a.MatchNgSamples) { $old=@($a.MatchNgSamples) }
        $a.MatchNgSamples=[float[][][]](@($old)+@($samples))
    } else {
        [void]$a.MatchOkRefs.Add($ref)
        $old=@(); if($a.MatchOkSamples) { $old=@($a.MatchOkSamples) }
        $a.MatchOkSamples=[float[][][]](@($old)+@($samples))
    }
    Update-MatchArrays $a
}

function Update-MatchTuning($a) {
    # 記録した異常・正常の見本から、NGにする一致度を決める
    Reset-AreaWithLog $a 'NG解除（見本を記録）'
    Update-SampleRatios $a
    $ng=$a.NgRatio; $ok=$a.OkRatio
    $qc=[System.Drawing.Color]::FromArgb(140,220,150)
    if($null -ne $ok -and $null -ne $ng) {
        $thr=[Math]::Min(90.0,$ng-3.0)
        if($thr -le $ok+3.0) {
            $thr=($ok+$ng)/2.0
            $quality='△ 正常な画面と異常の画面がよく似ていて、見分けにくい状態です。異常の時に変わる部分だけを小さく囲み直すと安定します。'
            $qc=[System.Drawing.Color]::FromArgb(255,190,110)
        } elseif(($ng-$ok) -ge 30) {
            $quality='◎ 正常な画面と異常の画面をはっきり見分けられます。'
        } else {
            $quality='○ 見分けられます。'
        }
        $a.MatchThreshold=[Math]::Max(1,[Math]::Min(100,[int][Math]::Round($thr)))
        $a.TuneText=('正常な画面：一致 '+$ok+'% ／ 異常の画面：一致 '+$ng+'% → '+$a.MatchThreshold+'% 以上似ていたらNG'+"`r`n"+$quality)
    } else {
        $a.MatchThreshold=90
        $a.TuneText=('異常の画面の見本を記録しました（'+$a.MatchNgRefs.Count+'枚）。この画面が出たら鳴ります。'+"`r`n"+'正常な画面に戻ったら「② 正常な画面を記録」も押すと、似た別の画面で鳴ってしまうのを防げます。')
    }
    $a.TuneColor=$qc
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $tileBoard.Invalidate()
    Mark-SettingsDirty
}

function Record-MatchNG($a) {
    # 今映っている「異常の時だけ出る画面」を見本として記録する
    if(-not (Test-CanRecord $a)) { return $false }
    if($a.MatchNgRefs.Count -ge $script:maxDiffRefs) {
        [void](Show-Message ('異常の画面の見本は '+$script:maxDiffRefs+' 枚までです。「詳しい設定」の「記録した見本をすべて消す」で消してから記録し直してください。') ([System.Windows.Forms.MessageBoxIcon]::Information))
        return $false
    }
    if($a.DiffFineW -le 0) { Set-AreaGrids $a }
    try { $frames=Capture-DiffFrames $a 3 150 ($a.Name+'：異常の画面を記録中') 'match_ng' }
    catch { [void](Show-Message ('画面を撮影できませんでした。'+"`r`n"+$_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Warning)); return $false }
    Add-MatchReference $a $a.MatchNgRefs $frames -Ng
    Update-MatchTuning $a
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：異常の画面を記録しました（'+$a.MatchNgRefs.Count+'枚）')
    return $true
}

function Record-MatchOK($a) {
    # 正常な画面を記録する（似た別の画面で鳴らないように、見分ける場所をしぼるため）
    if(-not (Test-CanRecord $a)) { return }
    if($a.MatchOkRefs.Count -ge $script:maxDiffRefs) {
        [void](Show-Message ('正常な画面の見本は '+$script:maxDiffRefs+' 枚までです。') ([System.Windows.Forms.MessageBoxIcon]::Information))
        return
    }
    if($a.DiffFineW -le 0) { Set-AreaGrids $a }
    try { $frames=Capture-DiffFrames $a $script:okFrameCount 150 ($a.Name+'：正常な画面を記録中') 'match_ok' }
    catch { [void](Show-Message ('画面を撮影できませんでした。'+"`r`n"+$_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Warning)); return }
    Add-MatchReference $a $a.MatchOkRefs $frames
    Update-MatchTuning $a
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：正常な画面を記録しました（'+$a.MatchOkRefs.Count+'枚）')
}

function Get-ImageForArea($img,$a) {
    # 読み込んだ画像を、監視範囲と同じ大きさの画像にする。
    # 返り値：@(画像, 説明)。合わせられない場合は画像が $null
    $w=$a.Rect.Width; $h=$a.Rect.Height
    $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen
    $src=$null; $note=''
    if($img.Width -eq $w -and $img.Height -eq $h) {
        $src=New-Object System.Drawing.Rectangle(0,0,$w,$h); $note='範囲と同じ大きさの画像'
    } elseif($img.Width -eq $vs.Width -and $img.Height -eq $vs.Height) {
        $src=New-Object System.Drawing.Rectangle(($a.Rect.X-$vs.X),($a.Rect.Y-$vs.Y),$w,$h); $note='画面全体のスクリーンショット'
    } elseif($img.Width -eq $w+160 -and $img.Height -eq $h+160) {
        $src=New-Object System.Drawing.Rectangle(80,80,$w,$h); $note='このアプリが保存したNG画像'
    } else {
        foreach($scr in [System.Windows.Forms.Screen]::AllScreens) {
            $b=$scr.Bounds
            if($img.Width -eq $b.Width -and $img.Height -eq $b.Height -and $b.Contains($a.Rect)) {
                $src=New-Object System.Drawing.Rectangle(($a.Rect.X-$b.X),($a.Rect.Y-$b.Y),$w,$h); $note='モニター1台分のスクリーンショット'; break
            }
        }
    }
    $out=New-Object System.Drawing.Bitmap($w,$h)
    $g=[System.Drawing.Graphics]::FromImage($out)
    try {
        if($src) {
            $g.DrawImage($img,(New-Object System.Drawing.Rectangle(0,0,$w,$h)),$src,[System.Drawing.GraphicsUnit]::Pixel)
        } else {
            # 切り抜いた画像など：範囲の大きさに合わせて伸び縮みさせる
            $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.DrawImage($img,0,0,$w,$h)
            $note='大きさが範囲と違うため、範囲に合わせて拡大・縮小しました'
        }
    } finally { $g.Dispose() }
    return @($out,$note)
}

function Import-MatchNGFromFile($a) {
    # 異常の画面がいま出ていない時のために、前に撮った画像から見本を作る
    if($a.MatchNgRefs.Count -ge $script:maxDiffRefs) {
        [void](Show-Message ('異常の画面の見本は '+$script:maxDiffRefs+' 枚までです。') ([System.Windows.Forms.MessageBoxIcon]::Information))
        return
    }
    $dlg=New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title='異常の画面の画像を選ぶ（スクリーンショット・ng_images の画像など）'
    $dlg.Filter='画像 (*.png;*.jpg;*.jpeg;*.bmp)|*.png;*.jpg;*.jpeg;*.bmp|すべてのファイル (*.*)|*.*'
    try { if(Test-Path -LiteralPath $script:imageDir) { $dlg.InitialDirectory=$script:imageDir } } catch {}
    if($dlg.ShowDialog($f) -ne [System.Windows.Forms.DialogResult]::OK) { $dlg.Dispose(); return }
    $file=$dlg.FileName; $dlg.Dispose()
    $img=$null; $bmp=$null
    try {
        # ファイルを開いたままにしないよう、メモリに読み込んでから使う
        $bytes=[System.IO.File]::ReadAllBytes($file)
        $ms=New-Object System.IO.MemoryStream(,$bytes)
        $img=[System.Drawing.Image]::FromStream($ms)
        if($a.DiffFineW -le 0) { Set-AreaGrids $a }
        $res=Get-ImageForArea $img $a
        $bmp=$res[0]
        $smp=New-Object 'float[][][]' 1
        $smp[0]=[NgDiff79]::Sample($bmp,0,0,$a.Rect.Width,$a.Rect.Height)
        Add-MatchReference $a $a.MatchNgRefs $smp -Ng
        [void](Save-RefImage $a 'match_file' $bmp)
        Update-MatchTuning $a
        $a.TuneText=($a.TuneText+"`r`n（読み込んだ画像："+$res[1]+'）')
        Update-TuneLabel $a
        SetStatusPanel $colorReady $textOnReady ($a.Name+'：画像から異常の画面を読み込みました（'+[System.IO.Path]::GetFileName($file)+'）')
    } catch {
        [void](Show-Message ('画像を読み込めませんでした。'+"`r`n"+$_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Warning))
    } finally {
        if($bmp) { $bmp.Dispose() }
        if($img) { $img.Dispose() }
    }
}

function Invoke-AutoTune($a) {
    $res=[NgVision79]::AutoTune($a.OkSnap,$a.NgSnap,$a.Color)
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
            # 範囲が変わったので、登録した画像も絞り込んだ範囲で撮り直す
            Remove-RefImages $a
            [void](Save-RefImage $a 'area')
            [void](Save-RefImage $a 'color_ok' $a.OkSnap)
            [void](Save-RefImage $a 'color_ng' $a.NgSnap)
            $res2=[NgVision79]::AutoTune($a.OkSnap,$a.NgSnap,$a.Color)
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
    $tileBoard.Invalidate()
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
    $rk=$(if($kind -eq 'OK'){'color_ok'}else{'color_ng'})
    $rp=Save-RefImage $a $rk
    if($rp) { Remove-RefImages $a @($rk) $rp }
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

function Update-AutoAreaNames {
    # 自動で付けた名前（エリア＋数字）を、一覧の順に エリア1, エリア2… と付け直す（削除で空いた番号を詰める）。
    # 自分で付けた名前（1号機ランプ など）はそのまま。返り値：変えた名前の一覧（'エリア3→エリア2' の形）
    $changes=New-Object System.Collections.ArrayList
    $n=0
    foreach($a in $script:areas) {
        if([string]$a.Name -cnotmatch '^エリア[0-9]+$') { continue }
        $n++
        $new='エリア'+$n
        if($a.Name -ne $new) { [void]$changes.Add($a.Name+'→'+$new); $a.Name=$new }
    }
    $script:areaCounter=$n   # 次に追加するエリアは エリア(n+1)
    return ,$changes
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
    Set-AreaModeFor $a $mode
    $msg=$(if($mode -eq 'diff'){'：「正常な映像と比べる」にしました'}elseif($mode -eq 'match'){'：「異常の時だけ出る画面が出たらNG」にしました。異常の画面を記録してください'}else{'：「色で判定する」にしました。②の「① 正常（OK）を記録」「② 異常（NG）を記録」を押してください'})
    SetStatusPanel $colorReady $textOnReady ($a.Name+$msg)
}

function Set-AreaModeFor($a,$mode) {
    if($a.Mode -eq $mode) { return }
    Reset-AreaWithLog $a 'NG解除（判定のしかたを変更）'
    $a.Mode=$mode
    Clear-AreaBuffers $a      # 撮る範囲（周りの余白の有無）が変わるため
    if($a.DiffFineW -le 0) { Set-AreaGrids $a }
    $a.TuneText=$null
    $a.LastRatio=$null
    $a.LastMap=$null
    Update-SampleRatios $a
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $tileBoard.Invalidate()
    Mark-SettingsDirty
}

function Start-AreaSetupWizard($a) {
    # エリアを追加した直後に、質問1つで設定を終わらせる
    $choice=Show-Choice ($a.Name+' を追加しました') ("今、このエリアには何が映っていますか？`r`n（記録には約2秒かかります。その間、画面を動かさないでください）") @(
        '正常な画面が映っている（違いが出たら鳴らす）',
        '異常の時だけ出る画面が映っている（この画面が出たら鳴らす）',
        'あとで設定する')
    if($choice -eq 0) {
        Set-AreaModeFor $a 'diff'
        if(Record-DiffOK $a) {
            SetStatusPanel $colorReady $textOnReady ($a.Name+'：設定完了！「▶ 監視スタート」で監視できます。（登録した画面は「登録した画像を見る」で確認できます）')
        }
    } elseif($choice -eq 1) {
        Set-AreaModeFor $a 'match'
        LoadAreaSettingsIntoSliders
        if(Record-MatchNG $a) {
            SetStatusPanel $colorReady $textOnReady ($a.Name+'：設定完了！この画面が出たら鳴ります。正常な画面に戻ったら「② 正常な画面を記録」も押すとより確実です。')
        }
    } else {
        SetStatusPanel $colorReady $textOnReady ($a.Name+'を追加しました。②で判定のしかたを選び、見本を記録してください。')
    }
}

# ================== イベント ==================
$tileBoard.Add_Paint({
    $g=$_.Graphics
    $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.Clear($cardBgDark)
    $sel=$areaList.SelectedIndex
    for($i=0;$i -lt $script:areas.Count;$i++) {
        try { Draw-AreaTile $g $script:areas[$i] (Get-TileRect $i) ($i -eq $sel) } catch {}
    }
    Draw-AddTile $g (Get-TileRect $script:areas.Count)
})
$tileMenu=New-Object System.Windows.Forms.ContextMenuStrip
$tileMenuImages=$tileMenu.Items.Add('登録した画像を見る')
$tileMenuHighlight=$tileMenu.Items.Add('画面で位置を確認')
[void]$tileMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$tileMenuRename=$tileMenu.Items.Add('名前を変更')
$tileMenuRepick=$tileMenu.Items.Add('範囲を選び直す')
$tileMenuDelete=$tileMenu.Items.Add('削除')
$tileMenuRename.Add_Click({ $renameBtn.PerformClick() })
$tileMenuRepick.Add_Click({ $repickBtn.PerformClick() })
$tileMenuDelete.Add_Click({ $deleteAreaBtn.PerformClick() })
$tileMenuImages.Add_Click({ Show-RefImages (Get-SelectedArea) })
$tileMenuHighlight.Add_Click({ $a=Get-SelectedArea; if($a) { Show-AreaHighlight $a.Rect } })
$tileBoard.Add_MouseDown({
    if($_.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
        # 右クリック：そのエリアを選んでメニューを出す
        for($i=0;$i -lt $script:areas.Count;$i++) {
            if((Get-TileRect $i).Contains($_.Location)) {
                if($areaList.SelectedIndex -ne $i) { $areaList.SelectedIndex=$i; $tileBoard.Invalidate() }
                $tileMenu.Show($tileBoard,$_.Location)
                return
            }
        }
        return
    }
    if($_.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    for($i=0;$i -le $script:areas.Count;$i++) {
        if((Get-TileRect $i).Contains($_.Location)) {
            if($i -eq $script:areas.Count) { $pick.PerformClick() }
            elseif($areaList.SelectedIndex -ne $i) { $areaList.SelectedIndex=$i; $tileBoard.Invalidate() }
            return
        }
    }
})
$tileBoard.Add_MouseDoubleClick({
    for($i=0;$i -lt $script:areas.Count;$i++) {
        if((Get-TileRect $i).Contains($_.Location)) { Show-AreaHighlight $script:areas[$i].Rect; return }
    }
})
$tileBoard.Add_SizeChanged({ $tileBoard.Invalidate() })
$script:tileNameFont=UIFont 9.5 -Bold
$script:tileSmallFont=UIFont 8
$script:tilePillFont=UIFont 8 -Bold
$script:tilePillTextBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10,15,25))
$script:tileTagBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(170,7,11,20))
$script:tileMeterBgBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45,58,80))
$script:tileThrBrush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(251,191,36))
$script:tileEllipsis=New-Object System.Drawing.StringFormat
$script:tileEllipsis.Trimming=[System.Drawing.StringTrimming]::EllipsisCharacter
$script:tileEllipsis.FormatFlags=[System.Drawing.StringFormatFlags]::NoWrap
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
    $scale=Get-MeterScale $a
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
        $txt=('最大 '+(Format-Percent $scale))
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
    $tileBoard.Invalidate()
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
            $rgb=[NgVision79]::AverageColor($bmp)
            $bmp.Dispose()
            $newArea=New-MonitorArea (New-AreaName) $script:area ([System.Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2]))
            Set-AreaRect $newArea $script:area
            [void](Save-RefImage $newArea 'area')
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
            Remove-RefImages $a
            [void](Save-RefImage $a 'area')
            RefreshAreaListUI
            Mark-SettingsDirty
            if($a.Mode -ne 'color') { Start-AreaSetupWizard $a }
            else { SetStatusPanel $colorReady $textOnReady ($a.Name+'の範囲を選び直しました。②で正常（OK）・異常（NG）を記録し直してください。') }
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
    Remove-RefImageFolder $a
    $script:areas.Remove($a)
    $renamed=Update-AutoAreaNames
    RefreshAreaListUI
    Mark-SettingsDirty
    if($script:areas.Count -eq 0 -and $script:running) {
        Stop-Monitoring ($a.Name+'を削除しました。監視対象が無くなったため、監視を停止しました。')
    } else {
        $msg=$a.Name+'を削除しました。'
        if($renamed.Count -gt 0) { $msg+='番号を詰めました（'+($renamed -join '、')+'）' }
        SetStatusPanel $colorIdle $textOnIdle $msg
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
    $pt=Convert-PreviewPoint $_.X $_.Y
    if(-not $pt) { return }
    $ix=[int]$pt[0]; $iy=[int]$pt[1]
    if($ix -lt 0 -or $iy -lt 0 -or $ix -ge $img.Width -or $iy -ge $img.Height) { return }
    $rgb=[NgVision79]::AverageColorAt([System.Drawing.Bitmap]$img,$ix,$iy,2)
    $a.Color=[System.Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2])
    Update-SampleRatios $a
    Mark-SettingsDirty
    Set-Eyedropper $false
    Update-ColorLabel $a
    Update-TuneLabel $a
    Update-LiveRatioFromPreview
    SetStatusPanel $colorReady $textOnReady ($a.Name+'の検出する色を R'+$rgb[0]+' G'+$rgb[1]+' B'+$rgb[2]+' に変更しました')
})

$areaPreviewBox.Add_MouseDown({
    if(-not $script:maskMode -or $_.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    $script:maskDragStart=$_.Location
    $script:maskDragNow=$_.Location
})
$areaPreviewBox.Add_MouseMove({
    if(-not $script:maskMode -or -not $script:maskDragStart) { return }
    $script:maskDragNow=$_.Location
    $areaPreviewBox.Invalidate()
})
$areaPreviewBox.Add_MouseUp({
    if(-not $script:maskMode -or -not $script:maskDragStart) { return }
    $a=Get-SelectedArea
    $p0=Convert-PreviewPoint $script:maskDragStart.X $script:maskDragStart.Y
    $p1=Convert-PreviewPoint $_.X $_.Y
    $script:maskDragStart=$null; $script:maskDragNow=$null
    if($a -and $p0 -and $p1 -and (Add-AreaMask $a $p0[0] $p0[1] $p1[0] $p1[1])) {
        Set-MaskMode $false
        Update-SampleRatios $a
        LoadAreaSettingsIntoSliders
        UpdateAreaPreview
        $tileBoard.Invalidate()
        Mark-SettingsDirty
        SetStatusPanel $colorReady $textOnReady ($a.Name+'：囲んだ場所を判定から外しました（全部で '+$a.Masks.Count+' か所）')
    } else {
        $areaPreviewBox.Invalidate()
    }
})
$areaPreviewBox.Add_Paint({
    if(-not $script:maskMode -or -not $script:maskDragStart -or -not $script:maskDragNow) { return }
    $x=[Math]::Min($script:maskDragStart.X,$script:maskDragNow.X); $y=[Math]::Min($script:maskDragStart.Y,$script:maskDragNow.Y)
    $w=[Math]::Abs($script:maskDragNow.X-$script:maskDragStart.X); $h=[Math]::Abs($script:maskDragNow.Y-$script:maskDragStart.Y)
    $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,210,60),2)
    $pen.DashStyle=[System.Drawing.Drawing2D.DashStyle]::Dash
    $_.Graphics.DrawRectangle($pen,$x,$y,$w,$h)
    $pen.Dispose()
})
$maskBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    Set-MaskMode (-not $script:maskMode)
    if($script:maskMode) { SetStatusPanel $colorReady $textOnReady ($a.Name+'：左の映像の上で、判定から外したい場所をドラッグで囲んでください') }
})
$maskClearBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a -or $a.Masks.Count -eq 0) { return }
    $a.Masks.Clear()
    $a.MaskReady=$false
    Reset-AreaWithLog $a 'NG解除（除外の変更）'
    Update-SampleRatios $a
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $tileBoard.Invalidate()
    Mark-SettingsDirty
    SetStatusPanel $colorReady $textOnReady ($a.Name+'：除外する場所をすべて消しました（エリア全体で判定します）')
})
$adaptCheck.Add_CheckedChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.AdaptDrift=$adaptCheck.Checked
    if(-not $a.AdaptDrift) { Update-DiffRefArray $a }   # 合わせた分を捨てて、記録した見本に戻す
    Mark-SettingsDirty
})
function Get-AreaSummaryText($a) {
    $modeText=$(if($a.Mode -eq 'diff'){'正常な映像と比べる'}elseif($a.Mode -eq 'match'){'異常の時だけ出る画面が出たらNG'}else{'色で判定する'})
    $lines=@(($a.Name+'　｜　判定のしかた：'+$modeText),('位置 X='+$a.Rect.X+' Y='+$a.Rect.Y+'　大きさ '+$a.Rect.Width+'×'+$a.Rect.Height))
    if($a.Mode -eq 'diff') {
        $lines+=('正常の見本 '+$a.DiffRefs.Count+' 枚　｜　'+(Format-Percent $a.DiffThreshold)+' 以上違ったらNG（感度 '+$a.DiffSensitivity+'）')
    } elseif($a.Mode -eq 'match') {
        $lines+=('異常の画面 '+$a.MatchNgRefs.Count+' 枚・正常な画面 '+$a.MatchOkRefs.Count+' 枚　｜　一致 '+$a.MatchThreshold+'% 以上でNG')
    } else {
        $dir=$(if($a.Direction -eq 'disappear'){'色が消えたらNG'}else{'色が出たらNG'})
        $lines+=('検出する色 R'+$a.Color.R+' G'+$a.Color.G+' B'+$a.Color.B+'　｜　'+$dir+'（一致率 '+$a.NGThreshold+'%）　感度 '+$a.Sensitivity+$(if($a.HueMatchMode){'・色味で判定'}else{''}))
    }
    $extra=@()
    if($a.Masks.Count -gt 0 -and $a.Mode -ne 'color') { $extra+=('除外 '+$a.Masks.Count+' か所') }
    if($a.ScheduleOn) { $extra+=('時間帯 '+(Get-ScheduleText $a)) }
    if([int]$a.NGDelaySec -gt 0) { $extra+=((Format-Duration $a.NGDelaySec)+' 続いたら鳴らす') }
    if($extra.Count -gt 0) { $lines+=($extra -join '　｜　') }
    return ($lines -join "`r`n")
}

function Read-BitmapFile($path) {
    # ファイルを開いたままにしないよう、メモリに読み込んでから複製する
    $bytes=[System.IO.File]::ReadAllBytes($path)
    $ms=New-Object System.IO.MemoryStream(,$bytes)
    try {
        $img=[System.Drawing.Image]::FromStream($ms)
        try { return (New-Object System.Drawing.Bitmap($img)) } finally { $img.Dispose() }
    } finally { $ms.Dispose() }
}

function Add-RefCard($bmp,$title,$sub,$path,$dim) {
    $card=New-Object System.Windows.Forms.Panel
    $card.Size=New-Object System.Drawing.Size((Px 292),(Px 266))
    $card.BackColor=$cardBgDark
    $card.Margin=New-Object System.Windows.Forms.Padding((Px 6))
    $pb=New-Object System.Windows.Forms.PictureBox
    $pb.Location=New-Object System.Drawing.Point((Px 6),(Px 6))
    $pb.Size=New-Object System.Drawing.Size((Px 280),(Px 196))
    $pb.SizeMode=[System.Windows.Forms.PictureBoxSizeMode]::Zoom
    $pb.BackColor=[System.Drawing.Color]::FromArgb(11,17,30)
    if($bmp) { $pb.Image=$bmp; [void]$script:rvBitmaps.Add($bmp) }
    if($path) {
        $pb.Tag=$path
        $pb.Cursor=[System.Windows.Forms.Cursors]::Hand
        $pb.Add_Click({ try { Start-Process -FilePath ([string]$this.Tag) -ErrorAction Stop } catch {} })
    }
    $t=New-Object System.Windows.Forms.Label
    $t.AutoSize=$false
    $t.Location=New-Object System.Drawing.Point((Px 6),(Px 206))
    $t.Size=New-Object System.Drawing.Size((Px 280),(Px 22))
    $t.Font=UIFont 9.5 -Bold
    $t.ForeColor=$(if($dim){$textSecondary}else{$textPrimary})
    $t.Text=$title
    $u=New-Object System.Windows.Forms.Label
    $u.AutoSize=$false
    $u.Location=New-Object System.Drawing.Point((Px 6),(Px 228))
    $u.Size=New-Object System.Drawing.Size((Px 280),(Px 34))
    $u.Font=UIFont 8
    $u.ForeColor=$textSecondary
    $u.Text=$sub
    Add-Controls $card @($pb,$t,$u)
    [void]$script:rvFlow.Controls.Add($card)
}

function Get-MarkedCopy($bmp,$inner) {
    # 色で判定：検出する色に一致する場所だけ色を残した複製
    $c=New-Object System.Drawing.Bitmap($bmp)
    if($inner) { [NgVision79]::MarkColor($c,$inner.X,$inner.Y,$inner.Width,$inner.Height,$script:rvArea.Color,[double]$script:rvArea.Sensitivity,[bool]$script:rvArea.HueMatchMode) }
    return $c
}

function Update-RefCards {
    $a=$script:rvArea
    $mark=($a.Mode -eq 'color' -and $script:rvMark.Checked)
    $script:rvFlow.SuspendLayout()
    try {
        foreach($c in @($script:rvFlow.Controls)) { $c.Dispose() }
        $script:rvFlow.Controls.Clear()
        foreach($b in $script:rvBitmaps) { try { $b.Dispose() } catch {} }
        $script:rvBitmaps.Clear()
        if($script:rvLive) {
            $img=$(if($mark){Get-MarkedCopy $script:rvLive[0] $script:rvLive[1]}else{New-Object System.Drawing.Bitmap($script:rvLive[0])})
            Add-RefCard $img '今の映像（参考）' ('赤い枠＝監視しているエリア'+$(if($mark){"`r`n色が残っている所＝検出する色に一致"}else{''})) $null $false
        }
        $items=@(Get-RefImages $a | Sort-Object @{Expression={ if($_.Kind -eq 'area'){0}else{1} }},Time)
        foreach($ri in $items) {
            try { $bmp=Read-BitmapFile $ri.Path } catch { continue }
            if($mark -and $ri.Inner -and ($ri.Kind -eq 'area' -or $ri.Kind -like 'color_*')) {
                $m=Get-MarkedCopy $bmp $ri.Inner; $bmp.Dispose(); $bmp=$m
            }
            $used=Test-RefKindUsed $a $ri.Kind
            $sub=$ri.Time.ToString('yyyy/MM/dd HH:mm:ss')+' に記録'
            if(-not $used) { $sub+="`r`n（今の判定のしかたでは使っていません）" } else { $sub+='　（クリックで大きく表示）' }
            Add-RefCard $bmp (Get-RefKindText $ri.Kind) $sub $ri.Path (-not $used)
        }
        if($items.Count -eq 0) {
            $l=New-Label "まだ登録した画像がありません。`r`nv83 より前に記録した見本には画像がありません。記録し直すと、ここに表示されます。" 9.5 -color $textSecondary
            $l.Margin=New-Object System.Windows.Forms.Padding((Px 10))
            [void]$script:rvFlow.Controls.Add($l)
        }
    } finally { $script:rvFlow.ResumeLayout() }
}

function Show-RefImages($a) {
    # 登録した時の画面・色・設定を一覧で見せる
    if(-not $a) { return }
    $script:rvArea=$a
    $script:rvBitmaps=New-Object System.Collections.ArrayList
    $script:rvLive=$null
    try { $script:rvLive=New-ContextShot $a } catch {}
    $d=New-Object System.Windows.Forms.Form
    $d.Text=($a.Name+' の登録内容')
    $d.AutoScaleMode=[System.Windows.Forms.AutoScaleMode]::None
    $d.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterParent
    $d.ClientSize=New-Object System.Drawing.Size((Px 940),(Px 720))
    $d.MinimumSize=New-Object System.Drawing.Size((Px 420),(Px 360))
    $d.BackColor=$formBgDark
    $d.ForeColor=$textPrimary
    $d.Font=UIFont 9
    $d.ShowInTaskbar=$false
    $d.MinimizeBox=$false
    $d.TopMost=$f.TopMost
    $flow=New-Object System.Windows.Forms.FlowLayoutPanel
    $flow.Dock=[System.Windows.Forms.DockStyle]::Fill
    $flow.AutoScroll=$true
    $flow.WrapContents=$true
    $flow.BackColor=$formBgDark
    $flow.Padding=New-Object System.Windows.Forms.Padding((Px 6))
    $script:rvFlow=$flow
    $top=New-Object System.Windows.Forms.Panel
    $top.Dock=[System.Windows.Forms.DockStyle]::Top
    $top.Height=Px 112
    $top.BackColor=$cardBgDark
    $top.Padding=New-Object System.Windows.Forms.Padding((Px 12),(Px 8),(Px 12),(Px 4))
    $info=New-Object System.Windows.Forms.Label
    $info.Dock=[System.Windows.Forms.DockStyle]::Fill
    $info.Font=UIFont 9.5
    $info.ForeColor=$textPrimary
    $info.Text=Get-AreaSummaryText $a
    $mark=New-Object System.Windows.Forms.CheckBox
    $mark.Text='検出する色に一致する場所だけ色を残して表示する（目安）'
    $mark.Dock=[System.Windows.Forms.DockStyle]::Bottom
    $mark.Height=Px 24
    $mark.ForeColor=$textPrimary
    $mark.Visible=($a.Mode -eq 'color')
    $mark.Add_CheckedChanged({ Update-RefCards })
    $script:rvMark=$mark
    $top.Controls.Add($info)
    $top.Controls.Add($mark)
    if($a.Mode -eq 'color') {
        $sw=New-Object System.Windows.Forms.Panel
        $sw.Dock=[System.Windows.Forms.DockStyle]::Right
        $sw.Width=Px 110
        $sw.BackColor=$a.Color
        $sw.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
        $swl=New-Object System.Windows.Forms.Label
        $swl.Dock=[System.Windows.Forms.DockStyle]::Bottom
        $swl.Height=Px 22
        $swl.TextAlign=[System.Drawing.ContentAlignment]::MiddleCenter
        $swl.Text='検出する色'
        $swl.BackColor=[System.Drawing.Color]::FromArgb(160,0,0,0)
        $swl.ForeColor=[System.Drawing.Color]::White
        $sw.Controls.Add($swl)
        $top.Controls.Add($sw)
    }
    $bottom=New-Object System.Windows.Forms.FlowLayoutPanel
    $bottom.Dock=[System.Windows.Forms.DockStyle]::Bottom
    $bottom.FlowDirection=[System.Windows.Forms.FlowDirection]::RightToLeft
    $bottom.Height=Px 50
    $bottom.BackColor=$headerBgDark
    $bottom.Padding=New-Object System.Windows.Forms.Padding((Px 6))
    $closeBtn=New-Button '閉じる' $colorGrayBtn $null 9 100 34
    $closeBtn.Add_Click({ $this.FindForm().Close() })
    $dirBtn=New-Button '画像のフォルダを開く' $colorGrayBtn $null 9 140 34
    $dirBtn.Add_Click({
        try {
            $dir=Get-RefImageFolder $script:rvArea
            if(-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
            Start-Process -FilePath $dir -ErrorAction Stop
        } catch {}
    })
    Add-Controls $bottom @($closeBtn,$dirBtn)
    $d.Controls.Add($flow)
    $d.Controls.Add($top)
    $d.Controls.Add($bottom)
    $d.CancelButton=$closeBtn
    try {
        Update-RefCards
        [void]$d.ShowDialog($f)
    } finally {
        foreach($b in $script:rvBitmaps) { try { $b.Dispose() } catch {} }
        $script:rvBitmaps.Clear()
        if($script:rvLive) { try { $script:rvLive[0].Dispose() } catch {} }
        $script:rvLive=$null
        $d.Dispose()
    }
}

$refImagesBtn.Add_Click({ Show-RefImages (Get-SelectedArea) })

function Update-ScheduleEnabled {
    $on=$schedCheck.Enabled -and $schedCheck.Checked
    $schedStart.Enabled=$on; $schedEnd.Enabled=$on
    foreach($c in $dayChecks) { $c.Enabled=$on }
}
function Save-ScheduleFromUI {
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.ScheduleOn=$schedCheck.Checked
    $a.ScheduleStart=$schedStart.Value.ToString('HH:mm')
    $a.ScheduleEnd=$schedEnd.Value.ToString('HH:mm')
    $d=0; for($i=0;$i -lt 7;$i++) { if($dayChecks[$i].Checked) { $d=$d -bor [int][Math]::Pow(2,$i) } }
    $a.ScheduleDays=$d
    Update-ScheduleEnabled
    Mark-SettingsDirty
    $tileBoard.Invalidate()
}
$schedCheck.Add_CheckedChanged({
    Save-ScheduleFromUI
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if($a -and $a.ScheduleOn) { SetStatusPanel $colorReady $textOnReady ($a.Name+'：'+(Get-ScheduleText $a)+' の間だけ監視します（それ以外の時間は鳴らしません）') }
})
$schedStart.Add_ValueChanged({ Save-ScheduleFromUI })
$schedEnd.Add_ValueChanged({ Save-ScheduleFromUI })
foreach($c in $dayChecks) { $c.Add_CheckedChanged({ Save-ScheduleFromUI }) }
$delayBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.NGDelaySec=[int]$delayBox.Value
    Mark-SettingsDirty
})
$repeatBox.Add_ValueChanged({
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    $a.RepeatMin=[int]$repeatBox.Value
    Mark-SettingsDirty
})

$ackBtn.Add_Click({
    # NGを見て「確認しました」：音を止め、表示を確認済みにする（元に戻ったら自動で解除）
    $now=Get-Date
    $nowText=$now.ToString('yyyy-MM-dd HH:mm:ss')
    foreach($a in $script:areas) {
        if($a.WasNG -and -not $a.Acked) {
            $a.Acked=$true
            $dur=$(if($a.NGSince){($now-$a.NGSince).TotalSeconds}else{$null})
            Write-NGLogRow $nowText $a.Name '確認' $a.LastRatio $dur
        }
    }
    BuzzStop
    $ackBtn.Visible=$false
    Update-RunButtons
    $tileBoard.Invalidate()
})

$recordOkBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    if($a.Mode -eq 'match') { [void](Record-MatchNG $a); return }
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
    if(-not $a) { return }
    if($a.Mode -eq 'match') { Import-MatchNGFromFile $a } else { [void](Record-DiffOK $a -Append) }
})
$recordNgBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    if($a.Mode -eq 'match') { Record-MatchOK $a }
    elseif($a.Mode -eq 'diff') { Record-DiffNG $a }
    else { Record-ColorSample 'NG' }
})
$clearRefsBtn.Add_Click({
    $a=Get-SelectedArea
    if(-not $a) { return }
    $what=$(if($a.Mode -eq 'match'){'記録した見本（異常の画面・正常な画面）'}else{'正常の見本'})
    $ans=Show-Message ($a.Name+' の'+$what+'をすべて消しますか？（消した後は記録し直すまで監視できません）') ([System.Windows.Forms.MessageBoxIcon]::Question) ([System.Windows.Forms.MessageBoxButtons]::YesNo)
    if($ans -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    Reset-AreaWithLog $a 'NG解除（見本の削除）'
    if($a.Mode -eq 'match') {
        Clear-MatchReference $a
        Remove-RefImages $a @('match_ng','match_ok','match_file')
    } else {
        Clear-DiffReference $a
        Remove-RefImages $a @('ok','ok_add','ng')
    }
    $a.TuneText=$null
    Update-SampleRatios $a
    LoadAreaSettingsIntoSliders
    UpdateAreaPreview
    $tileBoard.Invalidate()
    Mark-SettingsDirty
})
$rbModeDiff.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbModeDiff.Checked) { return }
    Set-AreaMode 'diff'
})
$rbModeMatch.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbModeMatch.Checked) { return }
    Set-AreaMode 'match'
})
$rbModeColor.Add_CheckedChanged({
    if($script:suppressEvents -or -not $rbModeColor.Checked) { return }
    Set-AreaMode 'color'
})
$advancedCheck.Add_CheckedChanged({ $advancedPanel.Visible=$advancedCheck.Checked })
$whenCheck.Add_CheckedChanged({ $whenPanel.Visible=$whenCheck.Checked })
$otherCheck.Add_CheckedChanged({ $otherPanel.Visible=$otherCheck.Checked })
$modeCombo.Add_SelectedIndexChanged({
    if($script:suppressEvents) { return }
    $mode=@('diff','match','color')[[Math]::Max(0,$modeCombo.SelectedIndex)]
    Set-AreaMode $mode
})

$sensTrack.Add_ValueChanged({
    $sensPercentLabel.Text=$sensTrack.Value.ToString()
    if($script:suppressEvents) { return }
    $a=Get-SelectedArea
    if(-not $a) { return }
    if($a.Mode -eq 'diff') { $a.DiffSensitivity=$sensTrack.Value } elseif($a.Mode -eq 'match') { $a.MatchSensitivity=$sensTrack.Value } else { $a.Sensitivity=$sensTrack.Value }
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
    $a=Get-SelectedArea
    if($a) { $ngPercentLabel.Text=Format-Percent (Slider-ToThreshold $a $ngTrack.Value) } else { $ngPercentLabel.Text=$ngTrack.Value.ToString()+'%' }
    if($script:suppressEvents) { return }
    if(-not $a) { return }
    if($a.Mode -eq 'diff') { $a.DiffThreshold=Slider-ToThreshold $a $ngTrack.Value } elseif($a.Mode -eq 'match') { $a.MatchThreshold=$ngTrack.Value } else { $a.NGThreshold=$ngTrack.Value }
    Mark-SettingsDirty
    Update-MeterLabel
    $meterBox.Invalidate()
    $tileBoard.Invalidate()
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
        [void](Show-Message (($notReady -join '、')+" は、まだ見本を記録していません。`r`n`r`n①のタイルでそのエリアを選び、②で見本を記録してください。`r`n（正常な映像と比べる：正常な時に「①」／ 異常の画面が出たらNG：異常の画面が出ている時に「①」か画像ファイルから）") ([System.Windows.Forms.MessageBoxIcon]::Warning))
        return
    }
    Save-SettingsIfDirty -Now
    foreach($a in $script:areas) { Reset-AreaRuntime $a; $a.LastRatio=$null }
    try { [NgWin79]::KeepAwake($true) } catch {}
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
        $outOfHours=New-Object System.Collections.ArrayList
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
                    if(-not $script:miniMode -and ($nowTime-$a.ThumbAt).TotalSeconds -ge 1) { Update-AreaThumb $a $bmp }
                    if(Test-AreaInSchedule $a $nowTime) {
                        $a.OutOfHours=$false
                        if(Update-AreaJudgement $a $ratio $nowTime $nowText) { [void]$newNGs.Add($a) }
                    } else {
                        # 時間帯の外：値は表示するが判定しない。NGのまま時間帯が終わったら解除する
                        if($a.WasNG) { Reset-AreaWithLog $a 'NG解除（時間帯の終わり）' }
                        $a.OutOfHours=$true
                        $a.LastRatio=$ratio
                        $a.NGStreak=0; $a.OKStreak=0; $a.RawNGSince=$null
                        [void]$outOfHours.Add($a.Name)
                    }
                } catch {
                    # 画面ロック中・リモートデスクトップ切断中などは画面を読み取れない。黙って止まらず知らせる。
                    $a.CaptureFailed=$true
                    [void]$failed.Add($a.Name)
                    Write-ErrorLogThrottled ('画面の読み取りに失敗（'+$a.Name+'）: '+$_.Exception.Message)
                }
            }
            if($a.WasNG) { [void]$ngAreas.Add($a) }
        }
        $tileBoard.Invalidate()
        if(-not $script:miniMode) { Update-MeterLabel; $meterBox.Invalidate() }

        foreach($a in $newNGs) { Save-NGImage $a $nowTime }
        if($newNGs.Count -gt 0) {
            # 新しくNGになったエリアがあれば、そのエリアの音で鳴らす
            $newNG=$newNGs[0]
            [void](BuzzStart $newNG.BuzzerSeconds $newNG.BuzzerType $newNG.BuzzerVolume)
            foreach($a in $newNGs) { $a.LastBuzzAt=$nowTime }
            Update-RunButtons
            if($script:notifyIcon -and $f.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
                try {
                    $script:notifyIcon.BalloonTipTitle='NGモニター：検知'
                    $script:notifyIcon.BalloonTipText=($newNG.Name+' でNGを検知しました。')
                    $script:notifyIcon.ShowBalloonTip(4000)
                } catch {}
            }
        }
        if($newNGs.Count -eq 0) {
            # 鳴らし直し：NGが続いていて、まだ「確認しました」が押されていないエリア
            foreach($a in $ngAreas) {
                if($a.Acked -or [int]$a.RepeatMin -le 0) { continue }
                if($a.LastBuzzAt -and ($nowTime-$a.LastBuzzAt).TotalMinutes -lt [double]$a.RepeatMin) { continue }
                if(-not $a.LastBuzzAt) { $a.LastBuzzAt=$nowTime; continue }
                [void](BuzzStart $a.BuzzerSeconds $a.BuzzerType $a.BuzzerVolume)
                $a.LastBuzzAt=$nowTime
                Update-RunButtons
                break
            }
        }
        $showAck=$false
        if($ngAreas.Count -gt 0) {
            $names=(($ngAreas | ForEach-Object { $_.Name }) -join '、')
            $unacked=@($ngAreas | Where-Object { -not $_.Acked })
            $first=$(if($unacked.Count -gt 0){$unacked[0]}else{$ngAreas[0]})
            $line2=((Get-NGReasonText $first)+'　'+(Get-NGSinceText $first $nowTime)).Trim()
            if($unacked.Count -gt 0) {
                SetStatusPanel $colorAlarm ([System.Drawing.Color]::White) ('⚠ NG　'+$names+"`r`n"+$line2)
                $showAck=$true
            } else {
                SetStatusPanel $colorAcked $textOnAcked ('確認済み：'+$names+'（元に戻ると自動で解除）'+"`r`n"+$line2)
            }
        } elseif($occluded.Count -gt 0) {
            SetStatusPanel $colorWarn $textOnWarn ('⚠ この画面が「'+($occluded -join '、')+'」に重なっていて監視できません。画面を動かしてください。')
        } elseif($failed.Count -gt 0) {
            SetStatusPanel $colorWarn $textOnWarn ('⚠ 画面を読み取れません（'+($failed -join '、')+'）。画面ロック・スリープ・リモート切断を確認してください。')
        } elseif($offScreen.Count -gt 0) {
            SetStatusPanel $colorWarn $textOnWarn ('⚠ 「'+($offScreen -join '、')+'」が画面の外にあり監視できません。モニターの接続・配置を確認し、「範囲を選び直す」をしてください。')
        } elseif($notReady.Count -gt 0) {
            SetStatusPanel $colorWarn $textOnWarn ('⚠ 「'+($notReady -join '、')+'」は見本が無いため監視できていません。②で見本を記録してください。')
        } elseif($script:logWriteBlocked) {
            SetStatusPanel $colorWarn $textOnWarn '監視中（すべて正常）｜ ⚠ ログのCSVが開かれていて書き込めません。Excelを閉じると自動で書き込みます。'
        } else {
            $msg='✔ すべて正常　｜　'+$script:areas.Count.ToString()+'箇所を監視中'
            if($outOfHours.Count -gt 0) { $msg+='（時間帯の外：'+($outOfHours -join '、')+'）' }
            SetStatusPanel $colorRunning $textOnRunning $msg
        }
        if($ackBtn.Visible -ne $showAck) { $ackBtn.Visible=$showAck }
        Update-TodaySummary
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
        if(-not $script:running) { Update-IdleThumbs; Update-TodaySummary; $tileBoard.Invalidate() }
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
    try { [NgWin79]::KeepAwake($false) } catch {}
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
Read-TodayStatsFromLog
Update-TodaySummary
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
