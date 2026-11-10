import io
import json
import os
import re
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as stock_app  # noqa: E402
import barcodes  # noqa: E402

# ライセンスの確認は専用のテストだけで行う
stock_app.app.config["LICENSE_REQUIRED"] = False


@pytest.fixture
def client():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    stock_app.app.config.update(DATABASE=path, TESTING=True, LICENSE_REQUIRED=False)
    stock_app.init_db()
    with stock_app.app.test_client() as c:
        yield c
    os.remove(path)


def add_item(client, **kw):
    data = {"code": "", "name": "ニトリル手袋", "spec": "M", "location": "A-1",
            "unit": "箱", "stock": "10", "reorder_point": "3", "order_qty": "10"}
    data.update(kw)
    return client.post("/items/new", data=data, follow_redirects=True)


def scan(client, code, mode="OUT", qty=1, user="山田"):
    return client.post("/api/scan", json={"code": code, "mode": mode, "qty": qty, "user": user})


def test_code128_patterns_are_well_formed():
    assert len(barcodes.CODE128_PATTERNS) == 107
    assert len(set(barcodes.CODE128_PATTERNS)) == 107
    for p in barcodes.CODE128_PATTERNS[:106]:
        assert len(p) == 6 and sum(map(int, p)) == 11
    assert sum(map(int, barcodes.CODE128_PATTERNS[106])) == 13


def test_code128_checksum_known_value():
    # START-B(104) + Σ 位置×値 = 879, 879 mod 103 = 55
    assert barcodes.code128_values("PJJ123C")[-2] == 55


def test_svg_generation():
    assert "<svg" in barcodes.qr_svg("SZ0001")
    svg = barcodes.code128_svg("SZ0001")
    assert svg.startswith("<svg") and "<rect" in svg
    with pytest.raises(ValueError):
        barcodes.code128_values("手袋")


def test_out_and_in_flow(client):
    add_item(client)
    res = scan(client, "sz0001")  # 小文字・自動採番コード
    data = res.get_json()
    assert data["ok"] and data["item"]["stock"] == 9 and data["status"] == "ok"

    data = scan(client, "SZ0001", qty=6).get_json()
    assert data["item"]["stock"] == 3 and data["status"] == "low" and data["warning"]

    data = scan(client, "SZ0001", mode="IN", qty=10).get_json()
    assert data["item"]["stock"] == 13 and data["kind_label"] == "入庫(補充)"


def test_unknown_code_and_bad_qty(client):
    add_item(client)
    assert scan(client, "NOPE").status_code == 404
    assert scan(client, "SZ0001", qty=0).status_code == 400
    assert scan(client, "SZ0001", mode="XX").status_code == 400


def test_void_restores_stock(client):
    add_item(client)
    tx = scan(client, "SZ0001", qty=4).get_json()["tx_id"]
    res = client.post(f"/api/void/{tx}").get_json()
    assert res["ok"] and res["stock"] == 10
    assert client.post(f"/api/void/{tx}").status_code == 409


def test_reorder_and_ordered_flag(client):
    add_item(client)
    scan(client, "SZ0001", qty=8)
    page = client.get("/reorder").get_data(as_text=True)
    assert "ニトリル手袋" in page and "発注済にする" in page
    client.post("/items/1/ordered")
    assert "発注済 " in client.get("/reorder").get_data(as_text=True)
    scan(client, "SZ0001", mode="IN", qty=10)  # 入庫で発注済フラグが外れる
    assert "ニトリル手袋" not in client.get("/reorder").get_data(as_text=True)


def test_adjust(client):
    add_item(client)
    client.post("/items/1/adjust", data={"actual": "7"})
    assert scan(client, "SZ0001").get_json()["item"]["stock"] == 6
    csv_text = client.get("/history.csv").get_data(as_text=True)
    assert "棚卸調整" in csv_text and "初期在庫" in csv_text


def test_duplicate_and_invalid_code(client):
    add_item(client, code="TAPE-50")
    page = add_item(client, code="tape-50").get_data(as_text=True)
    assert "既に使われています" in page
    page = add_item(client, code="テープ").get_data(as_text=True)
    assert "半角英数字" in page
    page = add_item(client, code="CMD-OUT").get_data(as_text=True)
    assert "CMD-" in page


def test_csv_import_cp932(client):
    text = "コード,品名,規格,棚番,在庫数,発注点\nGL-01,軍手,フリー,B-2,20,5\n,養生テープ,緑,B-3,8,2\n"
    res = client.post("/items/import", data={"file": (io.BytesIO(text.encode("cp932")), "items.csv")},
                      content_type="multipart/form-data", follow_redirects=True)
    assert "新規 2 件" in res.get_data(as_text=True)
    assert scan(client, "GL-01").get_json()["item"]["stock"] == 19
    assert scan(client, "SZ0001").get_json()["item"]["name"] == "養生テープ"
    # 同じコードを再取込すると更新になる
    text2 = "コード,品名,在庫数\nGL-01,軍手(綿),30\n"
    res = client.post("/items/import", data={"file": (io.BytesIO(text2.encode("utf-8")), "a.csv")},
                      content_type="multipart/form-data", follow_redirects=True)
    assert "更新 1 件" in res.get_data(as_text=True)
    assert scan(client, "GL-01").get_json()["item"]["stock"] == 29


def test_pages_render(client):
    add_item(client)
    scan(client, "SZ0001", qty=2)
    for url in ["/", "/?tv=1", "/scan", "/items", "/items/new", "/items/1/edit", "/reorder",
                "/history", "/history?kind=OUT&item=1", "/labels", "/labels?id=1&type=qr",
                "/labels/commands", "/api/recent", "/api/items", "/items.csv", "/settings",
                "/workers", "/workers/cards", "/stocktake", "/report", "/report.xlsx"]:
        assert client.get(url).status_code == 200, url


def test_delete_keeps_history_and_frees_code(client):
    add_item(client, code="X1")
    scan(client, "X1")
    client.post("/items/1/delete")
    assert scan(client, "X1").status_code == 404
    assert "既に使われています" not in add_item(client, code="X1").get_data(as_text=True)
    assert "ニトリル手袋" in client.get("/history").get_data(as_text=True)


def test_alert_when_crossing_reorder_point(client):
    add_item(client)  # 在庫10 / 発注点3
    r = scan(client, "SZ0001", qty=6).get_json()
    assert r["alert"] is None and r["alert_count"] == 0       # 残り4: まだ適正
    r = scan(client, "SZ0001").get_json()
    assert r["alert"] == "crossed" and r["alert_count"] == 1  # 残り3: 発注点を下回った瞬間
    r = scan(client, "SZ0001").get_json()
    assert r["alert"] == "low"                                # 既に要補充
    r = scan(client, "SZ0001", qty=2).get_json()
    assert r["alert"] == "empty" and r["item"]["stock"] == 0  # 在庫切れ
    r = scan(client, "SZ0001", mode="IN", qty=10).get_json()
    assert r["alert"] is None and r["alert_count"] == 0


def test_alert_crossing_directly_to_empty(client):
    add_item(client, stock="2")
    assert scan(client, "SZ0001", qty=2).get_json()["alert"] == "empty"


def test_api_alerts(client):
    add_item(client)
    add_item(client, name="軍手", stock="1", reorder_point="2")
    data = client.get("/api/alerts").get_json()
    assert data["count"] == 1 and data["items"][0]["name"] == "軍手"
    assert data["items"][0]["status"] == "low"
    client.post("/items/2/ordered")
    assert client.get("/api/alerts").get_json()["items"][0]["ordered"] is True


def test_quick_quantity_settings(client):
    page = client.get("/scan").get_data(as_text=True)
    assert 'data-out="1,2,3,5,10,20"' in page and 'data-in="1,5,10,20,30,50"' in page
    res = client.post("/settings", data={"qty_OUT": ["4", "", "１２", "4", "2"],
                                         "qty_IN": ["100", "25"]}, follow_redirects=True)
    assert "保存しました" in res.get_data(as_text=True)
    page = client.get("/scan").get_data(as_text=True)
    assert 'data-out="2,4,12"' in page and 'data-in="25,100"' in page  # 重複除去・全角数字・並べ替え
    labels = client.get("/labels/commands").get_data(as_text=True)
    assert "CMD-Q12" in labels and "CMD-Q100" in labels and "CMD-Q20" not in labels
    res = client.post("/settings", data={"qty_OUT": ["0", "abc"], "qty_IN": ["5"]})
    assert res.status_code == 400 and "使えません" in res.get_data(as_text=True)
    assert 'data-out="2,4,12"' in client.get("/scan").get_data(as_text=True)  # 失敗時は変わらない
    client.post("/settings", data={"action": "reset"})
    assert 'data-out="1,2,3,5,10,20"' in client.get("/scan").get_data(as_text=True)


def test_scan_quantity_limit(client):
    add_item(client)
    assert scan(client, "SZ0001", qty=9999).status_code == 409
    assert client.post("/api/scan", json={"code": "SZ0001", "qty": 9999, "confirm": True}).status_code == 200
    assert scan(client, "SZ0001", qty=10000).status_code == 400


def test_per_item_quantity(client):
    add_item(client, stock="50", out_qty="2", in_qty="12")
    # 数量を指定しない(=自動)と、品目ごとの「1回の数」で記録される
    r = client.post("/api/scan", json={"code": "SZ0001", "mode": "OUT", "qty": None}).get_json()
    assert r["qty"] == 2 and r["qty_auto"] and r["item"]["stock"] == 48
    r = client.post("/api/scan", json={"code": "SZ0001", "mode": "IN"}).get_json()
    assert r["qty"] == 12 and r["item"]["stock"] == 60
    # 数量を指定した時はそちらが優先
    r = scan(client, "SZ0001", qty=1)
    assert r.get_json()["qty"] == 1 and not r.get_json()["qty_auto"]
    # 不正値は登録できない
    page = add_item(client, name="軍手", out_qty="0").get_data(as_text=True)
    assert "1回にとる数は1〜9999" in page
    # ラベルと品目一覧に表示
    assert "1回 2箱" in client.get("/labels?id=1").get_data(as_text=True)
    assert "2 / 12" in client.get("/items").get_data(as_text=True)


def test_csv_import_keeps_unlisted_columns(client):
    add_item(client, out_qty="3", reorder_point="7")
    text = "コード,品名\nSZ0001,ニトリル手袋(新)\n"
    client.post("/items/import", data={"file": (io.BytesIO(text.encode("utf-8")), "a.csv")},
                content_type="multipart/form-data")
    page = client.get("/items/1/edit").get_data(as_text=True)
    assert "ニトリル手袋(新)" in page
    assert 'name="out_qty" type="number" value="3"' in page
    assert 'name="reorder_point" type="number" value="7"' in page
    text = "コード,1回にとる数,1回にいれる数\nSZ0001,4,24\n"
    client.post("/items/import", data={"file": (io.BytesIO(text.encode("utf-8")), "a.csv")},
                content_type="multipart/form-data")
    r = client.post("/api/scan", json={"code": "SZ0001", "mode": "IN"}).get_json()
    assert r["qty"] == 24


def test_upgrade_old_database():
    import sqlite3
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    with sqlite3.connect(path) as db:  # 以前の版の items 表 (1回の数の列なし)
        db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE,"
                   " name TEXT NOT NULL, spec TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',"
                   " location TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '個',"
                   " stock INTEGER NOT NULL DEFAULT 0, reorder_point INTEGER NOT NULL DEFAULT 0,"
                   " order_qty INTEGER NOT NULL DEFAULT 0, supplier TEXT NOT NULL DEFAULT '',"
                   " note TEXT NOT NULL DEFAULT '', ordered_at TEXT, active INTEGER NOT NULL DEFAULT 1,"
                   " created_at TEXT NOT NULL)")
        db.execute("INSERT INTO items (code, name, stock, created_at) VALUES ('OLD1', '古い品目', 5, '2026-01-01')")
    stock_app.app.config.update(DATABASE=path)
    stock_app.init_db()
    with stock_app.app.test_client() as c:
        r = c.post("/api/scan", json={"code": "OLD1", "mode": "OUT"}).get_json()
        assert r["ok"] and r["qty"] == 1 and r["item"]["stock"] == 4
    os.remove(path)


# ---------------------------------------------------------------- 不具合の再発防止

def test_simultaneous_scans_do_not_lose_counts(client):
    import threading
    add_item(client, stock="500", reorder_point="0")
    errors = []

    def worker():
        c = stock_app.app.test_client()
        for _ in range(10):
            r = c.post("/api/scan", json={"code": "SZ0001", "mode": "OUT", "qty": 1})
            if r.status_code != 200:
                errors.append(r.status_code)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    r = scan(client, "SZ0001", qty=1).get_json()
    assert r["item"]["stock"] == 500 - 80 - 1   # 81回の出庫がすべて反映されている


def test_partial_restock_keeps_ordered_mark(client):
    add_item(client, stock="2", reorder_point="5")
    client.post("/items/1/ordered")
    scan(client, "SZ0001", mode="IN", qty=2)       # 4: まだ発注点以下
    assert scan(client, "SZ0001", mode="IN", qty=0).status_code == 400
    assert client.get("/api/alerts").get_json()["items"][0]["ordered"] is True
    scan(client, "SZ0001", mode="IN", qty=10)      # 14: 発注点を上回った
    assert client.get("/api/alerts").get_json()["count"] == 0
    assert "発注済 " not in client.get("/reorder").get_data(as_text=True)


def test_deleted_item_cannot_be_changed(client):
    add_item(client)
    client.post("/items/1/delete")
    assert client.get("/items/1/edit").status_code == 404
    assert client.post("/items/1/adjust", data={"actual": "3"}).status_code == 404
    assert client.post("/items/1/delete").status_code == 404
    assert client.post("/items/1/ordered").status_code == 404


def test_negative_counts_rejected(client):
    assert "初期在庫は0以上" in add_item(client, stock="-3").get_data(as_text=True)
    add_item(client)
    res = client.post("/items/1/adjust", data={"actual": "-1"}, follow_redirects=True)
    assert "0以上" in res.get_data(as_text=True)
    assert scan(client, "SZ0001", qty=1).get_json()["item"]["stock"] == 9


def test_adjust_sets_exact_count(client):
    add_item(client)
    client.post("/items/1/adjust", data={"actual": "4"})
    assert scan(client, "SZ0001", qty=1).get_json()["item"]["stock"] == 3


def test_redirect_stays_inside_app(client):
    add_item(client)
    res = client.post("/items/1/adjust", data={"actual": "5", "next": "https://evil.example/"})
    assert res.headers["Location"].endswith("/items/1/edit")
    res = client.post("/items/1/ordered", data={"next": "//evil.example"})
    assert res.headers["Location"].endswith("/reorder")
    res = client.post("/items/1/ordered", data={"next": "/items"})
    assert res.headers["Location"].endswith("/items")


def test_bad_scan_requests_do_not_crash(client):
    add_item(client)
    for body in [[1, 2], "text", {"code": 123}, {"code": "SZ0001", "user": 5, "qty": 1},
                 {"code": "SZ0001", "qty": "abc"}, {"code": "SZ0001", "qty": True},
                 {"code": "SZ0001", "qty": 2.5}, {"code": None}, {"code": "SZ0001", "mode": ["OUT"]}]:
        res = client.post("/api/scan", json=body)
        assert res.status_code in (200, 400, 404), (body, res.status_code)
    assert client.post("/api/scan", data="not json").status_code == 404
    assert client.post("/api/scan", json={"code": "SZ0001", "qty": "3"}).get_json()["qty"] == 3


def test_cross_site_post_rejected(client):
    add_item(client)
    res = client.post("/items/1/delete", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    assert client.get("/items/1/edit").status_code == 200   # 消えていない
    res = client.post("/items/1/ordered", headers={"Origin": "http://localhost"})
    assert res.status_code == 302                            # 同じアプリからは通る


def test_csv_export_is_safe_for_excel(client):
    add_item(client, name="=HYPERLINK(\"x\")", spec="@SUM(1)")
    client.post("/items/1/adjust", data={"actual": "4"})
    items_csv = client.get("/items.csv").get_data(as_text=True)
    assert "'=HYPERLINK" in items_csv and "'@SUM" in items_csv
    history_csv = client.get("/history.csv").get_data(as_text=True)
    assert ",-6," in history_csv    # 数値のマイナスはそのまま


def test_csv_import_rejects_negative_new_stock(client):
    text = "品名,在庫数\n軍手,-5\n"
    res = client.post("/items/import", data={"file": (io.BytesIO(text.encode("utf-8")), "a.csv")},
                      content_type="multipart/form-data", follow_redirects=True)
    assert "在庫数は0以上" in res.get_data(as_text=True)


def test_static_files_carry_version(client):
    page = client.get("/scan").get_data(as_text=True)
    assert f"scan.js?v={stock_app.APP_VERSION}" in page
    assert f"style.css?v={stock_app.APP_VERSION}" in page


def test_poster_page(client):
    page = client.get("/poster").get_data(as_text=True)
    assert "備品・副資材の" in page and "USB・Bluetooth" in page
    assert "© 2026" in page.split("<article")[1].split("</article>")[0]   # 手順書に著作権表示
    assert "スマホ" not in page


def test_https_server_for_phones(tmp_path, monkeypatch):
    import socket, ssl, urllib.request
    monkeypatch.setattr(stock_app, "BASE_DIR", str(tmp_path))
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert stock_app.start_https_server("127.0.0.1", port)
    assert (tmp_path / "ssl" / "server.crt").exists()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(f"https://127.0.0.1:{port}/static/vendor/html5-qrcode.min.js", context=ctx) as r:
        assert r.status == 200


# ---------------------------------------------------------------- 追加機能

def test_unusual_quantity_needs_confirmation(client):
    add_item(client, stock="500", reorder_point="0")
    for _ in range(3):
        scan(client, "SZ0001", qty=1)
    r = scan(client, "SZ0001", qty=50)
    data = r.get_json()
    assert r.status_code == 409 and data["need_confirm"] and data["usual"] == 1
    assert client.get("/api/items").get_json()[0]["stock"] == 497  # まだ記録されていない
    r = client.post("/api/scan", json={"code": "SZ0001", "mode": "OUT", "qty": 50, "confirm": True})
    assert r.get_json()["item"]["stock"] == 447
    assert scan(client, "SZ0001", qty=10).status_code == 200      # 10以下は確認しない
    assert client.post("/api/scan", json={"code": "SZ0001", "mode": "OUT"}).status_code == 200  # ラベルの数は確認しない
    client.post("/settings", data={"action": "check", "factor": "0"})
    assert scan(client, "SZ0001", qty=60).status_code == 200      # 「確認しない」にできる


def test_receive_order_qty_is_usual(client):
    # 補充は発注した数がまとめて届くのがふつうなので、発注数くらいの入庫では確認しない
    client.post("/items/new", data={"code": "OQ1", "name": "軍手", "stock": "2", "reorder_point": "3",
                                     "order_qty": "10", "in_qty": "1"})
    r = client.post("/api/scan", json={"code": "OQ1", "mode": "IN", "qty": 20})
    assert r.status_code == 200 and r.get_json()["item"]["stock"] == 22
    r = client.post("/api/scan", json={"code": "OQ1", "mode": "IN", "qty": 200})   # 発注数よりずっと多い時は確かめる
    assert r.status_code == 409 and r.get_json()["usual"] == 20   # 前回の20個がいつもの数


def test_worker_cards(client):
    client.post("/workers", data={"names": "山田\n佐藤"})
    page = client.get("/workers").get_data(as_text=True)
    assert "山田" in page and "CMD-U2" in page
    assert client.get("/api/workers/cmd-u1").get_json()["name"] == "山田"
    cards = client.get("/workers/cards").get_data(as_text=True)
    assert cards.count("worker-card") == 2 and "<svg" in cards
    client.post("/workers/1/delete")
    assert client.get("/api/workers/CMD-U1").status_code == 404
    assert client.get("/api/workers/SZ0001").status_code == 404


def test_stocktake_flow(client):
    add_item(client, stock="10")
    add_item(client, name="軍手", stock="5")
    assert "棚卸しを始める" in client.get("/stocktake").get_data(as_text=True)
    r = client.post("/stocktake/start", follow_redirects=True)
    assert "棚卸し（一覧で入力）" in r.get_data(as_text=True)  # ふつうは一覧で手入力
    r = client.post("/stocktake/start", data={"mode": "scan"}, follow_redirects=True)
    assert "棚卸し中" in r.get_data(as_text=True)
    info = client.get("/api/stocktake/1/item?code=SZ0001").get_json()
    assert info["ok"] and "stock" not in info["item"] and info["counted"] is None
    r = client.post("/api/stocktake/1/count", json={"code": "SZ0001", "counted": 8}).get_json()
    assert r["diff"] == -2 and r["system"] == 10 and r["done"] == 1 and r["total"] == 2
    # 数え直し: ズレは最初の記録上の数との差になる
    r = client.post("/api/stocktake/1/count", json={"code": "SZ0001", "counted": 7}).get_json()
    assert r["diff"] == -3 and r["system"] == 10 and r["recount"] and r["done"] == 1
    assert client.get("/api/items").get_json()[0]["stock"] == 7
    assert client.post("/api/stocktake/1/count", json={"code": "SZ0001", "counted": -1}).status_code == 400
    client.post("/stocktake/1/finish")
    page = client.get("/stocktake/1").get_data(as_text=True)
    assert "棚卸しの結果" in page and "-3" in page and "軍手" in page   # 軍手は数えていない
    assert "記録上の数" in client.get("/stocktake/1.csv").get_data(as_text=True)
    assert "ニトリル手袋" in client.get("/stocktake").get_data(as_text=True)  # 読み忘れが多い品目
    assert client.post("/api/stocktake/1/count", json={"code": "SZ0001", "counted": 7}).status_code == 409


def test_stocktake_same_count_adds_no_history(client):
    add_item(client, stock="10")
    client.post("/stocktake/start")
    r = client.post("/api/stocktake/1/count", json={"code": "SZ0001", "counted": 10}).get_json()
    assert r["diff"] == 0
    assert "棚卸し" not in client.get("/history").get_data(as_text=True).split("<tbody>")[1]


def test_monthly_report(client):
    import zipfile
    add_item(client, stock="50")
    add_item(client, name="=cmd|' /C calc'!A0", stock="5")
    scan(client, "SZ0001", qty=3)
    scan(client, "SZ0001", mode="IN", qty=5)
    page = client.get("/report").get_data(as_text=True)
    assert "月次レポート" in page and "ニトリル手袋" in page
    r = client.get("/report.xlsx")
    assert r.status_code == 200 and r.data[:2] == b"PK"
    with zipfile.ZipFile(io.BytesIO(r.data)) as z:
        names = z.namelist()
        assert any("chart" in n for n in names)
        sheets = "".join(z.read(n).decode() for n in names if n.startswith("xl/worksheets/"))
        assert "<f>" not in sheets   # 品名が数式として書かれていない
    assert client.get("/report?month=2026-13").status_code == 200   # 不正な月は今月にする


def test_reading_used_for_voice(client):
    add_item(client, name="PPバンド", reading="ピーピーバンド", stock="2", reorder_point="3")
    r = scan(client, "SZ0001").get_json()
    assert r["item"]["reading"] == "ピーピーバンド"
    assert client.get("/api/alerts").get_json()["items"][0]["reading"] == "ピーピーバンド"
    assert "読み方" in client.get("/items.csv").get_data(as_text=True)


def test_backup(tmp_path, client):
    from datetime import datetime, timedelta
    import backup
    add_item(client)
    dest = tmp_path / "bk"
    old = datetime.now() - timedelta(days=40)
    p_old = backup.run_backup(stock_app.app.config["DATABASE"], str(dest), 30, now=old)
    p_new = backup.run_backup(stock_app.app.config["DATABASE"], str(dest), 30)
    assert not os.path.exists(p_old) and os.path.exists(p_new)   # 古いものは消える
    import sqlite3
    with sqlite3.connect(p_new) as db:
        assert db.execute("SELECT name FROM items").fetchone()[0] == "ニトリル手袋"
    assert backup.has_backup_for(str(dest), datetime.now())
    # 設定画面から保存先を変えて、今すぐバックアップ
    client.post("/settings", data={"action": "backup", "backup_dir": str(tmp_path / "bk2"), "backup_keep": "7"})
    r = client.post("/settings", data={"action": "backup_now"}, follow_redirects=True)
    assert "バックアップしました" in r.get_data(as_text=True)
    assert len(backup.backup_files(str(tmp_path / "bk2"))) == 1
    r = client.post("/settings", data={"action": "backup", "backup_dir": "x", "backup_keep": "0"}, follow_redirects=True)
    assert "1〜3650" in r.get_data(as_text=True)


def test_stocktake_recount_after_void(client):
    add_item(client, stock="10")
    client.post("/stocktake/start")
    client.post("/api/stocktake/1/count", json={"code": "SZ0001", "counted": 8})
    tx = client.get("/api/recent").get_json()[0]["id"]
    client.post(f"/api/void/{tx}")
    r = client.post("/api/stocktake/1/count", json={"code": "SZ0001", "counted": 8}).get_json()
    assert r["diff"] == -2 and r["system"] == 10


def test_odd_inputs_do_not_crash(tmp_path, client):
    add_item(client)
    for m in ("0000-01", "9999-12", "2026-10\n", "2026-13", "abc"):
        assert client.get("/report", query_string={"month": m}).status_code == 200
        assert client.get("/report.xlsx", query_string={"month": m}).status_code == 200
    client.post("/stocktake/start")
    assert client.post("/api/stocktake/1/count", json={"code": "SZ0001", "counted": "²"}).status_code == 400
    assert scan(client, "SZ0001", qty="²").status_code == 400
    assert client.post("/settings", data={"action": "check", "factor": "²"}).status_code == 302
    assert client.post("/settings", data={"action": "backup", "backup_dir": "x", "backup_keep": "²"}).status_code == 302
    assert client.get("/api/workers/CMD-U" + "9" * 25).status_code == 404
    # バックアップのフォルダに似た名前の別ファイルがあっても動く
    import backup
    (tmp_path / "stock_20261399_9999.db").write_text("x")
    (tmp_path / "stock_20261006_1200.db.tmp").write_text("garbage")
    assert backup.backup_files(str(tmp_path)) == []
    client.post("/settings", data={"action": "backup", "backup_dir": str(tmp_path), "backup_keep": "30"})
    assert client.get("/settings").status_code == 200
    assert backup.run_backup(stock_app.app.config["DATABASE"], str(tmp_path), 30)


def test_copyright_notice(client):
    assert "© 2026 All rights reserved." in client.get("/").get_data(as_text=True)


def test_app_name(client):
    page = client.get("/").get_data(as_text=True)
    assert "備品・副資材管理アプリ" in page and "バーコード・QRで在庫管理" in page


# ---------------------------------------------------------------- ライセンス

def _keypair():
    import base64
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    k = Ed25519PrivateKey.generate()
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return k, base64.b64encode(pub).decode()


@pytest.fixture
def licensed_app(tmp_path):
    import licensing
    key, pub = _keypair()
    cfg = stock_app.app.config
    old = {k: cfg[k] for k in ("LICENSE_REQUIRED", "LICENSE_FILE", "LICENSE_PUBLIC_KEY")}
    cfg.update(LICENSE_REQUIRED=True, LICENSE_FILE=str(tmp_path / "license.key"), LICENSE_PUBLIC_KEY=pub)
    yield key, licensing
    cfg.update(old)


def test_license_required_and_activation(client, licensed_app):
    key, licensing = licensed_app
    r = client.get("/")
    assert r.status_code == 302 and r.headers["Location"].endswith("/license")
    assert client.get("/api/items").status_code == 403
    page = client.get("/license").get_data(as_text=True)
    assert licensing.machine_code() in page
    # 別のPC用のキーは使えない
    other = licensing.make_key(key, "0000-0000-0000-0000", "別PC")
    r = client.post("/license", data={"key": other}, follow_redirects=True)
    assert "別のPC用" in r.get_data(as_text=True)
    # このPC用のキーを貼り付けると使えるようになる (改行が混ざっても可)
    good = licensing.make_key(key, licensing.machine_code(), "○○工場")
    r = client.post("/license", data={"key": good[:40] + "\n" + good[40:]}, follow_redirects=True)
    assert "ライセンスを登録しました" in r.get_data(as_text=True)
    assert client.get("/").status_code == 200 and client.get("/api/items").status_code == 200
    assert "○○工場" in client.get("/license").get_data(as_text=True)


def test_license_forged_or_expired(client, licensed_app):
    key, licensing = licensed_app
    code = licensing.machine_code()
    # 公開鍵が違う (偽の発行者) キー
    fake, _ = _keypair()
    r = client.post("/license", data={"key": licensing.make_key(fake, code)}, follow_redirects=True)
    assert "正しくありません" in r.get_data(as_text=True)
    # 中身を書き換えたキー
    good = licensing.make_key(key, code, "A社", "2099-12-31")
    head, body, sig = good.split(".")
    tampered = ".".join([head, licensing._b64e(licensing._b64d(body).replace(b"A", b"B")), sig])
    with pytest.raises(licensing.LicenseError):
        licensing.check(tampered, code=code, public_key=stock_app.app.config["LICENSE_PUBLIC_KEY"])
    # 期限切れ
    old = licensing.make_key(key, code, "A社", "2020-01-01")
    r = client.post("/license", data={"key": old}, follow_redirects=True)
    assert "期限" in r.get_data(as_text=True)
    # 期限が近いとダッシュボードで知らせる
    from datetime import date, timedelta
    soon = (date.today() + timedelta(days=10)).isoformat()
    client.post("/license", data={"key": licensing.make_key(key, code, "A社", soon)})
    assert "ライセンスの期限まであと" in client.get("/").get_data(as_text=True)


def test_machine_code_format():
    import licensing
    code = licensing.machine_code("abc")
    assert len(code) == 19 and code.count("-") == 3 and code == licensing.machine_code("abc")
    assert licensing.machine_code("abc") != licensing.machine_code("abd")


def test_settings_shows_connect_addresses(client):
    stock_app.app.config["HTTPS_PORT"] = 5443
    try:
        html = client.get("/settings").get_data(as_text=True)
    finally:
        stock_app.app.config.pop("HTTPS_PORT", None)
    assert 'id="connect"' in html
    assert re.search(r"http://[\d.]+:\d+/", html)
    assert re.search(r"https://[\d.]+:5443/scan", html)
    assert html.count("<svg") >= 2  # QR コード


def test_language_switch_to_indonesian(client):
    html = client.get("/").get_data(as_text=True)
    assert "Bahasa Indonesia" in html and "ダッシュボード" in html
    r = client.get("/lang/id", headers={"Referer": "http://localhost/scan"})
    assert r.status_code == 302 and r.headers["Location"].endswith("/scan")
    html = client.get("/").get_data(as_text=True)
    assert 'lang="id"' in html and "Dasbor" in html and "日本語" in html
    client.get("/lang/ja")
    assert "ダッシュボード" in client.get("/").get_data(as_text=True)
    assert client.get("/lang/xx").status_code == 404
    # 別のサイトへは戻さない
    assert client.get("/lang/id?next=http://evil.example/").headers["Location"].endswith("/")
    for bad in ("https:evil.example", "/\\evil.example", "http:\\\\evil.example", "javascript:alert(1)"):
        assert "evil" not in client.get("/lang/id", query_string={"next": bad}).headers["Location"]
    assert client.get("/lang/id", query_string={"next": "/scan?kiosk=1"}).headers["Location"].endswith("/scan?kiosk=1")
    assert "evil" not in client.get("/lang/id", headers={"Referer": "http://evil.example/x"}).headers["Location"]


def test_item_indonesian_name(client):
    client.post("/items/new", data={"code": "IDN1", "name": "軍手", "name_id": "Sarung tangan kain", "unit": "双",
                                    "stock": "5", "reorder_point": "1", "order_qty": "1"})
    client.get("/lang/id")
    r = client.post("/api/scan", json={"code": "IDN1", "mode": "OUT", "qty": 1})
    data = r.get_json()
    assert data["item"]["name_id"] == "Sarung tangan kain"
    assert "Sarung tangan kain" in client.get("/").get_data(as_text=True)


def test_api_error_message_language(client):
    r = client.post("/api/scan", json={"code": "NOPE-404", "mode": "OUT"})
    assert r.status_code == 404 and r.get_json()["error"] == "未登録のコードです: NOPE-404"
    client.set_cookie("lang", "id")
    r = client.post("/api/scan", json={"code": "NOPE-404", "mode": "OUT"})
    assert r.status_code == 404 and r.get_json()["error"] == "Kode belum terdaftar: NOPE-404"
    assert client.post("/api/scan", json={"code": "X", "mode": "BAD"}).get_json()["error"] == "Mode tidak valid"


def test_validation_error_language(client):
    client.set_cookie("lang", "id")
    html = client.post("/items/new", data={"code": "", "name": "", "stock": "abc"}).get_data(as_text=True)
    assert "Nama barang wajib diisi" in html and "Stok harus berupa angka bulat" in html
    client.set_cookie("lang", "ja")
    html = client.post("/items/new", data={"code": "", "name": "", "stock": "abc"}).get_data(as_text=True)
    assert "品名は必須です" in html and "在庫数は整数で入力してください" in html


def test_items_list_has_edit_and_delete_buttons(client):
    client.post("/items/new", data={"code": "ED1", "name": "テスト品", "stock": "1"})
    html = client.get("/items").get_data(as_text=True)
    assert "/edit" in html and 'form="del-' in html and "/delete" in html
    m = re.search(r'action="(/items/(\d+)/delete)"', html)
    r = client.post(m.group(1), headers={"Origin": "http://localhost"})
    assert r.status_code == 302
    assert ">テスト品</a>" not in client.get("/items").get_data(as_text=True)


def test_void_twice_restores_stock_once(client):
    client.post("/items/new", data={"code": "VD1", "name": "二重取消", "stock": "10"})
    tx = client.post("/api/scan", json={"code": "VD1", "mode": "OUT", "qty": 3}).get_json()
    tx_id = tx["tx"]["id"] if "tx" in tx else tx["tx_id"]
    assert client.post(f"/api/void/{tx_id}").get_json()["stock"] == 10
    r = client.post(f"/api/void/{tx_id}")
    assert r.status_code == 409
    item = client.post("/api/scan", json={"code": "VD1", "mode": "OUT", "qty": 1}).get_json()["item"]
    assert item["stock"] == 9


def test_post_with_null_origin_is_rejected(client):
    client.post("/items/new", data={"code": "NO1", "name": "null元", "stock": "1"})
    assert client.post("/settings", data={"action": "reset"}, headers={"Origin": "null"}).status_code == 403


def test_folder_picker_api(client, tmp_path):
    (tmp_path / "sub1").mkdir()
    (tmp_path / "file.txt").write_text("x")
    top = client.get("/api/folders").get_json()
    assert top["ok"] and top["places"] and top["path"] == ""
    r = client.get("/api/folders", query_string={"path": str(tmp_path)}).get_json()
    assert r["dirs"] == ["sub1"] and r["parent"] == str(tmp_path.parent)
    assert client.get("/api/folders", query_string={"path": str(tmp_path / "nope")}).status_code == 404
    r = client.post("/api/folders/new", json={"path": str(tmp_path), "name": "在庫バックアップ"}).get_json()
    assert r["ok"] and (tmp_path / "在庫バックアップ").is_dir()
    assert client.post("/api/folders/new", json={"path": str(tmp_path), "name": "../x"}).status_code == 400
    html = client.get("/settings").get_data(as_text=True)
    assert 'id="folder-pick"' in html and "folder_picker.js" in html


def test_label_copies(client):
    client.post("/items/new", data={"code": "LB1", "name": "ラベル品A", "stock": "1"})
    client.post("/items/new", data={"code": "LB2", "name": "ラベル品B", "stock": "1"})
    html = client.get("/labels?copies=3").get_data(as_text=True)
    assert html.count('class="label"') == 6 and html.count(">LB1<") == 3
    assert client.get("/labels?copies=999").get_data(as_text=True).count('class="label"') == 100
    assert client.get("/labels?copies=abc").get_data(as_text=True).count('class="label"') == 2


def test_quantity_labels(client):
    client.post("/items/new", data={"code": "QL1", "name": "数量ラベル品", "stock": "100", "out_qty": "2"})
    html = client.get("/labels?qtys=1,5").get_data(as_text=True)
    assert ">QL1.Q1<" in html and ">QL1.Q5<" in html
    # 数量入りのラベルを読むと、その数で記録される (確認なし)
    d = client.post("/api/scan", json={"code": "QL1.Q5", "mode": "OUT"}).get_json()
    assert d["ok"] and d["qty"] == 5 and d["qty_auto"] and d["item"]["stock"] == 95
    d = client.post("/api/scan", json={"code": "ql1．q1", "mode": "IN"}).get_json()
    assert d["qty"] == 1 and d["item"]["stock"] == 96
    # ふつうのラベルは品目の「1回の数」
    assert client.post("/api/scan", json={"code": "QL1", "mode": "OUT"}).get_json()["qty"] == 2
    # 数量ボタンで選んだ数が優先
    assert client.post("/api/scan", json={"code": "QL1.Q5", "mode": "OUT", "qty": 1}).get_json()["qty"] == 1
    # 範囲外の数はコードとして扱わない
    assert client.post("/api/scan", json={"code": "QL1.Q0", "mode": "OUT"}).status_code == 404
    # 棚卸しでは数量の部分を無視して品目を探す
    r = client.post("/stocktake/start", data={"mode": "scan"})
    st_id = int(r.headers["Location"].rstrip("/").split("/")[-1])
    d = client.get(f"/api/stocktake/{st_id}/item", query_string={"code": "QL1.Q5"}).get_json()
    assert d["ok"] and d["item"]["code"] == "QL1"


def test_stocktake_list_entry(client):
    client.post("/items/new", data={"code": "SL1", "name": "一覧棚卸A", "stock": "10", "location": "A-1"})
    client.post("/items/new", data={"code": "SL2", "name": "一覧棚卸B", "stock": "4", "location": "A-2"})
    r = client.post("/stocktake/start", data={"mode": "list"})
    assert "/list" in r.headers["Location"]
    st_id = int(r.headers["Location"].split("/")[-2])
    html = client.get(f"/stocktake/{st_id}/list").get_data(as_text=True)
    assert 'data-code="SL1" data-system="10"' in html and 'data-code="SL2" data-system="4"' in html
    d = client.post(f"/api/stocktake/{st_id}/count", json={"code": "SL1", "counted": 8}).get_json()
    assert d["diff"] == -2
    html = client.get(f"/stocktake/{st_id}/list").get_data(as_text=True)
    # 数えたあとも「今の在庫」は数える前の記録 (10) を出す
    assert 'data-code="SL1" data-system="10"' in html and 'value="8"' in html
    d = client.get(f"/api/stocktake/{st_id}/item", query_string={"code": "SL2"}).get_json()
    assert d["system"] == 4


def test_stocktake_list_after_void(client):
    """棚卸しの調整を取り消したあとも、一覧の「今の在庫」はスキャン画面と同じ数を出す。"""
    client.post("/items/new", data={"code": "SV1", "name": "取消棚卸", "stock": "10"})
    r = client.post("/stocktake/start", data={"mode": "list"})
    st_id = int(r.headers["Location"].split("/")[-2])
    client.post(f"/api/stocktake/{st_id}/count", json={"code": "SV1", "counted": 8})
    tx = client.get("/api/recent").get_json()[0]
    assert tx["kind"] == "ADJ"
    assert client.post(f"/api/void/{tx['id']}").get_json()["ok"]
    html = client.get(f"/stocktake/{st_id}/list").get_data(as_text=True)
    assert 'data-code="SV1" data-system="10"' in html
    assert client.get(f"/api/stocktake/{st_id}/item", query_string={"code": "SV1"}).get_json()["system"] == 10


def test_site_name_and_sites_page(client, monkeypatch):
    r = client.post("/settings", data={"action": "site", "site_name": "第1工場",
                                       "site_urls": "192.168.1.21\nhttp://192.168.1.22:5000/\nhttp://bad host/"})
    assert r.status_code == 400
    assert "http://bad host/" in r.get_data(as_text=True)  # 入力した内容は消さずに見せる
    assert "第1工場" not in client.get("/").get_data(as_text=True)  # 形の悪い行があれば保存しない
    client.post("/settings", data={"action": "site", "site_name": "第1工場",
                                   "site_urls": "192.168.1.21\nhttp://192.168.1.22:5000/\n192.168.1.21:5000"})
    html = client.get("/").get_data(as_text=True)
    assert "第1工場" in html and "/sites" in html
    page = client.get("/sites").get_data(as_text=True)
    assert "http://192.168.1.21:5000/" in page and "http://192.168.1.22:5000/" in page
    assert page.count("192.168.1.21:5000") == 1
    client.post("/items/new", data={"code": "SM1", "name": "まとめ品", "stock": "0", "reorder_point": "2"})
    r = client.get("/api/summary")
    d = r.get_json()
    assert r.headers["Access-Control-Allow-Origin"] == "*"
    brief = client.get("/api/summary?brief=1").get_json()
    assert brief["id"] == d["id"] and brief["counts"]["total"] == 1 and "items" not in brief
    assert d["site"] == "第1工場" and d["counts"]["empty"] == 1 and d["items"][0]["code"] == "SM1"
    assert d["id"] and d["id"] == client.get("/api/summary").get_json()["id"]  # 現場の番号は変わらない
    monkeypatch.setattr(stock_app, "_this_pc", ["OTHER-PC"])  # stock.db を別のPCにコピーした
    assert client.get("/api/summary").get_json()["id"] != d["id"]
    assert d["sites"] == ["http://192.168.1.21:5000/", "http://192.168.1.22:5000/"]
    r = client.get("/report.xlsx")
    assert "filename*=UTF-8''" in r.headers["Content-Disposition"]
    client.post("/settings", data={"action": "site", "site_name": "A/B", "site_urls": ""})
    assert "/" not in client.get("/report.xlsx").headers["Content-Disposition"].split("filename*=UTF-8''")[1]


def test_site_scan_finds_other_sites(client, monkeypatch):
    found = {"http://10.0.0.5:5000/": {"ok": True, "id": "abc123", "site": "第2工場", "counts": {"total": 7}}}

    class FakeResp:
        def __init__(self, body): self.body = body
        def read(self, n=-1): return self.body
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(url, timeout=0):
        assert url.endswith("api/summary?brief=1")
        base = url[: -len("api/summary?brief=1")]
        if base in found:
            return FakeResp(json.dumps(found[base]).encode())
        raise OSError("no")

    monkeypatch.setattr(stock_app, "scan_candidates", lambda port: ["http://10.0.0.4:5000/", "http://10.0.0.5:5000/"])
    monkeypatch.setattr(stock_app.LAN_OPENER, "open", fake_urlopen)
    d = client.post("/api/sites/scan").get_json()
    assert d["ok"] and [f["site"] for f in d["found"]] == ["第2工場"] and d["found"][0]["total"] == 7
    assert not d["found"][0]["registered"]
    html = client.get("/settings").get_data(as_text=True)
    assert 'id="site-scan"' in html and "site_setup.js" in html


def test_receive_without_scan(client):
    client.post("/items/new", data={"code": "RC1", "name": "事務所補充品", "stock": "1", "reorder_point": "3", "order_qty": "10"})
    html = client.get("/reorder").get_data(as_text=True)
    assert "/items/1/receive" in html and 'value="10"' in html
    r = client.post("/items/1/receive", data={"qty": "１０", "next": "/reorder"})
    assert r.status_code == 302 and r.headers["Location"].endswith("/reorder")
    d = client.post("/api/scan", json={"code": "RC1", "mode": "OUT", "qty": 1}).get_json()
    assert d["item"]["stock"] == 10  # 1 + 10 - 1
    hist = client.get("/history").get_data(as_text=True)
    assert "事務所" in hist  # 担当者が空なら「事務所」
    for bad in ("0", "abc", "99999"):
        client.post("/items/1/receive", data={"qty": bad})
    assert client.post("/api/scan", json={"code": "RC1", "mode": "OUT", "qty": 1}).get_json()["item"]["stock"] == 9
    assert "/items/1/receive" in client.get("/items/1/edit").get_data(as_text=True)


def test_buyers_and_mail_notice(client, monkeypatch):
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=0): self.host, self.port = host, port
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): pass
        def login(self, u, p): pass
        def send_message(self, msg): sent.append(msg)

    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    client.post("/buyers", data={"action": "add", "name": "Aさん", "email": "a@example.com"})
    client.post("/buyers", data={"action": "add", "name": "Bさん", "email": "bad-address"})  # 形が違うので登録しない
    client.post("/buyers", data={"action": "add", "name": "Bさん", "email": "b@example.com"})
    html = client.get("/buyers").get_data(as_text=True)
    assert "Aさん" in html and "b@example.com" in html and 'value="bad-address"' not in html
    client.post("/buyers/mail", data={"mail_host": "smtp.example.com", "mail_port": "587", "mail_security": "starttls",
                                      "mail_user": "u", "mail_password": "p", "mail_from": "stock@example.com"})
    client.post("/items/new", data={"code": "NT1", "name": "軍手", "stock": "6", "reorder_point": "5", "buyer_id": "1"})
    client.post("/items/new", data={"code": "NT2", "name": "マスク", "stock": "6", "reorder_point": "5"})
    # まとめて担当者を決める
    client.post("/items/buyer", data={"id": ["2"], "buyer_id": "2"})
    assert 'value="2" selected' in client.get("/items/2/edit").get_data(as_text=True)
    # 発注点を下回った時だけ、その品目の担当者に送る
    client.post("/api/scan", json={"code": "NT1", "mode": "OUT", "qty": 1})   # 6 → 5 (下回った)
    client.post("/api/scan", json={"code": "NT1", "mode": "OUT", "qty": 1})   # 5 → 4 (もう下回っている)
    client.post("/api/scan", json={"code": "NT2", "mode": "OUT", "qty": 6})   # 6 → 0 (在庫切れ)
    assert [m["To"] for m in sent] == ["a@example.com", "b@example.com"]
    assert "在庫切れ" in str(sent[1]["Subject"]) or "=?utf-8?" in str(sent[1]["Subject"])
    assert "軍手" in sent[0].get_payload(decode=True).decode("utf-8")
    assert "送信済" in client.get("/buyers").get_data(as_text=True)
    # 補充リストに担当者が出る
    page = client.get("/reorder").get_data(as_text=True)
    assert 'data-buyer="1"' in page and 'data-buyer="2"' in page and "reorder_watch.js" in page
    # 担当者を消すと、品目の担当は「なし」に
    client.post("/buyers", data={"action": "delete", "id": "1"})
    assert 'data-buyer="none"' in client.get("/reorder").get_data(as_text=True)


def test_teams_notice(client, monkeypatch):
    import json as _json
    import urllib.request
    posted = []

    class Resp:
        status = 202
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(req, timeout=0):
        posted.append((req.full_url, _json.loads(req.data.decode("utf-8"))))
        return Resp()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    # http や形の違う URL は保存しない
    client.post("/buyers/teams", data={"teams_url": "http://example.com/x", "action": "save"})
    assert 'value="http://example.com/x"' not in client.get("/buyers").get_data(as_text=True)
    url = "https://prod-01.japaneast.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x"
    client.post("/buyers/teams", data={"teams_url": url, "action": "test"})
    assert len(posted) == 1 and posted[0][0] == url
    card = posted[0][1]["attachments"][0]
    assert card["contentType"] == "application/vnd.microsoft.card.adaptive"
    client.post("/buyers", data={"action": "add", "name": "Aさん"})  # メールなしの担当者
    client.post("/items/new", data={"code": "TM1", "name": "軍手", "stock": "6", "reorder_point": "5", "buyer_id": "1"})
    client.post("/items/new", data={"code": "TM2", "name": "マスク", "stock": "2", "reorder_point": "1"})
    client.post("/api/scan", json={"code": "TM1", "mode": "OUT", "qty": 1})   # 下回った → 送る
    client.post("/api/scan", json={"code": "TM1", "mode": "OUT", "qty": 1})   # もう下回っている → 送らない
    client.post("/api/scan", json={"code": "TM2", "mode": "OUT", "qty": 2})   # 担当者なしでも在庫切れは送る
    assert len(posted) == 3
    text = _json.dumps(posted[1][1], ensure_ascii=False)
    assert "軍手" in text and "Aさん" in text and "/reorder" in text
    assert "在庫切れ" in _json.dumps(posted[2][1], ensure_ascii=False)
    html = client.get("/buyers").get_data(as_text=True)
    assert "Teams" in html and "送信済" in html
    # 欄を空にすると止まる
    client.post("/buyers/teams", data={"teams_url": "", "action": "save"})
    client.post("/api/scan", json={"code": "TM1", "mode": "IN", "qty": 10})
    client.post("/api/scan", json={"code": "TM1", "mode": "OUT", "qty": 10})
    assert len(posted) == 3


def test_honorific_not_doubled():
    import app as A
    assert A.honorific("Aさん") == "Aさん" and A.honorific("山田") == "山田 さん" and A.honorific("佐藤様") == "佐藤様"
    assert A.bare_name("Aさん") == "A" and A.bare_name("さん") == "さん" and A.bare_name("山田") == "山田"


def test_location_optional_and_can_be_turned_off(client):
    # 棚番なしでも登録できる
    client.post("/items/new", data={"code": "NL1", "name": "軍手", "stock": "6", "reorder_point": "5"})
    client.post("/items/new", data={"code": "NL2", "name": "テープ", "location": "B-9", "stock": "6", "reorder_point": "5"})
    assert "NL1" in client.get("/items").get_data(as_text=True)
    assert "B-9" in client.get("/items").get_data(as_text=True)
    # 使わない設定にすると、画面・API・ラベルから消える (値は残る)
    client.post("/settings", data={"action": "location", "use_location": "0"})
    for url in ("/items", "/labels", "/items/2/edit", "/history", "/"):
        html = client.get(url).get_data(as_text=True)
        assert "B-9" not in html or 'type="hidden" name="location" value="B-9"' in html, url
    assert client.post("/api/scan", json={"code": "NL2", "mode": "OUT", "qty": 1}).get_json()["item"]["location"] == ""
    # 編集して保存しても、棚番は消えない
    client.post("/items/2/edit", data={"code": "NL2", "name": "テープ", "location": "B-9", "reorder_point": "5"})
    client.post("/settings", data={"action": "location", "use_location": "1"})
    assert "B-9" in client.get("/items").get_data(as_text=True)


def test_report_without_location_column(client):
    import io
    import openpyxl
    import app as A
    client.post("/items/new", data={"code": "RL1", "name": "軍手", "location": "A-1", "stock": "9", "reorder_point": "5"})
    client.post("/settings", data={"action": "location", "use_location": "0"})
    wb = openpyxl.load_workbook(io.BytesIO(client.get(f"/report.xlsx?month={A.now_str()[:7]}").data))
    assert "棚番" not in [c.value for c in wb["品目別"][1]]


def test_scan_voice_options_for_no_display_sites(client):
    html = client.get("/scan").get_data(as_text=True)
    assert 'id="opt-voice-error"' in html and 'id="opt-voice-ops"' in html
    # 最初はオフ (チェックなし)
    assert 'id="opt-voice-error" checked' not in html and 'id="opt-voice-ops" checked' not in html


def test_stock_never_negative(client):
    import app as A
    client.post("/items/new", data={"code": "NG1", "name": "軍手", "stock": "2", "reorder_point": "1"})
    r = client.post("/api/scan", json={"code": "NG1", "mode": "OUT", "qty": 5}).get_json()
    assert r["ok"] and r["item"]["stock"] == 0 and r["short"] == 3 and "0にしました" in r["warning"]
    # 取り消すと、もとの在庫 (2) に戻る (5 には増えない)
    v = client.post(f"/api/void/{r['tx_id']}").get_json()
    assert v["ok"] and v["stock"] == 2
    # 補充を取り消しても、マイナスにはならない
    r1 = client.post("/api/scan", json={"code": "NG1", "mode": "IN", "qty": 10}).get_json()
    client.post("/api/scan", json={"code": "NG1", "mode": "OUT", "qty": 11, "confirm": True})
    v2 = client.post(f"/api/void/{r1['tx_id']}").get_json()
    assert v2["ok"] and v2["stock"] == 0
    assert "記録上の在庫より多く取ったため0に" in client.get("/history").get_data(as_text=True)
    # 在庫を減らす調整も 0 で止まり、取り消すと実際に減らした分だけ戻る
    with A.app.app_context():
        db = A.get_db(); item = db.execute("SELECT * FROM items WHERE code = 'NG1'").fetchone()
        A.record(db, item, "IN", 3)
        tx_id, before, after = A.record(db, item, "ADJ", -7)
        assert (before, after) == (3, 0)
    v3 = client.post(f"/api/void/{tx_id}").get_json()
    assert v3["ok"] and v3["stock"] == 3
    # 以前の版でマイナスになっていた在庫は、起動時に 0 に直す
    with A.app.app_context():
        db = A.get_db(); db.execute("UPDATE items SET stock = -4 WHERE code = 'NG1'"); db.commit()
    A.init_db()
    with A.app.app_context():
        assert A.get_db().execute("SELECT stock FROM items WHERE code = 'NG1'").fetchone()[0] == 0


def test_receive_page(client):
    client.post("/items/new", data={"code": "RC1", "name": "軍手", "stock": "2", "reorder_point": "5"})
    page = client.get("/receive").get_data(as_text=True)
    assert 'data-code="RC1"' in page and "receive.js" in page and "要補充" in page
    assert 'href="/receive"' in client.get("/").get_data(as_text=True)   # 上のメニューから開ける
    r = client.post("/api/scan", json={"code": "RC1", "mode": "IN", "qty": 10, "user": "事務所"}).get_json()
    assert r["ok"] and r["item"]["stock"] == 12 and r["status"] == "ok"


def test_site_remember_and_relocate(client, monkeypatch):
    import app as A
    old, new = "http://192.168.1.21:5000/", "http://192.168.1.57:5000/"
    # 保存時: つながらない現場は知らせる (登録はする)
    monkeypatch.setattr(A, "probe_site", lambda url, timeout=0: None)
    page = client.post("/settings", data={"action": "site", "site_name": "事務所", "site_urls": "192.168.1.21"},
                       follow_redirects=True).get_data(as_text=True)
    assert "今つながらない現場があります" in page
    with A.app.app_context():
        assert A.other_sites() == [old] and A.site_ids() == {}
    # 全現場の画面で読めた現場の番号を覚える (登録していないアドレス・おかしな番号は覚えない)
    assert client.post("/api/sites/remember", json={"url": old, "id": "abc123def456"}).get_json()["ok"]
    assert client.post("/api/sites/remember", json={"url": new, "id": "abc123def456"}).status_code == 400
    assert client.post("/api/sites/remember", json={"url": old, "id": "<script>"}).status_code == 400
    # アドレスが変わった現場を、同じ番号で探し直して登録し直す
    monkeypatch.setattr(A, "scan_candidates", lambda port: [new, "http://192.168.1.60:5000/"])
    monkeypatch.setattr(A, "probe_site", lambda url, timeout=0: {"url": url, "id": "abc123def456" if url == new else "zzz999zzz999",
                                                                 "site": "第1工場", "total": 3})
    r = client.post("/api/sites/relocate", json={"url": old}).get_json()
    assert r["found"] and r["url"] == new and r["site"] == "第1工場"
    with A.app.app_context():
        assert A.other_sites() == [new] and A.site_ids() == {new: "abc123def456"}
    # 番号を知らない現場は探さない
    assert client.post("/api/sites/relocate", json={"url": "http://192.168.1.99:5000/"}).get_json()["found"] is False


def test_help_page(client):
    import help_data
    page = client.get("/help").get_data(as_text=True)
    assert "ヘルプ（使い方を質問する）" in page and "help.js" in page
    assert page.count('class="help-item"') == len(help_data.HELP)
    assert 'href="/receive"' in page and 'href="/settings#backup"' in page   # 答えから画面を開ける
    assert 'href="/help"' in client.get("/").get_data(as_text=True)          # 上のヘルプから開ける
    # インドネシア語の画面では、インドネシア語の質問と答え
    page_id = client.get("/help?lang=id").get_data(as_text=True)
    assert "Bagaimana mencatat barang yang diterima di kantor?" in page_id
    # 全部の質問に、日本語とインドネシア語の質問・言いかえ・答えがある
    for h in help_data.HELP:
        assert {c for c, _ in help_data.CATS} >= {h["cat"]}
        for k in ("q", "kw", "a"):
            assert h[k]["ja"] and h[k]["id"], h["q"]["ja"]
        assert len(h["a"]["ja"]) == len(h["a"]["id"]), h["q"]["ja"]


def test_help_without_license(client, licensed_app):
    # ライセンスキーが無いPCでも、ヘルプ（キーの登録のしかた）は開ける。ほかの画面はライセンス画面へ
    assert client.get("/items").status_code == 302
    page = client.get("/help")
    assert page.status_code == 200 and "ライセンスキーの登録" in page.get_data(as_text=True)


def test_items_excel_import_export(client):
    import io
    import item_sheet
    import xlsxwriter
    # ひな形は空の「品目」シート + 記入例 + 説明。取り込む行は無い
    t = client.get("/items/template.xlsx")
    assert t.status_code == 200 and t.data[:2] == b"PK" and item_sheet.read_rows(t.data) == []
    # Excel で入れたファイルを、そのまま取り込める (数は 10.0 のような形でも整数として読む)
    labels = [label for _, label in stock_app.ITEM_FIELDS]
    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf)
    ws = wb.add_worksheet("品目")
    ws.write_row(0, 0, labels)
    ws.write_row(1, 0, ["", "ニトリル手袋", "", "", "Mサイズ", "手袋", "A-1-1", "箱", 850, 12, 5, 10.0, 1, 1, "○○商事", ""])
    ws.write_row(3, 0, ["", "", "", "", "", "", "", "", "", 3])     # 品名なし (Excel の4行目)
    wb.close()
    page = client.post("/items/import", data={"file": (io.BytesIO(buf.getvalue()), "items.xlsx")},
                       follow_redirects=True).get_data(as_text=True)
    assert "新規 1 件" in page and "4行目: 品名は必須です" in page
    item = client.get("/api/items").get_json()[0]
    assert item["name"] == "ニトリル手袋" and item["stock"] == 12
    # 出した Excel を直して取り込むと、同じコードの品目を更新する
    rows = item_sheet.read_rows(client.get("/items.xlsx").data)
    assert rows[0]["品名"] == "ニトリル手袋" and rows[0]["在庫数"] == "12"
    # 壊れたファイル・見出しの無いファイルは、理由を出して取り込まない
    page = client.post("/items/import", data={"file": (io.BytesIO(b"PK\x03\x04broken"), "x.xlsx")},
                       follow_redirects=True).get_data(as_text=True)
    assert "Excel を読み込めませんでした" in page
    page = client.post("/items/import", data={"file": (io.BytesIO("軍手,5\n手袋,3\n".encode()), "x.csv")},
                       follow_redirects=True).get_data(as_text=True)
    assert "見出しの行が見つかりません" in page


def test_items_excel_real_world_files(client):
    # 日本語の Excel が保存する読み（ふりがな）を品名に混ぜない・Strict 形式も読む・古い .xls は理由を出す
    import io
    import item_sheet
    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("data_furigana.xlsx", "data_strict.xlsx"):
        raw = open(os.path.join(here, name), "rb").read()
        assert [r["品名"] for r in item_sheet.read_rows(raw)] == ["軍手", "養生テープ", "マスク"], name
    raw = open(os.path.join(here, "data_furigana.xlsx"), "rb").read()
    client.post("/items/import", data={"file": (io.BytesIO(raw), "a.xlsx")})
    assert sorted(i["name"] for i in client.get("/api/items").get_json()) == sorted(["軍手", "養生テープ", "マスク"])
    old = bytes.fromhex("d0cf11e0a1b11ae1") + b"\0" * 100
    page = client.post("/items/import", data={"file": (io.BytesIO(old), "a.xls")}, follow_redirects=True).get_data(as_text=True)
    assert "古い形式の Excel" in page
    # 空白だけの行は、空の行として飛ばす (「品名は必須」にしない)
    page = client.post("/items/import", data={"file": (io.BytesIO("品名,規格\n手袋,M\n , \n".encode()), "a.csv")},
                       follow_redirects=True).get_data(as_text=True)
    assert "新規 1 件" in page and "品名は必須" not in page


def test_site_prefix_codes(client):
    # 拠点コードを決める前の品目は SZ0001
    client.post("/items/new", data={"name": "軍手", "stock": "5"})
    assert client.get("/api/items").get_json()[0]["code"] == "SZ0001"
    # 拠点コードを決めると、新しい品目は A0001 から。全角・小文字でも入れられる
    client.post("/settings", data={"action": "site", "site_name": "A課", "site_prefix": "ａ", "site_urls": ""})
    client.post("/items/new", data={"name": "マスク", "stock": "3"})
    codes = sorted(i["code"] for i in client.get("/api/items").get_json())
    assert codes == ["A0001", "SZ0001"]
    assert client.get("/api/summary").get_json()["prefix"] == "A"
    # ほかの拠点のラベル (B0003) を読むと、そう伝える。この拠点の形の未登録コードは、ふつうの「未登録」
    r = client.post("/api/scan", json={"code": "B0003", "mode": "OUT"}).get_json()
    assert "ほかの拠点のラベル" in r["error"] and r["other_site"] is True
    assert "未登録のコード" in client.post("/api/scan", json={"code": "A0999", "mode": "OUT"}).get_json()["error"]
    # この拠点の形 (5桁になった A10000 も)・拠点コードを決める前の形 (SZ…) は、ふつうの「未登録」
    for own in ("A10000", "A00012", "SZ0099"):
        assert "未登録のコード" in client.post("/api/scan", json={"code": own, "mode": "OUT"}).get_json()["error"], own
    # 決める前のコードは、拠点コード付きに付け替えられる (記録はそのまま)
    page = client.get("/settings").get_data(as_text=True)
    assert "1 件" in page and "「A」付きに変える" in page
    client.post("/settings", data={"action": "recode"})
    items = {i["name"]: i["code"] for i in client.get("/api/items").get_json()}
    # 軍手の SZ0001 は、A0001 がもうある (マスク) ので、空いている A0002 に。記録は品目についたまま
    assert items == {"マスク": "A0001", "軍手": "A0002"}
    assert "軍手" in client.get("/history").get_data(as_text=True)
    assert "「A」付きに変える" not in client.get("/settings").get_data(as_text=True)  # もう付け替えるものは無い
    # 数字で終わる拠点コードは「-」で区切る。使えない文字は止める
    client.post("/settings", data={"action": "site", "site_name": "", "site_prefix": "TK1", "site_urls": ""})
    client.post("/items/new", data={"name": "テープ"})
    assert "TK1-0001" in [i["code"] for i in client.get("/api/items").get_json()]
    for bad in ("1A", "ABCDE", "CMD", "A-B"):
        r = client.post("/settings", data={"action": "site", "site_name": "", "site_prefix": bad, "site_urls": ""})
        assert r.status_code == 400, bad


# ---------------------------------------------------------------- フォルダ・金額・棚卸しの期間

def item_by_name(name):
    import sqlite3
    db = sqlite3.connect(stock_app.app.config["DATABASE"])
    db.row_factory = sqlite3.Row
    try:
        return db.execute("SELECT * FROM items WHERE name = ? AND active = 1", (name,)).fetchone()
    finally:
        db.close()


def test_folder_paths_are_normalized():
    n = stock_app.norm_category
    assert n(" 清掃 ／ ゴミ袋 ") == "清掃/ゴミ袋"
    assert n("清掃\\ゴミ袋") == n("清掃¥ゴミ袋") == "清掃/ゴミ袋"
    assert n("//清掃//") == "清掃" and n("") == ""
    assert stock_app.in_folder("清掃/ゴミ袋", "清掃") and not stock_app.in_folder("清掃用品", "清掃")


def test_folders_create_rename_move_delete(client):
    add_item(client, name="ゴミ袋", category="清掃/ゴミ袋", price="165")
    add_item(client, name="洗剤", category="清掃")
    add_item(client, name="軍手", category="手袋")
    page = client.get("/items").get_data(as_text=True)
    assert "清掃" in page and "ゴミ袋" in page and "手袋" in page
    # フォルダを開くと、中のフォルダの品目も出る。ほかのフォルダの品目は出ない
    page = client.get("/items?cat=清掃").get_data(as_text=True)
    assert "洗剤" in page and "ゴミ袋" in page and "軍手" not in page
    # 空のフォルダも作れて、残る
    client.post("/folders", data={"action": "new", "path": "清掃", "name": "モップ"})
    page = client.get("/items?cat=清掃/モップ").get_data(as_text=True)
    assert "このフォルダは空です" in page
    # 同じ名前は作れない
    page = client.post("/folders", data={"action": "new", "path": "清掃", "name": "モップ"},
                       follow_redirects=True).get_data(as_text=True)
    assert "すでにあります" in page
    # 名前を変えると、中のフォルダ・品目も一緒に変わる
    client.post("/folders", data={"action": "rename", "path": "清掃", "name": "清掃用品"})
    assert item_by_name("ゴミ袋")["category"] == "清掃用品/ゴミ袋"
    assert item_by_name("洗剤")["category"] == "清掃用品"
    page = client.get("/items?cat=清掃用品/モップ").get_data(as_text=True)
    assert "このフォルダは空です" in page
    # フォルダを別のフォルダへ移す (自分の中へは移せない)
    client.post("/folders", data={"action": "move", "path": "清掃用品/ゴミ袋", "to": "手袋"})
    assert item_by_name("ゴミ袋")["category"] == "手袋/ゴミ袋"
    page = client.post("/folders", data={"action": "move", "path": "手袋", "to": "手袋/ゴミ袋"},
                       follow_redirects=True).get_data(as_text=True)
    assert "自分の中のフォルダへは移せません" in page
    # 削除すると、中の品目は消さずに1つ上へ
    page = client.post("/folders", data={"action": "delete", "path": "手袋/ゴミ袋"},
                       follow_redirects=True).get_data(as_text=True)
    assert "1 件は「手袋」へ移しました" in page
    assert item_by_name("ゴミ袋")["category"] == "手袋"
    client.post("/folders", data={"action": "delete", "path": "手袋"})
    assert item_by_name("ゴミ袋")["category"] == "" and item_by_name("軍手")["category"] == ""


def test_folder_names_with_like_characters(client):
    # % や _ を含む名前でも、ほかのフォルダを巻き込まない
    add_item(client, name="A", category="50%_off")
    add_item(client, name="B", category="50xxoff")
    client.post("/folders", data={"action": "rename", "path": "50%_off", "name": "セール"})
    assert item_by_name("A")["category"] == "セール" and item_by_name("B")["category"] == "50xxoff"


def test_move_items_to_folder(client):
    add_item(client, name="軍手")
    add_item(client, name="マスク")
    ids = [str(item_by_name("軍手")["id"]), str(item_by_name("マスク")["id"])]
    page = client.post("/items/move", data={"id": ids, "to": "衛生/マスク類"},
                       follow_redirects=True).get_data(as_text=True)
    assert "2 件の品目を「衛生/マスク類」へ移しました" in page
    assert item_by_name("マスク")["category"] == "衛生/マスク類"
    # フォルダなしへ戻す。品目を全部移しても、元のフォルダは空のまま残る
    client.post("/items/move", data={"id": ids, "to": ""})
    assert item_by_name("軍手")["category"] == ""
    page = client.get("/items?cat=衛生/マスク類").get_data(as_text=True)
    assert "このフォルダは空です" in page


def test_item_price_tax_included(client):
    assert stock_app.parse_price("１，２００円") == 1200 and stock_app.parse_price("¥12.5") == 12.5
    assert stock_app.parse_price("") == 0 and stock_app.parse_price("-5") is None and stock_app.parse_price("1.234") is None
    page = add_item(client, name="手袋", stock="12", price="abc").get_data(as_text=True)
    assert "単価は0以上の数で入れてください" in page
    add_item(client, name="手袋", stock="12", price="880")
    add_item(client, name="テープ", stock="3", price="12.5")
    page = client.get("/items").get_data(as_text=True)
    # 在庫金額 = 在庫 × 単価 (税込)。合計も出る
    assert "¥10,560" in page and "¥37.50" in page and "¥10,597.50" in page
    # 編集画面に単価が出る
    item = item_by_name("手袋")
    assert 'value="880"' in client.get(f"/items/{item['id']}/edit").get_data(as_text=True)


def test_price_in_excel_and_csv(client):
    import io
    import item_sheet
    add_item(client, name="手袋", price="880", category="手袋")
    rows = item_sheet.read_rows(client.get("/items.xlsx").data)
    assert rows[0]["単価（税込）"] == "880" and rows[0]["分類"] == "手袋"
    assert "単価（税込）" in client.get("/items.csv").get_data(as_text=True)
    # 「単価」という見出しでも取り込める。分類は「清掃/ゴミ袋」でフォルダの中のフォルダになる
    csv_text = "品名,単価,分類,在庫数\nゴミ袋,165,清掃/ゴミ袋,20\n"
    client.post("/items/import", data={"file": (io.BytesIO(csv_text.encode()), "x.csv")})
    item = item_by_name("ゴミ袋")
    assert item["price"] == 165 and item["category"] == "清掃/ゴミ袋"


def test_stocktake_period_warns_but_allows(client):
    add_item(client, name="手袋", stock="10", price="100")
    code = item_by_name("手袋")["code"]
    # 日付が足りない・逆の期間は保存しない
    page = client.post("/stocktake/period", data={"from": "2026-11-28", "to": "2026-10-28"},
                       follow_redirects=True).get_data(as_text=True)
    assert "終わりの日付は、始まりの日付より後に" in page
    # 期間外 (過去) の期間でも、数えられる。警告だけ出る
    page = client.post("/stocktake/period", data={"from": "2020-10-28", "to": "2020-11-28"},
                       follow_redirects=True).get_data(as_text=True)
    assert "2020/10/28 〜 2020/11/28" in page and "棚卸しの期間を過ぎています" in page
    page = client.post("/stocktake/start", data={"user": "山田"}, follow_redirects=True).get_data(as_text=True)
    assert "の外です。このまま数えることはできます" in page
    import sqlite3
    with sqlite3.connect(stock_app.app.config["DATABASE"]) as db:
        st_id, pfrom = db.execute("SELECT id, period_from FROM stocktakes ORDER BY id DESC").fetchone()
    assert pfrom == "2020-10-28"  # 始めた時の期間を、棚卸しの記録に残す
    res = client.post(f"/api/stocktake/{st_id}/count", json={"code": code, "counted": 8}).get_json()
    assert res["ok"] and res["out_of_period"] is True and res["diff"] == -2
    client.post(f"/stocktake/{st_id}/finish")
    page = client.get(f"/stocktake/{st_id}").get_data(as_text=True)
    # 結果に、数えた金額・ズレの金額・期間が出る
    assert "¥800" in page and "-¥200" in page and "期間外に始めました" in page
    csv_text = client.get(f"/stocktake/{st_id}.csv").get_data(as_text=True)
    assert "ズレの金額（税込）" in csv_text and ",-200," in csv_text
    # 期間を消すと、警告も出ない
    client.post("/stocktake/period", data={"action": "clear"})
    assert "棚卸しの期間を過ぎています" not in client.get("/stocktake").get_data(as_text=True)


def test_stocktake_period_in_range(client):
    from datetime import date, timedelta
    today = date.today()
    client.post("/stocktake/period", data={"from": (today - timedelta(days=3)).isoformat(),
                                           "to": (today + timedelta(days=28)).isoformat()})
    assert "今日は棚卸しの期間中です" in client.get("/stocktake").get_data(as_text=True)


def test_folder_and_price_edge_cases(client):
    import io
    import xlsxwriter
    # 名前が長すぎる・深すぎる・空のフォルダは作らない
    page = client.post("/folders", data={"action": "new", "path": "", "name": "あ" * 41},
                       follow_redirects=True).get_data(as_text=True)
    assert "40文字までです" in page
    deep = "/".join(str(n) for n in range(6))
    page = client.post("/folders", data={"action": "new", "path": deep, "name": "7"},
                       follow_redirects=True).get_data(as_text=True)
    assert "6段までです" in page
    page = client.post("/folders", data={"action": "new", "path": "", "name": "  "},
                       follow_redirects=True).get_data(as_text=True)
    assert "フォルダの名前を入れてください" in page
    # 無いフォルダの名前の変更・削除は、理由を出して何もしない
    page = client.post("/folders", data={"action": "delete", "path": "無いフォルダ"},
                       follow_redirects=True).get_data(as_text=True)
    assert "フォルダが見つかりません" in page
    # 同じ名前への名前の変更はできない
    add_item(client, name="A", category="甲")
    add_item(client, name="B", category="乙")
    page = client.post("/folders", data={"action": "rename", "path": "甲", "name": "乙"},
                       follow_redirects=True).get_data(as_text=True)
    assert "すでにあります" in page and item_by_name("A")["category"] == "甲"
    # 画面に出すフォルダの名前は、そのまま文字として出す (HTML として動かない)
    client.post("/folders", data={"action": "new", "path": "", "name": "<i>x"})
    page = client.get("/items").get_data(as_text=True)
    assert "<i>x" not in page and "&lt;i&gt;x" in page
    # 無いフォルダを開いた時は、すべての品目を出す
    assert client.get("/items?cat=../無い").status_code == 200
    # 品目を削除すると、その品目のフォルダに戻る (フォルダは残る)
    item = item_by_name("A")
    res = client.post(f"/items/{item['id']}/delete")
    assert "cat=" in res.headers["Location"]
    assert "このフォルダは空です" in client.get("/items?cat=甲").get_data(as_text=True)
    # Excel が誤差の桁を付けて保存した単価も読める。桁の多すぎる単価は理由を出す
    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf)
    ws = wb.add_worksheet("品目")
    ws.write_row(0, 0, ["品名", "単価（税込）"])
    ws.write_row(1, 0, ["ウエス", "33.299999999999997"])
    ws.write_row(2, 0, ["軍手", "123456789012"])
    wb.close()
    page = client.post("/items/import", data={"file": (io.BytesIO(buf.getvalue()), "x.xlsx")},
                       follow_redirects=True).get_data(as_text=True)
    assert item_by_name("ウエス")["price"] == 33.3
    assert "3行目: 単価は0以上の数で入れてください" in page and item_by_name("軍手") is None


def test_stocktake_period_bad_dates(client):
    page = client.post("/stocktake/period", data={"from": "2026-02-30", "to": "2026-03-01"},
                       follow_redirects=True).get_data(as_text=True)
    assert "両方入れてください" in page
    page = client.post("/stocktake/period", data={"from": "2026-10-28", "to": ""},
                       follow_redirects=True).get_data(as_text=True)
    assert "両方入れてください" in page
    # 期間を決めていない時は、警告を出さない
    add_item(client, name="手袋", stock="5")
    client.post("/stocktake/start")
    import sqlite3
    with sqlite3.connect(stock_app.app.config["DATABASE"]) as db:
        st_id = db.execute("SELECT id FROM stocktakes").fetchone()[0]
    res = client.post(f"/api/stocktake/{st_id}/count", json={"code": item_by_name("手袋")["code"], "counted": 5})
    assert res.get_json()["out_of_period"] is False
