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
