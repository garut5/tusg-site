# tusg-autopost-cron (無効化中)

⚠ このディレクトリは **Cloudflare Workers Paid 契約 or 他 Worker の cron を 1 つ空ける**
まで有効にできない状態です。

## なぜ無効化されているか

Cloudflare Workers **無料枠は account あたり cron trigger 5 個** が上限。
このアカウントは既に:
- fanmap-cron (1)
- foodtap-cron (1)
- loconight-cron (1)
- locoreach-scheduler (2)

の 5 個を使い切っており、TUSG 用の cron を追加できない。

## 現在の代替案

`.github/workflows/autopost-cron.yml` (GitHub Actions cron) で毎日 20:00 JST に
`POST /api/autopost/scheduled` を叩いている。GitHub Actions cron は無料枠内。

## この Worker を有効化する条件

以下のいずれかが実施されたら、このディレクトリを `workers/tusg-autopost-cron/`
に戻して `npx wrangler deploy --config workers/tusg-autopost-cron/wrangler.toml`
で再デプロイできる。

1. **Cloudflare Workers Paid に切替** ($5/月、cron 上限 1,000 個に増加)
2. **既存 cron を 1 つ削除**
   - `fanmap-cron`, `foodtap-cron`, `loconight-cron`, `locoreach-scheduler` のいずれか
   - どれも他アプリで使用中なので、削除する前に用途確認必須

GitHub Actions 版で運用が安定していれば、そのままで問題ない
(むしろリポジトリ内で完結して管理が楽)。
