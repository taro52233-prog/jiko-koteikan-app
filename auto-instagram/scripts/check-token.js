#!/usr/bin/env node
/**
 * アクセストークンの残り寿命を確認し、期限が近ければ非ゼロ終了する。
 * 自動投稿が「ある日突然、無言で止まる」最大の原因がトークン失効なので、
 * 定期ワークフローから叩いて Issue を立てる運用にしている。
 */
import { config } from '../src/config.js';
import { inspectToken } from '../src/publish/instagram.js';

const WARN_DAYS = Number(process.env.TOKEN_WARN_DAYS || 14);

const t = await inspectToken(config.instagram);
if (!t) {
  console.error('META_APP_ID / META_APP_SECRET が未設定のため確認できません');
  process.exit(2);
}
console.log(`valid=${t.valid} daysLeft=${t.daysLeft === Infinity ? '無期限' : t.daysLeft} scopes=${t.scopes.join(',')}`);

if (!t.valid) { console.error('❌ トークンが無効です。再取得してください'); process.exit(1); }
if (t.daysLeft < WARN_DAYS) {
  console.error(`⚠️ トークンの残り日数が ${t.daysLeft} 日です。npm run token:exchange で延長してください`);
  process.exit(1);
}
console.log('✅ トークンは有効です');
