// 作戦書v4 §4 promptBuilder.ts（★v4の核・writer.tsを置き換え）
// 役割: Claude Codeに読ませる「執筆プロンプト1枚」を組み立てて output/prompts/{slug}.md に保存する。
//       APIは呼ばない。このmdだけ読めば記事を書けるよう、以下を1ファイルに連結する:
//   1) 執筆指示  2) 体裁仕様(system.md + template.ts)  3) few-shot(examples/*.md)
//   4) 中立性ルール(system.md内)  5) research部  6) セルフチェック指示  7) 鮮度ディスクレーマー文面

import fs from 'node:fs';
import path from 'node:path';

import type { ResearchResult, Topic } from './types.js';
import { paths } from './config.js';
import { renderTemplateSpec } from './template.js';
import { freshnessDisclaimer } from './freshness.js';

/** prompts/system.md を読む（体裁・中立性・規制・セルフチェックの本体）。 */
function readSystemPrompt(): string {
  return fs.readFileSync(paths.systemPrompt, 'utf-8');
}

/** 薬機法（化粧品の効能）の論点が含まれるテーマかを判定する語。 */
const YAKKIHO_PATTERN =
  /薬機法|薬事法|医薬部外品|効能|効果効能|化粧品|コスメ|スキンケア|基礎化粧品|メイク|美白|保湿|シミ|シワ|ニキビ|肌荒れ|エイジング/;

/**
 * research と topic から「薬機法（化粧品効能）の論点があるテーマか」を判定する。
 * 取ってきた競合記事（SERPタイトル/スニペット/見出し）や公式データ、テーマ語に
 * 化粧品効能まわりの語が出てくる場合のみ true。出てこなければ薬機法節は出さない。
 */
function detectYakkihoRelevant(research: ResearchResult, topic: Topic): boolean {
  const haystack = [
    topic.title,
    topic.keyword,
    topic.category,
    topic.note ?? '',
    ...research.serp.flatMap((s) => [s.title, s.snippet, ...s.h2, ...s.h3, ...s.faq]),
    ...research.officialData.flatMap((d) => [
      d.toolName,
      d.targetUser ?? '',
      ...d.features,
    ]),
  ].join(' ');
  return YAKKIHO_PATTERN.test(haystack);
}

/** prompts/examples/*.md を few-shot として読む（.gitkeep等は除外）。 */
function readExamples(): { name: string; body: string }[] {
  if (!fs.existsSync(paths.examples)) return [];
  return fs
    .readdirSync(paths.examples)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      name: f,
      body: fs.readFileSync(path.join(paths.examples, f), 'utf-8'),
    }));
}

/** research の officialData / 競合見出し / 共起語 / 参考URL許可リストを読みやすく整形。 */
function renderResearchSection(research: ResearchResult): string {
  const lines: string[] = [];

  // --- 料金・機能（記事の数値根拠はここだけ） ---
  lines.push('### 料金・機能（公式直叩きの一次情報 / 記事の数値根拠はここだけ）');
  if (research.officialData.length === 0) {
    lines.push(
      '⚠️ 公式データが取得できていません。料金・プラン名・機能を**創作しないでください**。' +
        '数値が必要な箇所は「各公式サイトで最新をご確認ください」と促すに留めること。',
    );
  } else {
    for (const d of research.officialData) {
      lines.push('');
      lines.push(`#### ${d.toolName}`);
      lines.push(`- 出典: ${d.sourceUrl}`);
      lines.push(`- 取得日: ${d.fetchedAt}${d.lastUpdated ? ` / ページ最終更新: ${d.lastUpdated}` : ''}`);
      if (d.plans.length > 0) {
        lines.push('- 料金プラン:');
        for (const p of d.plans) {
          lines.push(`  ・${p.name}：${p.price}${p.billingCycle ? `（${p.billingCycle}）` : ''}`);
        }
      } else {
        lines.push('- 料金プラン: （取得できず。創作しないこと）');
      }
      if (d.features.length > 0) {
        lines.push(`- 主な機能（候補）: ${d.features.slice(0, 12).join(' / ')}`);
      }
      if (d.targetUser) lines.push(`- 想定ユーザー: ${d.targetUser}`);
    }
  }

  // --- 競合の切り口（SERP起点・見出し） ---
  lines.push('');
  lines.push('### 競合記事の切り口（見出し・あくまで構成の参考。数値は採用しない）');
  if (research.serp.length === 0) {
    lines.push('（SERP取得なし＝起点情報なし。公式データと一般知識の範囲で構成すること）');
  } else {
    research.serp.slice(0, 5).forEach((s) => {
      lines.push(`- [#${s.rank}] ${s.title}`);
      if (s.h2.length > 0) lines.push(`    見出し例: ${s.h2.slice(0, 6).join(' / ')}`);
    });
  }

  // --- 共起語 ---
  if (research.coOccurringTerms.length > 0) {
    lines.push('');
    lines.push('### 共起語（見出し・FAQの着想に。詰め込みすぎない）');
    lines.push(research.coOccurringTerms.slice(0, 20).join(' / '));
  }

  // --- 参考リンク許可リスト（これ以外のURLは書かない） ---
  const allowedUrls = research.officialData.map((d) => d.sourceUrl);
  lines.push('');
  lines.push('### 参考リンクに使ってよいURL（これ以外は書かない＝新規URL生成禁止）');
  if (allowedUrls.length === 0) {
    lines.push('（research由来の公式URLがありません。参考リンクは無理に作らず、公式名の明記に留める）');
  } else {
    for (const u of allowedUrls) lines.push(`- ${u}`);
  }

  return lines.join('\n');
}

/**
 * 執筆プロンプト1枚を組み立てて返す（保存はしない）。
 */
export function buildPrompt(research: ResearchResult, topic: Topic): string {
  const system = readSystemPrompt();
  const includeYakkiho = detectYakkihoRelevant(research, topic);
  const templateSpec = renderTemplateSpec({ includeYakkiho });
  const examples = readExamples();

  const fetched = new Date(research.fetchedAt);
  const disclaimer = freshnessDisclaimer(fetched.getFullYear(), fetched.getMonth() + 1);

  const parts: string[] = [];

  // 0) ヘッダ（この1枚で何をするか）
  parts.push(`# 執筆プロンプト：${topic.title}（slug: ${topic.slug}）`);
  parts.push('');
  parts.push(
    'このファイル**1枚だけ**を読んで、美容マーケ向けの比較記事を書いてください。' +
      '体裁・中立性ルール・規制ガイド・調査データ・セルフチェック指示・鮮度ディスクレーマーはすべて以下に含まれています。',
  );
  parts.push('');
  parts.push('## 執筆指示');
  parts.push(
    [
      `- テーマ: 「${topic.title}」 / 狙いキーワード: 「${topic.keyword}」 / カテゴリ: ${topic.category}`,
      topic.note ? `- テーマ補足: ${topic.note}` : '',
      includeYakkiho
        ? '- 薬機法: 今回の調査データには化粧品の効能・薬機法に関わる論点が含まれます。「美容で特に注意（薬機法）」節を置き、56効能の範囲・断定表現NGに触れること。'
        : '- 薬機法: 今回の調査データには化粧品の効能・薬機法に関わる論点が見当たりません。「美容で特に注意（薬機法）」節は無理に設けないこと。化粧品の効能に触れる場合のみ、56効能の範囲で簡潔に補足するに留める。',
      '- 下の「体裁仕様」の構造・記法に厳密に従う。',
      '- 料金・機能は下の「調査データ（research）」の数値だけを使う（自分の知識で補わない）。',
      '- 参考リンクは「参考リンクに使ってよいURL」以外を書かない（新規URL生成禁止）。',
      '- 書き終えたら「執筆後セルフチェック」を必ず実施し、結果を記事末尾に箇条書きで付す。',
      `- 記事末尾に次の鮮度ディスクレーマーを必ず入れる：「${disclaimer}」`,
      '- 完成した記事本文を、人間が output/drafts/' + topic.slug + '.md に保存します。',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  // 1) 体裁・中立性・規制・セルフチェックの本体（system.md）
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('# 執筆システム仕様（体裁・中立性・規制・セルフチェック）');
  parts.push('');
  parts.push(system);

  // 2) 体裁仕様（template.ts）
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('# 体裁仕様（構造・記法・スケルトン）');
  parts.push('');
  parts.push(templateSpec);

  // 3) few-shot（examples）
  if (examples.length > 0) {
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push('# 参考例（few-shot：体裁・トーンの正）');
    for (const ex of examples) {
      parts.push('');
      parts.push(`## 例: ${ex.name}`);
      parts.push('');
      parts.push('```');
      parts.push(ex.body.trim());
      parts.push('```');
    }
  }

  // 4) research部
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('# 調査データ（research）');
  parts.push(`> 取得日時: ${research.fetchedAt} / SERPエンジン: ${research.engine}`);
  parts.push('');
  parts.push(renderResearchSection(research));

  // 5) 末尾リマインド（鮮度ディスクレーマー文面の再掲）
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('# 記事末尾に必ず入れる鮮度ディスクレーマー');
  parts.push('');
  parts.push('```');
  parts.push(disclaimer);
  parts.push('```');

  return parts.join('\n') + '\n';
}

/** プロンプトを output/prompts/{slug}.md に保存し、パスを返す。 */
export function writePrompt(research: ResearchResult, topic: Topic): string {
  const content = buildPrompt(research, topic);
  fs.mkdirSync(paths.outputPrompts, { recursive: true });
  const outPath = path.join(paths.outputPrompts, `${topic.slug}.md`);
  fs.writeFileSync(outPath, content, 'utf-8');
  return outPath;
}
