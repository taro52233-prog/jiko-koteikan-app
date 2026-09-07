#!/usr/bin/env node
/**
 * 短期トークン → 長期トークン（60日）への交換、および長期トークンの延長。
 *
 *   SHORT_LIVED_TOKEN=xxx node scripts/exchange-token.js
 *
 * 出力された値を GitHub Secrets の IG_ACCESS_TOKEN に貼り直す。
 * （Secrets の自動更新には別途 PAT が要るため、ここでは意図的に手動にしている）
 */
import { config } from '../src/config.js';
import { fetchJson } from '../src/util.js';

const { graphHost, graphVersion, appId, appSecret, accessToken } = config.instagram;
const input = process.env.SHORT_LIVED_TOKEN || accessToken;

if (!appId || !appSecret) { console.error('META_APP_ID と META_APP_SECRET が必要です'); process.exit(1); }
if (!input) { console.error('SHORT_LIVED_TOKEN もしくは IG_ACCESS_TOKEN が必要です'); process.exit(1); }

const origin = graphHost.includes('://') ? graphHost : `https://${graphHost}`;
const url = `${origin}/${graphVersion}/oauth/access_token?` + new URLSearchParams({
  grant_type: 'fb_exchange_token',
  client_id: appId,
  client_secret: appSecret,
  fb_exchange_token: input,
});

const r = await fetchJson(url, {}, { label: 'exchange-token' });
console.log('\n=== 長期アクセストークン ===\n');
console.log(r.access_token);
console.log(`\n有効期間: ${r.expires_in ? `${Math.floor(r.expires_in / 86400)}日` : '無期限（ページトークン）'}`);
console.log('\nGitHub Secrets の IG_ACCESS_TOKEN を上記の値に更新してください。\n');
