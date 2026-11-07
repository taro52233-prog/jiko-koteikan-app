/**
 * 楽天ウェブサービス（楽天市場API）クライアント。
 *
 * Amazon PA-API ではなく楽天を既定にした理由:
 *  - PA-API v5 は「180日以内に3件の売上」が無いとアクセスが停止される = 立ち上げ期に自動化が止まる
 *  - 楽天は無料の Application ID だけで検索・ランキングが叩け、アフィリエイトIDも即日発行できる
 * Amazon を使いたい場合は同じ形の商品オブジェクトを返す provider を足せば差し替えられる。
 */
import { fetchJson, sleep } from '../util.js';

/**
 * 楽天APIは2026年にインフラごと刷新された。
 *   ホスト : app.rakuten.co.jp/services/api → openapi.rakuten.co.jp/ichibams/api
 *   認証   : applicationId のみ → applicationId + accessKey（pk_ で始まる）+ Referer
 *   版     : 20220601 → 20260701
 *
 * 旧ホストに新しい版を投げると「doesn't have version」、
 * 旧ホストに新しいIDを投げると「specify valid applicationId」になる。
 * どちらの誤りも同じ 400 wrong_parameter で返るため切り分けが難しい。
 * そこで (ホスト, 版) の組を順に試し、通った組をログに明示して以後は使い回す。
 */
const DEFAULT_ENDPOINTS = [
  'https://openapi.rakuten.co.jp/ichibams/api|20260701',
  'https://openapi.rakuten.co.jp/ichibams/api|20220601',
  'https://app.rakuten.co.jp/services/api|20220601',
];

/** テスト・社内プロキシ用。指定されたらそのホストだけを使う */
const BASE_OVERRIDE = process.env.RAKUTEN_API_BASE || '';

function parseEndpoints() {
  if (BASE_OVERRIDE) {
    const versions = (process.env.RAKUTEN_API_VERSIONS || '20260701,20220601')
      .split(',').map((v) => v.trim()).filter(Boolean);
    return versions.map((version) => ({ base: BASE_OVERRIDE, version }));
  }
  const raw = process.env.RAKUTEN_API_ENDPOINTS || DEFAULT_ENDPOINTS.join(',');
  return raw.split(',').map((entry) => {
    const [base, version] = entry.split('|').map((x) => x.trim());
    return { base, version };
  }).filter((e) => e.base && e.version);
}

export const ENDPOINT_CANDIDATES = parseEndpoints();

const endpointUrl = ({ base, version }, kind) => `${base}/IchibaItem/${kind}/${version}`;

/** 一度通った組はプロセス内で使い回す（毎回1番目から試さない） */
let resolvedEndpoint = null;

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

/**
 * 新仕様では applicationId に加えて accessKey が必要で、サーバーサイドからの
 * 呼び出しには Referer が要るという報告がある。Referer は楽天側のアプリ登録で
 * 「Allowed websites」に入れたドメインと一致している必要がある。
 */
function requestInit() {
  const referer = process.env.RAKUTEN_REFERER || '';
  return referer ? { headers: { referer } } : {};
}

/**
 * 1バージョンだけ叩く。成功したら Items を、失敗したら例外を投げる。
 */
async function callEndpoint(kind, ep, params, label) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const body = await fetchJson(`${endpointUrl(ep, kind)}?${qs}`, requestInit(), { label, retries: 1 });
  return Array.isArray(body.Items) ? body.Items : [];
}

/**
 * 有効なエンドポイントバージョンを探しながら叩く。
 * 既に判明していればそれだけを使う。全滅したら最後の例外を投げる。
 */
async function call(kind, params, label) {
  if (resolvedEndpoint) return callEndpoint(kind, resolvedEndpoint, params, label);

  let lastErr;
  for (const ep of ENDPOINT_CANDIDATES) {
    const tag = `${new URL(ep.base).host}@${ep.version}`;
    try {
      const items = await callEndpoint(kind, ep, params, `${label}[${tag}]`);
      resolvedEndpoint = ep;
      console.log(`✅ 有効なエンドポイント: ${ep.base}/IchibaItem/<種別>/${ep.version}`);
      console.log('   RAKUTEN_API_ENDPOINTS にこの1組だけ指定すると、以後の試行が省けます:');
      console.log(`   ${ep.base}|${ep.version}`);
      return items;
    } catch (e) {
      lastErr = e;
      console.warn(`  ${tag} は不可: ${String(e.message).slice(0, 200)}`);
    }
    await sleep(RATE_LIMIT_MS);
  }
  throw lastErr;
}

/** ランキング上位を取る。トレンド性が高く「今売れているもの」を拾える */
export async function fetchRanking({ appId, accessKey, affiliateId, genreId = '0', period = 'realtime', age, sex }) {
  const items = await call('Ranking', {
    applicationId: appId, accessKey, affiliateId, genreId, period, age, sex,
  }, `rakuten-ranking(genre=${genreId})`);
  return items.map((i) => normalizeItem(i, `ranking:${genreId}`));
}

/** キーワード検索。ニッチ／自分の発信テーマに寄せた商品を拾える */
export async function searchItems({
  appId, accessKey, affiliateId, keyword, genreId, minPrice, maxPrice, hits = 30, page = 1, sort = '-reviewCount',
}) {
  const items = await call('Search', {
    applicationId: appId,
    accessKey,
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

/**
 * 楽天アフィリエイトIDの形式（英数8文字×4ブロックをドットで繋いだもの）。
 * 例: 5931a2ab.a76cafd1.5931a2ac.a4a7bb78
 */
export const AFFILIATE_ID_PATTERN = /^[0-9a-z]{8}\.[0-9a-z]{8}\.[0-9a-z]{8}\.[0-9a-z]{8}$/i;

export function checkAffiliateId(id) {
  if (!id) return { ok: false, reason: '未設定。報酬の発生しない通常リンクで投稿されます' };
  if (!AFFILIATE_ID_PATTERN.test(id)) {
    return { ok: false, reason: '形式が違います（英数8文字×4ブロックのドット区切り）。アプリケーションID（UUID形式）を入れていませんか？' };
  }
  return { ok: true, reason: '' };
}

export async function collectCandidates(cfg) {
  const { rakutenAppId: appId, rakutenAccessKey: accessKey, rakutenAffiliateId: affiliateId,
          keywords, genreIds, minPrice, maxPrice, poolSize } = cfg;
  const pool = new Map();
  const add = (arr) => arr.forEach((it) => { if (it.id && !pool.has(it.id)) pool.set(it.id, it); });

  // 全滅したのか、一部が落ちただけなのかを区別するために数える。
  // 「候補0件」と「APIに1度も繋がらなかった」は原因も対処も全く違う。
  let attempts = 0;
  let failures = 0;
  let lastError = null;

  for (const genreId of genreIds) {
    if (pool.size >= poolSize) break;
    attempts++;
    try {
      add(await fetchRanking({ appId, accessKey, affiliateId, genreId }));
    } catch (e) {
      failures++; lastError = e;
      console.warn(`ランキング取得に失敗 (genre=${genreId}): ${e.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  for (const keyword of keywords) {
    if (pool.size >= poolSize) break;
    attempts++;
    try {
      add(await searchItems({ appId, accessKey, affiliateId, keyword, minPrice, maxPrice }));
    } catch (e) {
      failures++; lastError = e;
      console.warn(`検索に失敗 (${keyword}): ${e.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // 1件も成功していないなら設定の問題。ここで握り潰すと「条件に合う商品が
  // ありませんでした」という的外れな digest が毎朝届き続けることになる。
  if (attempts > 0 && failures === attempts) {
    const hint = /applicationId/i.test(lastError?.message ?? '')
      ? '\n認証が通っていません。楽天APIは2026年に刷新され、次の3点が必要です:\n'
        + '  1) RAKUTEN_APP_ID      … アプリ情報画面の「アプリケーションID」（UUID形式）\n'
        + '  2) RAKUTEN_ACCESS_KEY  … 同画面の「アクセスキー」（pk_ で始まる）\n'
        + '  3) RAKUTEN_REFERER     … アプリ登録の Allowed websites と一致するURL\n'
        + 'どのエンドポイントも通らない場合は、上のバージョン別ログを確認してください。'
      : '';
    throw new Error(`楽天APIへの${attempts}回の呼び出しがすべて失敗しました: ${lastError?.message}${hint}`);
  }

  const items = [...pool.values()];

  // アフィリエイトIDの取り違えは、エラーにならず「報酬の出ないリンクで投稿され続ける」
  // という静かな失敗になる。実際に affiliateUrl が返ってきたかで最終確認する。
  const check = checkAffiliateId(affiliateId);
  if (!check.ok) {
    console.warn(`⚠️ RAKUTEN_AFFILIATE_ID: ${check.reason}`);
  } else if (items.length && !items.some((i) => i.url?.includes('hb.afl.rakuten.co.jp'))) {
    console.warn(
      '⚠️ アフィリエイトIDを渡したのに、楽天からアフィリエイトリンクが返ってきていません。\n' +
      '   IDが誤っている可能性があります。このまま投稿しても報酬は発生しません。');
  }

  return items;
}
