import { describe, expect, it } from 'vitest';
import { rules2026 as r } from '../rules/2026';
import {
  evaluate,
  project,
  sizeEligibleFrom,
  sizeRequirementOn,
  spouseDeductionAmount,
  supporterTier,
} from './evaluate';
import type { Answers, Records } from './types';

const base: Answers = {
  age: 40,
  supporterInsurance: 'kyokai',
  sameHousehold: 'yes',
  supporterSalary: 6_000_000,
  allowance: 'no',
  allowanceLimit: null,
  employerType: 'corp',
  employerInsured: 'yes',
  employerSize: '1-10',
  hourlyWage: 1_200,
  weeklyHours: 15,
  monthlyDays: 12,
  fulltimeWeeklyHours: 40,
  fulltimeMonthlyDays: 21,
  shiftBased: false,
  contractTerm: 'over1y',
  expectedOverTwoMonths: true,
  commuteMonthly: 0,
  bonusAnnual: 0,
  student: false,
  otherIncome: 0,
};

const nov = new Date(2026, 10, 1);
const wall = (e: ReturnType<typeof evaluate>, id: string) => e.walls.find((w) => w.id === id)!;

/** 1〜12月すべてを同じ額で記録する */
function fullYear(gross: number, commute = 0): Records {
  const rec: Records = {};
  for (let m = 1; m <= 12; m++) rec[m] = { gross, commute, hours: null };
  return rec;
}

describe('所得税（178万円）', () => {
  /** 年の合計がちょうど total 円になる記録 */
  const exactYear = (total: number): Records => {
    const rec = fullYear(Math.floor(total / 12));
    rec[12] = { gross: total - Math.floor(total / 12) * 11, commute: 0, hours: null };
    return rec;
  };
  it('ちょうど178万円なら超えない', () => {
    const rec = exactYear(1_780_000);
    const e = evaluate(base, rec, r, nov);
    const w = wall(e, 'incomeTax');
    expect(w.threshold).toBe(1_780_000);
    expect(w.status).not.toBe('over');
  });
  it('1円でも超えれば超える', () => {
    const rec = exactYear(1_780_001);
    expect(wall(evaluate(base, rec, r, nov), 'incomeTax').status).toBe('over');
  });
  it('通勤手当は税金の計算に含めない', () => {
    const rec = fullYear(160_000, 20_000); // 課税分は年168万
    const w = wall(evaluate(base, rec, r, nov), 'incomeTax');
    expect(w.value).toBe(1_680_000);
  });
});

describe('配偶者控除・配偶者特別控除', () => {
  it('136万円以下は配偶者控除38万円', () => {
    expect(spouseDeductionAmount(1_360_000, 0, r)).toEqual({ kind: 'spouse', amount: 380_000 });
  });
  it('136万円を超えると配偶者特別控除、169万円までは満額', () => {
    expect(spouseDeductionAmount(1_360_001, 0, r)).toEqual({ kind: 'special', amount: 380_000 });
    expect(spouseDeductionAmount(1_690_000, 0, r)).toEqual({ kind: 'special', amount: 380_000 });
    expect(spouseDeductionAmount(1_690_001, 0, r)).toEqual({ kind: 'special', amount: 360_000 });
  });
  it('207万円を超えると控除なし', () => {
    expect(spouseDeductionAmount(2_070_000, 0, r).amount).toBe(30_000);
    expect(spouseDeductionAmount(2_070_001, 0, r)).toEqual({ kind: 'none', amount: 0 });
  });
  it('扶養する人の所得による区分', () => {
    expect(supporterTier(10_950_000, r)).toBe(0);
    expect(supporterTier(10_950_001, r)).toBe(1);
    expect(supporterTier(11_950_000, r)).toBe(2);
    expect(supporterTier(11_950_001, r)).toBe(3);
    expect(supporterTier(null, r)).toBeNull();
  });
  it('扶養する人の所得が1,000万円超なら対象外', () => {
    const e = evaluate({ ...base, supporterSalary: 13_000_000 }, {}, r, nov);
    expect(wall(e, 'spouseDeduction').status).toBe('na');
  });
});

describe('健康保険の扶養（130万円）', () => {
  it('契約内容で判定する（年1,300,000円ちょうどは「未満」ではないので超える）', () => {
    // 時給1250円 × 20時間 × 52週 = 1,300,000円
    const a = { ...base, hourlyWage: 1_250, weeklyHours: 20, employerSize: '1-10' as const };
    const w = wall(evaluate(a, {}, r, nov), 'healthDependent');
    expect(w.value).toBe(1_300_000);
    expect(w.status).toBe('over');
  });
  it('契約内容で判定する場合、残業で実績が増えても契約額で判定する', () => {
    const rec = fullYear(150_000);
    const w = wall(evaluate(base, rec, r, nov), 'healthDependent');
    expect(w.value).toBe(1_200 * 15 * 52);
    expect(w.status).not.toBe('over');
    // 月108,334円以上の月があるので注意喚起は出る
    expect(w.status).toBe('near');
  });
  it('シフト制なら実績のペースで判定する', () => {
    const rec = fullYear(120_000);
    const w = wall(evaluate({ ...base, shiftBased: true }, rec, r, nov), 'healthDependent');
    expect(w.value).toBe(1_440_000);
    expect(w.status).toBe('over');
  });
  it('2026年4月より前は実績のペースで判定する', () => {
    const rec: Records = { 1: { gross: 120_000, commute: 0, hours: null } };
    const w = wall(evaluate(base, rec, r, new Date(2026, 1, 1)), 'healthDependent');
    expect(w.value).toBe(1_440_000);
  });
  it('通勤手当を含める', () => {
    const w = wall(evaluate({ ...base, commuteMonthly: 10_000 }, {}, r, nov), 'healthDependent');
    expect(w.value).toBe(1_200 * 15 * 52 + 120_000);
  });
  it('60歳以上は180万円', () => {
    const w = wall(evaluate({ ...base, age: 60 }, {}, r, nov), 'healthDependent');
    expect(w.threshold).toBe(1_800_000);
  });
  it('扶養する人が国民健康保険なら対象外', () => {
    const w = wall(evaluate({ ...base, supporterInsurance: 'kokuho' }, {}, r, nov), 'healthDependent');
    expect(w.status).toBe('na');
  });
  it('勤務先の社会保険に入る条件を満たせば、年収に関係なく扶養から外れる', () => {
    const a = { ...base, hourlyWage: 1_000, weeklyHours: 30, monthlyDays: 20 };
    const w = wall(evaluate(a, {}, r, nov), 'healthDependent');
    expect(w.status).toBe('over');
  });
});

describe('4分の3基準', () => {
  it('週30時間・月16日（正社員40時間・21日）なら加入', () => {
    const w = wall(evaluate({ ...base, weeklyHours: 30, monthlyDays: 16 }, {}, r, nov), 'threeQuarter');
    expect(w.status).toBe('over');
  });
  it('時間が4分の3以上でも日数が足りなければ加入しない', () => {
    const w = wall(evaluate({ ...base, weeklyHours: 30, monthlyDays: 15 }, {}, r, nov), 'threeQuarter');
    expect(w.status).not.toBe('over');
  });
  it('適用事業所でない個人事業なら対象外', () => {
    const a = { ...base, employerType: 'sole' as const, employerInsured: 'no' as const, weeklyHours: 35, monthlyDays: 20 };
    expect(wall(evaluate(a, {}, r, nov), 'threeQuarter').status).toBe('na');
  });
});

describe('短時間で働く人の加入条件', () => {
  it('企業規模要件の段階的な縮小', () => {
    expect(sizeRequirementOn('2026-11-01', r)).toBe(51);
    expect(sizeRequirementOn('2027-10-01', r)).toBe(36);
    expect(sizeEligibleFrom('36-50', r)).toBe('2027-10-01');
    expect(sizeEligibleFrom('1-10', r)).toBe('2035-10-01');
  });
  it('51人以上・週20時間以上なら加入（2026年10月以降は月給の要件なし）', () => {
    const a = { ...base, employerSize: '51+' as const, weeklyHours: 20, hourlyWage: 1_000 };
    expect(wall(evaluate(a, {}, r, nov), 'shortTime').status).toBe('over');
  });
  it('2026年10月より前は月8.8万円未満なら加入しない', () => {
    const a = { ...base, employerSize: '51+' as const, weeklyHours: 20, hourlyWage: 1_000 }; // 月86,666円
    expect(wall(evaluate(a, {}, r, new Date(2026, 8, 1)), 'shortTime').status).not.toBe('over');
  });
  it('学生は対象外', () => {
    const a = { ...base, employerSize: '51+' as const, weeklyHours: 25, student: true };
    expect(wall(evaluate(a, {}, r, nov), 'shortTime').status).toBe('na');
  });
  it('50人以下の勤務先は今は対象外', () => {
    const a = { ...base, employerSize: '36-50' as const, weeklyHours: 25, monthlyDays: 10 };
    expect(wall(evaluate(a, {}, r, nov), 'shortTime').status).toBe('na');
  });
});

describe('見込みの計算', () => {
  it('記録がなければ契約から、あれば直近3か月の平均から見込む', () => {
    const p0 = project(base, {}, 2026, nov);
    expect(p0.paceFrom).toBe('contract');
    const p1 = project(base, { 8: { gross: 90_000, commute: 0, hours: null }, 9: { gross: 100_000, commute: 0, hours: null }, 10: { gross: 110_000, commute: 0, hours: null } }, 2026, nov);
    expect(p1.paceFrom).toBe('records');
    expect(p1.paceGross).toBe(100_000);
    expect(p1.calendarGross).toBe(300_000 + 100_000 * 9);
    expect(p1.missingPastMonths).toBe(7);
  });
  it('賞与とほかの給与を年の見込みに足す', () => {
    const p = project({ ...base, bonusAnnual: 50_000, otherIncome: 100_000 }, fullYear(100_000), 2026, nov);
    expect(p.calendarGross).toBe(1_350_000);
  });
});

describe('配偶者手当', () => {
  it('条件の金額を入力すると、通勤手当込みの金額で判定する', () => {
    const a = { ...base, allowance: 'yes' as const, allowanceLimit: 1_030_000 };
    const w = wall(evaluate(a, fullYear(90_000, 5_000), r, nov), 'allowance');
    expect(w.value).toBe(1_080_000);
    expect(w.status).toBe('over');
  });
});

describe('今年の残りの逆算', () => {
  it('11月時点で記録がなければ、過ぎた月はペースで固定し、11・12月の2か月で逆算する', () => {
    const a = { ...base, hourlyWage: 1_000, weeklyHours: 20 }; // 月86,666円
    const e = evaluate(a, {}, r, nov);
    const w = wall(e, 'incomeTax');
    expect(w.plan!.remainingMonths).toBe(2);
    expect(w.plan!.maxMonthly).toBe(Math.floor((1_780_000 - 86_666 * 10) / 2));
  });
});
