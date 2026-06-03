// 作戦書v4 §4 pipeline.ts（prep：research→promptBuilder→保存→CSV更新。APIは呼ばない）
// 使い方: npm run prep -- --count=5 [--only=slug]
// 1) topics.csv から status=todo を priority降順でN件
// 2) 各テーマ: research（serp起点＋official直叩き）→ promptBuilder
//    → output/prompts/{slug}.md と output/research/{slug}.json を保存（執筆はしない）
// 3) 保存成功を確認してから CSV を status=ready 更新（失敗時 status=error。原子性確保）

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

import type { ResearchResult, ToolEntry, Topic, TopicStatus } from './types.js';
import { paths } from './config.js';
import { research } from './research.js';
import { writePrompt } from './promptBuilder.js';

const TOPIC_COLUMNS = ['slug', 'title', 'keyword', 'category', 'status', 'priority', 'note'] as const;

// ---- 引数 ----
function parseArgs(): { count: number; only?: string } {
  const countArg = process.argv.find((a) => a.startsWith('--count='));
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const count = countArg ? Math.max(1, parseInt(countArg.slice('--count='.length), 10) || 1) : 5;
  const only = onlyArg ? onlyArg.slice('--only='.length) : undefined;
  return { count, only };
}

// ---- topics.csv 読み書き ----
function loadTopics(): Topic[] {
  if (!fs.existsSync(paths.topics)) {
    console.error(`topics.csv が見つかりません: ${paths.topics}`);
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(paths.topics, 'utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;
  return rows.map((r) => ({
    slug: r.slug ?? '',
    title: r.title ?? '',
    keyword: r.keyword ?? '',
    category: r.category ?? '',
    status: (r.status ?? 'todo') as TopicStatus,
    priority: Number(r.priority ?? '0') || 0,
    note: r.note ?? '',
  }));
}

/** 指定slugのstatusを更新して topics.csv を書き戻す（全行保持）。 */
function updateStatus(allTopics: Topic[], slug: string, status: TopicStatus): void {
  const target = allTopics.find((t) => t.slug === slug);
  if (target) target.status = status;
  const csv = stringify(
    allTopics.map((t) => ({
      slug: t.slug,
      title: t.title,
      keyword: t.keyword,
      category: t.category,
      status: t.status,
      priority: t.priority,
      note: t.note,
    })),
    { header: true, columns: TOPIC_COLUMNS as unknown as string[] },
  );
  fs.writeFileSync(paths.topics, csv, 'utf-8');
}

// ---- tools.csv 読み込み ----
function loadTools(): ToolEntry[] {
  if (!fs.existsSync(paths.tools)) return [];
  const rows = parse(fs.readFileSync(paths.tools, 'utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;
  return rows.map((r) => ({
    name: r.name ?? '',
    officialUrl: r.official_url ?? '',
    pricingUrl: r.pricing_url || undefined,
    category: r.category ?? '',
    note: r.note ?? '',
  }));
}

function saveResearch(result: ResearchResult): string {
  fs.mkdirSync(paths.research, { recursive: true });
  const p = path.join(paths.research, `${result.slug}.json`);
  fs.writeFileSync(p, JSON.stringify(result, null, 2), 'utf-8');
  return p;
}

// ---- main ----
async function main(): Promise<void> {
  const { count, only } = parseArgs();
  const allTopics = loadTopics();
  const tools = loadTools();

  let queue = allTopics
    .filter((t) => t.status === 'todo')
    .sort((a, b) => b.priority - a.priority);
  if (only) queue = queue.filter((t) => t.slug === only);
  queue = queue.slice(0, count);

  if (queue.length === 0) {
    console.log('処理対象の todo がありません（--only 指定や status を確認してください）。');
    return;
  }

  console.log(`prep 対象: ${queue.length}件 / 比較対象(tools): ${tools.length}件`);
  console.log(`API課金: なし（Playwright直叩き + 公開JSONのみ）\n`);

  for (const topic of queue) {
    console.log(`── [${topic.slug}] "${topic.title}" 調査開始 ──`);
    try {
      // research（serp起点＋official直叩き。SERP全滅でも degrade）
      const result = await research(topic, tools);

      // 先に成果物を保存してから status を更新（原子性）
      const researchPath = saveResearch(result);
      const promptPath = writePrompt(result, topic);

      updateStatus(allTopics, topic.slug, 'ready');
      console.log(`  ✓ SERPエンジン: ${result.engine} / 公式データ ${result.officialData.length}件`);
      console.log(`  ✓ research: ${researchPath}`);
      console.log(`  ✓ prompt  : ${promptPath}`);
      console.log(`  → status=ready\n`);
    } catch (e) {
      updateStatus(allTopics, topic.slug, 'error');
      console.error(`  ✗ 失敗: ${(e as Error).message}`);
      console.error(`  → status=error\n`);
    }
  }

  console.log('完了。各 output/prompts/{slug}.md を Claude Code で開いて執筆してください。');
  console.log('  例: 「output/prompts/' + queue[0]!.slug + '.md を読んで記事を書いて、中立性・薬機法もチェックして」');
}

main();
