#!/usr/bin/env python3
"""upload_r2 でアップした reel.mp4 の video_url で Instagram にリール投稿する。

使い方:
  python3 tools/publish_reel.py <outdir> [--dry-run]

環境変数:
  AUTOPOST_TRIGGER_TOKEN  必須
  SITE_URL                デフォルト https://tusg.site
  DRY_RUN                 "true" なら投稿しない
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    site = os.environ.get("SITE_URL", "https://tusg.site").rstrip("/")
    token = os.environ.get("AUTOPOST_TRIGGER_TOKEN", "")
    if not token:
        raise SystemExit("AUTOPOST_TRIGGER_TOKEN not set")
    env_dry = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
    dry_run = args.dry_run or env_dry

    outdir = Path(args.outdir)
    meta = json.loads((outdir / "reel.json").read_text(encoding="utf-8"))

    video_url = meta.get("video_url")
    if not video_url:
        raise SystemExit("video_url required; run upload_r2.py first to attach it")

    payload = {
        "mode": "reel",
        "video_url": video_url,
        "caption": meta.get("caption", ""),
        "genre_key": meta["genre_key"],
        "share_to_feed": True,  # リールもフィードに表示 (露出最大化)
        "dry_run": bool(dry_run),
    }

    url = f"{site}/api/autopost/publish"
    req = urllib.request.Request(
        url, method="POST",
        data=json.dumps(payload).encode("utf-8"),
    )
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {e.code}: {body[:500]}")

    print(json.dumps(data, ensure_ascii=False, indent=2))
    if not data.get("ok"):
        raise SystemExit("publish returned ok=false")


if __name__ == "__main__":
    main()
