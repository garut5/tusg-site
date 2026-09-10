#!/usr/bin/env python3
"""生成したカルーセル画像を R2 (tusg-autopost-assets) にアップロードする。

Cloudflare の R2 API を直接叩かず、本体 Pages Function
`POST /api/autopost/asset` を経由する。認証は AUTOPOST_TRIGGER_TOKEN。
一元化してあるので秘密情報が Actions 側だけで済む。

使い方:
  python3 tools/upload_r2.py <outdir> --prefix carousel [--date YYYY-MM-DD]

環境変数:
  AUTOPOST_TRIGGER_TOKEN  Bearer トークン (必須)
  SITE_URL                デフォルト https://tusg.site

出力:
  <outdir>/post.json の "image_urls" フィールドを追記して書き戻す
  (cover → body-01 → body-02 ... の順で公開 URL 配列)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
}


def upload_one(site: str, token: str, key: str, path: Path) -> dict:
    ct = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    url = f"{site}/api/autopost/asset?key={key}"
    body = path.read_bytes()
    req = urllib.request.Request(url, method="POST", data=body)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", ct)
    req.add_header("Content-Length", str(len(body)))
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.loads(res.read().decode("utf-8"))
                if not data.get("ok"):
                    raise RuntimeError(f"upload not ok: {data}")
                return data
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            wait = 2 ** attempt
            print(f"  upload retry ({attempt + 1}/3) in {wait}s: {e}", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"upload failed after retries: {key}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--prefix", default="carousel")
    ap.add_argument("--date", default=None, help="YYYY-MM-DD 省略時は post.json の date_jst")
    args = ap.parse_args()

    site = os.environ.get("SITE_URL", "https://tusg.site").rstrip("/")
    token = os.environ.get("AUTOPOST_TRIGGER_TOKEN", "")
    if not token:
        raise SystemExit("AUTOPOST_TRIGGER_TOKEN not set")

    outdir = Path(args.outdir)
    # post.json (carousel) と reel.json (reel) の両方に対応
    meta_path = outdir / "post.json"
    is_reel = False
    if not meta_path.is_file():
        meta_path = outdir / "reel.json"
        is_reel = True
    if not meta_path.is_file():
        raise SystemExit(f"post.json / reel.json not found in {outdir}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    date = args.date or meta.get("date_jst") or dt.date.today().isoformat()
    slug = meta["slug"]
    prefix = args.prefix.strip("/")

    if is_reel:
        # リール: reel_file 1 本を video として上げる
        reel_file = meta.get("reel_file", "reel.mp4")
        path = outdir / reel_file
        if not path.is_file():
            raise SystemExit(f"missing reel: {path}")
        key = f"{prefix}/{date}-{slug}{path.suffix.lower()}"
        print(f"  uploading {reel_file} -> {key}", file=sys.stderr)
        result = upload_one(site, token, key, path)
        meta["video_url"] = result["public_url"]
        meta["r2_prefix"] = prefix
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote video_url to {meta_path}", file=sys.stderr)
        print(f"  {result['public_url']}")
        return

    # カルーセル: cover → body-01, body-02, ...
    file_names = [meta["cover_file"]] + list(meta.get("body_files", []))
    image_urls: list[str] = []
    for i, fname in enumerate(file_names):
        path = outdir / fname
        if not path.is_file():
            raise SystemExit(f"missing image: {path}")
        key = f"{prefix}/{date}-{slug}-{i + 1:02d}{path.suffix.lower()}"
        print(f"  uploading {fname} -> {key}", file=sys.stderr)
        result = upload_one(site, token, key, path)
        image_urls.append(result["public_url"])

    meta["image_urls"] = image_urls
    meta["r2_prefix"] = prefix
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote image_urls to {meta_path}", file=sys.stderr)
    for u in image_urls:
        print(f"  {u}")


if __name__ == "__main__":
    main()
