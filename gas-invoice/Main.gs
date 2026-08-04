/**
 * Main.gs
 * 送信の入口（メニュー項目の実体）と、行→請求書処理のオーケストレーション。
 */

/** 「請求データ」から1行分の値を読み、masterオブジェクトにする */
function readMasterRow_(sh, row) {
  const v = sh.getRange(row, 1, 1, INVOICE_HEADERS.length).getValues()[0];
  return {
    row: row,
    number: String(v[COL.NUMBER - 1]).trim(),
    issueDate: v[COL.ISSUE_DATE - 1] || new Date(),
    dueDate: v[COL.DUE_DATE - 1] || '',
    toCompany: v[COL.TO_COMPANY - 1] || '',
    toPerson: v[COL.TO_PERSON - 1] || '',
    toEmail: String(v[COL.TO_EMAIL - 1] || '').trim(),
    subject: v[COL.SUBJECT - 1] || '',
    note: v[COL.NOTE - 1] || '',
    status: String(v[COL.STATUS - 1] || '').trim(),
  };
}

/** 請求番号を自動採番（設定のプレフィックス＋連番） */
function getNextNumber_() {
  const cfg = getConfig();
  const prefix = String(cfg['請求番号プレフィックス'] || 'INV-');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.INVOICE);
  const last = sh.getLastRow();
  let max = 0, width = 4;
  if (last >= 2) {
    const nums = sh.getRange(2, COL.NUMBER, last - 1, 1).getValues();
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    nums.forEach(function (r) {
      const mt = re.exec(String(r[0]).trim());
      if (mt) {
        const n = parseInt(mt[1], 10);
        if (n > max) max = n;
        if (mt[1].length > width) width = mt[1].length;
      }
    });
  }
  const next = String(max + 1);
  const padded = ('0000000000' + next).slice(-Math.max(width, next.length));
  return prefix + padded;
}

/**
 * 1行を処理して請求書を生成・送信（またはプレビュー下書き）。
 * @param {Sheet}  sh   請求データシート
 * @param {number} row  行番号
 * @param {Object} opts {mode:'send'|'draft', allowBlankItems:boolean}
 * @return {Object} {ok, number, message}
 */
function processRow_(sh, row, opts) {
  const master = readMasterRow_(sh, row);

  // 自動採番
  if (!master.number) {
    master.number = getNextNumber_();
    sh.getRange(row, COL.NUMBER).setValue(master.number);
    // 空欄の明細を今回の請求に紐付ける（単発時のみ）
    if (opts.allowBlankItems) {
      const itemSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.ITEM);
      if (itemSh && itemSh.getLastRow() >= 2) {
        const n = itemSh.getLastRow() - 1;
        const numRng = itemSh.getRange(2, ICOL.NUMBER, n, 1);
        const numVals = numRng.getValues();
        const nameVals = itemSh.getRange(2, ICOL.NAME, n, 1).getValues();
        let changed = false;
        for (let i = 0; i < n; i++) {
          const cur = String(numVals[i][0]).trim();
          const name = nameVals[i][0];
          if (cur === '' && name !== '' && name != null) {
            numVals[i][0] = master.number;
            changed = true;
          }
        }
        if (changed) numRng.setValues(numVals);
      }
    }
  }

  const items = collectItems_(master.number, false); // 番号は確定済みなので厳密一致で取得
  if (items.length === 0) {
    return { ok: false, number: master.number, message: '明細がありません（請求番号 ' + master.number + '）' };
  }

  const model = buildModel_(master, items);
  const pdf = createInvoicePdf_(model);

  if (opts.mode === 'draft') {
    draftInvoiceMail_(model, pdf);
    return { ok: true, number: master.number, message: '下書きを作成しました' };
  }

  // 送信
  sendInvoiceMail_(model, pdf);
  const url = archivePdf_(pdf);
  sh.getRange(row, COL.STATUS).setValue(STATUS.SENT);
  sh.getRange(row, COL.SENT_AT).setValue(nowStamp());
  if (url) sh.getRange(row, COL.PDF_URL).setValue(url);
  return { ok: true, number: master.number, message: '送信しました → ' + model.toEmail };
}

/** メニュー：選択中の行を送信 */
function sendSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sh.getName() !== SHEET.INVOICE) {
    ui.alert('「' + SHEET.INVOICE + '」シートで送信したい行を選択してください。');
    return;
  }
  const row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('データ行（2行目以降）を選択してください。'); return; }

  const to = readMasterRow_(sh, row).toEmail;
  const res = ui.alert('送信の確認', to + ' 宛に請求書を送信します。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;

  try {
    const r = processRow_(sh, row, { mode: 'send', allowBlankItems: true });
    ui.alert(r.ok ? '完了' : 'エラー', r.message, ui.ButtonSet.OK);
  } catch (e) {
    sh.getRange(row, COL.STATUS).setValue(STATUS.ERROR);
    ui.alert('エラー', String(e.message || e), ui.ButtonSet.OK);
  }
}

/** メニュー：未送信をすべて送信 */
function sendAllPending() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET.INVOICE);
  const last = sh.getLastRow();
  if (last < 2) { SpreadsheetApp.getUi().alert('請求データがありません。'); return; }

  // 未送信（または空欄ステータス）かつ宛先ありの行を収集
  const statuses = sh.getRange(2, COL.STATUS, last - 1, 1).getValues();
  const emails = sh.getRange(2, COL.TO_EMAIL, last - 1, 1).getValues();
  const targets = [];
  statuses.forEach(function (s, i) {
    const st = String(s[0]).trim();
    const email = String(emails[i][0]).trim();
    if ((st === '' || st === STATUS.PENDING) && email) targets.push(i + 2);
  });

  if (targets.length === 0) {
    SpreadsheetApp.getUi().alert('送信対象（未送信）がありません。');
    return;
  }
  const allowBlank = targets.length === 1; // 1件だけなら空欄明細の自動紐付けを許可

  let ok = 0, ng = 0;
  const errors = [];
  targets.forEach(function (row) {
    try {
      const r = processRow_(sh, row, { mode: 'send', allowBlankItems: allowBlank });
      if (r.ok) { ok++; } else { ng++; errors.push('行' + row + ': ' + r.message); sh.getRange(row, COL.STATUS).setValue(STATUS.ERROR); }
    } catch (e) {
      ng++; errors.push('行' + row + ': ' + String(e.message || e));
      sh.getRange(row, COL.STATUS).setValue(STATUS.ERROR);
    }
  });

  SpreadsheetApp.getUi().alert(
    '一括送信 完了',
    '送信 ' + ok + ' 件 / 失敗 ' + ng + ' 件\n' + (errors.length ? '\n' + errors.join('\n') : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** メニュー：選択中の行をプレビュー（Gmail下書きに保存） */
function previewSelectedRow() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sh.getName() !== SHEET.INVOICE) {
    ui.alert('「' + SHEET.INVOICE + '」シートで行を選択してください。');
    return;
  }
  const row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('データ行（2行目以降）を選択してください。'); return; }
  try {
    const r = processRow_(sh, row, { mode: 'draft', allowBlankItems: true });
    ui.alert(r.ok ? '下書き作成' : 'エラー', r.message + '\nGmailの「下書き」を確認してください。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', String(e.message || e), ui.ButtonSet.OK);
  }
}

/** 時間トリガー本体：未送信を自動送信（UIを出さない） */
function autoSendPending() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET.INVOICE);
  const last = sh.getLastRow();
  if (last < 2) return;
  const statuses = sh.getRange(2, COL.STATUS, last - 1, 1).getValues();
  const emails = sh.getRange(2, COL.TO_EMAIL, last - 1, 1).getValues();
  const targets = [];
  statuses.forEach(function (s, i) {
    const st = String(s[0]).trim();
    const email = String(emails[i][0]).trim();
    if ((st === '' || st === STATUS.PENDING) && email) targets.push(i + 2);
  });
  const allowBlank = targets.length === 1;
  targets.forEach(function (row) {
    try {
      const r = processRow_(sh, row, { mode: 'send', allowBlankItems: allowBlank });
      if (!r.ok) sh.getRange(row, COL.STATUS).setValue(STATUS.ERROR);
    } catch (e) {
      sh.getRange(row, COL.STATUS).setValue(STATUS.ERROR);
      console.error('autoSendPending 行' + row + ': ' + (e.message || e));
    }
  });
}

/** メニュー：毎日9時に自動送信するトリガーを設置 */
function installDailyTrigger() {
  removeDailyTrigger();
  ScriptApp.newTrigger('autoSendPending')
    .timeBased().everyDays(1).atHour(9).create();
  SpreadsheetApp.getUi().alert('自動送信ON', '毎日9時ごろに「未送信」を自動送信します。', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** メニュー：自動送信トリガーを削除 */
function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoSendPending') ScriptApp.deleteTrigger(t);
  });
}
