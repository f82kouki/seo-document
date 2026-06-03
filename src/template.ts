// 作戦書v4 §4 template.ts
// ユーザー支給サンプル（prompts/examples/pr-hyoki-guide.md）の体裁を「正式テンプレート」として固定。
// promptBuilder がこの骨格と記法を執筆プロンプトに供給する。サンプル未支給時も
// この構造が品質の最低保証になる（フォールバック）。

/** 記法マーカー（Markdownの # や - ではなく、この記法で統一する）。 */
export const MARKS = {
  /** 見出し */
  heading: '■',
  /** 小見出し */
  subheading: '▸',
  /** 箇条書き */
  bullet: '・',
  /** セクション区切り（末尾チェック前など） */
  divider: '────────────────────────',
} as const;

/** 記事の固定セクション。この順序・この記法で必ず出力させる。 */
export interface SectionSpec {
  /** セクションの役割名（人間/Claude Code 向けの内部ラベル） */
  role: string;
  /** どう書くかの指示 */
  guidance: string;
  /** 省略不可ブロックか */
  required: boolean;
}

/**
 * 記事の固定構造（pr-hyoki-guide.md 由来）。
 * 比較記事の場合、compareSection を「対象別＝各社紹介」に充て、中立・fit軸で記述する。
 */
export const SECTIONS: SectionSpec[] = [
  {
    role: 'タイトル',
    guidance: '記事タイトルを1行目に置く。誇大・最上級表現は使わない。',
    required: true,
  },
  {
    role: 'メタ情報',
    guidance: '「狙いキーワード：{keyword}（複数は / 併記）」「カテゴリ：{category}」をタイトル直下に置く。',
    required: true,
  },
  {
    role: 'リード文',
    guidance:
      '読者の具体的な悩みを「」で提起 → 本記事が一次情報をもとに整理する旨を宣言。200〜300字。',
    required: true,
  },
  {
    role: '冒頭ディスクレーマー',
    guidance:
      '「※本記事は一般的な情報提供です。最終的な可否は各公式・専門家確認に基づいてください」の趣旨を1行。',
    required: true,
  },
  {
    role: '見出し1：定義・背景',
    guidance: '一次情報の出典を明記して定義・背景を述べる。',
    required: true,
  },
  {
    role: '見出し2：実務分解',
    guidance: '「誰が・何を・どこに」等、実務に落とした分解を述べる。',
    required: false,
  },
  {
    role: '比較セクション（対象別／各社紹介）',
    guidance:
      '各社/各項目を中立に列挙。優劣ではなく「向いている人/ユースケース（fit）」の差として記述。' +
      '料金・機能は research 部の officialData の数値のみを使う。',
    required: true,
  },
  {
    role: '美容で特に注意（薬機法）',
    guidance:
      '化粧品の効果は56効能の範囲で。断定表現（「シミが消える」等）はNG。薬機法との接続を必ず一節置く。',
    required: true,
  },
  {
    role: 'よくある質問（FAQ）',
    guidance: 'Q. / A. 形式。読者の実際の疑問を2〜4問。',
    required: true,
  },
  {
    role: 'まとめ',
    guidance: '要点を ①②③ の形で凝縮する。',
    required: true,
  },
  {
    role: '参考リンク',
    guidance:
      '「公式・一次情報を優先」と銘打つ。「媒体名「ページ名」：URL」形式。' +
      'research.json 由来のURLのみ（新規URL生成は禁止）。',
    required: true,
  },
  {
    role: '※公開前チェック',
    guidance:
      '区切り線の下に置く。施行日・条項・仕様は一次情報で再確認すべき旨／薬機法など同時留意点を箇条書き。',
    required: true,
  },
];

/** 体裁ルール（promptBuilder が執筆プロンプトに反映する箇条書き）。 */
export const STYLE_RULES: string[] = [
  `見出しは「${MARKS.heading}」、小見出しは「${MARKS.subheading}」、箇条書きは「${MARKS.bullet}」（Markdownの # や - は使わない）。`,
  'リード冒頭は読者の悩みを「」で具体提起する型。',
  '本文中に「一次情報をもとに」「公式より」と出典依拠を明示するトーン（E-E-A-T）。',
  '「美容で特に注意」節と末尾「※公開前チェック」は省略不可の必須ブロック。',
  'FAQは Q. / A. 形式。',
  '参考リンクは「公式・一次情報を優先」と銘打ち、research.json 由来URLのみ。',
  '比較記事では対象別セクションを各社紹介に充て、中立・fit軸（優劣の断定をしない）で記述する。',
];

/**
 * 体裁スケルトン（プレースホルダ入りの雛形テキスト）。
 * promptBuilder / system.md が「この骨格で書け」と示すための原型。
 */
export const SKELETON = `{記事タイトル}

狙いキーワード：{keyword}（必要なら複数 / で併記）
カテゴリ：{category}

{リード文：読者の具体的な悩みを「」で提起 → 本記事が一次情報をもとに整理する旨を宣言。200-300字}

※{冒頭ディスクレーマー：一般的な情報提供である旨／最終判断は公式・専門家確認に基づく旨}


${MARKS.heading} {見出し1：定義・背景。一次情報の出典を明記}
{本文}
${MARKS.subheading} {小見出し：${MARKS.subheading}で示す}
${MARKS.bullet} {箇条書き：${MARKS.bullet}で示す}

${MARKS.heading} {見出し2：誰が・何を・どこに 等の実務分解}

${MARKS.heading} {見出し3：対象別・SNS別などの並列セクション。各社/各項目を中立に列挙}
${MARKS.subheading} 重要：{注意喚起の小見出し}

${MARKS.heading} {美容で特に注意：薬機法との接続を必ず一節置く（56効能・断定表現NG）}

${MARKS.heading} よくある質問（FAQ）
Q. {質問}
A. {回答}

${MARKS.heading} まとめ
{要点を①②③の形で凝縮}

${MARKS.heading} 参考リンク（公式・一次情報を優先）
${MARKS.bullet} {媒体名「ページ名」：URL}  ← research.json由来のみ

${MARKS.divider}
※公開前チェック
${MARKS.bullet} {施行日・条項・仕様は一次情報で再確認すべき旨}
${MARKS.bullet} {薬機法など同時に留意すべき点}`;

/**
 * 体裁仕様をプロンプト用テキストにレンダリングする。
 * promptBuilder が system.md と連結して 1枚のプロンプトmd を組み立てる際に使う。
 */
export function renderTemplateSpec(): string {
  const sectionLines = SECTIONS.map(
    (s) => `- ${s.role}${s.required ? '（必須）' : '（任意）'}：${s.guidance}`,
  ).join('\n');
  const ruleLines = STYLE_RULES.map((r) => `- ${r}`).join('\n');

  return [
    '## 記事の固定構造（この順序・この記法）',
    sectionLines,
    '',
    '## 体裁ルール',
    ruleLines,
    '',
    '## 体裁スケルトン（この骨格で書く）',
    '```',
    SKELETON,
    '```',
  ].join('\n');
}
