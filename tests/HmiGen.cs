using System;
// Test-only synthetic equipment screen (HMI): gauges and numbers that keep changing,
// an alarm popup that appears only when abnormal, and an unrelated info popup.
public static class HmiGen {
    public const int W = 200, H = 140;
    static void Rect(byte[] o, int cw, int ch, int x0, int y0, int w, int h, int r, int g, int b) {
        for (int y = Math.Max(0, y0); y < Math.Min(ch, y0 + h); y++)
            for (int x = Math.Max(0, x0); x < Math.Min(cw, x0 + w); x++) { int i = (y * cw + x) * 4; o[i] = (byte)b; o[i + 1] = (byte)g; o[i + 2] = (byte)r; o[i + 3] = 255; }
    }
    // value: changing process values; popup: 0 none, 1 alarm (red title), 2 alarm with a different message,
    // 3 info popup (blue title, same size); dx,dy: whole screen shifted; margin: capture margin
    public static byte[] Frame(int seed, int value, int popup, int dx, int dy, int margin, int noise) {
        var r = new Random(seed);
        int cw = W + 2 * margin, ch = H + 2 * margin;
        byte[] o = new byte[cw * ch * 4];
        int ox = margin + dx, oy = margin + dy;
        Rect(o, cw, ch, 0, 0, cw, ch, 40, 44, 52);                                   // background
        Rect(o, cw, ch, ox + 0, oy + 0, W, 16, 30, 60, 110);                          // header bar
        for (int k = 0; k < 4; k++) {                                                // 4 gauges with changing values
            int gx = ox + 10 + k * 47, gy = oy + 30;
            Rect(o, cw, ch, gx, gy, 40, 60, 60, 66, 76);
            int level = 10 + ((value * (k + 3) * 7) % 45);
            Rect(o, cw, ch, gx + 8, gy + 58 - level, 24, level, 70, 200, 90);
            for (int d = 0; d < 3; d++) {                                            // changing digits
                int dig = (value * (k + 1) + d * 3) % 10;
                for (int seg = 0; seg < 7; seg++) if (((dig + seg) % 3) != 0) Rect(o, cw, ch, gx + 4 + d * 12, gy + 66 + seg, 9, 1, 220, 220, 220);
            }
        }
        Rect(o, cw, ch, ox + 10, oy + 115, 180, 14, 50, 56, 66);                      // status line
        for (int x = 0; x < 30; x++) if (((x + value) % 4) != 0) Rect(o, cw, ch, ox + 14 + x * 5, oy + 119, 3, 6, 200, 200, 200);
        if (popup > 0) {                                                             // popup in the middle
            int px = ox + 45, py = oy + 35;
            Rect(o, cw, ch, px, py, 110, 60, 235, 235, 235);
            if (popup == 3) Rect(o, cw, ch, px, py, 110, 14, 40, 90, 200); else Rect(o, cw, ch, px, py, 110, 14, 210, 30, 30);
            int msg = popup == 2 ? 7 : 3;
            for (int x = 0; x < 14; x++) if (((x * msg) % 5) != 0) Rect(o, cw, ch, px + 8 + x * 7, py + 26, 5, 8, 30, 30, 30);
            Rect(o, cw, ch, px + 38, py + 44, 34, 11, 180, 180, 180);                // OK button
        }
        if (noise > 0) for (int i = 0; i < o.Length; i += 4) for (int c = 0; c < 3; c++) {
            int v = o[i + c] + r.Next(-noise, noise + 1); o[i + c] = (byte)(v < 0 ? 0 : (v > 255 ? 255 : v)); }
        return o;
    }
}
