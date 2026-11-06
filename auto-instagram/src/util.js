/** 小さな共通ユーティリティ。外部依存を増やさないため自前で持つ。 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** JST の「今」を返す（GitHub Actions は UTC なので日付判定を誤らないように） */
export function nowJst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

/** JST基準の YYYY-MM-DD */
export function jstDateKey(d = nowJst()) {
  return d.toISOString().slice(0, 10);
}

/** JST基準の YYYYMMDD-HHmm */
export function jstStamp(d = nowJst()) {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 13).replace(/(\d{8})(\d{4})/, '$1-$2');
}

/**
 * 指数バックオフ付き fetch。
 * 4xx（429 を除く）は再試行しても無駄なので即座に投げる。
 */
export async function fetchJson(url, options = {}, { retries = 3, baseDelay = 800, label = 'request' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs ?? 30000) });
      const text = await res.text();
      let body;
      try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

      if (res.ok) return body;

      const retriable = res.status === 429 || res.status >= 500;
      const err = new Error(`${label} failed ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      err.body = body;
      if (!retriable || attempt === retries) throw err;
      lastErr = err;
    } catch (e) {
      // ネットワーク/タイムアウト系は再試行する
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      if (attempt === retries) throw e;
      lastErr = e;
    }
    await sleep(baseDelay * 2 ** attempt);
  }
  throw lastErr;
}

export async function fetchBuffer(url, { retries = 3, label = 'download' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${label} failed ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (attempt === retries) break;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** 0..1 に正規化（max===min のときは 0.5 を返して順位付けを壊さない） */
export function normalize(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

export function warn(...args) {
  console.warn(`[${new Date().toISOString()}] WARN`, ...args);
}
