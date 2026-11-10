"""在庫データ (stock.db) の自動バックアップ。

アプリを動かしたまま安全にコピーできるよう、SQLite のバックアップ機能を使う。
バックアップは「stock_年月日_時分.db」の名前で保存し、決めた日数より古いものは消す。

Copyright © 2026. All rights reserved.
"""
import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta

FILE_RE = re.compile(r"stock_([0-9]{8})_([0-9]{4})\.db")
_lock = threading.Lock()  # 自動と「今すぐ」が同時に動いても、1つずつ作る


def backup_files(dest_dir):
    """バックアップファイルの一覧 (新しい順)。[(日時, ファイル名, サイズ), ...]"""
    if not os.path.isdir(dest_dir):
        return []
    result = []
    for name in os.listdir(dest_dir):
        m = FILE_RE.fullmatch(name)
        if not m:
            continue
        try:  # 名前の形が似ているだけの別のファイルは無視する
            when = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M")
            size = os.path.getsize(os.path.join(dest_dir, name))
        except (ValueError, OSError):
            continue
        result.append((when, name, size))
    return sorted(result, reverse=True)


def has_backup_for(dest_dir, day):
    stamp = day.strftime("%Y%m%d")
    return any(name.startswith(f"stock_{stamp}_") for _, name, _ in backup_files(dest_dir))


def run_backup(db_path, dest_dir, keep_days, now=None):
    """バックアップを1つ作り、古いものを消す。作ったファイルのパスを返す。"""
    now = now or datetime.now()
    with _lock:
        os.makedirs(dest_dir, exist_ok=True)
        path = os.path.join(dest_dir, f"stock_{now:%Y%m%d_%H%M}.db")
        tmp = path + ".tmp"
        if os.path.exists(tmp):  # 前回途中で止まった時の残り
            os.remove(tmp)
        src = sqlite3.connect(db_path, timeout=30)
        try:
            dst = sqlite3.connect(tmp)
            try:
                # 少しずつコピーして、その間もスキャンの記録を止めないようにする
                src.backup(dst, pages=256, sleep=0.01)
            finally:
                dst.close()
        except Exception:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
        finally:
            src.close()
        os.replace(tmp, path)  # 途中で止まっても、壊れたファイルが残らないようにする
        prune(dest_dir, keep_days, now)
    return path


def prune(dest_dir, keep_days, now=None):
    """keep_days 日より古いバックアップを消す (最新の1つは必ず残す)。"""
    now = now or datetime.now()
    limit = now - timedelta(days=keep_days)
    files = backup_files(dest_dir)
    for when, name, _ in files[1:]:
        if when < limit:
            try:
                os.remove(os.path.join(dest_dir, name))
            except OSError:
                pass
    # 途中で止まったバックアップの残り (.tmp) も片付ける
    for name in os.listdir(dest_dir):
        full = os.path.join(dest_dir, name)
        if name.startswith("stock_") and name.endswith(".db.tmp"):
            try:
                if datetime.fromtimestamp(os.path.getmtime(full)) < now - timedelta(days=1):
                    os.remove(full)
            except OSError:
                pass
