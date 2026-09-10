#!/usr/bin/env python3
"""D-ID API クライアント。静止画 + テキストから話す動画 (lip-sync) を生成する。

D-ID API: https://docs.d-id.com/

使い方 (CLI):
  python3 tools/did_client.py \
    --source-url https://tusg.site/assets/emily/portrait-01.jpg \
    --script "こんにちは、エミリーです" \
    --voice ja-JP-NanamiNeural \
    --out out/reel.mp4

環境変数:
  DID_API_KEY   D-ID の API key (`https://studio.d-id.com/account-settings` から取得)

処理フロー:
  1. POST /talks (画像 URL + テキスト + 音声設定) → talk_id 取得
  2. GET /talks/{talk_id} を polling (完了まで最大 5 分)
  3. result_url から mp4 をダウンロード
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DID_BASE_URL = "https://api.d-id.com"
POLL_INTERVAL_SEC = 3
POLL_TIMEOUT_SEC = 300  # 5 分

# 推奨 Japanese voices (Microsoft Neural voices via D-ID):
#   ja-JP-NanamiNeural   女性、ニュートラルで聞きやすい (デフォルト)
#   ja-JP-AoiNeural      女性、若め
#   ja-JP-MayuNeural     女性、温かめ
#   ja-JP-ShioriNeural   女性、落ち着き
DEFAULT_VOICE = "ja-JP-NanamiNeural"


def _auth_header(api_key: str) -> str:
    # D-ID は "Basic <base64(api_key:)>" 形式
    token = base64.b64encode(f"{api_key}:".encode("ascii")).decode("ascii")
    return f"Basic {token}"


def _request(method: str, path: str, api_key: str, body: dict | None = None) -> dict:
    url = f"{DID_BASE_URL}{path}"
    data = None
    headers = {
        "Authorization": _auth_header(api_key),
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"D-ID {method} {path} failed: HTTP {e.code} {body_text[:500]}")


def create_talk(api_key: str, source_url: str, script_text: str,
                voice_id: str = DEFAULT_VOICE) -> str:
    """talk を作成、talk_id を返す。"""
    body = {
        "source_url": source_url,
        "script": {
            "type": "text",
            "input": script_text,
            "provider": {
                "type": "microsoft",
                "voice_id": voice_id,
            },
        },
        "config": {
            # 表情を控えめに (企業ブランドとして落ち着いた見せ方)
            "stitch": True,
        },
    }
    result = _request("POST", "/talks", api_key, body)
    talk_id = result.get("id")
    if not talk_id:
        raise RuntimeError(f"no talk id in response: {result}")
    return talk_id


def get_talk(api_key: str, talk_id: str) -> dict:
    return _request("GET", f"/talks/{talk_id}", api_key)


def wait_for_talk(api_key: str, talk_id: str, timeout_sec: int = POLL_TIMEOUT_SEC) -> str:
    """result_url が返るまで poll。返り値は mp4 の URL。"""
    deadline = time.time() + timeout_sec
    last_status = ""
    while time.time() < deadline:
        talk = get_talk(api_key, talk_id)
        status = talk.get("status", "")
        if status != last_status:
            print(f"  D-ID status: {status}", file=sys.stderr)
            last_status = status
        if status == "done":
            url = talk.get("result_url")
            if not url:
                raise RuntimeError(f"done but no result_url: {talk}")
            return url
        if status in ("error", "rejected"):
            raise RuntimeError(f"D-ID talk failed: {talk}")
        time.sleep(POLL_INTERVAL_SEC)
    raise RuntimeError(f"D-ID talk did not complete within {timeout_sec}s")


def download_video(url: str, dest: Path) -> None:
    """result_url から mp4 をダウンロード。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "tusg-autopost/1.0"})
    with urllib.request.urlopen(req, timeout=120) as res:
        dest.write_bytes(res.read())
    print(f"  downloaded: {dest} ({dest.stat().st_size:,} bytes)", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-url", required=True,
                    help="キャラクター画像の公開 URL (D-ID が fetch する)")
    ap.add_argument("--script", required=True, help="話す内容 (テキスト)")
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    ap.add_argument("--out", required=True, help="出力 mp4 パス")
    ap.add_argument("--api-key-env", default="DID_API_KEY")
    args = ap.parse_args()

    api_key = os.environ.get(args.api_key_env)
    if not api_key:
        raise SystemExit(f"{args.api_key_env} が環境変数に無い")

    print(f"create_talk: {args.source_url} + {len(args.script)} chars", file=sys.stderr)
    talk_id = create_talk(api_key, args.source_url, args.script, args.voice)
    print(f"  talk_id: {talk_id}", file=sys.stderr)
    result_url = wait_for_talk(api_key, talk_id)
    print(f"  result_url: {result_url[:80]}...", file=sys.stderr)
    download_video(result_url, Path(args.out))


if __name__ == "__main__":
    main()
