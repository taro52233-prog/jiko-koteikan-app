/**
 * 自分の Threads 投稿の実績ストア。
 *
 * ■ 何のためにあるか
 * 他人のバズを分析しても、伸びた理由のうちフォロワー数・写真・投稿時間の寄与を
 * 取り除けない。自分の投稿なら、フォロワー・写真の作り方・アカウントの信用が
 * ほぼ固定なので、**書き出しの型だけが変数**になる。だから比較に意味が出る。
 *
 * ■ 並べる基準は views ではなく likes / views
 * views（閲覧数）は配信量で、アルゴリズム・投稿時刻・画像に強く左右される。
 * 文章の力に近いのは「見た人のうち何人が反応したか」＝ likes / views。
 * ここを主たる指標にする。views は参考として併記する。
 *
 * ■ 中央値を使う
 * 1本だけ跳ねた投稿に平均が引っ張られると、型の優劣を見誤る。
 * 件数が少ないうちは中央値のほうが素直なので、中央値で並べ、件数を必ず出す。
 */
import fs from 'node:fs';
import path from 'node:path';
import { warn } from '../util.js';
import { classifyOpening, typeLabel } from '../content/classify.js';

const EMPTY = { version: 1, updatedAt: null, posts: [] };

/** 生成に反映してよいと判断するまでに必要な、1つの型あたりの最低件数 */
export const MIN_SAMPLES = 3;

function median(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export class StyleFeedback {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY);
  }

  static load(file) {
    const f = new StyleFeedback(file);
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        f.data = { ...structuredClone(EMPTY), ...raw };
        if (!Array.isArray(f.data.posts)) f.data.posts = [];
      }
    } catch (e) {
      warn(`実績の読み込みに失敗したため空から開始します: ${e.message}`);
    }
    return f;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data.updatedAt = new Date().toISOString();
    // 古い投稿まで残すと型の判定基準を変えたときに過去が混ざるので、1年で切る
    const cutoff = Date.now() - 365 * 86400000;
    this.data.posts = this.data.posts.filter((p) => !p.timestamp || Date.parse(p.timestamp) > cutoff);
    fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
    return this;
  }

  /**
   * 取得した投稿を取り込む。
   * 同じ id は上書きする（指標は後から伸びるため、最新の値が正しい）。
   */
  merge(posts) {
    const byId = new Map(this.data.posts.map((p) => [p.id, p]));
    let added = 0;
    for (const post of posts ?? []) {
      if (!post?.id) continue;
      if (!byId.has(post.id)) added += 1;
      byId.set(post.id, {
        ...byId.get(post.id),
        ...post,
        // 型は本文から判定する。本文を直して投稿していても追えるようにするため
        type: classifyOpening(post.text),
      });
    }
    this.data.posts = [...byId.values()]
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return { added, total: this.data.posts.length };
  }

  /**
   * 型ごとの集計。reactionRate（likes / views の中央値）の高い順。
   *
   * @param {number} opts.days  集計対象の期間
   * @param {number} opts.minSamples  これ未満の件数の型は enough:false を立てる
   */
  summary({ days = 90, minSamples = MIN_SAMPLES } = {}) {
    const cutoff = Date.now() - days * 86400000;
    const posts = this.data.posts.filter((p) => !p.timestamp || Date.parse(p.timestamp) > cutoff);

    const groups = new Map();
    for (const p of posts) {
      const type = p.type || classifyOpening(p.text);
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(p);
    }

    const rows = [...groups.entries()].map(([type, list]) => {
      // 反応率は views が取れている投稿だけで出す（0除算と欠損を混ぜない）
      const rates = list
        .filter((p) => typeof p.views === 'number' && p.views > 0 && typeof p.likes === 'number')
        .map((p) => p.likes / p.views);
      return {
        type,
        label: typeLabel(type),
        n: list.length,
        medianViews: median(list.map((p) => p.views)),
        medianLikes: median(list.map((p) => p.likes)),
        reactionRate: median(rates),
        enough: list.length >= minSamples,
      };
    });

    rows.sort((a, b) => {
      // 反応率が出せない型は後ろへ
      if (a.reactionRate === null && b.reactionRate === null) return b.n - a.n;
      if (a.reactionRate === null) return 1;
      if (b.reactionRate === null) return -1;
      return b.reactionRate - a.reactionRate;
    });

    return {
      days,
      total: posts.length,
      minSamples,
      /** 生成に反映してよい段階か。足りないうちは報告だけに留める */
      actionable: rows.filter((r) => r.enough).length >= 2,
      rows,
    };
  }
}
