/**
 * チャレンジタッチ 月間レッスン管理（Google Apps Script）
 *
 * - Gmail に届くチャレンジタッチの通知メールを定期的に読み取り、子どもごとに記録する
 * - 「今月のレッスンを全部やる」ためのペースを計算し、今日ゲームしてよいかを判定する
 * - Webアプリとして公開し、管理画面（パスワードでログイン）と子ども用画面（専用リンク・閲覧のみ）を出す
 *
 * セットアップ手順は README.md を参照。
 */

// ===== 設定（ここを家庭に合わせて書き換える） =====
const CONFIG = {
  children: [
    // keywords: 通知メール本文・件名に含まれる、その子を判別できる文字列（名前など）
    { id: 'child1', name: 'たろう', emoji: '🦖', keywords: ['たろう'] },
    { id: 'child2', name: 'はなこ', emoji: '🐰', keywords: ['はなこ'] },
  ],
  // 通知メールを探す Gmail 検索クエリ。実際のメールの差出人・件名に合わせて調整する
  gmailQuery: 'チャレンジタッチ newer_than:45d',
  // メールから完了レッスン数を読み取る正規表現（文字列）。
  //   キャプチャグループあり → 最初の一致の数値を採用（例: '(\\d+)\\s*レッスン'）
  //   キャプチャグループなし → 一致した回数をレッスン数とする（例: '✓'）
  //   null → メールは「学習した日」の記録だけにして、レッスン数は親が手入力する
  lessonPattern: null,
  // 月のレッスン数が未設定のときの初期値（0 = 毎月親が入力する）
  defaultMonthlyLessons: 0,
  // ゲーム判定ルール
  //   'pace'   : 月末に全レッスン終わるペースに乗っていればOK（毎日やらなくてもいい）【おすすめ】
  //   'daily'  : 今日やっていればOK（従来ルール）。月の進捗は表示のみ
  //   'strict' : 今日やっていて、かつペースにも乗っていればOK
  ruleMode: 'pace',
  // ペース判定の猶予（レッスン数）。1 なら「1レッスン遅れまではOK」
  paceGraceLessons: 0,
};

const TZ = 'Asia/Tokyo';
const REC_HEADERS = ['id', 'date', 'childId', 'lessons', 'source', 'note', 'createdAt'];
const MONTH_HEADERS = ['month', 'childId', 'total', 'targetDay'];

// ===== セットアップ・トリガー =====

/** 初回に1回だけ手動実行する。スプレッドシート作成と定期実行トリガー登録を行う。 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create('チャレンジタッチ記録');
    props.setProperty('SHEET_ID', ss.getId());
  }
  if (!props.getProperty('ADMIN_PASSWORD')) props.setProperty('ADMIN_PASSWORD', randomString_(10));
  kidTokens_(); // 子ども用リンクの合言葉を作っておく
  sheet_('records', REC_HEADERS);
  sheet_('months', MONTH_HEADERS);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncFromGmail')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncFromGmail').timeBased().everyMinutes(30).create();
  syncFromGmail();
  Logger.log('セットアップ完了。スプレッドシート: ' + ss_().getUrl());
  Logger.log('管理画面のパスワード: ' + props.getProperty('ADMIN_PASSWORD') +
    '\n（変更は プロジェクトの設定 > スクリプト プロパティ の ADMIN_PASSWORD）');
}

/** 通知メールの中身を確認するためのデバッグ用。実行ログに最新メールを表示する。 */
function debugLatestMails() {
  const threads = GmailApp.search(CONFIG.gmailQuery, 0, 5);
  if (!threads.length) { Logger.log('該当メールなし。CONFIG.gmailQuery を見直してください: ' + CONFIG.gmailQuery); return; }
  threads.forEach(th => th.getMessages().slice(-1).forEach(m => {
    const parsed = parseMail_(m.getSubject(), m.getPlainBody(), CONFIG);
    Logger.log('==== ' + m.getDate() + ' / ' + m.getFrom() + '\n件名: ' + m.getSubject() +
      '\n判定: 子ども=' + JSON.stringify(parsed.childIds) + ' レッスン数=' + parsed.lessons +
      '\n本文(先頭800字):\n' + m.getPlainBody().slice(0, 800));
  }));
}

// ===== Gmail 取り込み =====

function syncFromGmail() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const seen = new Set(readRecords_().map(r => r.id));
    const rows = [];
    GmailApp.search(CONFIG.gmailQuery, 0, 100).forEach(th => th.getMessages().forEach(m => {
      const msgId = m.getId();
      const date = Utilities.formatDate(m.getDate(), TZ, 'yyyy-MM-dd');
      const parsed = parseMail_(m.getSubject(), m.getPlainBody(), CONFIG);
      const childIds = parsed.childIds.length ? parsed.childIds : ['unknown'];
      childIds.forEach(childId => {
        const id = 'mail:' + msgId + ':' + childId;
        if (seen.has(id)) return;
        seen.add(id);
        rows.push([id, "'" + date, childId, parsed.lessons, 'mail', m.getSubject().slice(0, 80), new Date()]);
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
  return { today: d.today, month: d.month, children: d.children.filter(c => c.childId === childId) };
}

function dashboard_(month) {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const d = buildDashboard_(readRecords_(), readTotals_(), month || today.slice(0, 7), today, CONFIG, '');
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
  if (action === 'resetKidLink') {
    if (!CONFIG.children.some(c => c.id === p.childId)) throw new Error('不明な子ども: ' + p.childId);
    const props = PropertiesService.getScriptProperties();
    const tokens = kidTokens_();
    tokens[p.childId] = randomString_(24);
    props.setProperty('KID_TOKENS', JSON.stringify(tokens));
    return dashboard_(p.month);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    if (action === 'sync') {
      lock.releaseLock();
      syncFromGmail();
    } else if (action === 'setTotal') {
      const targetDay = parseInt(p.targetDay, 10) || 0;
      if (targetDay < 0 || targetDay > daysInMonth_(p.month)) throw new Error('目標日は1〜' + daysInMonth_(p.month) + 'で入れてください（空欄なら月末）');
      setTotal_(p.month, p.childId, Math.max(0, parseInt(p.total, 10) || 0), targetDay);
    } else if (action === 'adjust') {
      addRecord_(p.date || today, p.childId, parseInt(p.delta, 10) || 0, 'manual', '手動調整');
    } else if (action === 'setDone') {
      const current = sumLessons_(readRecords_(), p.childId, p.month);
      const delta = (parseInt(p.value, 10) || 0) - current;
      const date = p.month === today.slice(0, 7) ? today : lastDayOfMonth_(p.month);
      if (delta) addRecord_(date, p.childId, delta, 'manual', '完了数を' + p.value + 'に合わせる');
    } else if (action === 'markDay') {
      addRecord_(p.date || today, p.childId, 0, 'day', '学習日を手動登録');
    } else {
      throw new Error('不明な操作: ' + action);
    }
  } finally {
    try { lock.releaseLock(); } catch (err) { /* 解放済み */ }
  }
  return dashboard_(p && p.month);
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

function readTotals_() {
  const values = sheet_('months', MONTH_HEADERS).getDataRange().getValues().slice(1);
  const totals = {};
  values.filter(r => r[0]).forEach(r => {
    totals[cellToStr_(r[0], 'yyyy-MM') + '|' + r[1]] = { total: Number(r[2]) || 0, targetDay: Number(r[3]) || 0 };
  });
  return totals;
}

function setTotal_(month, childId, total, targetDay) {
  const sh = sheet_('months', MONTH_HEADERS);
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (cellToStr_(values[i][0], 'yyyy-MM') === month && String(values[i][1]) === childId) {
      sh.getRange(i + 1, 3, 1, 2).setValues([[total, targetDay || '']]);
      return;
    }
  }
  sh.appendRow(["'" + month, childId, total, targetDay || '']);
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

function parseMail_(subject, body, cfg) {
  const text = String(subject || '') + '\n' + String(body || '');
  const childIds = cfg.children
    .filter(c => (c.keywords || []).some(k => k && text.indexOf(k) >= 0))
    .map(c => c.id);
  let lessons = 0;
  if (cfg.lessonPattern) {
    const matches = Array.from(text.matchAll(new RegExp(cfg.lessonPattern, 'g')));
    if (matches.length) lessons = matches[0].length > 1 ? (parseInt(matches[0][1], 10) || 0) : matches.length;
  }
  return { childIds, lessons };
}

function daysInMonth_(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function lastDayOfMonth_(month) {
  return month + '-' + String(daysInMonth_(month)).padStart(2, '0');
}

function shiftMonth_(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function sumLessons_(records, childId, month) {
  return records
    .filter(r => r.childId === childId && r.date.slice(0, 7) === month)
    .reduce((s, r) => s + r.lessons, 0);
}

/**
 * 1人・1か月分の状況を計算する。
 * ペース判定: 「今日までに終わっているべき数」= ceil(総数 × 経過日数 / 締め日) - 猶予
 * 締め日は目標日（進研ゼミの保護者サポートに出る日）があればその日、なければ月末。
 */
function summarize_(child, month, total, records, today, cfg, targetDay) {
  const mine = records.filter(r => r.childId === child.id && r.date.slice(0, 7) === month);
  const done = Math.max(0, mine.reduce((s, r) => s + r.lessons, 0));
  const studyDays = Array.from(new Set(
    mine.filter(r => r.source === 'mail' || r.source === 'day').map(r => r.date))).sort();

  const thisMonth = today.slice(0, 7);
  const dim = daysInMonth_(month);
  const isCurrent = month === thisMonth;
  const elapsed = isCurrent ? Number(today.slice(8, 10)) : (month < thisMonth ? dim : 0);
  const deadline = targetDay > 0 && targetDay <= dim ? targetDay : dim;
  const expected = total > 0
    ? Math.max(0, Math.ceil(total * Math.min(elapsed, deadline) / deadline) - (cfg.paceGraceLessons || 0)) : 0;

  const remaining = Math.max(0, total - done);
  const daysLeft = isCurrent ? Math.max(0, deadline - elapsed + 1) : 0; // 締め日まで、今日を含む
  const perDay = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining;
  const studiedToday = isCurrent && studyDays.indexOf(today) >= 0;
  const monthDone = total > 0 && done >= total;
  const behind = Math.max(0, expected - done);
  const onPace = total > 0 && behind === 0;

  let gameOk;
  let reason;
  if (monthDone) {
    gameOk = true;
    reason = '今月のレッスン、ぜんぶクリア！🎉';
  } else if (total <= 0) {
    // 月の総数が未設定なら従来の「今日やったか」だけで判定する
    gameOk = studiedToday;
    reason = studiedToday ? '今日もがんばったね！' : '今日のチャレンジタッチをやったらゲームOK';
  } else if (cfg.ruleMode === 'daily') {
    gameOk = studiedToday;
    reason = studiedToday ? '今日もがんばったね！' : '今日のチャレンジタッチをやったらゲームOK';
  } else if (cfg.ruleMode === 'strict') {
    gameOk = studiedToday && onPace;
    reason = gameOk ? '今日もペースもばっちり！'
      : !studiedToday ? '今日のチャレンジタッチをやったらゲームOK'
        : 'あと ' + behind + ' レッスンでペースにもどるよ';
  } else {
    gameOk = onPace;
    reason = onPace
      ? (studiedToday ? '今日もがんばったね！ペースばっちり' : 'ペースばっちり！今日はお休みしてもOK')
      : 'あと ' + behind + ' レッスンやったらゲームOK';
  }
  if (!isCurrent) {
    reason = monthDone ? 'ぜんぶクリア！' : (month < thisMonth ? remaining + ' レッスンのこり' : 'まだ始まっていません');
  }

  return {
    childId: child.id, name: child.name, emoji: child.emoji || '⭐',
    month, total, done, remaining, expected, behind, onPace, monthDone,
    daysInMonth: dim, deadline, targetDay: deadline < dim ? deadline : 0, elapsed, daysLeft, perDay, studiedToday, studyDays,
    gameOk: isCurrent ? gameOk : null, reason,
  };
}

function buildDashboard_(records, totals, month, today, cfg, appUrl) {
  const setting = (m, id) => {
    const t = totals[m + '|' + id];
    if (t === undefined) return { total: cfg.defaultMonthlyLessons || 0, targetDay: 0 };
    return typeof t === 'number' ? { total: t, targetDay: 0 } : t;
  };
  const sum = (m, c) => {
    const st = setting(m, c.id);
    return summarize_(c, m, st.total, records, today, cfg, st.targetDay);
  };
  const prev = shiftMonth_(month, -1);
  return {
    today, month, ruleMode: cfg.ruleMode, appUrl: appUrl || '',
    unknownMails: records.filter(r => r.childId === 'unknown' && r.date.slice(0, 7) === month).length,
    children: cfg.children.map(c => Object.assign(
      sum(month, c), { prevMonth: sum(prev, c) })),
  };
}

// Node でのテスト用（Apps Script では module は未定義なので無視される）
if (typeof module !== 'undefined') {
  module.exports = { parseMail_, summarize_, buildDashboard_, shiftMonth_, daysInMonth_ };
}
