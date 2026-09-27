/**
 * チャレンジタッチ がんばり管理（Google Apps Script）
 *
 * - Gmail に届く「【昨日のがんばり】」メールを定期的に読み取り、子どもごとに
 *   学習した日・レッスン数・「◯月号を全て完了」を記録する
 * - 今日ゲームしてよいか（今日やった / 今週の目標達成 / 今月分完了 のどれかでOK）を出す
 * - 月の全レッスンを月末までに終えられなかったら、翌月のゲーム時間を減らす
 * - Webアプリとして公開し、管理画面（パスワードでログイン）と子ども用画面（専用リンク・閲覧のみ）を出す
 *
 * セットアップ手順は README.md を参照。
 */

// ===== 設定（ここを家庭に合わせて書き換える） =====
const CONFIG = {
  children: [
    // keywords: 通知メールの件名・本文に出てくる、その子の名前（「◯◯さん」の◯◯）
    // baseMinutes: 1日のゲーム時間（先月を達成していたときの時間）
    { id: 'child1', name: 'お兄ちゃん', emoji: '🦖', keywords: ['（兄の名前）'], baseMinutes: 60 },
    { id: 'child2', name: '弟', emoji: '🐰', keywords: ['（弟の名前）'], baseMinutes: 30 },
  ],
  // 「昨日のがんばり」メールを探す Gmail 検索クエリ
  gmailQuery: 'subject:昨日のがんばり newer_than:70d',
  // 週の目標: 月曜〜日曜のうち、この日数やっていれば残りの日は休んでもゲームOK
  weeklyGoalDays: 5,
  // 月の全レッスンを月末までに終えられなかったとき、翌月のゲーム時間から減らす分数
  penaltyMinutes: 30,
  // 減らしたあとのゲーム時間の下限（0 = 0分まで減りうる）
  minMinutes: 0,
  // この月の結果から判定を始める（ルールを伝える前の月でペナルティを出さないため）
  ruleStartMonth: '2026-10',
};

const TZ = 'Asia/Tokyo';
const REC_HEADERS = ['id', 'date', 'childId', 'lessons', 'source', 'note', 'createdAt'];
// source の種類
//   mail     : がんばりメール1通 = その日に学習した（lessons = その日のレッスン数）
//   complete : 「◯月号を全て完了」メール（date の月の分を月内に完了）
//   late     : 月が変わってから完了した（期限切れなので達成扱いにしない）
//   day      : 親が「今日やった」と手で登録した
//   manual   : 親が手で「この月は完了」「完了を取り消し」した（lessons = 1 / -1）

// ===== セットアップ・トリガー =====

/** 初回に1回だけ手動実行する。スプレッドシート作成・パスワード発行・定期実行トリガー登録を行う。 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create('チャレンジタッチ記録');
    props.setProperty('SHEET_ID', ss.getId());
  }
  if (!props.getProperty('ADMIN_PASSWORD')) props.setProperty('ADMIN_PASSWORD', randomString_(10));
  kidTokens_(); // 子ども用リンクの合言葉を作っておく
  sheet_('records', REC_HEADERS);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncFromGmail')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncFromGmail').timeBased().everyHours(1).create();
  syncFromGmail();
  Logger.log('セットアップ完了。スプレッドシート: ' + ss_().getUrl());
  Logger.log('管理画面のパスワード: ' + props.getProperty('ADMIN_PASSWORD') +
    '\n（変更は プロジェクトの設定 > スクリプト プロパティ の ADMIN_PASSWORD）');
}

/** メールの読み取り結果を確認するためのデバッグ用。実行ログに最新メールと判定結果を表示する。 */
function debugLatestMails() {
  const threads = GmailApp.search(CONFIG.gmailQuery, 0, 5);
  if (!threads.length) { Logger.log('該当メールなし。CONFIG.gmailQuery を見直してください: ' + CONFIG.gmailQuery); return; }
  threads.forEach(th => th.getMessages().slice(-1).forEach(m => {
    const parsed = parseMail_(m.getSubject(), mailText_(m), m.getDate(), CONFIG);
    Logger.log('==== 受信 ' + m.getDate() + ' / ' + m.getFrom() + '\n件名: ' + m.getSubject() +
      '\n判定: ' + JSON.stringify(parsed) + '\n本文(先頭600字):\n' + mailText_(m).slice(0, 600));
  }));
}

// ===== Gmail 取り込み =====

function syncFromGmail() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const seen = new Set(readRecords_().map(r => r.id));
    const rows = [];
    const push = (id, date, childId, lessons, source, note) => {
      if (seen.has(id)) return;
      seen.add(id);
      rows.push([id, "'" + date, childId, lessons, source, note, new Date()]);
    };
    GmailApp.search(CONFIG.gmailQuery, 0, 100).forEach(th => th.getMessages().forEach(m => {
      const msgId = m.getId();
      const p = parseMail_(m.getSubject(), mailText_(m), m.getDate(), CONFIG);
      const childIds = p.childIds.length ? p.childIds : ['unknown'];
      childIds.forEach(childId => {
        push('mail:' + msgId + ':' + childId, p.date, childId, p.lessons, 'mail',
          (p.minutes ? p.minutes + '分 ' : '') + m.getSubject().slice(0, 60));
        if (p.completedMonth) {
          const late = p.completedMonth < p.date.slice(0, 7);
          push('done:' + msgId + ':' + childId, late ? p.completedMonth + '-01' : p.date, childId, 0,
            late ? 'late' : 'complete', p.completedMonth + '月号 完了');
        }
      });
    }));
    if (rows.length) {
      const sh = sheet_('records', REC_HEADERS);
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, REC_HEADERS.length).setValues(rows);
    }
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

/** プレーンテキスト本文。表組みで崩れていそうなら HTML からタグを除いたものも足す */
function mailText_(m) {
  const plain = m.getPlainBody() || '';
  if (/レッスン数/.test(plain) && /\d+\s*回/.test(plain)) return plain;
  const html = (m.getBody() || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|th|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return plain + '\n' + html;
}

// ===== Webアプリ =====

const SESSION_SECONDS = 6 * 60 * 60; // ログインの有効時間（CacheService の上限が6時間）
const MAX_LOGIN_FAILURES = 10;       // これを超えて間違えると15分ログインできなくなる

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.kidParam = (e && e.parameter && e.parameter.kid) || '';
  return t.evaluate()
    .setTitle('チャレンジタッチ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 管理画面ログイン。成功するとセッショントークンを返す */
function login(password) {
  const cache = CacheService.getScriptCache();
  const failures = Number(cache.get('loginFailures') || 0);
  if (failures >= MAX_LOGIN_FAILURES) throw new Error('パスワードを間違えすぎました。15分ほど待ってからやり直してください');
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected) throw new Error('未セットアップです。先に setup() を実行してください');
  if (String(password) !== expected) {
    cache.put('loginFailures', String(failures + 1), 15 * 60);
    throw new Error('パスワードがちがいます');
  }
  cache.remove('loginFailures');
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('session:' + token, '1', SESSION_SECONDS);
  return token;
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('session:' + token);
}

function requireSession_(token) {
  if (!token || !CacheService.getScriptCache().get('session:' + token)) {
    throw new Error('LOGIN_REQUIRED');
  }
}

/** 管理画面用データ（ログイン必須） */
function getDashboard(token, month) {
  requireSession_(token);
  return dashboard_(month);
}

/** 子ども用データ（子ども用リンクの合言葉で、その子の分だけ返す） */
function getKidView(kidToken) {
  const tokens = kidTokens_();
  const childId = Object.keys(tokens).find(id => kidToken && tokens[id] === kidToken);
  if (!childId) throw new Error('このリンクは使えません。おうちの人に新しいリンクをもらってください');
  const d = dashboard_(null);
  return Object.assign({}, d, { children: d.children.filter(c => c.childId === childId) });
}

function dashboard_(month) {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const d = buildDashboard_(readRecords_(), month || today.slice(0, 7), today, CONFIG);
  const url = ScriptApp.getService().getUrl();
  const tokens = kidTokens_();
  d.children.forEach(c => { c.kidUrl = url && tokens[c.childId] ? url + '?kid=' + tokens[c.childId] : ''; });
  return d;
}

/** 子どもごとのリンク用合言葉（推測されにくいランダム文字列）。{childId: token} */
function kidTokens_() {
  const props = PropertiesService.getScriptProperties();
  const tokens = JSON.parse(props.getProperty('KID_TOKENS') || '{}');
  let changed = false;
  CONFIG.children.forEach(c => {
    if (!tokens[c.id]) { tokens[c.id] = randomString_(24); changed = true; }
  });
  if (changed) props.setProperty('KID_TOKENS', JSON.stringify(tokens));
  return tokens;
}

function randomString_(len) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  while (s.length < len) {
    Utilities.getUuid().replace(/-/g, '').match(/../g).forEach(h => {
      if (s.length < len) s += chars[parseInt(h, 16) % chars.length];
    });
  }
  return s;
}

/** 管理画面の操作（ログイン必須） */
function parentAction(token, action, p) {
  requireSession_(token);
  p = p || {};
  if (action !== 'sync' && !CONFIG.children.some(c => c.id === p.childId)) throw new Error('不明な子ども: ' + p.childId);
  if (action === 'resetKidLink') {
    const tokens = kidTokens_();
    tokens[p.childId] = randomString_(24);
    PropertiesService.getScriptProperties().setProperty('KID_TOKENS', JSON.stringify(tokens));
    return dashboard_(p.month);
  }
  if (action === 'sync') {
    syncFromGmail();
    return dashboard_(p.month);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    if (action === 'markDay') {
      addRecord_(today, p.childId, 0, 'day', '今日やったと手動登録');
    } else if (action === 'markComplete') {
      addRecord_(p.month + '-01', p.childId, 1, 'manual', 'この月を完了扱いにする');
    } else if (action === 'unmarkComplete') {
      addRecord_(p.month + '-01', p.childId, -1, 'manual', '完了扱いを取り消す');
    } else {
      throw new Error('不明な操作: ' + action);
    }
  } finally {
    lock.releaseLock();
  }
  return dashboard_(p.month);
}

// ===== スプレッドシート入出力 =====

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('未セットアップです。先に setup() を実行してください');
  return SpreadsheetApp.openById(id);
}

function sheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readRecords_() {
  const values = sheet_('records', REC_HEADERS).getDataRange().getValues().slice(1);
  return values.filter(r => r[0]).map(r => ({
    id: String(r[0]),
    date: cellToStr_(r[1], 'yyyy-MM-dd'),
    childId: String(r[2]),
    lessons: Number(r[3]) || 0,
    source: String(r[4]),
    note: String(r[5] || ''),
  }));
}

function addRecord_(date, childId, lessons, source, note) {
  const id = source + ':' + Utilities.getUuid();
  sheet_('records', REC_HEADERS).appendRow([id, "'" + date, childId, lessons, source, note, new Date()]);
}

function cellToStr_(v, fmt) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, fmt);
  return String(v).replace(/^'/, '');
}

// ===== 判定ロジック（純粋関数。Sheets/Gmail に依存しない） =====

const pad2_ = n => String(n).padStart(2, '0');
const ymd_ = d => d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
const parseYmd_ = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

/**
 * 「【昨日のがんばり】◯◯さんが…」メールを読む。
 * receivedAt は受信日時（本文に日付がないときの予備）。JST の日付として扱えるよう
 * 呼び出し側の Apps Script のタイムゾーンは Asia/Tokyo にしておく。
 */
function parseMail_(subject, body, receivedAt, cfg) {
  const text = String(subject || '') + '\n' + String(body || '');
  const childIds = cfg.children
    .filter(c => (c.keywords || []).some(k => k && text.indexOf(k) >= 0))
    .map(c => c.id);

  // 学習した日: 本文の「2026年9月24日」。なければ受信日（件名が「昨日の」なら前日）
  let date;
  const dm = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (dm) {
    date = dm[1] + '-' + pad2_(dm[2]) + '-' + pad2_(dm[3]);
  } else {
    const d = new Date(receivedAt);
    if (/昨日/.test(subject)) d.setDate(d.getDate() - 1);
    date = ymd_(d);
  }

  // レッスン数: 「レッスン数」〜「合計時間」の間にある「国語:5回」などを合計
  const start = text.indexOf('レッスン数');
  let section = '';
  if (start >= 0) {
    const end = text.indexOf('合計時間', start);
    section = text.slice(start, end > start ? end : start + 300);
  }
  let lessons = 0;
  (section.match(/[:：]\s*\d+\s*回/g) || []).forEach(s => { lessons += Number(s.match(/\d+/)[0]); });

  const tm = text.match(/合計時間[^\d]{0,20}(\d+)\s*分/);
  const minutes = tm ? Number(tm[1]) : 0;

  // 「9月号を全て完了」→ 何年何月の分か（学習日の年を基準に、年またぎも考慮）
  let completedMonth = '';
  const cm = text.match(/(\d{1,2})月号を全て完了/);
  if (cm) {
    const n = Number(cm[1]);
    let y = Number(date.slice(0, 4));
    const dMonth = Number(date.slice(5, 7));
    if (n - dMonth > 6) y -= 1;       // 1月に12月号を完了した
    else if (dMonth - n > 6) y += 1;  // 12月に1月号を完了した
    completedMonth = y + '-' + pad2_(n);
  }
  return { childIds, date, lessons, minutes, completedMonth };
}

function daysInMonth_(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function shiftMonth_(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1);
}

/** その月の全レッスンを月内に完了したか（メールの完了通知 + 親の手動調整） */
function monthCompleted_(records, childId, month) {
  const mine = records.filter(r => r.childId === childId && r.date.slice(0, 7) === month);
  const manual = mine.filter(r => r.source === 'manual').reduce((s, r) => s + r.lessons, 0);
  if (manual > 0) return true;
  if (manual < 0) return false;
  return mine.some(r => r.source === 'complete');
}

/**
 * その月のゲーム時間。前の月を月内に完了していなければ penaltyMinutes 減らす。
 * ruleStartMonth より前の月の結果は問わない。
 */
function gameMinutes_(child, month, records, today, cfg) {
  const base = child.baseMinutes || 60;
  const prev = shiftMonth_(month, -1);
  if (prev < cfg.ruleStartMonth) return { minutes: base, base, prevJudged: false, prevDone: null };
  if (prev >= today.slice(0, 7)) return { minutes: base, base, prevJudged: false, prevDone: null };
  const prevDone = monthCompleted_(records, child.id, prev);
  const minutes = prevDone ? base : Math.max(cfg.minMinutes || 0, base - (cfg.penaltyMinutes || 0));
  return { minutes, base, prevJudged: true, prevDone };
}

/** 1人・1か月分の状況 */
function summarize_(child, month, records, today, cfg) {
  const mine = records.filter(r => r.childId === child.id);
  const studyDaySet = new Set(mine.filter(r => r.source === 'mail' || r.source === 'day').map(r => r.date));
  const inMonth = mine.filter(r => r.date.slice(0, 7) === month);
  const lessons = inMonth.filter(r => r.source === 'mail').reduce((s, r) => s + r.lessons, 0);
  const studyDays = Array.from(new Set(inMonth
    .filter(r => r.source === 'mail' || r.source === 'day').map(r => r.date))).sort();
  const monthDone = monthCompleted_(records, child.id, month);
  const isCurrent = month === today.slice(0, 7);

  // 今週（月曜はじまり）
  const t = parseYmd_(today);
  const monday = new Date(t);
  monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const s = ymd_(d);
    week.push({ date: s, studied: studyDaySet.has(s), future: s > today, isToday: s === today });
  }
  const weekDays = week.filter(w => w.studied).length;
  const weekGoalMet = weekDays >= cfg.weeklyGoalDays;
  const studiedToday = studyDaySet.has(today);

  // 今日のゲーム: 今月分完了 / 今週の目標達成 / 今日やった のどれかでOK。
  // メールは翌日届くので、今日やったかはメールではまだ分からない（親の「今日やった」登録で反映）
  let status;
  let reason;
  if (monthDone && isCurrent) { status = 'free'; reason = '今月のレッスンはぜんぶ完了！'; }
  else if (weekGoalMet) { status = 'free'; reason = '今週の目標（' + cfg.weeklyGoalDays + '日）達成！今日は休んでもOK'; }
  else if (studiedToday) { status = 'ok'; reason = '今日もやったね！'; }
  else { status = 'todo'; reason = '今週あと ' + (cfg.weeklyGoalDays - weekDays) + ' 日やれば、のこりの日は休めるよ'; }

  const game = gameMinutes_(child, month, records, today, cfg);
  const judgedThisMonth = month >= cfg.ruleStartMonth;
  const reduced = Math.max(cfg.minMinutes || 0, game.base - (cfg.penaltyMinutes || 0));

  return {
    childId: child.id, name: child.name, emoji: child.emoji || '⭐',
    month, isCurrent, lessons, studyDays, daysInMonth: daysInMonth_(month), monthDone,
    week, weekDays, weeklyGoalDays: cfg.weeklyGoalDays, weekGoalMet, studiedToday,
    status: isCurrent ? status : null, reason: isCurrent ? reason : '',
    gameMinutes: game.minutes, baseMinutes: game.base, prevJudged: game.prevJudged, prevDone: game.prevDone,
    // 来月のゲーム時間の見込み（今月を完了したら / しなかったら）
    nextMinutesIfDone: game.base,
    nextMinutesIfNot: judgedThisMonth ? reduced : game.base,
    judgedThisMonth,
  };
}

function buildDashboard_(records, month, today, cfg) {
  return {
    today, month,
    weeklyGoalDays: cfg.weeklyGoalDays, penaltyMinutes: cfg.penaltyMinutes, ruleStartMonth: cfg.ruleStartMonth,
    unknownMails: records.filter(r => r.childId === 'unknown' && r.date.slice(0, 7) === month).length,
    children: cfg.children.map(c => summarize_(c, month, records, today, cfg)),
  };
}

// Node でのテスト用（Apps Script では module は未定義なので無視される）
if (typeof module !== 'undefined') {
  module.exports = { parseMail_, summarize_, buildDashboard_, shiftMonth_, gameMinutes_, monthCompleted_ };
}
