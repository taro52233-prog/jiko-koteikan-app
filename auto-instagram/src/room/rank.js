/**
 * 楽天ROOM ランクアップ進捗の管理。
 *
 * Bランク以上でランクボーナス（+1〜3%）が付き、報酬が体感で倍近く変わる。
 * 到達条件は楽天から公開されていないが、実務上効くとされるのは次の4つ。
 *   1. プロフィールを全部埋める（写真・自己紹介・興味ジャンル）
 *   2. 1日1〜2投稿を続ける
 *   3. **オリジナル写真を週2〜3回混ぜる**（ここが最も効く）
 *   4. 同ジャンルの濃い相手に絞って交流する
 *
 * 楽天ROOMの実績を外部から取得するAPIは存在しないので、
 * 「digest Issue のチェックボックスを叩く → ログに記録」という自己申告で追う。
 * 完璧な計測より、続いているかどうかが一目で分かることを優先している。
 */
import fs from 'node:fs';
import path from 'node:path';
import { nowJst } from '../util.js';
import { ymd } from './calendar.js';

const EMPTY = {
  version: 1,
  profile: { photo: false, bio: false, genres: false },
  days: [],   // [{ date, posted, originalPhoto, likes }]
};

export const PROFILE_ITEMS = {
  photo: 'プロフィール写真を設定',
  bio: '自己紹介文を記入',
  genres: '興味のあるジャンルを設定',
};

/** 週あたりのオリジナル写真の目標下限（動画の「週2〜3回」の下限を採用） */
export const ORIGINAL_PHOTO_TARGET = 2;

export class RoomLog {
  constructor(file) { this.file = file; this.data = structuredClone(EMPTY); }

  static load(file) {
    const l = new RoomLog(file);
    try {
      if (fs.existsSync(file)) {
        l.data = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      }
    } catch (e) {
      console.warn(`ROOMログの読み込みに失敗したため空から開始します: ${e.message}`);
    }
    return l;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data.days = this.data.days.slice(-180);   // 半年分だけ保持
    fs.writeFileSync(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
  }

  /** 同じ日付の記録は上書きする（チェックを付け直しても二重に数えない） */
  record(date, patch) {
    const existing = this.data.days.find((d) => d.date === date);
    if (existing) Object.assign(existing, patch);
    else this.data.days.push({ date, posted: false, originalPhoto: false, likes: 0, ...patch });
    this.data.days.sort((a, b) => a.date.localeCompare(b.date));
    return this;
  }

  get(date) { return this.data.days.find((d) => d.date === date) ?? null; }
}

/** 投稿が途切れていない日数。今日まだ投稿していない場合は昨日までで数える */
export function postingStreak(days, today) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00Z`);
  // 今日未投稿でも「昨日までの連続」は生きているので、初日だけは空振りを許す
  if (!byDate.get(today)?.posted) cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (;;) {
    const key = ymd(cursor);
    if (!byDate.get(key)?.posted) break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/** 直近7日（当日を含む）の記録を切り出す */
export function lastWeek(days, today) {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  const fromKey = ymd(from);
  return days.filter((d) => d.date >= fromKey && d.date <= today);
}

/**
 * 今日いちばん効く一手を返す。
 * 「全部やれ」ではなく1つに絞るのが、1日15分を守るうえで重要。
 */
export function nextAction(progress) {
  const missingProfile = Object.entries(progress.profile).find(([, done]) => !done);
  if (missingProfile) {
    return {
      key: 'profile',
      label: `プロフィールを完成させる（${PROFILE_ITEMS[missingProfile[0]]}）`,
      why: '一度やれば終わる作業で、ランク判定の土台になる。最優先。',
    };
  }
  if (progress.originalPhotosThisWeek < ORIGINAL_PHOTO_TARGET) {
    return {
      key: 'originalPhoto',
      label: `オリジナル写真を投稿する（今週 ${progress.originalPhotosThisWeek}/${ORIGINAL_PHOTO_TARGET} 回）`,
      why: 'ランクアップに最も効くとされる要素。手持ちの物を撮るだけでよい。',
    };
  }
  if (!progress.postedToday) {
    return {
      key: 'post',
      label: '今日の投稿を済ませる（1〜2件）',
      why: `継続 ${progress.streak}日。途切れさせないことが最も安いランク維持コスト。`,
    };
  }
  if (progress.likesToday < 20) {
    return {
      key: 'likes',
      label: `同ジャンルのユーザーに「いいね」（今日 ${progress.likesToday}/20〜30）`,
      why: '無差別ではなく、ターゲットに近い層へ絞ること。数より質。',
    };
  }
  return { key: 'done', label: '今日のノルマは完了', why: '余力があれば明日の下書きを溜めておく。' };
}

export function rankProgress(log, { today = ymd(nowJst()) } = {}) {
  const week = lastWeek(log.data.days, today);
  const todayLog = log.get(today);

  const progress = {
    today,
    profile: log.data.profile,
    profileComplete: Object.values(log.data.profile).every(Boolean),
    streak: postingStreak(log.data.days, today),
    postsThisWeek: week.filter((d) => d.posted).length,
    originalPhotosThisWeek: week.filter((d) => d.originalPhoto).length,
    likesThisWeek: week.reduce((s, d) => s + (d.likes ?? 0), 0),
    postedToday: !!todayLog?.posted,
    likesToday: todayLog?.likes ?? 0,
  };
  progress.action = nextAction(progress);
  return progress;
}
