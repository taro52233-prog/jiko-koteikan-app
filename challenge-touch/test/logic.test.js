// 実行: node challenge-touch/test/logic.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
const { parseMail_, summarize_, gameMinutes_ } = ctx.module.exports;

const ani = { id: 'a', name: '兄', keywords: ['ソラ'], baseMinutes: 60 };
const oto = { id: 'b', name: '弟', keywords: ['リク'], baseMinutes: 30, promoteTo: 60, promoteAfterMonths: 2 };
const cfg = { children: [ani, oto], weeklyGoalDays: 5, penaltyMinutes: 30, minMinutes: 0, ruleStartMonth: '2026-09' };
const rec = (childId, date, source = 'mail', lessons = 1) => ({ id: Math.random() + '', date, childId, lessons, source });

// ---- 実際のメール（2026/9/25 受信）の形 ----
const body = `2026年9月24日(木)
ソラさんが9月号を全て完了しました！
担任の「赤ペン先生」あそう先生
取り組み内容
レッスン数
国語:5回
算数:4回
合計時間
15分
詳細を見る
5年生9月号を全て完了しました。目標日までにやりきれて素晴らしいです。`;
let p = parseMail_('【昨日のがんばり】ソラさんが9月号を全て完了しました！', body, new Date(2026, 8, 25, 7, 0), cfg);
assert.deepStrictEqual(Array.from(p.childIds), ['a']);
assert.strictEqual(p.date, '2026-09-24');
assert.strictEqual(p.lessons, 9);
assert.strictEqual(p.minutes, 15);
assert.strictEqual(p.completedMonth, '2026-09');

// 本文に日付がなければ「昨日」= 受信日の前日
p = parseMail_('【昨日のがんばり】リクさん', 'レッスン数 国語：2回 合計時間 5分', new Date(2026, 9, 1, 7, 0), cfg);
assert.strictEqual(p.date, '2026-09-30');
assert.strictEqual(p.lessons, 2);
assert.strictEqual(p.completedMonth, '');
assert.deepStrictEqual(Array.from(p.childIds), ['b']);

// 年またぎの「12月号」
p = parseMail_('', '2027年1月2日 12月号を全て完了', new Date(2027, 0, 3), cfg);
assert.strictEqual(p.completedMonth, '2026-12');

// ---- 今日のゲーム判定 ----
// 2026-09-27 は日曜。今週 = 9/21(月)〜9/27(日)
const wk = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].map(d => rec('b', d));
let s = summarize_(oto, '2026-09', wk, '2026-09-27', cfg);
assert.strictEqual(s.weekDays, 4);
assert.strictEqual(s.status, 'todo');
s = summarize_(oto, '2026-09', wk.concat(rec('b', '2026-09-25')), '2026-09-27', cfg);
assert.strictEqual(s.weekGoalMet, true);
assert.strictEqual(s.status, 'free');
// 親が「今日やった」を登録
s = summarize_(oto, '2026-09', wk.slice(1).concat(rec('b', '2026-09-27', 'day', 0)), '2026-09-27', cfg);
assert.strictEqual(s.status, 'ok');
// 今月完了していれば週に関係なくOK
s = summarize_(ani, '2026-09', [rec('a', '2026-09-24', 'complete', 0)], '2026-09-27', cfg);
assert.strictEqual(s.status, 'free');
assert.strictEqual(s.monthDone, true);
// 先週の分は今週に数えない
s = summarize_(oto, '2026-09', ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'].map(d => rec('b', d)), '2026-09-21', cfg);
assert.strictEqual(s.weekDays, 0);

// ---- 翌月のゲーム時間 ----
const recs = [rec('a', '2026-09-24', 'complete', 0), rec('b', '2026-09-10')];
assert.strictEqual(gameMinutes_(ani, '2026-10', recs, '2026-10-01', cfg).minutes, 60);
assert.strictEqual(gameMinutes_(oto, '2026-10', recs, '2026-10-01', cfg).minutes, 0);
assert.strictEqual(gameMinutes_(oto, '2026-10', recs, '2026-10-01', { ...cfg, minMinutes: 15 }).minutes, 15);
// 判定開始前の月は問わない
assert.strictEqual(gameMinutes_(oto, '2026-10', recs, '2026-10-01', { ...cfg, ruleStartMonth: '2026-10' }).minutes, 30);
// 月をまたいでから完了（late）は達成扱いにしない
assert.strictEqual(gameMinutes_(ani, '2026-10', [rec('a', '2026-09-01', 'late', 0)], '2026-10-05', cfg).minutes, 30);
// 親の手動「完了扱い」と取り消し
assert.strictEqual(gameMinutes_(oto, '2026-10', [rec('b', '2026-09-01', 'manual', 1)], '2026-10-05', cfg).minutes, 30);
assert.strictEqual(gameMinutes_(ani, '2026-10', [rec('a', '2026-09-24', 'complete', 0), rec('a', '2026-09-01', 'manual', -1)], '2026-10-05', cfg).minutes, 30);
// 今月の見込み
s = summarize_(oto, '2026-09', [], '2026-09-27', cfg);
assert.strictEqual(s.nextMinutesIfDone, 30);
assert.strictEqual(s.nextMinutesIfNot, 0);

// ---- 案C: 2か月つづけて完了したら弟は60分に上がる ----
const c = (m) => rec('b', m + '-20', 'complete', 0);
let cfg2 = { ...cfg, ruleStartMonth: '2026-10' };
assert.strictEqual(gameMinutes_(oto, '2026-11', [c('2026-10')], '2026-11-01', cfg2).minutes, 30); // 1か月目はまだ30分
assert.strictEqual(gameMinutes_(oto, '2026-12', [c('2026-10'), c('2026-11')], '2026-12-01', cfg2).minutes, 60); // 2か月連続で60分
// 上がったあとに未完了 → その月は 60-30=30分、ふだんの時間は60分のまま
let g = gameMinutes_(oto, '2027-01', [c('2026-10'), c('2026-11')], '2027-01-01', cfg2);
assert.strictEqual(g.minutes, 30);
assert.strictEqual(g.base, 60);
assert.strictEqual(gameMinutes_(oto, '2027-02', [c('2026-10'), c('2026-11'), c('2027-01')], '2027-02-01', cfg2).minutes, 60);
// 連続が途切れたら数え直し
assert.strictEqual(gameMinutes_(oto, '2027-01', [c('2026-10'), c('2026-12')], '2027-01-01', cfg2).minutes, 30);
// 兄は昇格なし
assert.strictEqual(gameMinutes_(ani, '2026-12', [], '2026-12-01', cfg2).minutes, 30);
// 画面用の見込み
s = summarize_(oto, '2026-11', [c('2026-10')], '2026-11-15', cfg2);
assert.strictEqual(s.promoteMonthsLeft, 1);
assert.strictEqual(s.nextMinutesIfDone, 60);
assert.strictEqual(s.nextMinutesIfNot, 0);
s = summarize_(oto, '2026-10', [], '2026-10-15', cfg2);
assert.strictEqual(s.promoteMonthsLeft, 2);
assert.strictEqual(s.nextMinutesIfDone, 30);

// ---- 今月の進み具合（メール合計 + 保護者サポートの数への補正）----
const prog = [rec('b', '2026-10-01', 'mail', 5), rec('b', '2026-10-02', 'mail', 4), rec('b', '2026-10-01', 'total', 61), rec('b', '2026-10-01', 'total', 58)];
s = summarize_(oto, '2026-10', prog, '2026-10-03', cfg2);
assert.strictEqual(s.lessons, 9);
assert.strictEqual(s.total, 58); // 最後に入れた数が有効
s = summarize_(oto, '2026-10', prog.concat(rec('b', '2026-10-01', 'adjust', -2)), '2026-10-03', cfg2);
assert.strictEqual(s.lessons, 7);
s = summarize_(oto, '2026-10', prog.concat(c('2026-10')), '2026-10-20', cfg2);
assert.strictEqual(s.lessons, 58); // 完了済みなら必須数ぶん

console.log('all tests passed');

// ---- お知らせメール ----
{
  const { buildMonthlyReport_, buildReminder_ } = ctx.module.exports;
  const cfg3 = { ...cfg, ruleStartMonth: '2026-10' };
  const recs = [rec('a', '2026-10-20', 'complete', 0), rec('a', '2026-10-05', 'mail', 30), rec('b', '2026-10-06', 'mail', 10)];
  // 判定開始前の月の結果は送らない
  assert.strictEqual(buildMonthlyReport_(recs, '2026-10-02', cfg3), null);
  const r = buildMonthlyReport_(recs, '2026-11-02', cfg3);
  assert.match(r.subject, /10月の結果と11月のゲーム時間/);
  assert.match(r.body, /兄: 10月号 ✅ 完了/);
  assert.match(r.body, /11月のゲームは 1日 60分/);
  assert.match(r.body, /弟: 10月号 ❌ 未完了/);
  assert.match(r.body, /11月のゲームは 1日 0分/);
  assert.match(r.body, /あと 2か月つづけて完了すると 60分/);
  // 昇格した月
  const up = buildMonthlyReport_([rec('b', '2026-10-20', 'complete', 0), rec('b', '2026-11-20', 'complete', 0)], '2026-12-02', cfg3);
  assert.match(up.body, /ふだんの時間が 60分に上がりました/);
  // リマインド: 未完了の子だけ
  const rem = buildReminder_([rec('a', '2026-10-15', 'complete', 0), rec('b', '2026-10-06', 'mail', 10)], '2026-10-20', cfg3);
  assert.match(rem.subject, /のこり12日/);
  assert.doesNotMatch(rem.body, /兄/);
  assert.match(rem.body, /弟: 10月号がまだ完了していません/);
  // 全員完了なら送らない
  assert.strictEqual(buildReminder_([rec('a', '2026-10-15', 'complete', 0), rec('b', '2026-10-16', 'complete', 0)], '2026-10-20', cfg3), null);
  console.log('notification tests passed');
}

// ---- 判別できなかったメール: keywords を直して取り込み直されたら数えない ----
{
  const { buildDashboard_ } = ctx.module.exports;
  const u = (id, childId) => ({ id: 'mail:' + id + ':' + childId, date: '2026-09-20', childId, lessons: 3, source: 'mail', note: '【昨日のがんばり】ソラさん' });
  let d = buildDashboard_([u('m1', 'unknown'), u('m2', 'unknown')], '2026-09', '2026-09-27', cfg);
  assert.strictEqual(d.unknownMails, 2);
  assert.strictEqual(d.unknownSubjects[0], '【昨日のがんばり】ソラさん');
  d = buildDashboard_([u('m1', 'unknown'), u('m2', 'unknown'), u('m1', 'a')], '2026-09', '2026-09-27', cfg);
  assert.strictEqual(d.unknownMails, 1);
  console.log('unknown mail tests passed');
}
