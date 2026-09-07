#!/usr/bin/env node
/** コマンドラインの入口。GitHub Actions からも手元からも同じ経路で動かす。 */
import { build, publish, doctor, roomDigest } from './pipeline.js';
import { config } from './config.js';

const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const dryRun = flag('dry-run') || config.dryRun;

const HELP = `
使い方: node src/cli.js <command> [options]

  楽天ROOM（1日15分ルーティン）
  digest    今日やること一式を生成して Issue で配信
              リサーチ → 選定 → 紹介文3パターン → イベント判定 → 買い回り → 進捗
  calendar  楽天のセール日程と、今日の仕込み方針を表示
  rank      Bランクまでの進捗と「今日の一手」を表示

  Instagram（自動投稿）
  build     商品リサーチ → コピー生成 → 画像生成 → キュー投入
  publish   キュー内の承認済み投稿を Instagram へ公開
  run       build と publish を続けて実行（画像が既に公開URLで配信できる場合のみ）

  共通
  doctor    設定・認証・フォントの健全性チェック

オプション:
  --dry-run       外部への公開を行わない（生成物は out / docs に残る）
  --count <n>     build で生成する投稿数（既定: 1）
  --slug <slug>   publish で対象を1件に限定する

主要な環境変数は auto-instagram/.env.example を参照。
`;

async function main() {
  switch (command) {
    case 'build':
      await build({ dryRun, count: Number(opt('count', 1)) });
      break;
    case 'publish':
      await publish({ dryRun, slug: opt('slug', null) });
      break;
    case 'run':
      await build({ dryRun, count: Number(opt('count', 1)) });
      await publish({ dryRun, slug: null });
      break;
    case 'digest':
      await roomDigest({ dryRun });
      break;
    case 'calendar': {
      const { todaysPlan } = await import('./room/calendar.js');
      const { config: c } = await import('./config.js');
      const plan = todaysPlan({ overridesFile: c.paths.events });
      console.log(`\n${plan.date} の方針: ${plan.phase}`);
      if (plan.target) {
        console.log(`  → ${plan.target.label}（${plan.target.daysUntil === 0 ? '本日' : `${plan.target.daysUntil}日後`}）${plan.target.estimated ? ' ※推定日程' : ''}`);
        console.log(`     ${plan.target.strategy}`);
        if (plan.priceHint) console.log(`     狙い目価格帯: ${plan.priceHint.min}〜${plan.priceHint.max}円`);
      } else {
        console.log('  → 仕込むべきイベントなし（通常運転）');
      }
      console.log('\n今後の予定:');
      for (const e of plan.upcoming) {
        console.log(`  ${e.date} (${String(e.daysUntil).padStart(2)}日後) ${e.label}${e.estimated ? ' ※推定' : ''}`);
      }
      console.log('');
      break;
    }
    case 'rank': {
      const { RoomLog, rankProgress, PROFILE_ITEMS } = await import('./room/rank.js');
      const { config: c } = await import('./config.js');
      const p = rankProgress(RoomLog.load(c.paths.roomLog));
      console.log(`\n連続投稿: ${p.streak}日 / 今週の投稿: ${p.postsThisWeek}日 / オリジナル写真: ${p.originalPhotosThisWeek}回 / いいね: ${p.likesThisWeek}回`);
      console.log('\nプロフィール:');
      for (const [k, label] of Object.entries(PROFILE_ITEMS)) console.log(`  ${p.profile[k] ? '✅' : '⬜'} ${label}`);
      console.log(`\n▶ 今日の一手: ${p.action.label}\n  ${p.action.why}\n`);
      break;
    }
    case 'doctor': {
      const ok = await doctor();
      process.exitCode = ok ? 0 : 1;
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}\n`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
