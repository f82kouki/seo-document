// 作戦書v4 §4 neutralityCheck.ts（check.ts の部品・最優先層）
// 他社サービス名の「近傍」にある比較ネガティブ語を正規表現的に検出する。
// 自動修正はしない＝人間が判断するための材料（warning）を出すだけ。
//
// 設計: ネガティブ語が「どこかにある」だけでは拾わない。tools.csv の他社名と
// 同一行・一定文字数以内にあるときだけ high 警告にし、誤検出を抑える。

import type { Warning } from './types.js';

/** 他社名とネガティブ語の許容近傍距離（文字数）。これを超えたら別文脈とみなす。 */
const PROXIMITY = 40;

/**
 * 他社名近傍の比較ネガティブ語を検出する。
 * @param text       記事本文
 * @param toolNames  tools.csv 由来の比較対象サービス名
 * @param negatives  ng-words.json の comparativeNegative.words
 */
export function neutralityCheck(
  text: string,
  toolNames: string[],
  negatives: string[],
): Warning[] {
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);

  lines.forEach((line, lineIdx) => {
    for (const tool of toolNames) {
      if (!tool) continue;
      // 行内の各 tool 出現位置について
      for (let t = line.indexOf(tool); t !== -1; t = line.indexOf(tool, t + tool.length)) {
        const toolEnd = t + tool.length;
        for (const neg of negatives) {
          for (let n = line.indexOf(neg); n !== -1; n = line.indexOf(neg, n + neg.length)) {
            // tool と neg の最短ギャップ（重ならない側の距離）
            const gap = n >= toolEnd ? n - toolEnd : t - (n + neg.length);
            if (gap >= 0 && gap <= PROXIMITY) {
              const key = `${lineIdx}|${tool}|${neg}`;
              if (!seen.has(key)) {
                seen.add(key);
                warnings.push({
                  layer: '比較中立性',
                  severity: 'high',
                  match: `${tool} … ${neg}`,
                  context: line.trim(),
                  line: lineIdx + 1,
                });
              }
            }
          }
        }
      }
    }
  });

  return warnings;
}
