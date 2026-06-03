// 作戦書v4 §4 urlValidator.ts（check.ts の部品・URL層）
// 参考リンクが research.json 由来かを正規化照合する。任意で死活200チェックも可能。
// research.json に無いURL = AIによるURL捏造の疑いとして warning。

import type { ResearchResult, Warning } from './types.js';

/**
 * URL正規化: プロトコルを小文字化、ホストを小文字化、クエリ・ハッシュを除去、
 * 末尾スラッシュを除去。比較は「同じページを指すか」の粒度で行う。
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed);
    u.search = '';
    u.hash = '';
    let path = u.pathname.replace(/\/+$/, ''); // 末尾スラッシュ除去
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}`;
  } catch {
    // パースできないものは素のトリムで返す（照合では弾かれる）
    return trimmed.replace(/\/+$/, '');
  }
}

/** 本文からURLを抽出（末尾の句読点・閉じ括弧・引用符を落とす）。 */
export function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s)」』"'<>）]+/g;
  const found = text.match(re) ?? [];
  return found.map((u) => u.replace(/[.,。、）)」』]+$/, ''));
}

/** research.json 由来の許可URL集合（officialData.sourceUrl と serp[].url）を正規化して返す。 */
export function allowedUrlSet(research: ResearchResult): Set<string> {
  const set = new Set<string>();
  for (const d of research.officialData) set.add(normalizeUrl(d.sourceUrl));
  for (const s of research.serp) set.add(normalizeUrl(s.url));
  return set;
}

/**
 * 本文中のURLが research.json 由来かを照合。由来しないものは URL層 high 警告。
 */
export function validateUrls(text: string, research: ResearchResult): Warning[] {
  const allowed = allowedUrlSet(research);
  const warnings: Warning[] = [];
  const seen = new Set<string>();

  for (const raw of extractUrls(text)) {
    const norm = normalizeUrl(raw);
    if (!allowed.has(norm) && !seen.has(norm)) {
      seen.add(norm);
      warnings.push({
        layer: 'URL',
        severity: 'high',
        match: raw,
        context: 'research.json に存在しないURLです（捏造疑い）。参考リンクは調査結果由来のみにしてください。',
      });
    }
  }

  return warnings;
}
