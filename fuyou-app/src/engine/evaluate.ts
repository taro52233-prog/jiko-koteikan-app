import type { RuleSet } from '../rules/types';
import type {
  Answers,
  Confidence,
  EmployerSize,
  Evaluation,
  Projection,
  Records,
  Wall,
  WallPlan,
  WallStatus,
} from './types';

const WEEKS_PER_MONTH = 52 / 12;

const SIZE_MIN: Record<Exclude<EmployerSize, 'unknown'>, number> = {
  '51+': 51,
  '36-50': 36,
  '21-35': 21,
  '11-20': 11,
  '1-10': 1,
};

/** その日付の年・月 */
function ym(d: Date) {
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function floorYen(n: number) {
  return Math.floor(n);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** 契約上の月給（通勤手当・残業・賞与を除く） */
export function contractMonthlyWage(a: Answers): number {
  return floorYen(a.hourlyWage * a.weeklyHours * WEEKS_PER_MONTH);
}

export function project(a: Answers, records: Records, year: number, today: Date): Projection {
  const t = ym(today);
  // 対象の年のうち、すでに過ぎた（または今の）月の数
  const elapsed = t.y < year ? 0 : t.y > year ? 12 : t.m;

  const months = Object.entries(records)
    .map(([k, v]) => ({ m: Number(k), r: v! }))
    .filter((x) => x.m >= 1 && x.m <= 12 && x.r)
    .sort((p, q) => p.m - q.m);

  const ytdGross = months.reduce((s, x) => s + x.r.gross, 0);
  const ytdCommute = months.reduce((s, x) => s + x.r.commute, 0);

  const cWage = contractMonthlyWage(a);
  let paceGross = cWage + a.commuteMonthly;
  let paceCommute = a.commuteMonthly;
  let paceFrom: Projection['paceFrom'] = 'contract';

  if (months.length > 0) {
    // 直近3か月の平均をペースとする（残業などの実態を反映するため）
    const recent = months.slice(-3);
    paceGross = recent.reduce((s, x) => s + x.r.gross, 0) / recent.length;
    paceCommute = recent.reduce((s, x) => s + x.r.commute, 0) / recent.length;
    paceFrom = 'records';
  }

  const recordedSet = new Set(months.map((x) => x.m));
  const remainingMonths = 12 - months.length;
  let missingPastMonths = 0;
  for (let m = 1; m < elapsed; m++) if (!recordedSet.has(m)) missingPastMonths++;
  const futureMonths = remainingMonths - missingPastMonths;

  const extra = a.bonusAnnual + a.otherIncome;
  const calendarGross = floorYen(ytdGross + paceGross * remainingMonths + extra);
  const calendarCommute = ytdCommute + paceCommute * remainingMonths;
  const calendarTaxable = floorYen(calendarGross - calendarCommute);

  const contractAnnual = floorYen(
    a.hourlyWage * a.weeklyHours * 52 + a.commuteMonthly * 12 + a.bonusAnnual + a.otherIncome,
  );

  return {
    recordedMonths: months.length,
    ytdGross,
    ytdCommute,
    paceGross: floorYen(paceGross),
    paceCommute: floorYen(paceCommute),
    paceFrom,
    calendarGross,
    calendarTaxable,
    contractAnnual,
    contractMonthlyWage: cWage,
    remainingMonths,
    missingPastMonths,
    futureMonths,
  };
}

/** 給与所得（このアプリの範囲では給与所得控除の最低保障額を使う） */
export function salaryIncome(salary: number, rules: RuleSet): number {
  return Math.max(0, salary - rules.salaryDeduction.minimum);
}

/** 扶養する人の合計所得（給与のみの場合）の区分。0,1,2 = 900万以下/950万以下/1,000万以下、3 = 超える、null = 不明 */
export function supporterTier(supporterSalary: number | null, rules: RuleSet): 0 | 1 | 2 | 3 | null {
  if (supporterSalary === null) return null;
  const cap = rules.spouseDeduction.supporterSalaryDeductionCap;
  // 給与収入850万円超は給与所得控除が上限額になる。それ以下なら合計所得は900万以下
  const income = supporterSalary > 8_500_000 ? supporterSalary - cap : 0;
  const [s0, s1, s2] = rules.spouseDeduction.supporterIncomeSteps;
  if (income <= s0) return 0;
  if (income <= s1) return 1;
  if (income <= s2) return 2;
  return 3;
}

/** 扶養する人が受けられる配偶者控除・配偶者特別控除の額（所得税） */
export function spouseDeductionAmount(
  spouseSalary: number,
  tier: 0 | 1 | 2,
  rules: RuleSet,
): { kind: 'spouse' | 'special' | 'none'; amount: number } {
  const sd = rules.spouseDeduction;
  const income = salaryIncome(spouseSalary, rules);
  if (income <= sd.spouseIncomeLimit) return { kind: 'spouse', amount: sd.amounts[tier] };
  for (const t of sd.specialTiers) {
    if (income <= t.maxSpouseIncome) return { kind: 'special', amount: t.amounts[tier] };
  }
  return { kind: 'none', amount: 0 };
}

/** 配偶者特別控除が満額のままでいられる給与収入の上限 */
function spouseSpecialFullLine(rules: RuleSet): number {
  return rules.spouseDeduction.specialTiers[0].maxSpouseIncome + rules.salaryDeduction.minimum;
}

/** 配偶者特別控除がなくなる給与収入 */
function spouseSpecialEndLine(rules: RuleSet): number {
  const tiers = rules.spouseDeduction.specialTiers;
  return tiers[tiers.length - 1].maxSpouseIncome + rules.salaryDeduction.minimum;
}

/** その日に適用される企業規模要件（人数） */
export function sizeRequirementOn(date: string, rules: RuleSet): number | null {
  let current: number | null = null;
  for (const s of rules.shortTimeWorker.sizeSchedule) {
    if (s.from <= date) current = s.minSize;
  }
  return current;
}

/** 勤務先の人数区分が、初めて対象になる日 */
export function sizeEligibleFrom(size: EmployerSize, rules: RuleSet): string | null {
  if (size === 'unknown') return null;
  const n = SIZE_MIN[size];
  for (const s of rules.shortTimeWorker.sizeSchedule) {
    if (n >= s.minSize) return s.from;
  }
  return null;
}

function statusFromMargin(margin: number, near: number, kind: 'atMost' | 'below'): WallStatus {
  const over = kind === 'atMost' ? margin < 0 : margin <= 0;
  if (over) return 'over';
  if (margin <= near) return 'near';
  return 'safe';
}

function plan(threshold: number, kind: 'atMost' | 'below', a: Answers, p: Projection, includeCommute: boolean): WallPlan | null {
  if (p.futureMonths <= 0 || a.hourlyWage <= 0) return null;
  const limit = kind === 'below' ? threshold - 1 : threshold;
  // 記録のない過ぎた月は、ペースで支払われたものとして固定する
  const pastEstimate = p.missingPastMonths * (p.paceGross - (includeCommute ? 0 : p.paceCommute));
  const fixed = p.ytdGross - (includeCommute ? 0 : p.ytdCommute) + pastEstimate + a.bonusAnnual + a.otherIncome;
  const maxMonthly = Math.max(0, floorYen((limit - fixed) / p.futureMonths));
  // 残りの月に支払われる通勤手当の分を除いて、時間に直す
  const wagePart = includeCommute ? Math.max(0, maxMonthly - p.paceCommute) : maxMonthly;
  const maxWeeklyHours = round1(wagePart / a.hourlyWage / WEEKS_PER_MONTH);
  return { maxMonthly, maxWeeklyHours, remainingMonths: p.futureMonths };
}

function hours(marginYen: number, a: Answers): number | null {
  if (a.hourlyWage <= 0) return null;
  return round1(marginYen / a.hourlyWage);
}

function calendarNotes(p: Projection): string[] {
  const notes: string[] = [];
  if (p.paceFrom === 'contract') {
    notes.push('給与の記録がまだないため、契約内容（時給×週の時間）から見込んでいます。');
  } else {
    notes.push('記録のない月は、直近の記録（最大3か月）の平均で見込んでいます。');
  }
  if (p.missingPastMonths > 0) {
    notes.push(`すでに過ぎた月のうち${p.missingPastMonths}か月分の記録がありません。記録すると精度が上がります。`);
  }
  return notes;
}

/* ---------- 各壁 ---------- */

function incomeTaxWall(a: Answers, p: Projection, r: RuleSet): Wall {
  const threshold = r.incomeTax.basicDeduction + r.salaryDeduction.minimum;
  const margin = threshold - p.calendarTaxable;
  return {
    id: 'incomeTax',
    group: 'self_tax',
    title: `所得税（${man(threshold)}）`,
    lead: 'あなた自身に所得税がかかり始める金額です。',
    status: statusFromMargin(margin, r.nearMarginYen, 'atMost'),
    confidence: 'estimate',
    unit: 'yen',
    threshold,
    thresholdKind: 'atMost',
    value: p.calendarTaxable,
    margin,
    marginHours: hours(margin, a),
    basis: '1〜12月に支払われる給与の合計（通勤手当は含めない）',
    consequence: '超えた分に所得税がかかります。少し超えても、手取りが大きく減ることはありません。',
    notes: calendarNotes(p),
    sourceIds: r.incomeTax.sourceIds,
    plan: plan(threshold, 'atMost', a, p, false),
  };
}

function residentTaxWall(a: Answers, p: Projection, r: RuleSet): Wall {
  const threshold = r.residentTax.conservativeLine;
  const margin = threshold - p.calendarTaxable;
  const status = statusFromMargin(margin, r.nearMarginYen, 'atMost');
  return {
    id: 'residentTax',
    group: 'self_tax',
    title: '住民税（目安）',
    lead: 'あなた自身に住民税がかかり始める金額の目安です。',
    status: status === 'over' ? 'check' : status,
    confidence: 'needs_check',
    unit: 'yen',
    threshold,
    thresholdKind: 'atMost',
    value: p.calendarTaxable,
    margin,
    marginHours: hours(margin, a),
    basis: '1〜12月に支払われる給与の合計（通勤手当は含めない）。翌年度の住民税に反映されます',
    consequence: '翌年度に住民税がかかります。金額は年に数千円から数万円程度で、扶養の判定には影響しません。',
    notes: [r.residentTax.note],
    sourceIds: r.residentTax.sourceIds,
    plan: null,
  };
}

function supporterTaxWalls(a: Answers, p: Projection, r: RuleSet): Wall[] {
  const tier = supporterTier(a.supporterSalary, r);
  const spouseLine = r.spouseDeduction.spouseIncomeLimit + r.salaryDeduction.minimum;
  const fullLine = spouseSpecialFullLine(r);
  const endLine = spouseSpecialEndLine(r);
  const value = p.calendarTaxable;

  if (tier === 3) {
    return [
      {
        id: 'spouseDeduction',
        group: 'supporter_tax',
        title: '配偶者控除',
        lead: '扶養する人（夫など）の税金が安くなる控除です。',
        status: 'na',
        confidence: 'estimate',
        unit: 'yen',
        threshold: null,
        thresholdKind: 'atMost',
        value,
        margin: null,
        marginHours: null,
        basis: '扶養する人の合計所得',
        consequence: '扶養する人の合計所得が1,000万円を超えるため、あなたの年収に関係なく、配偶者控除・配偶者特別控除は受けられません。',
        notes: ['扶養する人の収入が給与だけの場合として計算しています。'],
        sourceIds: r.spouseDeduction.sourceIds,
        plan: null,
      },
    ];
  }

  const notes = [...calendarNotes(p)];
  if (tier === null) {
    notes.push('扶養する人の年収が未入力のため、控除額は900万円以下の場合で表示しています。');
  }
  notes.push('住民税の控除額は所得税と異なります（配偶者控除は最大33万円）。');
  const t = tier ?? 0;
  const now = spouseDeductionAmount(value, t, r);
  const extra = [{ label: '今の見込みでの控除額（所得税）', value: now.amount > 0 ? yen(now.amount) : 'なし' }];
  const conf: Confidence = tier === null ? 'needs_check' : 'estimate';

  const m1 = spouseLine - value;
  const m2 = fullLine - value;
  return [
    {
      id: 'spouseDeduction',
      group: 'supporter_tax',
      title: `配偶者控除（${man(spouseLine)}）`,
      lead: '扶養する人（夫など）が配偶者控除を受けられる上限です。',
      status: statusFromMargin(m1, r.nearMarginYen, 'atMost'),
      confidence: conf,
      unit: 'yen',
      threshold: spouseLine,
      thresholdKind: 'atMost',
      value,
      margin: m1,
      marginHours: hours(m1, a),
      basis: '1〜12月に支払われる給与の合計（通勤手当は含めない）',
      consequence: `超えても、${man(fullLine)}までは配偶者特別控除で同じ額の控除が受けられます。夫の会社の配偶者手当の条件には注意してください。`,
      notes,
      sourceIds: r.spouseDeduction.sourceIds,
      plan: plan(spouseLine, 'atMost', a, p, false),
      extra,
    },
    {
      id: 'spouseSpecialFull',
      group: 'supporter_tax',
      title: `配偶者特別控除の満額（${man(fullLine)}）`,
      lead: '扶養する人の控除が減り始める金額です。',
      status: statusFromMargin(m2, r.nearMarginYen, 'atMost'),
      confidence: conf,
      unit: 'yen',
      threshold: fullLine,
      thresholdKind: 'atMost',
      value,
      margin: m2,
      marginHours: hours(m2, a),
      basis: '1〜12月に支払われる給与の合計（通勤手当は含めない）',
      consequence: `超えると控除が段階的に減り、${man(endLine)}を超えるとなくなります。`,
      notes,
      sourceIds: r.spouseDeduction.sourceIds,
      plan: plan(fullLine, 'atMost', a, p, false),
      extra,
    },
  ];
}

interface EnrollResult {
  wall: Wall;
  /** 勤務先の社会保険に入る条件を満たす */
  mustEnroll: boolean;
}

function employerInsuredState(a: Answers): 'yes' | 'no' | 'unknown' {
  if (a.employerType === 'corp') return 'yes';
  return a.employerInsured;
}

function threeQuarterWall(a: Answers, r: RuleSet): EnrollResult {
  const insured = employerInsuredState(a);
  const ftHours = a.fulltimeWeeklyHours ?? 40;
  const line = round1(ftHours * r.threeQuarter.ratio);
  const margin = round1(line - a.weeklyHours);
  const hoursMet = a.weeklyHours >= ftHours * r.threeQuarter.ratio;
  let daysMet: boolean | null = null;
  if (a.monthlyDays !== null && a.fulltimeMonthlyDays !== null) {
    daysMet = a.monthlyDays >= a.fulltimeMonthlyDays * r.threeQuarter.ratio;
  }
  const notes: string[] = [];
  if (a.fulltimeWeeklyHours === null) notes.push('正社員の所定労働時間が未入力のため、週40時間として計算しています。');
  if (daysMet === null) notes.push('月の労働日数も正社員の4分の3以上かどうかで判定します。日数が未入力のため、時間だけで判定しています。');

  let status: WallStatus;
  let confidence: Confidence = notes.length ? 'estimate' : 'confirmed';
  let mustEnroll = false;

  if (insured === 'no') {
    status = 'na';
    notes.unshift('勤務先が社会保険の適用事業所ではないため、この基準はあてはまりません。');
  } else {
    const met = hoursMet && daysMet !== false;
    if (met) {
      status = 'over';
      mustEnroll = insured === 'yes';
    } else {
      status = margin <= r.nearMarginWeeklyHours ? 'near' : 'safe';
    }
    if (insured === 'unknown') {
      confidence = 'needs_check';
      notes.unshift('勤務先が社会保険の適用事業所かわからないため、適用事業所である場合として判定しています。');
      if (met) status = 'check';
    }
  }

  return {
    mustEnroll,
    wall: {
      id: 'threeQuarter',
      group: 'social',
      title: `正社員の4分の3（週${line}時間）`,
      lead: '勤務先の人数に関係なく、勤務先の社会保険に入る条件です。',
      status,
      confidence,
      unit: 'weeklyHours',
      threshold: line,
      thresholdKind: 'below',
      value: a.weeklyHours,
      margin,
      marginHours: null,
      basis: '契約上の週の労働時間と月の労働日数（正社員と比べる）',
      consequence: '勤務先の健康保険・厚生年金に入ることになり、年収に関係なく扶養から外れます。保険料は自分で払いますが、将来の年金が増えます。',
      notes,
      sourceIds: r.threeQuarter.sourceIds,
      plan: null,
    },
  };
}

function shortTimeWall(a: Answers, r: RuleSet, p: Projection, today: Date): EnrollResult {
  const st = r.shortTimeWorker;
  const date = isoDate(today);
  const insured = employerInsuredState(a);
  const notes: string[] = [];
  const reqSize = sizeRequirementOn(date, r);
  const eligibleFrom = sizeEligibleFrom(a.employerSize, r);
  const sizeMet: boolean | null =
    a.employerSize === 'unknown' || reqSize === null ? null : SIZE_MIN[a.employerSize] >= reqSize;

  const wageRequired = st.wageRequirementEndsOn === null || date < st.wageRequirementEndsOn;
  const wageMet = !wageRequired || p.contractMonthlyWage >= st.monthlyWage;
  const hoursMet = a.weeklyHours >= st.minWeeklyHours;
  const margin = round1(st.minWeeklyHours - a.weeklyHours);

  let status: WallStatus;
  let confidence: Confidence = 'estimate';
  let mustEnroll = false;

  if (insured === 'no') {
    status = 'na';
    notes.push('勤務先が社会保険の適用事業所ではないため、この条件はあてはまりません。');
  } else if (a.student) {
    status = 'na';
    notes.push('学生（昼間の学生）は、この条件の対象外です。休学中や夜間の学生は対象になる場合があります。');
  } else if (sizeMet === false) {
    status = 'na';
    if (eligibleFrom) {
      notes.push(`勤務先の人数では、${jpDate(eligibleFrom)}から対象になる予定です。そのときに週${st.minWeeklyHours}時間以上なら、勤務先の社会保険に入ることになります。`);
    }
  } else {
    const met = hoursMet && wageMet && a.expectedOverTwoMonths;
    if (met) {
      status = sizeMet === null || insured === 'unknown' ? 'check' : 'over';
      mustEnroll = status === 'over';
    } else {
      status = hoursMet ? 'safe' : margin <= r.nearMarginWeeklyHours ? 'near' : 'safe';
    }
    if (sizeMet === null) {
      confidence = 'needs_check';
      notes.push('勤務先で厚生年金に入っている人数がわからないため、対象の勤務先である場合として判定しています。');
    }
    if (insured === 'unknown') confidence = 'needs_check';
    if (hoursMet && !wageMet) {
      notes.push(`契約上の月給が${yen(st.monthlyWage)}未満のため、今は対象外です。`);
    }
  }
  if (st.wageRequirementEndsOn && date < st.wageRequirementEndsOn) {
    notes.push(`月${yen(st.monthlyWage)}の賃金要件は${jpDate(st.wageRequirementEndsOn)}に撤廃される予定です。`);
  } else if (st.wageRequirementEndsOn) {
    notes.push('月8.8万円（年106万円）の賃金要件は撤廃されています（撤廃の施行は要確認）。週の時間だけで判定します。');
  }
  const futureSteps = st.sizeSchedule.filter((s) => s.from > date);
  if (futureSteps.length && status !== 'na') {
    notes.push(`対象の勤務先は段階的に広がります（${futureSteps.map((s) => `${jpDate(s.from)} ${s.minSize === 1 ? '人数要件撤廃' : `${s.minSize}人以上`}`).join('、')}）。`);
  }

  return {
    mustEnroll,
    wall: {
      id: 'shortTime',
      group: 'social',
      title: `短時間で働く人の加入条件（週${st.minWeeklyHours}時間）`,
      lead: '一定の人数以上の勤務先で、週20時間以上働くと勤務先の社会保険に入る条件です。',
      status,
      confidence,
      unit: 'weeklyHours',
      threshold: st.minWeeklyHours,
      thresholdKind: 'below',
      value: a.weeklyHours,
      margin,
      marginHours: null,
      basis: `契約上の週の労働時間${wageRequired ? '・月給' : ''}、勤務先で厚生年金に入っている人数、2か月を超えて働く見込み`,
      consequence: '勤務先の健康保険・厚生年金に入ることになり、年収に関係なく扶養から外れます。',
      notes,
      sourceIds: st.sourceIds,
      plan: null,
    },
  };
}

function healthDependentWall(a: Answers, p: Projection, r: RuleSet, records: Records, today: Date, enrolled: boolean): Wall {
  const h = r.healthDependent;
  const senior = a.age !== null && a.age >= h.seniorAge;
  const threshold = senior ? h.seniorLimit : h.limit;
  const notes: string[] = [];

  if (a.supporterInsurance === 'kokuho') {
    return {
      id: 'healthDependent',
      group: 'social',
      title: '健康保険の扶養',
      lead: '扶養する人の健康保険に、保険料なしで入れる条件です。',
      status: 'na',
      confidence: 'estimate',
      unit: 'yen',
      threshold: null,
      thresholdKind: 'below',
      value: null,
      margin: null,
      marginHours: null,
      basis: '扶養する人の健康保険の種類',
      consequence: '国民健康保険には「扶養」の仕組みがないため、この壁はありません。ご自身の国民健康保険料・国民年金保険料がかかります。',
      notes: ['勤務先の社会保険に入る条件（下の項目）を満たす場合は、勤務先の保険に入ります。'],
      sourceIds: h.sourceIds,
      plan: null,
    };
  }

  const contractBased =
    isoDate(today) >= h.contractBasisFrom && !a.shiftBased && a.contractTerm === 'over1y';
  let value: number;
  let basis: string;
  let confidence: Confidence = 'estimate';

  if (contractBased) {
    value = p.contractAnnual;
    basis = '労働条件通知書などに書かれた契約内容から見込む年収（通勤手当・賞与を含む）';
    notes.push('契約内容で判定するため、一時的な残業で収入が増えても、すぐに扶養から外れるとは限りません。ただし契約の見直し（時給・時間の変更）があれば、その内容で判定し直されます。');
  } else {
    // 今後1年間の見込み（直近のペースから）
    value = floorYen(p.paceGross * 12 + a.bonusAnnual + a.otherIncome);
    basis = '今後1年間の収入の見込み（通勤手当・賞与を含む）。1〜12月の合計ではありません';
    if (a.shiftBased) notes.push('シフト制などで契約上の時間がはっきりしない場合は、給与明細などの実績から見込みます。');
    if (a.contractTerm === 'under1y') notes.push('契約期間が1年未満の場合は、給与明細などの実績から見込みます。');
    if (a.contractTerm === 'unknown') notes.push('契約期間がわからないため、実績から見込む方法で判定しています。');
    if (p.paceFrom === 'contract') notes.push('給与の記録がないため、契約内容から見込んでいます。');
  }

  const margin = threshold - value;
  let status = statusFromMargin(margin, r.nearMarginYen, 'below');

  // 月額の目安
  const overMonths = Object.values(records).filter((x) => x && x.gross >= h.monthlyGuide).length;
  if (overMonths > 0) {
    notes.push(`月の収入が${yen(h.monthlyGuide)}以上の月が${overMonths}か月あります。健康保険組合によっては、月額がこの金額を超える状態が続くと扶養から外れる扱いをしています。`);
    if (status === 'safe') status = 'near';
  }

  if (a.sameHousehold === 'yes' && a.supporterSalary !== null && value >= a.supporterSalary / 2) {
    notes.push('同じ世帯の場合、扶養する人の年収の半分未満であることも条件です。この条件を満たさない見込みのため、保険者への確認が必要です。');
    status = status === 'over' ? 'over' : 'check';
    confidence = 'needs_check';
  }
  if (a.sameHousehold === 'no') {
    notes.push('別の世帯の場合、扶養する人からの仕送り額より年収が少ないことも条件です。保険者への確認が必要です。');
    confidence = 'needs_check';
  }
  if (a.sameHousehold === 'unknown') confidence = 'needs_check';
  if (a.supporterInsurance === 'kumiai') {
    notes.push('健康保険組合は、判定の細かい運用が組合ごとに異なることがあります。最終的な判断は組合が行います。');
  }
  if (a.supporterInsurance === 'unknown') {
    notes.push('扶養する人の健康保険の種類がわからないため、会社員の健康保険の場合として判定しています。');
    confidence = 'needs_check';
  }
  if (senior) notes.push(`${h.seniorAge}歳以上のため、上限は${man(h.seniorLimit)}です。`);
  if (enrolled) {
    notes.unshift('勤務先の社会保険に入る条件を満たしているため、年収に関係なく扶養から外れます。');
    status = 'over';
  }

  const rate = r.takeHome.employeeInsuranceRate;
  const breakEven = floorYen(threshold / (1 - rate));

  return {
    id: 'healthDependent',
    group: 'social',
    title: `健康保険の扶養（${man(threshold)}）`,
    lead: '扶養する人の健康保険に、保険料なしで入れる上限です。国民年金の第3号も同じ基準です。',
    status,
    confidence,
    unit: 'yen',
    threshold,
    thresholdKind: 'below',
    value,
    margin,
    marginHours: hours(margin, a),
    basis,
    consequence: `扶養から外れ、ご自身で健康保険料・年金保険料を払うことになります。手取りが${man(threshold)}未満のときと同じに戻るのは、年収およそ${man(breakEven)}からです（概算）。`,
    notes,
    sourceIds: h.sourceIds,
    plan: null,
    extra: contractBased
      ? [{ label: '契約上の週の時間をあと何時間増やせるか', value: a.hourlyWage > 0 && margin > 0 ? `週${round1(margin / a.hourlyWage / 52)}時間` : 'なし' }]
      : [{ label: '今のペース（1か月あたり）', value: yen(p.paceGross) }],
  };
}

function allowanceWall(a: Answers, p: Projection, r: RuleSet): Wall | null {
  if (a.allowance === 'no') return null;
  if (a.allowance === 'unknown' || a.allowanceLimit === null) {
    return {
      id: 'allowance',
      group: 'allowance',
      title: '配偶者手当（会社）',
      lead: '扶養する人の会社から出る手当です。会社ごとに条件が違います。',
      status: 'check',
      confidence: 'needs_check',
      unit: 'yen',
      threshold: null,
      thresholdKind: 'atMost',
      value: null,
      margin: null,
      marginHours: null,
      basis: '会社の就業規則・給与規程',
      consequence: '条件を超えると手当がなくなります。年に数万円から数十万円になることもあり、税金の壁より影響が大きい場合があります。',
      notes: ['扶養する人の会社の就業規則で、手当の有無と年収の条件を確認し、設定から入力してください。'],
      sourceIds: [],
      plan: null,
    };
  }
  const threshold = a.allowanceLimit;
  const margin = threshold - p.calendarGross;
  return {
    id: 'allowance',
    group: 'allowance',
    title: `配偶者手当（${man(threshold)}）`,
    lead: '扶養する人の会社から出る手当の条件です。',
    status: statusFromMargin(margin, r.nearMarginYen, 'atMost'),
    confidence: 'needs_check',
    unit: 'yen',
    threshold,
    thresholdKind: 'atMost',
    value: p.calendarGross,
    margin,
    marginHours: hours(margin, a),
    basis: '1〜12月の給与の合計（通勤手当を含む安全側の計算）',
    consequence: '条件を超えると、扶養する人の手当がなくなります。',
    notes: [
      '会社によって、通勤手当を含めるか、税金の基準か健康保険の基準かが違います。ここでは通勤手当を含めた多めの金額で判定しています。',
      ...calendarNotes(p),
    ],
    sourceIds: [],
    plan: plan(threshold, 'atMost', a, p, true),
  };
}

const STATUS_ORDER: Record<WallStatus, number> = { over: 0, check: 1, near: 2, safe: 3, na: 4 };

export function evaluate(a: Answers, records: Records, rules: RuleSet, today: Date): Evaluation {
  const year = rules.meta.year;
  const p = project(a, records, year, today);

  const tq = threeQuarterWall(a, rules);
  const st = shortTimeWall(a, rules, p, today);
  const enrolled = tq.mustEnroll || st.mustEnroll;

  const walls: Wall[] = [
    healthDependentWall(a, p, rules, records, today, enrolled),
    ...supporterTaxWalls(a, p, rules),
    incomeTaxWall(a, p, rules),
    residentTaxWall(a, p, rules),
    tq.wall,
    st.wall,
  ];
  const allowance = allowanceWall(a, p, rules);
  if (allowance) walls.push(allowance);

  // 状態の重い順、同じ状態なら余裕の少ない順
  walls.sort((x, y) => {
    const s = STATUS_ORDER[x.status] - STATUS_ORDER[y.status];
    if (s !== 0) return s;
    const mx = x.unit === 'yen' && x.margin !== null ? x.margin : Number.POSITIVE_INFINITY;
    const my = y.unit === 'yen' && y.margin !== null ? y.margin : Number.POSITIVE_INFINITY;
    return mx - my;
  });

  const candidates = walls.filter(
    (w) => w.unit === 'yen' && w.margin !== null && w.margin > 0 && w.status !== 'na' && w.id !== 'residentTax',
  );
  candidates.sort((x, y) => x.margin! - y.margin!);

  return { year, projection: p, walls, nearest: candidates[0] ?? null };
}

/* ---------- 表示用の小さなヘルパー（エンジンの説明文で使う） ---------- */

export function yen(n: number): string {
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

export function man(n: number): string {
  const v = n / 10_000;
  const s = Number.isInteger(v) ? v.toLocaleString('ja-JP') : (Math.round(v * 10) / 10).toLocaleString('ja-JP');
  return `${s}万円`;
}

function jpDate(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}年${m}月`;
}
