#!/usr/bin/env python3
"""投稿済み slug の記録・確認。posted.json を Git で追跡する。

同じ slug を 2 回出さないための dedupe と、投稿後の記録に使う。

使い方:
  # 既に出したか確認 (投稿済みなら exit 1、未投稿なら exit 0)
  python3 scripts/posted.py check --channel carousel --slug meo-01

  # 記録する
  python3 scripts/posted.py record --channel carousel --slug meo-01

  # post.json から読む
  python3 scripts/posted.py check --channel carousel --item out/post/post.json
  python3 scripts/posted.py record --channel carousel --item out/post/post.json

posted.json の形:
  {
    "carousel": ["meo-01", "aio-01", ...],
    "reel": [...],
    "threads": [...]
  }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_posted(path: Path) -> dict:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_posted(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_slug(args) -> str:
    if args.slug:
        return args.slug
    if args.item:
        meta = json.loads(Path(args.item).read_text(encoding="utf-8"))
        return meta["slug"]
    raise SystemExit("either --slug or --item required")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["check", "record"])
    ap.add_argument("--channel", required=True, choices=["carousel", "reel", "threads", "story"])
    ap.add_argument("--slug", default=None)
    ap.add_argument("--item", default=None, help="post.json path")
    ap.add_argument("--posted", default="posted.json")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    posted_path = Path(args.posted) if Path(args.posted).is_absolute() else root / args.posted
    slug = resolve_slug(args)
    data = load_posted(posted_path)
    lst = data.get(args.channel, [])

    if args.action == "check":
        if slug in lst:
            print(f"already posted: {args.channel}/{slug}", file=sys.stderr)
            sys.exit(1)
        else:
            print(f"not yet posted: {args.channel}/{slug}", file=sys.stderr)
            sys.exit(0)

    # record
    if slug not in lst:
        lst.append(slug)
        data[args.channel] = lst
        save_posted(posted_path, data)
        print(f"recorded: {args.channel}/{slug}", file=sys.stderr)
    else:
        print(f"already recorded: {args.channel}/{slug}", file=sys.stderr)


if __name__ == "__main__":
    main()
