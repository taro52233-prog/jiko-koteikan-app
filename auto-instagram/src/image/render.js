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

/**
 * 1枚目（表紙）。
 *
 * 楽天アフィリエイトが提供する商品画像は、サイズ変更や周辺への装飾は認められる一方、
 * 画像そのものの切り取りや、画像の上に直接文字を載せることは認められていない。
 * そのため表紙は3段構成にして、**文字は必ず商品画像の外**に置いている。
 *   上段: シーン画像（自前生成）または単色グラデ ＋ 見出し   ← 文字を載せてよい領域
 *   中段: 商品画像を contain で配置（無加工・無文字）
 *   下段: 価格・レビュー・スワイプ導線
 */
function renderCover(cfg, { hook, item, image, scene }) {
  const { canvas, ctx } = newCanvas(cfg);
  const W = cfg.width, H = cfg.height;
  const HEAD_H = Math.round(H * 0.415);   // 上段（見出し）
  const FOOT_H = Math.round(H * 0.20);    // 下段（価格）
  const PROD_TOP = HEAD_H;
  const PROD_H = H - HEAD_H - FOOT_H;

  // ---- 上段: シーン画像 or グラデーション ----
  if (scene) drawImageCover(ctx, scene, 0, 0, W, HEAD_H);
  else verticalGradient(ctx, 0, 0, W, HEAD_H, [[0, cfg.accent], [1, cfg.accent2]]);

  // 見出しの可読性を担保する暗幕（自前画像の上なので問題ない）
  verticalGradient(ctx, 0, 0, W, HEAD_H, [
    [0, 'rgba(6,15,35,0.62)'], [0.4, 'rgba(6,15,35,0.42)'], [1, 'rgba(6,15,35,0.86)'],
  ]);

  drawPrBadge(ctx, cfg, { dark: true });

  // レビュー実績のバッジ（実データのみ）
  let bx = 68;
  bx += drawPill(ctx, `★ ${item.reviewAverage.toFixed(2)}`, bx, 44,
    { bg: 'rgba(255,255,255,0.94)', fg: INK }) + 14;
  drawPill(ctx, `レビュー${item.reviewCount.toLocaleString('ja-JP')}件`, bx, 44,
    { bg: 'rgba(255,255,255,0.22)', fg: '#FFFFFF' });

  ctx.font = font(76, 'bold');
  const titleLines = wrapText(ctx, hook.title, W - 136, 3);
  ctx.font = font(34, 'regular');
  const subLines = wrapText(ctx, hook.sub, W - 136, 2);

  const blockH = titleLines.length * 94 + 20 + subLines.length * 48;
  const blockTop = HEAD_H - 52 - blockH;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(76, 'bold');
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 16;
  titleLines.forEach((l, i) => ctx.fillText(l, 68, blockTop + i * 94));
  ctx.shadowBlur = 0;

  ctx.font = font(34, 'regular');
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  subLines.forEach((l, i) => ctx.fillText(l, 68, blockTop + titleLines.length * 94 + 20 + i * 48));

  // ---- 中段: 商品画像（切り取らず、文字も載せない） ----
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, PROD_TOP, W, PROD_H);
  if (image) drawImageContain(ctx, image, 56, PROD_TOP + 32, W - 112, PROD_H - 64);

  // ---- 下段: 価格・導線 ----
  const footTop = PROD_TOP + PROD_H;
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, footTop, W, FOOT_H);
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(0, footTop, W, 2);

  ctx.font = font(26, 'regular');
  ctx.fillStyle = MUTED;
  ctx.fillText('投稿時点の価格', 68, footTop + 52);

  ctx.font = font(58, 'bold');
  ctx.fillStyle = INK;
  ctx.fillText(`${item.price.toLocaleString('ja-JP')}円`, 68, footTop + 92);

  ctx.font = font(30, 'bold');
  ctx.textAlign = 'right';
  ctx.fillStyle = cfg.accent;
  ctx.fillText('スワイプ →', W - 68, footTop + 106);
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

  // 番号バッジ。商品画像は 40..imgH-40 に収まるので、その外側に置く
  // （楽天提供画像の上に装飾を載せないため）
  ctx.fillStyle = cfg.accent;
  roundRect(ctx, 68, imgH - 20, 96, 88, 20);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(46, 'bold');
  ctx.textAlign = 'center';
  ctx.fillText(String(index).padStart(2, '0'), 68 + 48, imgH - 20 + 20);
  ctx.textAlign = 'left';

  // テキスト量に関わらず余白が均等になるよう、下半分の中央に寄せる
  ctx.font = font(62, 'bold');
  const titleH = wrapText(ctx, slide.title, W - 136, 2).length * 80;
  ctx.font = font(38, 'regular');
  const bodyH = wrapText(ctx, slide.body, W - 136, 5).length * 58;
  const gap = 28;
  const textTop = imgH + 108 + Math.max(0, ((H - imgH - 84 - 110) - (titleH + gap + bodyH)) / 2);

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
export async function renderCarousel({ item, content, cfg, outDir, slug, sceneBuffer = null }) {
  registerFonts(cfg);
  const total = 2 + content.slides.length;
  const images = await preloadImages(item.images, Math.min(4, total));
  if (!images.length) throw new Error('商品画像を1枚も取得できませんでした（投稿を中止します）');

  const dir = path.join(outDir, slug);
  fs.mkdirSync(dir, { recursive: true });

  // シーン画像は自前生成なので、その上に見出しを重ねてよい
  let scene = null;
  if (sceneBuffer) {
    try { scene = await loadImage(sceneBuffer); }
    catch (e) { warn(`シーン画像の読み込みに失敗（グラデーションで代替）: ${e.message}`); }
  }

  const canvases = [
    renderCover(cfg, { hook: content.hook, item, image: images[0], scene }),
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
