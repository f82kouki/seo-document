// 作戦書v4 §4 freshness.ts（check.ts の部品・鮮度層）
// 1) 鮮度ディスクレーマー文面の生成
// 2) research.json の fetchedAt が古すぎ（既定30日超）なら警告
// 3) research.json に無い価格が本文にあれば「捏造疑い」high
// 4) 本文に「◯年◯月時点」の鮮度記載が無ければ警告

import type { OfficialData, ResearchResult, Warning } from './types.js';
import { freshness as freshnessCfg } from './config.js';

/** 記事末尾に必ず入れる鮮度ディスクレーマー文面を生成。 */
export function freshnessDisclaimer(year: number, month: number): string {
  return `※料金・機能は${year}年${month}月時点の情報です。最新は各公式サイトでご確認ください。`;
}

/** 本文に「YYYY年M月時点」の鮮度記載があるか。無ければ mid 警告。 */
export function checkDisclaimerPresent(text: string): Warning[] {
  if (/\d{4}\s*年\s*\d{1,2}\s*月時点/.test(text)) return [];
  return [
    {
      layer: '鮮度',
      severity: 'mid',
      match: '（鮮度ディスクレーマー欠落）',
      context: '本文に「◯年◯月時点」の鮮度記載が見当たりません。末尾に鮮度ディスクレーマーを入れてください。',
    },
  ];
}

/** research.json の各 officialData の fetchedAt が古すぎないか検証。 */
export function checkStaleness(research: ResearchResult, now: Date): Warning[] {
  const warnings: Warning[] = [];
  const limitMs = freshnessCfg.staleAfterDays * 24 * 60 * 60 * 1000;
  for (const d of research.officialData) {
    const fetched = new Date(d.fetchedAt);
    if (Number.isNaN(fetched.getTime())) continue;
    const ageDays = Math.floor((now.getTime() - fetched.getTime()) / (24 * 60 * 60 * 1000));
    if (now.getTime() - fetched.getTime() > limitMs) {
      warnings.push({
        layer: '鮮度',
        severity: 'mid',
        match: `${d.toolName} fetchedAt=${d.fetchedAt}`,
        context: `取得から約${ageDays}日経過（しきい値${freshnessCfg.staleAfterDays}日）。公式を再取得してください。`,
      });
    }
  }
  return warnings;
}

/** 価格らしきトークンを正規化（通貨記号・カンマ・空白・「円」を除去した数字＋単位）。 */
function normalizePrice(raw: string): string {
  return raw.replace(/[¥￥$\s,]/g, '').replace(/円/g, '');
}

/** officialData の全プラン価格を正規化集合に。 */
function allowedPriceSet(officialData: OfficialData[]): Set<string> {
  const set = new Set<string>();
  for (const d of officialData) {
    for (const p of d.plans) {
      const n = normalizePrice(p.price);
      if (n) set.add(n);
    }
  }
  return set;
}

/**
 * 本文中の価格表記が research.json 由来か照合。由来しない価格は捏造疑い high。
 * 通貨パターン: ¥/￥/$ + 数字、または 数字 + 円。
 */
export function checkPricesInResearch(text: string, research: ResearchResult): Warning[] {
  const warnings: Warning[] = [];
  const allowed = allowedPriceSet(research.officialData);
  const lines = text.split(/\r?\n/);
  const priceRe = /[¥￥$]\s*[\d,]+|[\d,]+\s*円/g;
  const seen = new Set<string>();

  lines.forEach((line, lineIdx) => {
    for (const m of line.matchAll(priceRe)) {
      const raw = m[0];
      const norm = normalizePrice(raw);
      if (!norm) continue;
      if (!allowed.has(norm)) {
        const key = `${lineIdx}|${norm}`;
        if (!seen.has(key)) {
          seen.add(key);
          warnings.push({
            layer: '鮮度',
            severity: 'high',
            match: raw,
            context: `research.json の officialData に無い価格です（捏造疑い）。行: ${line.trim()}`,
            line: lineIdx + 1,
          });
        }
      }
    }
  });

  return warnings;
}
