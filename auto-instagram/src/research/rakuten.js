/**
 * 楽天ウェブサービス（楽天市場API）クライアント。
 *
 * Amazon PA-API ではなく楽天を既定にした理由:
 *  - PA-API v5 は「180日以内に3件の売上」が無いとアクセスが停止される = 立ち上げ期に自動化が止まる
 *  - 楽天は無料の Application ID だけで検索・ランキングが叩け、アフィリエイトIDも即日発行できる
 * Amazon を使いたい場合は同じ形の商品オブジェクトを返す provider を足せば差し替えられる。
 */
import { fetchJson, sleep } from '../util.js';

// テストや社内プロキシ経由のために差し替え可能にしてある
const API_BASE = process.env.RAKUTEN_API_BASE || 'https://app.rakuten.co.jp/services/api';
const SEARCH_ENDPOINT = `${API_BASE}/IchibaItem/Search/20220601`;
const RANKING_ENDPOINT = `${API_BASE}/IchibaItem/Ranking/20220601`;

/** 楽天のサムネイルURLは ?_ex=128x128 が付く。投稿用に大きい版へ差し替える */
export function upscaleImageUrl(url, size = 800) {
  if (!url) return '';
  return url.replace(/_ex=\d+x\d+/, `_ex=${size}x${size}`);
}

/** 楽天のレスポンス1件を、providerに依存しない共通形へ正規化する */
function normalizeItem(raw, source) {
  const it = raw.Item ?? raw;
  const images = [
    ...(it.largeImageUrls ?? []),
    ...(it.mediumImageUrls ?? []),
  ].map((o) => upscaleImageUrl(typeof o === 'string' ? o : o.imageUrl)).filter(Boolean);

  return {
    provider: 'rakuten',
    source,                                   // 'ranking' | 'search:<keyword>'
    id: it.itemCode,
    name: (it.itemName || '').trim(),
    caption: (it.itemCaption || '').trim(),
    price: Number(it.itemPrice) || 0,
    url: it.affiliateUrl || it.itemUrl,       // アフィリエイトIDがあれば affiliateUrl が入る
    rawUrl: it.itemUrl,
    shopName: it.shopName || '',
    shopCode: it.shopCode || '',
    genreId: String(it.genreId ?? ''),
    reviewCount: Number(it.reviewCount) || 0,
    reviewAverage: Number(it.reviewAverage) || 0,
    pointRate: Number(it.pointRate) || 1,
    rank: Number(it.rank) || null,
    images: [...new Set(images)],
  };
}

async function call(endpoint, params, label) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const body = await fetchJson(`${endpoint}?${qs}`, {}, { label });
  return Array.isArray(body.Items) ? body.Items : [];
}

/** ランキング上位を取る。トレンド性が高く「今売れているもの」を拾える */
export async function fetchRanking({ appId, affiliateId, genreId = '0', period = 'realtime', age, sex }) {
  const items = await call(RANKING_ENDPOINT, {
    applicationId: appId, affiliateId, genreId, period, age, sex,
  }, `rakuten-ranking(genre=${genreId})`);
  return items.map((i) => normalizeItem(i, `ranking:${genreId}`));
}

/** キーワード検索。ニッチ／自分の発信テーマに寄せた商品を拾える */
export async function searchItems({
  appId, affiliateId, keyword, genreId, minPrice, maxPrice, hits = 30, page = 1, sort = '-reviewCount',
}) {
  const items = await call(SEARCH_ENDPOINT, {
    applicationId: appId,
    affiliateId,
    keyword,
    genreId: genreId && genreId !== '0' ? genreId : undefined,
    minPrice, maxPrice,
    hits: Math.min(30, hits),
    page,
    sort,
    imageFlag: 1,        // 画像がある商品だけ（画像が無いと投稿を作れない）
    availability: 1,     // 在庫ありのみ（売切れを紹介しない）
  }, `rakuten-search(${keyword})`);
  return items.map((i) => normalizeItem(i, `search:${keyword}`));
}

/**
 * ランキング + キーワード検索を合わせて候補プールを作る。
 * 楽天APIは 1req/秒 が目安なので必ず間隔を空ける。
 */
const RATE_LIMIT_MS = Number(process.env.RAKUTEN_RATE_LIMIT_MS || 1100);

export async function collectCandidates(cfg) {
  const { rakutenAppId: appId, rakutenAffiliateId: affiliateId,
          keywords, genreIds, minPrice, maxPrice, poolSize } = cfg;
  const pool = new Map();
  const add = (arr) => arr.forEach((it) => { if (it.id && !pool.has(it.id)) pool.set(it.id, it); });

  for (const genreId of genreIds) {
    if (pool.size >= poolSize) break;
    try {
      add(await fetchRanking({ appId, affiliateId, genreId }));
    } catch (e) {
      console.warn(`ランキング取得に失敗 (genre=${genreId}): ${e.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  for (const keyword of keywords) {
    if (pool.size >= poolSize) break;
    try {
      add(await searchItems({ appId, affiliateId, keyword, minPrice, maxPrice }));
    } catch (e) {
      console.warn(`検索に失敗 (${keyword}): ${e.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  return [...pool.values()];
}
