/**
 * 1日15分ルーティンの「今日やること」を1通にまとめた digest を作る。
 *
 * 楽天ROOM には投稿用の公開APIが無く、自動投稿は規約違反（自動化ツールの使用禁止）になる。
 * そこで自動化するのは投稿ボタンより手前の全工程 ——
 * リサーチ・選定・紹介文の作成・イベント判定・買い回りリスト・進捗管理 —— にして、
 * 人が残す作業を「コピペして投稿する」の1タップだけにしている。
 *
 * 朝・昼・夜の3セクションに分かれているのは、元のルーティン（各5分）に合わせたもの。
 */
import { LEAD_DAYS } from './calendar.js';

const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;

/** チェックボックスは HTML コメントの目印で機械的に読み戻す（文言を変えても壊れない） */
export const LOG_MARKERS = {
  posted: 'room-log:posted',
  originalPhoto: 'room-log:photo',
  likes: 'room-log:likes',
  profilePhoto: 'room-log:profile-photo',
  profileBio: 'room-log:profile-bio',
  profileGenres: 'room-log:profile-genres',
};

const checkbox = (marker, label, checked = false) =>
  `- [${checked ? 'x' : ' '}] <!-- ${marker} -->${label}`;

/** 段落の配列から Markdown を作る。空の段落は落とすが、段落間の空行は必ず残す */
const paragraphs = (...parts) => parts.flat().filter((x) => x !== '' && x != null).join('\n\n');

function upcomingList(plan) {
  if (!plan.upcoming.length) return '';
  return paragraphs(
    '**今後の予定**',
    plan.upcoming.slice(0, 5)
      .map((e) => `- ${e.date}（${e.daysUntil}日後） ${e.label}${e.estimated ? ' ※推定日程' : ''}`)
      .join('\n'),
  );
}

function eventSection(plan) {
  if (!plan.target) {
    return paragraphs(
      '### 📅 イベント',
      '直近に仕込むべきイベントはありません。通常運転で、レビュー数の多い定番を回してください。',
      upcomingList(plan),
    );
  }

  const when = plan.target.daysUntil === 0 ? '**本日**' : `**${plan.target.daysUntil}日後**`;

  return paragraphs(
    plan.phase === 'prep'
      ? `### 🎯 仕込み期間：${plan.target.label}（${when}）`
      : `### 🔥 本日開催：${plan.target.label}`,
    plan.target.estimated
      ? '> ⚠️ この日程は月次パターンからの**推定**です。公式発表が出たら `auto-instagram/data/rakuten-events.json` に確定日を追記してください。'
      : '',
    plan.target.strategy,
    plan.phase === 'prep'
      ? `セール当日ではなく **${LEAD_DAYS.end}〜${LEAD_DAYS.start}日前**に投稿するのがポイントです。ユーザーはセール前に下見をして「いいねリスト」に入れ、開始と同時に買うため、当日投稿では間に合いません。`
      : '当日はタイムライン上の競争が激しくなります。仕込み済みの投稿が効く時間帯なので、新規投稿より交流に時間を使ってください。',
    upcomingList(plan),
  );
}

function candidateSection(candidates) {
  if (!candidates.length) {
    return paragraphs(
      '### ☀️ 朝（5分）：投稿する',
      '条件に合う新しい商品が見つかりませんでした。絞り込み条件を緩めるか、キーワードを増やしてください。',
    );
  }

  const blocks = candidates.map((c, i) => {
    const { item, content } = c;
    const variants = content.variants.map((v, n) => paragraphs(
      `**パターン${n + 1}｜${v.angle}**（${v.chars}字）`,
      ['```', v.posting, content.hashtags.join(' '), '```'].join('\n'),
    ));

    return paragraphs(
      `#### ${i + 1}. ${item.name}`,
      item.images?.[0] ? `<img src="${item.images[0]}" width="220">` : '',
      `${yen(item.price)}　★${item.reviewAverage}（${item.reviewCount.toLocaleString('ja-JP')}件）　${item.shopName}`,
      `🔗 [楽天ROOMに追加する](${item.url})`,
      [
        content.pain ? `> **ペイン**: ${content.pain}` : '',
        `> **狙い**: ${content.benefit}`,
        `> **刺さる相手**: ${content.targetPersona}`,
        content.writingMode === 'owned'
          ? '> 🟢 **使用体験モード**（`owned-items.json` に登録済み）'
          : '> ⚪️ ペインファースト（未所有のため使用体験は書いていません）',
      ].filter(Boolean).join('\n'),
      variants,
    );
  });

  return paragraphs(
    '### ☀️ 朝（5分）：投稿する',
    'コメント欄にコピペして投稿してください。3パターンから、その日の気分に近いものを選べば十分です。',
    blocks,
  );
}

function kaimawariSection(list) {
  if (!list?.picked?.length) return '';
  return paragraphs(
    `### 🛒 買い回りリスト（${list.shopCount}ショップ）`,
    'お買い物マラソンはポイント倍率が**購入したショップ数**で決まります。安さより「全部ショップが違うこと」が価値なので、そのまま並べて投稿すると刺さります。',
    [
      '| # | 商品 | 価格 | ショップ | リンク |',
      '| --- | --- | --- | --- | --- |',
      ...list.picked.map((it, i) =>
        `| ${i + 1} | ${it.name.slice(0, 32)} | ${yen(it.price)} | ${it.shopName.slice(0, 16)} | [開く](${it.url}) |`),
    ].join('\n'),
  );
}

function noonSection(candidates, plan) {
  const genres = [...new Set(candidates.map((c) => c.item.shopName))].slice(0, 3);
  return paragraphs(
    '### 🌤 昼（5分）：交流する',
    '「いいね」は数ではなく**誰に**が効きます。無差別に押すと時間が溶けるだけです。',
    [
      '- 今日の投稿商品と**同じジャンル**を扱っている人気ユーザーを1〜2人開く',
      '- その人の**フォロワー**の投稿に 20〜30 個「いいね」する（そのジャンルに興味がある層が確実にいる）',
      plan.target ? `- ${plan.target.label}関連の投稿をしている人は、今まさに買う気があるので優先度が高い` : '',
      genres.length ? `- 今日の参考ショップ: ${genres.join(' / ')}` : '',
    ].filter(Boolean).join('\n'),
  );
}

function nightSection(tomorrow) {
  return paragraphs(
    '### 🌙 夜（5分）：仕込む',
    '明日の分は既に用意してあります。眺めて、投稿する順番だけ決めておいてください。',
    tomorrow?.length
      ? tomorrow.map((c) => `- **${c.item.name.slice(0, 40)}**（${yen(c.item.price)}）— ${c.content.variants[0].text}`).join('\n')
      : '- 明日の候補は明朝の実行時に生成されます。',
  );
}

function progressSection(progress) {
  const bar = (n, target) => '●'.repeat(Math.min(n, target)) + '○'.repeat(Math.max(0, target - n));
  return paragraphs(
    '### 📈 Bランクまでの進捗',
    `> **今日の一手：${progress.action.label}**\n> ${progress.action.why}`,
    [
      `- 連続投稿: **${progress.streak}日**`,
      `- 今週の投稿: ${progress.postsThisWeek}/7 日`,
      `- 今週のオリジナル写真: ${bar(progress.originalPhotosThisWeek, 2)} ${progress.originalPhotosThisWeek}/2 回 ${progress.originalPhotosThisWeek >= 2 ? '✅' : '← ランクアップに最も効く'}`,
      `- 今週のいいね: ${progress.likesThisWeek} 回`,
    ].join('\n'),
    '**プロフィール**',
    [
      checkbox(LOG_MARKERS.profilePhoto, 'プロフィール写真を設定', progress.profile.photo),
      checkbox(LOG_MARKERS.profileBio, '自己紹介文を記入', progress.profile.bio),
      checkbox(LOG_MARKERS.profileGenres, '興味のあるジャンルを設定', progress.profile.genres),
    ].join('\n'),
  );
}

function logSection() {
  return paragraphs(
    '### ✅ 今日の記録',
    'やったものにチェックを入れてください。保存すると進捗が自動で記録されます（次回の digest に反映されます）。',
    [
      checkbox(LOG_MARKERS.posted, '投稿した'),
      checkbox(LOG_MARKERS.originalPhoto, '**オリジナル写真**を投稿した'),
      checkbox(LOG_MARKERS.likes, 'いいねを20〜30した'),
    ].join('\n'),
  );
}

/** digest 全体の Markdown を組み立てる */
export function buildDigest({ plan, candidates, tomorrow, kaimawari, progress }) {
  const title = plan.target && plan.phase === 'prep'
    ? `${plan.date}｜${plan.target.label}の仕込み（${plan.target.daysUntil}日前）`
    : `${plan.date}｜今日の楽天ROOM`;

  const body = paragraphs(
    // 日付はチェックボックスの読み戻しに使う（表示はされない）
    `<!-- room-digest:${plan.date} -->`,
    `**今日の一手：${progress.action.label}**`,
    '---',
    eventSection(plan),
    '---',
    candidateSection(candidates),
    kaimawari ? ['---', kaimawariSection(kaimawari)] : '',
    '---',
    noonSection(candidates, plan),
    '---',
    nightSection(tomorrow),
    '---',
    progressSection(progress),
    '---',
    logSection(),
    '<sub>この digest は auto-instagram パイプラインが自動生成しています。楽天ROOM には投稿用の公開APIが無いため、投稿操作だけ手動で残しています。</sub>',
  );

  return { title, body };
}
