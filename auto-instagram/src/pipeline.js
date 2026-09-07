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
import { selectItems, selectKaimawari } from './research/score.js';
import { generateContent } from './content/generate.js';
import { generateRoomComment } from './content/room.js';
import { renderCarousel } from './image/render.js';
import { History } from './store/history.js';
import { Queue } from './store/queue.js';
import { InstagramClient } from './publish/instagram.js';
import { openReviewIssue, fetchApprovedIssueNumbers, closeIssue, reportFailure, createIssue } from './publish/review.js';
import { todaysPlan, ymd } from './room/calendar.js';
import { RoomLog, rankProgress } from './room/rank.js';
import { OwnedItems } from './store/owned.js';
import { loadStyleSamples, resolveStyle, DEFAULT_STYLE } from './content/style.js';
import { generateSceneImage } from './image/scene.js';
import { buildDigest } from './room/digest.js';
import { jstStamp, log, warn, sleep, nowJst } from './util.js';

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

      // 表紙に敷く使用シーン画像。楽天の商品画像は入力せず、テキストから新規生成する
      // （提供画像の加工は規約で認められていないため）。失敗しても投稿は止めない。
      const sceneBuffer = await generateSceneImage(content.scenePrompt, config.scene, {
        width: config.image.width, height: config.image.height, itemName: item.name,
      });

      const { files } = await renderCarousel({
        item, content, cfg: config.image, outDir: config.paths.publicDir, slug, sceneBuffer,
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

/**
 * 設定診断。
 * 楽天ROOM だけで使う人に Instagram の未設定を「エラー」として見せると
 * 何が壊れているのか分からなくなるので、用途ごとに区切って必須/任意を分けている。
 */
export async function doctor() {
  const groups = [];
  const group = (name, note) => {
    const g = { name, note, checks: [] };
    groups.push(g);
    return (label, ok, detail = '', required = true) => g.checks.push({ label, ok, detail, required });
  };

  const common = group('共通', '両方の用途で必要');
  common('RAKUTEN_APP_ID', !!config.research.rakutenAppId, '楽天ウェブサービスのアプリID');
  common('RAKUTEN_AFFILIATE_ID', !!config.research.rakutenAffiliateId,
         config.research.rakutenAffiliateId ? '' : '未設定だと報酬が発生しないリンクになります');
  common('ANTHROPIC_API_KEY', !!config.content.anthropicApiKey);
  common('ステマ表示(景表法)', config.content.disclosureRequired,
         config.content.disclosureRequired ? config.content.roomDisclosureText : '無効。アフィリエイト運用では違法になり得ます');

  const room = group('楽天ROOM（digest）', 'GitHub Actions 上でのみ Issue を作成');
  room('スコアリング', ['click', 'conversion'].includes(config.research.scoringProfile),
       `${config.research.scoringProfile}（楽天ROOMは click 推奨）`);
  room('1日の投稿候補数', config.content.roomPostsPerDay >= 1, `${config.content.roomPostsPerDay} 件`);
  room('文体プロファイル', true,
       (() => {
         const { profile, samples } = loadStyleSamples(config.content.styleSamplesPath);
         const name = config.content.roomStyle || profile || DEFAULT_STYLE;
         const style = resolveStyle(name);
         return `${style.label}（${style.maxChars}字・タグ${style.hashtagCount}個）` +
                (samples.length ? ` / お手本 ${samples.length} 本` : ' / お手本なし（実投稿を貼ると精度が上がります）');
       })());
  room('紹介文の書き方', ['auto', 'pain-first'].includes(config.content.writingMode),
       config.content.writingMode === 'auto'
         ? '所有登録済みの商品のみ使用体験として書く'
         : '常にペインファースト（使用体験は書かない）');
  room('所有商品の登録', true,
       (() => {
         const n = OwnedItems.load(config.paths.owned).items.length;
         return n ? `${n} 件（この商品は使用体験として書ける）`
                  : '0 件。実際に使っている商品を登録すると使用体験として書けます';
       })(), false);
  room('セール日程の確定登録', true,
       (() => {
         try {
           const n = JSON.parse(fs.readFileSync(config.paths.events, 'utf8')).events?.length ?? 0;
           return n ? `${n} 件登録済み` : '未登録（推定日程で動作します）';
         } catch { return '未登録（推定日程で動作します）'; }
       })(), false);

  const scene = group('使用シーン画像（任意）', 'Instagram の表紙に敷く。楽天画像は入力しない');
  scene('SCENE_IMAGE_ENABLED', config.scene.enabled,
        config.scene.enabled ? `${config.scene.model} ${config.scene.size} ${config.scene.quality}` : '無効', false);
  scene('OPENAI_API_KEY', !!config.scene.apiKey, '', false);
  scene('AI生成の表示', config.scene.label,
        config.scene.label ? config.scene.labelText : '無効。実写と誤認させる恐れがあります', false);

  const ig = group('Instagram（自動投稿）', '使わない場合は未設定で問題ありません');
  ig('PUBLIC_BASE_URL', !!config.publicBaseUrl, config.publicBaseUrl, false);
  ig('IG_USER_ID', !!config.instagram.userId, '', false);
  ig('IG_ACCESS_TOKEN', !!config.instagram.accessToken, '', false);

  try {
    const { registerFonts } = await import('./image/fonts.js');
    ig('日本語フォント', true, registerFonts(config.image).bold, false);
  } catch (e) { ig('日本語フォント', false, e.message, false); }

  if (config.instagram.accessToken && config.instagram.appId && config.instagram.appSecret) {
    try {
      const { inspectToken } = await import('./publish/instagram.js');
      const t = await inspectToken(config.instagram);
      ig('アクセストークン', t.valid, t.daysLeft === Infinity ? '無期限' : `残り ${t.daysLeft} 日`, false);
    } catch (e) { ig('アクセストークン', false, e.message, false); }
  }

  // 全角文字は2列分を占めるので、コード単位ではなく表示幅で揃える
  const displayWidth = (s) => [...s].reduce((w, ch) => w + (/[\u3000-\u9FFF\uFF00-\uFF60]/.test(ch) ? 2 : 1), 0);
  const width = Math.max(...groups.flatMap((g) => g.checks.map((c) => displayWidth(c.label))));

  for (const g of groups) {
    console.log(`\n■ ${g.name}　${g.note}`);
    for (const c of g.checks) {
      const mark = c.ok ? '✅' : (c.required ? '❌' : '⬜');
      console.log(`  ${mark} ${c.label}${' '.repeat(width - displayWidth(c.label))}  ${c.detail}`);
    }
  }
  console.log('');

  const blocking = groups.flatMap((g) => g.checks).filter((c) => c.required && !c.ok);
  if (blocking.length) console.log(`未設定の必須項目: ${blocking.map((c) => c.label).join(', ')}\n`);
  return blocking.length === 0;
}

/** ===================== 楽天ROOM: 日次 digest ===================== */
export const ROOM_DIGEST_LABEL = 'room-digest';

/** 商品1件から「紹介文つきの投稿候補」を作る */
async function makeRoomCandidate(item, event, owned) {
  // 所有登録があれば使用体験として、無ければペインファーストで書く
  const registration = owned?.find(item) ?? null;
  const content = await generateRoomComment(item, config.content, { event, owned: registration });
  return {
    itemId: item.id,
    createdAt: new Date().toISOString(),
    item: {
      name: item.name, price: item.price, url: item.url, shopName: item.shopName,
      shopCode: item.shopCode, reviewCount: item.reviewCount,
      reviewAverage: item.reviewAverage, score: item.score, images: item.images.slice(0, 1),
    },
    content,
  };
}

/**
 * 朝に1通届く「今日やること」を作る。
 *
 * 前日の夜に仕込んだ下書き（status: draft）があればそれを今日の分として出し、
 * 同時に翌日分の下書きを新しく作る。動画のルーティン（夜に翌日を仕込む）を
 * パイプライン側で肩代わりしている。
 */
export async function roomDigest({ dryRun = false } = {}) {
  requireConfig('research');
  if (!config.content.anthropicApiKey) throw new Error('必要な環境変数が未設定です: ANTHROPIC_API_KEY');

  const history = History.load(config.paths.history);
  const queue = Queue.load(config.paths.queue);
  const roomLog = RoomLog.load(config.paths.roomLog);
  const owned = OwnedItems.load(config.paths.owned);
  if (owned.items.length) log(`所有登録: ${owned.items.length} 件（該当商品は使用体験として書く）`);

  const plan = todaysPlan({ overridesFile: config.paths.events });
  log(`本日の方針: ${plan.phase}${plan.target ? ` / ${plan.target.label} ${plan.target.daysUntil}日前` : ''}`);

  // イベントに応じて狙い目の価格帯を差し替える（マラソンなら1,000円前後）
  const research = { ...config.research, priceHint: plan.priceHint };
  const need = config.content.roomPostsPerDay;

  // 1) 前夜の下書きを今日の分として引き当てる
  const drafts = queue.byStatus('draft').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const candidates = drafts.slice(0, need);

  // 2) 足りない分と、明日の下書き分をまとめて選定する
  const shortfall = need - candidates.length;
  const wanted = shortfall + need;
  let pool = [];
  if (wanted > 0) {
    log('候補商品を収集中...');
    pool = await collectCandidates(research);
    log(`候補 ${pool.length} 件`);
  }

  const { picked } = pool.length
    ? selectItems(pool, research, history, wanted, config.research.scoringProfile)
    : { picked: [] };

  for (const item of picked.slice(0, shortfall)) {
    try {
      const c = await makeRoomCandidate(item, plan.target, owned);
      candidates.push({ ...c, slug: `room-${ymd(nowJst())}-${item.id.replace(/[^\w]+/g, '-')}`, status: 'delivered' });
      history.record({ itemId: item.id, shopCode: item.shopCode, name: item.name, status: 'room-delivered' });
    } catch (e) { warn(`紹介文の生成に失敗 (${item.name}): ${e.message}`); }
  }

  // 3) 明日の下書きを仕込む
  const tomorrow = [];
  for (const item of picked.slice(shortfall, shortfall + need)) {
    try {
      const c = await makeRoomCandidate(item, plan.target, owned);
      const entry = { ...c, slug: `room-draft-${item.id.replace(/[^\w]+/g, '-')}`, status: 'draft' };
      queue.add(entry);
      tomorrow.push(entry);
      history.record({ itemId: item.id, shopCode: item.shopCode, name: item.name, status: 'room-draft' });
    } catch (e) { warn(`翌日分の下書き生成に失敗 (${item.name}): ${e.message}`); }
  }

  // 引き当てた下書きは配信済みにする
  for (const c of candidates) if (c.status === 'draft') queue.update(c.slug, { status: 'delivered' });

  // 4) お買い物マラソン期だけ買い回りリストを付ける
  let kaimawari = null;
  if (plan.kaimawari && pool.length) {
    kaimawari = selectKaimawari(pool, research, history, config.content.kaimawariCount);
    log(`買い回りリスト: ${kaimawari.shopCount}ショップ`);
  }

  const progress = rankProgress(roomLog);
  const { title, body } = buildDigest({ plan, candidates, tomorrow, kaimawari, progress });

  if (dryRun) {
    console.log(`\n===== ${title} =====\n`);
    console.log(body);
    return { title, body, candidates, dryRun: true };
  }

  const issueNumber = await createIssue({ title, body, labels: [ROOM_DIGEST_LABEL] });
  queue.save();
  history.save();
  roomLog.save();
  log(`digest を配信しました${issueNumber ? ` (#${issueNumber})` : ''}`);
  return { title, body, candidates, issueNumber };
}
