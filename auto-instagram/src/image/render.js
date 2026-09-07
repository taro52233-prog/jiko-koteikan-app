/**
 * カルーセル画像の生成。1080x1350 (4:5) は Instagram フィードで最も面積を取れる比率。
 * テンプレは「表紙 / 訴求 / CTA」の3種類だけに絞り、統一感を優先している。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { registerFonts, font } from './fonts.js';
import { drawParagraph, roundRect, drawImageCover, drawImageContain, verticalGradient, wrapText } from './draw.js';
import { fetchBuffer, log, warn } from '../util.js';

const INK = '#0F172A';
const MUTED = '#64748B';

function newCanvas(cfg) {
  const canvas = createCanvas(cfg.width, cfg.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, cfg.width, cfg.height);
  ctx.textBaseline = 'top';
  return { canvas, ctx };
}

/** ステマ規制対応: 画像そのものにも PR 表記を焼き込む（本文だけだと見落とされる） */
function drawPrBadge(ctx, cfg, { dark = false } = {}) {
  const label = 'PR';
  ctx.font = font(30, 'bold');
  const w = ctx.measureText(label).width + 40;
  const x = cfg.width - w - 44;
  const y = 44;
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.82)';
  roundRect(ctx, x, y, w, 52, 26);
  ctx.fill();
  ctx.fillStyle = dark ? INK : '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + 9);
  ctx.textAlign = 'left';
}

function drawPill(ctx, text, x, y, { bg, fg, size = 30, padX = 24, h = 56 }) {
  ctx.font = font(size, 'bold');
  const w = ctx.measureText(text).width + padX * 2;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, y + (h - size) / 2 + 2);
  return w;
}

/** 1枚目: 商品写真を全面に敷き、下部グラデーションの上に見出しを置く */
function renderCover(cfg, { hook, item, image }) {
  const { canvas, ctx } = newCanvas(cfg);
  const W = cfg.width, H = cfg.height;

  if (image) drawImageCover(ctx, image, 0, 0, W, H);
  else verticalGradient(ctx, 0, 0, W, H, [[0, cfg.accent], [1, cfg.accent2]]);

  // 見出しの可読性を担保する暗幕
  verticalGradient(ctx, 0, H * 0.32, W, H * 0.68, [
    [0, 'rgba(6,15,35,0)'], [0.45, 'rgba(6,15,35,0.72)'], [1, 'rgba(6,15,35,0.94)'],
  ]);
  verticalGradient(ctx, 0, 0, W, 260, [[0, 'rgba(6,15,35,0.55)'], [1, 'rgba(6,15,35,0)']]);

  drawPrBadge(ctx, cfg, { dark: true });

  // レビュー実績のバッジ（実データのみ）
  let bx = 68;
  bx += drawPill(ctx, `★ ${item.reviewAverage.toFixed(2)}`, bx, 56,
    { bg: 'rgba(255,255,255,0.94)', fg: INK }) + 14;
  drawPill(ctx, `レビュー${item.reviewCount.toLocaleString('ja-JP')}件`, bx, 56,
    { bg: 'rgba(255,255,255,0.20)', fg: '#FFFFFF' });

  // 大見出し
  ctx.font = font(88, 'bold');
  const titleLines = wrapText(ctx, hook.title, W - 136, 3);
  const titleH = titleLines.length * 108;
  ctx.font = font(38, 'regular');
  const subLines = wrapText(ctx, hook.sub, W - 136, 2);
  const subH = subLines.length * 54;

  const blockTop = H - 150 - titleH - subH - 40;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(88, 'bold');
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 18;
  titleLines.forEach((l, i) => ctx.fillText(l, 68, blockTop + i * 108));
  ctx.shadowBlur = 0;

  ctx.font = font(38, 'regular');
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  subLines.forEach((l, i) => ctx.fillText(l, 68, blockTop + titleH + 24 + i * 54));

  // 価格
  const price = `${item.price.toLocaleString('ja-JP')}円`;
  ctx.font = font(30, 'regular');
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('投稿時点', 68, H - 118);
  ctx.font = font(56, 'bold');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(price, 68, H - 84);

  // スワイプ導線
  ctx.font = font(30, 'bold');
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('スワイプ →', W - 68, H - 74);
  ctx.textAlign = 'left';

  return canvas;
}

/** 中間: 上に商品写真、下に1メッセージ */
function renderBody(cfg, { slide, index, total, image }) {
  const { canvas, ctx } = newCanvas(cfg);
  const W = cfg.width, H = cfg.height;
  const imgH = Math.round(H * 0.52);

  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(0, 0, W, imgH);
  if (image) drawImageContain(ctx, image, 40, 40, W - 80, imgH - 80);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, imgH, W, H - imgH);

  // 番号バッジ
  ctx.fillStyle = cfg.accent;
  roundRect(ctx, 68, imgH - 44, 96, 88, 20);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(46, 'bold');
  ctx.textAlign = 'center';
  ctx.fillText(String(index).padStart(2, '0'), 68 + 48, imgH - 44 + 20);
  ctx.textAlign = 'left';

  // テキスト量に関わらず余白が均等になるよう、下半分の中央に寄せる
  ctx.font = font(62, 'bold');
  const titleH = wrapText(ctx, slide.title, W - 136, 2).length * 80;
  ctx.font = font(38, 'regular');
  const bodyH = wrapText(ctx, slide.body, W - 136, 5).length * 58;
  const gap = 28;
  const textTop = imgH + 84 + Math.max(0, ((H - imgH - 84 - 110) - (titleH + gap + bodyH)) / 2);

  let y = textTop;
  ctx.fillStyle = INK;
  ctx.font = font(62, 'bold');
  y += drawParagraph(ctx, slide.title, { x: 68, y, maxWidth: W - 136, lineHeight: 80, maxLines: 2 });

  y += gap;
  ctx.fillStyle = '#334155';
  ctx.font = font(38, 'regular');
  drawParagraph(ctx, slide.body, { x: 68, y, maxWidth: W - 136, lineHeight: 58, maxLines: 5 });

  // ページャ
  ctx.fillStyle = MUTED;
  ctx.font = font(28, 'regular');
  ctx.textAlign = 'right';
  ctx.fillText(`${index} / ${total}`, W - 68, H - 68);
  ctx.textAlign = 'left';

  return canvas;
}

/** 最終: 行動導線 */
function renderCta(cfg, { cta, item, image }) {
  const { canvas, ctx } = newCanvas(cfg);
  const W = cfg.width, H = cfg.height;

  verticalGradient(ctx, 0, 0, W, H, [[0, cfg.accent], [1, '#0B1F4B']]);
  drawPrBadge(ctx, cfg, { dark: true });

  // 商品サムネイル（角丸）
  const box = 420;
  const bx = (W - box) / 2;
  const by = 190;
  ctx.save();
  roundRect(ctx, bx, by, box, box, 40);
  ctx.clip();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(bx, by, box, box);
  if (image) drawImageContain(ctx, image, bx + 24, by + 24, box - 48, box - 48);
  ctx.restore();

  let y = by + box + 80;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(66, 'bold');
  ctx.textAlign = 'center';
  y += drawParagraph(ctx, cta.title, { x: W / 2, y, maxWidth: W - 140, lineHeight: 86, maxLines: 2, align: 'center' });

  y += 24;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = font(36, 'regular');
  drawParagraph(ctx, cta.body, { x: W / 2, y, maxWidth: W - 160, lineHeight: 54, maxLines: 3, align: 'center' });

  // 保存導線
  const label = '🔖 保存して後で見返す';
  ctx.font = font(34, 'bold');
  const pw = ctx.measureText(label).width + 72;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, (W - pw) / 2, H - 178, pw, 76, 38);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, W / 2, H - 178 + 21);

  ctx.font = font(26, 'regular');
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.fillText('価格・在庫は投稿時点のものです', W / 2, H - 78);
  ctx.textAlign = 'left';

  return canvas;
}

/** 商品画像を先読みする。落とせなくても投稿自体は止めない */
async function preloadImages(urls, need) {
  const images = [];
  for (const url of urls) {
    if (images.length >= need) break;
    try {
      images.push(await loadImage(await fetchBuffer(url, { label: '商品画像' })));
    } catch (e) {
      warn(`商品画像の取得に失敗: ${url} (${e.message})`);
    }
  }
  return images;
}

/**
 * カルーセル一式を JPEG で書き出す。
 * @returns {Promise<{files:string[], slug:string}>}
 */
export async function renderCarousel({ item, content, cfg, outDir, slug }) {
  registerFonts(cfg);
  const total = 2 + content.slides.length;
  const images = await preloadImages(item.images, Math.min(4, total));
  if (!images.length) throw new Error('商品画像を1枚も取得できませんでした（投稿を中止します）');

  const dir = path.join(outDir, slug);
  fs.mkdirSync(dir, { recursive: true });

  const canvases = [
    renderCover(cfg, { hook: content.hook, item, image: images[0] }),
    ...content.slides.map((slide, i) =>
      renderBody(cfg, { slide, index: i + 2, total, image: images[(i + 1) % images.length] })),
    renderCta(cfg, { cta: content.cta, item, image: images[0] }),
  ];

  const files = [];
  for (const [i, canvas] of canvases.entries()) {
    // Instagram は JPEG を推奨（PNG は再圧縮で劣化しやすい）。品質88で概ね300KB前後。
    const buf = await canvas.encode('jpeg', 88);
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')}.jpg`);
    fs.writeFileSync(file, buf);
    files.push(file);
  }
  log(`画像を${files.length}枚生成: ${dir}`);
  return { files, dir, slug };
}
