"""品目の Excel（品目登録シート）の作成と読み込み。

Copyright © 2026. All rights reserved.

- build(): 「品目」「記入例」「説明」の3枚のシートを持つ Excel を作る（空のひな形・今の品目の出力）
- read_rows(): 取り込んだ Excel の「品目」シート（無ければ最初のシート）を、見出し→値の辞書の列にする
  読み込みは Python の標準の部品だけで行う（追加の部品なし）
"""
import io
import re
import zipfile
import xml.etree.ElementTree as ET

SHEET = "品目"
ROWS_BLANK = 300          # ひな形で入力の決まりを付けておく行数
MAX_ROWS = 5000           # 読み込む最大の行数
MAX_XML = 30 * 1024 * 1024  # 展開後の大きさの上限 (壊れたファイル・極端に大きいファイルを読まない)

# 列ごとの説明 (説明シートと、見出しのメモに使う)
HELP = {
    "コード": "空欄なら自動で付きます（例: SZ0001。「設定」で拠点コードを決めていれば A0001 のようにその文字で始まります）。同じコードの品目があれば、その品目を上書きします。半角英数字とハイフン。",
    "品名": "必須。ラベル・画面・お知らせに出る名前。",
    "読み方": "音声が読み間違える時だけ、ひらがなで（例: ようじょうテープ）。",
    "品名（インドネシア語）": "インドネシア語の画面で出す品名（なくても可）。",
    "規格": "サイズ・色・入数など（例: Lサイズ 100枚）。",
    "分類": "手袋・テープ・清掃 など、まとめ方は自由。",
    "棚番": "棚の場所（例: A-1-2）。棚番を使わない時は空欄。",
    "単位": "個・箱・袋・本・巻 など。空欄なら「個」。",
    "在庫数": "今の在庫（実際に数えた数）。0以上の整数。",
    "発注点": "この数以下になったら「補充してください」と知らせる。",
    "発注数": "1回に注文する数（発注の目安と、届いた時の確認に使う）。",
    "1回にとる数": "ラベルを1回読んだ時に記録する数。空欄なら1。",
    "1回にいれる数": "補充でラベルを1回読んだ時に記録する数。空欄なら1。",
    "仕入先": "注文する会社（補充リストに出ます）。",
    "備考": "メモ（自由）。",
}
INT_COLS = {"在庫数", "発注点", "発注数", "1回にとる数", "1回にいれる数"}
PER_SCAN_COLS = {"1回にとる数", "1回にいれる数"}
UNITS = ["個", "箱", "袋", "本", "巻", "枚", "双", "組", "缶", "kg", "L", "m"]

EXAMPLES = [
    ["", "ニトリル手袋", "", "", "Mサイズ 100枚", "手袋", "A-1-1", "箱", 12, 5, 10, 1, 1, "○○商事", ""],
    ["", "養生テープ", "ようじょうテープ", "Selotip masking", "緑 50mm×25m", "テープ", "A-2-1", "巻", 30, 10, 30, 1, 1, "△△資材", ""],
    ["", "軍手", "", "Sarung tangan kerja", "フリー 12双", "手袋", "A-1-3", "袋", 9, 3, 10, 1, 1, "○○商事", "1袋=12双"],
]


def build(labels, rows=(), use_location=True, title="品目登録シート"):
    """品目登録シート (xlsx) を作って bytes で返す。labels: 列の見出し, rows: 今の品目 (空ならひな形)。"""
    import xlsxwriter

    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True, "strings_to_formulas": False, "strings_to_urls": False})
    wb.set_properties({"title": title, "comments": "備品・副資材管理アプリ"})
    head = wb.add_format({"bold": True, "bg_color": "#C2410C", "font_color": "#FFFFFF", "border": 1,
                          "align": "center", "valign": "vcenter", "text_wrap": True})
    need = wb.add_format({"bold": True, "bg_color": "#7C2D12", "font_color": "#FFFFFF", "border": 1,
                          "align": "center", "valign": "vcenter", "text_wrap": True})
    text = wb.add_format({"num_format": "@", "border": 1, "border_color": "#E7DED3"})
    num = wb.add_format({"num_format": "0", "border": 1, "border_color": "#E7DED3"})
    note = wb.add_format({"text_wrap": True, "valign": "top"})
    big = wb.add_format({"bold": True, "font_size": 14})
    bold = wb.add_format({"bold": True, "text_wrap": True, "valign": "top"})
    widths = {"コード": 10, "品名": 22, "読み方": 16, "品名（インドネシア語）": 20, "規格": 18, "分類": 10, "棚番": 9,
              "単位": 7, "仕入先": 14, "備考": 18}

    def sheet(name, data, protect_examples=False):
        ws = wb.add_worksheet(name)
        ws.freeze_panes(1, 2)
        ws.set_row(0, 34)
        for c, label in enumerate(labels):
            ws.write_string(0, c, label, need if label == "品名" else head)
            ws.set_column(c, c, widths.get(label, 9), text if label not in INT_COLS else num)
            if label in HELP:
                ws.write_comment(0, c, HELP[label], {"x_scale": 2, "y_scale": 1.2})
        for r, values in enumerate(data, start=1):
            for c, (label, v) in enumerate(zip(labels, values)):
                if v is None or v == "":
                    continue
                if label in INT_COLS and isinstance(v, int):
                    ws.write_number(r, c, v, num)
                else:
                    ws.write_string(r, c, str(v), text)
        last = max(ROWS_BLANK, len(data) + 50)
        for c, label in enumerate(labels):
            if label in PER_SCAN_COLS:
                ws.data_validation(1, c, last, c, {"validate": "integer", "criteria": "between", "minimum": 1, "maximum": 9999,
                                                   "ignore_blank": True, "error_title": label,
                                                   "error_message": "1〜9999 の整数を入れてください"})
            elif label in INT_COLS:
                ws.data_validation(1, c, last, c, {"validate": "integer", "criteria": ">=", "value": 0, "ignore_blank": True,
                                                   "error_title": label, "error_message": "0以上の整数を入れてください"})
            elif label == "単位":
                ws.data_validation(1, c, last, c, {"validate": "list", "source": UNITS, "ignore_blank": True,
                                                   "error_type": "information", "error_title": "単位",
                                                   "error_message": "一覧にない単位でも使えます（OKで続けます）"})
        ws.autofilter(0, 0, max(len(data), 1), len(labels) - 1)
        ws.set_landscape(); ws.set_paper(9); ws.fit_to_pages(1, 0); ws.repeat_rows(0)  # 印刷: A4横・横1枚に収める
        if protect_examples:
            ws.set_tab_color("#9CA3AF")
        return ws

    sheet(SHEET, list(rows))
    ex = sheet("記入例", EXAMPLES, protect_examples=True)
    ex.write_string(len(EXAMPLES) + 2, 1, "← このシートは記入例です。取り込まれるのは「品目」シートだけです。")

    ws = wb.add_worksheet("説明")
    ws.set_column(0, 0, 24)
    ws.set_column(1, 1, 80)
    ws.set_landscape(); ws.set_paper(9); ws.fit_to_pages(1, 0)
    ws.write_string(0, 0, "品目登録シートの使い方", big)
    steps = [
        "1. 「品目」シートに、1行に1品目ずつ入れます（見出しの行は変えないでください）。",
        "2. 品名は必須です。ほかは空欄でもかまいません（コードは自動、単位は「個」、1回の数は1）。",
        "3. 保存したら、アプリの「品目」画面 →「ファイルを選択」でこのファイルを選び →「取り込む」を押します。",
        "   Excel のまま取り込めます（CSV に保存し直す必要はありません）。",
        "4. 同じコードの品目は上書きされます。今の品目を直す時は、「品目」画面の「Excel出力」で出したファイルを直して取り込みます。",
        "5. 取り込めなかった行は、画面に「○行目: …」と理由が出ます。直してもう一度取り込んでください（取り込めた行は二重になりません）。",
    ]
    for i, s in enumerate(steps, start=2):
        ws.write_string(i, 0, s)
    ws.set_row(1, 6)
    r = len(steps) + 3
    ws.write_string(r, 0, "列", bold)
    ws.write_string(r, 1, "入れるもの", bold)
    for i, label in enumerate(labels, start=r + 1):
        ws.write_string(i, 0, label + ("（必須）" if label == "品名" else ""), bold)
        ws.write_string(i, 1, HELP.get(label, ""), note)
    wb.close()
    return buf.getvalue()


# ---------------------------------------------------------------- 読み込み

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}


class SheetError(ValueError):
    """読めない Excel ファイル (理由は画面に出す)。"""


STRICT = {"http://purl.oclc.org/ooxml/spreadsheetml/main": NS["m"],
          "http://purl.oclc.org/ooxml/officeDocument/relationships": NS["r"]}


def _xml(z, name):
    try:
        info = z.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_XML:
        raise SheetError("ファイルが大きすぎます")
    root = ET.fromstring(z.read(name))
    # 「Strict Open XML」形式で保存された Excel も、ふつうの形式と同じように読む
    for el in root.iter():
        if el.tag.startswith("{"):
            uri, local = el.tag[1:].split("}", 1)
            if uri in STRICT:
                el.tag = f"{{{STRICT[uri]}}}{local}"
        for k in list(el.attrib):
            if k.startswith("{") and k[1:].split("}", 1)[0] in STRICT:
                uri, local = k[1:].split("}", 1)
                el.attrib[f"{{{STRICT[uri]}}}{local}"] = el.attrib.pop(k)
    return root


def _col(ref):
    """'C12' → 2 (A=0)"""
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def _text(el):
    """文字のセルの中身。日本語の Excel が一緒に保存する読み（ふりがな <rPh>）は入れない
    (入れると「軍手」が「軍手グンテ」になる)。"""
    out = []
    for child in el:
        if child.tag == f"{{{NS['m']}}}t":
            out.append(child.text or "")
        elif child.tag == f"{{{NS['m']}}}r":  # 一部だけ太字などの文字
            out.extend(t.text or "" for t in child.findall("m:t", NS))
    return "".join(out)


def _number(v):
    """Excel の数 ('5', '5.0', '1E+3') を、整数ならそのまま整数の文字にする。"""
    try:
        f = float(v)
    except ValueError:
        return v
    return str(int(f)) if f.is_integer() else v


def is_xlsx(raw):
    return raw[:2] == b"PK"


def is_old_excel(raw):
    """古い形式の Excel (.xls, Excel 97-2003)。読めないので、.xlsx で保存し直してもらう。"""
    return raw[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def read_rows(raw):
    """xlsx の「品目」シート (無ければ最初のシート) を [{見出し: 値}] にする。"""
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise SheetError("Excel のファイルとして読めません")
    with z:
        book = _xml(z, "xl/workbook.xml")
        rels = _xml(z, "xl/_rels/workbook.xml.rels")
        if book is None or rels is None:
            raise SheetError("Excel のファイルとして読めません")
        sheets = [(s.get("name"), s.get(f"{{{NS['r']}}}id")) for s in book.iter(f"{{{NS['m']}}}sheet")]
        if not sheets:
            raise SheetError("シートがありません")
        rid = next((i for n, i in sheets if n == SHEET), sheets[0][1])
        target = next((r.get("Target") for r in rels.iter(f"{{{NS['rel']}}}Relationship") if r.get("Id") == rid), None)
        if not target:
            raise SheetError("シートが見つかりません")
        target = target.lstrip("/")
        path = target if target.startswith("xl/") else "xl/" + target
        shared = []
        sst = _xml(z, "xl/sharedStrings.xml")
        if sst is not None:
            shared = [_text(si) for si in sst.iter(f"{{{NS['m']}}}si")]
        ws = _xml(z, path)
        if ws is None:
            raise SheetError("シートが見つかりません")
    table = []
    for row in ws.iter(f"{{{NS['m']}}}row"):
        if len(table) > MAX_ROWS:
            raise SheetError(f"行が多すぎます（{MAX_ROWS}行まで）")
        cells = {}
        for c in row.iter(f"{{{NS['m']}}}c"):
            ref, t = c.get("r") or "", c.get("t")
            v = c.find("m:v", NS)
            if t == "s" and v is not None:
                try:
                    val = shared[int(v.text)]
                except (ValueError, IndexError):
                    val = ""
            elif t == "inlineStr":
                is_ = c.find("m:is", NS)
                val = _text(is_) if is_ is not None else ""
            elif v is None:
                continue
            elif t in ("str", "e"):
                val = v.text or ""
            elif t == "b":
                val = "1" if v.text == "1" else "0"
            else:
                val = _number(v.text or "")
            if ref:
                cells[_col(ref)] = val
            else:
                cells[len(cells)] = val
        if cells:
            width = max(cells) + 1
            table.append(([cells.get(i, "") for i in range(width)], int(row.get("r") or len(table) + 1)))
    if not table:
        return []
    header = [h.strip() for h in table[0][0]]
    out = []
    for values, rownum in table[1:]:
        d = {h: (values[i] if i < len(values) else "") for i, h in enumerate(header) if h}
        d["__row__"] = rownum
        out.append(d)
    return out
