/**
 * Instagram Content Publishing API クライアント。
 *
 * 前提（ここを外すと絶対に動かない）:
 *  - 対象アカウントが「プロアカウント（ビジネス/クリエイター）」であること。個人アカウントは API 非対応。
 *  - 画像は「インターネットから到達できる公開URL」であること。Instagram側がURLを取りに来る仕様で、
 *    バイナリを直接アップロードする口は無い。本パイプラインは GitHub Pages でこれを満たす。
 *  - 公開は 24時間あたり 50 件まで（API 側の制限）。
 */
import { fetchJson, sleep, log, warn } from '../util.js';

export class InstagramClient {
  constructor({ graphHost, graphVersion, userId, accessToken, containerTimeoutSec }) {
    // スキーム付きで渡された場合はそのまま使う（テスト・ゲートウェイ経由用）
    const origin = graphHost.includes('://') ? graphHost.replace(/\/+$/, '') : `https://${graphHost}`;
    this.base = `${origin}/${graphVersion}`;
    this.userId = userId;
    this.token = accessToken;
    this.containerTimeoutSec = containerTimeoutSec;
  }

  #url(pathname, params = {}) {
    const qs = new URLSearchParams({ ...params, access_token: this.token });
    return `${this.base}/${pathname}?${qs}`;
  }

  async #post(pathname, params, label) {
    // 認証情報を含むのでクエリではなく body に載せる
    const body = new URLSearchParams({ ...params, access_token: this.token });
    return fetchJson(`${this.base}/${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }, { label, retries: 2 });
  }

  async #get(pathname, params, label) {
    return fetchJson(this.#url(pathname, params), {}, { label, retries: 2 });
  }

  /** 残り投稿枠。上限に当たると 24時間投稿できなくなるので事前に見る */
  async quota() {
    try {
      const r = await this.#get(`${this.userId}/content_publishing_limit`,
        { fields: 'config,quota_usage' }, 'ig-quota');
      const d = r.data?.[0] ?? {};
      return { used: d.quota_usage ?? 0, total: d.config?.quota_total ?? 50 };
    } catch (e) {
      warn(`投稿枠の取得に失敗（続行します）: ${e.message}`);
      return null;
    }
  }

  /** 画像コンテナを作る。カルーセルの子は caption を持てない */
  async createImageContainer({ imageUrl, caption, isCarouselItem = false, altText }) {
    const params = { image_url: imageUrl };
    if (isCarouselItem) params.is_carousel_item = 'true';
    else if (caption) params.caption = caption;
    if (altText) params.alt_text = altText;
    const r = await this.#post(`${this.userId}/media`, params, 'ig-create-container');
    if (!r.id) throw new Error(`コンテナ作成に失敗: ${JSON.stringify(r)}`);
    return r.id;
  }

  async createCarouselContainer({ childIds, caption }) {
    const r = await this.#post(`${this.userId}/media`, {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption: caption ?? '',
    }, 'ig-create-carousel');
    if (!r.id) throw new Error(`カルーセル作成に失敗: ${JSON.stringify(r)}`);
    return r.id;
  }

  /**
   * Instagram が画像を取得・検証し終わるまで待つ。
   * ここを待たずに publish すると "Media ID is not available" で落ちる。
   */
  async waitForContainer(containerId) {
    const deadline = Date.now() + this.containerTimeoutSec * 1000;
    let delay = 2000;
    while (Date.now() < deadline) {
      const r = await this.#get(containerId, { fields: 'status_code,status' }, 'ig-container-status');
      if (r.status_code === 'FINISHED') return true;
      if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
        throw new Error(`コンテナ ${containerId} が ${r.status_code}: ${r.status ?? ''}`);
      }
      await sleep(delay);
      delay = Math.min(10000, delay * 1.5);
    }
    throw new Error(`コンテナ ${containerId} が ${this.containerTimeoutSec}秒以内に完了しませんでした`);
  }

  async publish(creationId) {
    const r = await this.#post(`${this.userId}/media_publish`,
      { creation_id: creationId }, 'ig-publish');
    if (!r.id) throw new Error(`公開に失敗: ${JSON.stringify(r)}`);
    return r.id;
  }

  /** 公開済みメディアのパーマリンクを取る（ログ・通知用） */
  async permalink(mediaId) {
    try {
      const r = await this.#get(mediaId, { fields: 'permalink' }, 'ig-permalink');
      return r.permalink ?? null;
    } catch { return null; }
  }

  /**
   * カルーセル or 単一画像を投稿する高レベルAPI。
   * @param {{imageUrls:string[], caption:string, altText?:string}} post
   */
  async publishPost({ imageUrls, caption, altText }) {
    if (!imageUrls.length) throw new Error('画像URLがありません');

    let creationId;
    if (imageUrls.length === 1) {
      creationId = await this.createImageContainer({ imageUrl: imageUrls[0], caption, altText });
      await this.waitForContainer(creationId);
    } else {
      const childIds = [];
      for (const [i, url] of imageUrls.entries()) {
        const id = await this.createImageContainer({ imageUrl: url, isCarouselItem: true, altText });
        log(`  子コンテナ ${i + 1}/${imageUrls.length}: ${id}`);
        childIds.push(id);
      }
      // 子は個別に FINISHED を待つ必要がある
      for (const id of childIds) await this.waitForContainer(id);
      creationId = await this.createCarouselContainer({ childIds, caption });
      await this.waitForContainer(creationId);
    }

    const mediaId = await this.publish(creationId);
    const permalink = await this.permalink(mediaId);
    return { mediaId, permalink };
  }
}

/** アクセストークンの残り寿命を調べる（期限切れは自動投稿が黙って止まる最大の原因） */
export async function inspectToken({ graphHost, graphVersion, accessToken, appId, appSecret }) {
  if (!appId || !appSecret) return null;
  const origin = graphHost.includes('://') ? graphHost.replace(/\/+$/, '') : `https://${graphHost}`;
  const url = `${origin}/${graphVersion}/debug_token?` +
    new URLSearchParams({ input_token: accessToken, access_token: `${appId}|${appSecret}` });
  const r = await fetchJson(url, {}, { label: 'ig-debug-token', retries: 1 });
  const d = r.data ?? {};
  return {
    valid: !!d.is_valid,
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
    daysLeft: d.expires_at ? Math.floor((d.expires_at * 1000 - Date.now()) / 86400000) : Infinity,
    scopes: d.scopes ?? [],
  };
}
