"""画面の言葉の切り替え (日本語 / インドネシア語)。
Copyright © 2026. All rights reserved.

画面の日本語をそのまま「見出し語」にして、translations/<言語>/*.json の訳に置き換える。
訳が無い言葉は日本語のまま出す。言語は端末ごと (ブラウザの cookie) に覚える。
"""
import glob
import json
import os

from flask import g, has_request_context, request

LANGS = {"ja": "日本語", "id": "Bahasa Indonesia"}
DEFAULT = "ja"
COOKIE = "lang"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_dicts = {}   # 言語 -> {日本語: 訳}
_js = {}      # 言語 -> 画面の部品 (JavaScript) で使う分だけ


def load():
    _dicts.clear(); _js.clear()
    for lang in LANGS:
        if lang == DEFAULT:
            continue
        d, js = {}, {}
        for path in sorted(glob.glob(os.path.join(BASE_DIR, "translations", lang, "*.json"))):
            with open(path, encoding="utf-8") as f:
                part = {k: v for k, v in json.load(f).items() if isinstance(v, str) and v.strip()}
            d.update(part)
            if os.path.basename(path).startswith("js"):
                js.update(part)
        _dicts[lang], _js[lang] = d, js


def current():
    """この端末の言語。?lang=id で一時的に切り替えもできる (印刷用など)。"""
    if not has_request_context():
        return DEFAULT
    if "lang" not in g:
        lang = request.args.get("lang") or request.cookies.get(COOKIE) or DEFAULT
        g.lang = lang if lang in LANGS else DEFAULT
    return g.lang


def tr(text, **kw):
    """日本語の言葉を、今の言語に訳す。{n} などの部分は kw で埋める。"""
    lang = current()
    out = _dicts.get(lang, {}).get(text, text) if lang != DEFAULT else text
    return out.format(**kw) if kw else out


def js_dict():
    return _js.get(current(), {})


load()
