// 作戦書v4 §4 serp.ts（起点取得・直叩き・degrade必須）
// 用途は「競合がどんな見出し・切り口で書いているか」の把握のみ。料金・機能の数値は採らない。
// フォールバック順: DuckDuckGo HTML → Bing → Google（前段が0件/CAPTCHAで次へ）。
// ★3エンジン全滅でも例外を投げず空配列を返す（research.tsが公式直叩きだけで続行できるように）。
//
// 実装メモ:
// - DuckDuckGo の html endpoint は現在 GET だと 403。フォーム POST で叩き、HTMLを setContent して解析する。
// - Bing の結果リンクは /ck/a リダイレクト。u パラメータ（base64url, 接頭辞 a1）を実URLへデコードする。
// - 広告（DDG の y.js / ad_domain 等）は除外する。

import { type BrowserContext } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SerpEngine, SerpEntry } from './types.js';
import { serpEngineOrder, throttle } from './config.js';
import { withContext, jitter } from './browser.js';

/** 1エンジンの試行結果。blocked=CAPTCHA/consent/403等で弾かれた。 */
export interface EngineOutcome {
  engine: SerpEngine;
  results: SerpEntry[];
  blocked: boolean;
  note?: string;
}

/** evaluate から返る生の結果（rank/h2等は後付け）。 */
interface RawHit {
  url: string;
  title: string;
  snippet: string;
}

interface FetchOutcome {
  raw: RawHit[];
  blocked: boolean;
  note?: string;
}

// ---- CAPTCHA/consent検知 ----
function urlLooksBlocked(currentUrl: string): boolean {
  return /sorry\/index|\/recaptcha|captcha|consent\.(google|bing|youtube)|\/challenge/i.test(
    currentUrl,
  );
}

// ---- DuckDuckGo のリダイレクトURL（uddg）をデコード ----
function decodeDdgHref(href: string): string {
  if (!href) return href;
  const abs = href.startsWith('//') ? `https:${href}` : href;
  try {
    const u = new URL(abs);
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : abs;
  } catch {
    return abs;
  }
}

// ---- Bing の /ck/a リダイレクトURL（u=a1<base64url>）を実URLへデコード ----
function decodeBingHref(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname.endsWith('bing.com') && u.pathname.startsWith('/ck/')) {
      const enc = u.searchParams.get('u');
      if (enc) {
        const body = enc.startsWith('a1') ? enc.slice(2) : enc;
        const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
        const decoded = Buffer.from(b64 + pad, 'base64').toString('utf-8');
        if (decoded.startsWith('http')) return decoded;
      }
    }
    return href;
  } catch {
    return href;
  }
}

// ---- 広告/不要リンクの除外 ----
function isAdUrl(url: string): boolean {
  return /duckduckgo\.com\/y\.js|[?&]ad_domain=|[?&]ad_provider=|bing\.com\/aclk/i.test(url);
}

// ---- DuckDuckGo（POST + setContent 解析） ----
async function fetchDuckDuckGo(
  ctx: BrowserContext,
  keyword: string,
  page: number,
): Promise<FetchOutcome> {
  const form: Record<string, string> = { q: keyword, kl: 'jp-jp' };
  if (page > 1) form.s = String((page - 1) * 30);

  const resp = await ctx.request.post('https://html.duckduckgo.com/html/', {
    form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (resp.status() === 403 || resp.status() === 429) {
    return { raw: [], blocked: true, note: `status ${resp.status()}` };
  }
  const html = await resp.text();
  if (!/result__a/.test(html) && /anomaly|If this persists|challenge/i.test(html)) {
    return { raw: [], blocked: true, note: 'anomaly/challenge page' };
  }

  const tab = await ctx.newPage();
  try {
    await tab.setContent(html);
    const raw = await tab.evaluate<RawHit[]>(() => {
      const out: RawHit[] = [];
      document.querySelectorAll('.result__a').forEach((a) => {
        const url = a.getAttribute('href') ?? '';
        const title = (a.textContent ?? '').trim();
        const container = a.closest('.result, .results_links, .web-result');
        const snippet = (container?.querySelector('.result__snippet')?.textContent ?? '').trim();
        if (url && title) out.push({ url, title, snippet });
      });
      return out;
    });
    return { raw, blocked: false };
  } finally {
    await tab.close();
  }
}

// ---- Bing / Google（goto + evaluate） ----
async function fetchViaGoto(
  ctx: BrowserContext,
  engine: 'bing' | 'google',
  keyword: string,
  page: number,
): Promise<FetchOutcome> {
  const q = encodeURIComponent(keyword);
  const url =
    engine === 'bing'
      ? `https://www.bing.com/search?q=${q}&setlang=ja&cc=JP${page > 1 ? `&first=${(page - 1) * 10 + 1}` : ''}`
      : `https://www.google.com/search?q=${q}&hl=ja&gl=jp${page > 1 ? `&start=${(page - 1) * 10}` : ''}`;

  const tab = await ctx.newPage();
  try {
    await tab.goto(url, { waitUntil: 'domcontentloaded' });

    if (urlLooksBlocked(tab.url())) {
      return { raw: [], blocked: true, note: `blocked by redirect: ${tab.url()}` };
    }
    const title = (await tab.title()).toLowerCase();
    if (title.includes('captcha') || title.includes('verify') || title.includes('unusual')) {
      return { raw: [], blocked: true, note: `blocked by title: ${title}` };
    }

    const raw =
      engine === 'bing'
        ? await tab.evaluate<RawHit[]>(() => {
            const out: RawHit[] = [];
            document.querySelectorAll('#b_results .b_algo').forEach((li) => {
              const a = li.querySelector('h2 a') as HTMLAnchorElement | null;
              if (!a) return;
              const url = a.href;
              const t = (a.textContent ?? '').trim();
              const sn = (li.querySelector('.b_caption p, .b_algoSlug')?.textContent ?? '').trim();
              if (url && t) out.push({ url, title: t, snippet: sn });
            });
            return out;
          })
        : await tab.evaluate<RawHit[]>(() => {
            const out: RawHit[] = [];
            document.querySelectorAll('#search div.g, #rso div.g, #rso > div').forEach((g) => {
              const a = g.querySelector('a[href^="http"]') as HTMLAnchorElement | null;
              const h3 = g.querySelector('h3');
              if (!a || !h3) return;
              const sn = (
                g.querySelector('.VwiC3b, .IsZvec, div[data-sncf]')?.textContent ?? ''
              ).trim();
              out.push({ url: a.href, title: (h3.textContent ?? '').trim(), snippet: sn });
            });
            return out;
          });
    return { raw, blocked: false };
  } finally {
    await tab.close();
  }
}

// ---- 1エンジン取得（例外を投げない） ----
export async function fetchFromEngine(
  ctx: BrowserContext,
  engine: Exclude<SerpEngine, 'none'>,
  keyword: string,
  page = 1,
): Promise<EngineOutcome> {
  try {
    const outcome =
      engine === 'duckduckgo'
        ? await fetchDuckDuckGo(ctx, keyword, page)
        : await fetchViaGoto(ctx, engine, keyword, page);

    if (outcome.blocked) {
      return { engine, results: [], blocked: true, note: outcome.note };
    }

    // エンジン別にリダイレクトURLをデコード
    let raw = outcome.raw;
    if (engine === 'duckduckgo') raw = raw.map((r) => ({ ...r, url: decodeDdgHref(r.url) }));
    if (engine === 'bing') raw = raw.map((r) => ({ ...r, url: decodeBingHref(r.url) }));

    // 正規化＆広告除外＆重複URL除去＆rank付与
    const seen = new Set<string>();
    const results: SerpEntry[] = [];
    for (const r of raw) {
      if (!r.url.startsWith('http')) continue;
      if (isAdUrl(r.url)) continue;
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push({
        rank: results.length + 1,
        url: r.url,
        title: r.title,
        snippet: r.snippet,
        h2: [],
        h3: [],
        faq: [],
      });
    }
    return { engine, results, blocked: false, note: outcome.note };
  } catch (e) {
    return { engine, results: [], blocked: false, note: `error: ${(e as Error).message}` };
  }
}

/**
 * フォールバック付きSERP取得。最初に結果が得られたエンジンを返す。
 * 全滅時は engine='none' / results=[] を返し、例外は投げない（degrade）。
 */
export async function fetchSerp(
  keyword: string,
  page = 1,
): Promise<{ engine: SerpEngine; results: SerpEntry[] }> {
  return withContext(async (ctx) => {
    for (const engine of serpEngineOrder) {
      const outcome = await fetchFromEngine(ctx, engine, keyword, page);
      await jitter(throttle.serpMinMs, throttle.serpMaxMs);
      if (outcome.results.length > 0) {
        return { engine: outcome.engine, results: outcome.results };
      }
    }
    return { engine: 'none', results: [] };
  });
}

// ---- 直接実行時のデモ（エンジン別に取得状況を表示） ----
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const kwArg = process.argv.find((a) => a.startsWith('--keyword='));
  const keyword = kwArg ? kwArg.slice('--keyword='.length) : 'インスタ 分析ツール 比較';

  await withContext(async (ctx) => {
    console.log(`\n=== SERP demo: "${keyword}" ===\n`);
    for (const engine of serpEngineOrder) {
      const outcome = await fetchFromEngine(ctx, engine, keyword, 1);
      const status = outcome.blocked
        ? 'BLOCKED(CAPTCHA/consent/403)'
        : outcome.results.length > 0
          ? 'OK'
          : 'EMPTY';
      console.log(
        `[${engine}] ${status} — ${outcome.results.length}件${outcome.note ? ` (${outcome.note})` : ''}`,
      );
      outcome.results.slice(0, 3).forEach((r) => {
        console.log(`    #${r.rank} ${r.title}`);
        console.log(`        ${r.url}`);
      });
      await jitter(throttle.serpMinMs, throttle.serpMaxMs);
    }
  });

  console.log('\n--- fetchSerp（フォールバックで採用されたエンジン）---');
  const picked = await fetchSerp(keyword, 1);
  console.log(`採用エンジン: ${picked.engine} / ${picked.results.length}件`);
  if (picked.engine === 'none') {
    console.log('→ 3エンジン全滅。research.ts は公式直叩きのみで degrade 続行します（例外なし）。');
  }
}
