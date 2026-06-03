// 作戦書v4 §4 discover.ts（★比較対象の自動発掘・主役）
// 役割: 人間に代わって「比較すべき他社サービス」を探し、公式/料金URLまで揃えて承認待ち候補にする。
//   npm run discover -- --keyword="..."  → output/candidates/{keyword}.csv（approve既定 '?'）
//   npm run discover -- --commit [--keyword="..."] → approve=y を tools.csv に追記（名寄せでスキップ）
// 自動確定はしない＝採否のハンコは必ず人間（恣意的除外リスクへの担保）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { type BrowserContext } from 'playwright';

import type { Candidate, ToolEntry } from './types.js';
import { paths, throttle } from './config.js';
import { withContext, jitter } from './browser.js';
import { fetchSerp, fetchFromEngine } from './serp.js';

// ---- 候補名抽出ヒューリスティック ----
// 比較記事の見出し（h2/h3）から「サービス名らしい語」を拾う。完全自動の名寄せは難しいため、
// あくまで候補出し。最終採否は人間（approve）が担保する。
function extractServiceNames(headings: string[]): string[] {
  const names = new Set<string>();
  for (const h of headings) {
    // 「①ServiceName」「1. ServiceName」「ServiceName とは」などから語を抽出
    const cleaned = h.replace(/^[\s0-9①-⑳.．、）)（(【】「」]+/, '').trim();
    // 英字サービス名（先頭大文字 or 連結英字）
    for (const m of cleaned.matchAll(/[A-Z][A-Za-z0-9]{2,}/g)) {
      names.add(m[0]);
    }
    // カタカナ語（4文字以上の連続）
    for (const m of cleaned.matchAll(/[ァ-ヴー]{4,}/g)) {
      names.add(m[0]);
    }
  }
  return Array.from(names);
}

/** 上位SERP結果ページを開いて h2/h3 見出しを集める。 */
async function collectHeadings(
  ctx: BrowserContext,
  urls: string[],
  max: number,
): Promise<string[]> {
  const headings: string[] = [];
  for (const url of urls.slice(0, max)) {
    const tab = await ctx.newPage();
    try {
      await tab.goto(url, { waitUntil: 'domcontentloaded' });
      const hs = await tab.evaluate<string[]>(() =>
        Array.from(document.querySelectorAll('h2, h3'))
          .map((h) => (h.textContent ?? '').trim())
          .filter((t) => t.length > 0 && t.length <= 60),
      );
      headings.push(...hs);
    } catch {
      // 取得失敗ページはスキップ
    } finally {
      await tab.close();
      await jitter(throttle.serpMinMs, throttle.serpMaxMs);
    }
  }
  return headings;
}

/** サービス名から公式ドメイン/料金URLを推定・検証する。 */
async function resolveOfficialUrl(
  ctx: BrowserContext,
  name: string,
): Promise<{ officialUrl?: string; pricingUrl?: string; verified: boolean }> {
  // 「{name} 公式」でSERPし、先頭の妥当な結果を公式候補とする
  const outcome = await fetchFromEngine(ctx, 'duckduckgo', `${name} 公式`, 1);
  await jitter(throttle.serpMinMs, throttle.serpMaxMs);
  const top = outcome.results[0];
  if (!top) return { verified: false };

  // 公式ページを開き、タイトル/本文に name が含まれるか確認（推測のままにしない）
  const tab = await ctx.newPage();
  try {
    await tab.goto(top.url, { waitUntil: 'domcontentloaded' });
    const title = (await tab.title()) ?? '';
    const verified = title.toLowerCase().includes(name.toLowerCase());
    let origin = '';
    try {
      origin = new URL(top.url).origin;
    } catch {
      origin = top.url;
    }
    return { officialUrl: origin, pricingUrl: undefined, verified };
  } catch {
    return { officialUrl: top.url, verified: false };
  } finally {
    await tab.close();
  }
}

// ---- discover 本体 ----
async function discover(keyword: string): Promise<void> {
  console.log(`\n=== discover: "${keyword}" ===`);
  const { engine, results } = await fetchSerp(keyword, 1);
  console.log(`SERP起点エンジン: ${engine} / ${results.length}件`);
  if (results.length === 0) {
    console.log('SERPが全滅したため候補を発掘できません。キーワードを変えるか tools.csv を手動で編んでください。');
    return;
  }

  await withContext(async (ctx) => {
    const headings = await collectHeadings(ctx, results.map((r) => r.url), 5);
    const rawNames = extractServiceNames(headings);

    // 出現回数を見出し横断で集計
    const counts = new Map<string, number>();
    for (const h of headings) {
      for (const name of rawNames) {
        if (h.includes(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

    const candidates: Candidate[] = [];
    for (const [name, occ] of ranked.slice(0, 15)) {
      const resolved = await resolveOfficialUrl(ctx, name);
      candidates.push({
        name,
        officialUrl: resolved.officialUrl ?? '',
        pricingUrl: resolved.pricingUrl ?? '',
        occurrences: occ,
        approve: '?',
        note: resolved.verified ? '' : '公式URL未検証=採用時は手動確認',
      });
    }

    fs.mkdirSync(paths.candidates, { recursive: true });
    const safeKw = keyword.replace(/[\\/:*?"<>|\s]+/g, '_');
    const outPath = path.join(paths.candidates, `${safeKw}.csv`);
    const csv = stringify(
      candidates.map((c) => ({
        name: c.name,
        official_url: c.officialUrl,
        pricing_url: c.pricingUrl ?? '',
        occurrences: c.occurrences,
        approve: c.approve,
        note: c.note ?? '',
      })),
      { header: true, columns: ['name', 'official_url', 'pricing_url', 'occurrences', 'approve', 'note'] },
    );
    fs.writeFileSync(outPath, csv, 'utf-8');
    console.log(`候補 ${candidates.length}件を出力: ${outPath}`);
    console.log('→ approve 列を y/n に編集し、`npm run discover -- --commit` で tools.csv へ反映してください。');
    const unverified = candidates.filter((c) => c.note).length;
    if (unverified > 0) console.log(`⚠️ 公式URL未検証が ${unverified}件。採用するなら手動確認を。`);
  });
}

// ---- commit（approve=y を tools.csv へ） ----
function readToolNames(): Set<string> {
  if (!fs.existsSync(paths.tools)) return new Set();
  const rows = parse(fs.readFileSync(paths.tools, 'utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ToolEntry[];
  return new Set(rows.map((r) => r.name));
}

function commit(keyword?: string): void {
  if (!fs.existsSync(paths.candidates)) {
    console.log('候補CSVがありません。先に discover を実行してください。');
    return;
  }
  let files: string[];
  if (keyword) {
    const safeKw = keyword.replace(/[\\/:*?"<>|\s]+/g, '_');
    files = [path.join(paths.candidates, `${safeKw}.csv`)].filter((f) => fs.existsSync(f));
  } else {
    files = fs
      .readdirSync(paths.candidates)
      .filter((f) => f.endsWith('.csv'))
      .map((f) => path.join(paths.candidates, f));
  }
  if (files.length === 0) {
    console.log('対象の候補CSVが見つかりません。');
    return;
  }

  const existing = readToolNames();
  const toAppend: ToolEntry[] = [];
  for (const file of files) {
    const rows = parse(fs.readFileSync(file, 'utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;
    for (const r of rows) {
      if ((r.approve ?? '').toLowerCase() !== 'y') continue;
      const name = r.name?.trim();
      if (!name) continue;
      if (existing.has(name)) continue; // 名寄せスキップ
      existing.add(name);
      toAppend.push({
        name,
        officialUrl: r.official_url ?? '',
        pricingUrl: r.pricing_url || undefined,
        category: r.category ?? '',
        note: r.note ?? '',
      });
    }
  }

  if (toAppend.length === 0) {
    console.log('approve=y の新規行はありませんでした（既存は名寄せでスキップ）。');
    return;
  }

  const header = !fs.existsSync(paths.tools);
  const csv = stringify(
    toAppend.map((t) => ({
      name: t.name,
      official_url: t.officialUrl,
      pricing_url: t.pricingUrl ?? '',
      category: t.category,
      note: t.note ?? '',
    })),
    { header, columns: ['name', 'official_url', 'pricing_url', 'category', 'note'] },
  );
  fs.appendFileSync(paths.tools, (header ? '' : '') + csv, 'utf-8');
  console.log(`tools.csv に ${toAppend.length}件追記: ${toAppend.map((t) => t.name).join(', ')}`);
}

// ---- CLI ----
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const isCommit = process.argv.includes('--commit');
  const kwArg = process.argv.find((a) => a.startsWith('--keyword='));
  const keyword = kwArg ? kwArg.slice('--keyword='.length) : undefined;

  if (isCommit) {
    commit(keyword);
  } else if (keyword) {
    await discover(keyword);
  } else {
    console.error('使い方: npm run discover -- --keyword="インスタ 分析ツール" | --commit');
    process.exit(1);
  }
}
