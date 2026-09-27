// 実行: node challenge-touch/test/logic.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
const { parseMail_, summarize_, buildDashboard_, shiftMonth_ } = ctx.module.exports;

const child = { id: 'a', name: 'A', keywords: ['たろう'] };
const cfg = { children: [child], ruleMode: 'pace', paceGraceLessons: 0 };
const rec = (date, lessons, source = 'mail') => ({ id: date + Math.random(), date, childId: 'a', lessons, source });

// 30日の月に30レッスン: 10日時点では10レッスン必要
let s = summarize_(child, '2026-09', 30, [rec('2026-09-01', 9)], '2026-09-10', cfg);
assert.strictEqual(s.expected, 10);
assert.strictEqual(s.behind, 1);
assert.strictEqual(s.gameOk, false);
assert.match(s.reason, /あと 1 レッスン/);

// 先行していれば今日やっていなくてもOK（pace）
s = summarize_(child, '2026-09', 30, [rec('2026-09-01', 12)], '2026-09-10', cfg);
assert.strictEqual(s.gameOk, true);
assert.strictEqual(s.studiedToday, false);

// daily ルールでは今日やっていないとNG
s = summarize_(child, '2026-09', 30, [rec('2026-09-01', 12)], '2026-09-10', { ...cfg, ruleMode: 'daily' });
assert.strictEqual(s.gameOk, false);

// strict: 今日やってもペース遅れならNG
s = summarize_(child, '2026-09', 30, [rec('2026-09-10', 3)], '2026-09-10', { ...cfg, ruleMode: 'strict' });
assert.strictEqual(s.gameOk, false);

// 全部終われば何もしなくてもOK
s = summarize_(child, '2026-09', 20, [rec('2026-09-05', 20)], '2026-09-10', { ...cfg, ruleMode: 'strict' });
assert.strictEqual(s.gameOk, true);
assert.strictEqual(s.monthDone, true);

// 総数未設定なら「今日やったか」で判定
s = summarize_(child, '2026-09', 0, [rec('2026-09-10', 0)], '2026-09-10', cfg);
assert.strictEqual(s.gameOk, true);

// 猶予
s = summarize_(child, '2026-09', 30, [rec('2026-09-01', 9)], '2026-09-10', { ...cfg, paceGraceLessons: 1 });
assert.strictEqual(s.gameOk, true);

// 手動調整（マイナス含む）と学習日の扱い
s = summarize_(child, '2026-09', 20, [rec('2026-09-02', 5, 'manual'), rec('2026-09-03', -1, 'manual'), rec('2026-09-04', 0, 'day')], '2026-09-10', cfg);
assert.strictEqual(s.done, 4);
assert.deepStrictEqual(Array.from(s.studyDays), ['2026-09-04']);

// 1日あたりの必要数（今日を含む残り日数）
s = summarize_(child, '2026-09', 20, [rec('2026-09-01', 10)], '2026-09-26', cfg);
assert.strictEqual(s.daysLeft, 5);
assert.strictEqual(s.perDay, 2);

// 過去月は gameOk を出さない
s = summarize_(child, '2026-08', 20, [rec('2026-08-01', 18)], '2026-09-10', cfg);
assert.strictEqual(s.gameOk, null);
assert.strictEqual(s.remaining, 2);

// メール解析
assert.deepStrictEqual(Array.from(parseMail_('お知らせ', 'たろうさんが学習しました', cfg).childIds), ['a']);
assert.strictEqual(parseMail_('', 'たろう 3レッスン完了', { ...cfg, lessonPattern: '(\\d+)\\s*レッスン' }).lessons, 3);
assert.strictEqual(parseMail_('', 'たろう ✓国語 ✓算数', { ...cfg, lessonPattern: '✓' }).lessons, 2);
assert.strictEqual(parseMail_('', 'たろう', cfg).lessons, 0);

// 月送り・ダッシュボード
assert.strictEqual(shiftMonth_('2026-01', -1), '2025-12');
const d = buildDashboard_([rec('2026-08-03', 20)], { '2026-08|a': 20, '2026-09|a': 25 }, '2026-09', '2026-09-27', cfg, '');
assert.strictEqual(d.children[0].total, 25);
assert.strictEqual(d.children[0].prevMonth.monthDone, true);

console.log('all tests passed');
