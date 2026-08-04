/**
 * WebApp.gs
 * 画面フォーム（1件ずつ入力）用のWebアプリ。
 * デプロイ：エディタ右上「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」。
 */

/** ウェブアプリのトップ（入力フォームを表示） */
function doGet() {
  return HtmlService.createTemplateFromFile('Form')
    .evaluate()
    .setTitle('請求書の作成・送信')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** フォームの初期表示用に自社情報など（設定）を渡す */
function getFormDefaults() {
  const cfg = getConfig();
  return {
    fromCompany: cfg['自社会社名'] || '',
    defaultRate: Number(cfg['既定税率']) || 10,
  };
}

/**
 * フォーム送信を受け取り、シートに追記し、必要なら即送信する。
 * @param {Object} p {issueDate, dueDate, toCompany, toPerson, toEmail, subject, note, items:[{name,qty,unit,rate}], action}
 * @return {Object} {ok, number, total, message}
 */
function webCreateInvoice(p) {
  try {
    if (!p || !p.toCompany) throw new Error('宛先会社名を入力してください。');
    const items = (p.items || []).filter(function (it) { return it.name; });
    if (items.length === 0) throw new Error('明細を1件以上入力してください。');
    if (p.action === 'send' && !p.toEmail) throw new Error('送信するには宛先メールアドレスが必要です。');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const invSh = ss.getSheetByName(SHEET.INVOICE);
    const itemSh = ss.getSheetByName(SHEET.ITEM);
    if (!invSh || !itemSh) throw new Error('先にスプレッドシート側のメニューから「初期セットアップ」を実行してください。');

    const number = getNextNumber_();
    const issueDate = p.issueDate ? new Date(p.issueDate) : new Date();
    const dueDate = p.dueDate ? new Date(p.dueDate) : '';

    // 請求データを追記
    const row = invSh.getLastRow() + 1;
    const rowValues = new Array(INVOICE_HEADERS.length).fill('');
    rowValues[COL.NUMBER - 1] = number;
    rowValues[COL.ISSUE_DATE - 1] = issueDate;
    rowValues[COL.DUE_DATE - 1] = dueDate;
    rowValues[COL.TO_COMPANY - 1] = p.toCompany;
    rowValues[COL.TO_PERSON - 1] = p.toPerson || '';
    rowValues[COL.TO_EMAIL - 1] = p.toEmail || '';
    rowValues[COL.SUBJECT - 1] = p.subject || '';
    rowValues[COL.NOTE - 1] = p.note || '';
    rowValues[COL.STATUS - 1] = STATUS.PENDING;
    invSh.getRange(row, 1, 1, INVOICE_HEADERS.length).setValues([rowValues]);

    // 明細を追記
    const itemRows = items.map(function (it) {
      const r = new Array(ITEM_HEADERS.length).fill('');
      r[ICOL.NUMBER - 1] = number;
      r[ICOL.NAME - 1] = it.name;
      r[ICOL.QTY - 1] = Number(it.qty) || 0;
      r[ICOL.UNIT - 1] = Number(it.unit) || 0;
      r[ICOL.RATE - 1] = Number(it.rate) || 10;
      return r;
    });
    itemSh.getRange(itemSh.getLastRow() + 1, 1, itemRows.length, ITEM_HEADERS.length).setValues(itemRows);

    // 合計を計算（レスポンス表示用）
    const master = readMasterRow_(invSh, row);
    const model = buildModel_(master, collectItems_(number, false));

    if (p.action === 'send') {
      const res = processRow_(invSh, row, { mode: 'send', allowBlankItems: false });
      return { ok: res.ok, number: number, total: model.total, message: res.message };
    }
    return { ok: true, number: number, total: model.total, message: 'スプレッドシートに保存しました（未送信）。' };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}
