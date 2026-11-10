"""備品・副資材管理アプリ (バーコード / QR 対応)

Copyright © 2026. All rights reserved.
無断で複製・改変・転用・再配布することを禁じます。

棚から備品・副資材を取る時・補充する時にバーコードを読み取って記録し、
在庫数・使用量・要補充品目をダッシュボードで見える化する。
"""
import argparse
import csv
import io
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
import json
import ipaddress
import queue
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import date, datetime, timedelta

from urllib.parse import quote, urlsplit

from flask import (
    Flask, Response, abort, flash, g, jsonify, redirect, render_template,
    request, url_for,
)
from markupsafe import Markup

import backup
import barcodes
import help_data
import item_sheet
import i18n
import licensing
from i18n import tr
import report

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_VERSION = "2026.11.10-2"  # 画面の右下に表示 (どの版が動いているかの確認用)
APP_COPYRIGHT = "© 2026 All rights reserved."  # 著作権表示 (画面の右下に表示)
USAGE_DAYS = 30  # 平均使用量を計算する期間(日)
CODE_RE = re.compile(r"^[A-Z0-9\-]{1,32}$")
COMMAND_PREFIX = "CMD-"

app = Flask(__name__)
app.config.update(
    DATABASE=os.environ.get("STOCK_DB", os.path.join(BASE_DIR, "stock.db")),
    SECRET_KEY=os.environ.get("STOCK_SECRET") or secrets.token_hex(32),
    JSON_AS_ASCII=False,
    # ファイルを上書きしたら、再起動しなくても新しい画面が出るようにする
    TEMPLATES_AUTO_RELOAD=True,
    # ライセンスキー (使えるPCの固定)
    LICENSE_FILE=os.path.join(BASE_DIR, "license.key"),
    LICENSE_REQUIRED=True,
    LICENSE_PUBLIC_KEY=licensing.PUBLIC_KEY,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    spec          TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL DEFAULT '',
    location      TEXT NOT NULL DEFAULT '',
    unit          TEXT NOT NULL DEFAULT '個',
    stock         INTEGER NOT NULL DEFAULT 0,
    reorder_point INTEGER NOT NULL DEFAULT 0,
    order_qty     INTEGER NOT NULL DEFAULT 0,
    out_qty       INTEGER NOT NULL DEFAULT 1,
    in_qty        INTEGER NOT NULL DEFAULT 1,
    reading       TEXT NOT NULL DEFAULT '',
    name_id       TEXT NOT NULL DEFAULT '',
    supplier      TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    ordered_at    TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    kind        TEXT NOT NULL CHECK (kind IN ('OUT', 'IN', 'ADJ')),
    qty         INTEGER NOT NULL,
    stock_after INTEGER NOT NULL,
    user        TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    voided      INTEGER NOT NULL DEFAULT 0,
    short       INTEGER NOT NULL DEFAULT 0  -- 記録上の在庫が足りず、在庫から引けなかった数 (在庫はマイナスにしない)
);
CREATE INDEX IF NOT EXISTS idx_tx_item_ts ON transactions(item_id, ts);
CREATE INDEX IF NOT EXISTS idx_tx_ts ON transactions(ts);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS buyers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL,
    item_id    INTEGER,
    buyer_id   INTEGER,
    to_addr    TEXT NOT NULL DEFAULT '',
    subject    TEXT NOT NULL DEFAULT '',
    ok         INTEGER NOT NULL DEFAULT 0,
    error      TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stocktakes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    user        TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stocktake_counts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id),
    item_id      INTEGER NOT NULL REFERENCES items(id),
    counted      INTEGER NOT NULL,
    diff         INTEGER NOT NULL,
    ts           TEXT NOT NULL,
    user         TEXT NOT NULL DEFAULT '',
    UNIQUE (stocktake_id, item_id)
);
CREATE TABLE IF NOT EXISTS categories (
    path       TEXT PRIMARY KEY,  -- フォルダ (分類) の場所。「清掃/ゴミ袋」のように / で区切る
    created_at TEXT NOT NULL
);
"""

KIND_LABELS = {"OUT": "出庫", "IN": "入庫(補充)", "ADJ": "棚卸調整"}

ITEM_FIELDS = [
    ("code", "コード"), ("name", "品名"), ("reading", "読み方"), ("name_id", "品名（インドネシア語）"), ("spec", "規格"), ("category", "分類"),
    ("location", "棚番"), ("unit", "単位"), ("price", "単価（税込）"), ("stock", "在庫数"),
    ("reorder_point", "発注点"), ("order_qty", "発注数"),
    ("out_qty", "1回にとる数"), ("in_qty", "1回にいれる数"),
    ("supplier", "仕入先"), ("note", "備考"),
]
INT_FIELDS = {"stock", "reorder_point", "order_qty", "out_qty", "in_qty"}
PRICE_MAX = 99_999_999  # 単価の上限 (円・税込)
# 取り込む Excel・CSV で、単価の見出しとして受け付ける言い方
PRICE_ALIASES = ("単価（税込）", "単価(税込)", "単価", "金額", "価格")
PER_SCAN_FIELDS = {"out_qty", "in_qty"}  # 空欄なら1

# スキャン画面で読み取るコマンド用コード
COMMANDS = [
    ("CMD-OUT", "出庫モード", "棚から取る"),
    ("CMD-IN", "入庫モード", "補充する"),
    ("CMD-UNDO", "取消", "直前の記録を取り消す"),
]

# 数量テンキーのワンタッチボタン (設定画面で変更できる)
QUICK_QTY_DEFAULTS = {"OUT": [1, 2, 3, 5, 10, 20], "IN": [1, 5, 10, 20, 30, 50]}
QUICK_QTY_MAX = 6
QTY_LIMIT = 9999
# 入力ミスの確認: いつもの数のこの倍数を超えたら「本当に？」と聞く (0 は確認しない)
CHECK_FACTOR_DEFAULT = 5
CHECK_FACTOR_CHOICES = [(0, "確認しない"), (3, "いつもの3倍より多い時"), (5, "いつもの5倍より多い時"),
                        (10, "いつもの10倍より多い時")]
CHECK_MIN = 10  # これ以下の数は確認しない
WORKER_PREFIX = "CMD-U"
BACKUP_KEEP_DEFAULT = 30
BACKUP_CHECK_SECONDS = 600


# ---------------------------------------------------------------- DB

def to_int(value):
    """半角数字だけの文字列なら整数にする (「²」のような数字に見える文字は受け付けない)。"""
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,9}", value.strip()):
        return int(value.strip())
    return None


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(app.config["DATABASE"]) as db:
        db.executescript(SCHEMA)
        # 以前の版で作ったデータには、品目ごとの数量の列を追加する
        cols = {r[1] for r in db.execute("PRAGMA table_info(items)")}
        for col in ("out_qty", "in_qty"):
            if col not in cols:
                db.execute(f"ALTER TABLE items ADD COLUMN {col} INTEGER NOT NULL DEFAULT 1")
        if "reading" not in cols:
            db.execute("ALTER TABLE items ADD COLUMN reading TEXT NOT NULL DEFAULT ''")
        if "name_id" not in cols:  # インドネシア語の品名
            db.execute("ALTER TABLE items ADD COLUMN name_id TEXT NOT NULL DEFAULT ''")
        if "buyer_id" not in cols:  # 発注担当者
            db.execute("ALTER TABLE items ADD COLUMN buyer_id INTEGER")
        if "price" not in cols:  # 単価 (円・税込)
            db.execute("ALTER TABLE items ADD COLUMN price REAL NOT NULL DEFAULT 0")
        st_cols = {r[1] for r in db.execute("PRAGMA table_info(stocktakes)")}
        for col in ("period_from", "period_to"):  # 棚卸しを始めた時に決めていた期間
            if col not in st_cols:
                db.execute(f"ALTER TABLE stocktakes ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")
        if "price" not in {r[1] for r in db.execute("PRAGMA table_info(stocktake_counts)")}:  # 数えた時の単価
            db.execute("ALTER TABLE stocktake_counts ADD COLUMN price REAL")
        if "short" not in {r[1] for r in db.execute("PRAGMA table_info(transactions)")}:
            db.execute("ALTER TABLE transactions ADD COLUMN short INTEGER NOT NULL DEFAULT 0")
        # 以前の版でマイナスになった在庫は、0 に直して履歴に残す (在庫はマイナスにしない)
        for item_id, stock in db.execute("SELECT id, stock FROM items WHERE stock < 0").fetchall():
            db.execute("UPDATE items SET stock = 0 WHERE id = ?", (item_id,))
            db.execute("INSERT INTO transactions (ts, item_id, kind, qty, stock_after, user, note) VALUES (?, ?, 'ADJ', ?, 0, '', ?)",
                       (now_str(), item_id, -stock, NEGATIVE_FIX_NOTE))


def normalize_code(code):
    # 全角英数やスキャナの余計な空白を吸収する
    code = (code or "").strip().translate(
        str.maketrans("０１２３４５６７８９－ー．Ｑｑ", "0123456789--.QQ")
    )
    return code.upper()


# 数量入りのラベル: 「品目コード.Q数」(例 SZ0001.Q5 = この品目を5個)。
# 同じ品目に「1回 1枚」「1回 5枚」など別々のラベルを作れる。
# 「.」はキーボードの配列 (日本語/英語) が違っても同じ文字で届くので、スキャナでも安全。
LABEL_QTY_RE = re.compile(r"^(?P<code>[A-Z0-9\-]{1,32})\.Q(?P<qty>\d{1,4})$")


def split_label_code(raw):
    """読み取った文字から (品目コード, ラベルの数 または None) を取り出す。"""
    code = normalize_code(raw)
    m = LABEL_QTY_RE.match(code)
    if m:
        qty = int(m.group("qty"))
        if 1 <= qty <= QTY_LIMIT:
            return m.group("code"), qty
    return code, None


def item_status(item):
    if item["stock"] <= 0:
        return "empty"
    if item["stock"] <= item["reorder_point"]:
        return "low"
    return "ok"


STATUS_LABELS = {"empty": "在庫切れ", "low": "要補充", "ok": "適正"}


def usage_by_item(db, days=USAGE_DAYS):
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    rows = db.execute(
        "SELECT item_id, SUM(qty) AS used FROM transactions "
        "WHERE kind = 'OUT' AND voided = 0 AND ts >= ? GROUP BY item_id",
        (since,),
    ).fetchall()
    return {r["item_id"]: r["used"] for r in rows}


def suggest_qty(item):
    """発注の目安: 1回の発注数か、発注点を上回るのに要る数の多い方。"""
    return max(item["order_qty"], item["reorder_point"] - item["stock"] + 1, 0)


def enrich(items, usage):
    """表示用に状態・平均使用量・残日数を付与する。"""
    result = []
    for row in items:
        item = dict(row)
        used = usage.get(item["id"], 0)
        daily = used / USAGE_DAYS
        item["status"] = item_status(item)
        item["status_label"] = STATUS_LABELS[item["status"]]
        item["used_30d"] = used
        item["daily_avg"] = daily
        item["days_left"] = (item["stock"] / daily) if daily > 0 and item["stock"] > 0 else None
        if item["stock"] <= 0 and daily > 0:
            item["days_left"] = 0
        item["suggest_qty"] = suggest_qty(item) if item["status"] != "ok" else 0
        item["value"] = item["stock"] * (item.get("price") or 0)  # 在庫金額 (税込)
        level_base = max(item["reorder_point"] * 2, item["reorder_point"] + item["order_qty"], 1)
        item["level_pct"] = max(0, min(100, round(item["stock"] / level_base * 100)))
        item["reorder_pct"] = max(0, min(100, round(item["reorder_point"] / level_base * 100)))
        result.append(item)
    return result


def use_location():
    """棚番を使うか (「設定」→「棚番」でオフにすると、画面・ラベル・通知に棚番を出さない)。"""
    return get_setting("use_location") != "0"


def loc(value):
    """表示用の棚番 (使わない設定の時は空)。"""
    return value if use_location() else ""


def item_order():
    return "location, code" if use_location() else "code"


def active_items(db, order=None):
    order = order or item_order()
    return db.execute(f"SELECT * FROM items WHERE active = 1 ORDER BY {order}").fetchall()


def active_count(db):
    return db.execute("SELECT COUNT(*) FROM items WHERE active = 1").fetchone()[0]


# ---------------------------------------------------------------- フォルダ (分類)
# 品目の「分類」を、Windows のフォルダのように入れ子にできる。「清掃/ゴミ袋」は「清掃」フォルダの中の「ゴミ袋」。
# 品目には分類の文字 (フォルダの場所) をそのまま持たせ、品目の入っていない空のフォルダは categories に残す。

FOLDER_NAME_MAX = 40
FOLDER_DEPTH_MAX = 6
# 「\」「¥」(Windows の区切り) や全角の「／」で入れても、同じフォルダの区切りとして扱う
_FOLDER_SEPS = str.maketrans({"／": "/", "\\": "/", "¥": "/", "￥": "/"})


def norm_category(text):
    """分類 (フォルダの場所) を「清掃/ゴミ袋」の形にそろえる。空の段や前後の空白は除く。"""
    parts = [p.strip() for p in str(text or "").translate(_FOLDER_SEPS).split("/")]
    return "/".join(p for p in parts if p)


def category_error(path):
    """フォルダの場所として使えない時の理由 (使える時は空)。"""
    parts = path.split("/") if path else []
    if len(parts) > FOLDER_DEPTH_MAX:
        return tr("フォルダの中のフォルダは{n}段までです", n=FOLDER_DEPTH_MAX)
    if any(len(p) > FOLDER_NAME_MAX for p in parts):
        return tr("フォルダの名前は{n}文字までです", n=FOLDER_NAME_MAX)
    return ""


def in_folder(category, path):
    """品目の分類が、そのフォルダ (中のフォルダも含む) に入っているか。path が空なら全部。"""
    return not path or category == path or category.startswith(path + "/")


def parent_folder(path):
    return path.rsplit("/", 1)[0] if "/" in path else ""


def folder_paths(db):
    """今あるフォルダ全部 (品目の入っているフォルダ・空のフォルダと、その上のフォルダ)。並びはフォルダの順。"""
    paths = {r[0] for r in db.execute("SELECT path FROM categories")}
    paths |= {r[0] for r in db.execute("SELECT DISTINCT category FROM items WHERE active = 1 AND category != ''")}
    result = set()
    for p in paths:
        parts = p.split("/")
        result.update("/".join(parts[:n]) for n in range(1, len(parts) + 1))
    return sorted(result, key=lambda p: [x.lower() for x in p.split("/")])


def folder_tree(db, items):
    """フォルダの一覧 (左の木の表示用)。各フォルダの品目数・在庫金額は、中のフォルダの分も足す。"""
    paths = folder_paths(db)
    nodes = []
    for p in paths:
        inside = [i for i in items if in_folder(i["category"], p)]
        nodes.append({"path": p, "name": p.rsplit("/", 1)[-1], "depth": p.count("/"), "parent": parent_folder(p),
                      "count": len(inside), "value": sum(i["value"] for i in inside),
                      "has_children": any(q.startswith(p + "/") for q in paths)})
    return nodes


def touch_folder(db, path):
    """フォルダを覚えておく (品目を全部外しても、空のフォルダとして残る)。"""
    if path:
        db.execute("INSERT OR IGNORE INTO categories (path, created_at) VALUES (?, ?)", (path, now_str()))


def _folder_where(column):
    """そのフォルダと、中のフォルダに当たる行を選ぶ条件 (LIKE は % や _ を含む名前で誤るので使わない)。"""
    return f"({column} = ? OR substr({column}, 1, ?) = ?)"


def _folder_args(path):
    return (path, len(path) + 1, path + "/")


def move_folder(db, old, new):
    """フォルダの名前を変える・別のフォルダへ移す (中の品目・フォルダも一緒に)。できない時は理由を返す。"""
    if not old or not new or old == new:
        return ""
    if new.startswith(old + "/"):
        return tr("フォルダを、自分の中のフォルダへは移せません")
    if new in folder_paths(db):
        return tr("「{name}」というフォルダは、すでにあります", name=new)
    why = category_error(new)
    if why:
        return why
    n = len(old)
    # 品目 (削除した品目も含めて、履歴の表示がずれないように) の分類と、空のフォルダの場所を付け替える
    db.execute(f"UPDATE items SET category = ? || substr(category, ?) WHERE {_folder_where('category')}",
               (new, n + 1, *_folder_args(old)))
    rows = db.execute(f"SELECT path FROM categories WHERE {_folder_where('path')}", _folder_args(old)).fetchall()
    db.execute(f"DELETE FROM categories WHERE {_folder_where('path')}", _folder_args(old))
    for (p,) in rows:
        touch_folder(db, new + p[n:])
    touch_folder(db, new)
    touch_folder(db, parent_folder(old))  # 元の親フォルダが空になっても消えないように
    db.commit()
    return ""


def delete_folder(db, path):
    """フォルダを消す。中の品目は消さずに、1つ上のフォルダへ移す。移した品目の数を返す。"""
    parent = parent_folder(path)
    cur = db.execute(f"UPDATE items SET category = ? WHERE active = 1 AND {_folder_where('category')}",
                     (parent, *_folder_args(path)))
    db.execute(f"DELETE FROM categories WHERE {_folder_where('path')}", _folder_args(path))
    touch_folder(db, parent)
    db.commit()
    return cur.rowcount


# ---------------------------------------------------------------- 金額 (税込)

def parse_price(text):
    """単価の入力 (「1,200」「¥1200」「１２００」「12.5」) を数にする。空なら 0。読めない時は None。"""
    s = str(text if text is not None else "").strip().translate(
        str.maketrans("０１２３４５６７８９．，", "0123456789.,"))
    s = re.sub(r"[\s,¥￥円]", "", s)
    if s == "":
        return 0
    if not re.fullmatch(r"\d{1,9}(\.\d+)?", s):
        return None
    # 1円未満は小数2桁まで。Excel は 33.3 を「33.299999999999997」のように保存することがあるので、
    # 2桁に丸めても変わらない数 (誤差だけの桁) は受け付ける
    value = round(float(s), 2)
    if abs(float(s) - value) > 1e-6:
        return None
    return int(value) if value.is_integer() else value


def plain_price(value):
    """単価を、表やファイル用の数にする (12.0 は 12 に)。"""
    value = value or 0
    return int(value) if float(value).is_integer() else round(value, 2)


@app.template_filter("yen")
def fmt_yen(value):
    """金額を「¥1,234」の形にする (1円未満がある時だけ小数2桁)。"""
    value = round(value or 0, 2)
    if value < 0:
        return "-" + fmt_yen(-value)
    if float(value).is_integer():
        return f"¥{int(value):,}"
    return f"¥{value:,.2f}"


SHORT_NOTE = "記録上の在庫より多く取ったため0に"
NEGATIVE_FIX_NOTE = "マイナスの在庫を0に直しました"


def record(db, item, kind, qty, user="", note="", set_to=None):
    """在庫を更新し、履歴を1件追加する。

    qty は OUT/IN では正の数、ADJ では増減値。set_to を渡すと在庫をその数に合わせる (棚卸)。
    複数の端末から同時に読み取っても数がずれないよう、最新の在庫を読み直してから
    1つのトランザクションで更新する。戻り値は (履歴ID, 更新前の在庫, 更新後の在庫)。
    """
    if db.in_transaction:
        db.commit()
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT stock, reorder_point FROM items WHERE id = ?",
                         (item["id"],)).fetchone()
        old_stock = row["stock"]
        if set_to is not None:
            qty = set_to - old_stock
            if qty == 0:  # 数が合っている時は、履歴を増やさない
                db.commit()
                return None, old_stock, old_stock
        new_stock = old_stock + (-qty if kind == "OUT" else qty)
        short = 0
        if new_stock < 0:
            # 記録上の在庫より多く取った (読み忘れなど): 取った数は記録するが、在庫はマイナスにせず 0 にする
            short = min(qty if kind == "OUT" else -qty, -new_stock)
            new_stock += short
            if not note:
                note = SHORT_NOTE
        db.execute("UPDATE items SET stock = ? WHERE id = ?", (new_stock, item["id"]))
        if kind == "IN" and new_stock > row["reorder_point"]:
            # 発注点を上回るまで補充されたら「発注済」の印を外す (一部だけ届いた時は残す)
            db.execute("UPDATE items SET ordered_at = NULL WHERE id = ?", (item["id"],))
        cur = db.execute(
            "INSERT INTO transactions (ts, item_id, kind, qty, stock_after, user, note, short) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (now_str(), item["id"], kind, qty, new_stock, user, note, short),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    stock_changed(item["id"], old_stock, new_stock, row["reorder_point"])
    return cur.lastrowid, old_stock, new_stock


# ---------------------------------------------------------------- 発注担当者への通知

MAIL_KEYS = ("mail_host", "mail_port", "mail_security", "mail_user", "mail_password", "mail_from")
MAIL_SECURITY = (("starttls", "STARTTLS（ポート587など）"), ("ssl", "SSL（ポート465など）"), ("none", "なし（社内のメールサーバなど）"))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def active_buyers(db):
    return db.execute("SELECT * FROM buyers WHERE active = 1 ORDER BY name, id").fetchall()


def mail_settings():
    return {k: get_setting(k) or "" for k in MAIL_KEYS}


def stock_changed(item_id, old_stock, new_stock, reorder_point):
    """在庫が発注点を下回った時・在庫切れになった時に、その品目の発注担当者へ知らせる (別の流れで送る)。"""
    if new_stock >= old_stock:
        return
    crossed_low = old_stock > reorder_point >= new_stock
    crossed_empty = old_stock > 0 >= new_stock
    if not (crossed_low or crossed_empty):
        return
    job = (app.config["DATABASE"], item_id, "empty" if crossed_empty else "low")
    if app.config.get("TESTING"):  # テストでは、すぐに送って結果を確かめられるようにする
        notify_buyer(*job)
        return
    with _notice_lock:  # 送るのは1つの流れで順番に (CSV取込・棚卸で一度にたくさん下回っても、つなぎすぎない)
        if not _notice_worker:
            _notice_worker.append(threading.Thread(target=_notice_loop, daemon=True))
            _notice_worker[0].start()
    _notice_queue.put(job)


_notice_queue = queue.Queue()
_notice_lock = threading.Lock()
_notice_worker = []


def _notice_loop():
    while True:
        job = _notice_queue.get()
        try:
            notify_buyer(*job)
        except Exception:  # 1件失敗しても、次の通知は送る
            app.logger.exception("発注担当者への通知に失敗しました")


def notify_buyer(db_path, item_id, kind):
    """発注担当者にメールを送り、Teams のチャンネルにも知らせて、結果を記録する。"""
    with closing(sqlite3.connect(db_path, timeout=10)) as db, db:
        db.row_factory = sqlite3.Row
        item = db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        if not item:
            return
        buyer = None
        if item["buyer_id"]:
            buyer = db.execute("SELECT * FROM buyers WHERE id = ? AND active = 1", (item["buyer_id"],)).fetchone()
        conf = {r["key"]: r["value"] for r in db.execute(
            f"SELECT key, value FROM settings WHERE key IN ({','.join('?' * len(MAIL_KEYS))}) "
            "OR key IN ('site_name', 'teams_url', 'use_location')", [*MAIL_KEYS])}
        site = conf.get("site_name") or ""
        if conf.get("use_location") == "0":  # 棚番を使わない時は、通知にも出さない
            item = {**dict(item), "location": ""}
        results = []
        if buyer and buyer["email"] and conf.get("mail_host"):  # メールの送信設定がない時は送らない
            subject, body = notice_text(item, buyer, kind, site)
            results.append((buyer["email"], subject, send_mail, (conf, buyer["email"], subject, body)))
        if conf.get("teams_url"):  # Teams は担当者が決まっていない品目も知らせる (チャンネルの全員が見る)
            subject, _ = notice_text(item, buyer, kind, site)
            results.append(("Teams", subject, send_teams, (conf["teams_url"], teams_card(item, buyer, kind, site))))
        for to_addr, subject, func, args in results:
            ok, err = True, ""
            try:
                func(*args)
            except Exception as e:  # メールサーバ・Teams につながらないなど
                ok, err = False, str(e)[:300]
            db.execute("INSERT INTO notices (ts, item_id, buyer_id, to_addr, subject, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (now_str(), item_id, buyer["id"] if buyer else None, to_addr, subject, int(ok), err))


HONORIFIC_RE = re.compile(r"\s*(さん|様|さま|殿|氏|くん|君|ちゃん)$")


def bare_name(name):
    """画面の「{name} さん」に入れる名前 (「Aさん」と登録されていても「Aさん さん」にしない)。"""
    return HONORIFIC_RE.sub("", (name or "").strip()) or (name or "")


def honorific(name):
    """「山田」→「山田 さん」。名前に さん・様 などが付いている時は、そのまま (「Aさん さん」にしない)。"""
    name = (name or "").strip()
    return name if HONORIFIC_RE.search(name) else f"{name} さん"


def notice_text(item, buyer, kind, site):
    """通知メールの件名と本文 (日本語)。"""
    name = item["name"] + (f"（{item['spec']}）" if item["spec"] else "")
    head = "在庫切れになりました" if kind == "empty" else "発注点を下回りました"
    subject = f"【備品・副資材管理】{site + ' ' if site else ''}{item['name']} が{head}"
    suggest = suggest_qty(item)
    lines = [honorific(buyer['name']) if buyer else "発注担当者さん", "", f"{site + 'の' if site else ''}「{name}」が{head}。発注をお願いします。", "",
             f"　今の在庫　: {item['stock']} {item['unit']}",
             f"　発注点　　: {item['reorder_point']} {item['unit']}",
             f"　発注の目安: {suggest} {item['unit']}"]
    if item["location"]:
        lines.append(f"　棚番　　　: {item['location']}")
    if item["supplier"]:
        lines.append(f"　仕入先　　: {item['supplier']}")
    if item["ordered_at"]:
        lines.append(f"　※ {item['ordered_at'][:16]} に発注済みの印が付いています")
    port = app.config.get("HTTP_PORT") or 5000
    lines += ["", f"補充リスト: http://{get_lan_ip()}:{port}/reorder", "",
              "（このメールは 備品・副資材管理アプリ から自動で送っています）"]
    return subject, "\n".join(lines)


def send_mail(conf, to_addr, subject, body):
    """メールを1通送る。conf は送信設定 (mail_host など)。"""
    import smtplib
    from email.header import Header
    from email.mime.text import MIMEText
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = conf.get("mail_from") or conf.get("mail_user") or "pitto-stock@localhost"
    msg["To"] = to_addr
    host = conf["mail_host"]
    security = conf.get("mail_security") or "starttls"
    port = int(conf.get("mail_port") or (465 if security == "ssl" else 587 if security == "starttls" else 25))
    cls = smtplib.SMTP_SSL if security == "ssl" else smtplib.SMTP
    with cls(host, port, timeout=15) as smtp:
        if security == "starttls":
            smtp.starttls()
        if conf.get("mail_user"):
            smtp.login(conf["mail_user"], conf.get("mail_password") or "")
        smtp.send_message(msg)


TEAMS_URL_RE = re.compile(r"^https://[^\s/]+\.[^\s/]+/\S+$")


def reorder_url():
    return f"http://{get_lan_ip()}:{app.config.get('HTTP_PORT') or 5000}/reorder"


def teams_card(item, buyer, kind, site):
    """Teams に送るカード (Adaptive Card)。Teams の「ワークフロー」と、以前の「受信 Webhook」のどちらでも表示できる形。"""
    head = "在庫切れになりました" if kind == "empty" else "発注点を下回りました"
    name = item["name"] + (f"（{item['spec']}）" if item["spec"] else "")
    unit = item["unit"]
    facts = [("今の在庫", f"{item['stock']} {unit}"), ("発注点", f"{item['reorder_point']} {unit}"),
             ("発注の目安", f"{suggest_qty(item)} {unit}"), ("発注担当", honorific(buyer['name']) if buyer else "（決まっていません）")]
    if site:
        facts.insert(0, ("現場", site))
    if item["location"]:
        facts.append(("棚番", item["location"]))
    if item["supplier"]:
        facts.append(("仕入先", item["supplier"]))
    if item["ordered_at"]:
        facts.append(("発注済み", item["ordered_at"][:16]))
    card = {
        "type": "AdaptiveCard", "version": "1.4",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "body": [
            {"type": "TextBlock", "text": f"{'🔴' if kind == 'empty' else '🟡'} {name} が{head}", "weight": "Bolder",
             "size": "Medium", "wrap": True, "color": "Attention" if kind == "empty" else "Warning"},
            {"type": "FactSet", "facts": [{"title": t, "value": v} for t, v in facts]},
            {"type": "TextBlock", "text": "備品・副資材管理アプリ から自動で送っています", "size": "Small", "isSubtle": True, "wrap": True},
        ],
        "actions": [{"type": "Action.OpenUrl", "title": "補充リストを開く（社内のPCから）", "url": reorder_url()}],
    }
    return {"type": "message", "attachments": [
        {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": card}]}


def send_teams(url, payload):
    """Teams の Webhook (ワークフローの URL) にカードを送る。会社のプロキシ設定はそのまま使う。"""
    req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 (管理者が入れた https の URL だけ)
        if not 200 <= r.status < 300:
            raise RuntimeError(f"HTTP {r.status}")


@app.post("/buyers/teams")
def buyers_teams():
    """Teams の通知先 (Webhook の URL) の保存・テスト送信。"""
    url = request.form.get("teams_url", "").strip()[:2000]
    if url and not TEAMS_URL_RE.match(url):
        flash(tr("Teams の URL は https:// から始まる URL を、そのまま貼り付けてください"), "error")
        return redirect(url_for("buyers_page") + "#teams")
    set_setting("teams_url", url)
    if request.form.get("action") == "test" and url:
        sample = {"name": tr("テスト（軍手）"), "spec": "", "unit": tr("個"), "stock": 3, "reorder_point": 5,
                  "order_qty": 10, "location": "", "supplier": "", "ordered_at": None, "daily_avg": 0}
        try:
            send_teams(url, teams_card(sample, None, "low", get_setting("site_name") or ""))
            flash(tr("Teams にテストのお知らせを送りました。チャンネルに届いたか確かめてください"), "ok")
        except Exception as e:
            flash(tr("Teams に送れませんでした: {reason}", reason=str(e)[:200]), "error")
    elif url:
        flash(tr("Teams の通知先を保存しました"), "ok")
    else:
        flash(tr("Teams への通知を止めました"), "ok")
    return redirect(url_for("buyers_page") + "#teams")


@app.route("/buyers", methods=["GET", "POST"])
def buyers_page():
    """発注担当者 (品目ごとに選び、発注点を下回ったら知らせる人) の登録。"""
    db = get_db()
    if request.method == "POST":
        action = request.form.get("action", "add")
        bid = to_int(request.form.get("id", "") or "")
        name = request.form.get("name", "").strip()[:40]
        email = request.form.get("email", "").strip()[:200]
        if action in ("add", "edit"):
            if not name:
                flash(tr("名前を入れてください"), "error")
                return redirect(url_for("buyers_page"))
            if email and not EMAIL_RE.match(email):
                flash(tr("メールアドレスの形が正しくありません: {email}", email=email), "error")
                return redirect(url_for("buyers_page"))
            if action == "add":
                db.execute("INSERT INTO buyers (name, email, created_at) VALUES (?, ?, ?)", (name, email, now_str()))
                flash(tr("{name} さんを発注担当者に登録しました", name=bare_name(name)), "ok")
            elif bid:
                db.execute("UPDATE buyers SET name = ?, email = ? WHERE id = ?", (name, email, bid))
                flash(tr("{name} さんを更新しました", name=bare_name(name)), "ok")
        elif action == "delete" and bid:
            db.execute("UPDATE buyers SET active = 0 WHERE id = ?", (bid,))
            db.execute("UPDATE items SET buyer_id = NULL WHERE buyer_id = ?", (bid,))
            flash(tr("発注担当者を削除しました（担当していた品目は「なし」になります）"), "ok")
        db.commit()
        return redirect(url_for("buyers_page"))
    counts = {r["buyer_id"]: r["n"] for r in db.execute(
        "SELECT buyer_id, COUNT(*) AS n FROM items WHERE active = 1 AND buyer_id IS NOT NULL GROUP BY buyer_id")}
    notices = db.execute(
        "SELECT n.*, i.name, i.name_id, b.name AS buyer FROM notices n LEFT JOIN items i ON i.id = n.item_id "
        "LEFT JOIN buyers b ON b.id = n.buyer_id ORDER BY n.id DESC LIMIT 20").fetchall()
    return render_template("buyers.html", buyers=active_buyers(db), counts=counts, notices=notices,
                           mail=mail_settings(), mail_security=MAIL_SECURITY, teams_url=get_setting("teams_url") or "",
                           unassigned=db.execute("SELECT COUNT(*) FROM items WHERE active = 1 AND buyer_id IS NULL").fetchone()[0])


@app.post("/buyers/mail")
def buyers_mail():
    """メールの送信設定の保存・テスト送信。"""
    action = request.form.get("action", "save")
    conf = {k: request.form.get(k, "").strip()[:200] for k in MAIL_KEYS}
    if not conf["mail_password"]:
        # 空欄なら今のパスワードのまま。ただしサーバかユーザー名を変えた時は引き継がない
        # (保存済みのパスワードを、別のサーバへ送ってしまわないように)
        if conf["mail_host"] == (get_setting("mail_host") or "") and conf["mail_user"] == (get_setting("mail_user") or ""):
            conf["mail_password"] = get_setting("mail_password") or ""
    if conf["mail_security"] not in dict(MAIL_SECURITY):
        conf["mail_security"] = "starttls"
    if conf["mail_port"] and to_int(conf["mail_port"]) is None:
        flash(tr("ポートは数字で入れてください"), "error")
        return redirect(url_for("buyers_page") + "#mail")
    for k, v in conf.items():
        set_setting(k, v)
    if action == "test":
        to = request.form.get("test_to", "").strip()
        if not EMAIL_RE.match(to):
            flash(tr("テストの送り先のメールアドレスを入れてください"), "error")
        else:
            try:
                send_mail(conf, to, tr("【備品・副資材管理】テストメール"),
                          tr("備品・副資材管理アプリからのテストメールです。このメールが届いていれば、通知の設定はできています。"))
                flash(tr("テストメールを送りました: {to}", to=to), "ok")
            except Exception as e:
                flash(tr("メールを送れませんでした: {reason}", reason=str(e)[:200]), "error")
    else:
        flash(tr("メールの送信設定を保存しました"), "ok")
    return redirect(url_for("buyers_page") + "#mail")


@app.post("/items/buyer")
def items_set_buyer():
    """品目一覧でチェックした品目の発注担当者を、まとめて決める。"""
    db = get_db()
    ids = [i for i in (to_int(x) for x in request.form.getlist("id")) if i]
    raw = request.form.get("buyer_id", "")
    bid = to_int(raw) if raw else None
    if bid is not None and not db.execute("SELECT 1 FROM buyers WHERE id = ? AND active = 1", (bid,)).fetchone():
        abort(400)
    if not ids:
        flash(tr("品目にチェックを入れてください"), "error")
    else:
        db.execute(f"UPDATE items SET buyer_id = ? WHERE id IN ({','.join('?' * len(ids))})", [bid, *ids])
        db.commit()
        flash(tr("{n} 品目の発注担当者を決めました", n=len(ids)), "ok")
    return redirect(url_for("items_list"))


SITE_PREFIX_RE = re.compile(r"^[A-Z][A-Z0-9]{0,3}$")
DEFAULT_PREFIX = "SZ"


def site_prefix():
    """拠点コード (例: A課なら「A」)。自動で付ける品目コードの頭の文字。決めていなければ空。"""
    v = (get_setting("site_prefix") or "").strip().upper()
    return v if SITE_PREFIX_RE.match(v) else ""


def code_head(prefix=None):
    """自動で付けるコードの、数字の前までの部分。拠点コードの最後が数字なら「-」で区切る (A1 → A1-0001)。"""
    p = site_prefix() if prefix is None else prefix
    p = p or DEFAULT_PREFIX
    return p + "-" if p[-1].isdigit() else p


def next_code(db):
    head = code_head()
    rows = db.execute("SELECT code FROM items WHERE code LIKE ?", (head + "%",)).fetchall()
    nums = [int(r["code"][len(head):]) for r in rows if r["code"][len(head):].isdigit()]
    return f"{head}{(max(nums) + 1 if nums else 1):04d}"


def count_default_codes():
    """拠点コードを決める前に自動で付いた (SZ0001 などの) コードの品目の数。付け替えのボタンに出す。"""
    head = code_head("")
    if not site_prefix() or code_head() == head:
        return 0
    rows = get_db().execute("SELECT code FROM items WHERE code LIKE ?", (head + "%",)).fetchall()
    return sum(1 for r in rows if r["code"][len(head):].isdigit())


def is_other_site_code(code):
    """拠点コードを決めていて、ほかの拠点の品目コードの形をしているか (A課で B0003 を読んだ時など)。"""
    code = code or ""

    def is_own(h):  # その頭の文字 + 数字だけのコード (A0001・A10000 など)
        return code.startswith(h) and code[len(h):].isdigit()
    # この拠点の形のコードと、拠点コードを決める前の形 (SZ0001 など。自分の古いラベルかもしれない) は、ほかの拠点としない
    return bool(site_prefix() and not is_own(code_head()) and not is_own(code_head(""))
                and re.match(r"^[A-Z][A-Z0-9]{0,3}?-?\d{4,}$", code))


def unknown_code_error(code):
    """登録されていないコードを読んだ時の説明。ほかの拠点のコードの形なら、そう伝える。"""
    if is_other_site_code(code):
        return tr("ほかの拠点のラベルのようです（この拠点のコードは「{head}」で始まります）: {code}", head=code_head(), code=code)
    return tr("未登録のコードです: {code}", code=code)


# ---------------------------------------------------------------- 画面

@app.template_filter("num")
def fmt_num(value, digits=0):
    if value is None:
        return "-"
    return f"{value:,.{digits}f}"


SITE_NAME_MAX = 40
SITES_MAX = 30
SITE_URL_RE = re.compile(r"^(https?)://([A-Za-z0-9.\-]+|\[[0-9A-Fa-f:]+\])(:\d{1,5})?/?$")


def site_name():
    """この現場の名前 (設定で決める。空なら出さない)。"""
    return (get_setting("site_name") or "").strip()


_this_pc = []


def this_pc():
    """このPCのマシンコード (1回だけ調べて覚えておく)。"""
    if not _this_pc:
        _this_pc.append(licensing.machine_code())
    return _this_pc[0]


def site_id():
    """この現場を見分けるための番号 (初めて使う時に作って保存する)。全現場の画面で重複を除くのに使う。

    stock.db を別のPCにコピーして使い始めた時 (オフライン版のコピー・バックアップからの復元) に
    同じ番号の現場が2つできないよう、作ったPCを一緒に覚えておき、PCが変わったら作り直す。
    """
    sid = get_setting("site_id")
    if not sid or get_setting("site_id_pc") != this_pc():
        sid = secrets.token_hex(6)
        set_setting("site_id", sid)
        set_setting("site_id_pc", this_pc())
    return sid


def other_sites():
    """まとめて見る、ほかの現場のアドレス (例 http://192.168.1.21:5000/)。"""
    return [u for u in (get_setting("site_urls") or "").split("\n") if u.strip()]


def site_ids():
    """登録したほかの現場の番号 {アドレス: 現場の番号}。アドレスが変わった現場を探し直すのに使う。"""
    try:
        data = json.loads(get_setting("site_ids") or "{}")
    except ValueError:
        return {}
    return {u: i for u, i in data.items() if isinstance(u, str) and isinstance(i, str)} if isinstance(data, dict) else {}


def save_site_ids(ids):
    """今登録しているアドレスの分だけ残して保存する。"""
    urls = set(other_sites())
    set_setting("site_ids", json.dumps({u: i for u, i in ids.items() if u in urls}, ensure_ascii=False))


def parse_site_urls(text):
    """入力されたアドレスを整える。(正しいアドレスの一覧, 正しくない行の一覧)"""
    urls, bad = [], []
    for line in (text or "").splitlines():
        line = line.strip().translate(str.maketrans("：／．", ":/."))
        if not line:
            continue
        if not re.match(r"^https?://", line, re.I):
            line = "http://" + line
        if ":" not in line.split("://", 1)[1]:
            line = line.rstrip("/") + ":5000"
        m = SITE_URL_RE.match(line)
        if not m:
            bad.append(line)
            continue
        url = f"{m.group(1).lower()}://{m.group(2).lower()}{m.group(3) or ''}/"
        if url not in urls:
            urls.append(url)
    return urls[:SITES_MAX], bad


def item_label(item):
    """画面に出す品名。インドネシア語の画面では、インドネシア語の品名があればそれを出す。"""
    try:
        name_id = item["name_id"]
    except (KeyError, IndexError):
        name_id = ""
    return name_id if name_id and i18n.current() == "id" else item["name"]


@app.route("/lang/<code>")
def set_lang(code):
    """この端末の画面の言葉を切り替える。"""
    if code not in i18n.LANGS:
        abort(404)
    # 戻り先はこのアプリ内のページだけ ("https:evil.com" や "/\evil.com" のような別サイトへは戻さない)
    back = safe_next(request.args.get("next"), None)
    if back is None and request.referrer:
        ref = urlsplit(request.referrer)
        if ref.netloc == request.host:
            back = safe_next(ref.path + ("?" + ref.query if ref.query else ""), None)
    resp = redirect(back or url_for("dashboard"))
    resp.set_cookie(i18n.COOKIE, code, max_age=10 * 365 * 24 * 3600, samesite="Lax")
    return resp


@app.context_processor
def inject_globals():
    return {"_": tr, "_h": lambda text, **kw: Markup(tr(text, **kw)), "lang": i18n.current(), "LANGS": i18n.LANGS,
            "js_i18n": i18n.js_dict(), "iname": item_label, "bare_name": bare_name, "license_msg": license_message, "note_keys": ("初期在庫", "CSV取込", "CSV取込(初期在庫)", SHORT_NOTE, NEGATIVE_FIX_NOTE),
            "site_name": site_name(), "has_sites": bool(other_sites()), "use_loc": use_location(),
            "buyer_list": lambda: active_buyers(get_db()), "folder_list": lambda: folder_paths(get_db()),
            "KIND_LABELS": KIND_LABELS, "nav": request.endpoint, "app_version": APP_VERSION, "app_copyright": APP_COPYRIGHT,
            "asset": lambda name: url_for("static", filename=name, v=APP_VERSION)}


@app.before_request
def reject_cross_site_post():
    """別のWebサイトからこのアプリへフォームを送らせる攻撃を防ぐ。"""
    if request.method != "POST":
        return None
    origin = request.headers.get("Origin") or request.headers.get("Referer")
    # "null" は sandbox の iframe などから送られる (このアプリの画面からは送られない) ので、別サイト扱いにする
    if origin and (origin == "null" or urlsplit(origin).netloc != request.host):
        abort(403)
    return None


# ---------------------------------------------------------------- ライセンス

_license_cache = {}


def license_state():
    """(使えるか, キーの中身, 使えない理由)。キーのファイルが変わった時だけ読み直す。"""
    path = app.config["LICENSE_FILE"]
    try:
        stamp = (os.path.getmtime(path), os.path.getsize(path))
    except OSError:
        return False, None, "ライセンスキーが登録されていません"
    today = datetime.now().date()
    cached = _license_cache.get(path)
    if cached and cached[0] == stamp and cached[1] == today and cached[2] == app.config["LICENSE_PUBLIC_KEY"]:
        return cached[3]
    try:
        with open(path, encoding="utf-8-sig") as f:
            info = licensing.check(f.read(), public_key=app.config["LICENSE_PUBLIC_KEY"])
        state = (True, info, "")
    except licensing.LicenseError as e:
        state = (False, None, str(e))
    except OSError:
        state = (False, None, "ライセンスキーのファイルを読めません")
    _license_cache[path] = (stamp, today, app.config["LICENSE_PUBLIC_KEY"], state)
    return state


@app.before_request
def require_license():
    """ライセンスキーが無いPCでは、ライセンスの画面だけを開けるようにする。"""
    # ヘルプは、キーの登録のしかたも見られるように、キーが無くても開ける (中身はよくある質問だけ)
    if not app.config.get("LICENSE_REQUIRED") or request.endpoint in ("license_page", "help_page", "set_lang", "static", "favicon"):
        return None
    ok, _, reason = license_state()
    if ok:
        return None
    if request.path.startswith("/api/"):
        resp = jsonify(ok=False, error=tr("ライセンスが登録されていないため使えません。管理者に連絡してください。"))
        if request.path == "/api/summary":  # 全現場の画面に、理由を見せる
            resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp, 403
    return redirect(url_for("license_page"))


@app.route("/license", methods=["GET", "POST"])
def license_page():
    code = licensing.machine_code()
    if request.method == "POST":
        text = request.form.get("key", "")
        upload = request.files.get("file")
        if upload and upload.filename:
            text = upload.read(20000).decode("utf-8-sig", errors="replace")
        try:
            info = licensing.check(text, code=code, public_key=app.config["LICENSE_PUBLIC_KEY"])
        except licensing.LicenseError as e:
            flash(license_message(str(e)), "error")
            return redirect(url_for("license_page"))
        with open(app.config["LICENSE_FILE"], "w", encoding="utf-8") as f:
            f.write("".join(text.split()) + "\n")
        flash(tr("ライセンスを登録しました。") + (f"（{info['name']}）" if info["name"] else ""), "ok")
        return redirect(url_for("dashboard"))
    ok, info, reason = license_state()
    return render_template("license.html", code=code, ok=ok, info=info, reason=reason)


_LICENSE_PATTERNS = [
    (re.compile(r"このライセンスキーは別のPC用です（このPCのマシンコード: (?P<code>.*)）"),
     "このライセンスキーは別のPC用です（このPCのマシンコード: {code}）"),
    (re.compile(r"ライセンスの期限（(?P<expires>.*)）が切れています"), "ライセンスの期限（{expires}）が切れています"),
]


def license_message(msg):
    """licensing の日本語のメッセージを、今の言語に訳す。"""
    for pat, key in _LICENSE_PATTERNS:
        m = pat.fullmatch(msg)
        if m:
            return tr(key, **m.groupdict())
    return tr(msg)


def license_warning():
    """期限が30日以内に来る時の知らせ (無ければ空)。"""
    ok, info, _ = license_state()
    if not ok or not info or not info["expires"]:
        return ""
    days = (datetime.strptime(info["expires"], "%Y-%m-%d").date() - datetime.now().date()).days
    return tr("ライセンスの期限まであと {days} 日です（{expires}）。", days=days, expires=info["expires"]) if days <= 30 else ""


def safe_next(target, fallback):
    """フォームから渡された移動先は、このアプリ内のページだけを許す。"""
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return fallback


@app.route("/favicon.ico")
def favicon():
    return redirect(url_for("static", filename="favicon.svg"))


@app.route("/")
def dashboard():
    db = get_db()
    items = enrich(active_items(db), usage_by_item(db))
    today = datetime.now().strftime("%Y-%m-%d")
    month = datetime.now().strftime("%Y-%m")
    out_today = db.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(qty), 0) AS q FROM transactions "
        "WHERE kind='OUT' AND voided=0 AND ts LIKE ?", (today + "%",)
    ).fetchone()
    in_month = db.execute(
        "SELECT COUNT(*) AS n FROM transactions WHERE kind='IN' AND voided=0 AND ts LIKE ?",
        (month + "%",),
    ).fetchone()

    # 日別の出庫回数 (直近30日)
    start = datetime.now().date() - timedelta(days=USAGE_DAYS - 1)
    rows = db.execute(
        "SELECT substr(ts, 1, 10) AS d, COUNT(*) AS n FROM transactions "
        "WHERE kind='OUT' AND voided=0 AND ts >= ? GROUP BY d",
        (start.isoformat(),),
    ).fetchall()
    per_day = {r["d"]: r["n"] for r in rows}
    daily = []
    for i in range(USAGE_DAYS):
        d = start + timedelta(days=i)
        daily.append({"date": d, "count": per_day.get(d.isoformat(), 0)})
    daily_max = max([d["count"] for d in daily] + [1])

    top_used = sorted([i for i in items if i["used_30d"] > 0],
                      key=lambda i: i["used_30d"], reverse=True)[:10]
    alerts = sorted([i for i in items if i["status"] != "ok"],
                    key=lambda i: (i["status"] != "empty", i["days_left"] or 0))
    recent = recent_transactions(db, 12)
    return render_template(
        "dashboard.html", items=items, alerts=alerts, top_used=top_used,
        daily=daily, daily_max=daily_max, out_today=out_today, in_month=in_month,
        recent=recent, tv=request.args.get("tv") == "1", usage_days=USAGE_DAYS,
        updated=now_str(), now_label=japanese_now(), backup_error=get_setting("backup_error") or "",
        license_warn=license_warning(),
    )


def japanese_now():
    """ダッシュボード見出し用の日時 (例: 10月6日（火） 8:42)。"""
    n = datetime.now()
    week = "月火水木金土日"[n.weekday()]
    if i18n.current() != "ja":
        return tr("{month}月{day}日（{week}） {hour}:{minute}", month=n.month, day=n.day,
                  week=tr(week + "曜日"), hour=n.hour, minute=f"{n.minute:02d}")
    return f"{n.month}月{n.day}日（{week}） {n.hour}:{n.minute:02d}"


def recent_transactions(db, limit=20):
    return db.execute(
        "SELECT t.*, i.code, i.name, i.name_id, i.unit FROM transactions t "
        "JOIN items i ON i.id = t.item_id ORDER BY t.ts DESC, t.id DESC LIMIT ?",
        (limit,),
    ).fetchall()


@app.route("/scan")
def scan():
    return render_template("scan.html", mode=request.args.get("mode", "OUT"),
                           kiosk=request.args.get("kiosk") == "1", quick=quick_quantities())


def get_setting(key, default=None):
    row = get_db().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    db = get_db()
    db.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
               "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
    db.commit()


def parse_quantities(values):
    """入力された数量の並びを、1〜9999 の重複なし・小さい順に整える。"""
    nums, errors = [], []
    for v in values:
        v = (v or "").strip().translate(str.maketrans("０１２３４５６７８９", "0123456789"))
        if not v:
            continue
        if to_int(v) is None or not 1 <= int(v) <= QTY_LIMIT:
            errors.append(tr("「{v}」は使えません（1〜{limit}の数字）", v=v, limit=QTY_LIMIT))
            continue
        if int(v) not in nums:
            nums.append(int(v))
    return sorted(nums)[:QUICK_QTY_MAX], errors


def quick_quantities():
    result = {}
    for mode, default in QUICK_QTY_DEFAULTS.items():
        saved = get_setting(f"quick_qty_{mode}")
        nums = [to_int(n) for n in saved.split(",") if to_int(n)] if saved else []
        result[mode] = nums or list(default)
    return result


def check_factor():
    v = get_setting("check_factor")
    n = to_int(v or "")
    return n if n is not None else CHECK_FACTOR_DEFAULT


def backup_dir():
    """バックアップの保存先 (相対パスならアプリのフォルダから見た場所)。"""
    d = (get_setting("backup_dir") or "").strip() or "backup"
    return d if os.path.isabs(d) else os.path.join(BASE_DIR, d)


def backup_keep():
    v = get_setting("backup_keep")
    n = to_int(v or "")
    return n if n and n >= 1 else BACKUP_KEEP_DEFAULT


def do_backup():
    """バックアップを1つ作り、結果を設定に残す。成功したらファイルのパス、失敗したら None。"""
    try:
        path = backup.run_backup(app.config["DATABASE"], backup_dir(), backup_keep())
    except Exception as e:  # 共有フォルダにつながらない・容量不足など
        set_setting("backup_error", f"{now_str()[:16]} {e}")
        return None
    set_setting("backup_error", "")
    return path


def connect_info():
    """ほかのPC・タブレット・スマホからつなぐ時のアドレス。"""
    ip = get_lan_ip()
    port = app.config.get("HTTP_PORT") or 5000
    https_port = app.config.get("HTTPS_PORT")
    name = socket.gethostname().split(".")[0]
    info = {"ip_url": f"http://{ip}:{port}/",
            "name_url": f"http://{name}:{port}/" if re.fullmatch(r"[A-Za-z0-9-]{1,63}", name) else "",
            "scan_url": f"https://{ip}:{https_port}/scan" if https_port else ""}
    info["ip_qr"] = Markup(barcodes.qr_svg(info["ip_url"], scale=4))
    info["scan_qr"] = Markup(barcodes.qr_svg(info["scan_url"], scale=4)) if info["scan_url"] else None
    return info


def settings_context(**kw):
    ctx = dict(connect=connect_info(), site_name_value=site_name(), site_prefix_value=site_prefix(), code_head=code_head(),
               default_head=code_head(""), recode_count=count_default_codes(), site_urls_saved=other_sites(), site_urls_value="\n".join(other_sites()), site_name_max=SITE_NAME_MAX, quick=quick_quantities(), max_count=QUICK_QTY_MAX, factor=check_factor(),
               factor_choices=CHECK_FACTOR_CHOICES, check_min=CHECK_MIN,
               backup_dir_value=get_setting("backup_dir") or "backup", backup_path=backup_dir(),
               backup_keep=backup_keep(), backup_files=backup.backup_files(backup_dir())[:10],
               backup_error=get_setting("backup_error") or "")
    ctx.update(kw)
    return ctx


# ---------------------------------------------------------------- フォルダを選ぶ (バックアップの保存先)

FOLDER_LIST_MAX = 500
LABEL_COPIES_MAX = 50  # 1品目あたりのラベルの枚数の上限
LABEL_QTYS_MAX = 6     # 数量入りのラベルを一度に作れる種類
_DRIVE_KINDS = {2: "USBメモリなど", 3: "このPCのディスク", 4: "ネットワーク", 5: "CD/DVD"}


def folder_places():
    """フォルダを選ぶ画面の最初に出す場所 (ドライブ・ドキュメントなど)。"""
    places = [{"label": tr("アプリのフォルダ"), "path": BASE_DIR}]
    home = os.path.expanduser("~")
    for sub, label in (("Documents", "ドキュメント"), ("Desktop", "デスクトップ")):
        p = os.path.join(home, sub)
        if os.path.isdir(p):
            places.append({"label": tr(label), "path": p})
    if os.name == "nt":
        import ctypes
        import string
        for letter in string.ascii_uppercase:
            root = f"{letter}:\\"
            try:
                kind = ctypes.windll.kernel32.GetDriveTypeW(root)
            except Exception:
                kind = 0
            # ネットワークのドライブは、つながっていないと調べるだけで時間がかかるので、そのまま出す
            if kind in _DRIVE_KINDS and (kind == 4 or os.path.isdir(root)):
                places.append({"label": f"{tr(_DRIVE_KINDS[kind])} ({letter}:)", "path": root, "kind": kind})
    else:
        places.append({"label": "/", "path": "/"})
        for base in ("/media", "/mnt", "/Volumes"):
            if os.path.isdir(base):
                places.append({"label": base, "path": base})
    return places


def list_folders(path):
    """path の中のフォルダの名前 (ファイルは出さない)。"""
    names = []
    with os.scandir(path) as it:
        for e in it:
            if e.name.startswith((".", "$")) or e.name in ("System Volume Information", "__pycache__"):
                continue
            try:
                if e.is_dir():
                    names.append(e.name)
            except OSError:
                continue
    return sorted(names, key=str.lower)[:FOLDER_LIST_MAX]


@app.get("/api/folders")
def api_folders():
    """サーバPCのフォルダを見る (バックアップの保存先を選ぶため)。"""
    path = (request.args.get("path") or "").strip()
    if not path:
        return jsonify(ok=True, path="", parent=None, places=folder_places(), dirs=[])
    # 相対パス (例 「backup」) は、保存先と同じくアプリのフォルダから見た場所にする
    path = os.path.abspath(path if os.path.isabs(path) else os.path.join(BASE_DIR, path))
    if not os.path.isdir(path):
        return jsonify(ok=False, error=tr("フォルダが見つかりません: {path}", path=path)), 404
    try:
        dirs = list_folders(path)
    except OSError as e:
        return jsonify(ok=False, error=tr("このフォルダは開けません: {path}（{reason}）", path=path, reason=e.strerror or e)), 403
    parent = os.path.dirname(path)  # ドライブの一番上 (C:\\ や /) では同じ場所になる
    return jsonify(ok=True, path=path, parent=None if parent == path else parent, dirs=dirs)


@app.post("/api/folders/new")
def api_folders_new():
    """選んでいるフォルダの中に、新しいフォルダを作る。"""
    data = request.get_json(silent=True) or {}
    base = (data.get("path") or "").strip()
    name = (data.get("name") or "").strip()
    if not base or not os.path.isdir(base):
        return jsonify(ok=False, error=tr("先にフォルダを選んでください")), 400
    if not name or len(name) > 80 or re.search(r'[\\/:*?"<>|]', name) or name in (".", ".."):
        return jsonify(ok=False, error=tr("フォルダの名前に使えない文字があります（\\ / : * ? \" < > |）")), 400
    path = os.path.join(os.path.abspath(base), name)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as e:
        return jsonify(ok=False, error=tr("フォルダを作れません: {path}（{reason}）", path=path, reason=e.strerror or e)), 403
    return jsonify(ok=True, path=path)


@app.route("/settings", methods=["GET", "POST"])
def settings_page():
    if request.method == "POST":
        action = request.form.get("action", "qty")
        if action == "reset":
            for mode in QUICK_QTY_DEFAULTS:
                set_setting(f"quick_qty_{mode}", "")
            flash(tr("数量ボタンを最初の設定に戻しました"), "ok")
            return redirect(url_for("settings_page"))
        if action == "site":
            name = request.form.get("site_name", "").strip()[:SITE_NAME_MAX]
            prefix = request.form.get("site_prefix", "").strip().upper().translate(
                str.maketrans("ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ０１２３４５６７８９", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"))
            if prefix and (not SITE_PREFIX_RE.match(prefix) or prefix.startswith("CMD")):
                flash(tr("拠点コードは、英字で始まる半角英数字1〜4文字にしてください（例: A、B、TK1）"), "error")
                return render_template("settings.html", **settings_context(
                    site_name_value=name, site_prefix_value=prefix, site_urls_value=request.form.get("site_urls", "").strip())), 400
            urls, bad = parse_site_urls(request.form.get("site_urls", ""))
            if bad:  # 入力した名前・アドレスは消さずに、もう一度見せる
                flash(tr("アドレスの形が正しくありません: {urls}", urls="、".join(bad)), "error")
                return render_template("settings.html", **settings_context(
                    site_name_value=name, site_urls_value=request.form.get("site_urls", "").strip(), site_error=True)), 400
            set_setting("site_name", name)
            set_setting("site_prefix", prefix)
            set_setting("site_urls", "\n".join(urls))
            # 登録した現場に、つながるか確かめる (つながった現場は番号を覚えて、アドレスが変わっても探し直せるようにする)
            ids = site_ids()
            with ThreadPoolExecutor(max_workers=SCAN_WORKERS) as ex:
                probed = list(ex.map(lambda u: probe_site(u, timeout=CHECK_TIMEOUT), urls))
            down = []
            for url, r in zip(urls, probed):
                if r:
                    ids[url] = r["id"]
                else:
                    down.append(url)
            save_site_ids(ids)
            flash(tr("現場の設定を保存しました"), "ok")
            if down:
                flash(tr("今つながらない現場があります: {urls}（そのPCが起動しているか、アドレスが正しいかを確かめてください）",
                         urls="、".join(down)), "error")
            return redirect(url_for("settings_page") + "#site")
        if action == "recode":
            # 自動で付けたコード (SZ0001 など) を、拠点コード付き (A0001 など) に付け替える。ラベルは印刷し直してもらう
            if not site_prefix():
                flash(tr("先に拠点コードを決めて保存してください"), "error")
                return redirect(url_for("settings_page") + "#site")
            head, old = code_head(), code_head("")
            changed = 0
            db = get_db()
            for it in db.execute("SELECT id, code FROM items ORDER BY id").fetchall():
                if old == head or not (it["code"].startswith(old) and it["code"][len(old):].isdigit()):
                    continue
                new = head + it["code"][len(old):]
                if db.execute("SELECT 1 FROM items WHERE code = ?", (new,)).fetchone():
                    new = next_code(db)  # 同じ番号が既にある時 (拠点コードを決めた後に登録した品目など) は、空いている番号に
                db.execute("UPDATE items SET code = ? WHERE id = ?", (new, it["id"]))
                changed += 1
            db.commit()
            flash(tr("{n} 件の品目のコードを「{head}」で始まるコードに変えました。棚のラベルを印刷し直して、貼り替えてください。", n=changed, head=head), "ok")
            return redirect(url_for("labels") if changed else url_for("settings_page") + "#site")
        if action == "location":
            on = request.form.get("use_location") == "1"
            set_setting("use_location", "1" if on else "0")
            flash(tr("棚番を使うようにしました") if on else tr("棚番を使わないようにしました（入れてある棚番は消さずに残します）"), "ok")
            return redirect(url_for("settings_page") + "#location")
        if action == "check":
            v = request.form.get("factor", "")
            if to_int(v) is not None and int(v) in dict(CHECK_FACTOR_CHOICES):
                set_setting("check_factor", v)
                flash(tr("入力ミスの確認を保存しました"), "ok")
            return redirect(url_for("settings_page") + "#check")
        if action == "backup":
            folder = request.form.get("backup_dir", "").strip() or "backup"
            keep = request.form.get("backup_keep", "").strip()
            if to_int(keep) is None or not 1 <= int(keep) <= 3650:
                flash(tr("残す日数は1〜3650で入力してください"), "error")
                return redirect(url_for("settings_page") + "#backup")
            path = folder if os.path.isabs(folder) else os.path.join(BASE_DIR, folder)
            try:
                os.makedirs(path, exist_ok=True)
                probe = os.path.join(path, ".write_test")
                with open(probe, "w") as fp:
                    fp.write("ok")
                os.remove(probe)
            except OSError as e:
                flash(tr("このフォルダには保存できません: {path}（{reason}）", path=path, reason=e.strerror or e), "error")
                return redirect(url_for("settings_page") + "#backup")
            set_setting("backup_dir", folder)
            set_setting("backup_keep", keep)
            flash(tr("バックアップの設定を保存しました（保存先: {path}）", path=path), "ok")
            return redirect(url_for("settings_page") + "#backup")
        if action == "backup_now":
            path = do_backup()
            if path:
                flash(tr("バックアップしました: {path}", path=path), "ok")
            else:
                flash(tr("バックアップに失敗しました: ") + (get_setting("backup_error") or ""), "error")
            return redirect(url_for("settings_page") + "#backup")
        new, errors = {}, []
        for mode, label in (("OUT", "とる（出庫）"), ("IN", "いれる（補充）")):
            label = tr(label)
            nums, errs = parse_quantities(request.form.getlist(f"qty_{mode}"))
            errors += [f"{label}: {e}" for e in errs]
            if not nums:
                errors.append(f"{label}: " + tr("数量を1つ以上入れてください"))
            new[mode] = nums
        if errors:
            for e in errors:
                flash(e, "error")
            return render_template("settings.html", **settings_context(quick=new)), 400
        for mode, nums in new.items():
            set_setting(f"quick_qty_{mode}", ",".join(map(str, nums)))
        flash(tr("数量ボタンを保存しました。スキャン画面を開き直すと反映されます。"), "ok")
        return redirect(url_for("settings_page"))
    return render_template("settings.html", **settings_context())


@app.route("/items")
def items_list():
    db = get_db()
    q = request.args.get("q", "").strip()
    folder = norm_category(request.args.get("cat", ""))
    all_items = enrich(active_items(db), usage_by_item(db))
    tree = folder_tree(db, all_items)
    if folder and folder not in {n["path"] for n in tree}:
        folder = ""  # 消えたフォルダを開こうとした時は、すべての品目を出す
    items = [i for i in all_items if in_folder(i["category"], folder)]
    if q:
        ql = q.lower()
        items = [i for i in items if any(ql in str(i[k]).lower()
                 for k in ("code", "name", "name_id", "reading", "spec", "category", "location", "supplier"))]
    # 開いているフォルダのすぐ中のフォルダ (エクスプローラーのように、品目の上に並べる)
    subfolders = [n for n in tree if n["parent"] == folder] if not q else []
    crumbs = []
    if folder:
        parts = folder.split("/")
        crumbs = [{"name": parts[n - 1], "path": "/".join(parts[:n])} for n in range(1, len(parts) + 1)]
    return render_template("items.html", items=items, q=q, copies_max=LABEL_COPIES_MAX, folder=folder, tree=tree,
                           subfolders=subfolders, crumbs=crumbs, folders=[n["path"] for n in tree],
                           total_value=sum(i["value"] for i in items), all_count=len(all_items),
                           all_value=sum(i["value"] for i in all_items),
                           loose_count=sum(1 for i in all_items if not i["category"]))


def back_to_folder(path):
    return redirect(url_for("items_list", cat=path) if path else url_for("items_list"))


@app.post("/folders")
def folder_action():
    """フォルダを作る・名前を変える・移す・消す (品目一覧の左のフォルダ)。"""
    db = get_db()
    action = request.form.get("action", "")
    path = norm_category(request.form.get("path", ""))
    name = norm_category(request.form.get("name", "")).replace("/", "")
    if action == "new":
        if not name:
            flash(tr("フォルダの名前を入れてください"), "error")
            return back_to_folder(path)
        new = f"{path}/{name}" if path else name
        why = category_error(new) or (tr("「{name}」というフォルダは、すでにあります", name=new)
                                      if new in folder_paths(db) else "")
        if why:
            flash(why, "error")
            return back_to_folder(path)
        touch_folder(db, new)
        db.commit()
        flash(tr("フォルダ「{name}」を作りました", name=new), "ok")
        return back_to_folder(new)
    if not path or path not in folder_paths(db):
        flash(tr("フォルダが見つかりません"), "error")
        return back_to_folder("")
    if action in ("rename", "move"):
        if action == "rename":
            if not name:
                flash(tr("フォルダの名前を入れてください"), "error")
                return back_to_folder(path)
            parent = parent_folder(path)
            new = f"{parent}/{name}" if parent else name
        else:
            to = norm_category(request.form.get("to", ""))
            new = f"{to}/{path.rsplit('/', 1)[-1]}" if to else path.rsplit("/", 1)[-1]
        why = move_folder(db, path, new)
        if why:
            flash(why, "error")
            return back_to_folder(path)
        if new != path:
            flash(tr("フォルダを「{name}」にしました", name=new), "ok")
        return back_to_folder(new)
    if action == "delete":
        moved = delete_folder(db, path)
        parent = parent_folder(path)
        msg = tr("フォルダ「{name}」を削除しました", name=path)
        if moved:
            msg += tr("（中の品目 {n} 件は「{to}」へ移しました）", n=moved, to=parent or tr("すべての品目"))
        flash(msg, "ok")
        return back_to_folder(parent)
    abort(400)


@app.post("/items/move")
def items_move():
    """選んだ品目を、フォルダへ移す (チェックして移す・品目をフォルダへドラッグする)。"""
    db = get_db()
    to = norm_category(request.form.get("to", ""))
    back = norm_category(request.form.get("back", ""))
    why = category_error(to)
    if why:
        flash(why, "error")
        return back_to_folder(back)
    ids = [i for i in (to_int(v) for v in request.form.getlist("id")) if i]
    if not ids:
        flash(tr("移す品目を選んでください"), "error")
        return back_to_folder(back)
    marks = ",".join("?" * len(ids))
    for (old,) in db.execute(f"SELECT DISTINCT category FROM items WHERE id IN ({marks})", ids).fetchall():
        touch_folder(db, old)  # 品目を全部移しても、元のフォルダは空のまま残す
    db.executemany("UPDATE items SET category = ? WHERE id = ? AND active = 1", [(to, i) for i in ids])
    touch_folder(db, to)
    db.commit()
    flash(tr("{n} 件の品目を「{to}」へ移しました", n=len(ids), to=to or tr("すべての品目（フォルダなし）")), "ok")
    return back_to_folder(back)


def form_to_item(form):
    data = {}
    errors = []
    for key, label in ITEM_FIELDS:
        val = form.get(key, "").strip()
        if key == "price":
            price = parse_price(val)
            if price is None or price > PRICE_MAX:
                errors.append(tr("単価は0以上の数で入れてください（例: 1200、12.5）"))
                price = 0
            data[key] = price
        elif key in INT_FIELDS:
            val = val.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
            try:
                data[key] = int(val or (1 if key in PER_SCAN_FIELDS else 0))
            except ValueError:
                errors.append(tr("{label}は整数で入力してください", label=tr(label)))
                data[key] = 0
            if key in PER_SCAN_FIELDS and not 1 <= data[key] <= QTY_LIMIT:
                errors.append(tr("{label}は1〜{limit}で入力してください", label=tr(label), limit=QTY_LIMIT))
            elif data[key] < 0 and key != "stock":
                errors.append(tr("{label}は0以上で入力してください", label=tr(label)))
        else:
            data[key] = val
    data["code"] = normalize_code(data["code"])
    data["category"] = norm_category(data["category"])
    why = category_error(data["category"])
    if why:
        errors.append(why)
    if not data["name"]:
        errors.append(tr("品名は必須です"))
    if data["code"] and not CODE_RE.match(data["code"]):
        errors.append(tr("コードは半角英数字とハイフンのみ(32文字以内)で入力してください"))
    if data["code"].startswith(COMMAND_PREFIX):
        errors.append(tr("コードを「{prefix}」で始めることはできません", prefix=COMMAND_PREFIX))
    if not data["unit"]:
        data["unit"] = "個"
    if "buyer_id" in form:
        data["buyer_id"] = to_int(form.get("buyer_id") or "") or None
    return data, errors


@app.route("/items/new", methods=["GET", "POST"])
def item_new():
    db = get_db()
    if request.method == "POST":
        data, errors = form_to_item(request.form)
        if not data["code"]:
            data["code"] = next_code(db)
        if db.execute("SELECT 1 FROM items WHERE code = ?", (data["code"],)).fetchone():
            errors.append(tr("コード {code} は既に使われています", code=data["code"]))
        if data["stock"] < 0:
            errors.append(tr("初期在庫は0以上で入力してください"))
        if errors:
            for e in errors:
                flash(e, "error")
            return render_template("item_form.html", item=data, is_new=True)
        initial = data.pop("stock")
        cols = list(data) + ["stock", "created_at"]
        cur = db.execute(
            f"INSERT INTO items ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            [*data.values(), 0, now_str()],
        )
        touch_folder(db, data["category"])
        db.commit()
        if initial:
            item = db.execute("SELECT * FROM items WHERE id = ?", (cur.lastrowid,)).fetchone()
            record(db, item, "ADJ", initial, note="初期在庫")
        flash(tr("{name} を登録しました", name=item_label(data)), "ok")
        return back_to_folder(data["category"])
    blank = {k: "" for k, _ in ITEM_FIELDS}
    blank.update(stock=0, reorder_point=0, order_qty=0, out_qty=1, in_qty=1, unit="個", price=0,
                 category=norm_category(request.args.get("cat", "")))  # 開いていたフォルダに入れる
    return render_template("item_form.html", item=blank, is_new=True, next_code=next_code(db))


def get_item_or_404(item_id):
    item = get_db().execute("SELECT * FROM items WHERE id = ? AND active = 1", (item_id,)).fetchone()
    if item is None:
        abort(404)
    return item


@app.route("/items/<int:item_id>/edit", methods=["GET", "POST"])
def item_edit(item_id):
    db = get_db()
    item = get_item_or_404(item_id)
    if request.method == "POST":
        data, errors = form_to_item(request.form)
        data.pop("stock")  # 在庫数は棚卸調整でのみ変更する
        if not data["code"]:
            errors.append(tr("コードは必須です"))
        dup = db.execute("SELECT 1 FROM items WHERE code = ? AND id != ?",
                         (data["code"], item_id)).fetchone()
        if dup:
            errors.append(tr("コード {code} は既に使われています", code=data["code"]))
        if errors:
            for e in errors:
                flash(e, "error")
            data.update(id=item_id, stock=item["stock"])
            return render_template("item_form.html", item=data, is_new=False)
        db.execute(
            f"UPDATE items SET {', '.join(f'{k} = ?' for k in data)} WHERE id = ?",
            [*data.values(), item_id],
        )
        # フォルダは、品目を移して空になっても残す (Windows のフォルダと同じ)
        touch_folder(db, item["category"])
        touch_folder(db, data["category"])
        db.commit()
        flash(tr("{name} を更新しました", name=item_label(data)), "ok")
        return back_to_folder(data["category"])
    history = db.execute(
        "SELECT * FROM transactions WHERE item_id = ? ORDER BY id DESC LIMIT 30", (item_id,)
    ).fetchall()
    return render_template("item_form.html", item=dict(item), is_new=False, history=history)


@app.route("/items/<int:item_id>/adjust", methods=["POST"])
def item_adjust(item_id):
    db = get_db()
    item = get_item_or_404(item_id)
    back = safe_next(request.form.get("next"), url_for("item_edit", item_id=item_id))
    try:
        actual = int(request.form.get("actual", "").strip())
    except ValueError:
        flash(tr("実在庫数は整数で入力してください"), "error")
        return redirect(back)
    if actual < 0:
        flash(tr("実在庫数は0以上で入力してください"), "error")
        return redirect(back)
    if actual == item["stock"]:
        flash(tr("在庫数に差異はありません"), "ok")
    else:
        # 棚卸中に別の端末で読み取られても、数えた数にきちんと合わせる
        _, before, _ = record(db, item, "ADJ", 0, user=request.form.get("user", "")[:40],
                              note=request.form.get("note", "")[:200] or "棚卸", set_to=actual)
        flash(tr("在庫数を {before} → {actual} に調整しました", before=before, actual=actual), "ok")
    return redirect(back)


@app.route("/help")
def help_page():
    """ヘルプ（質問する）: 質問を入れると、よくある質問から答えと開く画面を出す。"""
    lg = "id" if i18n.current() == "id" else "ja"
    entries = []
    for n, h in enumerate(help_data.HELP):
        link = None
        if h["link"]:
            endpoint, anchor = h["link"]
            link = url_for(endpoint) + (f"#{anchor}" if anchor else "")
        entries.append({"n": n, "cat": h["cat"], "q": h["q"][lg], "kw": h["kw"][lg] + " " + h["kw"]["ja"],
                        "a": h["a"][lg], "link": link})
    cats = [(key, names[lg]) for key, names in help_data.CATS]
    return render_template("help.html", entries=entries, cats=cats, q=request.args.get("q", "")[:100])


@app.route("/receive")
def receive_page():
    """入庫（補充）を、一覧から品物を選んで数を入れ、Enter で記録する (スキャンしなくてよい)。"""
    db = get_db()
    workers = [r["name"] for r in db.execute("SELECT name FROM workers WHERE active = 1 ORDER BY id")]
    return render_template("receive.html", items=enrich(active_items(db), {}), workers=workers)


@app.route("/items/<int:item_id>/receive", methods=["POST"])
def item_receive(item_id):
    """補充（入庫）を、スキャンせずに数を入れて記録する。事務所で補充を受けた時など。"""
    db = get_db()
    item = get_item_or_404(item_id)
    back = safe_next(request.form.get("next"), url_for("reorder"))
    qty = to_int(request.form.get("qty", "").strip().translate(str.maketrans("０１２３４５６７８９", "0123456789")))
    if qty is None or not 1 <= qty <= QTY_LIMIT:
        flash(tr("補充した数は1〜{n}で入力してください", n=QTY_LIMIT), "error")
        return redirect(back)
    user = (request.form.get("user", "").strip() or tr("事務所"))[:40]
    _, before, after = record(db, item, "IN", qty, user=user, note=request.form.get("note", "")[:200])
    flash(tr("{name} の補充を記録しました（{before} → {after}{unit}）",
             name=item_label(item), before=before, after=after, unit=tr(item["unit"])), "ok")
    return redirect(back)


@app.route("/items/<int:item_id>/delete", methods=["POST"])
def item_delete(item_id):
    db = get_db()
    item = get_item_or_404(item_id)
    # 履歴を残すため論理削除にする (品目が入っていたフォルダは残す)
    touch_folder(db, item["category"])
    db.execute("UPDATE items SET active = 0, code = ? WHERE id = ?",
               (f"{item['code']}~DEL{item_id}", item_id))
    db.commit()
    flash(tr("{name} を削除しました", name=item_label(item)), "ok")
    return back_to_folder(item["category"])


@app.route("/items/<int:item_id>/ordered", methods=["POST"])
def item_ordered(item_id):
    db = get_db()
    item = get_item_or_404(item_id)
    value = None if item["ordered_at"] else now_str()
    db.execute("UPDATE items SET ordered_at = ? WHERE id = ?", (value, item_id))
    db.commit()
    return redirect(safe_next(request.form.get("next"), url_for("reorder")))


@app.route("/reorder")
def reorder():
    db = get_db()
    items = enrich(active_items(db), usage_by_item(db))
    targets = [i for i in items if i["status"] != "ok"]
    targets.sort(key=lambda i: (i["supplier"], loc(i["location"]), i["code"]))
    buyers = {b["id"]: b for b in active_buyers(db)}
    return render_template("reorder.html", items=targets, today=now_str()[:10], buyers=buyers)


@app.route("/history")
def history():
    db = get_db()
    where, params = history_filter(request.args)
    rows = db.execute(
        "SELECT t.*, i.code, i.name, i.name_id, i.unit, i.location FROM transactions t "
        f"JOIN items i ON i.id = t.item_id {where} ORDER BY t.ts DESC, t.id DESC LIMIT 500",
        params,
    ).fetchall()
    return render_template("history.html", rows=rows, args=request.args,
                           items=active_items(db, "code"))


def history_filter(args):
    clauses, params = [], []
    if args.get("item"):
        clauses.append("t.item_id = ?")
        params.append(args["item"])
    if args.get("kind") in KIND_LABELS:
        clauses.append("t.kind = ?")
        params.append(args["kind"])
    if args.get("from"):
        clauses.append("t.ts >= ?")
        params.append(args["from"])
    if args.get("to"):
        clauses.append("t.ts <= ?")
        params.append(args["to"] + " 23:59:59")
    if args.get("user"):
        clauses.append("t.user LIKE ?")
        params.append(f"%{args['user']}%")
    return ("WHERE " + " AND ".join(clauses)) if clauses else "", params


def csv_cell(value):
    """Excel で開いた時に「=」などで始まる文字が数式として実行されないようにする。"""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def csv_response(header, rows, filename):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows([csv_cell(v) for v in row] for row in rows)
    # Excel でそのまま開けるよう BOM 付き UTF-8 にする
    data = "﻿" + buf.getvalue()
    return Response(data, mimetype="text/csv; charset=utf-8", headers={
        "Content-Disposition": f"attachment; filename={filename}"})


@app.route("/history.csv")
def history_csv():
    db = get_db()
    where, params = history_filter(request.args)
    rows = db.execute(
        "SELECT t.*, i.code, i.name, i.name_id, i.unit FROM transactions t "
        f"JOIN items i ON i.id = t.item_id {where} ORDER BY t.ts, t.id", params,
    ).fetchall()
    return csv_response(
        ["日時", "区分", "コード", "品名", "数量", "単位", "処理後在庫", "担当者", "備考", "取消"],
        [[r["ts"], KIND_LABELS[r["kind"]], r["code"], r["name"], r["qty"], r["unit"],
          r["stock_after"], r["user"], r["note"], "取消" if r["voided"] else ""] for r in rows],
        f"history_{datetime.now():%Y%m%d}.csv",
    )


def item_row(item):
    """品目を、CSV・Excel の1行にする (列は ITEM_FIELDS の順)。"""
    return [plain_price(item[k]) if k == "price" else item[k] for k, _ in ITEM_FIELDS]


@app.route("/items.csv")
def items_csv():
    items = active_items(get_db(), "code")
    return csv_response(
        [label for _, label in ITEM_FIELDS],
        [item_row(i) for i in items],
        f"items_{datetime.now():%Y%m%d}.csv",
    )


@app.route("/items.xlsx")
def items_xlsx():
    """今の品目を、品目登録シート (Excel) で出す。直して、そのまま取り込める。"""
    items = active_items(get_db(), "code")
    labels = [label for _, label in ITEM_FIELDS]
    rows = [item_row(i) for i in items]
    data = item_sheet.build(labels, rows, use_location=use_location())
    return Response(data, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={
        "Content-Disposition": f"attachment; filename=items_{datetime.now():%Y%m%d}.xlsx"})


@app.route("/items/template.xlsx")
def items_template():
    """空の品目登録シート (Excel のひな形)。"""
    data = item_sheet.build([label for _, label in ITEM_FIELDS], use_location=use_location())
    fname = quote("品目登録シート.xlsx")
    return Response(data, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={
        "Content-Disposition": f"attachment; filename=item_sheet.xlsx; filename*=UTF-8''{fname}"})


@app.route("/items/import", methods=["POST"])
def items_import():
    db = get_db()
    f = request.files.get("file")
    if not f or not f.filename:
        flash(tr("CSVファイルを選択してください"), "error")
        return redirect(url_for("items_list"))
    raw = f.read(20 * 1024 * 1024 + 1)
    if len(raw) > 20 * 1024 * 1024:
        flash(tr("ファイルが大きすぎます（20MBまで）"), "error")
        return redirect(url_for("items_list"))
    if item_sheet.is_old_excel(raw):
        flash(tr("古い形式の Excel（.xls）は読めません。Excel の「名前を付けて保存」で「Excel ブック（*.xlsx）」にしてから取り込んでください"), "error")
        return redirect(url_for("items_list"))
    if item_sheet.is_xlsx(raw):
        # Excel (品目登録シート) はそのまま読む。行の番号は Excel の行番号
        try:
            rows = [(r.pop("__row__"), r) for r in item_sheet.read_rows(raw)]
        except item_sheet.SheetError as e:
            flash(tr("Excel を読み込めませんでした: {why}", why=tr(str(e))), "error")
            return redirect(url_for("items_list"))
    else:
        for enc in ("utf-8-sig", "cp932"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            flash(tr("文字コードを判別できませんでした (UTF-8 または Shift_JIS で保存してください)"), "error")
            return redirect(url_for("items_list"))
        rows = list(enumerate(csv.DictReader(io.StringIO(text)), start=2))
    label_to_key = {label: key for key, label in ITEM_FIELDS}
    label_to_key.update({key: key for key, _ in ITEM_FIELDS})
    label_to_key.update({alias: "price" for alias in PRICE_ALIASES})
    label_to_key.update({"フォルダ": "category", "カテゴリ": "category", "カテゴリー": "category"})
    if not rows or not any(k and str(k).strip() in label_to_key for k in rows[0][1]):
        flash(tr("見出しの行が見つかりません。1行目に「品名」などの見出しを入れてください（Excelのひな形を使うと確実です）"), "error")
        return redirect(url_for("items_list"))
    added = updated = 0
    errors = []
    for lineno, row in rows:
        form = {label_to_key[k.strip()]: ("" if v is None else str(v)) for k, v in row.items()
                if k and isinstance(k, str) and k.strip() in label_to_key}
        if not any(v.strip() for v in form.values()):  # 空白だけの行も、空の行として飛ばす
            continue
        existing = None
        code = normalize_code(form.get("code"))
        if code:
            existing = db.execute("SELECT * FROM items WHERE code = ?", (code,)).fetchone()
        # 既にある品目は、CSVに無い列を今の値で補う (品名だけの更新・数量だけの更新ができる)
        given = set(form)
        check = {k: str(existing[k]) for k, _ in ITEM_FIELDS} if existing else {}
        check.update(form)
        data, errs = form_to_item(check)
        if errs:
            errors.append(tr("{n}行目: ", n=lineno) + " / ".join(errs))
            continue
        if not data["code"]:
            data["code"] = next_code(db)
        if form.get("stock", "").strip() and data["stock"] < 0:
            errors.append(tr("{n}行目: ", n=lineno) + tr("在庫数は0以上で入力してください"))
            continue
        stock = data.pop("stock")
        if existing:
            # CSVに無い列は今の値のままにする
            cols = [k for k in data if k in given and k != "code"]
            if cols:
                db.execute(f"UPDATE items SET {', '.join(f'{k} = ?' for k in cols)} WHERE id = ?",
                           [*(data[k] for k in cols), existing["id"]])
            touch_folder(db, existing["category"])
            touch_folder(db, data["category"])
            db.commit()
            if form.get("stock", "").strip() and stock != existing["stock"]:
                item = db.execute("SELECT * FROM items WHERE id = ?", (existing["id"],)).fetchone()
                record(db, item, "ADJ", 0, note="CSV取込", set_to=stock)
            updated += 1
        else:
            cols = list(data) + ["stock", "created_at"]
            cur = db.execute(
                f"INSERT INTO items ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                [*data.values(), 0, now_str()],
            )
            touch_folder(db, data["category"])
            db.commit()
            if stock:
                item = db.execute("SELECT * FROM items WHERE id = ?", (cur.lastrowid,)).fetchone()
                record(db, item, "ADJ", stock, note="CSV取込(初期在庫)")
            added += 1
    flash(tr("取り込み: 新規 {added} 件 / 更新 {updated} 件", added=added, updated=updated), "ok")
    for e in errors[:20]:
        flash(e, "error")
    return redirect(url_for("items_list"))


@app.route("/labels")
def labels():
    db = get_db()
    ids = request.args.getlist("id", type=int)
    kind = request.args.get("type", "both")
    if ids:
        marks = ",".join("?" * len(ids))
        items = db.execute(
            f"SELECT * FROM items WHERE active = 1 AND id IN ({marks}) ORDER BY {item_order()}",
            ids).fetchall()
    else:
        items = active_items(db)
    # 同じ品目のラベルを何枚ずつ作るか (棚の表と裏・予備など)
    copies = min(max(to_int(request.args.get("copies", "") or "1") or 1, 1), LABEL_COPIES_MAX)
    # 数量入りのラベル: 「1,5」なら、品目ごとに「1回 1」「1回 5」のラベルを作る (空欄ならふつうのラベル)
    qtys_text = (request.args.get("qtys") or "").strip()
    qtys = []
    for part in re.split(r"[,、，\s]+", qtys_text.translate(str.maketrans("０１２３４５６７８９", "0123456789"))):
        n = to_int(part)
        if n is not None and 1 <= n <= QTY_LIMIT and n not in qtys:
            qtys.append(n)
    qtys = qtys[:LABEL_QTYS_MAX]
    labels_data = []
    for item in items:
        for q in (qtys or [None]):
            code = f"{item['code']}.Q{q}" if q else item["code"]
            one = {
                "item": item, "code": code, "qty": q,
                "qr": Markup(barcodes.qr_svg(code)) if kind in ("both", "qr") else None,
                "bar": Markup(barcodes.code128_svg(code)) if kind in ("both", "bar") else None,
            }
            labels_data.extend([one] * copies)
    return render_template("labels.html", labels=labels_data, kind=kind, copies=copies, ids=ids,
                           copies_max=LABEL_COPIES_MAX, item_count=len(items),
                           qtys_text=", ".join(map(str, qtys)), qtys=qtys)


@app.route("/poster")
def poster():
    """棚に貼る作業者用の手順書 (A4 1枚)。"""
    return render_template("poster.html")


@app.route("/labels/commands")
def command_labels():
    quick = quick_quantities()
    numbers = sorted(set(quick["OUT"]) | set(quick["IN"]))
    commands = COMMANDS + [(f"CMD-Q{n}", f"数量 {n}", "次に読む品目の数量") for n in numbers]
    cards = [{
        "code": code, "title": title, "desc": desc,
        "qr": Markup(barcodes.qr_svg(code, scale=5)),
        "bar": Markup(barcodes.code128_svg(code)),
    } for code, title, desc in commands]
    return render_template("command_labels.html", cards=cards)


# ---------------------------------------------------------------- 担当者カード

def worker_code(worker_id):
    return f"{WORKER_PREFIX}{worker_id}"


@app.route("/workers", methods=["GET", "POST"])
def workers():
    db = get_db()
    if request.method == "POST":
        names = [n.strip()[:20] for n in re.split(r"[\r\n,、]+", request.form.get("names", ""))]
        names = [n for n in names if n]
        if not names:
            flash(tr("名前を入れてください"), "error")
        for n in names:
            db.execute("INSERT INTO workers (name, created_at) VALUES (?, ?)", (n, now_str()))
        db.commit()
        if names:
            flash(tr("{names} を登録しました。カードを印刷してください。", names="、".join(names)), "ok")
        return redirect(url_for("workers"))
    rows = db.execute("SELECT * FROM workers WHERE active = 1 ORDER BY id").fetchall()
    return render_template("workers.html", workers=rows, worker_code=worker_code)


@app.route("/workers/<int:worker_id>/delete", methods=["POST"])
def worker_delete(worker_id):
    db = get_db()
    w = db.execute("SELECT * FROM workers WHERE id = ? AND active = 1", (worker_id,)).fetchone()
    if w is None:
        abort(404)
    db.execute("UPDATE workers SET active = 0 WHERE id = ?", (worker_id,))
    db.commit()
    flash(tr("{name} さんのカードを使えなくしました", name=bare_name(w["name"])), "ok")
    return redirect(url_for("workers"))


@app.route("/workers/cards")
def worker_cards():
    db = get_db()
    ids = request.args.getlist("id", type=int)
    rows = db.execute("SELECT * FROM workers WHERE active = 1 ORDER BY id").fetchall()
    if ids:
        rows = [r for r in rows if r["id"] in ids]
    cards = [{"name": r["name"], "code": worker_code(r["id"]),
              "qr": Markup(barcodes.qr_svg(worker_code(r["id"]), scale=5)),
              "bar": Markup(barcodes.code128_svg(worker_code(r["id"])))} for r in rows]
    return render_template("worker_cards.html", cards=cards)


@app.get("/api/workers/<code>")
def api_worker(code):
    code = normalize_code(code)
    m = re.fullmatch(re.escape(WORKER_PREFIX) + r"(\d{1,9})", code)
    row = None
    if m:
        row = get_db().execute("SELECT * FROM workers WHERE id = ? AND active = 1",
                               (int(m.group(1)),)).fetchone()
    if row is None:
        return jsonify(ok=False, error=tr("この担当者カードは使えません（登録されていないか、削除されています）")), 404
    return jsonify(ok=True, name=row["name"])


# ---------------------------------------------------------------- 棚卸し

def stocktake_period():
    """棚卸しの期間 (設定で決める)。決めていなければ None。

    期間外でも数えられる (画面に「期間外」と出すだけ)。
    """
    start, end = get_setting("stocktake_from") or "", get_setting("stocktake_to") or ""
    if not start or not end:
        return None
    today = datetime.now().date().isoformat()
    state = "before" if today < start else "after" if today > end else "in"
    return {"start": start, "end": end, "state": state, "in_period": state == "in"}


def period_label(start, end):
    """「2026/10/28 〜 2026/11/28」の形。"""
    if not start or not end:
        return ""
    return f"{start.replace('-', '/')} 〜 {end.replace('-', '/')}"


def open_stocktake(db):
    return db.execute("SELECT * FROM stocktakes WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1").fetchone()


def get_stocktake_or_404(st_id):
    st = get_db().execute("SELECT * FROM stocktakes WHERE id = ?", (st_id,)).fetchone()
    if st is None:
        abort(404)
    return st


def stocktake_counts(db, st_id):
    # 単価は数えた時のもの (無い時は今の単価)。金額は「数えた数 × 単価」、ズレの金額は「ズレ × 単価」
    return db.execute(
        "SELECT c.*, i.code, i.name, i.name_id, i.spec, i.unit, i.location, i.stock, i.category, "
        "COALESCE(c.price, i.price) AS unit_price, c.counted * COALESCE(c.price, i.price) AS value, "
        "c.diff * COALESCE(c.price, i.price) AS diff_value FROM stocktake_counts c "
        "JOIN items i ON i.id = c.item_id WHERE c.stocktake_id = ? AND i.active = 1 ORDER BY c.ts DESC, c.id DESC",
        (st_id,)).fetchall()


def stocktake_diff(db, st_id, item_id):
    """この棚卸しで、その品目の在庫を合わせた量の合計 (数える前の記録 = 今の在庫 - これ)。"""
    return db.execute("SELECT COALESCE(SUM(qty), 0) FROM transactions WHERE item_id = ? AND kind = 'ADJ' "
                      "AND voided = 0 AND note = ?", (item_id, f"棚卸し #{st_id}")).fetchone()[0]


def stocktake_diffs(db, st_id):
    """stocktake_diff を全品目まとめて求める ({品目ID: 合わせた量})。取り消した分は含めない。"""
    return {r[0]: r[1] for r in db.execute(
        "SELECT item_id, SUM(qty) FROM transactions WHERE kind = 'ADJ' AND voided = 0 AND note = ? "
        "GROUP BY item_id", (f"棚卸し #{st_id}",))}


def stocktake_summary(db, st):
    counts = stocktake_counts(db, st["id"])
    counted_ids = {c["item_id"] for c in counts}
    remaining = [i for i in active_items(db) if i["id"] not in counted_ids]
    diffs = sorted([c for c in counts if c["diff"]], key=lambda c: (-abs(c["diff"]), c["code"]))
    return {"counts": counts, "remaining": remaining, "diffs": diffs,
            "total": len(counts) + len(remaining), "done": len(counts),
            "missing_qty": sum(-c["diff"] for c in counts if c["diff"] < 0),
            "counted_value": sum(c["value"] or 0 for c in counts),
            "diff_value": sum(c["diff_value"] or 0 for c in counts),
            "remaining_value": sum(i["stock"] * (i["price"] or 0) for i in remaining),
            "period": stocktake_period()}


def frequently_missed(db, limit=10):
    """これまでの棚卸しで「記録より少なかった」品目 (読み忘れが多いと考えられる品目)。"""
    return db.execute(
        "SELECT i.id, i.code, i.name, i.name_id, i.spec, i.unit, COUNT(*) AS times, -SUM(c.diff) AS qty "
        "FROM stocktake_counts c JOIN items i ON i.id = c.item_id "
        "JOIN stocktakes s ON s.id = c.stocktake_id "
        "WHERE c.diff < 0 AND i.active = 1 GROUP BY i.id ORDER BY times DESC, qty DESC LIMIT ?",
        (limit,)).fetchall()


@app.route("/stocktake")
def stocktake_index():
    db = get_db()
    current = open_stocktake(db)
    past = db.execute(
        "SELECT s.*, COUNT(c.id) AS n, SUM(CASE WHEN c.diff != 0 THEN 1 ELSE 0 END) AS n_diff "
        "FROM stocktakes s LEFT JOIN stocktake_counts c ON c.stocktake_id = s.id "
        "WHERE s.finished_at IS NOT NULL GROUP BY s.id ORDER BY s.id DESC LIMIT 12").fetchall()
    return render_template("stocktake_index.html", current=current, past=past,
                           missed=frequently_missed(db), total=active_count(db), period=stocktake_period(),
                           period_label=period_label)


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@app.post("/stocktake/period")
def stocktake_period_save():
    """棚卸しの期間を決める (例: 10月28日〜11月28日)。「期間を消す」で決めない状態に戻す。"""
    if request.form.get("action") == "clear":
        set_setting("stocktake_from", "")
        set_setting("stocktake_to", "")
        flash(tr("棚卸しの期間を消しました"), "ok")
        return redirect(url_for("stocktake_index"))
    start, end = request.form.get("from", "").strip(), request.form.get("to", "").strip()
    try:
        if not (DATE_RE.match(start) and DATE_RE.match(end)):
            raise ValueError
        date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        flash(tr("期間の始まりと終わりの日付を、両方入れてください"), "error")
        return redirect(url_for("stocktake_index"))
    if start > end:
        flash(tr("終わりの日付は、始まりの日付より後にしてください"), "error")
        return redirect(url_for("stocktake_index"))
    set_setting("stocktake_from", start)
    set_setting("stocktake_to", end)
    flash(tr("棚卸しの期間を {p} にしました", p=period_label(start, end)), "ok")
    return redirect(url_for("stocktake_index"))


@app.post("/stocktake/start")
def stocktake_start():
    db = get_db()
    current = open_stocktake(db)
    if current is None:
        period = stocktake_period()
        cur = db.execute("INSERT INTO stocktakes (started_at, user, period_from, period_to) VALUES (?, ?, ?, ?)",
                         (now_str(), request.form.get("user", "").strip()[:40],
                          period["start"] if period else "", period["end"] if period else ""))
        db.commit()
        st_id = cur.lastrowid
        if period and not period["in_period"]:
            flash(tr("今日は棚卸しの期間（{p}）の外です。このまま数えることはできます。",
                     p=period_label(period["start"], period["end"])), "warn")
    else:
        st_id = current["id"]
    # ふつうは一覧で手入力。「スキャンで始める」の時だけスキャンの画面へ
    if request.form.get("mode") == "scan":
        return redirect(url_for("stocktake_page", st_id=st_id))
    return redirect(url_for("stocktake_list", st_id=st_id))


@app.route("/stocktake/<int:st_id>")
def stocktake_page(st_id):
    db = get_db()
    st = get_stocktake_or_404(st_id)
    summary = stocktake_summary(db, st)
    template = "stocktake_result.html" if st["finished_at"] else "stocktake.html"
    return render_template(template, st=st, period_label=period_label, **summary)


@app.route("/stocktake/<int:st_id>/list")
def stocktake_list(st_id):
    """棚卸しを、一覧に数を打ち込んで進める (スキャンしなくてよい)。"""
    db = get_db()
    st = get_stocktake_or_404(st_id)
    if st["finished_at"]:
        return redirect(url_for("stocktake_page", st_id=st_id))
    counts = {c["item_id"]: c for c in stocktake_counts(db, st_id)}
    # 数える前の記録は、取り消しも反映した実際の調整量から求める (スキャン画面と同じ数になるように)
    adjusted = stocktake_diffs(db, st_id)
    rows = []
    for i in active_items(db):
        c = counts.get(i["id"])
        rows.append({"item": i, "counted": c["counted"] if c else None, "diff": c["diff"] if c else None,
                     "system": i["stock"] - adjusted.get(i["id"], 0),
                     "price": c["unit_price"] if c else (i["price"] or 0)})
    return render_template("stocktake_list.html", st=st, rows=rows, done=len(counts), total=len(rows),
                           period=stocktake_period(), period_label=period_label, folders=folder_paths(db))


@app.post("/stocktake/<int:st_id>/finish")
def stocktake_finish(st_id):
    db = get_db()
    st = get_stocktake_or_404(st_id)
    if not st["finished_at"]:
        db.execute("UPDATE stocktakes SET finished_at = ? WHERE id = ?", (now_str(), st_id))
        db.commit()
        flash(tr("棚卸しを終わりました。結果を確かめてください。"), "ok")
    return redirect(url_for("stocktake_page", st_id=st_id))


@app.route("/stocktake/<int:st_id>.csv")
def stocktake_csv(st_id):
    db = get_db()
    st = get_stocktake_or_404(st_id)
    summary = stocktake_summary(db, st)
    rows = [[c["ts"], c["code"], c["name"], c["spec"], c["category"], c["counted"] - c["diff"], c["counted"],
             c["diff"], c["unit"], plain_price(c["unit_price"]), plain_price(c["value"]), plain_price(c["diff_value"]),
             c["user"]] for c in reversed(summary["counts"])]
    rows += [["", i["code"], i["name"], i["spec"], i["category"], i["stock"], "", "未棚卸", i["unit"],
              plain_price(i["price"]), "", "", ""] for i in summary["remaining"]]
    return csv_response(["日時", "コード", "品名", "規格", "分類", "記録上の数", "数えた数", "ズレ", "単位",
                         "単価（税込）", "金額（税込）", "ズレの金額（税込）", "担当者"],
                        rows, f"stocktake_{st['started_at'][:10].replace('-', '')}.csv")


@app.get("/api/stocktake/<int:st_id>/item")
def api_stocktake_item(st_id):
    db = get_db()
    st = get_stocktake_or_404(st_id)
    code, _qty = split_label_code(request.args.get("code", ""))
    item = db.execute("SELECT * FROM items WHERE code = ? AND active = 1", (code,)).fetchone()
    if item is None:
        return jsonify(ok=False, error=unknown_code_error(code)), 404
    prev = db.execute("SELECT counted FROM stocktake_counts WHERE stocktake_id = ? AND item_id = ?",
                      (st["id"], item["id"])).fetchone()
    return jsonify(ok=True, item={"code": item["code"], "name": item["name"], "spec": item["spec"],
                                  "unit": item["unit"], "location": loc(item["location"]),
                                  "reading": item["reading"], "name_id": item["name_id"]},
                   counted=prev["counted"] if prev else None,
                   system=item["stock"] - stocktake_diff(db, st["id"], item["id"]))


@app.post("/api/stocktake/<int:st_id>/count")
def api_stocktake_count(st_id):
    db = get_db()
    st = get_stocktake_or_404(st_id)
    if st["finished_at"]:
        return jsonify(ok=False, error=tr("この棚卸しは終わっています")), 409
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = {}
    code, _qty = split_label_code(str(payload.get("code") or ""))
    counted = payload.get("counted")
    if isinstance(counted, str):
        counted = to_int(counted)
    if not isinstance(counted, int) or isinstance(counted, bool) or not 0 <= counted <= 999999:
        return jsonify(ok=False, error=tr("数えた数が不正です")), 400
    item = db.execute("SELECT * FROM items WHERE code = ? AND active = 1", (code,)).fetchone()
    if item is None:
        return jsonify(ok=False, error=unknown_code_error(code)), 404
    user = str(payload.get("user") or "").strip()[:40]
    note = f"棚卸し #{st_id}"
    prev = db.execute("SELECT 1 FROM stocktake_counts WHERE stocktake_id = ? AND item_id = ?",
                      (st_id, item["id"])).fetchone()
    record(db, item, "ADJ", 0, user=user, note=note, set_to=counted)
    # ズレ = この棚卸しで行った調整の合計 (数え直し・取り消しがあっても正しくなる)
    diff = stocktake_diff(db, st_id, item["id"])
    db.execute("INSERT INTO stocktake_counts (stocktake_id, item_id, counted, diff, ts, user, price) "
               "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stocktake_id, item_id) DO UPDATE SET "
               "counted = excluded.counted, diff = excluded.diff, ts = excluded.ts, user = excluded.user, "
               "price = excluded.price", (st_id, item["id"], counted, diff, now_str(), user, item["price"] or 0))
    db.commit()
    done = db.execute("SELECT COUNT(*) FROM stocktake_counts c JOIN items i ON i.id = c.item_id "
                      "WHERE c.stocktake_id = ? AND i.active = 1", (st_id,)).fetchone()[0]
    return jsonify(ok=True, item={"code": item["code"], "name": item["name"], "spec": item["spec"],
                                  "unit": item["unit"], "location": loc(item["location"]), "name_id": item["name_id"]},
                   counted=counted, system=counted - diff, diff=diff, recount=bool(prev),
                   done=done, total=active_count(db), price=plain_price(item["price"]),
                   out_of_period=bool((p := stocktake_period()) and not p["in_period"]))


# ---------------------------------------------------------------- 月次レポート

MONTH_RE = re.compile(r"20[0-9]{2}-(0[1-9]|1[0-2])")


def pick_month(db):
    month = request.args.get("month", "")
    return month if MONTH_RE.fullmatch(month) else datetime.now().strftime("%Y-%m")


@app.route("/report")
def report_page():
    db = get_db()
    month = pick_month(db)
    rep = report.summarize(db, month)
    labels, trend_rows, trend_counts = report.trend(db, month, 6)
    return render_template("report.html", rep=rep, month=month, months=report.available_months(db),
                           trend_labels=labels, trend_counts=trend_counts,
                           trend_max=max(list(trend_counts.values()) + [1]))


@app.route("/report.xlsx")
def report_xlsx():
    db = get_db()
    month = pick_month(db)
    site = site_name()
    data = report.build_xlsx(db, month, APP_COPYRIGHT, site=site, use_location=use_location())
    ascii_name = f"report_{month.replace('-', '')}.xlsx"
    disp = f"attachment; filename={ascii_name}"
    if site:  # 日本語のファイル名 (現場名入り) も付ける。対応していないブラウザは英字の名前を使う
        disp += "; filename*=UTF-8''" + quote(f"{site}_月次レポート_{month.replace('-', '')}.xlsx", safe="")
    return Response(data, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": disp})


# ---------------------------------------------------------------- 全現場まとめ

@app.get("/api/summary")
def api_summary():
    """この現場の在庫のまとめ。事務所の「全現場」画面が、各現場から読みに来る。"""
    db = get_db()
    if request.args.get("brief") == "1":  # 「ほかの現場を探す」用: 品目の一覧は送らない
        total = active_count(db)
        resp = jsonify(ok=True, id=site_id(), site=site_name(), version=APP_VERSION, counts={"total": total})
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Cache-Control"] = "no-store"
        return resp
    items = []
    for i in active_items(db):
        status = item_status(i)
        items.append({"code": i["code"], "name": i["name"], "name_id": i["name_id"], "spec": i["spec"],
                      "unit": i["unit"], "location": loc(i["location"]), "category": i["category"],
                      "stock": i["stock"], "reorder_point": i["reorder_point"], "order_qty": i["order_qty"],
                      "status": status, "ordered": bool(i["ordered_at"])})
    resp = jsonify(ok=True, id=site_id(), site=site_name(), prefix=site_prefix(), sites=other_sites(), version=APP_VERSION, time=now_str()[:16],
                   counts={"total": len(items), "low": sum(1 for i in items if i["status"] == "low"),
                           "empty": sum(1 for i in items if i["status"] == "empty")},
                   items=items)
    # ほかの現場の画面 (別のアドレス) からも読めるようにする (読むだけ)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Cache-Control"] = "no-store"
    return resp


SCAN_TIMEOUT = 0.7   # 1台あたり待つ秒数
CHECK_TIMEOUT = 3    # 登録した現場につながるか確かめる時に待つ秒数
SCAN_WORKERS = 64
# 社内のアドレスを直接見に行く (PCに設定されたプロキシを通すと、社内のPCに届かないことがある)
LAN_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def probe_site(url, timeout=SCAN_TIMEOUT):
    """そのアドレスで備品・副資材管理アプリが動いていれば、まとめの一部を返す (動いていなければ None)。"""
    try:
        with LAN_OPENER.open(url + "api/summary?brief=1", timeout=timeout) as r:  # noqa: S310 (社内のアドレスだけ)
            data = json.loads(r.read(100_000).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("ok") or not data.get("id"):
        return None
    return {"url": url, "id": data["id"], "site": data.get("site") or "", "total": (data.get("counts") or {}).get("total", 0)}


def scan_candidates(port):
    """このPCと同じ社内ネットワーク (x.x.x.1〜254) のアドレス。"""
    ip = get_lan_ip()
    try:
        net = ipaddress.ip_network(ip + "/24", strict=False)
    except ValueError:
        return []
    if not net.is_private:  # 社内のアドレスの時だけ探す
        return []
    return [f"http://{h}:{port}/" for h in net.hosts() if str(h) != ip]


@app.post("/api/sites/scan")
def api_sites_scan():
    """社内のネットワークから、ほかの現場の備品・副資材管理アプリを探す (設定の「ほかの現場を探す」)。"""
    port = app.config.get("HTTP_PORT") or 5000
    me = site_id()
    known = set(other_sites())
    with ThreadPoolExecutor(max_workers=SCAN_WORKERS) as ex:
        found = [r for r in ex.map(probe_site, scan_candidates(port)) if r and r["id"] != me]
    for r in found:
        r["registered"] = r["url"] in known
    found.sort(key=lambda r: (r["site"] == "", r["site"], r["url"]))
    return jsonify(ok=True, network=get_lan_ip().rsplit(".", 1)[0] + ".*", found=found)


@app.post("/api/sites/remember")
def api_sites_remember():
    """全現場の画面で読めた現場の番号を覚える (手で入れたアドレスでも、あとで探し直せるように)。"""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = {}
    url, sid = str(payload.get("url") or ""), str(payload.get("id") or "")
    if url not in other_sites() or not re.fullmatch(r"[0-9a-f]{6,32}", sid):
        return jsonify(ok=False), 400
    ids = site_ids()
    if ids.get(url) != sid:
        ids[url] = sid
        save_site_ids(ids)
    return jsonify(ok=True)


@app.post("/api/sites/relocate")
def api_sites_relocate():
    """つながらなくなった現場を、社内のネットワークから探し直す (PCのアドレスが変わった時)。
    見つかったら、登録のアドレスを新しいものに書き換える。"""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = {}
    url = str(payload.get("url") or "")
    urls = other_sites()
    sid = site_ids().get(url)
    if url not in urls or not sid:
        return jsonify(ok=True, found=False)
    port = (SITE_URL_RE.match(url).group(3) or ":5000")[1:] if SITE_URL_RE.match(url) else 5000
    with ThreadPoolExecutor(max_workers=SCAN_WORKERS) as ex:
        hit = next((r for r in ex.map(probe_site, scan_candidates(port)) if r and r["id"] == sid), None)
    if not hit:
        return jsonify(ok=True, found=False)
    new = hit["url"]
    if new not in urls:
        set_setting("site_urls", "\n".join(new if u == url else u for u in urls))
    else:
        set_setting("site_urls", "\n".join(u for u in urls if u != url))
    ids = site_ids()
    ids.pop(url, None)
    ids[new] = sid
    save_site_ids(ids)
    return jsonify(ok=True, found=True, url=new, site=hit["site"])


@app.route("/sites")
def sites_page():
    """全現場の在庫を、まとめて見る。"""
    return render_template("sites.html", others=other_sites(), known=sorted(site_ids()),
                           http_port=app.config.get("HTTP_PORT") or 5000, version=APP_VERSION)


# ---------------------------------------------------------------- API (スキャン画面用)

def tx_json(row):
    return {
        "id": row["id"], "ts": row["ts"], "kind": row["kind"],
        "kind_label": tr(KIND_LABELS[row["kind"]]), "qty": row["qty"],
        "stock_after": row["stock_after"], "user": row["user"],
        "voided": bool(row["voided"]), "code": row["code"], "name": row["name"], "name_id": row["name_id"],
        "unit": row["unit"],
    }


@app.post("/api/scan")
def api_scan():
    db = get_db()
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = {}
    code, label_qty = split_label_code(str(payload.get("code") or ""))
    mode = payload.get("mode", "OUT")
    user = str(payload.get("user") or "").strip()[:40]
    if mode not in ("OUT", "IN"):
        return jsonify(ok=False, error=tr("モードが不正です")), 400
    item = db.execute("SELECT * FROM items WHERE code = ? AND active = 1", (code,)).fetchone()
    if item is None:
        return jsonify(ok=False, error=unknown_code_error(code), other_site=is_other_site_code(code)), 404
    # 数量が指定されていなければ、品目ごとの「1回の数」を使う
    raw_qty = payload.get("qty")
    qty_auto = raw_qty is None
    if qty_auto:
        # 数量入りのラベル (例 SZ0001.Q5) ならその数、ふつうのラベルなら品目の「1回の数」
        qty = label_qty or item["out_qty" if mode == "OUT" else "in_qty"]
    elif isinstance(raw_qty, int) and not isinstance(raw_qty, bool):
        qty = raw_qty
    elif isinstance(raw_qty, str) and to_int(raw_qty) is not None:
        qty = to_int(raw_qty)
    else:
        qty = 0
    if qty <= 0 or qty > QTY_LIMIT:
        return jsonify(ok=False, error=tr("数量が不正です")), 400
    # 打ち間違いを防ぐため、いつもより大幅に多い数は確認してから記録する
    if not qty_auto and payload.get("confirm") is not True:
        usual = usual_qty(db, item, mode)
        factor = check_factor()
        if factor and qty > max(CHECK_MIN, usual * factor):
            return jsonify(ok=False, need_confirm=True, qty=qty, usual=usual, kind=mode,
                           item={"code": item["code"], "name": item["name"], "spec": item["spec"],
                                 "unit": item["unit"], "reading": item["reading"], "name_id": item["name_id"]},
                           error=tr("いつもは {usual}{unit} です。{qty}{unit} で合っていますか？", usual=usual, qty=qty, unit=tr(item["unit"]))), 409
    tx_id, old_stock, new_stock = record(db, item, mode, qty, user=user)
    item = db.execute("SELECT * FROM items WHERE id = ?", (item["id"],)).fetchone()
    prev_status = item_status({"stock": old_stock, "reorder_point": item["reorder_point"]})
    status = item_status(item)
    alert = scan_alert(mode, prev_status, status)
    warning = None
    short = new_stock - (old_stock - qty) if mode == "OUT" else 0
    if short > 0:
        warning = tr("記録上の在庫（{n}{unit}）より多く取りました。在庫を0にしました。棚卸しで数を確かめてください。",
                     n=old_stock, unit=tr(item["unit"]))
    elif mode == "OUT" and status != "ok":
        warning = tr("{status}: 残り {stock}{unit} (発注点 {rp})", status=tr(STATUS_LABELS[status]), stock=new_stock,
                     unit=tr(item["unit"]), rp=item["reorder_point"])
    return jsonify(
        ok=True, tx_id=tx_id, kind=mode, kind_label=tr(KIND_LABELS[mode]), qty=qty, qty_auto=qty_auto, label_qty=label_qty,
        item={"id": item["id"], "code": item["code"], "name": item["name"],
              "spec": item["spec"], "location": loc(item["location"]), "unit": item["unit"],
              "stock": item["stock"], "reorder_point": item["reorder_point"],
              "ordered": bool(item["ordered_at"]),
              "out_qty": item["out_qty"], "in_qty": item["in_qty"], "reading": item["reading"], "name_id": item["name_id"]},
        status=status, status_label=tr(STATUS_LABELS[status]), warning=warning, short=max(short, 0),
        alert=alert, alert_count=alert_count(db),
    )


def usual_qty(db, item, kind):
    """その品目でいつも記録している数 (最近20回の中央値と「1回の数」の大きい方)。

    補充 (IN) は、発注した数がまとめて届くのがふつうなので「発注数」も「いつもの数」に含める。
    """
    rows = [r[0] for r in db.execute(
        "SELECT qty FROM transactions WHERE item_id = ? AND kind = ? AND voided = 0 "
        "ORDER BY id DESC LIMIT 20", (item["id"], kind))]
    base = item["out_qty"] if kind == "OUT" else max(item["in_qty"], item["order_qty"] or 0)
    if not rows:
        return base
    rows.sort()
    return max(base, rows[len(rows) // 2])


def scan_alert(mode, prev_status, status):
    """出庫で在庫が発注点を下回った瞬間を知らせるための区分を返す。

    crossed: 今回の出庫で発注点を下回った (補充タイミング)
    empty:   今回の出庫で在庫切れになった
    low:     既に要補充の品目をさらに出庫した
    """
    if mode != "OUT" or status == "ok":
        return None
    if status == "empty" and prev_status != "empty":
        return "empty"
    if prev_status == "ok":
        return "crossed"
    return "low"


def alert_count(db):
    return db.execute(
        "SELECT COUNT(*) FROM items WHERE active = 1 AND stock <= reorder_point"
    ).fetchone()[0]


@app.get("/api/alerts")
def api_alerts():
    """要補充品目の一覧 (ダッシュボード・スキャン画面の自動更新用)。"""
    db = get_db()
    rows = db.execute(
        f"SELECT * FROM items WHERE active = 1 AND stock <= reorder_point ORDER BY {item_order()}"
    ).fetchall()
    return jsonify(count=len(rows), items=[{
        "id": r["id"], "code": r["code"], "name": r["name"], "spec": r["spec"],
        "location": loc(r["location"]), "unit": r["unit"], "stock": r["stock"],
        "reorder_point": r["reorder_point"], "status": item_status(r),
        "ordered": bool(r["ordered_at"]), "reading": r["reading"], "name_id": r["name_id"],
        "buyer_id": r["buyer_id"],
    } for r in rows])


@app.post("/api/void/<int:tx_id>")
def api_void(tx_id):
    db = get_db()
    tx = db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if tx is None:
        return jsonify(ok=False, error=tr("記録が見つかりません")), 404
    if db.in_transaction:
        db.commit()
    # 同時に2回取り消されても在庫を二重に戻さないよう、「未取消なら取消にする」を1つのトランザクションで行う
    db.execute("BEGIN IMMEDIATE")
    try:
        if db.execute("UPDATE transactions SET voided = 1 WHERE id = ? AND voided = 0", (tx_id,)).rowcount == 0:
            db.rollback()
            return jsonify(ok=False, error=tr("既に取り消されています")), 409
        # 在庫から引けなかった分 (short) は戻さない。取り消しで在庫がマイナスになる時は 0 で止める
        delta = {"OUT": tx["qty"] - tx["short"], "IN": -tx["qty"], "ADJ": -(tx["qty"] + tx["short"])}[tx["kind"]]
        cur_stock = db.execute("SELECT stock FROM items WHERE id = ?", (tx["item_id"],)).fetchone()[0]
        delta = max(delta, -max(cur_stock, 0))
        db.execute("UPDATE items SET stock = stock + ? WHERE id = ?", (delta, tx["item_id"]))
        db.commit()
    except Exception:
        db.rollback()
        raise
    item = db.execute("SELECT * FROM items WHERE id = ?", (tx["item_id"],)).fetchone()
    stock_changed(item["id"], item["stock"] - delta, item["stock"], item["reorder_point"])
    return jsonify(ok=True, name=item["name"], name_id=item["name_id"], stock=item["stock"], unit=item["unit"])


@app.get("/api/recent")
def api_recent():
    return jsonify([tx_json(r) for r in recent_transactions(get_db(), 15)])


@app.get("/api/items")
def api_items():
    db = get_db()
    return jsonify([
        {**{k: i[k] for k in ("code", "name", "name_id", "unit", "stock")}, "location": loc(i["location"])}
        for i in active_items(db)
    ])


# ---------------------------------------------------------------- 起動

def get_lan_ip():
    """このPCの社内ネットワーク上のアドレス (例: 10.10.14.210) を調べる。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # 実際には通信しない
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def ensure_certificate():
    """スマホのカメラ用 (https) の証明書を、初回だけ作ってフォルダに保存する。"""
    from werkzeug.serving import make_ssl_devcert
    base = os.path.join(BASE_DIR, "ssl", "server")
    cert, key = base + ".crt", base + ".key"
    if not (os.path.exists(cert) and os.path.exists(key)):
        os.makedirs(os.path.dirname(base), exist_ok=True)
        make_ssl_devcert(base, host="*")
    return cert, key


def start_https_server(host, port):
    """スマホのカメラで読み取れるよう、https でも同時に待ち受ける (失敗しても http は動く)。"""
    try:
        cert, key = ensure_certificate()
        from werkzeug.serving import make_server
        server = make_server(host, port, app, threaded=True, ssl_context=(cert, key))
    except Exception as e:  # cryptography が無い・ポートが使用中など
        print(f"※ スマホ用 (https) の起動に失敗しました: {e}")
        return False
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return True


def backup_loop():
    """起動している間、1日1回 (その日のバックアップが無ければ) 自動でバックアップする。"""
    while True:
        try:
            with app.app_context():
                if not backup.has_backup_for(backup_dir(), datetime.now()):
                    path = do_backup()
                    print(f"  バックアップ: {path}" if path else
                          f"※ バックアップに失敗しました: {get_setting('backup_error')}")
        except Exception as e:  # 失敗してもアプリは止めない
            print(f"※ バックアップに失敗しました: {e}")
        time.sleep(BACKUP_CHECK_SECONDS)


def main():
    parser = argparse.ArgumentParser(description="備品・副資材管理アプリサーバ")
    parser.add_argument("--host", default="0.0.0.0", help="待受アドレス (既定: 全インターフェース)")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--https-port", type=int, default=5443,
                        help="スマホのカメラ用 https のポート (0 で使わない)")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    init_db()
    ip = get_lan_ip()
    print(f"  パソコン・タブレット : http://{ip}:{args.port}/")
    if args.https_port and start_https_server(args.host, args.https_port):
        app.config["HTTPS_PORT"] = args.https_port
        print(f"  スマホ（カメラで読む）: https://{ip}:{args.https_port}/scan")
    app.config["HTTP_PORT"] = args.port
    threading.Thread(target=backup_loop, daemon=True).start()
    app.run(host=args.host, port=args.port, debug=args.debug, use_reloader=False)


with app.app_context():
    init_db()

if __name__ == "__main__":
    main()
