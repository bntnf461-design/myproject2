"""動作確認用のサンプル品目と過去30日分の出庫データを登録する。

    python seed_demo.py            # stock.db に登録 (既存データがある場合は中止)

Copyright © 2026. All rights reserved.
"""
import random
import sqlite3
from datetime import datetime, timedelta

import app as stock_app

ITEMS = [
    # code, name, spec, category, location, unit, stock, reorder_point, order_qty, supplier
    ("SZ0001", "ニトリル手袋", "Mサイズ 100枚", "手袋", "A-1-1", "箱", 12, 5, 10, "○○商事"),
    ("SZ0002", "ニトリル手袋", "Lサイズ 100枚", "手袋", "A-1-2", "箱", 4, 5, 10, "○○商事"),
    ("SZ0003", "軍手", "フリー 12双", "手袋", "A-1-3", "袋", 9, 3, 10, "○○商事"),
    ("SZ0004", "養生テープ", "緑 50mm×25m", "テープ", "A-2-1", "巻", 30, 12, 30, "△△資材"),
    ("SZ0005", "布ガムテープ", "50mm×25m", "テープ", "A-2-2", "巻", 0, 6, 30, "△△資材"),
    ("SZ0006", "ストレッチフィルム", "500mm×300m", "梱包", "B-1-1", "本", 8, 4, 12, "△△資材"),
    ("SZ0007", "ウエス", "白 10kg", "清掃", "B-1-2", "袋", 3, 2, 5, "□□産業"),
    ("SZ0008", "結束バンド", "200mm 100本", "梱包", "B-2-1", "袋", 15, 5, 20, "□□産業"),
    ("SZ0009", "パーツクリーナー", "840ml", "清掃", "B-2-2", "本", 10, 6, 24, "□□産業"),
    ("SZ0010", "マスク", "50枚入", "衛生", "C-1-1", "箱", 6, 3, 10, "○○商事"),
]
USERS = ["山田", "佐藤", "鈴木", "高橋", ""]


def main():
    stock_app.init_db()
    db = sqlite3.connect(stock_app.app.config["DATABASE"])
    db.row_factory = sqlite3.Row
    if db.execute("SELECT COUNT(*) FROM items").fetchone()[0]:
        print("既に品目が登録されているため中止しました")
        return
    now = datetime.now()
    rnd = random.Random(1)
    for (code, name, spec, cat, loc, unit, stock, rp, oq, sup) in ITEMS:
        cur = db.execute(
            "INSERT INTO items (code, name, spec, category, location, unit, stock, reorder_point,"
            " order_qty, supplier, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (code, name, spec, cat, loc, unit, stock, rp, oq, sup,
             (now - timedelta(days=31)).strftime("%Y-%m-%d %H:%M:%S")),
        )
        item_id = cur.lastrowid
        # 現在庫から逆算して過去の出庫・入庫を作る
        events = []
        for d in range(30, 0, -1):
            day = now - timedelta(days=d)
            if day.weekday() >= 5 and rnd.random() < 0.8:
                continue
            for _ in range(rnd.randint(0, 2)):
                ts = day.replace(hour=rnd.randint(8, 17), minute=rnd.randint(0, 59), second=0)
                events.append((ts, "OUT", rnd.choice([1, 1, 1, 2])))
        if rnd.random() < 0.7:
            events.append((now - timedelta(days=rnd.randint(5, 20)), "IN", oq))
        events.sort()
        level = stock + sum(q if k == "OUT" else -q for _, k, q in events)
        db.execute("INSERT INTO transactions (ts, item_id, kind, qty, stock_after, user, note)"
                   " VALUES (?,?,?,?,?,?,?)",
                   ((now - timedelta(days=31)).strftime("%Y-%m-%d %H:%M:%S"), item_id,
                    "ADJ", level, level, "", "初期在庫"))
        for ts, kind, qty in events:
            level += -qty if kind == "OUT" else qty
            db.execute("INSERT INTO transactions (ts, item_id, kind, qty, stock_after, user)"
                       " VALUES (?,?,?,?,?,?)",
                       (ts.strftime("%Y-%m-%d %H:%M:%S"), item_id, kind, qty, level,
                        rnd.choice(USERS)))
    db.commit()
    print(f"サンプル品目 {len(ITEMS)} 件を登録しました")


if __name__ == "__main__":
    main()
