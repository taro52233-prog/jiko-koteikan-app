/**
 * 投稿キュー。build と publish を分離するための受け渡し場所。
 *
 * なぜ分けるか: Instagram は「公開URLの画像」しか受け付けない。つまり
 *   生成 → コミット&プッシュ → GitHub Pages 反映 → 投稿
 * の順序が必須で、1プロセスでは完結できない。キューがその継ぎ目になる。
 */
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { version: 1, items: [] };

export class Queue {
  constructor(file) { this.file = file; this.data = EMPTY; }

  static load(file) {
    const q = new Queue(file);
    try {
      if (fs.existsSync(file)) q.data = { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
      console.warn(`キューの読み込みに失敗したため空から開始します: ${e.message}`);
    }
    return q;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // 役目を終えたもの（公開済み・却下・digest配信済み）は30日で掃除する。
    // draft と pending は未消化なので残す。
    const done = ['published', 'rejected', 'delivered'];
    const cutoff = Date.now() - 30 * 86400000;
    this.data.items = this.data.items.filter(
      (i) => !done.includes(i.status) || Date.parse(i.createdAt) > cutoff
    );
    fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
  }

  add(entry) { this.data.items.push(entry); return entry; }
  find(slug) { return this.data.items.find((i) => i.slug === slug); }
  byStatus(status) { return this.data.items.filter((i) => i.status === status); }

  /** 公開すべきもの: 承認済み かつ 予定時刻を過ぎている */
  due(now = Date.now()) {
    return this.byStatus('approved')
      .filter((i) => !i.scheduledFor || Date.parse(i.scheduledFor) <= now)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  update(slug, patch) {
    const item = this.find(slug);
    if (item) Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    return item;
  }
}
