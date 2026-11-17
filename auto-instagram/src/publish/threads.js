/**
 * Threads Graph API の薄いラッパー（公式APIのみ。スクレイピングしない）。
 *
 * ■ ここで読むのは「自分の投稿」だけ
 * 他人の投稿のいいね数・閲覧数は公式APIで取得できない。
 * insights は threads_manage_insights ＝ 自分のプロフィール専用で、
 * keyword_search が返せるのは Media のフィールド（本文・時刻・permalink 等）だけ。
 * つまり「他人のバズを数値で測る」は公式APIでは成立しない。
 * 自分の投稿なら views / likes / replies / reposts / quotes が全部取れる。
 *
 * ■ 審査について
 * 自分のアカウントだけを読む用途なら App Review は要らない。
 * アプリを開発モードのまま置き、自分の Threads アカウントをテスターとして
 * 招待・承認すれば、テスターのアカウントに対しては全エンドポイントが動く。
 * 審査が必要になるのは「他人に許可を求める」段階から。
 */
import { log, warn } from '../util.js';

export const DEFAULT_BASE_URL = 'https://graph.threads.net/v1.0';

/** insights で取りにいく指標。views と shares は Meta 側で開発中の時期があった */
export const INSIGHT_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes'];

class ThreadsError extends Error {}

async function call(baseUrl, token, path, params = {}) {
  if (!token) throw new ThreadsError('THREADS_ACCESS_TOKEN が未設定です');
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  // トークンはクエリに付ける（Threads API の標準的な渡し方）。ログには出さない
  url.searchParams.set('access_token', token);

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  let body = {};
  try { body = await res.json(); } catch { /* 空レスポンスは {} のまま扱う */ }
  if (!res.ok || body.error) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw new ThreadsError(`Threads API ${res.status}: ${msg}`);
  }
  return body;
}

/**
 * 自分の投稿一覧。
 * 返り値には本文が入るので、ここから書き出しの型を判定できる。
 */
export async function fetchOwnPosts({
  token, userId = 'me', baseUrl = DEFAULT_BASE_URL, limit = 50, sinceDays = null,
} = {}) {
  const params = {
    fields: 'id,text,permalink,timestamp,media_type,is_quote_post,is_reply',
    limit: Math.min(100, Math.max(1, limit)),
  };
  if (sinceDays) {
    // since は UNIX 秒。ここを付けないと過去の投稿まで延々と取りにいく
    params.since = Math.floor((Date.now() - sinceDays * 86400000) / 1000);
  }
  const body = await call(baseUrl, token, `${userId || 'me'}/threads`, params);
  return (body.data ?? []).filter((p) => !p.is_reply);   // 自分へのリンク用リプライは対象外
}

/**
 * 1投稿の指標。
 *
 * 指標ごとに権限や提供状況が違い、1つ落ちると全体が 400 になることがある。
 * まとめて取れなかったときは1つずつ取り直して、取れたものだけ返す。
 */
export async function fetchInsights({ token, mediaId, baseUrl = DEFAULT_BASE_URL } = {}) {
  const read = (body) => {
    const out = {};
    for (const item of body.data ?? []) {
      const value = item.total_value?.value ?? item.values?.[0]?.value;
      if (typeof value === 'number') out[item.name] = value;
    }
    return out;
  };

  try {
    return read(await call(baseUrl, token, `${mediaId}/insights`, { metric: INSIGHT_METRICS.join(',') }));
  } catch (e) {
    warn(`insights をまとめて取得できなかったため1件ずつ試します (${mediaId}): ${e.message}`);
  }

  const out = {};
  for (const metric of INSIGHT_METRICS) {
    try {
      Object.assign(out, read(await call(baseUrl, token, `${mediaId}/insights`, { metric })));
    } catch { /* その指標は使えない。残りを続ける */ }
  }
  return out;
}

/**
 * 自分の投稿 ＋ 指標をまとめて集める。
 * 指標が1つも取れなかった投稿は、集計に入れても意味がないので落とす。
 */
export async function collectOwnPostMetrics({
  token, userId = 'me', baseUrl = DEFAULT_BASE_URL, limit = 50, sinceDays = 60,
} = {}) {
  const posts = await fetchOwnPosts({ token, userId, baseUrl, limit, sinceDays });
  log(`Threads の自分の投稿を ${posts.length} 件取得しました`);

  const out = [];
  for (const post of posts) {
    const metrics = await fetchInsights({ token, mediaId: post.id, baseUrl });
    if (!Object.keys(metrics).length) {
      warn(`指標が取れなかったため集計から除外します: ${String(post.text ?? '').slice(0, 30)}`);
      continue;
    }
    out.push({
      id: post.id,
      text: String(post.text ?? ''),
      permalink: post.permalink ?? '',
      timestamp: post.timestamp ?? '',
      views: metrics.views ?? null,
      likes: metrics.likes ?? null,
      replies: metrics.replies ?? null,
      reposts: metrics.reposts ?? null,
      quotes: metrics.quotes ?? null,
    });
  }
  return out;
}
