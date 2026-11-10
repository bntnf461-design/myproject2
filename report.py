"""月次レポート (Excel) の集計と作成。

Copyright © 2026. All rights reserved.
"""
import io
from datetime import date, datetime, timedelta

KIND_LABELS = {"OUT": "出庫", "IN": "入庫(補充)", "ADJ": "棚卸調整"}


def month_range(month):
    """'2026-10' → (date(2026,10,1), date(2026,11,1))"""
    y, m = map(int, month.split("-"))
    start = date(y, m, 1)
    end = date(y + (m == 12), m % 12 + 1, 1)
    return start, end


def shift_month(month, n):
    y, m = map(int, month.split("-"))
    k = y * 12 + (m - 1) + n
    return f"{k // 12:04d}-{k % 12 + 1:02d}"


def available_months(db):
    """記録のある月 (新しい順)。今月は記録が無くても入れる。"""
    rows = db.execute("SELECT DISTINCT substr(ts, 1, 7) AS m FROM transactions ORDER BY m DESC").fetchall()
    months = [r["m"] for r in rows]
    this = datetime.now().strftime("%Y-%m")
    if this not in months:
        months.insert(0, this)
    return sorted(set(months), reverse=True)


def summarize(db, month):
    """画面とExcelで使う集計結果をまとめて返す。"""
    start, end = month_range(month)
    s, e = start.isoformat(), end.isoformat()
    items = db.execute("SELECT * FROM items ORDER BY location, code").fetchall()
    per_item = {r["item_id"]: r for r in db.execute(
        "SELECT item_id,"
        " SUM(CASE WHEN kind='OUT' THEN qty ELSE 0 END) AS out_qty,"
        " SUM(CASE WHEN kind='OUT' THEN 1 ELSE 0 END) AS out_n,"
        " SUM(CASE WHEN kind='IN' THEN qty ELSE 0 END) AS in_qty,"
        " SUM(CASE WHEN kind='IN' THEN 1 ELSE 0 END) AS in_n,"
        " SUM(CASE WHEN kind='ADJ' THEN qty ELSE 0 END) AS adj_qty"
        " FROM transactions WHERE voided = 0 AND ts >= ? AND ts < ? GROUP BY item_id", (s, e))}
    # 月末の在庫 = 今の在庫 − 月末より後の増減
    after = {r["item_id"]: r["delta"] for r in db.execute(
        "SELECT item_id, SUM(CASE WHEN kind='OUT' THEN -qty ELSE qty END) AS delta"
        " FROM transactions WHERE voided = 0 AND ts >= ? GROUP BY item_id", (e,))}
    days = (min(end, date.today() + timedelta(days=1)) - start).days or 1

    rows = []
    for it in items:
        t = per_item.get(it["id"])
        if not it["active"] and not t:
            continue
        rows.append({
            "code": it["code"].split("~DEL")[0], "name": it["name"], "name_id": it["name_id"], "spec": it["spec"],
            "category": it["category"], "location": it["location"], "unit": it["unit"],
            "out_qty": t["out_qty"] if t else 0, "out_n": t["out_n"] if t else 0,
            "in_qty": t["in_qty"] if t else 0, "in_n": t["in_n"] if t else 0,
            "adj_qty": t["adj_qty"] if t else 0,
            "end_stock": it["stock"] - after.get(it["id"], 0),
            "reorder_point": it["reorder_point"],
            "daily": (t["out_qty"] / days) if t else 0,
            "active": bool(it["active"]),
        })

    daily = {r["d"]: r for r in db.execute(
        "SELECT substr(ts, 1, 10) AS d,"
        " SUM(CASE WHEN kind='OUT' THEN 1 ELSE 0 END) AS out_n,"
        " SUM(CASE WHEN kind='IN' THEN 1 ELSE 0 END) AS in_n"
        " FROM transactions WHERE voided = 0 AND ts >= ? AND ts < ? GROUP BY d", (s, e))}
    day_rows = []
    d = start
    while d < end:
        r = daily.get(d.isoformat())
        day_rows.append({"date": d, "out_n": r["out_n"] if r else 0, "in_n": r["in_n"] if r else 0})
        d += timedelta(days=1)

    users = db.execute(
        "SELECT CASE WHEN user = '' THEN '（未入力）' ELSE user END AS who,"
        " SUM(CASE WHEN kind='OUT' THEN 1 ELSE 0 END) AS out_n,"
        " SUM(CASE WHEN kind='IN' THEN 1 ELSE 0 END) AS in_n"
        " FROM transactions WHERE voided = 0 AND kind != 'ADJ' AND ts >= ? AND ts < ?"
        " GROUP BY who ORDER BY out_n DESC", (s, e)).fetchall()

    totals = {
        "out_n": sum(r["out_n"] for r in rows), "in_n": sum(r["in_n"] for r in rows),
        "adj_n": db.execute("SELECT COUNT(*) FROM transactions WHERE voided = 0 AND kind = 'ADJ'"
                            " AND ts >= ? AND ts < ?", (s, e)).fetchone()[0],
        "items_used": sum(1 for r in rows if r["out_n"]),
        "low_now": sum(1 for it in items if it["active"] and it["stock"] <= it["reorder_point"]),
    }
    top = sorted([r for r in rows if r["out_qty"]], key=lambda r: (-r["out_n"], -r["out_qty"]))[:10]
    return {"month": month, "start": start, "end": end, "rows": rows, "days": day_rows,
            "users": users, "totals": totals, "top": top}


def trend(db, month, months=12):
    """指定月までの12か月分の、品目ごとの出庫数。"""
    first = shift_month(month, -(months - 1))
    labels = [shift_month(first, i) for i in range(months)]
    s, _ = month_range(first)
    _, e = month_range(month)
    data = db.execute(
        "SELECT t.item_id, i.code, i.name, i.spec, i.unit, substr(t.ts, 1, 7) AS m,"
        " SUM(t.qty) AS q, COUNT(*) AS n FROM transactions t JOIN items i ON i.id = t.item_id"
        " WHERE t.voided = 0 AND t.kind = 'OUT' AND t.ts >= ? AND t.ts < ?"
        " GROUP BY t.item_id, m", (s.isoformat(), e.isoformat())).fetchall()
    items, counts = {}, {m: 0 for m in labels}
    for r in data:
        it = items.setdefault(r["item_id"], {"code": r["code"].split("~DEL")[0], "name": r["name"],
                                             "spec": r["spec"], "unit": r["unit"], "by": {}})
        it["by"][r["m"]] = r["q"]
        counts[r["m"]] += r["n"]
    rows = sorted(items.values(), key=lambda it: -sum(it["by"].values()))
    return labels, rows, counts


def build_xlsx(db, month, credit="", site="", use_location=True):
    import xlsxwriter

    rep = summarize(db, month)
    labels, trend_rows, trend_counts = trend(db, month)
    s, e = rep["start"].isoformat(), rep["end"].isoformat()
    history = db.execute(
        "SELECT t.*, i.code, i.name, i.unit FROM transactions t JOIN items i ON i.id = t.item_id"
        " WHERE t.ts >= ? AND t.ts < ? ORDER BY t.ts, t.id", (s, e)).fetchall()
    counts = db.execute(
        "SELECT c.*, s.started_at, i.code, i.name, i.spec, i.unit FROM stocktake_counts c"
        " JOIN stocktakes s ON s.id = c.stocktake_id JOIN items i ON i.id = c.item_id"
        " WHERE c.ts >= ? AND c.ts < ? ORDER BY c.ts", (s, e)).fetchall()

    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    font = "Meiryo UI"
    f = {
        "title": wb.add_format({"font_name": font, "bold": True, "font_size": 16, "font_color": "#C2410C"}),
        "h": wb.add_format({"font_name": font, "bold": True, "bg_color": "#F1ECE4", "border": 1,
                            "border_color": "#D9D2C7", "text_wrap": True, "valign": "vcenter"}),
        "t": wb.add_format({"font_name": font, "border": 1, "border_color": "#E5DFD5"}),
        "n": wb.add_format({"font_name": font, "border": 1, "border_color": "#E5DFD5", "num_format": "#,##0"}),
        "d": wb.add_format({"font_name": font, "border": 1, "border_color": "#E5DFD5", "num_format": "#,##0.0"}),
        "low": wb.add_format({"font_name": font, "border": 1, "border_color": "#E5DFD5",
                              "num_format": "#,##0", "bg_color": "#FEF3C7"}),
        "big": wb.add_format({"font_name": font, "bold": True, "font_size": 14, "num_format": "#,##0"}),
        "p": wb.add_format({"font_name": font}),
        "muted": wb.add_format({"font_name": font, "font_color": "#7A7368"}),
    }

    def text(ws, r, c, v, fmt="t"):
        # 「=」で始まる文字も数式にせず、文字のまま書く
        ws.write_string(r, c, "" if v is None else str(v), f[fmt])

    def header(ws, r, cols, widths):
        for c, (name, w) in enumerate(zip(cols, widths)):
            text(ws, r, c, name, "h")
            ws.set_column(c, c, w)

    y, m = month.split("-")
    # まとめ
    ws = wb.add_worksheet("まとめ")
    ws.set_column(0, 0, 26)
    ws.set_column(1, 1, 16)
    ws.write_string(0, 0, f"備品・副資材管理アプリ 月次レポート　{y}年{int(m)}月" + (f"　{site}" if site else ""), f["title"])
    ws.write_string(1, 0, f"作成: {datetime.now():%Y-%m-%d %H:%M}" + (f"　{credit}" if credit else ""), f["muted"])
    t = rep["totals"]
    for i, (label, value) in enumerate([
            ("出庫（とる）の回数", t["out_n"]), ("補充（いれる）の回数", t["in_n"]),
            ("棚卸調整の回数", t["adj_n"]), ("使われた品目の数", t["items_used"]),
            ("今、補充が必要な品目", t["low_now"])]):
        ws.write_string(3 + i, 0, label, f["p"])
        ws.write_number(3 + i, 1, value, f["big"])
    ws.write_string(9, 0, "シート: 品目別 / 日別 / 月別推移 / 担当者別 / 棚卸 / 履歴", f["muted"])

    # 品目別
    ws = wb.add_worksheet("品目別")
    cols = ["コード", "品名", "規格", "分類", "棚番", "単位", "出庫数", "出庫回数", "入庫数",
            "入庫回数", "棚卸調整", "月末在庫", "発注点", "1日平均出庫"]
    widths = [12, 22, 16, 10, 8, 6, 9, 9, 9, 9, 9, 9, 8, 11]
    keys = ["code", "name", "spec", "category", "location", "unit"]
    if not use_location:  # 棚番を使わない設定の時は、列ごと出さない
        del cols[4], widths[4], keys[4]
    n0 = len(keys)  # 数の列が始まる位置
    header(ws, 0, cols, widths)
    ws.freeze_panes(1, 2)
    rows = sorted(rep["rows"], key=lambda r: (-r["out_qty"], r["code"]))
    for i, r in enumerate(rows, start=1):
        for c, k in enumerate(keys):
            text(ws, i, c, r[k] + ("（削除済）" if k == "name" and not r["active"] else ""))
        for c, k in enumerate(("out_qty", "out_n", "in_qty", "in_n", "adj_qty"), start=n0):
            ws.write_number(i, c, r[k], f["n"])
        ws.write_number(i, n0 + 5, r["end_stock"], f["low"] if r["end_stock"] <= r["reorder_point"] else f["n"])
        ws.write_number(i, n0 + 6, r["reorder_point"], f["n"])
        ws.write_number(i, n0 + 7, r["daily"], f["d"])
    if rows:
        ws.autofilter(0, 0, len(rows), len(cols) - 1)
    top_n = min(10, sum(1 for r in rows if r["out_qty"]))
    if top_n:
        ch = wb.add_chart({"type": "bar"})
        ch.add_series({"name": "出庫数", "categories": ["品目別", 1, 1, top_n, 1],
                       "values": ["品目別", 1, n0, top_n, n0], "fill": {"color": "#C2410C"},
                       "data_labels": {"value": True}})
        ch.set_title({"name": "出庫数 上位10品目", "name_font": {"name": font, "size": 12}})
        ch.set_y_axis({"reverse": True, "num_font": {"name": font}})
        ch.set_x_axis({"num_font": {"name": font}})
        ch.set_legend({"none": True})
        ch.set_size({"width": 620, "height": 380})
        ws.insert_chart(1, len(cols) + 1, ch)

    # 日別
    ws = wb.add_worksheet("日別")
    header(ws, 0, ["日付", "曜日", "出庫回数", "補充回数"], [12, 6, 10, 10])
    for i, d in enumerate(rep["days"], start=1):
        text(ws, i, 0, d["date"].strftime("%m/%d"))
        text(ws, i, 1, "月火水木金土日"[d["date"].weekday()])
        ws.write_number(i, 2, d["out_n"], f["n"])
        ws.write_number(i, 3, d["in_n"], f["n"])
    n = len(rep["days"])
    ch = wb.add_chart({"type": "column"})
    ch.add_series({"name": "出庫回数", "categories": ["日別", 1, 0, n, 0],
                   "values": ["日別", 1, 2, n, 2], "fill": {"color": "#C2410C"}})
    ch.add_series({"name": "補充回数", "categories": ["日別", 1, 0, n, 0],
                   "values": ["日別", 1, 3, n, 3], "fill": {"color": "#1D4ED8"}})
    ch.set_title({"name": "日別の出庫・補充回数", "name_font": {"name": font, "size": 12}})
    ch.set_legend({"position": "bottom", "font": {"name": font}})
    ch.set_size({"width": 720, "height": 340})
    ws.insert_chart(1, 5, ch)

    # 月別推移
    ws = wb.add_worksheet("月別推移")
    header(ws, 0, ["コード", "品名", "規格", "単位"] + [f"{lb[:4]}/{lb[5:]}" for lb in labels] + ["12か月計"],
           [12, 22, 14, 6] + [9] * len(labels) + [10])
    ws.freeze_panes(1, 2)
    text(ws, 1, 0, "")
    text(ws, 1, 1, "出庫回数（全品目）", "h")
    text(ws, 1, 2, "")
    text(ws, 1, 3, "回")
    for c, lb in enumerate(labels, start=4):
        ws.write_number(1, c, trend_counts[lb], f["n"])
    ws.write_number(1, 4 + len(labels), sum(trend_counts.values()), f["n"])
    for i, r in enumerate(trend_rows, start=2):
        for c, k in enumerate(("code", "name", "spec", "unit")):
            text(ws, i, c, r[k])
        for c, lb in enumerate(labels, start=4):
            ws.write_number(i, c, r["by"].get(lb, 0), f["n"])
        ws.write_number(i, 4 + len(labels), sum(r["by"].values()), f["n"])
    last_col = 3 + len(labels)
    ch = wb.add_chart({"type": "line"})
    ch.add_series({"name": "出庫回数（全品目）", "categories": ["月別推移", 0, 4, 0, last_col],
                   "values": ["月別推移", 1, 4, 1, last_col], "line": {"color": "#C2410C", "width": 2.5},
                   "marker": {"type": "circle"}})
    ch.set_title({"name": "出庫回数の推移（12か月）", "name_font": {"name": font, "size": 12}})
    ch.set_legend({"none": True})
    ch.set_size({"width": 620, "height": 300})
    ws.insert_chart(len(trend_rows) + 4, 1, ch)
    top5 = trend_rows[:5]
    if top5:
        ch = wb.add_chart({"type": "line"})
        for i, r in enumerate(top5):
            ch.add_series({"name": ["月別推移", 2 + i, 1], "categories": ["月別推移", 0, 4, 0, last_col],
                           "values": ["月別推移", 2 + i, 4, 2 + i, last_col], "marker": {"type": "circle"}})
        ch.set_title({"name": "よく使う5品目の出庫数", "name_font": {"name": font, "size": 12}})
        ch.set_legend({"position": "bottom", "font": {"name": font}})
        ch.set_size({"width": 620, "height": 340})
        ws.insert_chart(len(trend_rows) + 20, 1, ch)

    # 担当者別
    ws = wb.add_worksheet("担当者別")
    header(ws, 0, ["担当者", "出庫回数", "補充回数"], [18, 10, 10])
    for i, u in enumerate(rep["users"], start=1):
        text(ws, i, 0, u["who"])
        ws.write_number(i, 1, u["out_n"], f["n"])
        ws.write_number(i, 2, u["in_n"], f["n"])

    # 棚卸
    ws = wb.add_worksheet("棚卸")
    header(ws, 0, ["日時", "コード", "品名", "規格", "記録上の数", "数えた数", "ズレ", "単位", "担当者"],
           [17, 12, 22, 14, 10, 10, 8, 6, 12])
    for i, c in enumerate(counts, start=1):
        text(ws, i, 0, c["ts"][:16])
        text(ws, i, 1, c["code"].split("~DEL")[0])
        text(ws, i, 2, c["name"])
        text(ws, i, 3, c["spec"])
        ws.write_number(i, 4, c["counted"] - c["diff"], f["n"])
        ws.write_number(i, 5, c["counted"], f["n"])
        ws.write_number(i, 6, c["diff"], f["low"] if c["diff"] else f["n"])
        text(ws, i, 7, c["unit"])
        text(ws, i, 8, c["user"])
    if not counts:
        ws.write_string(1, 0, "この月の棚卸はありません", f["muted"])

    # 履歴
    ws = wb.add_worksheet("履歴")
    header(ws, 0, ["日時", "区分", "コード", "品名", "数量", "単位", "処理後在庫", "担当者", "備考", "取消"],
           [17, 10, 12, 22, 8, 6, 10, 12, 16, 6])
    ws.freeze_panes(1, 0)
    for i, h in enumerate(history, start=1):
        text(ws, i, 0, h["ts"])
        text(ws, i, 1, KIND_LABELS[h["kind"]])
        text(ws, i, 2, h["code"].split("~DEL")[0])
        text(ws, i, 3, h["name"])
        ws.write_number(i, 4, h["qty"], f["n"])
        text(ws, i, 5, h["unit"])
        ws.write_number(i, 6, h["stock_after"], f["n"])
        text(ws, i, 7, h["user"])
        text(ws, i, 8, h["note"])
        text(ws, i, 9, "取消" if h["voided"] else "")
    wb.close()
    return buf.getvalue()
