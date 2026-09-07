/**
 * パイプライン全体の結線を、外部APIをモックして通しで検証する。
 * 楽天 / Claude / Instagram Graph / GitHub API をすべて1つのローカルサーバで受ける。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCanvas } from '@napi-rs/canvas';

const productJpeg = (() => {
  const c = createCanvas(800, 800);
  const g = c.getContext('2d');
  g.fillStyle = '#CBD5E1'; g.fillRect(0, 0, 800, 800);
  g.fillStyle = '#64748B'; g.fillRect(150, 200, 500, 400);
  return c.encodeSync('jpeg', 88);
})();

const rakutenItem = (i) => ({
  Item: {
    itemCode: `testshop:item${i}`,
    itemName: `テスト商品${i} ステンレスタンブラー 470ml 保温保冷`,
    itemCaption: '<b>■容量</b> 470ml / ステンレス製 / 蓋付き',
    itemPrice: 2000 + i * 100,
    itemUrl: `https://item.rakuten.co.jp/testshop/item${i}/`,
    affiliateUrl: `https://hb.afl.rakuten.co.jp/item${i}`,
    shopName: `テストショップ${i}`,
    shopCode: `testshop${i}`,
    genreId: String(100 + i),
    reviewCount: 100 + i * 37,
    reviewAverage: 4.2 + (i % 5) * 0.15,
    pointRate: 1,
    rank: i + 1,
    mediumImageUrls: [{ imageUrl: 'IMAGE_BASE/p.jpg?_ex=128x128' }],
  },
});

/** モックサーバ: 呼ばれたパスを記録して検証に使う */
function startMock() {
  const calls = [];
  let base = '';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    calls.push(`${req.method} ${url.pathname}`);
    const json = (o, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };

    // --- 商品画像 ---
    if (url.pathname.endsWith('.jpg')) {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': productJpeg.length });
      return req.method === 'HEAD' ? res.end() : res.end(productJpeg);
    }
    // --- 楽天 ---
    if (url.pathname.includes('/IchibaItem/')) {
      const items = Array.from({ length: 8 }, (_, i) => rakutenItem(i));
      const body = JSON.parse(JSON.stringify(items).replaceAll('IMAGE_BASE', base));
      return json({ Items: body });
    }
    // --- Claude ---
    if (url.pathname === '/v1/messages') {
      return json({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'mock',
        usage: { input_tokens: 100, output_tokens: 200 },
        content: [{
          type: 'tool_use', id: 'tu_1', name: 'submit_post',
          input: {
            hook: { title: '氷が溶けにくいタンブラー', sub: 'レビュー多数の定番' },
            slides: [
              { title: '真空断熱で温度をキープ', body: '外気の影響を受けにくい二重構造です。' },
              { title: '蓋つきでこぼれにくい', body: 'デスクでも持ち運びでも扱いやすい形状。' },
              { title: '470mlの容量', body: '1回の給水で足りるちょうどいいサイズ感。' },
            ],
            cta: { title: '詳細はプロフィールから', body: '保存しておくと後から見返せます。' },
            caption: '日本一の保温力です。2,100円で購入できます。',
            hashtags: ['タンブラー', '#タンブラー', 'キッチン雑貨'],
            altText: 'ステンレスタンブラーの紹介画像',
          },
        }],
      });
    }
    // --- Instagram Graph ---
    if (url.pathname.endsWith('/content_publishing_limit')) {
      return json({ data: [{ quota_usage: 0, config: { quota_total: 50 } }] });
    }
    if (url.pathname.endsWith('/media_publish')) return json({ id: 'media_999' });
    if (url.pathname.endsWith('/media')) return json({ id: `container_${calls.length}` });
    if (/\/(container_\d+)$/.test(url.pathname)) return json({ status_code: 'FINISHED' });
    if (url.pathname === '/v23.0/media_999') return json({ permalink: 'https://instagram.com/p/XYZ' });

    return json({ error: `unhandled ${url.pathname}` }, 404);
  });
  return { server, calls, setBase: (b) => { base = b; } };
}

test('build → publish が通しで動く（外部APIはモック）', async (t) => {
  const mock = startMock();
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.server.address().port}`;
  mock.setBase(base);
  t.after(() => mock.server.close());

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-e2e-'));

  Object.assign(process.env, {
    RAKUTEN_API_BASE: base,
    RAKUTEN_RATE_LIMIT_MS: '1',
    ANTHROPIC_BASE_URL: base,
    RAKUTEN_APP_ID: 'test-app',
    ANTHROPIC_API_KEY: 'sk-test',
    PUBLIC_BASE_URL: base,
    IG_USER_ID: '17841400000000000',
    IG_ACCESS_TOKEN: 'test-token',
    IG_GRAPH_HOST: base,
    POST_MODE: 'auto',
    MAX_POSTS_PER_DAY: '2',
    RESEARCH_KEYWORDS: 'タンブラー',
    CONTENT_SLIDES: '5',
  });

  // config はモジュール読み込み時に env を固めるので、env を整えてから import する
  const { config } = await import('../src/config.js');
  config.paths.publicDir = path.join(tmp, 'public');
  config.paths.history = path.join(tmp, 'history.json');
  config.paths.queue = path.join(tmp, 'queue.json');
  // graph.facebook.com ではなくモックを向くようにする
  config.instagram.graphHost = base;
  config.instagram.graphVersion = 'v23.0';

  // http:// のモックに対して https:// を組み立てないよう、クライアント側のURLを差し替える
  const { InstagramClient } = await import('../src/publish/instagram.js');
  const origUrl = Object.getOwnPropertyDescriptor(InstagramClient.prototype, 'constructor');
  assert.ok(origUrl);

  const { build, publish } = await import('../src/pipeline.js');

  // --- build ---
  const built = await build({ count: 1 });
  assert.equal(built.created.length, 1, '1件生成される');
  const entry = built.created[0];

  assert.equal(entry.status, 'approved', 'auto モードでは承認済みで積まれる');
  assert.equal(entry.images.length, 5, 'カルーセル5枚');
  for (const rel of entry.images) {
    assert.ok(fs.existsSync(path.join(config.paths.publicDir, rel)), `${rel} が書き出されている`);
  }

  // 生成コンテンツのコンプライアンス処理が効いていること
  assert.ok(entry.content.fullCaption.startsWith('【PR】'), 'ステマ表示が先頭に入る');
  assert.ok(!entry.content.fullCaption.includes('日本一'), '最上級表現が除去される');
  assert.ok(entry.content.fullCaption.includes('#タンブラー'), 'ハッシュタグが付く');

  // 重複投稿の防止が効いていること
  const queueFile = JSON.parse(fs.readFileSync(config.paths.queue, 'utf8'));
  assert.equal(queueFile.items.length, 1);
  const again = await build({ count: 1 });
  assert.ok(
    again.created?.[0]?.itemId !== entry.itemId || again.skipped,
    '同じ商品は二度選ばれない'
  );

  // --- publish ---
  const result = await publish({});
  assert.equal(result.published.length >= 1, true, '公開される');
  const published = result.published.find((p) => p.slug === entry.slug);
  assert.ok(published, '対象がpublishされる');
  assert.equal(published.mediaId, 'media_999');

  // カルーセルの正しい手順を踏んでいること
  const mediaCalls = mock.calls.filter((c) => c.endsWith('/media')).length;
  assert.equal(mediaCalls >= 6, true, `子5件+親1件のコンテナ作成 (実際: ${mediaCalls})`);
  assert.ok(mock.calls.some((c) => c.endsWith('/media_publish')), 'media_publish が呼ばれる');
  assert.ok(mock.calls.some((c) => c.includes('content_publishing_limit')), '投稿枠を事前確認する');

  const finalQueue = JSON.parse(fs.readFileSync(config.paths.queue, 'utf8'));
  assert.equal(finalQueue.items.find((i) => i.slug === entry.slug).status, 'published');
});
