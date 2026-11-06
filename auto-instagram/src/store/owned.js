/**
 * 実際に所有・使用している商品の登録。
 *
 * 「使ってみた感想」は、実際に使った物についてだけ書ける。
 * 未使用の商品について使用体験を書くのは、PR表記があっても
 * 景品表示法（優良誤認・ステマ規制）と楽天アフィリエイト規約の両方に触れる。
 *
 * ただし「使った体験として書きたい」という要求自体は正当なので、
 * ここに登録した商品に限り、登録メモ（本人が実際に感じたこと）を材料に
 * 一人称の使用体験として書けるようにしている。
 * つまり嘘をつくのではなく、本当の体験を書きやすくする方向で解いている。
 */
import fs from 'node:fs';

export class OwnedItems {
  constructor(items = []) { this.items = items; }

  static load(file) {
    try {
      if (!fs.existsSync(file)) return new OwnedItems();
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const items = (raw.items ?? [])
        // メモが空の登録は「体験の中身が無い」ので無効にする。
        // これが無いと結局LLMが体験を創作することになる。
        .filter((i) => i && typeof i.match === 'string' && i.match.trim() && String(i.note ?? '').trim())
        .map((i) => ({ match: i.match.trim(), note: String(i.note).trim(), since: i.since ?? null }));
      return new OwnedItems(items);
    } catch (e) {
      console.warn(`所有商品リストの読み込みに失敗: ${e.message}`);
      return new OwnedItems();
    }
  }

  /** 商品が所有登録されていれば、その登録情報を返す */
  find(item) {
    const haystack = `${item.id ?? ''} ${item.name ?? ''}`;
    return this.items.find((o) => haystack.includes(o.match)) ?? null;
  }
}
