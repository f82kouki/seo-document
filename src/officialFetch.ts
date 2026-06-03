// 作戦書v4 §4 officialFetch.ts（★一次情報の正）
// 役割: 他社の料金・機能を「公式から正確に」採る。比較記事の事実性の生命線。
// - 数値は公式由来のみ採用。二次情報の数値は採らない。
// - 各データに sourceUrl と fetchedAt を必ず付与（freshness/urlValidator が後で使う）。
// - 取得失敗はそのサービスを warning にし、人間に「公式を手動確認」を促す（推測で埋めない）。

import { type BrowserContext } from 'playwright';

import type { OfficialData, ToolEntry, Warning } from './types.js';
import { throttle, concurrency } from './config.js';
import { withContext, jitter } from './browser.js';

export interface OfficialFetchResult {
  data: OfficialData[];
  warnings: Warning[];
}

/** evaluate がページから抽出する生データ。 */
interface RawOfficial {
  plans: { name: string; price: string }[];
  features: string[];
  lastUpdated: string | null;
}

/** 1サービスを公式から取得。失敗時は null（呼び出し側が warning 化）。 */
async function fetchOne(
  ctx: BrowserContext,
  tool: ToolEntry,
): Promise<{ data: OfficialData | null; warning?: Warning }> {
  const url = tool.pricingUrl || tool.officialUrl;
  const tab = await ctx.newPage();
  try {
    await tab.goto(url, { waitUntil: 'domcontentloaded' });

    const raw = await tab.evaluate<RawOfficial>(() => {
      // 価格パターン: ¥/￥/$ + 数字 / 数字 + 円 / 数字 + /月 など
      const priceRe = /([¥￥$]\s?[\d,]+|[\d,]+\s?円|[\d,]+\s?\/\s?(?:月|mo|year|年))/;

      // 価格テキストを含む要素を集め、直近の見出しをプラン名とみなす
      const plans: { name: string; price: string }[] = [];
      const priceEls = Array.from(document.querySelectorAll('body *')).filter((el) => {
        if (el.children.length > 0) return false; // 末端ノードのみ
        return priceRe.test(el.textContent ?? '');
      });
      const seen = new Set<string>();
      priceEls.slice(0, 40).forEach((el) => {
        const m = (el.textContent ?? '').match(priceRe);
        if (!m) return;
        const price = m[0].trim();
        // 近傍のプラン名: 祖先をたどって見出し/カードのタイトルを探す
        let name = '';
        let node: Element | null = el;
        for (let i = 0; i < 4 && node; i++) {
          const h = node.querySelector?.('h1,h2,h3,h4,[class*="plan"],[class*="title"]');
          if (h && (h.textContent ?? '').trim()) {
            name = (h.textContent ?? '').trim().slice(0, 40);
            break;
          }
          node = node.parentElement;
        }
        const key = `${name}|${price}`;
        if (!seen.has(key)) {
          seen.add(key);
          plans.push({ name: name || '(プラン名不明)', price });
        }
      });

      // 機能候補: 主要な li を上位20件
      const features = Array.from(document.querySelectorAll('main li, article li, .features li, li'))
        .map((li) => (li.textContent ?? '').trim())
        .filter((t) => t.length >= 3 && t.length <= 60)
        .slice(0, 20);

      // 最終更新日
      const metaMod =
        document.querySelector('meta[property="article:modified_time"]')?.getAttribute('content') ??
        document.querySelector('time[datetime]')?.getAttribute('datetime') ??
        null;

      return { plans, features, lastUpdated: metaMod };
    });

    // 価格が1件も取れなければ「取得失敗」扱い（推測で埋めない）
    if (raw.plans.length === 0) {
      return {
        data: null,
        warning: {
          layer: '鮮度',
          severity: 'mid',
          match: tool.name,
          context: `公式（${url}）から料金を抽出できませんでした。公式を手動確認してください（推測値は入れません）。`,
        },
      };
    }

    const data: OfficialData = {
      toolName: tool.name,
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
      plans: raw.plans.map((p) => ({ name: p.name, price: p.price })),
      features: Array.from(new Set(raw.features)),
      targetUser: undefined,
      lastUpdated: raw.lastUpdated ?? undefined,
    };
    return { data };
  } catch (e) {
    return {
      data: null,
      warning: {
        layer: '鮮度',
        severity: 'mid',
        match: tool.name,
        context: `公式（${url}）の取得に失敗: ${(e as Error).message}。手動確認してください。`,
      },
    };
  } finally {
    await tab.close();
  }
}

/** 単純な並列度制御（Playwright 2並列）。 */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * tools.csv の各公式URLから料金/機能/更新日を取得。
 * 取得できたものは data に、失敗は warnings に積む。
 */
export async function fetchOfficialData(tools: ToolEntry[]): Promise<OfficialFetchResult> {
  if (tools.length === 0) return { data: [], warnings: [] };
  return withContext(async (ctx) => {
    const outcomes = await mapLimited(tools, concurrency.playwright, async (tool) => {
      const r = await fetchOne(ctx, tool);
      await jitter(throttle.officialMinMs, throttle.officialMaxMs);
      return r;
    });
    const data: OfficialData[] = [];
    const warnings: Warning[] = [];
    for (const o of outcomes) {
      if (o.data) data.push(o.data);
      if (o.warning) warnings.push(o.warning);
    }
    return { data, warnings };
  });
}
