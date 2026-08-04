/**
 * Mailer.gs
 * 請求書PDFを添付してGmailで送信する（および下書き保存）。
 */

/** モデルからメールの件名・本文を組み立てる */
function composeMail_(m) {
  const cfg = getConfig();
  const map = {
    '請求番号': m.number,
    '件名': m.subject,
    '宛先会社': m.toCompany,
    '宛先担当者': m.toPerson,
    '支払期限': formatDateJp(m.dueDate),
    '合計': yen(m.total),
    '自社会社名': m.from.company,
    '自社住所': m.from.address,
    '自社電話': m.from.tel,
  };
  const subject = fillTemplate(cfg['メール件名テンプレート'] || '請求書 {{請求番号}}', map);
  const body = fillTemplate(cfg['メール本文テンプレート'] || '請求書をお送りします。', map);
  return { subject: subject, body: body };
}

/** 送信オプション（BCC控え・送信者表示名）を組み立てる */
function mailOptions_(pdf) {
  const cfg = getConfig();
  const opts = { attachments: [pdf] };
  const name = String(cfg['送信元表示名'] || '').trim();
  if (name) opts.name = name;
  const bcc = String(cfg['控えBCC'] || '').trim();
  if (bcc) opts.bcc = bcc;
  return opts;
}

/**
 * 実際に送信する。
 * @param {Object} m   請求書モデル
 * @param {Blob}   pdf 添付PDF
 */
function sendInvoiceMail_(m, pdf) {
  if (!m.toEmail) throw new Error('宛先メールアドレスが空です（請求番号 ' + m.number + '）。');
  const mail = composeMail_(m);
  const opts = mailOptions_(pdf);
  opts.htmlBody = mail.body.replace(/\n/g, '<br>');
  GmailApp.sendEmail(m.toEmail, mail.subject, mail.body, opts);
}

/** 送信せずGmailの下書きに保存する（プレビュー用） */
function draftInvoiceMail_(m, pdf) {
  const mail = composeMail_(m);
  const opts = mailOptions_(pdf);
  opts.htmlBody = mail.body.replace(/\n/g, '<br>');
  GmailApp.createDraft(m.toEmail || '', mail.subject, mail.body, opts);
}
