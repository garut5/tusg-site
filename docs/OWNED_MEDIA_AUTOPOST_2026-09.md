# TUSG 自社メディア自動投稿 計画メモ

作成: 2026-09-09 / 更新: 2026-09-09 (v1 / 坂本さんの回答反映)
起票者: 坂本 (合同会社TUSG)
記録: セッション中の口頭依頼 (「camomile が LOCOREACH でやっている毎日自動投稿を、TUSG でもやりたい」)

---

## 背景

camomile 側の Claude Code に、`locoreach-daily-autopost` (別名 "Owned-Media locoreach-autopost") という**プラグイン (skill)** が enable されている。box (`garut5/box`) には skill 本体の実装は無いが、marketplace 経由でロードされる skill として camomile アカウントで稼働中。

skill の要旨:
- **対象**: LOCOREACH の公式 Instagram `@locoreach_ai`
- **7 ジャンル 曜日ローテ**: 月MEO / 火Instagram集客 / 水店舗×AI / 木AIO / 金HP集客 / 土口コミ / 日店舗経営
- **統一デザイン**: ネイビー基調 + ジャンル別アクセント / グリッド安全設計
- **投稿先**: Instagram フィード + ストーリーズ + Threads
- **時刻**: 毎日 20:00 JST
- リール動画も自動生成

TUSG (合同会社TUSG) でも同等の仕組みを、TUSG のアカウントで回したい。

---

## 決まったこと (2026-09-09 坂本さん回答)

### A. アカウント

| 媒体 | アカウント | 状態 |
|---|---|---|
| Instagram | **@tusg_official** (TUSG OFFICIAL) | ✅ 稼働中 (投稿 13 件 / フォロワー 17 人 / フォロー中 299 人) |
| Threads | **@tusg_official** (TUSG OFFICIAL) | ✅ 開設済 (フォロワー 0、投稿 0 = ブランクスレート) |
| YouTube Short | — | ⏸ 一旦ステイ (Phase 3 以降で検討) |
| HP ブログ | tusg.site 側 | Phase 2 で検討 (現状無し) |

### B. 目的とコンテンツ方向性

**目的**: ブランド認知 + **30秒無料診断 (`tusg.site/hearing`) への導線**

**コンテンツテーマ** (坂本さん指定):
- ホームページ開発
- MEO (Google マップ集客)
- AIO (AI Optimization / AI 時代の店舗最適化)
- WEB 開発
- 店舗運営

**7 ジャンル曜日ローテ案** (上記 5 テーマ + 補完):

| 曜日 | ジャンル | 内容の例 |
|---|---|---|
| 月 | **MEO** | Google マップの順位対策、GBP 運用、口コミ返信のコツ |
| 火 | **AIO** | AI 時代の店舗最適化、生成 AI 活用、ChatGPT × 店舗 |
| 水 | **店舗運営 × テック** | 業務効率化、シフト・勤怠、予約管理、キャッシュレス |
| 木 | **WEB 開発** | SaaS / 業務システム開発、DX 事例、既存改善 |
| 金 | **HP 集客・HP 開発** | LP 改善、SEO、CV 導線設計、tusg.site 事例 |
| 土 | **失敗例・落とし穴** | よくある IT 導入失敗、MEO の NG 例、店舗運営あるある |
| 日 | **TUSG の考え** | 会社紹介、パートナーポリシー、AML 準拠の姿勢、経営マインド |

### C. CTA 設計 (毎投稿共通)

- **カルーセル最終ページ**: 「30秒で今の状況を整理 → tusg.site/hearing」
- **キャプション末尾**: プロフィールから無料診断 URL 誘導
- **ストーリーズ**: リンクスタンプで直接 tusg.site/hearing へ
- **Threads**: 本文末尾に短縮 URL または直リンク
- **プロフィール URL**: 現状の Instagram bio 内 URL を `https://tusg.site/hearing` に固定 (実装時に確認)

### D. YouTube Short と HP ブログ

- YouTube: **一旦保留**。SNS 稼働が安定してから Phase 3 で検討
- HP ブログ: **v1 では判断保留**。Phase 2 で改めて検討 (SNS の反応が集まり、コンテンツ資産が溜まった段階で判断)

---

## 実装アプローチ (提案)

### 推奨: フェーズ段階でフォーク型 (計画メモ v0 の option 3)

**理由**:
1. camomile 側の skill 修正は camomile オーナーの承認・作業が必要 → タイムラインが読めない
2. TUSG は独自の目的 (30秒無料診断 CV) と独自ブランド (ダークグリーン系) を持つ
3. tusg-site リポジトリの中で自己完結させれば、TUSG チームで運用意思決定できる

**構成**:
```
tusg-site/
  workers/
    tusg-autopost-cron/    # 新規: 毎日 20:00 JST に起動、投稿を実行
  functions/
    api/autopost/
      generate.js          # 新規: 曜日→ジャンル→カルーセル画像+キャプション生成
      publish.js           # 新規: Meta Graph API (Instagram+Threads) 投稿
      schedule.js          # 新規: 予約/取消/再送
  docs/
    OWNED_MEDIA_AUTOPOST_2026-09.md   # 本メモ
    AUTOPOST_TEMPLATES/               # ジャンル別テンプレ (画像レイアウト、文言、ハッシュタグ)
```

**Meta 側**:
- 現在 LocoFlow アプリ (info@tusg.site) が Meta 審査中
- **TUSG owned media 用に別 Meta アプリを立てる**か、LocoFlow アプリに @tusg_official を追加権限で通すか要判断
- ⚠ 別 Meta アプリのほうが blast radius (審査失敗リスクの隔離) を分けられて安全

### Phase 分割

**Phase 0: 準備 (今週〜来週)**
- [ ] Meta アプリ判断: 別立て vs LocoFlow アプリ拡張
- [ ] @tusg_official Instagram をビジネスアカウント化 (未対応の場合)
- [ ] Facebook ページを @tusg_official と紐付け (Instagram Business 化に必須)
- [ ] Instagram bio の URL を `https://tusg.site/hearing` に固定
- [ ] TUSG ブランドガイド (色 / フォント / ロゴ配置) を明文化
- [ ] ジャンル別テンプレの初稿 7 枚 (Canva で作成)

**Phase 1: MVP 稼働 (2〜3 週間)**
- [ ] Cloudflare Worker `tusg-autopost-cron` を実装 (毎日 20:00 JST 起動)
- [ ] 曜日 → ジャンル選択ロジック
- [ ] Meta Graph API で Instagram フィード投稿
- [ ] Meta Graph API で Threads 投稿 (連動)
- [ ] Instagram ストーリーズ配信 (別 API)
- [ ] 1 週間 dry-run (ステージング投稿 or 手動確認)
- [ ] 本番稼働開始

**Phase 2: 拡張 (1〜2 ヶ月)**
- [ ] HP ブログ機能追加 (`functions/api/blog/*` + `public/blog/`) — 効果次第で判断
- [ ] 投稿別の CV 計測 (UTM パラメータ付与)
- [ ] A/B テスト (曜日入れ替え、CTA 文言など)

**Phase 3: 拡張 (2 ヶ月以降)**
- [ ] YouTube Short 追加検討
- [ ] リール動画自動生成
- [ ] 週次レポート自動生成 (goandgoing53@gmail.com 宛)

---

## リスクと注意点

1. **既存投稿 13 件との整合**: 現在の @tusg_official フィードは統一デザインではない (絵文字・赤丸・緑色図形が混在)。自動投稿で新デザインを出すと世代混在で見える。
   - 案 A: 既存 13 件をアーカイブしてリセット (フォロワー 17 人には notice 出す)
   - 案 B: 上書きせず、下から新デザインが積み上がるのを待つ
2. **Meta アプリ審査**: LocoFlow の審査中に別アプリを追加審査するとリスク分散になる (どちらか通ればどちらかの用途で使える)
3. **誤投稿 blast radius**: 自動投稿は「気づかないうちに違う内容が公開されている」リスクがある。
   - Cloudflare Worker で「投稿予定内容を先に Slack へ通知 → 15 分後に自動実行」パターンを推奨
4. **AML 準拠**: SMBC 対応で決めた「実在せぬ人物写真は使わない」方針を SNS 投稿にも適用。生成画像は「イメージです」明記か、AI 生成であることを明示
5. **アカウント BAN**: Meta / Threads は自動投稿を厳密には禁止していないが、API 利用は quota / policy 遵守が必須。dry-run で頻度感を掴んでから本番へ
6. **info@tusg.site → info@tusg.co.jp 移行タイミング**: Instagram の連絡先メール、Meta アプリのオーナーメールも将来切替が必要

---

## 決めていただきたい残り事項

上記 A/B/C/D は決着。以下だけ残っています。

1. **Meta アプリの立て方**: 別アプリ新設 (推奨) / LocoFlow アプリに追加権限で通す
2. **既存 IG 投稿 13 件の扱い**: アーカイブしてリセット / そのまま残して下から新デザイン追加
3. **本メモの docs/ を box に自動 sync するか**: box 側の `sources/tusg-site.json` を更新すべきか
4. **Phase 1 の着手時期**: 今週から / SMBC 案件が落ち着いてから / etc

---

## 参考

- 関連 box ドキュメント:
  - `/home/user/box/locoreach/docs/POST_SCHEDULE_2026-08.md` (GBP 投稿予約の実装記録)
  - `/home/user/box/tusgplatform/artifacts/tusgplatform/tusg-ai/skills/reach-post-generation.md` (投稿生成の基本方針)
  - `/home/user/box/CLAUDE.md` (box 全体の運用ルール)
- 現行 tusg-site:
  - `wrangler.toml` (Cloudflare Pages + Functions 構成)
  - `functions/api/consultations.js` (Resend 連携 & 通知パターン参考)
  - `public/hearing.html` (30秒無料診断 LP = CTA 到達点)
