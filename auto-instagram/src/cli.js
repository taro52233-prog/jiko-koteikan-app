#!/usr/bin/env node
/** コマンドラインの入口。GitHub Actions からも手元からも同じ経路で動かす。 */
import { build, publish, doctor } from './pipeline.js';
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

  build     商品リサーチ → コピー生成 → 画像生成 → キュー投入
  publish   キュー内の承認済み投稿を Instagram へ公開
  run       build と publish を続けて実行（画像が既に公開URLで配信できる場合のみ）
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
