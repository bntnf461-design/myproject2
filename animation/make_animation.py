"""NG MONITOR のしくみを説明するアニメーション動画を作る。

matplotlib.animation (FuncAnimation) で描き、ffmpeg で MP4 に保存する。
使い方:  python make_animation.py   ->  ng_monitor_animation.mp4
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import animation, font_manager
from matplotlib.patches import FancyBboxPatch, Rectangle, Ellipse

# 日本語フォント
for name in ("IPAGothic", "IPAexGothic", "Noto Sans CJK JP", "Yu Gothic", "Meiryo"):
    if any(f.name == name for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = name
        break

FPS = 30
T_TITLE, T_NG, T_ACK, T_END = 2.5, 7.0, 10.5, 13.0
N = int(T_END * FPS)
THRESH = 0.35

BG, CARD, INK, SUB = "#0f172a", "#1e293b", "#e2e8f0", "#94a3b8"
GREEN, RED, BLUE, ORANGE = "#22c55e", "#ef4444", "#3b82f6", "#f59e0b"

rng = np.random.default_rng(1)
noise = rng.normal(0, 0.025, N)


def circle(ax, xy, r, **kw):
    """軸の縦横比に合わせて、画面上で真円になる丸を作る。"""
    pos = ax.get_position()
    (x0, x1), (y0, y1) = ax.get_xlim(), ax.get_ylim()
    fw, fh = ax.figure.get_size_inches()
    sx = pos.width * fw / (x1 - x0)
    sy = pos.height * fh / (y1 - y0)
    return Ellipse(xy, 2 * r, 2 * r * sx / sy, **kw)


def score_at(t):
    """見本との違い (0..1)。NG の間だけ大きくなる。"""
    base = 0.08 + 0.03 * np.sin(t * 2.3)
    if T_NG <= t < T_ACK:
        base += 0.55 * min(1.0, (t - T_NG) * 4)
    return max(0.0, base)


scores = np.array([score_at(i / FPS) for i in range(N)]) + noise

fig = plt.figure(figsize=(12.8, 7.2), dpi=100, facecolor=BG)

# ---------- タイトル用レイヤ ----------
ax_title = fig.add_axes([0, 0, 1, 1]); ax_title.axis("off")
ax_title.set_xlim(0, 1); ax_title.set_ylim(0, 1)
title = ax_title.text(0.5, 0.56, "NG MONITOR のしくみ", ha="center", va="center",
                      fontsize=44, color=INK, weight="bold")
subtitle = ax_title.text(0.5, 0.44, "画面を見張って、いつもと違ったら知らせる", ha="center",
                         va="center", fontsize=20, color=SUB)

# ---------- 監視対象の画面 (左) ----------
ax_scr = fig.add_axes([0.04, 0.10, 0.52, 0.72]); ax_scr.axis("off")
ax_scr.set_xlim(0, 16); ax_scr.set_ylim(0, 10)
ax_scr.add_patch(FancyBboxPatch((0.2, 0.2), 15.6, 9.4, boxstyle="round,pad=0.1,rounding_size=0.4",
                                fc="#334155", ec="#475569", lw=2))
ax_scr.text(0.8, 8.9, "製造ライン 操作画面", color=INK, fontsize=14, va="center")
lamps = []
for i, lbl in enumerate(["運転", "温度", "圧力", "搬送"]):
    x = 2.2 + i * 3.8
    c = circle(ax_scr, (x, 6.4), 0.9, fc=GREEN, ec="white", lw=1.5); ax_scr.add_patch(c); lamps.append(c)
    ax_scr.text(x, 4.9, lbl, color=INK, ha="center", fontsize=13)
err_text = ax_scr.text(8, 2.5, "", color="white", ha="center", va="center", fontsize=22, weight="bold",
                       bbox=dict(boxstyle="round,pad=0.4", fc=RED, ec="none", alpha=0.0))
# 見張るエリア(点線)
area = Rectangle((0.9, 4.3), 14.2, 3.4, fill=False, ec=BLUE, lw=3, ls="--")
ax_scr.add_patch(area)
area_lbl = ax_scr.text(1.0, 7.95, "エリア1", color=BLUE, fontsize=13, weight="bold")
scan = ax_scr.axvline(1, ymin=0.43, ymax=0.77, color=BLUE, lw=2, alpha=0.7)

# ---------- 見本 (右上) ----------
ax_ref = fig.add_axes([0.60, 0.56, 0.36, 0.26]); ax_ref.axis("off")
ax_ref.set_xlim(0, 16); ax_ref.set_ylim(0, 4)
ax_ref.add_patch(FancyBboxPatch((0.1, 0.1), 15.8, 3.8, boxstyle="round,pad=0.05,rounding_size=0.3",
                                fc=CARD, ec="#475569"))
ax_ref.text(0.6, 3.35, "見本（正常な時のエリア1）", color=SUB, fontsize=12)
for i in range(4):
    ax_ref.add_patch(circle(ax_ref, (2.2 + i * 3.8, 1.6), 0.55, fc=GREEN, ec="white"))
cmp_lbl = ax_ref.text(15.4, 3.35, "", color=INK, fontsize=12, ha="right")

# ---------- 違いのグラフ (右下) ----------
ax_g = fig.add_axes([0.62, 0.12, 0.34, 0.36], facecolor=CARD)
for s in ax_g.spines.values():
    s.set_color("#475569")
ax_g.tick_params(colors=SUB, labelsize=10)
ax_g.set_xlim(0, T_END - T_TITLE); ax_g.set_ylim(0, 1)
ax_g.set_title("見本との違い", color=INK, fontsize=13, loc="left")
ax_g.set_xlabel("時間 (秒)", color=SUB, fontsize=10)
ax_g.axhline(THRESH, color=ORANGE, ls="--", lw=1.5)
ax_g.text(0.1, THRESH + 0.03, "しきい値", color=ORANGE, fontsize=10)
line, = ax_g.plot([], [], color=GREEN, lw=2.2)

# ---------- 状態バー (上) ----------
ax_bar = fig.add_axes([0, 0.86, 1, 0.14]); ax_bar.axis("off")
ax_bar.set_xlim(0, 1); ax_bar.set_ylim(0, 1)
bar_bg = Rectangle((0, 0), 1, 1, fc=CARD, ec="none"); ax_bar.add_patch(bar_bg)
ax_bar.text(0.04, 0.5, "NG MONITOR v86", color=INK, fontsize=18, weight="bold", va="center")
status = ax_bar.text(0.34, 0.5, "", fontsize=18, weight="bold", va="center")
info = ax_bar.text(0.96, 0.5, "", color=INK, fontsize=15, va="center", ha="right")

# NG 時の赤い枠
flash = Rectangle((0.005, 0.005), 0.99, 0.99, transform=fig.transFigure, fill=False,
                  ec=RED, lw=14, alpha=0.0)
fig.patches.append(flash)

main_artists = [ax_scr, ax_ref, ax_g, ax_bar]


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def update(i):
    t = i / FPS
    # タイトル → 本編 へフェード
    a_title = 1 - ease((t - (T_TITLE - 0.6)) / 0.6)
    title.set_alpha(a_title); subtitle.set_alpha(a_title)
    ax_title.set_visible(a_title > 0.01)
    a_main = ease((t - (T_TITLE - 0.3)) / 0.6)
    for ax in main_artists:
        ax.set_visible(a_main > 0.01)
        ax.patch.set_alpha(a_main)
        for art in ax.get_children():
            if hasattr(art, "set_alpha") and art is not ax.patch and art is not flash:
                try:
                    art.set_alpha(a_main if art is not err_text else art.get_alpha())
                except Exception:
                    pass

    is_ng = T_NG + 0.3 <= t < T_ACK
    # ランプ: NG で「温度」が赤に
    lamps[1].set_facecolor(RED if t >= T_NG and t < T_ACK else GREEN)
    if t >= T_NG and t < T_ACK:
        err_text.set_text("温度異常 E-102")
        err_text.get_bbox_patch().set_alpha(1.0); err_text.set_alpha(1.0)
    else:
        err_text.set_text(""); err_text.get_bbox_patch().set_alpha(0.0)

    # スキャン線が左右に動く
    sx = 1 + (14 * ((t * 0.6) % 1.0))
    scan.set_xdata([sx, sx])
    scan.set_color(RED if is_ng else BLUE)
    area.set_edgecolor(RED if is_ng else BLUE)
    area_lbl.set_color(RED if is_ng else BLUE)

    # グラフ
    k = max(0, i - int(T_TITLE * FPS))
    xs = np.arange(k) / FPS
    ys = scores[int(T_TITLE * FPS):int(T_TITLE * FPS) + k]
    line.set_data(xs, ys)
    line.set_color(RED if is_ng else GREEN)

    sc = scores[i]
    cmp_lbl.set_text(f"違い {sc:.2f}")
    cmp_lbl.set_color(RED if sc > THRESH else GREEN)

    # 状態バー
    if is_ng:
        blink = (int(t * 4) % 2) == 0
        status.set_text("● NG"); status.set_color(RED)
        bar_bg.set_facecolor("#7f1d1d" if blink else CARD)
        flash.set_alpha(0.9 if blink else 0.25)
        info.set_text("♪ ブザー鳴動中　　F8：確認しました")
    elif t >= T_ACK:
        status.set_text("● 監視中"); status.set_color(GREEN)
        bar_bg.set_facecolor(CARD); flash.set_alpha(0.0)
        info.set_text("〇 確認しました（NG を記録）" if t < T_ACK + 1.8 else "正常にもどりました")
    else:
        status.set_text("● 監視中"); status.set_color(GREEN)
        bar_bg.set_facecolor(CARD); flash.set_alpha(0.0)
        info.set_text("見本と比べています…" if t < T_NG else "違いを検出…")
    return []


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ng_monitor_animation.mp4")
    anim = animation.FuncAnimation(fig, update, frames=N, interval=1000 / FPS)
    anim.save(out, writer=animation.FFMpegWriter(fps=FPS, bitrate=2500,
                                                 extra_args=["-pix_fmt", "yuv420p"]))
    print("saved:", out)
