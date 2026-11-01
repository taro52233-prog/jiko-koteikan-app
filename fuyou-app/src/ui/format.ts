export function yen(n: number): string {
  return Math.round(n).toLocaleString('ja-JP');
}

export function hoursText(h: number): string {
  return (Math.round(h * 10) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

/** 全角数字やカンマを含む入力を数値にする。空なら null */
export function parseNumber(s: string): number | null {
  const t = s
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s円]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
