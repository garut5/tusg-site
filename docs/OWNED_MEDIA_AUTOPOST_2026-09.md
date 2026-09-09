# TUSG 自社メディア自動投稿 計画メモ

作成: 2026-09-09
起票者: 坂本 (合同会社TUSG)
記録: セッション中の口頭依頼 (「カモミールが LOCOREACH でやっている毎日自動投稿を、TUSG でもやりたい」)

---

## 背景

camomile 側の Claude Code に、`locoreach-daily-autopost` (別名 "Owned-Media locoreach-autopost") という**プラグイン (skill)** が enable されている。box (`garut5/box`) に skill 本体の実装コードは無いが、marketplace 経由でロードされる skill として camomile アカウントで稼働している。

その skill の要旨 (skill listing の記載):

- **対象**: LOCOREACH (店舗集客 AI ツール) の公式 Instagram `@locoreach_ai`
- **カルーセル生成 (7 ジャンル 曜日ローテ)**:
  - 月: MEO
  - 火: Instagram 集客
  - 水: 店舗 × AI
  - 木: AIO (AI 最適化)
  - 金: HP 集客
  - 土: 口コミ
  - 日: 店舗経営
- **統一デザイン**: ネイビー基調 + ジャンル別アクセント / グリッド安全設計
- **投稿先**: Instagram フィード + ストーリーズ + Threads
- **時刻**: 毎日 20:00 JST
- **リール動画**の自動生成も含む

TUSG (合同会社TUSG) でも、これと同等の「自社メディア毎日自動投稿」を回したい。投稿先は:
1. **Instagram** (フィード + ストーリーズ)
2. **Threads**
3. **YouTube Short**
4. **ホームページのブログ** (tusg.site / tusg.co.jp)

---

## LOCOREACH 版と TUSG 版の対比 (仮)

| 項目 | LOCOREACH 版 | TUSG 版 (案) |
|---|---|---|
| ターゲット読者 | 店舗経営者・集客担当 | 中小事業者・店舗経営者 (TUSG が支援したい層) |
| ブランド色 | ネイビー基調 | TUSG のダークグリーン系 (現行 HP: #0F3D2E 系) |
| Instagram | @locoreach_ai | **未確定** (@tusg_official など要決定) |
| Threads | 連携済 | **未確定** |
| YouTube Short | (対象外) | **要検討** (LOCOREACH 版に無い枠) |
| HP ブログ | (対象外) | **要検討** (LOCOREACH 版に無い枠) |
| 曜日ローテ | 月〜日 7 ジャンル | 案: 月DX事例/火SaaS紹介/水店舗×AI/木システム開発の考え方/金HP集客/土販売代理・OEM/日経営マインド |
| 時刻 | 毎日 20:00 JST | 20:00 JST (同じで OK か、TUSG 独自時刻か) |
| リール | あり | Short と統合して扱う想定 |

---

## 決めていただきたいこと (優先順)

### A. TUSG 側の SNS アカウント (最重要)

1. **Instagram**: TUSG 用の公式アカウント名・URL はありますか?
   - なければ新規作成が必要 (ビジネスアカウント化 & Meta 開発者連携必要)
2. **Threads**: Instagram とセットで自動作成可能。運用意思の確認だけ
3. **YouTube チャンネル**: TUSG の YouTube チャンネルは存在しますか? (Short 投稿には必須)
4. **HP ブログ**: tusg.site 側にブログ機能は現状無し。作るなら公開先を tusg.site にするか tusg.co.jp にするか

### B. コンテンツの方向性

1. **7 ジャンル案**の上記の割り当ては合っていますか? (下書き案なので大幅変更 OK)
2. **投稿の目的**は何か:
   - (a) TUSG のブランド認知向上
   - (b) SaaS 販売代理事業への問い合わせ獲得
   - (c) 販売代理店パートナーの新規開拓
   - (d) 上記の複合 (優先度は?)
3. **投稿の温度感**: LOCOREACH 版と揃える (ネイビー + フラット) or 完全に TUSG ブランドで作り直す

### C. 実装アプローチ

1. **camomile 側の既存 skill を "TUSG 用に多アカウント化" する**
   - メリット: 既存資産を最大活用、運用ノウハウ引継ぎ
   - デメリット: skill 本体の修正が必要 (camomile 開発者の作業必要)
2. **TUSG 用に skill を新規作成する** (LOCOREACH 版を参考に)
   - メリット: TUSG 独自の設計 (YouTube Short, HP ブログ枠) を最初から入れられる
   - デメリット: 新規開発コスト
3. **既存 skill を丸ごとフォーク → TUSG 用に改造**
   - 中間案

推奨: **1 → 2 の段階移行**。まず既存 skill にアカウント切替機能 (LOCOREACH / TUSG) を足して即運用開始、後で YouTube Short と HP ブログ枠を TUSG 版だけに追加する。

### D. 投稿先の技術要件

| 投稿先 | 必要な API / 連携 | 現状 (TUSG 側) |
|---|---|---|
| Instagram フィード | Meta Graph API (Instagram Business Account) | **未確認** |
| Instagram ストーリーズ | 同上 | **未確認** |
| Threads | Threads API (Meta) | **未確認** |
| YouTube Short | YouTube Data API v3 | **未確認** |
| HP ブログ | Cloudflare Pages Functions で API 実装 + 記事一覧ページを新規作成 | **未実装** (現状 tusg-site に blog 機能なし) |

---

## 次のアクション候補

### Phase 0: 準備・仕様確定 (今週)

- [ ] TUSG 用 Instagram / Threads / YouTube アカウントの存在確認
- [ ] 7 ジャンル案の確定
- [ ] 投稿目的の確定 (KPI 設計込み)
- [ ] camomile 側にリクエスト: skill の多アカウント化検討

### Phase 1: 既存 skill 借用 (2〜3 週間)

- [ ] LOCOREACH 版 skill を TUSG アカウントで動くように改修 (camomile 側で作業)
- [ ] TUSG ブランドカラーへの色替え設定
- [ ] 7 ジャンル分の TUSG 用テンプレを 1 サイクル分作成
- [ ] 20:00 JST 起動確認、1 週間 dry-run
- [ ] 本番稼働開始

### Phase 2: TUSG 独自枠追加 (1〜2 ヶ月)

- [ ] YouTube Short 自動投稿の追加
- [ ] HP ブログ機能の tusg-site 実装:
  - `functions/api/blog/publish.js` (投稿受け付け)
  - `functions/api/blog/[slug].js` (単記事)
  - `public/blog/` (一覧ページ)
  - D1 or KV でストレージ
- [ ] skill から 4 チャネル (Insta + Threads + YouTube + Blog) に同時配信

### Phase 3: 分析・最適化 (継続)

- [ ] 投稿別リーチ・エンゲージ計測
- [ ] ジャンル別勝ちパターン抽出
- [ ] 週次レポート自動生成

---

## リスク・注意点

1. **Meta Developer 側の審査**: 現在 LocoFlow アプリ (info@tusg.site) で審査待ちがあり、TUSG 用 Instagram/Threads 連携も同アプリの追加権限で通すか、別アプリで通すか検討必要
2. **投稿ミスの blast radius**: 自動投稿は「気づいたら誤った内容が公開されている」リスクがある。ドライラン期間 + ステージング (下書き投稿) の仕組みを最初から入れる
3. **アカウント BAN リスク**: Meta / YouTube の自動投稿には rate limit と品質基準あり。camomile 側の運用実績をベンチマークにする
4. **TUSG の実態と齟齬**: SMBC AML 対応で「実在せぬスタッフ・顧客の映像を使わない」方針にしたばかり。同じ規律を SNS 投稿にも適用する必要あり (ストック画像・生成画像の使い方に注意)
5. **info@tusg.site → info@tusg.co.jp 移行**: SNS アカウント連絡先メールを co.jp に切り替えるタイミング設計

---

## 参考

- box 内での関連ドキュメント:
  - `/home/user/box/locoreach/docs/POST_SCHEDULE_2026-08.md` (GBP 投稿予約の実装記録、SNS 自動投稿とは別だが設計思想は参考になる)
  - `/home/user/box/tusgplatform/artifacts/tusgplatform/tusg-ai/skills/reach-post-generation.md` (TUSG 系 REACH 投稿生成の基本方針)
  - `/home/user/box/CLAUDE.md` (box 全体の運用ルール)
- 現行 tusg-site 側の関連:
  - `wrangler.toml` (Cloudflare Pages + Functions 構成、ブログ機能追加時のベース)
  - `functions/api/consultations.js` (Resend 連携パターン、通知系の参考)
