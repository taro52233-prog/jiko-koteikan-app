#!/usr/bin/env node
/**
 * digest Issue のチェックボックスを読み戻して、楽天ROOMの実施ログを更新する。
 *
 * 楽天ROOMの実績を外から取得する手段は無いので、進捗管理は自己申告に頼るしかない。
 * ただし「別の場所に記録しに行く」運用は必ず続かないので、
 * 毎朝届く digest Issue のチェックを付けるだけで記録が残るようにしてある
 * （GitHub Actions の issues.edited をトリガにこのスクリプトが走る）。
 */
import fs from 'node:fs';
import { config } from '../src/config.js';
import { RoomLog } from '../src/room/rank.js';
import { LOG_MARKERS } from '../src/room/digest.js';
import { ymd } from '../src/room/calendar.js';
import { nowJst } from '../src/util.js';

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath || !fs.existsSync(eventPath)) {
  console.error('GITHUB_EVENT_PATH が読めません（GitHub Actions 上で実行してください）');
  process.exit(1);
}

const body = JSON.parse(fs.readFileSync(eventPath, 'utf8'))?.issue?.body ?? '';

/** `- [x] <!-- marker -->` の形を探す。文言を変えても壊れないよう目印だけを見る */
const isChecked = (marker) =>
  new RegExp(`^\\s*[-*]\\s*\\[x\\]\\s*<!--\\s*${marker}\\s*-->`, 'im').test(body);

const dateMatch = body.match(/<!--\s*room-digest:(\d{4}-\d{2}-\d{2})\s*-->/);
const date = dateMatch?.[1] ?? ymd(nowJst());

const log = RoomLog.load(config.paths.roomLog);

log.record(date, {
  posted: isChecked(LOG_MARKERS.posted),
  originalPhoto: isChecked(LOG_MARKERS.originalPhoto),
  // 「20〜30した」のチェックなので、下限の20を実績として記録する
  likes: isChecked(LOG_MARKERS.likes) ? 20 : 0,
});

log.data.profile = {
  photo: isChecked(LOG_MARKERS.profilePhoto),
  bio: isChecked(LOG_MARKERS.profileBio),
  genres: isChecked(LOG_MARKERS.profileGenres),
};

log.save();

const d = log.get(date);
console.log(`${date} を記録: 投稿=${d.posted} 写真=${d.originalPhoto} いいね=${d.likes} / プロフィール=${JSON.stringify(log.data.profile)}`);
