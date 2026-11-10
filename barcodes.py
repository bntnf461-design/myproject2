"""ラベル印刷用のバーコード(Code128)/QRコードを SVG 文字列で生成する。

外部の画像ライブラリに依存せず、ブラウザでそのまま印刷できる SVG を返す。

Copyright © 2026. All rights reserved.
"""
import io

import segno

# Code128 のバー/スペース幅パターン (値 0〜106)。106 は STOP。
CODE128_PATTERNS = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
    "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
    "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
    "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
    "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
    "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
    "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
    "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
    "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
    "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
    "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
    "211214", "211232", "2331112",
]
START_B = 104
STOP = 106


def code128_values(text):
    """Code128-B でエンコードしたシンボル値の列 (START, データ, チェック, STOP) を返す。"""
    values = [START_B]
    for ch in text:
        o = ord(ch)
        if not 32 <= o <= 126:
            raise ValueError(f"Code128-B で表せない文字です: {ch!r}")
        values.append(o - 32)
    checksum = values[0] + sum(i * v for i, v in enumerate(values[1:], start=1))
    values.append(checksum % 103)
    values.append(STOP)
    return values


def code128_modules(text):
    """バーなら True、スペースなら False のモジュール列を返す (クワイエットゾーン無し)。"""
    modules = []
    for v in code128_values(text):
        bar = True
        for w in CODE128_PATTERNS[v]:
            modules.extend([bar] * int(w))
            bar = not bar
    return modules


def code128_svg(text, module_width=2, height=50, quiet=10):
    modules = code128_modules(text)
    width = (len(modules) + quiet * 2) * module_width
    rects = []
    x = quiet
    i = 0
    while i < len(modules):
        if modules[i]:
            start = i
            while i < len(modules) and modules[i]:
                i += 1
            rects.append(
                f'<rect x="{(x + start) * module_width}" y="0" '
                f'width="{(i - start) * module_width}" height="{height}"/>'
            )
        else:
            i += 1
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" class="barcode" viewBox="0 0 {width} {height}" '
        f'preserveAspectRatio="none" role="img" aria-label="{text}">'
        f'<rect width="{width}" height="{height}" fill="#fff"/>'
        f'<g fill="#000">{"".join(rects)}</g></svg>'
    )


def qr_svg(text, scale=4):
    buf = io.BytesIO()
    segno.make(text, error="m", micro=False).save(
        buf, kind="svg", scale=scale, border=2, xmldecl=False, svgns=True,
        svgclass="qrcode", lineclass=None, omitsize=True,
    )
    return buf.getvalue().decode("utf-8")
