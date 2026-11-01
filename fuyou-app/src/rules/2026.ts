import type { RuleSet } from './types';

/**
 * 2026年（令和8年）分のルール。
 *
 * 注意: 監修前のデータ。二次資料を含む調査（2026-11-01時点）にもとづく。
 * 監修時に一次資料（国税庁・厚生労働省・日本年金機構）で確認し、
 * reviewStatus を 'reviewed' に、reviewer に監修者名を入れること。
 */
export const rules2026: RuleSet = {
  meta: {
    year: 2026,
    reviewStatus: 'unreviewed',
    lastChecked: '2026-11-01',
    reviewer: null,
  },

  sources: {
    taxReform2026: {
      id: 'taxReform2026',
      title: '令和8年度税制改正（基礎控除・給与所得控除の引上げ）の解説（TKC）',
      url: 'https://www.tkc.jp/consolidate/webcolumn/column202605_1_col01/',
      kind: 'secondary',
    },
    taxReform2026b: {
      id: 'taxReform2026b',
      title: '基礎控除及び給与所得控除の引上げ（PROnet）',
      url: 'https://profession-net.com/professionjournal/income-report-192/',
      kind: 'secondary',
    },
    spouseDeduction: {
      id: 'spouseDeduction',
      title: '配偶者控除・配偶者特別控除の解説（マネーフォワード）',
      url: 'https://biz.moneyforward.com/tax_return/basic/49699/',
      kind: 'secondary',
    },
    ntaSpouse: {
      id: 'ntaSpouse',
      title: '国税庁 タックスアンサー 配偶者控除',
      url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1191.htm',
      kind: 'primary',
    },
    residentTaxChuo: {
      id: 'residentTaxChuo',
      title: '住民税の配偶者控除（中央区）',
      url: 'https://www.city.chuo.lg.jp/kurasi/zeikin/zyuminzei/syotokukozyo/haigusya.html',
      kind: 'primary',
    },
    mhlwDependent: {
      id: 'mhlwDependent',
      title: '厚生労働省 事務連絡（労働契約の内容による被扶養者の年間収入の判定）',
      url: 'https://www.mhlw.go.jp/hourei/doc/tsuchi/T260310S0010.pdf',
      kind: 'primary',
    },
    nenkinNotice: {
      id: 'nenkinNotice',
      title: '日本年金機構 事業主の皆さまへのお知らせ',
      url: 'https://www.nenkin.go.jp/oshirase/taisetu/jigyosho/2026/202605/0501.html',
      kind: 'primary',
    },
    mhlwExpansionQa: {
      id: 'mhlwExpansionQa',
      title: '厚生労働省 社会保険適用拡大 Q&A',
      url: 'https://www.mhlw.go.jp/tekiyoukakudai/qa',
      kind: 'primary',
    },
    mhlwExpansionDoc: {
      id: 'mhlwExpansionDoc',
      title: '厚生労働省 被用者保険の適用拡大に関する資料',
      url: 'https://www.mhlw.go.jp/content/12500000/001633788.pdf',
      kind: 'primary',
    },
  },

  salaryDeduction: {
    // 本則69万円＋特例5万円（令和8・9年分）
    minimum: 740_000,
    // 給与収入が約210万円までは最低保障額が適用されることを確認済み
    validUpTo: 2_100_000,
    sourceIds: ['taxReform2026', 'taxReform2026b'],
  },

  incomeTax: {
    // 本則62万円＋特例42万円（合計所得489万円以下、令和8・9年分）
    basicDeduction: 1_040_000,
    sourceIds: ['taxReform2026', 'taxReform2026b'],
  },

  residentTax: {
    conservativeLine: 1_000_000,
    note:
      '住民税がかかり始める年収は、お住まいの自治体や家族構成で変わります。' +
      'ここでは全国で安全側になる目安（100万円）を使っています。正確な金額は市区町村にご確認ください。',
    sourceIds: ['residentTaxChuo'],
  },

  spouseDeduction: {
    spouseIncomeLimit: 620_000,
    amounts: [380_000, 260_000, 130_000],
    supporterIncomeSteps: [9_000_000, 9_500_000, 10_000_000],
    supporterSalaryDeductionCap: 1_950_000,
    specialTiers: [
      { maxSpouseIncome: 950_000, amounts: [380_000, 260_000, 130_000] },
      { maxSpouseIncome: 1_000_000, amounts: [360_000, 240_000, 120_000] },
      { maxSpouseIncome: 1_050_000, amounts: [310_000, 210_000, 110_000] },
      { maxSpouseIncome: 1_100_000, amounts: [260_000, 180_000, 90_000] },
      { maxSpouseIncome: 1_150_000, amounts: [210_000, 140_000, 70_000] },
      { maxSpouseIncome: 1_200_000, amounts: [160_000, 110_000, 60_000] },
      { maxSpouseIncome: 1_250_000, amounts: [110_000, 80_000, 40_000] },
      { maxSpouseIncome: 1_300_000, amounts: [60_000, 40_000, 20_000] },
      { maxSpouseIncome: 1_330_000, amounts: [30_000, 20_000, 10_000] },
    ],
    sourceIds: ['spouseDeduction', 'ntaSpouse', 'taxReform2026'],
  },

  healthDependent: {
    limit: 1_300_000,
    seniorLimit: 1_800_000,
    seniorAge: 60,
    monthlyGuide: 108_334,
    contractBasisFrom: '2026-04-01',
    sourceIds: ['mhlwDependent', 'nenkinNotice'],
  },

  shortTimeWorker: {
    minWeeklyHours: 20,
    monthlyWage: 88_000,
    // 撤廃予定日。施行が確定したかを一次資料で要確認
    wageRequirementEndsOn: '2026-10-01',
    sizeSchedule: [
      { from: '2024-10-01', minSize: 51 },
      { from: '2027-10-01', minSize: 36 },
      { from: '2029-10-01', minSize: 21 },
      { from: '2032-10-01', minSize: 11 },
      { from: '2035-10-01', minSize: 1 },
    ],
    sourceIds: ['mhlwExpansionDoc', 'mhlwExpansionQa'],
  },

  threeQuarter: {
    ratio: 0.75,
    sourceIds: ['mhlwExpansionQa'],
  },

  takeHome: {
    employeeInsuranceRate: 0.15,
    note:
      '勤務先の健康保険・厚生年金に入った場合の本人負担を、年収の約15%として概算しています。' +
      '実際の保険料は保険者・年齢・標準報酬月額で変わります。',
  },

  nearMarginYen: 100_000,
  nearMarginWeeklyHours: 2,
};
