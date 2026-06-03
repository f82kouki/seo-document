// 作戦書v4 §4 config.ts
// 並列度・throttle・パス・各種しきい値の一元管理。
// 重要: APIキーは一切不要（スクリプトはAnthropic APIを呼ばない）。.env も使わない。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** プロジェクトルート（src/ の1つ上） */
export const ROOT = path.resolve(__dirname, '..');

/** 入出力パスの一元定義。相対パス散乱を防ぐ。 */
export const paths = {
  root: ROOT,

  // data/（人間が編む台帳と検査辞書）
  data: path.join(ROOT, 'data'),
  topics: path.join(ROOT, 'data', 'topics.csv'),
  tools: path.join(ROOT, 'data', 'tools.csv'),
  ngWords: path.join(ROOT, 'data', 'ng-words.json'),
  sources: path.join(ROOT, 'data', 'sources.json'),

  // prompts/（執筆プロンプトの素材）
  prompts: path.join(ROOT, 'prompts'),
  systemPrompt: path.join(ROOT, 'prompts', 'system.md'),
  examples: path.join(ROOT, 'prompts', 'examples'),

  // output/（スクリプト生成物。.gitignore 対象）
  output: path.join(ROOT, 'output'),
  research: path.join(ROOT, 'output', 'research'),
  outputPrompts: path.join(ROOT, 'output', 'prompts'),
  candidates: path.join(ROOT, 'output', 'candidates'),
  drafts: path.join(ROOT, 'output', 'drafts'),
} as const;

/** Playwright のブラウザ偽装設定（実在ブラウザ相当・日本語ロケール）。 */
export const browser = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'ja-JP',
  viewport: { width: 1280, height: 800 },
  /** ナビゲーションのタイムアウト(ms) */
  navTimeoutMs: 30_000,
} as const;

/** リクエスト間のランダムthrottle(ms)。SERPは長め、公式は軽め。 */
export const throttle = {
  serpMinMs: 1_500,
  serpMaxMs: 3_000,
  officialMinMs: 1_000,
  officialMaxMs: 2_000,
} as const;

/** 同時実行数。Playwrightは2並列固定（API並列は存在しない）。 */
export const concurrency = {
  playwright: 2,
} as const;

/**
 * SERPエンジンのフォールバック順。前段が0件/CAPTCHAなら次へ。
 * 3エンジン全滅でも例外を投げず、公式直叩きだけで research を成立させる（degrade必須）。
 */
export const serpEngineOrder = ['duckduckgo', 'bing', 'google'] as const;

/** 鮮度しきい値。fetchedAt がこの日数を超えたら警告。 */
export const freshness = {
  staleAfterDays: 30,
} as const;

/** suggestqueries（公開JSON・CAPTCHAなし）でサジェスト拡張する際のエンドポイント。 */
export const suggest = {
  endpoint: 'https://suggestqueries.google.com/complete/search',
  params: { client: 'firefox', hl: 'ja' },
} as const;
