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
import { buildStyleSection, resolveStyle, loadStyleSamples, DEFAULT_STYLE } from './style.js';
import { log, warn } from '../util.js';

const COMMON_RULES = `【絶対に守るルール】
1. 与えられた商品データにある事実だけを書く。スペック・成分・産地・受賞歴を推測で補わない。
2. 「口コミによると」「レビューでは」など、レビュー本文を引用したかのような表現は書かない。
   （レビュー本文は与えられていない。件数と平均点だけが事実として使える）
3. 医薬品的な効能効果を書かない（薬機法）。「治る」「痩せる」「効く」は使わない。
4. 「日本一」「No.1」「最安」など根拠を示せない最上級表現を使わない（景品表示法）。
5. 「知らないと損」「9割が失敗」などの不安煽りは使わない。`;

/**
 * 未所有の商品を書くときの「書いてよいこと／いけないこと」。
 *
 * 以前はここで「ペイン→事実→未来」の3拍子を強制していたが、
 * 参考にしている実アカウントの投稿を分析したところ、悩みから入る投稿は
 * 1つも無かった。型を課したうえに砕けた言葉を被せると、かえって
 * 広告の骨格が透ける。構成の指示は文体プロファイル側に寄せ、
 * ここは事実関係の縛りだけに絞る。
 */
const UNOWNED_RULES = `【この商品について書いてよいこと】

まだ手元に無い商品です。持っている体で書かないでください。

■ 使える立ち位置
  「気になってる」「ぽちるか迷ってる」「カートに入れっぱなし」「欲しい」
  「買うならこのタイミングかな」「見つけた」「良さそう」

■ 書いてはいけないこと
  所有・使用を前提にした語：
  「使ってみたら」「使ってる」「届いた」「愛用」「リピート」「買ってよかった」
  「洗ってみた」「試した」「効果があった」「〜が変わりました」
  → 持っていないので事実に反します。

■ 商品データの扱い
  スペックに触れるのは **1つだけ**。それも説明としてではなく、
  自分が引っかかった点として自然に混ぜる。
  × 「アスベスト不使用と記載があり安心材料だった」（説明の読み上げ）
  ○ 「ノンアスベストなんだ、って見て手が止まった」（自分の反応）

■ 想像で補わない
  使っていないので、使用感・耐久性・家族の反応などは書けません。
  商品ページを見て思ったこと・想像したことなら書けます
  （「これ洗面所を波打ち際にできるやつだ」のような勝手な見立てはむしろ歓迎）。`;

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

${COMMON_RULES}`;

export function buildRoomPrompt({ item, persona, maxChars, event, hashtagCount, owned, styleSection }) {
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

${owned ? OWNED_RULES(owned) : UNOWNED_RULES}

${styleSection}

【紹介文の条件】
- 各パターン ${maxChars}文字以内。改行は1回まで。
- 3パターンは**書き出しの型も切り口も変える**。同じ内容の言い換えは失敗です。
  例: 1本目は商品名から入って変な使い方の話、2本目は値段と買うタイミングの話、
      3本目は見た目や欠点に触れる話、のように毎回ちがう角度から入る。
- **3本とも語尾を「〜そう」で終わらせない**。揃うと機械が書いたように見えます。
${eventLine}

【ハッシュタグ】
${hashtagCount > 0
  ? `- ${hashtagCount}個以内。楽天ROOMは検索流入があるため、商品名の一般名詞を必ず含める。`
  : '- この文体ではハッシュタグを使いません。hashtags は空配列で返してください。'}`;
}

export const ROOM_SCHEMA = {
  type: 'object',
  properties: {
    hook: {
      type: 'string',
      description: 'この商品の、商品ページを見た人にしか気づけない引っかかりどころを1文で（売り文句の要約ではなく、妙に具体的な一点）',
    },
    benefit: {
      type: 'string',
      description: 'それを使うと生活がどう変わりそうかを1文で',
    },
    targetPersona: { type: 'string', description: 'この文章が刺さる読者像を1文で' },
    variants: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object',
        properties: {
          angle: { type: 'string', description: 'この文の切り口（例: 変な使い方 / 値段 / 欠点に触れる / 見た目 / セール）' },
          text: { type: 'string', description: '紹介文本体' },
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
  required: ['hook', 'benefit', 'targetPersona', 'variants', 'hashtags', 'scenePrompt'],
};

/**
 * 生成物の機械的な検品。
 * pain-first のときだけ「使用・所有を主張する表現」を落とす。
 * owned のときは本人が実際に使っているので、そのまま通す。
 */
/**
 * variants を配列に揃える。
 *
 * LLM は構造化出力を強制していても、稀に配列であるべき項目を
 * {"0": {...}, "1": {...}} のようなオブジェクトで返す。
 * ここで [] に落とすと例外は消えるが、3パターンまるごと黙って失われる
 * （実際にそうなった）。中身があるなら値を取り出して救う。
 */
function toArray(v, label) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const values = Object.values(v);
    if (values.length) {
      warn(`${label} が配列ではなくオブジェクトで返されたため、値を取り出して復元しました`);
      return values;
    }
  }
  if (v !== undefined && v !== null && v !== '') {
    warn(`${label} を配列として解釈できませんでした: ${JSON.stringify(v).slice(0, 80)}`);
  }
  return [];
}

export function sanitizeRoom(draft, {
  maxChars, hashtagCount, disclosureRequired, disclosureText, owned = false, register = 'polite',
}) {
  // disclosureRequired は呼び出し側で「モード × 商品が提供品か」から解決済み
  const out = structuredClone(draft);

  const banned = /(日本一|世界一|業界No\.?1|最安値保証|必ず痩せ|絶対に治|完治)/g;
  const fakeQuote = /(口コミ(に?よる|では|を見ると)|レビュー(に?よる|では|を見ると))/g;
  // 未所有の商品で「使った」と言い切る表現。owned のときは適用しない
  const claimsUse = /(愛用して(います|いる|る)|リピートして(います|いる|る)|使ってみたところ|使ってみたら|使ってみて|届きました|届いて|買ってよかった|試してみたら)/g;
  // 断定の完了形（使っていないのに結果を報告する形）
  const claimsResult = /(変わりました|なくなりました|解決しました|楽になりました|快適になりました)/g;

  out.variants = toArray(out.variants, 'variants')
    .filter((v) => v && typeof v === 'object')
    .map((v) => {
    let text = String(v.text ?? '')
      .replace(banned, '')
      .replace(fakeQuote, 'レビュー件数を見るかぎり');

    if (!owned) {
      // 言い換えは文体に合わせる。丁寧語の置換を砕けた文に混ぜると継ぎ目が目立つ
      text = text
        .replace(claimsUse, register === 'casual' ? '気になってて' : '気になっていて')
        .replace(claimsResult, register === 'casual' ? '変わりそう' : '変わりそうです');
    }

    text = text.replace(/[ \t]{2,}/g, ' ').trim();
    // 楽天ROOMのコメント欄は長文が折り返されて読まれないため、必ず上限内に収める
    if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
    return { angle: String(v.angle ?? '').trim(), text, chars: text.length, owned };
  }).filter((v) => v.text);

  const seen = new Set();
  out.hashtags = toArray(out.hashtags, 'hashtags').filter((t) => typeof t === 'string' || typeof t === 'number')
    .map((t) => `#${String(t).replace(/^#+/, '').replace(/[\s#]/g, '')}`)
    .filter((t) => t.length > 1 && !seen.has(t) && seen.add(t))
    .slice(0, hashtagCount);

  /**
   * 広告である旨の表示。
   *
   * 楽天アフィリエイトの公式ガイドラインでは、商品提供・イベント参加・
   * お試しクーポン利用など「成果報酬以外のやり取り」がある場合に必須で、
   * 自分で選んで自分で買った通常のアフィリエイト投稿では任意とされている。
   * 消費者庁の運用基準も、事業者とアフィリエイターの間で情報のやり取りが
   * 一切ない場合は「事業者の表示」に該当しないとしている。
   *
   * 位置は末尾ではなく **冒頭** に置く。公式は「冒頭にはっきり分かる形で」と
   * しており、末尾や小さな表記は分かりにくい表示として無効になり得る。
   */
  out.variants = out.variants.map((v) => ({
    ...v,
    posting: disclosureRequired && !v.text.startsWith(disclosureText)
      ? `${disclosureText}\n${v.text}`
      : v.text,
  }));
  out.disclosed = !!disclosureRequired;

  out.scenePrompt = String(out.scenePrompt ?? '').trim();
  // 旧フィールド名との互換（digest が pain を参照している）
  out.pain = out.pain ?? out.hook ?? '';
  out.writingMode = owned ? 'owned' : 'pain-first';
  out.register = register;
  return out;
}

/**
 * @param {object} opts.owned data/owned-items.json の登録情報。あれば使用体験として書く
 */
/**
 * 広告表示が必要かを判定する。
 * off    … 付けない
 * always … 常に付ける
 * auto   … 提供品（owned-items.json で pr: true）のときだけ付ける（既定）
 */
export function needsDisclosure(mode, owned) {
  if (mode === 'always') return true;
  if (mode === 'off') return false;
  return !!(owned && (owned.pr || owned.provided));
}

/**
 * 1件分の紹介文を作る。
 *
 * LLM は構造化出力を強制していても、稀に variants を配列ではなく
 * ツール記法が混ざった文字列（例: `<parameter name="angle">...`）で返す。
 * その場合 3パターンが空になるので、1度だけ作り直す。
 * それでも空なら例外にして、呼び出し側でその商品を飛ばす。
 * 空のまま digest に流すと、商品名だけ並んで紹介文が無い状態になる。
 */
export async function generateRoomComment(item, cfg, { event = null, owned = null } = {}) {
  const useOwned = cfg.writingMode === 'auto' ? owned : null;

  const { profile, samples } = loadStyleSamples(cfg.styleSamplesPath);
  const styleName = cfg.roomStyle || profile || DEFAULT_STYLE;
  const style = resolveStyle(styleName);
  const maxChars = cfg.roomMaxChars > 0 ? cfg.roomMaxChars : style.maxChars;
  const hashtagCount = cfg.roomHashtags ?? style.hashtagCount;
  const styleSection = buildStyleSection({ styleName, samples, owned: !!useOwned });

  const client = new Anthropic({
    apiKey: cfg.anthropicApiKey,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });

  const ask = async () => {
    const message = await client.messages.create({
      model: cfg.model,
      max_tokens: 2000,
      system: ROOM_SYSTEM_PROMPT,
      tools: [{ name: 'submit_room_comment', description: '楽天ROOMの紹介文を提出する', input_schema: ROOM_SCHEMA }],
      tool_choice: { type: 'tool', name: 'submit_room_comment' },
      messages: [{
        role: 'user',
        content: buildRoomPrompt({
          item, persona: cfg.roomPersona, maxChars, hashtagCount, event, owned: useOwned, styleSection,
        }),
      }],
    });
    const toolUse = message.content.find((c) => c.type === 'tool_use');
    if (!toolUse) throw new Error('Claude が構造化出力を返しませんでした');
    return { input: toolUse.input, usage: message.usage };
  };

  let out = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { input, usage } = await ask();
    out = sanitizeRoom(input, {
      maxChars,
      hashtagCount,
      disclosureRequired: needsDisclosure(cfg.disclosureMode, owned),
      disclosureText: cfg.roomDisclosureText,
      owned: !!useOwned,
      register: style.register,
    });
    const label = `${useOwned ? '使用体験' : '未所有'} / ${style.label}` +
                  (samples.length ? ` / お手本${samples.length}本` : '');
    log(`ROOM紹介文を生成 [${label}] (in=${usage.input_tokens} out=${usage.output_tokens} tokens)`
        + (attempt > 1 ? ' ※作り直し' : ''));
    if (out.variants.length) return out;
    warn(`紹介文が空で返ったため作り直します (${attempt}/2): ${item.name.slice(0, 30)}`);
  }

  throw new Error(`紹介文を2回とも生成できませんでした: ${item.name.slice(0, 40)}`);
}
