/**
 * Util.gs
 * 小さな共通ユーティリティ。
 */

/** 3桁区切りの金額文字列（例: 1234567 -> "1,234,567"） */
function yen(n) {
  const num = Math.round(Number(n) || 0);
  const sign = num < 0 ? '-' : '';
  const s = String(Math.abs(num));
  return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 日付を「yyyy年M月d日」で。Dateでなければ文字列としてそのまま返す */
function formatDateJp(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy年M月d日');
  }
  return value ? String(value) : '';
}

/** 「yyyy/MM/dd HH:mm」形式（送信日時などの記録用） */
function nowStamp() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

/** HTMLエスケープ */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** {{key}} をmapの値で置換する簡易テンプレート */
function fillTemplate(tpl, map) {
  return String(tpl).replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (_, key) {
    return (map[key] != null) ? String(map[key]) : '';
  });
}
