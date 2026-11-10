"""ライセンスキー (使えるPCの固定)。

PCごとの「マシンコード」に対して、発行者だけが持つ秘密鍵で署名したキーを発行する。
アプリには公開鍵だけを入れておき、署名を確かめる。キーは別のPCでは使えない。

Copyright © 2026. All rights reserved.
"""
import base64
import hashlib
import json
import os
import platform
import subprocess
import uuid
from datetime import date

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

PRODUCT = "pitto-stock"
PREFIX = "PS1"
# 発行者の公開鍵 (秘密鍵はアプリに入れない)
PUBLIC_KEY = "zXcRYEXcbGAGcfEV77LO1AZZgntBYk1WuhfUFAa99gg="


class LicenseError(Exception):
    """ライセンスキーが使えない理由 (画面にそのまま出す)。"""


def _raw_machine_id():
    """OS が持っている、そのPC固有のIDを読む。"""
    system = platform.system()
    try:
        if system == "Windows":
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography",
                                0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as k:
                return winreg.QueryValueEx(k, "MachineGuid")[0]
        if system == "Darwin":
            out = subprocess.run(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                                 capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                if "IOPlatformUUID" in line:
                    return line.split('"')[-2]
        for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
            if os.path.exists(path):
                with open(path) as f:
                    value = f.read().strip()
                if value:
                    return value
    except Exception:  # 読めない時は下の予備の方法を使う
        pass
    return f"mac-{uuid.getnode():012x}"


def machine_code(raw=None):
    """このPCのマシンコード (例: 3F9A-12C4-77E0-B5D2)。"""
    digest = hashlib.sha256(f"{PRODUCT}:{raw or _raw_machine_id()}".encode()).hexdigest()[:16].upper()
    return "-".join(digest[i:i + 4] for i in range(0, 16, 4))


def _b64e(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64d(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_key(private_key, code, name="", expires=""):
    """キーを作る (発行ツール・テスト用)。private_key は Ed25519PrivateKey。"""
    payload = {"p": PRODUCT, "m": code, "n": name, "e": expires, "i": date.today().isoformat()}
    body = _b64e(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
    signed = f"{PREFIX}.{body}"
    return f"{signed}.{_b64e(private_key.sign(signed.encode()))}"


def check(key_text, code=None, today=None, public_key=PUBLIC_KEY):
    """キーを確かめる。使えれば中身 (dict) を返し、使えなければ LicenseError。"""
    key_text = "".join((key_text or "").split())  # 改行や空白が混ざっても読む
    if not key_text:
        raise LicenseError("ライセンスキーが入っていません")
    parts = key_text.split(".")
    if len(parts) != 3 or parts[0] != PREFIX:
        raise LicenseError("ライセンスキーの形が正しくありません（全部コピーできているか確かめてください）")
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key)).verify(
            _b64d(parts[2]), f"{parts[0]}.{parts[1]}".encode())
        info = json.loads(_b64d(parts[1]))
    except (InvalidSignature, ValueError):
        raise LicenseError("このライセンスキーは正しくありません") from None
    if info.get("p") != PRODUCT:
        raise LicenseError("このアプリ用のライセンスキーではありません")
    code = code or machine_code()
    if info.get("m") != code:
        raise LicenseError(f"このライセンスキーは別のPC用です（このPCのマシンコード: {code}）")
    expires = info.get("e") or ""
    if expires:
        try:
            if (today or date.today()) > date.fromisoformat(expires):
                raise LicenseError(f"ライセンスの期限（{expires}）が切れています")
        except ValueError:
            raise LicenseError("このライセンスキーは正しくありません") from None
    return {"machine": info.get("m"), "name": info.get("n") or "", "expires": expires, "issued": info.get("i") or ""}
