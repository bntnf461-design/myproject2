using System;
// Test-only synthetic camera scenes (BGRA buffers).
public static class SceneGen {
    public const int W = 160, H = 120;
    static byte[] baseTex;
    static int partLevel, holeLevel;
    // Textured "machine" background: random rectangles (parts, edges, labels).
    public static void Init(int seed, int baseLevel, int contrast) {
        var r = new Random(seed);
        int MW = W + 20, MH = H + 20;              // margin so we can shift
        baseTex = new byte[MW * MH * 3];
        for (int i = 0; i < MW * MH; i++) { baseTex[i*3] = (byte)baseLevel; baseTex[i*3+1] = (byte)baseLevel; baseTex[i*3+2] = (byte)(baseLevel+2); }
        for (int k = 0; k < 60; k++) {
            int x0 = r.Next(MW), y0 = r.Next(MH), w = 4 + r.Next(30), h = 4 + r.Next(20);
            int c0 = Clamp(baseLevel + r.Next(-contrast, contrast + 1));
            int c1 = Clamp(c0 + r.Next(-contrast/3, contrast/3 + 1)), c2 = Clamp(c0 + r.Next(-contrast/3, contrast/3 + 1));
            for (int y = y0; y < Math.Min(MH, y0 + h); y++)
                for (int x = x0; x < Math.Min(MW, x0 + w); x++) { int i = (y*MW + x)*3; baseTex[i] = (byte)c0; baseTex[i+1] = (byte)c1; baseTex[i+2] = (byte)c2; }
        }
        // a real small part (8x8) at scene (100,40); "part missing" shows the darker mount under it
        partLevel = Clamp(baseLevel + contrast); holeLevel = Clamp(baseLevel - contrast / 2);
        for (int y = 50; y < 58; y++) for (int x = 110; x < 118; x++) { int i = (y*MW + x)*3; baseTex[i] = baseTex[i+1] = baseTex[i+2] = (byte)partLevel; }
    }
    static int Clamp(int v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

    // dx,dy: picture shift in pixels; gain: exposure; noise: +-noise per channel.
    // defect: 0 none, 1 small part missing (8x8 at 100,40), 2 lamp lit (14x14 at 30,70), 3 hand/object (large, 40x40)
    // clock: draws a changing "timestamp" box at the top-left (value changes the pattern)
    public static byte[] Frame(int seed, int dx, int dy, double gain, int noise, int defect, int clock, int captureMargin) {
        return Frame(seed, dx, dy, gain, noise, defect, clock, captureMargin, -1);
    }
    // arm: position step of a moving arm (-1 = none)
    public static byte[] Frame(int seed, int dx, int dy, double gain, int noise, int defect, int clock, int captureMargin, int arm) {
        var r = new Random(seed);
        int MW = W + 20;
        int cw = W + 2*captureMargin, ch = H + 2*captureMargin;
        byte[] o = new byte[cw * ch * 4];
        for (int y = 0; y < ch; y++) for (int x = 0; x < cw; x++) {
            int sx = x - captureMargin + 10 + dx, sy = y - captureMargin + 10 + dy;   // scene coords (shifted)
            sx = Math.Max(0, Math.Min(MW - 1, sx)); sy = Math.Max(0, Math.Min(H + 19, sy));
            int ti = (sy*MW + sx)*3;
            double R = baseTex[ti+2], G = baseTex[ti+1], B = baseTex[ti];
            int px = sx - 10, py = sy - 10;   // object coordinates move with the scene
            if (defect == 1 && px >= 100 && px < 108 && py >= 40 && py < 48) { R = holeLevel; G = holeLevel; B = holeLevel + 1; }  // part missing
            if (defect == 2 && px >= 30 && px < 44 && py >= 70 && py < 84) { R = 235; G = 60; B = 40; }          // lamp lit
            if (defect == 3 && px >= 60 && px < 100 && py >= 30 && py < 70) { R = 180; G = 140; B = 120; }      // object
            if (defect == 4 && px >= 50 && px < 62 && py >= 95 && py < 110) { R = 235; G = 60; B = 40; }         // a lamp near the moving arm
            if (arm >= 0) {                                                                                        // a moving arm (normal operation) in x 4..44, y 60..112
                int ay = 60 + (arm * 7) % 40;
                if (px >= 4 && px < 44 && py >= ay && py < ay + 12) { R = 200; G = 200; B = 70; }
            }
            int qx = x - captureMargin, qy = y - captureMargin;               // clock is on the viewer, does not move
            if (clock >= 0 && qx >= 4 && qx < 40 && qy >= 4 && qy < 12) {
                int digit = ((qx - 4) / 6 + clock) % 3;
                bool on = ((qx + qy + digit) % 3) == 0;
                R = G = B = on ? 230 : 20;
            }
            int oi = (y*cw + x)*4;
            o[oi+2] = (byte)Clamp((int)(R*gain) + r.Next(-noise, noise+1));
            o[oi+1] = (byte)Clamp((int)(G*gain) + r.Next(-noise, noise+1));
            o[oi]   = (byte)Clamp((int)(B*gain) + r.Next(-noise, noise+1));
            o[oi+3] = 255;
        }
        return o;
    }
}
