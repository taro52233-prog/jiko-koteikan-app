/**
 * 楽天のセール・キャンペーンカレンダー。
 *
 * 「イベントを無視して感覚で投稿する」のが稼げない人の典型パターンなので、
 * 何日後にどのイベントが来るか、今日が「仕込み日」かどうかを機械的に判定する。
 *
 * 仕込みはイベント当日ではなく 3〜5日前から始める。ユーザーは事前に下見をして
 * 「いいねリスト」に入れ、セール開始と同時に買うため、当日投稿では間に合わない。
 *
 * 日付が固定のイベント（0と5のつく日・ワンダフルデー）は計算で出せる。
 * 開催日が毎回ずれるイベント（お買い物マラソン・スーパーSALE）は
 * data/rakuten-events.json に実日程を書いて上書きする運用にしている。
 * 未登録の期間は月次パターンからの「推定」として扱い、必ずその旨を表示する。
 */
import fs from 'node:fs';
import { nowJst } from '../util.js';

/** 仕込みを開始する日数（イベント何日前から投稿を始めるか） */
export const LEAD_DAYS = { start: 5, end: 1 };

const pad = (n) => String(n).padStart(2, '0');
/** JSTの Date から YYYY-MM-DD を作る（nowJst() は +9h した Date なので UTC getter で読む） */
export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseYmd = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 86400000);

/** イベント種別ごとの「投稿の方針」。ここが digest の指示文の根拠になる */
export const EVENT_KINDS = {
  superSale: {
    label: '楽天スーパーSALE',
    weight: 10,
    strategy: '半額・大幅値引き商品が主役。単価が高めでも「セール価格」で訴求できるので、普段より高価格帯を混ぜてよい。',
    priceHint: { min: 2000, max: 30000 },
  },
  marathon: {
    label: 'お買い物マラソン',
    weight: 9,
    strategy: '買い回り（10ショップ購入でポイント最大+9倍）が主役。1,000円前後で「ショップが全部バラバラ」な商品を並べるのが最も刺さる。',
    priceHint: { min: 800, max: 1800 },
    kaimawari: true,
  },
  wonderful: {
    label: 'ワンダフルデー',
    weight: 4,
    strategy: '毎月1日。エントリーでポイント+3倍。月初の買い足し需要（日用品・消耗品）が動く。',
    priceHint: { min: 1000, max: 5000 },
  },
  zeroGo: {
    label: '0と5のつく日',
    weight: 5,
    strategy: '楽天カード利用でポイント+4倍。金額の大小より「今日買うと得」という一言が効く。定番・リピート品が向く。',
    priceHint: { min: 1000, max: 10000 },
  },
};

/** 日付固定のイベントを生成する（0と5のつく日 / ワンダフルデー） */
function fixedEventsFor(year, month) {
  const events = [];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  events.push({ kind: 'wonderful', date: `${year}-${pad(month)}-01`, estimated: false });
  for (const day of [5, 10, 15, 20, 25, 30]) {
    if (day > lastDay) continue;
    events.push({ kind: 'zeroGo', date: `${year}-${pad(month)}-${pad(day)}`, estimated: false });
  }
  return events;
}

/**
 * 開催日が毎回ずれるイベントの推定。
 * スーパーSALEは 3/6/9/12月上旬、お買い物マラソンは月に1〜2回という実績パターンに基づく
 * 「目安」であって確定日程ではない。必ず estimated: true を付けて返す。
 */
function estimatedEventsFor(year, month) {
  const events = [];
  if ([3, 6, 9, 12].includes(month)) {
    events.push({ kind: 'superSale', date: `${year}-${pad(month)}-04`, estimated: true });
  } else {
    events.push({ kind: 'marathon', date: `${year}-${pad(month)}-04`, estimated: true });
  }
  events.push({ kind: 'marathon', date: `${year}-${pad(month)}-19`, estimated: true });
  return events;
}

/** data/rakuten-events.json に手入力された確定日程を読む */
export function loadOverrides(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (raw.events ?? [])
      .filter((e) => EVENT_KINDS[e.kind] && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
      .map((e) => ({ ...e, estimated: false }));
  } catch (e) {
    console.warn(`イベントカレンダーの読み込みに失敗: ${e.message}`);
    return [];
  }
}

/** 今日から days 日先までのイベントを、近い順で返す */
export function upcomingEvents({ from = nowJst(), days = 45, overridesFile } = {}) {
  const overrides = overridesFile ? loadOverrides(overridesFile) : [];
  const today = ymd(from);
  const until = ymd(addDays(from, days));

  const generated = [];
  for (let m = 0; m <= Math.ceil(days / 28) + 1; m++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + m, 1));
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    generated.push(...fixedEventsFor(y, mo), ...estimatedEventsFor(y, mo));
  }

  // 手入力の確定日程が同種・同月にあれば、その月の推定は捨てる
  const confirmedMonths = new Set(overrides.map((e) => `${e.kind}:${e.date.slice(0, 7)}`));
  const merged = [
    ...overrides,
    ...generated.filter((e) => !(e.estimated && confirmedMonths.has(`${e.kind}:${e.date.slice(0, 7)}`))),
  ];

  const seen = new Set();
  return merged
    .filter((e) => e.date >= today && e.date <= until)
    .filter((e) => !seen.has(`${e.kind}:${e.date}`) && seen.add(`${e.kind}:${e.date}`))
    .map((e) => ({
      ...e,
      ...EVENT_KINDS[e.kind],
      daysUntil: diffDays(e.date, today),
    }))
    .sort((a, b) => a.daysUntil - b.daysUntil || b.weight - a.weight);
}

/**
 * 今日の投稿方針を決める。
 * 「仕込み期間（イベント1〜5日前）」に入っているイベントのうち、最も重いものを採用する。
 */
export function todaysPlan({ from = nowJst(), overridesFile } = {}) {
  const events = upcomingEvents({ from, days: 45, overridesFile });
  const today = events.filter((e) => e.daysUntil === 0);
  const prepping = events.filter((e) => e.daysUntil >= LEAD_DAYS.end && e.daysUntil <= LEAD_DAYS.start);

  // 当日イベントより「仕込み」を優先する。当日に投稿しても下見の時間が無く、間に合わない。
  const target = prepping.sort((a, b) => b.weight - a.weight || a.daysUntil - b.daysUntil)[0]
              ?? today.sort((a, b) => b.weight - a.weight)[0]
              ?? null;

  return {
    date: ymd(from),
    target,
    phase: !target ? 'normal' : (target.daysUntil === 0 ? 'event-day' : 'prep'),
    todayEvents: today,
    upcoming: events.slice(0, 8),
    /** お買い物マラソン期は買い回り用の低単価リストを作る */
    kaimawari: !!target?.kaimawari,
    priceHint: target?.priceHint ?? null,
  };
}
