# beauty-seo-articles

美容マーケ向け「比較記事」SEO半自動システム（Playwright調査 + Claude Code執筆）。

**調査はスクリプトが自動で、執筆はClaude Code内で人間が指示して行う**ハイブリッド構成です。Anthropic APIの従量課金も外部検索API（SerpAPI等）も一切使わないため、**追加の金銭コストはゼロ**です。設計の全体像は [作戦書v4.md](作戦書v4.md) を参照してください。

## なにをするものか

「インスタ分析ツール◯◯選」のような **他社サービスの比較記事** を量産するための仕組みです。比較記事はリスク構造が特殊なため、次の3点に重点を置いています。

| リスク | 対策 |
|---|---|
| **他社ネガティブ表現**（最優先・絶対NG） | 執筆プロンプトで予防 → 執筆時セルフチェック → 任意の正規表現検査（`npm run check`）→ 人間レビュー、の多層防御 |
| **料金・機能の誤記** | 数値は**公式サイト直叩き由来のみ**採用。二次情報の数値は捨て、出典URLと取得日を必ず付与 |
| **景表法・ステマ・情報鮮度** | 最上級表現の検出、自社含有時のPR表記チェック、鮮度ディスクレーマーの自動挿入 |

> 設計思想：比較記事は「どれが一番良いか」ではなく「**あなたにはどれが合うか**（fit軸）」を提示するもの、と定義を固定することで、ネガティブ表現を構造的に減らしています。

## 役割分担

- **スクリプト（自動・課金ゼロ）**：比較対象の発掘 → SERPで競合の切り口調査 → 公式サイトから料金/機能取得 → `research.json` 生成 → **執筆プロンプト `output/prompts/{slug}.md` を生成**
- **人間 in Claude Code（課金ゼロ）**：生成されたプロンプトファイルを Claude Code に渡して執筆 → `output/drafts/{slug}.md` に保存 → 公開前チェック → CMSへ

## セットアップ

```bash
npm install
npx playwright install chromium
```

APIキー（`ANTHROPIC_API_KEY`）も `.env` も不要です。

## 使い方（運用フロー）

人間がやるのは **(A) テーマを足す → (B) 比較対象候補にOKを出す → (C) Claude Codeで執筆指示 → (D) 公開前チェック** の4つだけです。

### A. テーマを追加

[data/topics.csv](data/topics.csv) に記事テーマを1行追記します（`status=todo`）。

```csv
slug,title,keyword,category,status,priority,note
insta-analytics-tools,インスタ分析ツール比較7選,インスタ 分析ツール 比較,比較,todo,1,自社サービス含む=ステマ表記必須
```

### B. 比較対象の発掘と承認

```bash
# 候補を自動発掘 → output/candidates/{keyword}.csv を生成
npm run discover -- --keyword="インスタ 分析ツール"

# 候補CSVの approve 列を y/n に編集したのち、approve=y を data/tools.csv へ反映
npm run discover -- --commit
```

`discover` がSERP上位の比較記事からサービス名を抽出し、公式ドメイン/料金URLまで推定・検証します。**人間は候補CSVの `approve` を y/n にするだけ**で、URLを手で探す必要はありません（採否のハンコだけ人間が担保し、恣意的除外リスクを避けます）。

### C. 調査・執筆準備（自動）

```bash
# status=todo を priority 降順で N 件処理
npm run prep -- --count=5

# 特定テーマだけ処理する場合
npm run prep -- --only=insta-analytics-tools
```

各テーマについて research（SERP起点 + 公式直叩き）を行い、`output/research/{slug}.json` と `output/prompts/{slug}.md` を生成します。成功すると `topics.csv` の `status` が `ready` に（失敗時は `error`）更新されます。

> SERPが3エンジン（DuckDuckGo→Bing→Google）全滅しても、公式サイト直叩きだけで research を成立させる degrade パスがあるため、パイプラインは止まりません。

### C-2. Claude Code で執筆

生成されたプロンプトファイルのパスを Claude Code に渡して指示するだけです。

```
output/prompts/insta-analytics-tools.md を読んで記事を書いて、中立性・薬機法もチェックして
```

プロンプトmdは、執筆指示・体裁仕様・中立性ルール・research結果・セルフチェック指示・鮮度ディスクレーマーを1枚に連結した完結ファイルなので、これだけ読めば記事が書けます。出力は `output/drafts/{slug}.md` に保存します。

### D. 公開前チェック

```bash
# 生成済み記事を正規表現で機械的に再点検（任意・二重確認用）
npm run check -- --file=output/drafts/insta-analytics-tools.md
```

`check` は次の層を検査し、結果を記事末尾の `<!-- COMPLIANCE WARNINGS -->` ブロックに追記します：比較中立性 / 景表法 / ステマ / 薬機法 / 鮮度 / URL。

> ⚠️ 自動チェックは**明示的なNG語のみ**を対象とし、暗示的な他社ネガティブは拾えません。**最終責任は人間レビュー**にあります（このステップは省略不可）。

その他：

```bash
npm run typecheck   # tsc --noEmit
```

## ディレクトリ構成

```
beauty-seo-articles/
├── src/
│   ├── pipeline.ts        # prep のメイン。research→promptBuilder→保存→CSV更新（APIは呼ばない）
│   ├── research.ts        # Playwright調査（SERP起点 + 公式直叩き一次情報 + 共起語）
│   ├── serp.ts            # SERPエンジン抽象化（DuckDuckGo→Bing→Google／全滅でもdegrade）
│   ├── officialFetch.ts   # tools.csv の公式URLから料金/機能/更新日を抽出
│   ├── discover.ts        # 比較対象サービス候補を自動発掘（人間は承認のみ）
│   ├── promptBuilder.ts   # research.json＋体裁仕様＋中立性ルール → 執筆プロンプトmd生成
│   ├── check.ts           # 任意：生成済み記事mdを正規表現でcompliance検査
│   ├── neutralityCheck.ts # 他社ネガティブ表現の検出（check.tsから利用）
│   ├── freshness.ts       # 鮮度ディスクレーマー生成 + 料金データの取得日/出典検証
│   ├── urlValidator.ts    # 参考リンクがresearch.json由来か照合
│   ├── template.ts        # 比較記事の体裁仕様（promptBuilderに供給）
│   ├── browser.ts         # Playwright コンテキスト生成・throttle
│   ├── config.ts          # 並列度・throttle・パス設定（APIキー不要）
│   └── types.ts           # Topic / ToolEntry / ResearchResult / Warning 等
├── data/
│   ├── topics.csv         # 記事テーマ台帳（人間が編む）
│   ├── tools.csv          # 比較対象サービス台帳（discoverが追記）
│   └── ng-words.json      # 比較ネガティブ＋景表法最上級＋薬機法NG の検査辞書
├── prompts/
│   ├── system.md          # 比較記事テンプレ仕様 + 中立性ルール + 規制ガイドライン
│   └── examples/          # few-shot用サンプル（差し込み式）
└── output/                # スクリプト生成物（.gitignore対象）
    ├── research/{slug}.json   # 調査結果（料金/機能＋出典URL＋取得日）
    ├── prompts/{slug}.md      # Claude Codeに読ませる執筆プロンプト
    ├── candidates/{kw}.csv    # discoverの承認待ち候補
    └── drafts/{slug}.md       # Claude Codeで執筆した記事の保存先
```

## CSVスキーマ

**topics.csv**（記事テーマ）
```csv
slug,title,keyword,category,status,priority,note
```
`status` は `todo`（未処理）→ `ready`（調査・プロンプト生成済み）→ `done`（公開済み・手動）。失敗時は `error`。

**tools.csv**（比較対象サービス）
```csv
name,official_url,pricing_url,category,note
```
自社サービスを含める場合は `note` に「自社」を含めると、`check` のステマ層がPR表記の有無を検査します。

## 設計上の制約（このプロジェクトの中核）

- **他社を落とす文言は一切入れない。** 相対的ネガティブ表現を構造的に排除する。
- **AI以外に金銭コストをかけない。** 外部API（SerpAPI / Bing Web Search / 有料DB）は不使用。Playwright直叩きと公開JSONエンドポイントのみ。
- **Anthropic APIの従量課金も使わない。** 執筆はClaude Code内で行い、スクリプトはAPIを一切呼ばない。
- **一次情報は公式ドメインを正とする。** 料金などの数値は公式由来のみをJSONに入れ、二次情報の数値は採用しない。

詳細は [作戦書v4.md](作戦書v4.md) を参照してください。
