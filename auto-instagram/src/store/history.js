/**
 * 投稿履歴ストア（JSONファイル）。
 * DBを立てずに済むよう、リポジトリにコミットされる JSON を単一の真実とする。
 * 履歴は「重複投稿の防止」と「1日あたりの投稿上限」の両方に使う。
 */
import fs from 'node:fs';
import path from 'node:path';
import { jstDateKey, nowJst } from '../util.js';

const EMPTY = { version: 1, posts: [] };

export class History {
  constructor(file) {
    this.file = file;
    this.data = EMPTY;
  }

  static load(file) {
    const h = new History(file);
    try {
      if (fs.existsSync(file)) h.data = { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
      console.warn(`履歴の読み込みに失敗したため空から開始します: ${e.message}`);
    }
    return h;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
  }

  hasItem(itemId) {
    return this.data.posts.some((p) => p.itemId === itemId);
  }

  shopUsedWithin(shopCode, days) {
    if (!shopCode || !days) return false;
    const cutoff = Date.now() - days * 86400000;
    return this.data.posts.some((p) => p.shopCode === shopCode && Date.parse(p.at) > cutoff);
  }

  /** JST の当日に「実際に公開まで到達した」件数 */
  publishedToday() {
    const today = jstDateKey();
    return this.data.posts.filter((p) => p.status === 'published' && p.jstDate === today).length;
  }

  record(entry) {
    this.data.posts.push({
      at: new Date().toISOString(),
      jstDate: jstDateKey(nowJst()),
      ...entry,
    });
    // 無限に肥大化させない（重複判定に必要な期間だけ保持）
    if (this.data.posts.length > 2000) this.data.posts = this.data.posts.slice(-2000);
    return this;
  }
}
