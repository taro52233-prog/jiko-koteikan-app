/**
 * 楽天ROOM 用の紹介文生成（80文字前後・口語体・3パターン）。
 *
 * ■ 元ネタとの違いを明示しておく
 * 参考にした手法では AI に「口コミを分析させて」ベネフィットを抽出する。
 * ただし楽天ウェブサービスにレビュー本文を返す公式APIは無く、
 * レビューページのスクレイピングは規約リスクがある。
 * そこで本実装は **商品説明文（itemCaption）＋レビュー統計（件数・平均）** を事実の土台にし、
 * 「口コミによると〜」のような、根拠を持たない引用は書かせない。
 * 事実の強度は落ちるが、嘘を書かない方を優先している。
 */
import Anthropic from '@anthropic-ai/sdk';
import { cleanCaption } from './prompt.js';
import { log } from '../util.js';

export const ROOM_SYSTEM_PROMPT = `あなたは楽天ROOMで商品を紹介する個人の運用者です。

【この文章の目的】
売り込むことではなく「クリックされること」。楽天アフィリエイトはリンクが押されて
24時間以内に買い物かごに入れば、別の商品が買われても報酬になる。
だから「買ってください」ではなく「ちょっと見てみたくなる」文章を書く。

【絶対に守るルール】
1. 与えられた商品データにある事実だけを書く。スペック・成分・産地・受賞歴を推測で補わない。
2. 「口コミによると」「レビューでは」など、レビュー本文を引用したかのような表現は書かない。
   （レビュー本文は与えられていない。件数と平均点だけが事実として使える）
3. 使ったことがある体で「愛用しています」「リピートしています」と書かない。
   代わりに「気になっている」「良さそう」など、事実に反しない距離感で書く。
4. 医薬品的な効能効果を書かない（薬機法）。「治る」「痩せる」「効く」は使わない。
5. 「日本一」「No.1」「最安」など根拠を示せない最上級表現を使わない（景品表示法）。
6. 「知らないと損」「9割が失敗」などの不安煽りは使わない。

【文章の質】
- 抽象的な褒め言葉（おしゃれ・便利・優秀）で終わらせず、商品説明から読み取れる
  具体的なベネフィット（それを使うと生活がどう変わるか）を1つに絞って書く。
- 話し言葉。「です・ます」でも硬すぎない、友人に教えるトーン。
- 3パターンは訴求の切り口を変える。同じことを言い換えただけにしない。`;

export function buildRoomPrompt({ item, persona, maxChars, event, hashtagCount }) {
  const eventLine = event
    ? `\n【イベント文脈】\n${event.label}が${event.daysUntil === 0 ? '本日' : `${event.daysUntil}日後`}にあります。\n${event.strategy}\n3パターンのうち1つは、このイベントに触れた切り口にしてください（「${event.label}で」程度の自然な触れ方に留めること）。`
    : '';

  return `以下の商品について、楽天ROOMのコメント（紹介文）を3パターン作ってください。

【商品データ（これ以外の事実を書かないこと）】
- 商品名: ${item.name}
- 価格: ${item.price.toLocaleString('ja-JP')}円（投稿時点）
- ショップ: ${item.shopName}
- レビュー件数: ${item.reviewCount}件
- レビュー平均: ${item.reviewAverage} / 5.0
- 商品説明: ${cleanCaption(item.caption) || '(説明文なし。商品名から読み取れる範囲のみで書くこと)'}

【想定読者】
${persona}

【紹介文の条件】
- 各パターン ${maxChars}文字以内。改行は1回まで。
- 3パターンで訴求の切り口（angle）を変える。例: 悩み解決 / 時短 / コスパ / 使うシーン / 意外性
- 絵文字は各パターン0〜2個まで。
${eventLine}

【ハッシュタグ】
- ${hashtagCount}個以内。楽天ROOMは検索流入があるため、商品名の一般名詞を必ず含める。`;
}

export const ROOM_SCHEMA = {
  type: 'object',
  properties: {
    benefit: {
      type: 'string',
      description: '商品説明から抽出した中心ベネフィット。「それを使うと生活がどう変わるか」を1文で',
    },
    targetPersona: { type: 'string', description: 'この文章が刺さる読者像を1文で' },
    variants: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object',
        properties: {
          angle: { type: 'string', description: '訴求の切り口（悩み解決/時短/コスパ/使うシーン/意外性 など）' },
          text: { type: 'string', description: '紹介文本体' },
        },
        required: ['angle', 'text'],
      },
    },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
  required: ['benefit', 'targetPersona', 'variants', 'hashtags'],
};

/** 生成物の機械的な検品。プロンプト任せにしない部分。 */
export function sanitizeRoom(draft, { maxChars, hashtagCount, disclosureRequired, disclosureText }) {
  const out = structuredClone(draft);

  // 根拠のない最上級表現・薬機法アウト表現・使用体験の捏造を削る
  const banned = /(日本一|世界一|業界No\.?1|最安値保証|必ず痩せ|絶対に治|完治)/g;
  const fakeExperience = /(愛用して(います|る)|リピートして(います|る)|使ってみたところ|届きました)/g;
  const fakeQuote = /(口コミ(に?よる|では|を見ると)|レビュー(に?よる|では|を見ると))/g;

  out.variants = (out.variants ?? []).map((v) => {
    let text = String(v.text ?? '')
      .replace(banned, '')
      .replace(fakeExperience, '気になっています')
      .replace(fakeQuote, 'レビュー件数を見るかぎり')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    // 楽天ROOMのコメント欄は長文が折り返されて読まれないため、必ず上限内に収める
    if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
    return { angle: String(v.angle ?? '').trim(), text, chars: text.length };
  }).filter((v) => v.text);

  const seen = new Set();
  out.hashtags = (out.hashtags ?? [])
    .map((t) => `#${String(t).replace(/^#+/, '').replace(/[\s#]/g, '')}`)
    .filter((t) => t.length > 1 && !seen.has(t) && seen.add(t))
    .slice(0, hashtagCount);

  // ステマ規制（景品表示法）: 楽天ROOMもアフィリエイトなので広告である旨の明示が必要。
  // 各パターンの末尾に固定で付ける（LLMに任せると落とすことがある）。
  if (disclosureRequired) {
    out.variants = out.variants.map((v) => ({
      ...v,
      posting: v.text.includes(disclosureText) ? v.text : `${v.text}\n${disclosureText}`,
    }));
  } else {
    out.variants = out.variants.map((v) => ({ ...v, posting: v.text }));
  }

  return out;
}

export async function generateRoomComment(item, cfg, { event = null } = {}) {
  const client = new Anthropic({
    apiKey: cfg.anthropicApiKey,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });

  const message = await client.messages.create({
    model: cfg.model,
    max_tokens: 2000,
    system: ROOM_SYSTEM_PROMPT,
    tools: [{ name: 'submit_room_comment', description: '楽天ROOMの紹介文を提出する', input_schema: ROOM_SCHEMA }],
    tool_choice: { type: 'tool', name: 'submit_room_comment' },
    messages: [{
      role: 'user',
      content: buildRoomPrompt({
        item,
        persona: cfg.roomPersona,
        maxChars: cfg.roomMaxChars,
        hashtagCount: cfg.roomHashtags,
        event,
      }),
    }],
  });

  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse) throw new Error('Claude が構造化出力を返しませんでした');
  log(`ROOM紹介文を生成 (in=${message.usage.input_tokens} out=${message.usage.output_tokens} tokens)`);

  return sanitizeRoom(toolUse.input, {
    maxChars: cfg.roomMaxChars,
    hashtagCount: cfg.roomHashtags,
    disclosureRequired: cfg.disclosureRequired,
    disclosureText: cfg.roomDisclosureText,
  });
}
