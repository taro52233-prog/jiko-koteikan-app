/**
 * 制度ルールの型。
 * 金額や条件はプログラムに直接書かず、年ごとのルールデータとして持つ。
 * 法改正のときは、このデータを差し替えるだけで済むようにする。
 */

export type SourceKind = 'primary' | 'secondary';

export interface Source {
  id: string;
  title: string;
  url: string;
  /** primary = 官公庁などの一次資料、secondary = 解説記事などの二次資料 */
  kind: SourceKind;
}

/** 監修の状態。unreviewed のあいだは画面に「監修前」と表示する */
export type ReviewStatus = 'unreviewed' | 'reviewed';

export interface RuleMeta {
  /** 何年分（1〜12月）のルールか */
  year: number;
  reviewStatus: ReviewStatus;
  /** 最後に資料を確認した日 */
  lastChecked: string;
  reviewer: string | null;
}

export interface SpouseSpecialTier {
  /** 配偶者の合計所得金額の上限（この金額以下） */
  maxSpouseIncome: number;
  /** 扶養する側の合計所得 900万以下 / 950万以下 / 1,000万以下 のときの控除額 */
  amounts: [number, number, number];
}

export interface SizeStep {
  /** この日から */
  from: string;
  /** 厚生年金の被保険者がこの人数以上の勤務先が対象 */
  minSize: number;
}

export interface RuleSet {
  meta: RuleMeta;
  sources: Record<string, Source>;

  /** 給与所得控除（このアプリで扱う年収の範囲では最低保障額が適用される） */
  salaryDeduction: {
    minimum: number;
    /** 最低保障額がそのまま使えることを確認済みの給与収入の上限 */
    validUpTo: number;
    sourceIds: string[];
  };

  /** 本人の所得税 */
  incomeTax: {
    basicDeduction: number;
    sourceIds: string[];
  };

  /** 本人の住民税（自治体ごとに異なるため目安のみ） */
  residentTax: {
    /** 安全側の目安（これ以下ならほぼ全国でかからない） */
    conservativeLine: number;
    note: string;
    sourceIds: string[];
  };

  /** 扶養する側の配偶者控除・配偶者特別控除（所得税） */
  spouseDeduction: {
    /** 配偶者控除の対象になる配偶者の合計所得金額の上限 */
    spouseIncomeLimit: number;
    /** 扶養する側の合計所得 900万以下 / 950万以下 / 1,000万以下 のときの控除額 */
    amounts: [number, number, number];
    /** 扶養する側の合計所得の区切り */
    supporterIncomeSteps: [number, number, number];
    /** 扶養する側が給与のみの場合の、給与所得控除の上限額（高所得者） */
    supporterSalaryDeductionCap: number;
    specialTiers: SpouseSpecialTier[];
    sourceIds: string[];
  };

  /** 健康保険の被扶養者・国民年金第3号 */
  healthDependent: {
    limit: number;
    seniorLimit: number;
    seniorAge: number;
    /** 年収の上限を12で割った月額の目安（健保によってはこの月額で判断する） */
    monthlyGuide: number;
    /** 労働契約の内容で判定する取扱いの開始日 */
    contractBasisFrom: string;
    sourceIds: string[];
  };

  /** 勤務先の社会保険に加入する条件（短時間労働者） */
  shortTimeWorker: {
    minWeeklyHours: number;
    monthlyWage: number;
    /** 月額賃金の要件がなくなる日（null = なくならない） */
    wageRequirementEndsOn: string | null;
    sizeSchedule: SizeStep[];
    sourceIds: string[];
  };

  /** 4分の3基準 */
  threeQuarter: {
    ratio: number;
    sourceIds: string[];
  };

  /** 手取りの概算に使う本人負担の社会保険料率（目安） */
  takeHome: {
    employeeInsuranceRate: number;
    note: string;
  };

  /** 「もうすぐ超える」と表示する余裕の金額 */
  nearMarginYen: number;
  /** 「もうすぐ超える」と表示する週の時間の余裕 */
  nearMarginWeeklyHours: number;
}
