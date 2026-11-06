/**
 * 使用シーン画像の生成（OpenAI gpt-image-1）。
 *
 * ■ 入力に楽天の商品画像を渡していない理由
 * 楽天アフィリエイトが提供する商品画像は、サイズ変更や周辺への装飾は認められる一方、
 * 画像そのものへの加工（切り取り・画像上への文字入れ・改変）は認められていない。
 * AI による変換は明確にこの「加工」にあたり、著作権法上も翻案の問題が出る。
 * さらに楽天ROOMのランクアップに効くとされる「オリジナル写真」は本人が撮影したものを指すので、
 * 他人の商品画像を AI で変換しても、そもそも目的を満たさない。
 *
 * そこでここでは **テキストプロンプトだけから、商品を写さない「生活シーン」を新規生成する**。
 * 他人の著作物を一切通さないので権利関係が完全にクリーンで、
 * 「ペインが解消された状態」を視覚で見せるという目的はそのまま達成できる。
 *
 * 生成物は実写ではないため、既定で「AI生成イメージ」の表示を焼き込む。
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { registerFonts, font } from './fonts.js';
import { drawImageCover, roundRect } from './draw.js';
import { fetchJson, log, warn } from '../util.js';

/** 商品・ロゴ・文字を描かせないための、プロンプト末尾に必ず足す制約 */
const HARD_CONSTRAINTS = [
  'Photographic, natural lighting, shallow depth of field.',
  'Do NOT render any product packaging, brand logo, trademark, or readable text of any kind.',
  'Do not show any human face; hands or feet only if a person is implied.',
  'No watermark, no signature, no UI elements.',
].join(' ');

/** LLM が出したプロンプトに紛れ込みがちな指示を落とす（商品名を描かせないため） */
export function buildScenePrompt(scenePrompt, { itemName = '' } = {}) {
  let base = String(scenePrompt || '').trim();
  // 商品名がそのまま入っていると、その商品を描こうとしてブランド性が出る
  if (itemName) {
    for (const token of itemName.split(/[\s　]+/).filter((t) => t.length >= 3)) {
      base = base.split(token).join('');
    }
  }
  base = base.replace(/\s{2,}/g, ' ').trim();
  if (!base) return null;
  return `${base} ${HARD_CONSTRAINTS}`;
}

/**
 * OpenAI の画像生成APIを叩いて JPEG/PNG のバッファを得る。
 * gpt-image-1 は URL ではなく base64 で返す。
 */
export async function requestSceneImage(prompt, cfg) {
  const body = {
    model: cfg.model,
    prompt,
    n: 1,
    size: cfg.size,
    quality: cfg.quality,
    output_format: 'jpeg',
  };

  const res = await fetchJson(`${cfg.baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: 180000,   // 画像生成は数十秒かかることがある
  }, { label: 'openai-images', retries: 2, baseDelay: 3000 });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`画像が返りませんでした: ${JSON.stringify(res).slice(0, 300)}`);
  return Buffer.from(b64, 'base64');
}

/** 生成画像を目的の比率に整え、AI生成である旨の表示を焼き込む */
async function finish(buffer, { width, height, label, labelText }) {
  const img = await loadImage(buffer);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  // 自分で生成した画像なので、比率合わせのトリミングは自由に行える
  drawImageCover(ctx, img, 0, 0, width, height);

  if (label) {
    registerFonts({});
    const size = Math.round(height * 0.019);
    ctx.font = font(size, 'regular');
    const w = ctx.measureText(labelText).width + size * 1.6;
    const h = size * 2.1;
    const x = width - w - size * 1.4;
    const y = height - h - size * 1.4;
    ctx.fillStyle = 'rgba(15,23,42,0.55)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.textAlign = 'center';
    ctx.fillText(labelText, x + w / 2, y + (h - size) / 2 + 1);
    ctx.textAlign = 'left';
  }

  return canvas.encode('jpeg', 88);
}

/**
 * 使用シーン画像を生成する。
 * 失敗しても投稿全体は止めない（呼び出し側で null を許容する）。
 *
 * @param {string} scenePrompt Claude が設計した英語プロンプト
 * @param {object} sceneCfg    config.scene
 * @param {object} out         { width, height } 出力サイズ
 * @returns {Promise<Buffer|null>}
 */
export async function generateSceneImage(scenePrompt, sceneCfg, { width, height, itemName } = {}) {
  if (!sceneCfg.enabled) return null;
  if (!sceneCfg.apiKey) { warn('OPENAI_API_KEY が未設定のためシーン画像を生成しません'); return null; }

  const prompt = buildScenePrompt(scenePrompt, { itemName });
  if (!prompt) { warn('シーン画像のプロンプトが空のため生成しません'); return null; }

  try {
    log(`シーン画像を生成中 (${sceneCfg.model} ${sceneCfg.size} ${sceneCfg.quality})`);
    const raw = await requestSceneImage(prompt, sceneCfg);
    return await finish(raw, {
      width: width ?? 1080,
      height: height ?? 1350,
      label: sceneCfg.label,
      labelText: sceneCfg.labelText,
    });
  } catch (e) {
    warn(`シーン画像の生成に失敗（商品画像で代替します）: ${e.message}`);
    return null;
  }
}
