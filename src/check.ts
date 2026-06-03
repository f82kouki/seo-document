// 作戦書v4 §4 check.ts（任意・生成済み記事の正規表現再点検）
// 使い方: npm run check -- --file=output/drafts/{slug}.md
//
// Claude Code が書いた記事を機械的に再点検し、セルフチェックの見落としを拾う二重確認用。
// 結果は記事末尾の <!-- COMPLIANCE WARNINGS --> ブロックに追記する（再実行時は置換）。
// 先頭に固定免責文を必ず置く（自動チェックは明示的NG語のみ・暗示表現は対象外・最終判断は人間）。
//
// 検査層: 比較中立性 / 景表法 / ステマ / 薬機法 / 鮮度 / URL
// research.json（output/research/{slug}.json）があれば鮮度の価格照合・URL照合まで行う。
// 無い場合はその2層を degrade（スキップ）し、その旨を報告する。

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

import type { ResearchResult, ToolEntry, Warning } from './types.js';
import { paths } from './config.js';
import { neutralityCheck } from './neutralityCheck.js';
import {
  checkDisclaimerPresent,
  checkPricesInResearch,
  checkStaleness,
} from './freshness.js';
import { validateUrls } from './urlValidator.js';

const WARN_MARKER = '<!-- COMPLIANCE WARNINGS -->';
const DISCLAIMER =
  'この自動チェックは明示的NG語のみを対象とします。暗示表現は対象外です。最終判断は人間が行ってください。';

interface NgWordGroup {
  layer: string;
  severity: 'high' | 'mid';
  words: string[];
}
interface NgWords {
  comparativeNegative: NgWordGroup;
  superlative: NgWordGroup;
  yakkihoNg: NgWordGroup;
}

// ---- 引数 ----
function getFileArg(): string {
  const arg = process.argv.find((a) => a.startsWith('--file='));
  if (!arg) {
    console.error('使い方: npm run check -- --file=output/drafts/{slug}.md');
    process.exit(1);
  }
  return path.resolve(arg.slice('--file='.length));
}

// ---- 読み込み ----
function loadNgWords(): NgWords {
  return JSON.parse(fs.readFileSync(paths.ngWords, 'utf-8')) as NgWords;
}

function loadToolNames(): string[] {
  if (!fs.existsSync(paths.tools)) return [];
  const raw = fs.readFileSync(paths.tools, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as ToolEntry[];
  return rows.map((r) => r.name).filter(Boolean);
}

function loadToolNotes(): string[] {
  if (!fs.existsSync(paths.tools)) return [];
  const raw = fs.readFileSync(paths.tools, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Array<
    Record<string, string>
  >;
  return rows.map((r) => r.note ?? '').filter(Boolean);
}

function loadResearch(slug: string): ResearchResult | null {
  const p = path.join(paths.research, `${slug}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as ResearchResult;
}

/** 既存の警告ブロックを除去した本文を返す。 */
function stripWarningBlock(content: string): string {
  const idx = content.indexOf(WARN_MARKER);
  return idx === -1 ? content : content.slice(0, idx).replace(/\s+$/, '') + '\n';
}

// ---- 各層 ----

/** 景表法層: 最上級・順位付け表現を検出。根拠出典の有無は人間判断のため severity は mid。 */
function superlativeCheck(text: string, words: string[]): Warning[] {
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const w of words) {
      if (line.includes(w)) {
        const key = `${i}|${w}`;
        if (!seen.has(key)) {
          seen.add(key);
          warnings.push({
            layer: '景表法',
            severity: 'mid',
            match: w,
            context: `最上級/順位表現。research.json に根拠調査が無ければ優良誤認リスク。行: ${line.trim()}`,
            line: i + 1,
          });
        }
      }
    }
  });
  return warnings;
}

/** 薬機法層: 医薬品的・断定的効能表現を検出。 */
function yakkihoCheck(text: string, words: string[]): Warning[] {
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const w of words) {
      if (line.includes(w)) {
        const key = `${i}|${w}`;
        if (!seen.has(key)) {
          seen.add(key);
          warnings.push({
            layer: '薬機法',
            severity: 'high',
            match: w,
            context: `56効能の範囲外の断定的効能表現の疑い。行: ${line.trim()}`,
            line: i + 1,
          });
        }
      }
    }
  });
  return warnings;
}

/**
 * ステマ層: 自社を比較に含む（tools.csv の note に「自社」）場合、
 * 本文に運営者/PR/提供/案件 等の広告性表示が無ければ警告。
 */
function stealthCheck(text: string, toolNotes: string[]): Warning[] {
  const selfIncluded = toolNotes.some((n) => n.includes('自社'));
  if (!selfIncluded) return [];
  const hasDisclosure = /(PR|ＰＲ|広告|提供|案件|運営者|タイアップ)/.test(text);
  if (hasDisclosure) return [];
  return [
    {
      layer: 'ステマ',
      severity: 'mid',
      match: '（PR表記/運営者明記の欠落）',
      context:
        '比較に自社サービスを含みます。広告主＝自社がステマ規制の主体のため、運営者明記・PR表記を検討してください。',
    },
  ];
}

// ---- レポート整形 ----
function formatReport(warnings: Warning[], researchPresent: boolean, slug: string): string {
  const lines: string[] = [];
  lines.push(WARN_MARKER);
  lines.push(`<!-- ${DISCLAIMER} -->`);
  lines.push('');
  lines.push(`## 自動コンプライアンス検査結果（slug: ${slug}）`);
  lines.push('');
  lines.push(`> ${DISCLAIMER}`);
  if (!researchPresent) {
    lines.push('>');
    lines.push(
      `> ⚠️ research.json が見つからないため、鮮度の価格照合とURL照合はスキップしました（degrade）。`,
    );
  }
  lines.push('');

  if (warnings.length === 0) {
    lines.push('検出された明示的NG: なし（暗示表現は人間が最終確認）');
    return lines.join('\n') + '\n';
  }

  // 層ごとに集計
  const order = ['比較中立性', '景表法', 'ステマ', '薬機法', '鮮度', 'URL'];
  const high = warnings.filter((w) => w.severity === 'high').length;
  const mid = warnings.filter((w) => w.severity === 'mid').length;
  lines.push(`検出: high ${high}件 / mid ${mid}件`);
  lines.push('');

  for (const layer of order) {
    const group = warnings.filter((w) => w.layer === layer);
    if (group.length === 0) continue;
    lines.push(`### ${layer}（${group.length}件）`);
    for (const w of group) {
      const loc = w.line ? ` (L${w.line})` : '';
      lines.push(`- [${w.severity.toUpperCase()}]${loc} \`${w.match}\` — ${w.context}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\s+$/, '') + '\n';
}

// ---- main ----
function main(): void {
  const file = getFileArg();
  if (!fs.existsSync(file)) {
    console.error(`ファイルが見つかりません: ${file}`);
    process.exit(1);
  }
  const slug = path.basename(file, path.extname(file));
  const original = fs.readFileSync(file, 'utf-8');
  const body = stripWarningBlock(original);

  const ng = loadNgWords();
  const toolNames = loadToolNames();
  const toolNotes = loadToolNotes();
  const research = loadResearch(slug);

  const warnings: Warning[] = [];
  // 比較中立性（最優先）
  warnings.push(...neutralityCheck(body, toolNames, ng.comparativeNegative.words));
  // 景表法
  warnings.push(...superlativeCheck(body, ng.superlative.words));
  // ステマ
  warnings.push(...stealthCheck(body, toolNotes));
  // 薬機法
  warnings.push(...yakkihoCheck(body, ng.yakkihoNg.words));
  // 鮮度（ディスクレーマー記載は research 不要）
  warnings.push(...checkDisclaimerPresent(body));
  // 鮮度（価格照合）・URL照合は research があるときのみ
  if (research) {
    warnings.push(...checkStaleness(research, new Date()));
    warnings.push(...checkPricesInResearch(body, research));
    warnings.push(...validateUrls(body, research));
  }

  const report = formatReport(warnings, research !== null, slug);
  fs.writeFileSync(file, body.replace(/\s+$/, '') + '\n\n' + report, 'utf-8');

  // コンソールにもサマリ出力
  const high = warnings.filter((w) => w.severity === 'high');
  console.log(`\n=== compliance check: ${path.basename(file)} ===`);
  console.log(`比較対象（tools.csv）: ${toolNames.length ? toolNames.join(', ') : '(なし)'}`);
  console.log(`research.json: ${research ? 'あり' : 'なし（鮮度価格・URL照合はスキップ）'}`);
  console.log(`検出: high ${high.length}件 / mid ${warnings.length - high.length}件`);
  for (const w of warnings) {
    const loc = w.line ? `L${w.line}` : '-';
    console.log(`  [${w.severity.toUpperCase()}][${w.layer}] ${loc} ${w.match}`);
  }
  console.log(`\n→ 詳細を ${file} の末尾ブロックに追記しました。`);
  if (high.length > 0) {
    console.log('⚠️ high 警告があります。公開前に人間が必ず確認してください。');
  }
}

main();
