# 補助金試算ツール 制度ルール・監査メモ

このドキュメントは `public/js/subsidy-calculator/rules.js` の定数と、
UI/計算で用いている制度仕様の根拠を記録するものです。制度改訂時はこの
ファイルと `rules.js` の両方を更新し、PR で承認を得てください。

## 現在のバージョン

- `RULES_VERSION`: `jizokuka-r20-v8-2026-07-21`
- `RULES_LAST_VERIFIED`: `2026-10-29`

## 一次情報 (公式)

| 資料 | バージョン / 更新日 | URL |
|---|---|---|
| 第20回公募要領 | 第8版 (2026-07-21) | https://official.jizokukanb.com/shinsei |
| 第20回 公式FAQ・参考資料 | 2026-10-22 更新 | 上記ページ内のリンク |
| 中小企業庁・ミラサポplus「補助金は後払い」 | — | https://mirasapo-plus.go.jp/hint/25788/ |
| 中小企業庁・マル経融資によるつなぎ資金活用 | — | https://mirasapo-plus.go.jp/infomation/32093/ |

## 定数と根拠

### 補助率

| key | 値 | 根拠 |
|---|---|---|
| `SUBSIDY_RATE_GENERAL` | `2/3` | 一般事業者（原則） |
| `SUBSIDY_RATE_DEFICIT` | `3/4` | 赤字事業者（別途厳格判定。自動適用禁止） |

### 枠別の総補助上限 (`PROGRAM_CAPS`)

| key | 円 | 枠名 | 備考 |
|---|---:|---|---|
| `normal` | 500,000 | 通常枠 | 既定値。条件なし |
| `wage` | 1,000,000 | 賃金引上げ枠 | 事業場内最低賃金引上げが条件 |
| `business_transition` | 2,000,000 | 卒業枠 | 一定の条件 |
| `graduation` | 2,500,000 | 卒業枠 (最大) | さらに厳しい条件 |

初期値は `normal` を強制し、他の枠を使うには明示的な条件確認が必要であることを UI に表示する義務あり。

### 費目別の補助金額上限 (`ITEM_GRANT_CAPS`)

| 費目 | 補助金上限 | 根拠 |
|---|---:|---|
| ウェブサイト関連費 (web) | 300,000 円 | 公募要領 補助対象経費 |
| 広報費 (pr) | 300,000 円 | 公募要領 補助対象経費 |
| その他 (other) | — | 個別上限なし。総補助上限と補助率による制約のみ |

### 単独申請不可の費目 (`SOLO_PROHIBITED_ITEMS`)

- `web` 単独での申請不可
- `pr` 単独での申請不可
- 他の販路開拓対象経費と組み合わせることが必要

> UI は上記費目が単独で入力された場合、警告を表示する。

### 補助対象外 (重要)

- **利息・融資手数料**: 原則補助対象外
- **消費税**: 原則補助対象外（公募要領の例外は個別判定）
- **月額保守費**: 本補助金の対象外（運用経費）
- **既発注・既支払分**: 補助対象外（交付決定前の発注は原則禁止）

これらは `additionalCashCosts` として入力され、無交付時の最大想定負担には加算されるが、
`totalGrant` の計算には**絶対に含めない**。

## 禁止事項（本ツールでも実装・案内禁止）

| 禁止事項 | 理由 |
|---|---|
| キャッシュバック | 補助金の不正受給（返還命令・不採択） |
| 自己負担還元・立替 | 同上 |
| 架空支払・名義貸し | 同上 |
| 形式的資金循環 | 同上 |
| 発注金額水増し | 同上 |
| 売主への補助金入金を前提とした立替請求 | 同上 |

TUSG が制作会社として関与する案件では、申請者本人の名義で発注・支払・証拠保存を
行うよう案内する。関連当事者取引・販売会社自らの融資・後払い提供を行う場合は、
個別の法務審査を必須とする。

## 計算アルゴリズム

### `calcGrant`

```
webGrant = min(floor(web * rate), 300000)
prGrant  = min(floor(pr  * rate), 300000)
otherGrant = floor(other * rate)
sumItemGrants = webGrant + prGrant + otherGrant
rateGrant = floor(eligibleTotal * rate)
totalGrant = min(programCap, rateGrant, sumItemGrants)
netTaxExcluded = eligibleTotal - totalGrant
```

### `reverseByTargetNet`

目標最終負担から事業費上限を二分探索。費目構成の比率を保ったまま eligibleTotal を増減し、
`net(eligibleTotal) <= target` を満たす最大値を求める。

- `basis = "tax_excluded"`: `net = eligibleTotal - totalGrant`
- `basis = "tax_included_cash"`: `net = floor(eligibleTotal * (1 + taxRate)) - totalGrant`

費目上限 (web/pr の 30万) により、target が大きくても単純 ×3 の過大試算にはならない。

### `cashflow`

```
loanUsable = (status === "received") ? loan.amount : 0
totalUsable = ownCash + loanUsable
initialShortage = max(0, prepaidTaxIncluded - totalUsable)
loanRemaining = (status === "received")
  ? max(0, loan.amount - min(loan.amount, grantReceived))
  : loan.amount
feasibleToStart = (initialShortage === 0)
```

**借入入金額を経済負担（grantNet / zeroGrantMax）から控除しない**。
借入は資金繰りの判定にのみ使用し、利息・手数料は `additionalCashCosts` 等で別途計上する。

## 必須テスト

`tests/subsidy-calculator.test.mjs` を参照。
- `node --test tests/subsidy-calculator.test.mjs` で 25 ケース（計算仕様 12 + 必須表示 8 + 逆算 3 + 追加 2）を全通過すること。

## 制度改訂時のフロー

1. 一次情報（公募要領）の最新版 URL を確認し、変更点を本ドキュメントに記録
2. `rules.js` の該当定数を更新
3. `RULES_VERSION` と `RULES_LAST_VERIFIED` を更新
4. 影響するテストを追加・修正
5. PR を作成し、関係者のレビューを経てマージ

## 本ツールが保証しないこと

- 採択の可能性
- 交付の確実性
- 消費税の仕入税額控除その他の税務効果
- 融資の実行可能性・金利・手数料
- 既存契約・既存発注分の補助対象性
