/**
 * Invoice.gs
 * 請求データ（1行）＋明細から、金額を計算した請求書モデルを組み立て、
 * PDFを生成する。
 */

/**
 * 明細シートの全行を {row, number, name, qty, unit, rate} の配列で返す。
 */
function readAllItems_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.ITEM);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, ITEM_HEADERS.length).getValues();
  const defaultRate = Number(getConfig()['既定税率']) || 10;
  return values.map(function (r, i) {
    return {
      row: i + 2,
      number: String(r[ICOL.NUMBER - 1]).trim(),
      name: r[ICOL.NAME - 1],
      qty: Number(r[ICOL.QTY - 1]) || 0,
      unit: Number(r[ICOL.UNIT - 1]) || 0,
      rate: Number(r[ICOL.RATE - 1]) || defaultRate,
    };
  }).filter(function (it) { return it.name !== '' && it.name != null; });
}

/**
 * 指定請求番号に紐付く明細を集める。
 * allowBlank=true の場合、請求番号が空欄の明細行も対象にする（単発送信用）。
 */
function collectItems_(invoiceNumber, allowBlank) {
  const all = readAllItems_();
  return all.filter(function (it) {
    if (it.number === String(invoiceNumber)) return true;
    if (allowBlank && it.number === '') return true;
    return false;
  });
}

/**
 * 請求書モデルを組み立てる（金額計算込み）。
 * @param {Object} master  請求データ1行分 {number, issueDate, dueDate, toCompany, toPerson, toEmail, subject, note}
 * @param {Array}  items   明細配列
 */
function buildModel_(master, items) {
  const cfg = getConfig();

  const lines = items.map(function (it) {
    return {
      name: it.name,
      qty: it.qty,
      unit: it.unit,
      rate: it.rate,
      amount: Math.round(it.qty * it.unit),
    };
  });

  // 税率別に集計（消費税は税率ごとに切り捨て）
  const byRate = {};
  lines.forEach(function (l) {
    byRate[l.rate] = (byRate[l.rate] || 0) + l.amount;
  });
  const taxRows = Object.keys(byRate).sort(function (a, b) { return b - a; }).map(function (rate) {
    const base = byRate[rate];
    const tax = Math.floor(base * Number(rate) / 100);
    return { rate: Number(rate), base: base, tax: tax };
  });

  const subtotal = lines.reduce(function (s, l) { return s + l.amount; }, 0);
  const taxTotal = taxRows.reduce(function (s, t) { return s + t.tax; }, 0);
  const total = subtotal + taxTotal;

  return {
    // 発行者（自社）
    from: {
      company: cfg['自社会社名'] || '',
      address: cfg['自社住所'] || '',
      tel: cfg['自社電話'] || '',
      regNo: cfg['登録番号'] || '',
    },
    bank: {
      bank: cfg['振込先銀行'] || '',
      branch: cfg['振込先支店'] || '',
      type: cfg['口座種別'] || '',
      no: cfg['口座番号'] || '',
      holder: cfg['口座名義'] || '',
    },
    // 宛先・ヘッダ
    number: master.number,
    issueDate: master.issueDate,
    dueDate: master.dueDate,
    toCompany: master.toCompany,
    toPerson: master.toPerson,
    toEmail: master.toEmail,
    subject: master.subject,
    note: master.note,
    // 明細・金額
    lines: lines,
    taxRows: taxRows,
    subtotal: subtotal,
    taxTotal: taxTotal,
    total: total,
  };
}

/** 請求書のHTMLを生成 */
function renderInvoiceHtml_(m) {
  const lineRows = m.lines.map(function (l) {
    return '<tr>' +
      '<td class="l">' + esc(l.name) + '</td>' +
      '<td class="r">' + yen(l.qty) + '</td>' +
      '<td class="r">' + yen(l.unit) + '</td>' +
      '<td class="c">' + l.rate + '%</td>' +
      '<td class="r">' + yen(l.amount) + '</td>' +
      '</tr>';
  }).join('');

  const taxRows = m.taxRows.map(function (t) {
    return '<tr><td class="tl">' + t.rate + '% 対象</td><td class="tr">' +
      yen(t.base) + '</td></tr>' +
      '<tr><td class="tl">消費税（' + t.rate + '%）</td><td class="tr">' +
      yen(t.tax) + '</td></tr>';
  }).join('');

  const tpl = HtmlService.createTemplateFromFile('InvoiceTemplate');
  tpl.m = m;
  tpl.lineRows = lineRows;
  tpl.taxRows = taxRows;
  return tpl.evaluate().getContent();
}

/** HTMLからPDF Blobを生成 */
function createInvoicePdf_(m) {
  const html = renderInvoiceHtml_(m);
  const name = '請求書_' + (m.number || 'draft');
  const blob = Utilities.newBlob(html, MimeType.HTML, name + '.html').getAs(MimeType.PDF);
  blob.setName(name + '.pdf');
  return blob;
}

/** 設定でフォルダIDが指定されていればPDFをDriveに保存し、URLを返す（無ければ空文字） */
function archivePdf_(blob) {
  const cfg = getConfig();
  const folderId = String(cfg['PDF保存フォルダID'] || '').trim();
  if (!folderId) return '';
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(blob);
  return file.getUrl();
}
