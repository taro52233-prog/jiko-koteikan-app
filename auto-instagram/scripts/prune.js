#!/usr/bin/env node
/**
 * 公開済み画像の掃除。
 *
 * 生成画像を Git にコミットする方式は「無料で公開URLが手に入る」利点がある反面、
 * 放っておくとリポジトリが年単位で GB 級に膨らむ。Instagram は公開時に画像を
 * 自分側へ取り込むので、公開から数日経ったファイルは保持する必要がない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { Queue } from '../src/store/queue.js';

const KEEP_DAYS = Number(process.env.PRUNE_KEEP_DAYS || 7);
const cutoff = Date.now() - KEEP_DAYS * 86400000;

const queue = Queue.load(config.paths.queue);
let removed = 0;

for (const entry of queue.data.items) {
  if (entry.status !== 'published') continue;
  if (Date.parse(entry.publishedAt ?? entry.createdAt) > cutoff) continue;
  const dir = path.join(config.paths.publicDir, entry.slug);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    removed++;
  }
}

// キューに載っていない孤児ディレクトリも掃除する
const known = new Set(queue.data.items.map((i) => i.slug));
if (fs.existsSync(config.paths.publicDir)) {
  for (const name of fs.readdirSync(config.paths.publicDir)) {
    const dir = path.join(config.paths.publicDir, name);
    if (!fs.statSync(dir).isDirectory() || known.has(name)) continue;
    if (fs.statSync(dir).mtimeMs > cutoff) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed++;
  }
}

console.log(`${removed} 件の公開済み画像ディレクトリを削除しました（保持期間: ${KEEP_DAYS}日）`);
