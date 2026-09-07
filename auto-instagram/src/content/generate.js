/**
 * Claude API による投稿コピー生成。
 * tool_choice で出力形式を強制し、パース失敗のリトライ地獄を避ける。
 */
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildUserPrompt, buildSchema } from './prompt.js';
import { log, warn } from '../util.js';

/** 生成物の最終検品。LLM は指示を破ることがあるので機械側で必ず縛る。 */
export function sanitize(draft, { item, maxHashtags, disclosureRequired, disclosureText }) {
  const out = structuredClone(draft);

  // 1. 禁止表現の機械的な除去（プロンプトだけに頼らない）
  const banned = /(必ず痩せ|絶対に治|完治|日本一|世界一|業界No\.?1|最安値保証)/g;
  const strip = (s) => String(s || '').replace(banned, '').replace(/\s{2,}/g, ' ').trim();
  out.hook.title = strip(out.hook.title);
  out.hook.sub = strip(out.hook.sub);
  out.slides = out.slides.map((s) => ({ title: strip(s.title), body: strip(s.body) }));
  out.cta = { title: strip(out.cta.title), body: strip(out.cta.body) };
  out.caption = strip(out.caption);

  // 2. ハッシュタグの正規化（Instagram の上限は30個）
  const seen = new Set();
  out.hashtags = (out.hashtags || [])
    .map((t) => `#${String(t).replace(/^#+/, '').replace(/[\s#]/g, '')}`)
    .filter((t) => t.length > 1 && !seen.has(t) && seen.add(t))
    .slice(0, Math.min(30, maxHashtags));

  // 3. ステマ規制（景品表示法）対応。アフィリエイト運用では表示が法的に必須。
  //    LLM に任せず、必ず本文の先頭に固定で差し込む。
  if (disclosureRequired && !out.caption.includes(disclosureText)) {
    out.caption = `${disclosureText}\n\n${out.caption}`;
  }

  // 4. 価格の食い違いを検出（LLM が数字を書き換えていないか）
  const priceStr = item.price.toLocaleString('ja-JP');
  const priceMentions = out.caption.match(/[\d,]{3,}\s*円/g) || [];
  const bogus = priceMentions.filter((m) => !m.includes(priceStr));
  if (bogus.length) warn(`本文に商品データと一致しない価格表記があります: ${bogus.join(', ')}`);

  // 5. Instagram の本文上限は 2200 文字。ハッシュタグ込みで収める。
  const tagBlock = out.hashtags.join(' ');
  const budget = 2200 - tagBlock.length - 4;
  if (out.caption.length > budget) out.caption = `${out.caption.slice(0, budget - 1)}…`;
  out.fullCaption = `${out.caption}\n\n${tagBlock}`;

  out.altText = String(out.altText || `${item.name} の商品紹介画像`).slice(0, 100);
  return out;
}

export async function generateContent(item, cfg) {
  const client = new Anthropic({
    apiKey: cfg.anthropicApiKey,
    // ANTHROPIC_BASE_URL があればそちらへ向ける（テスト・ゲートウェイ経由用）
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });
  const schema = buildSchema(cfg.slides);

  const message = await client.messages.create({
    model: cfg.model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'submit_post',
      description: 'Instagram カルーセル投稿の原稿を提出する',
      input_schema: schema,
    }],
    tool_choice: { type: 'tool', name: 'submit_post' },
    messages: [{
      role: 'user',
      content: buildUserPrompt({
        item,
        persona: cfg.persona,
        slides: cfg.slides,
        maxHashtags: cfg.maxHashtags,
      }),
    }],
  });

  const toolUse = message.content.find((c) => c.type === 'tool_use');
  if (!toolUse) throw new Error('Claude が構造化出力を返しませんでした');

  log(`コピー生成完了 (in=${message.usage.input_tokens} out=${message.usage.output_tokens} tokens)`);
  return sanitize(toolUse.input, {
    item,
    maxHashtags: cfg.maxHashtags,
    disclosureRequired: cfg.disclosureRequired,
    disclosureText: cfg.disclosureText,
  });
}
