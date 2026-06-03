// Playwright 共通ヘルパー（serp/officialFetch/discover/research が共有）。
// MCPではなく playwright npm パッケージをコードから直接駆動する。

import { chromium, type BrowserContext } from 'playwright';
import { browser as bcfg } from './config.js';

/** 指定msスリープ。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** min〜max ms のランダムthrottle（アクセス間隔のばらつき）。 */
export function jitter(minMs: number, maxMs: number): Promise<void> {
  return sleep(Math.floor(minMs + Math.random() * (maxMs - minMs)));
}

/**
 * ブラウザコンテキストを起動し、実在ブラウザ相当のUA/ロケール/viewportを設定して
 * fn を実行、終了後に必ずクローズする。
 */
export async function withContext<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const browserInstance = await chromium.launch({ headless: true });
  try {
    const ctx = await browserInstance.newContext({
      userAgent: bcfg.userAgent,
      locale: bcfg.locale,
      viewport: bcfg.viewport,
      extraHTTPHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9' },
    });
    ctx.setDefaultNavigationTimeout(bcfg.navTimeoutMs);
    return await fn(ctx);
  } finally {
    await browserInstance.close();
  }
}
