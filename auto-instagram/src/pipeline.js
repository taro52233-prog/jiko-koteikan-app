/**
 * パイプライン本体。
 *
 *   build   : リサーチ → 選定 → コピー生成 → 画像生成 → キュー投入(+承認Issue)
 *   publish : キューから「承認済み かつ 予定時刻到来」を取り出して Instagram へ公開
 *
 * build と publish の間に「コミット & プッシュ → GitHub Pages 反映」が挟まる。
 * Instagram は公開URLの画像しか取り込めないため、この分割は仕様上の必然。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, requireConfig } from './config.js';
import { collectCandidates } from './research/rakuten.js';
import { selectItems } from './research/score.js';
import { generateContent } from './content/generate.js';
import { renderCarousel } from './image/render.js';
import { History } from './store/history.js';
import { Queue } from './store/queue.js';
import { InstagramClient } from './publish/instagram.js';
import { openReviewIssue, fetchApprovedIssueNumbers, closeIssue, reportFailure } from './publish/review.js';
import { jstStamp, log, warn, sleep } from './util.js';

const slugify = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);

/** ===================== build ===================== */
export async function build({ dryRun = false, count = 1 } = {}) {
  requireConfig(dryRun ? 'research' : 'run');

  const history = History.load(config.paths.history);
  const queue = Queue.load(config.paths.queue);

  const pending = queue.byStatus('pending').length + queue.byStatus('approved').length;
  if (pending >= config.limits.maxPostsPerDay * 3) {
    log(`未公開の在庫が ${pending} 件あるため生成をスキップします`);
    return { skipped: true, reason: 'queue-full' };
  }

  log('候補商品を収集中...');
  const pool = await collectCandidates(config.research);
  log(`候補 ${pool.length} 件`);
  if (!pool.length) throw new Error('候補商品が0件でした。RESEARCH_KEYWORDS / RESEARCH_GENRE_IDS を確認してください');

  const { picked, rejected } = selectItems(pool, config.research, history, count);
  log(`選定 ${picked.length} 件 / 除外 ${rejected.length} 件`);
  if (!picked.length) {
    log('条件を満たす新しい商品がありませんでした（絞り込み条件を緩めるか、キーワードを増やしてください）');
    return { skipped: true, reason: 'no-candidate' };
  }

  const results = [];
  for (const item of picked) {
    const slug = `${jstStamp()}-${slugify(item.id)}`;
    try {
      log(`▶ ${item.name} (score=${item.score})`);

      const content = await generateContent(item, config.content);
      const { files } = await renderCarousel({
        item, content, cfg: config.image, outDir: config.paths.publicDir, slug,
      });

      const relPaths = files.map((f) => path.relative(config.paths.publicDir, f).split(path.sep).join('/'));
      const imageUrls = relPaths.map((r) => `${config.publicBaseUrl}/${r}`);

      const entry = {
        slug,
        itemId: item.id,
        status: dryRun ? 'dry-run' : (config.postMode === 'auto' ? 'approved' : 'pending'),
        createdAt: new Date().toISOString(),
        item: {
          name: item.name, price: item.price, url: item.url, shopName: item.shopName,
          shopCode: item.shopCode, reviewCount: item.reviewCount,
          reviewAverage: item.reviewAverage, score: item.score,
        },
        content: { fullCaption: content.fullCaption, altText: content.altText },
        images: relPaths,
        imageUrls,
      };

      if (!dryRun && config.postMode !== 'auto') {
        entry.issueNumber = await openReviewIssue({ item: entry.item, content, imageUrls, slug });
      }

      queue.add(entry);
      history.record({
        itemId: item.id, shopCode: item.shopCode, slug,
        name: item.name, status: dryRun ? 'dry-run' : 'queued',
      });
      results.push(entry);
    } catch (e) {
      warn(`生成に失敗 (${item.name}): ${e.stack || e.message}`);
      await reportFailure(`生成失敗: ${item.name}`, `\`\`\`\n${e.stack || e.message}\n\`\`\``);
    }
  }

  queue.save();
  history.save();
  log(`build 完了: ${results.length} 件をキューに追加`);
  return { created: results };
}

/** ===================== publish ===================== */

/** Instagram が取りに来る前に、こちら側で URL の到達性を確かめる */
async function waitForPublicUrls(urls, { timeoutSec = 600 } = {}) {
  const deadline = Date.now() + timeoutSec * 1000;
  let delay = 5000;
  while (Date.now() < deadline) {
    const checks = await Promise.all(urls.map(async (u) => {
      try {
        const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
        return r.ok;
      } catch { return false; }
    }));
    if (checks.every(Boolean)) return true;
    log(`公開URLの反映を待機中 (${checks.filter(Boolean).length}/${urls.length})...`);
    await sleep(delay);
    delay = Math.min(30000, delay * 1.4);
  }
  return false;
}

export async function publish({ dryRun = false, slug = null } = {}) {
  requireConfig('publish');

  const queue = Queue.load(config.paths.queue);
  const history = History.load(config.paths.history);

  // review モードでは GitHub Issue のラベルを承認シグナルとして取り込む
  if (config.postMode !== 'auto') {
    const approved = await fetchApprovedIssueNumbers();
    for (const entry of queue.byStatus('pending')) {
      if (entry.issueNumber && approved.has(entry.issueNumber)) {
        queue.update(entry.slug, { status: 'approved' });
        log(`承認を検出: ${entry.slug} (#${entry.issueNumber})`);
      }
    }
  }

  let targets = slug ? [queue.find(slug)].filter(Boolean) : queue.due();
  if (!targets.length) { log('公開対象はありません'); queue.save(); return { published: [] }; }

  const client = new InstagramClient(config.instagram);
  const quota = await client.quota();
  const remainingApi = quota ? quota.total - quota.used : config.limits.maxPostsPerDay;
  const remainingOwn = config.limits.maxPostsPerDay - history.publishedToday();
  const allowed = Math.max(0, Math.min(remainingApi, remainingOwn));
  if (quota) log(`API投稿枠: ${quota.used}/${quota.total} 使用済み / 自主上限の残り: ${remainingOwn}`);
  if (allowed <= 0) { log('本日の投稿上限に到達しています'); queue.save(); return { published: [] }; }

  targets = targets.slice(0, allowed);
  const published = [];

  for (const entry of targets) {
    try {
      const missing = entry.images.filter(
        (r) => !fs.existsSync(path.join(config.paths.publicDir, r)));
      if (missing.length) throw new Error(`画像ファイルが見つかりません: ${missing.join(', ')}`);

      const urls = entry.images.map((r) => `${config.publicBaseUrl}/${r}`);
      log(`公開URLの到達性を確認: ${urls[0]}`);
      if (!await waitForPublicUrls(urls)) {
        throw new Error('公開URLに到達できませんでした（GitHub Pages の設定・反映を確認してください）');
      }

      if (dryRun) {
        log(`[dry-run] 投稿をスキップ: ${entry.slug}`);
        published.push({ ...entry, mediaId: 'dry-run' });
        continue;
      }

      log(`Instagram へ投稿: ${entry.item.name}`);
      const { mediaId, permalink } = await client.publishPost({
        imageUrls: urls,
        caption: entry.content.fullCaption,
        altText: entry.content.altText,
      });

      queue.update(entry.slug, { status: 'published', mediaId, permalink, publishedAt: new Date().toISOString() });
      history.record({ itemId: entry.itemId, shopCode: entry.item.shopCode, slug: entry.slug,
                       name: entry.item.name, status: 'published', mediaId, permalink });
      await closeIssue(entry.issueNumber, `公開しました: ${permalink ?? mediaId}`);
      log(`✅ 公開完了: ${permalink ?? mediaId}`);
      published.push({ ...entry, mediaId, permalink });
    } catch (e) {
      warn(`投稿に失敗 (${entry.slug}): ${e.stack || e.message}`);
      const failures = (queue.find(entry.slug)?.failures ?? 0) + 1;
      // 3回失敗したら諦める。無限リトライで枠を食い潰さない。
      queue.update(entry.slug, { status: failures >= 3 ? 'failed' : entry.status, failures, lastError: e.message });
      await reportFailure(`投稿失敗: ${entry.item.name}`, `slug: \`${entry.slug}\`\n\n\`\`\`\n${e.stack || e.message}\n\`\`\``);
    }
  }

  queue.save();
  history.save();
  return { published };
}

/** ===================== doctor ===================== */
export async function doctor() {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

  add('RAKUTEN_APP_ID', !!config.research.rakutenAppId);
  add('RAKUTEN_AFFILIATE_ID', !!config.research.rakutenAffiliateId,
      config.research.rakutenAffiliateId ? '' : '未設定だとアフィリエイトリンクになりません');
  add('ANTHROPIC_API_KEY', !!config.content.anthropicApiKey);
  add('PUBLIC_BASE_URL', !!config.publicBaseUrl, config.publicBaseUrl);
  add('IG_USER_ID', !!config.instagram.userId);
  add('IG_ACCESS_TOKEN', !!config.instagram.accessToken);
  add('ステマ表示(景表法)', config.content.disclosureRequired,
      config.content.disclosureRequired ? config.content.disclosureText : '無効。アフィリエイト運用では違法になり得ます');

  try {
    const { registerFonts } = await import('./image/fonts.js');
    const f = registerFonts(config.image);
    add('日本語フォント', true, f.bold);
  } catch (e) { add('日本語フォント', false, e.message); }

  if (config.instagram.accessToken && config.instagram.appId && config.instagram.appSecret) {
    try {
      const { inspectToken } = await import('./publish/instagram.js');
      const t = await inspectToken(config.instagram);
      add('アクセストークン', t.valid, t.daysLeft === Infinity ? '無期限' : `残り ${t.daysLeft} 日`);
    } catch (e) { add('アクセストークン', false, e.message); }
  }

  // 全角文字は2列分を占めるので、コード単位ではなく表示幅で揃える
  const displayWidth = (s) => [...s].reduce((w, ch) => w + (/[\u3000-\u9FFF\uFF00-\uFF60]/.test(ch) ? 2 : 1), 0);
  const width = Math.max(...checks.map((c) => displayWidth(c.name)));
  for (const c of checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.name}${' '.repeat(width - displayWidth(c.name))}  ${c.detail}`);
  }
  return checks.every((c) => c.ok);
}
