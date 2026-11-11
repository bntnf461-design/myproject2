"""品目の Excel（品目登録シート）の作成と読み込み。

Copyright © 2026. All rights reserved.

- build(): 「品目」「フォルダ」「記入例」「説明」の4枚のシートを持つ Excel を作る（空のひな形・今の品目の出力）
- read_rows(): 取り込んだ Excel の「品目」シート（無ければ最初のシート）を、見出し→値の辞書の列にする
- read_folders(): 「フォルダ」シートに書いたフォルダ（大分類・中分類・小分類）を「清掃/ゴミ袋」の形で取り出す
  読み込みは Python の標準の部品だけで行う（追加の部品なし）
"""
import io
import re
import zipfile
import xml.etree.ElementTree as ET

SHEET = "品目"
FOLDER_SHEET = "フォルダ"
FOLDER_ROWS = 300         # フォルダのシートで、入力の決まり・計算の式を入れておく行数
FOLDER_HEAD = ["大分類", "中分類", "小分類", "アプリでのフォルダ（自動）"]
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
    "分類": "品目を入れるフォルダ。手袋・テープ・清掃 など、まとめ方は自由。「清掃/ゴミ袋」のように / で区切ると、フォルダの中のフォルダになります。",
    "棚番": "棚の場所（例: A-1-2）。棚番を使わない時は空欄。",
    "単位": "個・箱・袋・本・巻 など。空欄なら「個」。",
    "単価（税込）": "1単位あたりの値段（円・税込）。在庫金額や棚卸しの金額に使います。空欄なら0。1円未満は小数2桁まで（例: 12.5）。",
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
PRICE_COLS = {"単価（税込）"}
UNITS = ["個", "箱", "袋", "本", "巻", "枚", "双", "組", "缶", "kg", "L", "m"]

EXAMPLES = [
    ["", "ニトリル手袋", "", "", "Mサイズ 100枚", "手袋", "A-1-1", "箱", 880, 12, 5, 10, 1, 1, "○○商事", ""],
    ["", "養生テープ", "ようじょうテープ", "Selotip masking", "緑 50mm×25m", "テープ", "A-2-1", "巻", 198, 30, 10, 30, 1, 1, "△△資材", ""],
    ["", "軍手", "", "Sarung tangan kerja", "フリー 12双", "手袋", "A-1-3", "袋", 550, 9, 3, 10, 1, 1, "○○商事", "1袋=12双"],
    ["", "ゴミ袋 45L", "", "", "半透明 10枚", "清掃/ゴミ袋", "B-2-1", "袋", 165, 20, 5, 20, 1, 1, "△△資材", "フォルダの中のフォルダの例"],
]


def build(labels, rows=(), use_location=True, title="品目登録シート", folders=()):
    """品目登録シート (xlsx) を作って bytes で返す。labels: 列の見出し, rows: 今の品目 (空ならひな形)。
    folders: 「フォルダ」シートに最初から書いておくフォルダ (「清掃/ゴミ袋」の形)。"""
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
    # 単価: 入力する欄は「標準」(12.5 も そのまま見える)、書き出す数は整数なら 1,200、小数なら 12.50
    money_col = wb.add_format({"border": 1, "border_color": "#E7DED3"})
    money = wb.add_format({"num_format": "#,##0", "border": 1, "border_color": "#E7DED3"})
    money2 = wb.add_format({"num_format": "#,##0.00", "border": 1, "border_color": "#E7DED3"})
    note = wb.add_format({"text_wrap": True, "valign": "top"})
    big = wb.add_format({"bold": True, "font_size": 14})
    bold = wb.add_format({"bold": True, "text_wrap": True, "valign": "top"})
    widths = {"コード": 10, "品名": 22, "読み方": 16, "品名（インドネシア語）": 20, "規格": 18, "分類": 10, "棚番": 9,
              "単位": 7, "単価（税込）": 11, "仕入先": 14, "備考": 18}

    def sheet(name, data, protect_examples=False):
        ws = wb.add_worksheet(name)
        ws.freeze_panes(1, 2)
        ws.set_row(0, 34)
        for c, label in enumerate(labels):
            ws.write_string(0, c, label, need if label == "品名" else head)
            ws.set_column(c, c, widths.get(label, 9),
                          num if label in INT_COLS else money_col if label in PRICE_COLS else text)
            if label in HELP:
                ws.write_comment(0, c, HELP[label], {"x_scale": 2, "y_scale": 1.2})
        for r, values in enumerate(data, start=1):
            for c, (label, v) in enumerate(zip(labels, values)):
                if v is None or v == "":
                    continue
                if label in INT_COLS and isinstance(v, int):
                    ws.write_number(r, c, v, num)
                elif label in PRICE_COLS and isinstance(v, (int, float)):
                    ws.write_number(r, c, v, money if float(v).is_integer() else money2)
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
            elif label in PRICE_COLS:
                ws.data_validation(1, c, last, c, {"validate": "decimal", "criteria": ">=", "value": 0, "ignore_blank": True,
                                                   "error_title": label, "error_message": "0以上の数を入れてください（円・税込）"})
            elif label == "単位":
                ws.data_validation(1, c, last, c, {"validate": "list", "source": UNITS, "ignore_blank": True,
                                                   "error_type": "information", "error_title": "単位",
                                                   "error_message": "一覧にない単位でも使えます（OKで続けます）"})
            elif label == "分類" and not protect_examples:
                # 「フォルダ」シートに書いたフォルダから選べる (書いた行の数だけ。一覧にない名前も入れられる)
                ws.data_validation(1, c, last, c, {
                    "validate": "list", "ignore_blank": True, "error_type": "information", "error_title": "分類",
                    "source": f"=OFFSET('{FOLDER_SHEET}'!$D$2,0,0,MAX(1,COUNTIF('{FOLDER_SHEET}'!$D$2:$D${FOLDER_ROWS + 1},\"?*\")),1)",
                    "error_message": "「フォルダ」シートにないフォルダです。このまま入れると、新しいフォルダになります（OKで続けます）"})
        ws.autofilter(0, 0, max(len(data), 1), len(labels) - 1)
        ws.set_landscape(); ws.set_paper(9); ws.fit_to_pages(1, 0); ws.repeat_rows(0)  # 印刷: A4横・横1枚に収める
        if protect_examples:
            ws.set_tab_color("#9CA3AF")
        return ws

    sheet(SHEET, list(rows))
    folder_sheet(wb, folders, head, text, note)
    ex = sheet("記入例", EXAMPLES, protect_examples=True)
    ex.write_string(len(EXAMPLES) + 2, 1, "← このシートは記入例です。取り込まれるのは「品目」と「フォルダ」のシートだけです。")

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
        "6. 品目を分けるフォルダ（カテゴリ）は「フォルダ」シートに、大分類・中分類・小分類で書きます。取り込むと、アプリの",
        "   「品目」画面の左にそのフォルダができます（品目がまだ入っていない空のフォルダもできます）。「品目」シートの「分類」は、",
        "   書いたフォルダから選べます（「清掃/ゴミ袋」のように / で区切った形）。フォルダのシートだけを書いて取り込むこともできます。",
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


FOLDER_EXAMPLE = [["清掃", "", ""], ["清掃", "ゴミ袋", ""], ["", "モップ", ""], ["手袋", "使い捨て", "ニトリル"],
                  ["梱包", "", ""]]


def split_folder(path):
    """「清掃/ゴミ袋/45L」を [大分類, 中分類, 小分類] にする (4段目より下は小分類に / のまま入れる)。"""
    parts = path.split("/")
    return [parts[0], parts[1] if len(parts) > 1 else "", "/".join(parts[2:])]


def folder_sheet(wb, folders, head, text, note):
    """「フォルダ」シート: 大分類・中分類・小分類を書くと、D 列にアプリでのフォルダ (清掃/ゴミ袋) が出る。"""
    ws = wb.add_worksheet(FOLDER_SHEET)
    ws.set_tab_color("#1D4ED8")
    ws.freeze_panes(1, 0)
    ws.set_row(0, 34)
    auto = wb.add_format({"font_color": "#6B665E", "bg_color": "#F3F4F6", "border": 1, "border_color": "#E7DED3"})
    gray = wb.add_format({"font_color": "#6B665E", "valign": "top"})
    plain = wb.add_format({"font_color": "#6B665E"})  # 折り返さずに右の列へはみ出して見せる
    for c, (h, w) in enumerate(zip(FOLDER_HEAD, (16, 16, 16, 30))):
        ws.write_string(0, c, h, head)
        ws.set_column(c, c, w, text if c < 3 else auto)
    ws.write_comment(0, 0, "いちばん上のフォルダ。例: 清掃", {"x_scale": 1.6})
    ws.write_comment(0, 1, "大分類の中のフォルダ。上の行と同じ大分類なら、大分類は空欄でもかまいません。", {"x_scale": 2})
    ws.write_comment(0, 2, "中分類の中のフォルダ。さらに下は「45L/半透明」のように / で区切ります。", {"x_scale": 2})
    ws.write_comment(0, 3, "自動で出ます（入力しないでください）。「品目」シートの「分類」で選べる名前です。", {"x_scale": 2})
    leaves = [p for p in folders if not any(q.startswith(p + "/") for q in folders)]
    cells = [split_folder(p) for p in leaves]
    for r, row in enumerate(cells, start=1):
        for c, v in enumerate(row):
            if v:
                ws.write_string(r, c, v, text)
    # 上の行と同じ大分類・中分類を空欄にしても、続きとして読む (取り込む時と同じ決まり)。
    # 式の答えも書いておく (開いた時に計算し直さないソフトでも、正しく見えるように)
    for r in range(1, FOLDER_ROWS + 1):
        n = r + 1
        a, b, c = cells[r - 1] if r <= len(cells) else ("", "", "")
        ws.write_formula(r, 4, f'=IF(A{n}<>"",A{n},IF(AND(OR(B{n}<>"",C{n}<>""),ROW()>2),E{r},""))', None, a)
        ws.write_formula(r, 5, f'=IF(B{n}<>"",B{n},IF(AND(C{n}<>"",A{n}=""),F{r},""))', None, b)
        ws.write_formula(r, 3, f'=IF(E{n}="","",E{n}&IF(F{n}="","","/"&F{n})&IF(C{n}="","","/"&C{n}))', auto,
                         "/".join(x for x in (a, b, c) if x))
    ws.set_column(4, 5, None, None, {"hidden": True})
    ws.merge_range(0, 7, 0, 9, "書き方の例（この列は取り込みません）", head)
    ws.set_column(7, 9, 14)
    for r, row in enumerate(FOLDER_EXAMPLE, start=1):
        for c, v in enumerate(row):
            ws.write_string(r, 7 + c, v, gray)
    ws.write_string(len(FOLDER_EXAMPLE) + 2, 7, "→ 清掃、清掃/ゴミ袋、清掃/モップ、", plain)
    ws.write_string(len(FOLDER_EXAMPLE) + 3, 7, "　 手袋/使い捨て/ニトリル、梱包 の5つのフォルダができます。", plain)
    ws.set_landscape(); ws.set_paper(9); ws.fit_to_pages(1, 0); ws.repeat_rows(0)
    ws.print_area(0, 0, max(len(cells) + 20, len(FOLDER_EXAMPLE) + 3), 9)  # 式だけの行まで印刷しない
    return ws


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
    table = _read_table(raw, SHEET, first_if_missing=True)
    if not table:
        return []
    header = [h.strip() for h in table[0][0]]
    out = []
    for values, rownum in table[1:]:
        d = {h: (values[i] if i < len(values) else "") for i, h in enumerate(header) if h}
        d["__row__"] = rownum
        out.append(d)
    return out


def read_folders(raw):
    """xlsx の「フォルダ」シートを [(行番号, 「清掃/ゴミ袋」)] にする。シートが無ければ []。
    大分類・中分類が空欄の行は、上の行の続きとして読む (D 列の自動の式と同じ決まり)。"""
    table = _read_table(raw, FOLDER_SHEET, first_if_missing=False)
    out = []
    big = mid = ""
    for values, rownum in table[1:]:
        a, b, c = (str(values[i]).strip() if i < len(values) else "" for i in range(3))
        if a:
            big, mid = a, b
        elif b:
            mid = b
        elif not c:
            continue
        parts = [big, mid if (a or b or c) else "", c]
        if not big:
            out.append((rownum, ""))  # 大分類がわからない行 (理由は呼び出し側で出す)
            continue
        out.append((rownum, "/".join(p for p in parts if p)))
    return out


def _read_table(raw, name, first_if_missing):
    """シートを [(セルの値の列, 行番号)] にする。first_if_missing なら、その名前のシートが無い時は最初のシート。"""
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
        rid = next((i for n, i in sheets if n == name), sheets[0][1] if first_if_missing else None)
        if rid is None:
            return []
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
    return table
