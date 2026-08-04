/**
 * Setup.gs
 * メニュー登録と初期セットアップ（シート・サンプルデータ作成）。
 */

/** スプレッドシートを開いたときにカスタムメニューを追加 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📄 請求書')
    .addItem('① 初期セットアップ', 'setupSheets')
    .addSeparator()
    .addItem('▶ 選択中の行を送信', 'sendSelectedRow')
    .addItem('▶ 未送信をすべて送信', 'sendAllPending')
    .addItem('👁 選択中の行をプレビュー（下書き保存）', 'previewSelectedRow')
    .addSeparator()
    .addItem('⏰ 毎日の自動送信をON', 'installDailyTrigger')
    .addItem('⏰ 自動送信をOFF', 'removeDailyTrigger')
    .addToUi();
}

/**
 * 必要なシートを作成し、ヘッダとサンプルデータを投入する。
 * 何度実行しても既存データは壊さない（無ければ作るだけ）。
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 設定シート
  let cfg = ss.getSheetByName(SHEET.CONFIG);
  if (!cfg) {
    cfg = ss.insertSheet(SHEET.CONFIG);
    cfg.getRange(1, 1, 1, 2).setValues([['項目', '値']])
      .setFontWeight('bold').setBackground('#1E3A8A').setFontColor('#ffffff');
    cfg.getRange(2, 1, CONFIG_DEFAULTS.length, 2).setValues(CONFIG_DEFAULTS);
    cfg.setColumnWidth(1, 200);
    cfg.setColumnWidth(2, 460);
    cfg.setFrozenRows(1);
  }

  // 請求データシート
  let inv = ss.getSheetByName(SHEET.INVOICE);
  if (!inv) {
    inv = ss.insertSheet(SHEET.INVOICE);
    inv.getRange(1, 1, 1, INVOICE_HEADERS.length).setValues([INVOICE_HEADERS])
      .setFontWeight('bold').setBackground('#2563EB').setFontColor('#ffffff');
    inv.setFrozenRows(1);
    // 見やすい幅
    const widths = [110, 100, 100, 160, 120, 220, 200, 200, 80, 150, 220];
    widths.forEach(function (w, i) { inv.setColumnWidth(i + 1, w); });
    // 日付列の書式
    inv.getRange(2, COL.ISSUE_DATE, inv.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd');
    inv.getRange(2, COL.DUE_DATE, inv.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd');
    // サンプル1件
    const today = new Date();
    const due = new Date(today.getTime());
    due.setMonth(due.getMonth() + 1);
    inv.getRange(2, 1, 1, INVOICE_HEADERS.length).setValues([[
      '', today, due, '株式会社取引先', '山田 太郎', 'test@example.com',
      '〇〇制作業務', '毎度ありがとうございます。', STATUS.PENDING, '', '',
    ]]);
    // ステータスのプルダウン
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.PENDING, STATUS.SENT, STATUS.ERROR], true).build();
    inv.getRange(2, COL.STATUS, inv.getMaxRows() - 1, 1).setDataValidation(rule);
  }

  // 明細シート
  let item = ss.getSheetByName(SHEET.ITEM);
  if (!item) {
    item = ss.insertSheet(SHEET.ITEM);
    item.getRange(1, 1, 1, ITEM_HEADERS.length).setValues([ITEM_HEADERS])
      .setFontWeight('bold').setBackground('#0EA5E9').setFontColor('#ffffff');
    item.setFrozenRows(1);
    const widths = [110, 300, 80, 120, 80];
    widths.forEach(function (w, i) { item.setColumnWidth(i + 1, w); });
    // サンプル明細（サンプル請求と同じ番号は自動採番後に振られるため、ここでは空番号=最初の1件に紐付く運用例を記載）
    item.getRange(2, 1, 2, ITEM_HEADERS.length).setValues([
      ['', 'Webサイト デザイン', 1, 200000, 10],
      ['', '保守サポート（月額）', 1, 30000, 10],
    ]);
    // 税率のプルダウン
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['10', '8'], true).build();
    item.getRange(2, ICOL.RATE, item.getMaxRows() - 1, 1).setDataValidation(rule);
  }

  SpreadsheetApp.getUi().alert(
    'セットアップ完了',
    '「設定」シートに自社情報・振込先を入力してください。\n' +
    '「請求データ」に1行＝1請求、「明細」に品目を入力します。\n' +
    '明細は請求番号で紐付けます（請求番号が空の請求は送信時に自動採番され、\n' +
    '同じく請求番号が空の明細行がその請求に紐付きます）。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
