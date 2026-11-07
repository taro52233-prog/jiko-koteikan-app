import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText } from '../src/image/draw.js';
import { isEligible, selectItems } from '../src/research/score.js';
import { sanitize } from '../src/content/generate.js';
import { cleanCaption } from '../src/content/prompt.js';
import { upscaleImageUrl } from '../src/research/rakuten.js';
import { createCanvas } from '@napi-rs/canvas';
import { registerFonts, font } from '../src/image/fonts.js';

const ctx2d = () => {
  registerFonts({});
  const ctx = createCanvas(100, 100).getContext('2d');
  ctx.font = font(40, 'regular');
  return ctx;
};

test('日本語は空白が無くても折り返される', () => {
  const ctx = ctx2d();
  const lines = wrapText(ctx, 'あいうえおかきくけこさしすせそたちつてとなにぬねの', 400);
  assert.ok(lines.length > 1, '1行に収まりきらないはず');
  assert.equal(lines.join(''), 'あいうえおかきくけこさしすせそたちつてとなにぬねの', '文字の欠落・重複がない');
});

test('行頭禁則文字が行の先頭に来ない', () => {
  const ctx = ctx2d();
  const lines = wrapText(ctx, 'これはテストです、続きの文章がここにあります。', 300);
  for (const line of lines.slice(1)) {
    assert.ok(!'、。'.includes(line[0]), `行頭に句読点が来ている: ${JSON.stringify(line)}`);
  }
});

test('maxLines を超えたら末尾を省略記号にする', () => {
  const ctx = ctx2d();
  const lines = wrapText(ctx, 'あ'.repeat(200), 300, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
});

const baseCfg = { minPrice: 1000, maxPrice: 30000, minReviewCount: 20, minReviewAverage: 4.0, shopCooldownDays: 7 };
const mkItem = (o = {}) => ({
  id: 'shop:1', name: 'テスト商品', price: 5000, reviewCount: 100, reviewAverage: 4.5,
  images: ['https://x/a.jpg'], shopCode: 'shop', genreId: '1', rank: 5, ...o,
});

test('画像なし・レビュー不足・価格外れを除外する', () => {
  assert.equal(isEligible(mkItem(), baseCfg), true);
  assert.equal(isEligible(mkItem({ images: [] }), baseCfg), false, '画像なしは除外');
  assert.equal(isEligible(mkItem({ reviewCount: 3 }), baseCfg), false, 'レビュー不足は除外');
  assert.equal(isEligible(mkItem({ reviewAverage: 3.2 }), baseCfg), false, '低評価は除外');
  assert.equal(isEligible(mkItem({ price: 500 }), baseCfg), false, '安すぎは除外');
  assert.equal(isEligible(mkItem({ price: 99000 }), baseCfg), false, '高すぎは除外');
});

test('薬機法リスクのある商品名を除外する', () => {
  assert.equal(isEligible(mkItem({ name: '飲むだけで痩せるサプリ' }), baseCfg), false);
});

test('投稿済み商品と同一ショップの連投を避ける', () => {
  const history = {
    hasItem: (id) => id === 'shop:used',
    shopUsedWithin: (code) => code === 'cooldown',
  };
  const pool = [
    mkItem({ id: 'shop:used' }),
    mkItem({ id: 'shop:cool', shopCode: 'cooldown' }),
    mkItem({ id: 'shop:ok', shopCode: 'fresh' }),
  ];
  const { picked, rejected } = selectItems(pool, baseCfg, history, 3);
  assert.deepEqual(picked.map((p) => p.id), ['shop:ok']);
  assert.equal(rejected.length, 2);
});

test('レビュー数が多いほど高スコアになる', () => {
  const history = { hasItem: () => false, shopUsedWithin: () => false };
  const pool = [
    mkItem({ id: 'a', reviewCount: 50, genreId: '1' }),
    mkItem({ id: 'b', reviewCount: 5000, genreId: '2' }),
  ];
  const { scored } = selectItems(pool, baseCfg, history, 2);
  assert.equal(scored[0].id, 'b');
});

const sanitizeOpts = {
  item: { price: 2480, name: 'テスト' },
  maxHashtags: 20,
  disclosureRequired: true,
  disclosureText: '【PR】広告を含みます。',
};
const draft = () => ({
  hook: { title: '日本一のタンブラー', sub: 'すごい' },
  slides: [{ title: 'a', body: 'b' }],
  cta: { title: 'c', body: 'd' },
  caption: '2,480円で買えます。',
  hashtags: ['タンブラー', '#タンブラー', '# 保温 ', 'water'],
  altText: 'alt',
});

test('ステマ規制の表示を本文先頭に必ず入れる', () => {
  const out = sanitize(draft(), sanitizeOpts);
  assert.ok(out.caption.startsWith('【PR】広告を含みます。'));
  assert.ok(out.fullCaption.includes('【PR】'));
});

test('景表法・薬機法上まずい表現を機械的に削る', () => {
  const out = sanitize(draft(), sanitizeOpts);
  assert.ok(!out.hook.title.includes('日本一'), `残っている: ${out.hook.title}`);
});

test('ハッシュタグを正規化・重複排除する', () => {
  const out = sanitize(draft(), sanitizeOpts);
  assert.deepEqual(out.hashtags, ['#タンブラー', '#保温', '#water']);
});

test('本文はハッシュタグ込みで2200文字に収まる', () => {
  const d = draft();
  d.caption = 'あ'.repeat(3000);
  const out = sanitize(d, sanitizeOpts);
  assert.ok(out.fullCaption.length <= 2200, `${out.fullCaption.length}文字`);
});

test('楽天のサムネイルURLを高解像度版に差し替える', () => {
  assert.equal(
    upscaleImageUrl('https://thumbnail.image.rakuten.co.jp/@0_mall/a/b.jpg?_ex=128x128'),
    'https://thumbnail.image.rakuten.co.jp/@0_mall/a/b.jpg?_ex=800x800'
  );
});

test('商品説明のHTML・装飾記号を掃除する', () => {
  assert.equal(cleanCaption('<b>■容量</b>470ml&nbsp;★人気'), '容量 470ml 人気');
});

test('アフィリエイトIDの形式を検査する（取り違えは静かな失敗になるため）', async () => {
  const { checkAffiliateId } = await import('../src/research/rakuten.js');

  assert.equal(checkAffiliateId('5931a2ab.a76cafd1.5931a2ac.a4a7bb78').ok, true);

  // アプリケーションID（UUID形式）を誤って入れた場合に気づけること
  const appId = 'd6f87f28-079f-4abc-9def-0123456789ab';
  assert.equal(checkAffiliateId(appId).ok, false);
  assert.match(checkAffiliateId(appId).reason, /アプリ/);

  assert.equal(checkAffiliateId('').ok, false, '未設定は報酬ゼロなので失格扱い');
  assert.equal(checkAffiliateId('5931a2ab.a76cafd1.5931a2ac').ok, false, 'ブロック不足');
  assert.equal(checkAffiliateId('5931a2ab-a76cafd1-5931a2ac-a4a7bb78').ok, false, '区切りがドットでない');
});

test('楽天APIが全滅したら「候補0件」ではなくエラーにする', async (t) => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end('{"error_description":"specify valid applicationId","error":"wrong_parameter"}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  process.env.RAKUTEN_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.RAKUTEN_RATE_LIMIT_MS = '1';
  const { collectCandidates } = await import(`../src/research/rakuten.js?all-fail=${Date.now()}`);

  await assert.rejects(
    () => collectCandidates({
      rakutenAppId: 'bad', rakutenAffiliateId: '', keywords: [], genreIds: ['0'],
      minPrice: 1000, maxPrice: 30000, poolSize: 60,
    }),
    (e) => {
      assert.match(e.message, /すべて失敗/, '全滅したことが分かる');
      assert.match(e.message, /RAKUTEN_APP_ID/, 'applicationIdエラーなら原因を名指しする');
      return true;
    });
  delete process.env.RAKUTEN_API_BASE;
});

test('ワークフローは文字数・タグ数に既定値を埋め込まない（文体プロファイルを上書きしてしまうため）', async () => {
  const fsp = await import('node:fs');
  const yml = fsp.readFileSync(
    new URL('../../.github/workflows/room-digest.yml', import.meta.url), 'utf8');
  for (const name of ['ROOM_MAX_CHARS', 'ROOM_HASHTAGS']) {
    const line = yml.split('\n').find((l) => l.includes(`${name}:`));
    assert.ok(line, `${name} が渡されている`);
    assert.ok(!line.includes('||'),
      `${name} に既定値を埋めると style.js のプロファイル値が効かなくなる: ${line.trim()}`);
  }
});

test('エンドポイントのバージョン候補を順に試し、通ったものを使い回す', async (t) => {
  const http = await import('node:http');
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push({ path: url.pathname, referer: req.headers.referer, accessKey: url.searchParams.get('accessKey') });
    // 新しい2版は存在せず、古い版だけ生きている状況を再現する
    if (!url.pathname.endsWith('/20220601')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not_found","error_description":"API Configuration not found"}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Items: [{ Item: {
      itemCode: 'shop:1', itemName: 'テスト', itemPrice: 2000, itemUrl: 'https://item/1',
      affiliateUrl: 'https://hb.afl.rakuten.co.jp/x', shopName: 'S', shopCode: 'shop',
      reviewCount: 100, reviewAverage: 4.5, mediumImageUrls: [{ imageUrl: 'https://i/a.jpg?_ex=128x128' }],
    } }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  process.env.RAKUTEN_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.RAKUTEN_RATE_LIMIT_MS = '1';
  process.env.RAKUTEN_API_VERSIONS = '20260701,20220601';
  process.env.RAKUTEN_REFERER = 'https://github.com/example/repo';
  const { collectCandidates } = await import(`../src/research/rakuten.js?probe=${Date.now()}`);

  const items = await collectCandidates({
    rakutenAppId: 'uuid-app-id', rakutenAccessKey: 'pk_test', rakutenAffiliateId: 'a.b.c.d',
    keywords: ['タンブラー'], genreIds: ['0'], minPrice: 1000, maxPrice: 30000, poolSize: 60,
  });

  assert.equal(items.length, 1, '生きている版で取得できる');
  const versions = hits.map((h) => h.path.split('/').pop());
  assert.deepEqual(versions.slice(0, 2), ['20260701', '20220601'], '候補を順に試す');
  assert.ok(!versions.slice(2).includes('20260701'),
    '一度判明したら以後は古い候補を試し直さない');
  assert.equal(hits[0].accessKey, 'pk_test', 'accessKey を送っている');
  assert.equal(hits[0].referer, 'https://github.com/example/repo', 'Referer を送っている');

  for (const k of ['RAKUTEN_API_BASE', 'RAKUTEN_API_VERSIONS', 'RAKUTEN_REFERER']) delete process.env[k];
});

test('ランキングが404でも、検索で候補が取れていれば続行する', async (t) => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.includes('/Ranking/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"statusCode":404,"message":"Resource not found"}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Items: [{ Item: {
      itemCode: 'shop:1', itemName: '検索で取れた商品', itemPrice: 2000, itemUrl: 'https://item/1',
      affiliateUrl: 'https://hb.afl.rakuten.co.jp/x', shopName: 'S', shopCode: 'shop',
      reviewCount: 100, reviewAverage: 4.5, mediumImageUrls: [{ imageUrl: 'https://i/a.jpg?_ex=128x128' }],
    } }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  process.env.RAKUTEN_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.RAKUTEN_RATE_LIMIT_MS = '1';
  const { collectCandidates } = await import(`../src/research/rakuten.js?rank404=${Date.now()}`);

  const items = await collectCandidates({
    rakutenAppId: 'uuid', rakutenAccessKey: 'pk_x', rakutenAffiliateId: '5935f3b3.6624f5ad.5935f3b4.fe4ea5e7',
    keywords: ['タンブラー'], genreIds: ['0'], minPrice: 1000, maxPrice: 30000, poolSize: 60,
  });

  assert.equal(items.length, 1, 'ランキングが落ちても検索結果が返る');
  assert.equal(items[0].name, '検索で取れた商品');
  delete process.env.RAKUTEN_API_BASE;
});
