/**
 * 候補商品のスコアリングと選定。
 *
 * 「ランキング1位をそのまま投稿する」だと (1) 競合と丸かぶり (2) 高額商品ばかり
 * (3) レビューが薄い新商品を掴む、という失敗をする。そこで複数軸の加重和で選ぶ。
 */
import { normalize } from '../util.js';

const WEIGHTS = {
  reviewVolume: 0.30,   // レビュー数 = 実際に売れている証拠
  reviewQuality: 0.28,  // 平均評価 = 紹介して炎上しない安全性
  priceFit: 0.20,       // 想定レンジの中心に近いほど衝動購入されやすい
  freshness: 0.12,      // ランキング上位 = 今の需要
  media: 0.10,          // 画像枚数 = カルーセルを作れるか
};

/** 除外すべき商品を弾く。ここを通らないものはスコアリング以前の問題 */
export function isEligible(item, cfg, reasons = []) {
  const push = (r) => { reasons.push(r); return false; };
  if (!item.images?.length) return push('画像なし');
  if (!item.name) return push('商品名なし');
  if (item.price < cfg.minPrice) return push(`価格が下限未満 (${item.price})`);
  if (item.price > cfg.maxPrice) return push(`価格が上限超過 (${item.price})`);
  if (item.reviewCount < cfg.minReviewCount) return push(`レビュー数不足 (${item.reviewCount})`);
  if (item.reviewAverage < cfg.minReviewAverage) return push(`評価が低い (${item.reviewAverage})`);
  // 誇大表現・規制リスクの高いカテゴリは自動投稿の対象外にする
  if (/(医薬品|処方|treatment|痩せる|即効|完治|ガン|癌)/i.test(item.name)) return push('薬機法リスク語を含む');
  return true;
}

export function scoreItem(item, cfg, stats) {
  const midPrice = (cfg.minPrice + cfg.maxPrice) / 2;
  const spread = Math.max(1, (cfg.maxPrice - cfg.minPrice) / 2);

  const parts = {
    // レビュー数は裾が長いので対数で潰してから正規化する
    reviewVolume: normalize(Math.log10(item.reviewCount + 1), 0, Math.log10(stats.maxReviewCount + 1)),
    reviewQuality: normalize(item.reviewAverage, 3.0, 5.0),
    priceFit: 1 - Math.min(1, Math.abs(item.price - midPrice) / spread),
    freshness: item.rank ? normalize(101 - Math.min(100, item.rank), 1, 100) : 0.35,
    media: normalize(item.images.length, 1, 4),
  };

  const score = Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + w * parts[k], 0);
  return { score: Number(score.toFixed(4)), parts };
}

/**
 * 候補プールから投稿する商品を選ぶ。
 * @param {object[]} pool 正規化済み商品
 * @param {object} cfg config.research
 * @param {object} history 投稿履歴（重複回避に使う）
 * @param {number} take 選ぶ件数
 */
export function selectItems(pool, cfg, history, take = 1) {
  const rejected = [];
  const eligible = pool.filter((item) => {
    const reasons = [];
    if (!isEligible(item, cfg, reasons)) { rejected.push({ id: item.id, name: item.name, reasons }); return false; }
    if (history.hasItem(item.id)) { rejected.push({ id: item.id, name: item.name, reasons: ['投稿済み'] }); return false; }
    if (history.shopUsedWithin(item.shopCode, cfg.shopCooldownDays)) {
      rejected.push({ id: item.id, name: item.name, reasons: [`同ショップを${cfg.shopCooldownDays}日以内に投稿済み`] });
      return false;
    }
    return true;
  });

  const stats = { maxReviewCount: Math.max(1, ...eligible.map((i) => i.reviewCount)) };
  const scored = eligible
    .map((item) => ({ ...item, ...scoreItem(item, cfg, stats) }))
    .sort((a, b) => b.score - a.score);

  // 上位から取るが、同一ジャンルの連続を避けて多様性を残す
  const picked = [];
  const usedGenres = new Set();
  for (const item of scored) {
    if (picked.length >= take) break;
    if (usedGenres.has(item.genreId) && scored.length > take * 3) continue;
    usedGenres.add(item.genreId);
    picked.push(item);
  }
  // 多様性フィルタで足りなくなったら素直に上位で埋める
  for (const item of scored) {
    if (picked.length >= take) break;
    if (!picked.includes(item)) picked.push(item);
  }

  return { picked, scored, rejected };
}
