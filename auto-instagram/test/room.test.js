import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingEvents, todaysPlan, LEAD_DAYS, ymd } from '../src/room/calendar.js';
import { RoomLog, rankProgress, postingStreak, nextAction, ORIGINAL_PHOTO_TARGET } from '../src/room/rank.js';
import { sanitizeRoom } from '../src/content/room.js';
import { selectKaimawari, scoreItem, PROFILES } from '../src/research/score.js';
import { buildDigest, LOG_MARKERS } from '../src/room/digest.js';
import { OwnedItems } from '../src/store/owned.js';
import { buildScenePrompt } from '../src/image/scene.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const ownedOpts = { ...roomOpts, owned: true };

test('未所有の商品では、使ったことがある体の表現を落とす', () => {
  const out = sanitizeRoom({
    variants: [{ angle: '体験', text: '毎日愛用しています。とても良いです。' }], hashtags: [],
  }, roomOpts);
  assert.ok(!out.variants[0].text.includes('愛用して'), out.variants[0].text);
  assert.equal(out.writingMode, 'pain-first');
});

test('未所有の商品では、断定の完了形を推量に落とす', () => {
  const out = sanitizeRoom({
    variants: [{ angle: '結果', text: '朝の支度が楽になりました。' }], hashtags: [],
  }, roomOpts);
  assert.ok(!out.variants[0].text.includes('楽になりました'), out.variants[0].text);
  assert.ok(out.variants[0].text.includes('変わりそう'));
});

test('所有登録済みの商品では、使用体験の表現をそのまま通す', () => {
  const text = '半年愛用しています。朝の支度が楽になりました。';
  const out = sanitizeRoom({ variants: [{ angle: '体験', text }], hashtags: [] }, ownedOpts);
  assert.equal(out.variants[0].text, text, '本人の実体験なので書き換えない');
  assert.equal(out.writingMode, 'owned');
  assert.equal(out.variants[0].owned, true);
});

test('所有登録済みでも、根拠のない最上級表現は落とす', () => {
  const out = sanitizeRoom({
    variants: [{ angle: '体験', text: '日本一の使い心地でした。' }], hashtags: [],
  }, ownedOpts);
  assert.ok(!out.variants[0].text.includes('日本一'));
});

test('レビュー本文を引用したかのような表現は、どちらのモードでも書き換える', () => {
  for (const opts of [roomOpts, ownedOpts]) {
    const out = sanitizeRoom({
      variants: [{ angle: '口コミ', text: '口コミによると洗い上がりが良いそうです。' }], hashtags: [],
    }, opts);
    assert.ok(!out.variants[0].text.includes('口コミによると'), out.variants[0].text);
  }
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

/* ---------------- 所有商品の登録 ---------------- */

test('メモが空の登録は無効にする（体験の中身が無いため）', () => {
  const file = path.join(os.tmpdir(), `owned-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ items: [
    { match: '珪藻土バスマット', note: '3ヶ月使用。乾きは早いが端が欠けやすい' },
    { match: 'タンブラー', note: '' },        // メモ無し → 無効
    { match: '', note: 'メモだけ' },           // 対象不明 → 無効
  ] }));
  const owned = OwnedItems.load(file);
  fs.unlinkSync(file);
  assert.equal(owned.items.length, 1);
  assert.equal(owned.items[0].match, '珪藻土バスマット');
});

test('商品名・itemCode の部分一致で所有登録を見つける', () => {
  const owned = new OwnedItems([{ match: '珪藻土バスマット', note: 'メモ' }]);
  assert.ok(owned.find({ id: 'shop:1', name: '珪藻土バスマット 速乾 Lサイズ' }));
  assert.equal(owned.find({ id: 'shop:2', name: 'ステンレスタンブラー' }), null);
});

/* ---------------- シーン画像 ---------------- */

test('シーンプロンプトに商品を描かせない制約を必ず足す', () => {
  const p = buildScenePrompt('A quiet bathroom in morning light.');
  assert.ok(p.includes('brand logo'), '制約が付いている');
  assert.ok(p.includes('readable text'));
  assert.ok(p.startsWith('A quiet bathroom'));
});

test('シーンプロンプトから商品名を取り除く（ブランド性が出るため）', () => {
  const p = buildScenePrompt('A bathroom with 珪藻土バスマット on the floor.', { itemName: '珪藻土バスマット 速乾' });
  assert.ok(!p.includes('珪藻土バスマット'), p);
});

test('空のシーンプロンプトは null を返す', () => {
  assert.equal(buildScenePrompt(''), null);
  assert.equal(buildScenePrompt('   '), null);
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

/* ---------------- シーン画像の生成（OpenAI APIはモック） ---------------- */

test('OpenAI画像APIを正しい形で呼び、画像を目的の比率に整える', async (t) => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const http = await import('node:http');
  const { generateSceneImage } = await import('../src/image/scene.js');

  const generated = createCanvas(1024, 1536);
  const g = generated.getContext('2d');
  g.fillStyle = '#C8D3DE'; g.fillRect(0, 0, 1024, 1536);
  const b64 = generated.encodeSync('jpeg', 85).toString('base64');

  let received = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received = { path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: b64 }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  const cfg = {
    enabled: true, apiKey: 'sk-test', baseUrl: `http://127.0.0.1:${server.address().port}`,
    model: 'gpt-image-1', size: '1024x1536', quality: 'medium',
    label: true, labelText: 'AI生成イメージ',
  };

  const buf = await generateSceneImage(
    'A quiet bathroom in soft morning light, bare feet on a dry mat.',
    cfg, { width: 1080, height: 1350, itemName: '珪藻土バスマット' });

  assert.ok(buf, '画像バッファが返る');
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8);   // JPEG
  assert.equal(received.path, '/v1/images/generations');
  assert.equal(received.auth, 'Bearer sk-test');
  assert.equal(received.body.model, 'gpt-image-1');
  assert.equal(received.body.size, '1024x1536');
  assert.equal(received.body.n, 1);
  assert.ok(received.body.prompt.includes('brand logo'), '商品を描かせない制約が送られている');

  // 出力が指定サイズに整っていること
  const { loadImage } = await import('@napi-rs/canvas');
  const out = await loadImage(buf);
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1350);
});

test('SCENE_IMAGE_ENABLED が false なら API を呼ばない', async () => {
  const { generateSceneImage } = await import('../src/image/scene.js');
  const r = await generateSceneImage('anything', { enabled: false }, { width: 100, height: 100 });
  assert.equal(r, null);
});

test('APIキーが無ければ null を返す（投稿全体は止めない）', async () => {
  const { generateSceneImage } = await import('../src/image/scene.js');
  const r = await generateSceneImage('anything', { enabled: true, apiKey: '' }, { width: 100, height: 100 });
  assert.equal(r, null);
});

test('API が失敗しても null を返して投稿を止めない', async (t) => {
  const http = await import('node:http');
  const { generateSceneImage } = await import('../src/image/scene.js');
  const server = http.createServer((req, res) => { res.writeHead(400); res.end('{"error":"bad"}'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());

  const r = await generateSceneImage('x', {
    enabled: true, apiKey: 'k', baseUrl: `http://127.0.0.1:${server.address().port}`,
    model: 'gpt-image-1', size: '1024x1536', quality: 'medium', label: false,
  }, { width: 200, height: 250 });
  assert.equal(r, null);
});

/* ---------------- 文体プロファイル ---------------- */

test('文体プリセットごとに文字数とハッシュタグ数の既定が違う', async () => {
  const { STYLE_PRESETS, resolveStyle } = await import('../src/content/style.js');
  assert.equal(STYLE_PRESETS['casual-diary'].hashtagCount, 0, '独り言型はハッシュタグを使わない');
  assert.ok(STYLE_PRESETS['casual-diary'].maxChars > STYLE_PRESETS.polished.maxChars,
    '独り言型のほうが長い文を許す');
  assert.equal(resolveStyle('casual-diary').register, 'casual');
  assert.equal(resolveStyle('存在しない名前').label, STYLE_PRESETS['casual-diary'].label, '不明な名前は既定に落ちる');
});

test('サンプルからURL・ハッシュタグ・メンションを除去する', async () => {
  const { stripNoise } = await import('../src/content/style.js');
  assert.equal(
    stripNoise('これ良かった #買ってよかった @someone https://t.co/abc'),
    'これ良かった');
});

test('短すぎるサンプルは文体の材料にしない', async () => {
  const { loadStyleSamples } = await import('../src/content/style.js');
  const file = path.join(os.tmpdir(), `style-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    profile: 'casual-diary',
    samples: ['ここ4-7日で発送らしいので今買えばGWに使えるかなと思ってぽちった', 'いい', ''],
  }));
  const { profile, samples } = loadStyleSamples(file);
  fs.unlinkSync(file);
  assert.equal(profile, 'casual-diary');
  assert.equal(samples.length, 1);
});

test('サンプルがあれば few-shot としてプロンプトに載り、流用を禁じる注意が付く', async () => {
  const { buildStyleSection } = await import('../src/content/style.js');
  const section = buildStyleSection({
    styleName: 'casual-diary',
    samples: ['ここ4-7日で発送らしいので今買えばGWに使えるかなと思ってぽちった https://t.co/x'],
    owned: false,
  });
  assert.ok(section.includes('お手本'), 'few-shot セクションがある');
  assert.ok(section.includes('ぽちった'), 'サンプル本文が載る');
  assert.ok(!section.includes('https://'), 'URLは除去される');
  assert.ok(section.includes('絶対に流用しないこと'), '内容の流用を禁じている');
});

test('未所有では所有前提の言い回しを禁じ、所有済みでは許可する', async () => {
  const { buildStyleSection } = await import('../src/content/style.js');
  const notOwned = buildStyleSection({ styleName: 'casual-diary', samples: [], owned: false });
  const owned = buildStyleSection({ styleName: 'casual-diary', samples: [], owned: true });
  assert.ok(notOwned.includes('書かない（持っていないため）'), notOwned.slice(-200));
  assert.ok(notOwned.includes('迷ってる'));
  assert.ok(owned.includes('ぽちった'));
  assert.ok(!owned.includes('書かない（持っていないため）'));
});

test('砕けた文体では言い換えも砕けた形にする', () => {
  const casual = sanitizeRoom({ variants: [{ angle: 'a', text: '毎日愛用しています' }], hashtags: [] },
    { ...roomOpts, register: 'casual' });
  const polite = sanitizeRoom({ variants: [{ angle: 'a', text: '毎日愛用しています' }], hashtags: [] },
    { ...roomOpts, register: 'polite' });
  assert.ok(casual.variants[0].text.includes('気になってて'), casual.variants[0].text);
  assert.ok(polite.variants[0].text.includes('気になっていて'), polite.variants[0].text);
});

test('ハッシュタグ0指定なら1つも付けない', () => {
  const out = sanitizeRoom(
    { variants: [{ angle: 'a', text: 'これ良さそう' }], hashtags: ['タンブラー', '暮らし'] },
    { ...roomOpts, hashtagCount: 0 });
  assert.deepEqual(out.hashtags, []);
  assert.ok(!out.variants[0].posting.includes('#タンブラー'));
});
