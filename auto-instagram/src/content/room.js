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

■ 書くのは「発見」です
  この商品を見て、自分の中の思い込みが何に更新されたかを書きます。
  「こんなのあるんだ」「知らなかった」「あったのか」「見つけた」

■ 自分の購買行動は書かない
  「カートに入れっぱなし」「ぽちるか迷ってる」「買うか悩んでる」
  「このタイミングで決めようかな」「様子見中」
  → 読み手に「迷ってるなら買え」と言っているように読めます。
    買うかどうかは読み手に関係がありません。商品への発見だけを書いてください。

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
  // 日数だけを渡すと「2日後0と5のつく日で」のように助詞が落ちた硬い文になるので、
  // 日付も一緒に渡して自然に書けるようにする。日付は自分で数え直させない。
  const eventDate = event?.date ? `${Number(event.date.slice(5, 7))}/${Number(event.date.slice(8, 10))}` : '';
  const eventLine = event
    ? `\n【イベント文脈】\n${event.label}は ${eventDate}（${event.daysUntil === 0 ? '本日' : `${event.daysUntil}日後`}）です。\n`
      + `日付に触れるなら「${eventDate}」または「${event.daysUntil === 0 ? '今日' : `${event.daysUntil}日後`}」と書いてください。自分で数え直さないこと。\n`
      + `${event.strategy}\n`
      + `3パターンのうち1つは、このイベントに触れてかまいません。ただし触れるのは\n`
      + `**日付がある、という事実だけ**です。「お得」「得する」「安く買える」「買い時」のように\n`
      + `得だと説明するのは売り込みになるので書かないでください。\n`
      + `× 「日用品っていつ買っても同じだと思ってたけど、タイミング合わせるとちょっと得なんだな」\n`
      + `○ 「${eventDate}に${event.label}くるんだった、覚えとこ」`
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
- 「え、〇〇って△△だと思ってたけど、〜あったのか…。」の型を使うのは **3本のうち1本だけ**。
  残る2本は別の入り方にしてください（商品名から／値段から／変な観察から／自分ならこう使う、など）。
  毎日の投稿が同じ書き出しで並ぶと、読み手にはテンプレだと一目で分かります。
- **レビュー件数と平均点を本文に書かない**。
  「レビュー2万件超えてるの見て納得した」「平均4.57って数字で二度見した」は、
  数字を持ってきて褒める形で、商品説明の読み上げと同じです。
  件数は投稿画面の商品カードに既に出ています。本文の60〜70文字は、
  **自分が何に気づいたか**だけに使ってください。
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
    // 3パターンは入れ子（配列の中にオブジェクト）にしない。
    // 入れ子にするとモデルが自分のツール記法を JSON の値として書いてくる
    // （実測で6回中5回 `<parameter name="angle">...` という文字列が返った）。
    // 平坦な文字列に分けると、この崩れ方をしなくなる。
    angle1: { type: 'string', description: '1本目の切り口（例: イメージの更新 / 変な使い方 / 値段 / 見た目 / セール）' },
    text1: { type: 'string', description: '1本目の紹介文本体' },
    angle2: { type: 'string', description: '2本目の切り口。1本目と変えること' },
    text2: { type: 'string', description: '2本目の紹介文本体' },
    angle3: { type: 'string', description: '3本目の切り口。1・2本目と変えること' },
    text3: { type: 'string', description: '3本目の紹介文本体' },
    hashtags: { type: 'array', items: { type: 'string' } },
    // Threads / X 用の2段構成。こちらも同じ理由で平坦にする。
    threadsParent: {
      type: 'string',
      description:
        'Threads / X の親投稿の本文。**商品名もリンクも書かない**。写真と一緒に読まれる前提で、'
        + '自分が知らなかったことが更新された瞬間を書く。60〜100文字。'
        + '例: 「え、正直ニトリやダイソーの白い突っ張り棒しか知らなかったけど、こんなインテリアに馴染むのあったのか…。」',
    },
    threadsReply: {
      type: 'string',
      description:
        '親投稿への自分のリプライ。リンクに添える一言だけ。10文字以内。売り込まない。'
        + '例: 「ここのです」「これです」「これ」',
    },
    scenePrompt: {
      type: 'string',
      description:
        '使用シーン画像を生成するための英語プロンプト（1〜2文）。'
        + 'ペインが解消された「生活の一場面」を写真的に描写する。'
        + '商品そのもの・ブランドロゴ・文字は描かないこと。人物は手や足元までに留め、顔は入れない。'
        + '例: "A quiet Japanese bathroom in soft morning light, bare feet stepping onto a dry mat, minimal and clean."',
    },
  },
  required: ['hook', 'benefit', 'targetPersona',
    'angle1', 'text1', 'angle2', 'text2', 'angle3', 'text3',
    'hashtags', 'threadsParent', 'threadsReply', 'scenePrompt'],
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

/**
 * モデルが JSON の値として書いてきた自分のツール記法を解釈し直す。
 *
 * 構造化出力を強制していても、モデルは稀に値の位置へ
 * `<parameter name="text1">本文…</parameter>` のような自分の記法を書いてくる。
 * スキーマを平坦にしたことで、この記法に現れる名前が
 * こちらのキー名と一致するようになったため、拾い直せる。
 */
export function recoverParameters(text) {
  const found = {};
  const re = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)(?=<parameter\s+name=|<\/parameter>|$)/g;
  for (const m of String(text).matchAll(re)) {
    const value = m[2].replace(/<\/?(parameter|invoke|function_calls)[^>]*>/g, '').trim();
    if (value) found[m[1]] = value;
  }
  return found;
}

/**
 * ツールの返り値を内部表現に揃える。
 *
 * 受けつける形は3つ:
 *   1. 現行の平坦な形（angle1 / text1 … / threadsParent / threadsReply）
 *   2. 旧来の入れ子の形（variants: [{angle, text}] / threadsPost: {parent, reply}）
 *      — 保存済みの下書きやテストがこの形なので残す
 *   3. 1 のキーに向けてツール記法の文字列が混ざった形 — 拾い直す
 */
export function normalizeRoomDraft(raw) {
  const out = { ...(raw && typeof raw === 'object' ? raw : {}) };

  // ツール記法が混ざっていたら、拾えた値で埋める（既に正しい値がある項目は触らない）
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== 'string' || !value.includes('<parameter name=')) continue;
    const got = recoverParameters(value);
    if (!Object.keys(got).length) continue;
    warn(`${key} にツール記法が混ざっていたため解釈し直しました: ${Object.keys(got).join(', ')}`);
    delete out[key];
    for (const [k, v] of Object.entries(got)) if (!out[k]) out[k] = v;
  }

  // 平坦なキーを variants に組み直す
  const flat = [];
  for (let i = 1; i <= 3; i++) {
    const text = out[`text${i}`];
    if (typeof text === 'string' && text.trim()) {
      flat.push({ angle: String(out[`angle${i}`] ?? '').trim(), text: text.trim() });
    }
    delete out[`text${i}`];
    delete out[`angle${i}`];
  }
  if (flat.length) out.variants = flat;

  // 平坦なキーを threadsPost に組み直す
  if (out.threadsParent !== undefined || out.threadsReply !== undefined) {
    out.threadsPost = {
      parent: out.threadsParent ?? out.threadsPost?.parent ?? '',
      reply: out.threadsReply ?? out.threadsPost?.reply ?? 'ここのです',
    };
  }
  delete out.threadsParent;
  delete out.threadsReply;

  return out;
}

export function sanitizeRoom(draft, {
  maxChars, hashtagCount, disclosureRequired, disclosureText, owned = false, register = 'polite',
}) {
  // disclosureRequired は呼び出し側で「モード × 商品が提供品か」から解決済み
  const out = structuredClone(draft);

  const banned = /(日本一|世界一|業界No\.?1|最安値保証|必ず痩せ|絶対に治|完治)/g;
  /**
   * 購入を検討している体の言い回し。
   * 読み手に「迷ってるなら買え」と言っているように読めるため、
   * この文体では最も広告くさくなる。プロンプトで禁じても出てくるので機械でも見る。
   */
  const salesy = /(カートに入れっぱなし|カート入れっぱなし|ぽちるか迷|買うか迷|買うか悩|購入を迷|購入を悩|様子見中|決めようかな|買うならこのタイミング)/;
  /**
   * 「え、〇〇って…だと思ってたけど」の型。
   * この型自体は効くので禁止しないが、3本とも同じだとテンプレに見える。
   * 1本に収まっているかを数えるために印をつける。
   */
  const sameOpening = /(^え[、,]|と思って(た|いた)けど|しか知らなかったけど)/;
  /**
   * レビュー件数・平均点を本文に持ち込む形。
   * 数字を根拠に褒める＝商品説明の読み上げなので、発見の文にはならない。
   * 件数は投稿画面の商品カードに出ているため、本文では重複でもある。
   */
  const citesReview = /(レビュー|口コミ)[^。]{0,24}(\d|万|件)|(\d|万)[^。]{0,8}件[^。]{0,16}(レビュー|口コミ|評価)|平均\s?\d[.．]\d/;
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
      .replace(fakeQuote, '見たかぎり');

    if (!owned) {
      // 言い換えは文体に合わせる。丁寧語の置換を砕けた文に混ぜると継ぎ目が目立つ
      text = text
        .replace(claimsUse, register === 'casual' ? '気になってて' : '気になっていて')
        .replace(claimsResult, register === 'casual' ? '変わりそう' : '変わりそうです');
    }

    text = text.replace(/[ \t]{2,}/g, ' ').trim();
    const isSalesy = salesy.test(text);
    if (isSalesy) warn(`購入検討をにおわせる言い回しが残っています: ${text.slice(0, 40)}`);
    const isTemplated = sameOpening.test(text);
    const isCitingReview = citesReview.test(text);
    if (isCitingReview) warn(`レビュー件数・平均点が本文に入っています: ${text.slice(0, 40)}`);
    // 楽天ROOMのコメント欄は長文が折り返されて読まれないため、必ず上限内に収める
    if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
    return {
      angle: String(v.angle ?? '').trim(), text, chars: text.length, owned,
      salesy: isSalesy, templated: isTemplated, citesReview: isCitingReview,
    };
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

  // Threads/X 用の2段構成。親投稿に商品名やURLが混ざっていたら落とす
  const tp = out.threadsPost ?? {};
  out.threadsPost = {
    parent: String(tp.parent ?? '').replace(/https?:\/\/\S+/g, '').replace(/[ \t]{2,}/g, ' ').trim(),
    reply: String(tp.reply ?? 'ここのです').replace(/https?:\/\/\S+/g, '').trim().slice(0, 12),
  };

  // 作り直す価値があるかを呼び出し側が判断するための数
  out.salesyCount = out.variants.filter((v) => v.salesy).length;
  out.templatedCount = out.variants.filter((v) => v.templated).length;
  out.citesReviewCount = out.variants.filter((v) => v.citesReview).length;

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
 * スキーマを平坦にし normalizeRoomDraft で拾い直しても、
 * 紹介文が1本も取れないことはあり得る。その場合は1度だけ作り直し、
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
    out = sanitizeRoom(normalizeRoomDraft(input), {
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
    if (!out.variants.length) {
      warn(`紹介文が空で返ったため作り直します (${attempt}/2): ${item.name.slice(0, 30)}`);
      continue;
    }
    if (attempt === 1) {
      // 過半数が「カートに入れっぱなし」調なら、選べる案が残らないので作り直す
      if (out.salesyCount * 2 > out.variants.length) {
        warn(`${out.variants.length}本中${out.salesyCount}本が購入検討調のため作り直します: ${item.name.slice(0, 30)}`);
        continue;
      }
      // 「え、〜と思ってたけど」が2本以上。毎日の投稿が同じ書き出しで並ぶのを避ける
      if (out.templatedCount >= 2 && out.variants.length >= 2) {
        warn(`${out.variants.length}本中${out.templatedCount}本が同じ書き出しのため作り直します: ${item.name.slice(0, 30)}`);
        continue;
      }
      // レビュー件数を根拠に褒める形が過半数
      if (out.citesReviewCount * 2 > out.variants.length) {
        warn(`${out.variants.length}本中${out.citesReviewCount}本がレビュー件数の引用のため作り直します: ${item.name.slice(0, 30)}`);
        continue;
      }
    }
    return out;
  }

  throw new Error(`紹介文を2回とも生成できませんでした: ${item.name.slice(0, 40)}`);
}
