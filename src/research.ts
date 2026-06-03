// 作戦書v4 §4 research.ts（Playwright調査）
// SERP起点（切り口把握）＋公式直叩き一次情報＋共起語 を1つの ResearchResult にまとめる。
// SERPが全滅しても公式直叩きだけで成立する（degrade）。記事の数値根拠は officialData のみ。

import { type BrowserContext } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ResearchResult, SerpEntry, ToolEntry, Topic } from './types.js';
import { throttle } from './config.js';
import { withContext, jitter } from './browser.js';
import { fetchSerp } from './serp.js';
import { fetchOfficialData } from './officialFetch.js';

/** 上位SERPページを開いて h2/h3/faq を補完する（競合の切り口把握）。 */
async function enrichSerpHeadings(
  ctx: BrowserContext,
  entries: SerpEntry[],
  max: number,
): Promise<void> {
  for (const entry of entries.slice(0, max)) {
    const tab = await ctx.newPage();
    try {
      await tab.goto(entry.url, { waitUntil: 'domcontentloaded' });
      const picked = await tab.evaluate<{ h2: string[]; h3: string[]; faq: string[] }>(() => {
        const text = (el: Element) => (el.textContent ?? '').trim();
        const h2 = Array.from(document.querySelectorAll('h2')).map(text).filter(Boolean).slice(0, 20);
        const h3 = Array.from(document.querySelectorAll('h3')).map(text).filter(Boolean).slice(0, 30);
        // FAQ候補: 疑問符で終わる見出し/質問
        const faq = [...h2, ...h3].filter((t) => /[?？]$/.test(t)).slice(0, 15);
        return { h2, h3, faq };
      });
      entry.h2 = picked.h2;
      entry.h3 = picked.h3;
      entry.faq = picked.faq;
    } catch {
      // 失敗ページはスキップ（起点なので致命的でない）
    } finally {
      await tab.close();
      await jitter(throttle.serpMinMs, throttle.serpMaxMs);
    }
  }
}

/** SERPのタイトル/スニペットから共起語を素朴に頻度集計（形態素解析は使わない）。 */
function extractCoOccurringTerms(entries: SerpEntry[], topN: number): string[] {
  const counts = new Map<string, number>();
  const bump = (token: string) => {
    if (token.length < 2) return;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  };
  for (const e of entries) {
    const text = `${e.title} ${e.snippet} ${e.h2.join(' ')} ${e.h3.join(' ')}`;
    // カタカナ語・英単語を素朴に抽出
    for (const m of text.matchAll(/[ァ-ヴー]{2,}|[A-Za-z][A-Za-z0-9]{1,}/g)) {
      bump(m[0]);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([term]) => term);
}

/**
 * 1テーマ分の調査を実行して ResearchResult を返す。
 * @param topic  対象テーマ（slug/keyword を使う）
 * @param tools  比較対象（公式直叩きの対象）
 */
export async function research(topic: Topic, tools: ToolEntry[]): Promise<ResearchResult> {
  const fetchedAt = new Date().toISOString();

  // 1) SERP起点（全滅でも例外なし）
  const { engine, results: serp } = await fetchSerp(topic.keyword, 1);

  // 2) 上位ページの見出し補完＋共起語（SERPがあるときだけ）
  if (serp.length > 0) {
    await withContext(async (ctx) => {
      await enrichSerpHeadings(ctx, serp, 5);
    });
  }
  const coOccurringTerms = extractCoOccurringTerms(serp, 30);

  // 3) 公式直叩き（記事の数値根拠）
  const official = await fetchOfficialData(tools);
  if (official.warnings.length > 0) {
    for (const w of official.warnings) {
      console.warn(`[officialFetch warning] ${w.match}: ${w.context}`);
    }
  }

  return {
    slug: topic.slug,
    keyword: topic.keyword,
    fetchedAt,
    engine,
    serp,
    officialData: official.data,
    coOccurringTerms,
  };
}

// ---- 単体実行（手動検証用）: tsx src/research.ts --keyword="..." --slug=tmp ----
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const kwArg = process.argv.find((a) => a.startsWith('--keyword='));
  const slugArg = process.argv.find((a) => a.startsWith('--slug='));
  const keyword = kwArg ? kwArg.slice('--keyword='.length) : 'インスタ 分析ツール 比較';
  const slug = slugArg ? slugArg.slice('--slug='.length) : 'tmp';

  const topic: Topic = {
    slug,
    title: slug,
    keyword,
    category: '比較',
    status: 'todo',
    priority: 1,
    note: '',
  };
  // 単体実行時は tools 無し（SERP起点のみ）でも degrade で動くことを示す
  const result = await research(topic, []);
  console.log(JSON.stringify(result, null, 2));
}
