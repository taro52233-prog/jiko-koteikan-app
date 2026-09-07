/**
 * 候補商品のスコアリングと選定。
 *
 * ■ なぜ「クリック最適化」が既定なのか
 * 楽天アフィリエイト(ROOM)の報酬は「リンクをクリック → 24時間以内に買い物かご →
 * 90日以内に購入」で発生し、**紹介した商品そのものが売れる必要はない**。
 * クリック後に楽天市場で別の何かが買われても報酬になる。
 * したがって最適化すべきは成約率ではなく「クリックされる確率」であり、
 * 高額商品を売り込むより、多くの人が思わず押す低〜中価格帯の話題商品が強い。
 *
 * Instagram 側のように「その商品を実際に買ってもらう」ことを狙う場合は
 * SCORING_PROFILE=conversion で従来の重み付けに切り替えられる。
 */
import { normalize } from '../util.js';

export const PROFILES = {
  // 楽天ROOM 向け。クリック単価ではなくクリック数を最大化する
  click: {
    reviewVolume: 0.32,   // レビュー数 = 多くの人が関心を持っている証拠
    trend: 0.24,          // ランキング上位 = 今この瞬間の需要
    clickEase: 0.18,      // 低価格ほど「とりあえず見てみる」の心理的ハードルが低い
    reviewQuality: 0.14,  // 低評価品を紹介するとフォロワーの信頼を失うので0にはしない
    media: 0.12,          // 写真の見栄え = サムネイルで止まるか
  },
  // Instagram 等、その商品自体の購入を狙う場合
  conversion: {
    reviewVolume: 0.30,
    reviewQuality: 0.28,
    clickEase: 0.20,
    trend: 0.12,
    media: 0.10,
  },
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

export function scoreItem(item, cfg, stats, profile = 'click') {
  const weights = PROFILES[profile] ?? PROFILES.click;
  // イベントに応じた狙い目価格帯（お買い物マラソンなら1,000円前後 など）
  const band = cfg.priceHint ?? { min: cfg.minPrice, max: cfg.maxPrice };
  const mid = (band.min + band.max) / 2;
  const spread = Math.max(1, (band.max - band.min) / 2);

  const parts = {
    // レビュー数は裾が長いので対数で潰してから正規化する
    reviewVolume: normalize(Math.log10(item.reviewCount + 1), 0, Math.log10(stats.maxReviewCount + 1)),
    reviewQuality: normalize(item.reviewAverage, 3.0, 5.0),
    // 狙い目価格帯の中心に近いほど高い。帯を外れるほど滑らかに減点する
    clickEase: 1 - Math.min(1, Math.abs(item.price - mid) / spread),
    trend: item.rank ? normalize(101 - Math.min(100, item.rank), 1, 100) : 0.35,
    media: normalize(item.images.length, 1, 4),
  };

  const score = Object.entries(weights).reduce((sum, [k, w]) => sum + w * parts[k], 0);
  return { score: Number(score.toFixed(4)), parts, profile };
}

/**
 * 候補プールから投稿する商品を選ぶ。
 * @param {object[]} pool 正規化済み商品
 * @param {object} cfg config.research（priceHint を差し込むとイベント対応になる）
 * @param {object} history 投稿履歴（重複回避に使う）
 * @param {number} take 選ぶ件数
 * @param {string} profile 'click' | 'conversion'
 */
export function selectItems(pool, cfg, history, take = 1, profile = 'click') {
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
    .map((item) => ({ ...item, ...scoreItem(item, cfg, stats, profile) }))
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

/**
 * お買い物マラソン用の「買い回りリスト」を作る。
 *
 * 買い回りはポイント倍率が「購入したショップ数」で決まるため、
 * ユーザーが欲しいのは安い商品そのものではなく **全部ショップが違う 1,000円前後の商品リスト**。
 * ここだけはスコア順ではなく「ショップの重複を許さない」ことを最優先する。
 */
export function selectKaimawari(pool, cfg, history, take = 10) {
  const band = cfg.priceHint ?? { min: 800, max: 1800 };
  const eligible = pool.filter((item) => {
    if (!isEligible(item, { ...cfg, minPrice: band.min, maxPrice: band.max })) return false;
    return !history.hasItem(item.id);
  });

  const stats = { maxReviewCount: Math.max(1, ...eligible.map((i) => i.reviewCount)) };
  const scored = eligible
    .map((item) => ({ ...item, ...scoreItem(item, { ...cfg, priceHint: band }, stats, 'click') }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const usedShops = new Set();
  for (const item of scored) {
    if (picked.length >= take) break;
    if (usedShops.has(item.shopCode)) continue;   // ショップ重複は買い回りの意味を失わせる
    usedShops.add(item.shopCode);
    picked.push(item);
  }
  return { picked, shopCount: usedShops.size };
}
