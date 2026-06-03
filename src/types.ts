// 作戦書v4 §4 types.ts
// パイプライン全体で共有する型。APIは使わないため、Anthropic関連の型は存在しない。

/** topics.csv の status 列。原子的に todo→ready / error と遷移し、公開時に人間が done にする。 */
export type TopicStatus = 'todo' | 'ready' | 'error' | 'done';

/** 記事テーマ（topics.csv の1行） */
export interface Topic {
  slug: string;
  title: string;
  keyword: string;
  category: string;
  status: TopicStatus;
  /** 数値が大きいほど優先（prep は priority 降順で拾う） */
  priority: number;
  /** 例: "自社サービス含む=ステマ表記必須" */
  note: string;
}

/** 比較対象サービス（tools.csv の1行）。料金・機能はここの公式URLからのみ採る。 */
export interface ToolEntry {
  name: string;
  officialUrl: string;
  pricingUrl?: string;
  category: string;
  note?: string;
}

/** SERP1件分。あくまで「競合の切り口把握」の起点であり、数値根拠には使わない。 */
export interface SerpEntry {
  rank: number;
  url: string;
  title: string;
  snippet: string;
  h2: string[];
  h3: string[];
  faq: string[];
  /** <time> や article:modified_time から拾えれば */
  lastUpdated?: string;
}

/** 公式から取得した料金プラン1件。price は表記ゆれを保つため文字列のまま保持。 */
export interface PricingPlan {
  name: string;
  /** 例: "¥4,980", "$29", "無料" — 公式表記のまま */
  price: string;
  /** 例: "月額", "年額", "buy-once" */
  billingCycle?: string;
}

/** 公式直叩きの一次情報。記事の数値根拠はここだけ。sourceUrl/fetchedAt は必須。 */
export interface OfficialData {
  toolName: string;
  /** 取得元の公式URL（料金ページ優先） */
  sourceUrl: string;
  /** 取得日時（ISO8601）。freshness が陳腐化判定に使う。 */
  fetchedAt: string;
  plans: PricingPlan[];
  features: string[];
  targetUser?: string;
  /** ページ側の最終更新日（<time> / meta） */
  lastUpdated?: string;
}

/** SERP取得に使ったエンジン。'none' は全滅して公式直叩きのみで成立した degrade を表す。 */
export type SerpEngine = 'duckduckgo' | 'bing' | 'google' | 'none';

/** 1テーマ分の調査結果。output/research/{slug}.json として保存される。 */
export interface ResearchResult {
  slug: string;
  keyword: string;
  fetchedAt: string;
  engine: SerpEngine;
  /** 起点（切り口把握用）。空配列でも可（degrade時）。 */
  serp: SerpEntry[];
  /** 記事の数値根拠はここだけ。 */
  officialData: OfficialData[];
  coOccurringTerms: string[];
}

/** compliance検査の警告レイヤー。 */
export type WarningLayer =
  | '比較中立性'
  | '景表法'
  | 'ステマ'
  | '薬機法'
  | '鮮度'
  | 'URL';

export type WarningSeverity = 'high' | 'mid';

/** check.ts / 各検査部品が返す警告1件。 */
export interface Warning {
  layer: WarningLayer;
  severity: WarningSeverity;
  /** ヒットした語・値 */
  match: string;
  /** 周辺テキスト（人間が判断するための文脈） */
  context: string;
  line?: number;
}

/** Claude Codeが執筆し、人間が output/drafts/{slug}.md に保存した記事の検査対象表現。 */
export interface Article {
  slug: string;
  markdown: string;
  warnings: Warning[];
  referencedUrls: string[];
}

/** discover.ts が出力する承認待ち候補（output/candidates/{keyword}.csv の1行）。 */
export interface Candidate {
  name: string;
  officialUrl: string;
  pricingUrl?: string;
  /** 比較記事群での出現回数（多いほど主要） */
  occurrences: number;
  /** 人間が y/n を打つ。既定は '?'（未判断）。 */
  approve: 'y' | 'n' | '?';
  note?: string;
}
