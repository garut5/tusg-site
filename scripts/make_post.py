#!/usr/bin/env python3
"""TUSG 自社メディア日次投稿のカルーセル画像を生成する。

content.json から今日の曜日に対応するジャンルを引き、posted.json を見て
まだ投稿していないパターンを 1 つ選び、PIL で 1080x1350 の 6 枚
(カバー + 5 スライド、body が 5 未満のジャンルは足数を減らす) を生成する。

出力:
  {outdir}/cover.jpg
  {outdir}/body-01.jpg .. body-05.jpg
  {outdir}/post.json    (caption / slug / genre_key など)

依存:
  Pillow (pip install Pillow)
  fonts-noto-cjk (apt install -y fonts-noto-cjk)  ← 日本語表示に必須

使い方:
  python3 scripts/make_post.py --outdir out/post
  python3 scripts/make_post.py --outdir out/post --slug meo-01   # 特定パターン指定
  python3 scripts/make_post.py --outdir out/post --dry-list       # 今日の候補一覧
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

# ---- 定数 (デザイントークン) ----

CANVAS_W, CANVAS_H = 1080, 1350

# TUSG ブランドカラー (HP のダークグリーン + ゴールドアクセント)
COLOR_BG = (15, 61, 46)           # #0F3D2E TUSG グリーン
COLOR_GOLD = (184, 148, 79)       # #B8944F ゴールドアクセント
COLOR_TEXT = (255, 255, 255)
COLOR_TEXT_MUTED = (196, 210, 202)  # 淡いグリーン白
COLOR_CARD = (23, 76, 58)         # 少し明るいグリーン (スライド番号丸背景)
COLOR_HOOK_UNDERLINE = (184, 148, 79)

# レイアウト定数
MARGIN_X = 88
MARGIN_TOP = 130
LOGO_BOTTOM_MARGIN = 90

WEEKDAY_TO_GENRE_KEY = {
    0: "meo",             # 月
    1: "aio",             # 火
    2: "operation_tech",  # 水
    3: "web_dev",         # 木
    4: "hp_growth",       # 金
    5: "pitfalls",        # 土
    6: "tusg_way",        # 日
}


# ---- フォント読み込み ----

def _first_existing(paths: list[str]) -> str | None:
    for p in paths:
        if Path(p).is_file():
            return p
    return None


def load_font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    """Noto CJK JP を優先、無ければ IPA Gothic フォールバック。"""
    candidates_bold = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
        "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf",
    ]
    candidates_regular = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
        "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    ]
    path = _first_existing(candidates_bold if weight == "bold" else candidates_regular)
    if not path:
        # 最後の手段: 内蔵フォント (日本語は化ける)
        return ImageFont.load_default()
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


# ---- 描画ヘルパー ----

def _text_wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    """テキストを max_width 内に収まるよう改行。既存の \n は尊重。"""
    lines: list[str] = []
    for hard_line in text.split("\n"):
        if not hard_line:
            lines.append("")
            continue
        cur = ""
        for ch in hard_line:
            candidate = cur + ch
            w = draw.textlength(candidate, font=font)
            if w <= max_width:
                cur = candidate
            else:
                if cur:
                    lines.append(cur)
                cur = ch
        if cur:
            lines.append(cur)
    return lines


def _draw_text_block(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font,
    fill,
    line_height: int,
    max_width: int,
) -> int:
    """折り返し描画、描いた最終 y を返す。"""
    x, y = xy
    lines = _text_wrap(draw, text, font, max_width)
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def _draw_logo(img: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    """右下に "TUSG" ワードマークを控えめに描画。"""
    font = load_font(28, weight="bold")
    text = "TUSG"
    w = draw.textlength(text, font=font)
    x = CANVAS_W - MARGIN_X - w
    y = CANVAS_H - LOGO_BOTTOM_MARGIN
    # 下線 (ゴールド)
    line_pad = 8
    line_len = int(w * 1.15)
    draw.line(
        [(x - (line_len - w) // 2, y + 40),
         (x - (line_len - w) // 2 + line_len, y + 40)],
        fill=COLOR_GOLD,
        width=2,
    )
    draw.text((x, y), text, font=font, fill=COLOR_TEXT_MUTED)
    # 小さな subtitle
    sub_font = load_font(18, weight="regular")
    sub = "合同会社TUSG"
    sw = draw.textlength(sub, font=sub_font)
    draw.text((CANVAS_W - MARGIN_X - sw, y + 50), sub, font=sub_font, fill=COLOR_TEXT_MUTED)


# ---- 各スライド生成 ----

def make_cover(tag: str, hook: str, sub: str) -> Image.Image:
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), COLOR_BG)
    draw = ImageDraw.Draw(img)

    # 上部: ゴールドの縦線 + カテゴリタグ
    tag_font = load_font(38, weight="bold")
    tag_y = MARGIN_TOP
    # 縦線 (ゴールド)
    draw.rectangle(
        [(MARGIN_X, tag_y - 4), (MARGIN_X + 6, tag_y + 38)],
        fill=COLOR_GOLD,
    )
    draw.text((MARGIN_X + 24, tag_y - 2), tag, font=tag_font, fill=COLOR_GOLD)

    # 中央: メインフック (大きく、多行)
    hook_font = load_font(72, weight="bold")
    hook_lh = 110
    # フック高さを見てだいたい中央に配置
    hook_lines = hook.count("\n") + 1
    hook_h = hook_lh * hook_lines
    hook_y = (CANVAS_H - hook_h) // 2 - 40
    _draw_text_block(
        draw,
        (MARGIN_X, hook_y),
        hook,
        hook_font,
        COLOR_TEXT,
        hook_lh,
        CANVAS_W - MARGIN_X * 2,
    )

    # フック下の下線 (装飾)
    line_y = hook_y + hook_h + 40
    draw.line(
        [(MARGIN_X, line_y), (MARGIN_X + 200, line_y)],
        fill=COLOR_GOLD,
        width=4,
    )

    # サブタイトル (下線の下)
    sub_font = load_font(34, weight="regular")
    _draw_text_block(
        draw,
        (MARGIN_X, line_y + 30),
        sub,
        sub_font,
        COLOR_TEXT_MUTED,
        50,
        CANVAS_W - MARGIN_X * 2,
    )

    _draw_logo(img, draw)
    return img


def make_body(idx: int, num: str, title: str, desc: str) -> Image.Image:
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), COLOR_BG)
    draw = ImageDraw.Draw(img)

    # 上部: ゴールド縦線 + 番号タグ (「01」など)
    tag_font = load_font(38, weight="bold")
    tag_y = MARGIN_TOP
    draw.rectangle(
        [(MARGIN_X, tag_y - 4), (MARGIN_X + 6, tag_y + 38)],
        fill=COLOR_GOLD,
    )
    draw.text((MARGIN_X + 24, tag_y - 2), num, font=tag_font, fill=COLOR_GOLD)

    # 中央上: title (大きい)
    title_font = load_font(58, weight="bold")
    title_lh = 88
    title_y = MARGIN_TOP + 110
    end_y = _draw_text_block(
        draw,
        (MARGIN_X, title_y),
        title,
        title_font,
        COLOR_TEXT,
        title_lh,
        CANVAS_W - MARGIN_X * 2,
    )

    # 下線 (装飾)
    line_y = end_y + 20
    draw.line(
        [(MARGIN_X, line_y), (MARGIN_X + 100, line_y)],
        fill=COLOR_GOLD,
        width=3,
    )

    # desc (説明、小さめ、読みやすい行間)
    desc_font = load_font(34, weight="regular")
    desc_lh = 56
    _draw_text_block(
        draw,
        (MARGIN_X, line_y + 40),
        desc,
        desc_font,
        COLOR_TEXT_MUTED,
        desc_lh,
        CANVAS_W - MARGIN_X * 2,
    )

    _draw_logo(img, draw)
    return img


# ---- キャプション組立 ----

def build_caption(entry: dict, meta: dict) -> str:
    """LOCOREACH と近い構造だが、CTA を tusg.site/hearing に固定、Threads と Instagram で共通化しやすいシンプル形。"""
    tag = entry["cover_tag"]
    hook = entry["cover_hook"].replace("\n", "")
    body = entry.get("caption_body", "")
    cta_url = meta.get("cta_url", "https://tusg.site/hearing")
    # 重複排除しつつ順序保持 (base → extra の順)
    seen = set()
    merged_tags = []
    for t in list(meta.get("base_hashtags", [])) + list(entry.get("extra_hashtags", [])):
        if t not in seen:
            seen.add(t)
            merged_tags.append(t)
    hashtags = " ".join(merged_tags)
    parts = [
        f"【{tag}】{hook}",
        "",
        body,
        "",
        f"👉 30秒で今の状況を整理 → {cta_url}",
        "",
        hashtags,
    ]
    return "\n".join(parts)


# ---- パターン選択 (posted.json でローテ) ----

def load_json(path: Path, default):
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def find_slug_globally(content: dict, slug: str) -> tuple[str, dict] | None:
    """全ジャンルを横断して slug を検索し (genre_key, entry) を返す。"""
    for gk, entries in content.items():
        if gk == "meta" or not isinstance(entries, list):
            continue
        for e in entries:
            if isinstance(e, dict) and e.get("slug") == slug:
                return gk, e
    return None


def choose_entry(content: dict, genre_key: str, posted_slugs: list[str], slug_hint: str | None) -> dict:
    if slug_hint:
        # slug 指定時はジャンル横断で検索
        found = find_slug_globally(content, slug_hint)
        if not found:
            raise SystemExit(f"slug not found in any genre: {slug_hint}")
        return found[1]

    entries = content[genre_key]
    # 未投稿のものを優先
    for e in entries:
        if e["slug"] not in posted_slugs:
            return e
    # 全部投稿済みなら循環 (最初のパターンに戻る)
    return entries[0]


# ---- メイン ----

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--slug", default=None, help="特定 slug を指定 (テスト用)")
    ap.add_argument("--genre-key", default=None, help="曜日を無視して特定ジャンルを使う")
    ap.add_argument("--content", default="content.json")
    ap.add_argument("--posted", default="posted.json")
    ap.add_argument("--dry-list", action="store_true", help="今日の候補一覧を表示して終了")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    content_path = (Path(args.content) if Path(args.content).is_absolute() else root / args.content)
    posted_path = (Path(args.posted) if Path(args.posted).is_absolute() else root / args.posted)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    content = load_json(content_path, {})
    if "meta" not in content:
        raise SystemExit(f"content.json invalid: {content_path}")

    # 曜日 → ジャンル
    if args.genre_key:
        genre_key = args.genre_key
    else:
        # JST の曜日
        now_jst = dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))
        genre_key = WEEKDAY_TO_GENRE_KEY[now_jst.weekday()]

    if genre_key not in content:
        raise SystemExit(f"genre not defined in content.json: {genre_key}")

    posted = load_json(posted_path, {"carousel": []})
    posted_slugs: list[str] = posted.get("carousel", []) if isinstance(posted, dict) else []

    if args.dry_list:
        print(f"today's genre: {genre_key}")
        for e in content[genre_key]:
            state = "✓posted" if e["slug"] in posted_slugs else " unused"
            print(f"  [{state}] {e['slug']} — {e['cover_hook'][:40].replace(chr(10), ' ')}")
        return

    entry = choose_entry(content, genre_key, posted_slugs, args.slug)
    # slug 指定時は entry のジャンルに合わせて genre_key を更新
    if args.slug:
        for gk, entries in content.items():
            if gk == "meta" or not isinstance(entries, list):
                continue
            if entry in entries:
                genre_key = gk
                break
    genre_meta = content["meta"]["genres"][genre_key]

    print(f"selected: {entry['slug']} ({genre_meta['label']})", file=sys.stderr)

    # カバー
    cover = make_cover(entry["cover_tag"], entry["cover_hook"], entry["cover_sub"])
    cover.save(outdir / "cover.jpg", quality=90)

    # 本文スライド (最大 5 枚)
    body_files: list[str] = []
    for i, item in enumerate(entry["body"][:5]):
        img = make_body(i, item["num"], item["title"], item["desc"])
        fname = f"body-{i + 1:02d}.jpg"
        img.save(outdir / fname, quality=90)
        body_files.append(fname)

    caption = build_caption(entry, content["meta"])

    # post.json (upload_r2 / publish_carousel に渡すメタ情報)
    post_meta = {
        "slug": entry["slug"],
        "genre_key": genre_key,
        "genre_label": genre_meta["label"],
        "date_jst": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d"),
        "cover_file": "cover.jpg",
        "body_files": body_files,
        "caption": caption,
    }
    (outdir / "post.json").write_text(
        json.dumps(post_meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"wrote: {outdir}/post.json", file=sys.stderr)
    print(f"total images: 1 cover + {len(body_files)} body = {1 + len(body_files)}", file=sys.stderr)


if __name__ == "__main__":
    main()
