/**
 * 計算エンジンの入出力の型。
 * 画面（React）に依存しないので、Web・スマホアプリ・サーバーのどこでも使える。
 */

export type SupporterInsurance = 'kyokai' | 'kumiai' | 'kyosai' | 'kokuho' | 'unknown';
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type EmployerType = 'corp' | 'sole' | 'unknown';
/** 勤務先で厚生年金に入っている人数 */
export type EmployerSize = '51+' | '36-50' | '21-35' | '11-20' | '1-10' | 'unknown';
export type ContractTerm = 'over1y' | 'under1y' | 'unknown';

export interface Answers {
  /** 本人の年齢（12月31日時点） */
  age: number | null;
  supporterInsurance: SupporterInsurance;
  /** 扶養する人と同じ世帯（同居）か */
  sameHousehold: YesNoUnknown;
  /** 扶養する人の給与収入（年額・円）。null = わからない */
  supporterSalary: number | null;
  /** 扶養する人の会社の配偶者手当 */
  allowance: YesNoUnknown;
  /** 配偶者手当の条件になっている年収（円） */
  allowanceLimit: number | null;

  employerType: EmployerType;
  /** 勤務先が社会保険（健康保険・厚生年金）に入っている事業所か */
  employerInsured: YesNoUnknown;
  employerSize: EmployerSize;

  /** 時給（円） */
  hourlyWage: number;
  /** 契約上の週の労働時間 */
  weeklyHours: number;
  /** 契約上の月の労働日数 */
  monthlyDays: number | null;
  /** 正社員の週の所定労働時間 */
  fulltimeWeeklyHours: number | null;
  /** 正社員の月の所定労働日数 */
  fulltimeMonthlyDays: number | null;
  /** シフト制などで、契約に労働時間がはっきり書かれていない */
  shiftBased: boolean;
  contractTerm: ContractTerm;
  /** 2か月を超えて働く見込みがある */
  expectedOverTwoMonths: boolean;

  /** 通勤手当（月額・円） */
  commuteMonthly: number;
  /** 賞与の見込み（年額・円）。毎月の記録には含めない */
  bonusAnnual: number;
  student: boolean;
  /** ほかの勤務先からの給与（年額・円） */
  otherIncome: number;
}

export interface MonthRecord {
  /** 総支給額（通勤手当を含む、賞与は含めない） */
  gross: number;
  /** 通勤手当 */
  commute: number;
  /** 働いた時間 */
  hours: number | null;
}

/** キーは月（1〜12） */
export type Records = Partial<Record<number, MonthRecord>>;

export type WallStatus = 'safe' | 'near' | 'over' | 'check' | 'na';
export type Confidence = 'confirmed' | 'estimate' | 'needs_check';
export type WallGroup = 'self_tax' | 'supporter_tax' | 'social' | 'allowance';

export interface WallPlan {
  /** 残りの月で、1か月あたりこの額までなら超えない */
  maxMonthly: number;
  /** その場合の週あたりの労働時間の目安 */
  maxWeeklyHours: number;
  remainingMonths: number;
}

export interface Wall {
  id: string;
  group: WallGroup;
  title: string;
  /** 一言で何の壁か */
  lead: string;
  status: WallStatus;
  confidence: Confidence;
  /** 判定に使った金額・時間の単位 */
  unit: 'yen' | 'weeklyHours';
  threshold: number | null;
  /** 「以下」なら超えない、または「未満」なら超えない */
  thresholdKind: 'atMost' | 'below';
  /** 見込み額（または週の時間） */
  value: number | null;
  /** あと何円（または週あと何時間） */
  margin: number | null;
  /** 金額の余裕を時給で割った時間 */
  marginHours: number | null;
  basis: string;
  consequence: string;
  notes: string[];
  sourceIds: string[];
  plan: WallPlan | null;
  /** 補足の数字（夫の控除額など） */
  extra?: { label: string; value: string }[];
}

export interface Projection {
  /** 記録済みの月の数 */
  recordedMonths: number;
  /** 記録済みの総支給の合計（通勤手当込み） */
  ytdGross: number;
  ytdCommute: number;
  /** 記録のない月の1か月あたりの見込み（通勤手当込み） */
  paceGross: number;
  paceCommute: number;
  /** pace が実績からか、契約からか */
  paceFrom: 'records' | 'contract';
  /** 1〜12月の見込み（通勤手当込み、賞与・ほかの給与込み） */
  calendarGross: number;
  /** 1〜12月の見込み（通勤手当を除く＝税金の計算に使う額） */
  calendarTaxable: number;
  /** 契約内容から見込む年収（通勤手当・賞与・ほかの給与込み） */
  contractAnnual: number;
  /** 契約上の月給（通勤手当・残業・賞与を除く） */
  contractMonthlyWage: number;
  /** 記録のない月の数 */
  remainingMonths: number;
  /** 記録がなく、すでに過ぎた月の数（推定で埋めている） */
  missingPastMonths: number;
  /** 記録がなく、これから来る月の数（今月を含む）。逆算の対象 */
  futureMonths: number;
}

export interface Evaluation {
  year: number;
  projection: Projection;
  walls: Wall[];
  /** いちばん近い壁（金額の壁のうち、まだ超えていないもの） */
  nearest: Wall | null;
}
