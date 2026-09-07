/** プロンプト組み立て。事実は必ず「与えたデータ」からのみ書かせる。 */

/** 楽天の itemCaption は HTML 断片や記号が混ざるので掃除する */
export function cleanCaption(text, max = 1200) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[■◆●▼★☆※]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export const SYSTEM_PROMPT = `あなたは日本の Instagram で商品紹介アカウントを運用する編集者です。

【絶対に守るルール】
1. 事実は与えられた商品データにあるものだけを書く。スペック・成分・産地・受賞歴などを推測や一般論で補完しない。データに無い情報は書かない。
2. 医薬品的な効能効果を書かない（薬機法）。「治る」「痩せる」「効く」「アンチエイジング」等の断定表現は使わない。
3. 「日本一」「No.1」「最安」など根拠を示せない最上級表現を使わない（景品表示法）。
4. レビュー件数・評価は与えられた数値をそのまま使う。丸めたり盛ったりしない。
5. 価格は変動するため、本文では「投稿時点の価格」であることが分かる書き方にする。
6. 煽り・不安訴求（「知らないと損」「9割の人が失敗」等）は使わない。
7. 出力は指定されたツールの形式のみ。前置きや解説を書かない。

【文章の質】
- 抽象的な褒め言葉ではなく、商品データから読み取れる具体的な特徴を書く。
- 1スライドは「1つの言いたいこと」に絞る。
- 読点で区切って一息で読める長さにする。`;

export function buildUserPrompt({ item, persona, slides, maxHashtags }) {
  const middleSlides = Math.max(1, slides - 2); // 表紙とCTAを除いた枚数
  return `以下の商品について、Instagram のカルーセル投稿（全${slides}枚）と本文を作ってください。

【商品データ（これ以外の事実を書かないこと）】
- 商品名: ${item.name}
- 価格: ${item.price.toLocaleString('ja-JP')}円（投稿時点・税込表記は商品名に準じる）
- ショップ: ${item.shopName}
- レビュー件数: ${item.reviewCount}件
- レビュー平均: ${item.reviewAverage} / 5.0
- 商品説明: ${cleanCaption(item.caption) || '(説明文なし。商品名から読み取れる範囲のみで書くこと)'}

【トーン】
${persona}

【構成】
- 1枚目(hook): スクロールを止める表紙。大見出しは全角20文字以内、補足は全角30文字以内。
- 2〜${slides - 1}枚目(slides): ${middleSlides}枚。それぞれ title(全角18文字以内) と body(全角60文字以内)。
- ${slides}枚目(cta): 保存・プロフィールリンクへの導線。

【本文(caption)】
- 冒頭2行で内容が分かるようにする（Instagramは3行目以降が折りたたまれる）。
- 全体で1800文字以内。絵文字は使ってよいが1段落に1つまで。
- 価格・レビュー数値は上記データと一致させる。

【ハッシュタグ】
- ${maxHashtags}個以内。「#」を含めた文字列で返す。
- 商品カテゴリ・利用シーン・悩みの3系統を混ぜる。ビッグタグだけにしない。`;
}

/** Claude に強制させる出力スキーマ */
export function buildSchema(slides) {
  const middle = Math.max(1, slides - 2);
  return {
    type: 'object',
    properties: {
      hook: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '表紙の大見出し。全角20文字以内' },
          sub: { type: 'string', description: '表紙の補足。全角30文字以内' },
        },
        required: ['title', 'sub'],
      },
      slides: {
        type: 'array',
        minItems: middle,
        maxItems: middle,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '全角18文字以内' },
            body: { type: 'string', description: '全角60文字以内' },
          },
          required: ['title', 'body'],
        },
      },
      cta: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['title', 'body'],
      },
      caption: { type: 'string', description: 'Instagram本文。1800文字以内' },
      hashtags: { type: 'array', items: { type: 'string' }, description: '#付きの文字列' },
      altText: { type: 'string', description: '視覚障害者向けの代替テキスト。100文字以内' },
    },
    required: ['hook', 'slides', 'cta', 'caption', 'hashtags', 'altText'],
  };
}
