/**
 * 楽天ROOM 用の紹介文生成（80文字前後・口語体・3パターン）。
 *
 * ■ 書き方は2つある
 *
 * pain-first（既定）… まだ使っていない商品向け。
 *   「使ってみたら最高でした」と書く代わりに、**使う前のペインを一人称で具体的に描く**。
 *   ペインは商品と無関係に本人が本当に感じていることなので、実感を込めて書いても嘘にならない。
 *   そこへ商品データの事実を1つ橋渡しし、解決後の姿は推量（〜そう／〜らしい）で置く。
 *   読み手の中で「使う前 → 使った後」の像は完成するが、使用の事実は主張していない。
 *   一般的な体験談（「買ってよかった！」）より具体的なぶん、実際には強い。
 *
 * owned … data/owned-items.json に登録した、実際に持っている商品向け。
 *   登録メモ（本人が実際に感じたこと）を材料に、一人称の使用体験として書く。
 *   材料が本物なので、使用体験として書いても問題が無い。
 *
 * 未使用の商品について使用体験を創作しないのは、PR表記があっても
 * 体験内容の虚偽は景品表示法（優良誤認）と楽天アフィリエイト規約に触れるため。
 */
import Anthropic from '@anthropic-ai/sdk';
import { cleanCaption } from './prompt.js';
import { log } from '../util.js';

const COMMON_RULES = `【絶対に守るルール】
1. 与えられた商品データにある事実だけを書く。スペック・成分・産地・受賞歴を推測で補わない。
2. 「口コミによると」「レビューでは」など、レビュー本文を引用したかのような表現は書かない。
   （レビュー本文は与えられていない。件数と平均点だけが事実として使える）
3. 医薬品的な効能効果を書かない（薬機法）。「治る」「痩せる」「効く」は使わない。
4. 「日本一」「No.1」「最安」など根拠を示せない最上級表現を使わない（景品表示法）。
5. 「知らないと損」「9割が失敗」などの不安煽りは使わない。`;

const PAIN_FIRST_RULES = `【書き方：ペインファースト】
これは「使ってみた感想」ではなく、**まだ使っていない読み手が「使ったあとの自分」を想像するための文章**です。
必ず次の3拍子で書いてください。

■ 1拍目：ペイン（一人称・実感を込めて書く）
  読み手にも起きている「具体的に困る場面」を、あなた自身の実感として書く。
  これは商品と無関係にあなたが本当に感じていることなので、実感を込めて書いてよい。
  重要なのは「一般論」ではなく「場面」を書くこと。
  × 「バスマットが乾かないと困りますよね」（一般論。誰の心も動かない）
  ○ 「朝いちばんに踏んだとき、昨日の湿り気がまだ残ってるのが地味に嫌で」（場面。読み手が自分の朝を思い出す）

■ 2拍目：ブリッジ（商品データの事実を1つだけ）
  1拍目のペインに直接効く事実を、商品説明から1つだけ選んで置く。
  多く並べない。1つに絞るほど像が鮮明になる。

■ 3拍目：未来（推量表現）
  そのペインがどう消えるかを書く。ただし**必ず推量の形にする**。
  使えるかたち: 「〜そう」「〜らしい」「〜かもしれない」「〜が変わりそう」「〜が要らなくなりそう」
  × 「朝が変わりました」（使っていないので嘘になる）
  ○ 「これなら朝の一歩目が変わりそう」（同じ像を作れて、嘘にならない）

【この書き方で禁止する表現】
所有・使用を前提にした語を使わない：
  「使ってみたら」「使っています」「届いた」「愛用」「リピート」「買ってよかった」
  「洗ってみた」「試した」「効果がありました」「変わりました」
代わりに「気になっている」「良さそう」「欲しい」「狙ってる」の距離感で書く。`;

const OWNED_RULES = (owned) => `【書き方：使用体験】
この商品は**実際に所有・使用しているもの**として登録されています。
一人称の使用体験として書いてかまいません。

■ あなたの実際の使用メモ（この内容だけを体験の材料にする）
${owned.note}
${owned.since ? `■ 使い始めた時期: ${owned.since}` : ''}

■ 構成は同じく3拍子で
  1拍目：使う前に困っていた場面（一人称・具体的に）
  2拍目：この商品のどこがそれに効いたか（上記メモと商品データの範囲で）
  3拍目：いまどうなったか（メモに書かれている範囲で。誇張しない）

【禁止】
- 上記メモに書かれていない体験を足さない。
  使用期間・具体的な数値効果・家族の反応などをメモ外から作らない。
- メモに欠点が書かれている場合、それを打ち消す嘘を書かない。触れないのは可。`;

export const ROOM_SYSTEM_PROMPT = `あなたは楽天ROOMで商品を紹介する個人の運用者です。

【この文章の目的】
売り込むことではなく「クリックされること」。楽天アフィリエイトはリンクが押されて
24時間以内に買い物かごに入れば、別の商品が買われても報酬になる。
だから「買ってください」ではなく「ちょっと見てみたくなる」文章を書く。

【文章の質】
- 抽象的な褒め言葉（おしゃれ・便利・優秀）で終わらせない。
  読み手が自分の生活の一場面を思い浮かべられるかどうかが全て。
- 3パターンは訴求の切り口を変える。同じことを言い換えただけにしない。
- 話し言葉。友人に教えるトーン。

${COMMON_RULES}`;

export function buildRoomPrompt({ item, persona, maxChars, event, hashtagCount, owned }) {
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

${owned ? OWNED_RULES(owned) : PAIN_FIRST_RULES}

【紹介文の条件】
- 各パターン ${maxChars}文字以内。改行は1回まで。
- 3パターンで**ペインの場面を変える**。同じ困りごとの言い換えにしない。
  例: 朝の場面 / 来客の場面 / 梅雨の場面 のように、時間帯・状況をずらす。
- 絵文字は各パターン0〜2個まで。
${eventLine}

【ハッシュタグ】
- ${hashtagCount}個以内。楽天ROOMは検索流入があるため、商品名の一般名詞を必ず含める。`;
}

export const ROOM_SCHEMA = {
  type: 'object',
  properties: {
    pain: {
      type: 'string',
      description: 'この商品が解決する、読み手が実際に困っている場面を1文で（一般論ではなく具体的な場面）',
    },
    benefit: {
      type: 'string',
      description: 'そのペインが消えたあとの状態を1文で',
    },
    targetPersona: { type: 'string', description: 'この文章が刺さる読者像を1文で' },
    variants: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object',
        properties: {
          angle: { type: 'string', description: '取り上げたペインの場面（例: 朝の支度 / 梅雨 / 来客時）' },
          text: { type: 'string', description: '紹介文本体。ペイン→事実→未来の3拍子' },
        },
        required: ['angle', 'text'],
      },
    },
    hashtags: { type: 'array', items: { type: 'string' } },
    scenePrompt: {
      type: 'string',
      description:
        '使用シーン画像を生成するための英語プロンプト（1〜2文）。'
        + 'ペインが解消された「生活の一場面」を写真的に描写する。'
        + '商品そのもの・ブランドロゴ・文字は描かないこと。人物は手や足元までに留め、顔は入れない。'
        + '例: "A quiet Japanese bathroom in soft morning light, bare feet stepping onto a dry mat, minimal and clean."',
    },
  },
  required: ['pain', 'benefit', 'targetPersona', 'variants', 'hashtags', 'scenePrompt'],
};

/**
 * 生成物の機械的な検品。
 * pain-first のときだけ「使用・所有を主張する表現」を落とす。
 * owned のときは本人が実際に使っているので、そのまま通す。
 */
export function sanitizeRoom(draft, { maxChars, hashtagCount, disclosureRequired, disclosureText, owned = false }) {
  const out = structuredClone(draft);

  const banned = /(日本一|世界一|業界No\.?1|最安値保証|必ず痩せ|絶対に治|完治)/g;
  const fakeQuote = /(口コミ(に?よる|では|を見ると)|レビュー(に?よる|では|を見ると))/g;
  // 未所有の商品で「使った」と言い切る表現。owned のときは適用しない
  const claimsUse = /(愛用して(います|いる|る)|リピートして(います|いる|る)|使ってみたところ|使ってみたら|使ってみて|届きました|届いて|買ってよかった|試してみたら)/g;
  // 断定の完了形（使っていないのに結果を報告する形）
  const claimsResult = /(変わりました|なくなりました|解決しました|楽になりました|快適になりました)/g;

  out.variants = (out.variants ?? []).map((v) => {
    let text = String(v.text ?? '')
      .replace(banned, '')
      .replace(fakeQuote, 'レビュー件数を見るかぎり');

    if (!owned) {
      text = text
        .replace(claimsUse, '気になっていて')
        .replace(claimsResult, '変わりそう');
    }

    text = text.replace(/[ \t]{2,}/g, ' ').trim();
    // 楽天ROOMのコメント欄は長文が折り返されて読まれないため、必ず上限内に収める
    if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
    return { angle: String(v.angle ?? '').trim(), text, chars: text.length, owned };
  }).filter((v) => v.text);

  const seen = new Set();
  out.hashtags = (out.hashtags ?? [])
    .map((t) => `#${String(t).replace(/^#+/, '').replace(/[\s#]/g, '')}`)
    .filter((t) => t.length > 1 && !seen.has(t) && seen.add(t))
    .slice(0, hashtagCount);

  // ステマ規制（景品表示法）: 楽天ROOMもアフィリエイトなので広告である旨の明示が必要
  out.variants = out.variants.map((v) => ({
    ...v,
    posting: disclosureRequired && !v.text.includes(disclosureText)
      ? `${v.text}\n${disclosureText}`
      : v.text,
  }));

  out.scenePrompt = String(out.scenePrompt ?? '').trim();
  out.writingMode = owned ? 'owned' : 'pain-first';
  return out;
}

/**
 * @param {object} opts.owned data/owned-items.json の登録情報。あれば使用体験として書く
 */
export async function generateRoomComment(item, cfg, { event = null, owned = null } = {}) {
  const client = new Anthropic({
    apiKey: cfg.anthropicApiKey,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });

  // 設定が pain-first 固定なら、所有登録があっても使わない
  const useOwned = cfg.writingMode === 'auto' ? owned : null;

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
        owned: useOwned,
      }),
    }],
  });

  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse) throw new Error('Claude が構造化出力を返しませんでした');
  log(`ROOM紹介文を生成 [${useOwned ? '使用体験' : 'ペインファースト'}] (in=${message.usage.input_tokens} out=${message.usage.output_tokens} tokens)`);

  return sanitizeRoom(toolUse.input, {
    maxChars: cfg.roomMaxChars,
    hashtagCount: cfg.roomHashtags,
    disclosureRequired: cfg.disclosureRequired,
    disclosureText: cfg.roomDisclosureText,
    owned: !!useOwned,
  });
}
