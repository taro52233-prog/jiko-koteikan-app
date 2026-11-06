/**
 * 描画プリミティブ。
 * 日本語は単語境界(空白)が無いので、英語前提の折り返しロジックは使えない。
 * ここでは1文字ずつ計測して折り返し、禁則処理も最低限入れる。
 */

/** 行頭に来てはいけない文字 */
const NO_LINE_START = '、。，．・：；？！ゝゞーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎ）］｝」』】〉》〕>)]}」';
/** 行末に来てはいけない文字 */
const NO_LINE_END = '（［｛「『【〈《〔<([{「';

/** CJK対応の折り返し。maxLines を超える分は末尾を「…」に丸める。 */
export function wrapText(ctx, text, maxWidth, maxLines = Infinity) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }
    let line = '';
    for (const ch of paragraph) {
      const next = line + ch;
      if (ctx.measureText(next).width <= maxWidth || line === '') {
        line = next;
        continue;
      }
      // 禁則: 次の文字が行頭禁止なら、無理やり今の行に押し込む
      if (NO_LINE_START.includes(ch)) { lines.push(next); line = ''; continue; }
      // 禁則: 行末禁止文字で終わるなら、その1文字を次の行へ送る
      if (NO_LINE_END.includes(line.at(-1))) {
        lines.push(line.slice(0, -1));
        line = line.at(-1) + ch;
        continue;
      }
      lines.push(line);
      line = ch;
    }
    if (line) lines.push(line);
  }

  if (lines.length <= maxLines) return lines;
  const clipped = lines.slice(0, maxLines);
  clipped[maxLines - 1] = `${clipped[maxLines - 1].slice(0, -1)}…`;
  return clipped;
}

/** 折り返して描画し、消費した高さを返す */
export function drawParagraph(ctx, text, { x, y, maxWidth, lineHeight, maxLines = Infinity, align = 'left' }) {
  const lines = wrapText(ctx, text, maxWidth, maxLines);
  ctx.textAlign = align;
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return lines.length * lineHeight;
}

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** object-fit: cover 相当。商品画像の縦横比を壊さずに枠を埋める */
export function drawImageCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** object-fit: contain 相当。商品全体を見せたいときはこちら */
export function drawImageContain(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export function verticalGradient(ctx, x, y, w, h, stops) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}
