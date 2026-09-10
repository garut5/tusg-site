#!/usr/bin/env python3
"""エミリーが話すリール動画を生成する。

content.json の今日の pattern から narration script を組み立て、
D-ID API で lip-sync 動画を生成する。

出力:
  {outdir}/reel.mp4
  {outdir}/reel.json  (slug / narration / genre / etc.)

環境変数:
  DID_API_KEY          必須。D-ID の API key
  EMILY_PORTRAIT_URL   任意。デフォルト https://tusg.site/assets/emily/portrait-01.jpg
  EMILY_VOICE          任意。デフォルト ja-JP-NanamiNeural
  DID_MODEL             任意。将来 D-ID の driver 変更用

使い方:
  python3 scripts/make_reel.py --outdir out/reel [--slug meo-01]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

# make_post.py の関数を再利用 (曜日 → ジャンル判定、slug 選択)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_post import (  # type: ignore
    WEEKDAY_TO_GENRE_KEY,
    choose_entry,
    find_slug_globally,
    load_json,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from did_client import create_talk, wait_for_talk, download_video, DEFAULT_VOICE  # type: ignore


DEFAULT_PORTRAIT = "https://tusg.site/assets/emily/portrait-01.jpg"
DISCLOSURE_LINE = "この動画は AI ナビゲーター エミリーが案内しています"


def build_narration(entry: dict, cta_url: str) -> str:
    """content.json の entry から、~30-40 秒で読み切れる narration を組み立てる。

    構成:
      挨拶 → hook → 3-5 point の title → 締め・CTA
    Japanese TTS で 3-4 chars/sec を目安に、全体 100-140 chars を目指す。
    """
    hook = entry["cover_hook"].replace("\n", "")
    tag = entry["cover_tag"]
    body_items = entry.get("body", [])
    # point を最大 5 個まで読み上げ (5 個の場合は各 title、4 個以下ならそのまま)
    points = [item["title"] for item in body_items[:5]]

    parts = []
    # 挨拶 (10-15 chars)
    parts.append(f"こんにちは、TUSGのエミリーです。")
    # hook + 本日のテーマ (20-30 chars)
    parts.append(f"今日のテーマは「{hook}」です。")
    # points (それぞれ 15-25 chars)
    for i, p in enumerate(points):
        parts.append(f"{i + 1}つ目、{p}。")
    # 締め (30-40 chars)
    parts.append(f"詳しくはカルーセルとプロフィールの30秒無料診断からご覧ください。")

    return "\n".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--slug", default=None)
    ap.add_argument("--genre-key", default=None)
    ap.add_argument("--content", default="content.json")
    ap.add_argument("--posted", default="posted.json")
    ap.add_argument("--portrait-url", default=None,
                    help="エミリー画像 URL、省略時は env EMILY_PORTRAIT_URL or default")
    ap.add_argument("--voice", default=None)
    ap.add_argument("--dry-run", action="store_true",
                    help="narration の組立確認のみ (D-ID 呼び出さない)")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    content_path = Path(args.content) if Path(args.content).is_absolute() else root / args.content
    posted_path = Path(args.posted) if Path(args.posted).is_absolute() else root / args.posted
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    content = load_json(content_path, {})
    if "meta" not in content:
        raise SystemExit(f"content.json invalid: {content_path}")

    # 曜日 → ジャンル
    if args.genre_key:
        genre_key = args.genre_key
    else:
        now_jst = dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))
        genre_key = WEEKDAY_TO_GENRE_KEY[now_jst.weekday()]

    posted = load_json(posted_path, {"reel": []})
    posted_slugs = posted.get("reel", []) if isinstance(posted, dict) else []

    entry = choose_entry(content, genre_key, posted_slugs, args.slug)
    if args.slug:
        # slug 指定時は entry のジャンルを検索し直し
        found = find_slug_globally(content, args.slug)
        if found:
            genre_key = found[0]
    genre_meta = content["meta"]["genres"][genre_key]
    cta_url = content["meta"].get("cta_url", "https://tusg.site/hearing")

    print(f"selected: {entry['slug']} ({genre_meta['label']})", file=sys.stderr)

    narration = build_narration(entry, cta_url)
    print(f"narration ({len(narration)} chars):\n{narration}", file=sys.stderr)

    portrait_url = args.portrait_url or os.environ.get("EMILY_PORTRAIT_URL") or DEFAULT_PORTRAIT
    voice = args.voice or os.environ.get("EMILY_VOICE") or DEFAULT_VOICE

    reel_meta = {
        "slug": entry["slug"],
        "genre_key": genre_key,
        "genre_label": genre_meta["label"],
        "date_jst": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d"),
        "narration": narration,
        "voice": voice,
        "portrait_url": portrait_url,
        # リール用キャプション (フィード投稿版より短め)
        "caption": _build_reel_caption(entry, content["meta"]),
    }

    if args.dry_run:
        reel_meta["dry_run"] = True
        (outdir / "reel.json").write_text(
            json.dumps(reel_meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"dry_run: wrote {outdir}/reel.json (skipped D-ID)", file=sys.stderr)
        return

    api_key = os.environ.get("DID_API_KEY")
    if not api_key:
        raise SystemExit("DID_API_KEY が環境変数に無い")

    talk_id = create_talk(api_key, portrait_url, narration, voice)
    print(f"D-ID talk_id: {talk_id}", file=sys.stderr)
    result_url = wait_for_talk(api_key, talk_id)
    print(f"D-ID result_url: {result_url[:80]}...", file=sys.stderr)

    reel_meta["talk_id"] = talk_id
    reel_meta["reel_file"] = "reel.mp4"

    download_video(result_url, outdir / "reel.mp4")
    (outdir / "reel.json").write_text(
        json.dumps(reel_meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"wrote: {outdir}/reel.mp4 + reel.json", file=sys.stderr)


def _build_reel_caption(entry: dict, meta: dict) -> str:
    """リール用キャプション: カルーセルより短め、開示文含める。"""
    tag = entry["cover_tag"]
    hook = entry["cover_hook"].replace("\n", "")
    body = entry.get("caption_body", "")
    cta_url = meta.get("cta_url", "https://tusg.site/hearing")
    seen = set()
    tags = []
    for t in list(meta.get("base_hashtags", [])) + list(entry.get("extra_hashtags", [])):
        if t not in seen:
            seen.add(t)
            tags.append(t)
    hashtags = " ".join(tags)
    parts = [
        f"【{tag}】{hook}",
        "",
        body,
        "",
        f"👉 30秒で今の状況を整理 → {cta_url}",
        "",
        f"※{DISCLOSURE_LINE} (AI 生成キャラクター)",
        "",
        hashtags,
    ]
    return "\n".join(parts)


if __name__ == "__main__":
    main()
