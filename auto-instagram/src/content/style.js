/**
 * 文体プロファイル。
 *
 * 「あのアカウントみたいに書いて」を実現する仕組み。
 * 文体の指示を言葉で書くより、**実物のサンプルを数本見せる（few-shot）方が圧倒的に効く**ので、
 * data/style-samples.json に貼った実投稿を最優先の材料として使い、
 * プリセットはサンプルが無いときの土台として働く。
 *
 * casual-diary プリセットは、@piyopiyobiyou（かいいま）の投稿から観察した特徴に基づく。
 * 参考にしたのは主に次の点:
 *   - 見出しを作らず、文の途中から始まる独り言
 *   - 「ぽちった」「使ってる」「買ってみた」の話し言葉の言い切り
 *   - 商品ページを本当に見た人しか書けない粒度のディテール
 *   - アフィリエイトを踏ませない選択肢を自分から提示する読者配慮
 *   - ハッシュタグを使わず、リンクは最後に素で置く
 */
import fs from 'node:fs';

export const STYLE_PRESETS = {
  /**
   * 独り言・買い物報告型。
   * 整った紹介文ではなく「友達へのLINE」に近い。宣伝臭が消えるぶん、
   * 書き手が本当にその商品を見ている／使っていることが前提になる文体。
   */
  'casual-diary': {
    label: '独り言・買い物報告型',
    register: 'casual',
    maxChars: 120,
    hashtagCount: 0,
    rules: `【文体：独り言・買い物報告型】
■ 全体
- 見出しやキャッチコピーを作らない。**文の途中から始める。**
  ○「ここ4-7日で発送らしいので今買えばGWに使えるかなと思ってオレンジぽちった」
  ×「【必見】GWまでに間に合う！話題のバッグチャーム」
- 「です・ます」で整えない。話し言葉の言い切り・体言止め・独り言で書く。
  「〜してる」「〜だった」「〜かも」「〜じゃない？」
- 主語（私は・この商品は）はほぼ省略する。
- 読み手に呼びかけない。「皆さん」「あなた」を使わない。独り言が結果的に読まれている形にする。

■ ディテールが命
商品ページを本当に見た人にしか書けない**細かい一点**を必ず1つ入れる。
これが無いと、どれだけ砕けた文体にしても宣伝に見える。
  ○「口つけて何度もフーフーしなくてもいい」「リュックにネギさしてる後ろ姿の写真がある」
  ×「使いやすくて便利」「デザインもおしゃれ」
抽象的な褒め言葉だけの文は、この文体では失敗とみなす。

■ 感情は生でよい。ただし向ける先を間違えない
「超絶簡単」「ハイパー若い」のような大げさな言い方は、
**自分の感想**に対してなら使ってよい（「めっちゃ助かってる」）。
**商品の効能**に対しては使わない（「驚くほど汚れが落ちる」はNG）。

■ 読者への配慮を1文入れることがある
アフィリエイトを踏ませない逃げ道を自分から提示する。押しつけがましさが消え、信頼が残る。
  「リンク飛ぶの嫌な方はお手数ですがご自身で検索してください」

■ 禁止
- ハッシュタグの羅列（この文体では使わない）
- 「〜な人におすすめ」「〜で悩んでいませんか？」のテンプレ営業文
- 絵文字の多用（0〜1個。感情は「！！」で出す）`,
    /** 購入済みのときに自然に使える言い回し */
    ownedVerbs: '「ぽちった」「買ってみた」「使ってる」「届いた」「リピートしてる」',
    /** 未購入のときに自然に使える言い回し（このアカウントも検討中の投稿をしている） */
    unownedVerbs: '「ぽちるか迷ってる」「気になってる」「良さそう」「欲しい」「カートに入れっぱなし」',
  },

  /**
   * 整った紹介文。ペイン→事実→未来の3拍子をきれいに踏む。
   * 誰が書いても破綻しにくいが、宣伝臭は残る。
   */
  polished: {
    label: '整った紹介文型',
    register: 'polite',
    maxChars: 80,
    hashtagCount: 5,
    rules: `【文体：整った紹介文型】
- 「です・ます」で統一し、読みやすさを最優先する。
- 1文を短く切る。読点で区切って一息で読める長さにする。
- 絵文字は0〜2個。`,
    ownedVerbs: '「使っています」「買ってよかった」「リピートしています」',
    unownedVerbs: '「気になっています」「良さそうです」「欲しい」',
  },
};

export const DEFAULT_STYLE = 'casual-diary';

/**
 * data/style-samples.json を読む。
 * 形式: { "profile": "casual-diary", "samples": ["投稿本文", ...] }
 */
export function loadStyleSamples(file) {
  try {
    if (!fs.existsSync(file)) return { profile: null, samples: [] };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const samples = (raw.samples ?? [])
      .map((s) => String(s ?? '').trim())
      .filter((s) => s.length >= 10)   // 短すぎるものは文体の材料にならない
      .slice(0, 12);                   // 多すぎてもトークンを食うだけ
    return { profile: raw.profile ?? null, samples };
  } catch (e) {
    console.warn(`文体サンプルの読み込みに失敗: ${e.message}`);
    return { profile: null, samples: [] };
  }
}

/** 実サンプルからURL・ハッシュタグ・メンションを落とす（文体だけを見せたい） */
export function stripNoise(text) {
  return String(text)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#＃][^\s#＃]+/g, '')
    .replace(/@\w+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function resolveStyle(name) {
  return STYLE_PRESETS[name] ?? STYLE_PRESETS[DEFAULT_STYLE];
}

/**
 * プロンプトに差し込む文体セクションを組み立てる。
 * サンプルがあれば few-shot として最優先で見せ、無ければプリセットの記述だけを使う。
 */
export function buildStyleSection({ styleName, samples = [], owned }) {
  const style = resolveStyle(styleName);
  const verbs = owned ? style.ownedVerbs : style.unownedVerbs;

  const parts = [style.rules];

  if (samples.length) {
    const list = samples
      .map(stripNoise)
      .filter(Boolean)
      .map((s, i) => `${i + 1}) ${s}`)
      .join('\n');
    parts.push(`【お手本（実際の投稿。この語り口・リズム・粒度を真似る）】
${list}

上のサンプルから真似るのは **語り口・文の始め方・ディテールの粒度・感情の出し方** です。
サンプルに出てくる商品・エピソード・固有名詞そのものは絶対に流用しないこと。`);
  }

  parts.push(`【この商品での言い回し】
${owned
    ? `実際に持っている商品なので、${verbs} のような所有・使用を前提にした言い方をしてよい。`
    : `まだ持っていない商品なので、${verbs} のような検討中の言い方にする。\n「ぽちった」「使ってる」「届いた」は書かない（持っていないため）。`}`);

  return parts.join('\n\n');
}
