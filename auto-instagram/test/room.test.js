import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingEvents, todaysPlan, LEAD_DAYS, ymd } from '../src/room/calendar.js';
import { RoomLog, rankProgress, postingStreak, nextAction, ORIGINAL_PHOTO_TARGET } from '../src/room/rank.js';
import { sanitizeRoom } from '../src/content/room.js';
import { selectKaimawari, scoreItem, PROFILES } from '../src/research/score.js';
import { buildDigest, LOG_MARKERS } from '../src/room/digest.js';

const jst = (s) => new Date(`${s}T00:00:00Z`);

/* ---------------- カレンダー ---------------- */

test('0と5のつく日を正しく列挙する', () => {
  const events = upcomingEvents({ from: jst('2026-09-01'), days: 30 });
  const zeroGo = events.filter((e) => e.kind === 'zeroGo').map((e) => e.date.slice(-2));
  assert.deepEqual(zeroGo, ['05', '10', '15', '20', '25', '30']);
});

test('ワンダフルデーは毎月1日', () => {
  const events = upcomingEvents({ from: jst('2026-09-01'), days: 40 });
  const w = events.filter((e) => e.kind === 'wonderful').map((e) => e.date);
  assert.ok(w.includes('2026-09-01') && w.includes('2026-10-01'));
});

test('イベント3日前は「仕込み期間」と判定される', () => {
  // 9/7 の3日後が 9/10（0と5のつく日）
  const plan = todaysPlan({ from: jst('2026-09-07') });
  assert.equal(plan.phase, 'prep');
  assert.equal(plan.target.daysUntil, 3);
  assert.ok(plan.target.daysUntil <= LEAD_DAYS.start && plan.target.daysUntil >= LEAD_DAYS.end);
});

test('当日イベントより「仕込み」を優先する（当日投稿では下見に間に合わないため）', () => {
  // 9/10 は 0と5のつく日 当日。9/15 が5日後で仕込み対象になる
  const plan = todaysPlan({ from: jst('2026-09-10') });
  assert.equal(plan.phase, 'prep');
  assert.equal(plan.target.daysUntil, 5);
  assert.equal(plan.todayEvents.length >= 1, true, '当日イベントも別途保持している');
});

test('推定日程には estimated フラグが立つ', () => {
  const events = upcomingEvents({ from: jst('2026-09-01'), days: 30 });
  const marathon = events.find((e) => e.kind === 'marathon');
  assert.equal(marathon.estimated, true, '確定日程が未登録なら推定として扱う');
});

test('お買い物マラソン期は買い回りモードと低単価の価格帯になる', () => {
  const plan = todaysPlan({ from: jst('2026-09-16') }); // 9/19のマラソン(推定)の3日前
  assert.equal(plan.target.kind, 'marathon');
  assert.equal(plan.kaimawari, true);
  assert.ok(plan.priceHint.max <= 2000, '買い回りは1,000円前後が主役');
});

/* ---------------- スコアリング ---------------- */

const mk = (o = {}) => ({
  id: 'a:1', name: '商品', price: 3000, reviewCount: 100, reviewAverage: 4.5,
  images: ['https://x/a.jpg'], shopCode: 'a', genreId: '1', rank: 10, ...o,
});
const cfg = { minPrice: 500, maxPrice: 30000, minReviewCount: 10, minReviewAverage: 4.0, shopCooldownDays: 7 };
const stats = { maxReviewCount: 5000 };

test('clickプロファイルは conversion よりトレンドを重く見る', () => {
  assert.ok(PROFILES.click.trend > PROFILES.conversion.trend);
  assert.ok(PROFILES.click.reviewQuality < PROFILES.conversion.reviewQuality);
});

test('狙い目価格帯の中心に近い商品ほど clickEase が高い', () => {
  const band = { min: 800, max: 1800 };  // 買い回り想定
  const near = scoreItem(mk({ price: 1300 }), { ...cfg, priceHint: band }, stats, 'click');
  const far = scoreItem(mk({ price: 12000 }), { ...cfg, priceHint: band }, stats, 'click');
  assert.ok(near.parts.clickEase > far.parts.clickEase);
  assert.ok(near.score > far.score, '価格帯から外れた高額品は不利になる');
});

test('買い回りリストはショップが重複しない', () => {
  const history = { hasItem: () => false, shopUsedWithin: () => false };
  const pool = [
    mk({ id: 'a:1', shopCode: 'shopA', price: 1000, reviewCount: 900 }),
    mk({ id: 'a:2', shopCode: 'shopA', price: 1100, reviewCount: 800 }), // 同ショップ → 除外
    mk({ id: 'b:1', shopCode: 'shopB', price: 1200, reviewCount: 700 }),
    mk({ id: 'c:1', shopCode: 'shopC', price: 1300, reviewCount: 600 }),
  ];
  const { picked, shopCount } = selectKaimawari(pool, { ...cfg, priceHint: { min: 800, max: 1800 } }, history, 10);
  assert.equal(shopCount, 3);
  assert.equal(new Set(picked.map((p) => p.shopCode)).size, picked.length);
});

test('買い回りリストは価格帯外の商品を含めない', () => {
  const history = { hasItem: () => false, shopUsedWithin: () => false };
  const pool = [mk({ id: 'a:1', shopCode: 'a', price: 1000 }), mk({ id: 'b:1', shopCode: 'b', price: 25000 })];
  const { picked } = selectKaimawari(pool, { ...cfg, priceHint: { min: 800, max: 1800 } }, history, 10);
  assert.deepEqual(picked.map((p) => p.id), ['a:1']);
});

/* ---------------- 紹介文の検品 ---------------- */

const roomOpts = { maxChars: 80, hashtagCount: 5, disclosureRequired: true, disclosureText: '#PR #広告' };

test('使ったことがある体の表現を書き換える', () => {
  const out = sanitizeRoom({
    variants: [{ angle: '体験', text: '毎日愛用しています。とても良いです。' }], hashtags: [],
  }, roomOpts);
  assert.ok(!out.variants[0].text.includes('愛用して'), out.variants[0].text);
  assert.ok(out.variants[0].text.includes('気になっています'));
});

test('レビュー本文を引用したかのような表現を書き換える', () => {
  const out = sanitizeRoom({
    variants: [{ angle: '口コミ', text: '口コミによると洗い上がりが良いそうです。' }], hashtags: [],
  }, roomOpts);
  assert.ok(!out.variants[0].text.includes('口コミによると'), out.variants[0].text);
});

test('80文字を超える紹介文は必ず丸められる', () => {
  const out = sanitizeRoom({ variants: [{ angle: 'a', text: 'あ'.repeat(200) }], hashtags: [] }, roomOpts);
  assert.equal(out.variants[0].text.length, 80);
  assert.ok(out.variants[0].text.endsWith('…'));
});

test('ステマ規制の表示を投稿用テキストに必ず付ける', () => {
  const out = sanitizeRoom({ variants: [{ angle: 'a', text: 'いい感じです' }], hashtags: [] }, roomOpts);
  assert.ok(out.variants[0].posting.includes('#PR'));
  assert.ok(!out.variants[0].text.includes('#PR'), '本文自体は汚さない');
});

/* ---------------- ランク進捗 ---------------- */

test('連続投稿日数を数える（今日未投稿でも昨日までの連続は生きる）', () => {
  const days = [
    { date: '2026-09-04', posted: true }, { date: '2026-09-05', posted: true },
    { date: '2026-09-06', posted: true },
  ];
  assert.equal(postingStreak(days, '2026-09-07'), 3);
  assert.equal(postingStreak([...days, { date: '2026-09-07', posted: true }], '2026-09-07'), 4);
});

test('投稿が途切れたら連続日数はリセットされる', () => {
  const days = [
    { date: '2026-09-03', posted: true }, { date: '2026-09-04', posted: false },
    { date: '2026-09-05', posted: true }, { date: '2026-09-06', posted: true },
  ];
  assert.equal(postingStreak(days, '2026-09-07'), 2);
});

test('今日の一手はプロフィール → オリジナル写真 → 投稿 の順で決まる', () => {
  const base = { profile: { photo: true, bio: true, genres: true }, originalPhotosThisWeek: 3, postedToday: true, likesToday: 25, streak: 5 };
  assert.equal(nextAction({ ...base, profile: { photo: false, bio: true, genres: true } }).key, 'profile');
  assert.equal(nextAction({ ...base, originalPhotosThisWeek: 0 }).key, 'originalPhoto');
  assert.equal(nextAction({ ...base, postedToday: false }).key, 'post');
  assert.equal(nextAction({ ...base, likesToday: 3 }).key, 'likes');
  assert.equal(nextAction(base).key, 'done');
});

test('オリジナル写真は週2回で目標達成扱いになる', () => {
  const log = new RoomLog('/dev/null');
  log.data.profile = { photo: true, bio: true, genres: true };
  log.record('2026-09-05', { posted: true, originalPhoto: true });
  log.record('2026-09-06', { posted: true, originalPhoto: true });
  const p = rankProgress(log, { today: '2026-09-07' });
  assert.equal(p.originalPhotosThisWeek, ORIGINAL_PHOTO_TARGET);
  assert.equal(p.action.key, 'post', '写真が足りていれば次は投稿');
});

/* ---------------- digest ---------------- */

test('digest に必要な要素が揃っている', () => {
  const plan = todaysPlan({ from: jst('2026-09-16') });   // マラソン仕込み期
  const candidate = {
    item: { name: 'テスト商品', price: 1200, url: 'https://r/1', shopName: 'ショップ',
            reviewCount: 300, reviewAverage: 4.6, images: ['https://x/a.jpg'] },
    content: {
      benefit: '朝の支度が短くなる', targetPersona: '忙しい共働き世帯',
      hashtags: ['#時短'],
      variants: [{ angle: '時短', text: '朝が楽になりそう', chars: 8, posting: '朝が楽になりそう\n#PR #広告' }],
    },
  };
  const log = new RoomLog('/dev/null');
  const { title, body } = buildDigest({
    plan,
    candidates: [candidate],
    tomorrow: [candidate],
    kaimawari: { picked: [{ name: 'A', price: 1000, shopName: 'S', url: 'https://r/2' }], shopCount: 1 },
    progress: rankProgress(log, { today: '2026-09-16' }),
  });

  assert.ok(title.includes('仕込み'), title);
  assert.ok(body.includes('<!-- room-digest:2026-09-16 -->'), '読み戻し用の日付マーカー');
  assert.ok(body.includes('☀️ 朝'), '朝のセクション');
  assert.ok(body.includes('🌤 昼'), '昼のセクション');
  assert.ok(body.includes('🌙 夜'), '夜のセクション');
  assert.ok(body.includes('買い回りリスト'), 'マラソン期は買い回りが出る');
  assert.ok(body.includes('#PR'), '投稿用テキストにPR表記');
  for (const marker of Object.values(LOG_MARKERS)) {
    assert.ok(body.includes(marker), `チェックボックスの目印 ${marker} がある`);
  }
});

test('イベントが無い日の digest は買い回りを出さない', () => {
  const plan = { date: '2026-09-08', target: null, phase: 'normal', todayEvents: [], upcoming: [], kaimawari: false };
  const log = new RoomLog('/dev/null');
  const { body } = buildDigest({ plan, candidates: [], tomorrow: [], kaimawari: null, progress: rankProgress(log, { today: '2026-09-08' }) });
  assert.ok(!body.includes('買い回りリスト'));
  assert.ok(body.includes('通常運転'));
});
