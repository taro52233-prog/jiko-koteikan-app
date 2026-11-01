import { useMemo, useState, type ReactNode } from 'react';
import type { Answers } from '../engine/types';
import { BackChevron, ChoiceList, Group, NumberField } from './controls';

export type Draft = Partial<Answers>;

export const emptyDraft: Draft = {
  allowanceLimit: null,
  supporterSalary: null,
  monthlyDays: null,
  fulltimeWeeklyHours: 40,
  fulltimeMonthlyDays: null,
  commuteMonthly: 0,
  bonusAnnual: 0,
  otherIncome: 0,
  expectedOverTwoMonths: true,
};

interface Step {
  id: string;
  title: string;
  help?: string;
  when?: (d: Draft) => boolean;
  valid: (d: Draft) => boolean;
  /** 1つ選ぶだけの質問は、選んだら次へ進む */
  autoAdvance?: boolean;
  render: (d: Draft, set: (p: Draft) => void) => ReactNode;
}

const man = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 10_000);
const fromMan = (v: number | null) => (v === null ? null : Math.round(v * 10_000));

const steps: Step[] = [
  {
    id: 'age',
    title: 'あなたの年齢を教えてください',
    help: '今年の12月31日時点の年齢です。60歳以上は健康保険の扶養の上限が変わります。',
    valid: (d) => typeof d.age === 'number' && d.age >= 15 && d.age <= 110,
    render: (d, set) => (
      <Group>
        <NumberField label="年齢" unit="歳" value={d.age ?? null} onChange={(v) => set({ age: v === null ? undefined : Math.floor(v) })} placeholder="例 42" />
      </Group>
    ),
  },
  {
    id: 'supporterInsurance',
    title: '扶養してくれる人の健康保険は',
    help: '保険証（資格確認書）の「保険者名称」を見るとわかります。扶養してくれる人は、夫などを想定しています。',
    valid: (d) => !!d.supporterInsurance,
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.supporterInsurance}
        onChange={(v) => set({ supporterInsurance: v })}
        options={[
          { value: 'kyokai', label: '協会けんぽ', detail: '「全国健康保険協会」と書かれている' },
          { value: 'kumiai', label: '健康保険組合', detail: '「○○健康保険組合」と書かれている' },
          { value: 'kyosai', label: '共済組合', detail: '公務員・私立学校の教職員など' },
          { value: 'kokuho', label: '国民健康保険', detail: '自営業・フリーランスなど。国保組合も含む' },
          { value: 'unknown', label: 'わからない' },
        ]}
      />
    ),
  },
  {
    id: 'sameHousehold',
    title: '扶養してくれる人と一緒に住んでいますか',
    help: '同じ世帯かどうかで、健康保険の扶養の条件が少し変わります。',
    when: (d) => d.supporterInsurance !== 'kokuho',
    valid: (d) => !!d.sameHousehold,
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.sameHousehold}
        onChange={(v) => set({ sameHousehold: v })}
        options={[
          { value: 'yes', label: '一緒に住んでいる' },
          { value: 'no', label: '別に住んでいる', detail: '単身赴任など' },
          { value: 'unknown', label: 'わからない' },
        ]}
      />
    ),
  },
  {
    id: 'supporterSalary',
    title: '扶養してくれる人の年収は',
    help: '額面（税金などが引かれる前）の年収です。配偶者控除の額と、扶養の条件の確認に使います。わからなければ空欄のまま進めます。',
    valid: () => true,
    render: (d, set) => (
      <Group footer="給与収入だけの場合として計算します。">
        <NumberField label="年収" unit="万円" value={man(d.supporterSalary)} onChange={(v) => set({ supporterSalary: fromMan(v) })} placeholder="例 550" decimal />
      </Group>
    ),
  },
  {
    id: 'allowance',
    title: '扶養してくれる人の会社に、配偶者手当はありますか',
    help: '家族手当・扶養手当とも呼ばれます。会社ごとに「年収○万円以下」などの条件があり、税金より影響が大きいこともあります。',
    valid: (d) => !!d.allowance && (d.allowance !== 'yes' || (d.allowanceLimit ?? 0) > 0),
    render: (d, set) => (
      <>
        <ChoiceList
          value={d.allowance}
          onChange={(v) => set({ allowance: v })}
          options={[
            { value: 'yes', label: 'ある' },
            { value: 'no', label: 'ない' },
            { value: 'unknown', label: 'わからない' },
          ]}
        />
        {d.allowance === 'yes' && (
          <Group header="手当の条件" footer="就業規則や給与規程に書かれた、年収の上限を入力してください。">
            <NumberField label="年収の上限" unit="万円" value={man(d.allowanceLimit)} onChange={(v) => set({ allowanceLimit: fromMan(v) })} placeholder="例 103" decimal />
          </Group>
        )}
      </>
    ),
  },
  {
    id: 'employerType',
    title: 'あなたの勤務先は',
    help: '医療法人・株式会社などは「法人」です。院長個人が開業している医院は「個人事業」です。',
    valid: (d) => !!d.employerType,
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.employerType}
        onChange={(v) => set({ employerType: v, employerInsured: v === 'corp' ? 'yes' : d.employerInsured })}
        options={[
          { value: 'corp', label: '法人', detail: '医療法人、株式会社など' },
          { value: 'sole', label: '個人事業', detail: '個人で開業している医院・お店など' },
          { value: 'unknown', label: 'わからない' },
        ]}
      />
    ),
  },
  {
    id: 'employerInsured',
    title: '勤務先の正社員は、健康保険・厚生年金に入っていますか',
    help: '個人事業の場合、人数や業種によっては社会保険に入っていないことがあります。歯科医師国保などの国保組合と厚生年金の組み合わせは「入っている」を選んでください。',
    when: (d) => d.employerType !== 'corp',
    valid: (d) => !!d.employerInsured,
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.employerInsured}
        onChange={(v) => set({ employerInsured: v })}
        options={[
          { value: 'yes', label: '入っている' },
          { value: 'no', label: '入っていない' },
          { value: 'unknown', label: 'わからない' },
        ]}
      />
    ),
  },
  {
    id: 'employerSize',
    title: '勤務先で厚生年金に入っている人は何人ですか',
    help: 'パートの人も含めた、厚生年金に入っている人の数です。会社全体（法人なら全事業所の合計）で数えます。',
    when: (d) => d.employerInsured !== 'no',
    valid: (d) => !!d.employerSize,
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.employerSize}
        onChange={(v) => set({ employerSize: v })}
        options={[
          { value: '1-10', label: '10人以下' },
          { value: '11-20', label: '11〜20人' },
          { value: '21-35', label: '21〜35人' },
          { value: '36-50', label: '36〜50人' },
          { value: '51+', label: '51人以上' },
          { value: 'unknown', label: 'わからない' },
        ]}
      />
    ),
  },
  {
    id: 'hourlyWage',
    title: '時給はいくらですか',
    help: '契約上の基本の時給です。残業や深夜の割増は含めません。',
    valid: (d) => (d.hourlyWage ?? 0) > 0,
    render: (d, set) => (
      <Group>
        <NumberField label="時給" unit="円" value={d.hourlyWage ?? null} onChange={(v) => set({ hourlyWage: v ?? undefined })} placeholder="例 1,200" step={10} />
      </Group>
    ),
  },
  {
    id: 'hours',
    title: '契約上、どれくらい働きますか',
    help: '労働条件通知書（雇用契約書）に書かれた時間と日数です。実際に働いた時間ではありません。',
    valid: (d) => (d.weeklyHours ?? 0) > 0 && (d.weeklyHours ?? 0) <= 80,
    render: (d, set) => (
      <Group footer="月の日数がわからなければ空欄のままで構いません。">
        <NumberField label="週の時間" unit="時間" value={d.weeklyHours ?? null} onChange={(v) => set({ weeklyHours: v ?? undefined })} placeholder="例 20" decimal step={0.5} max={80} />
        <NumberField label="月の日数" unit="日" value={d.monthlyDays ?? null} onChange={(v) => set({ monthlyDays: v })} placeholder="例 12" step={1} max={31} />
      </Group>
    ),
  },
  {
    id: 'fulltime',
    title: '正社員はどれくらい働いていますか',
    help: '勤務先の正社員の、決められた労働時間と日数です。あなたが正社員の4分の3以上働くと、勤務先の社会保険に入ることになります。',
    when: (d) => d.employerInsured !== 'no',
    valid: (d) => (d.fulltimeWeeklyHours ?? 0) > 0,
    render: (d, set) => (
      <Group footer="わからなければ週40時間のままで進めてください。">
        <NumberField label="週の時間" unit="時間" value={d.fulltimeWeeklyHours ?? null} onChange={(v) => set({ fulltimeWeeklyHours: v })} decimal step={0.5} max={80} />
        <NumberField label="月の日数" unit="日" value={d.fulltimeMonthlyDays ?? null} onChange={(v) => set({ fulltimeMonthlyDays: v })} placeholder="例 21" step={1} max={31} />
      </Group>
    ),
  },
  {
    id: 'shiftBased',
    title: '契約に、週の時間がはっきり書かれていますか',
    help: '「シフトによる」などと書かれていて時間が決まっていない場合は、健康保険の扶養の判定方法が変わります。',
    valid: (d) => typeof d.shiftBased === 'boolean',
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.shiftBased === undefined ? null : d.shiftBased ? 'shift' : 'fixed'}
        onChange={(v) => set({ shiftBased: v === 'shift' })}
        options={[
          { value: 'fixed', label: 'はっきり書かれている', detail: '例 週20時間、1日5時間×週4日' },
          { value: 'shift', label: '書かれていない', detail: 'シフト制で、月によって変わる' },
        ]}
      />
    ),
  },
  {
    id: 'contractTerm',
    title: '契約期間は',
    valid: (d) => !!d.contractTerm,
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.contractTerm}
        onChange={(v) => set({ contractTerm: v, expectedOverTwoMonths: v === 'under1y' ? d.expectedOverTwoMonths : true })}
        options={[
          { value: 'over1y', label: '期間の定めなし、または1年以上' },
          { value: 'under1y', label: '1年未満' },
          { value: 'unknown', label: 'わからない' },
        ]}
      />
    ),
  },
  {
    id: 'overTwoMonths',
    title: '2か月を超えて働く見込みはありますか',
    help: '更新される見込みがある場合も「ある」です。',
    when: (d) => d.contractTerm === 'under1y',
    valid: (d) => typeof d.expectedOverTwoMonths === 'boolean',
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.expectedOverTwoMonths === undefined ? null : d.expectedOverTwoMonths ? 'yes' : 'no'}
        onChange={(v) => set({ expectedOverTwoMonths: v === 'yes' })}
        options={[
          { value: 'yes', label: 'ある' },
          { value: 'no', label: 'ない' },
        ]}
      />
    ),
  },
  {
    id: 'commute',
    title: '通勤手当はありますか',
    help: '税金の計算には含めませんが、健康保険の扶養の判定には含めます。ない場合は0のまま進めてください。',
    valid: () => true,
    render: (d, set) => (
      <Group>
        <NumberField label="1か月" unit="円" value={d.commuteMonthly ?? 0} onChange={(v) => set({ commuteMonthly: v ?? 0 })} />
      </Group>
    ),
  },
  {
    id: 'bonus',
    title: '賞与（ボーナス）はありますか',
    help: '1年間に受け取る見込みの合計です。寸志も含みます。毎月の給与の記録には含めないでください。',
    valid: () => true,
    render: (d, set) => (
      <Group>
        <NumberField label="1年間" unit="円" value={d.bonusAnnual ?? 0} onChange={(v) => set({ bonusAnnual: v ?? 0 })} />
      </Group>
    ),
  },
  {
    id: 'student',
    title: '学生ですか',
    help: '昼間の学校に通う学生は、勤務先の社会保険に入る条件の一部が対象外になります。',
    valid: (d) => typeof d.student === 'boolean',
    autoAdvance: true,
    render: (d, set) => (
      <ChoiceList
        value={d.student === undefined ? null : d.student ? 'yes' : 'no'}
        onChange={(v) => set({ student: v === 'yes' })}
        options={[
          { value: 'no', label: '学生ではない' },
          { value: 'yes', label: '学生' },
        ]}
      />
    ),
  },
  {
    id: 'other',
    title: 'ほかの勤務先からの給与はありますか',
    help: '掛け持ちをしている場合、その勤務先から1年間に受け取る見込みの合計です。ない場合は0のまま進めてください。',
    valid: () => true,
    render: (d, set) => (
      <Group>
        <NumberField label="1年間" unit="円" value={d.otherIncome ?? 0} onChange={(v) => set({ otherIncome: v ?? 0 })} />
      </Group>
    ),
  },
];

export function toAnswers(d: Draft): Answers {
  return {
    age: d.age ?? null,
    supporterInsurance: d.supporterInsurance ?? 'unknown',
    sameHousehold: d.supporterInsurance === 'kokuho' ? 'yes' : d.sameHousehold ?? 'unknown',
    supporterSalary: d.supporterSalary ?? null,
    allowance: d.allowance ?? 'unknown',
    allowanceLimit: d.allowanceLimit ?? null,
    employerType: d.employerType ?? 'unknown',
    employerInsured: d.employerType === 'corp' ? 'yes' : d.employerInsured ?? 'unknown',
    employerSize: d.employerSize ?? 'unknown',
    hourlyWage: d.hourlyWage ?? 0,
    weeklyHours: d.weeklyHours ?? 0,
    monthlyDays: d.monthlyDays ?? null,
    fulltimeWeeklyHours: d.fulltimeWeeklyHours ?? null,
    fulltimeMonthlyDays: d.fulltimeMonthlyDays ?? null,
    shiftBased: d.shiftBased ?? false,
    contractTerm: d.contractTerm ?? 'unknown',
    expectedOverTwoMonths: d.expectedOverTwoMonths ?? true,
    commuteMonthly: d.commuteMonthly ?? 0,
    bonusAnnual: d.bonusAnnual ?? 0,
    student: d.student ?? false,
    otherIncome: d.otherIncome ?? 0,
  };
}

export function Questionnaire(props: { initial: Draft; onDone: (a: Answers) => void; onCancel?: () => void }) {
  const [draft, setDraft] = useState<Draft>(props.initial);
  const [index, setIndex] = useState(0);

  const active = useMemo(() => steps.filter((s) => !s.when || s.when(draft)), [draft]);
  const step = active[Math.min(index, active.length - 1)];
  const isLast = index >= active.length - 1;

  const next = (d: Draft = draft) => {
    const list = steps.filter((s) => !s.when || s.when(d));
    if (index >= list.length - 1) props.onDone(toAnswers(d));
    else setIndex(index + 1);
  };

  const set = (p: Draft) => {
    const d = { ...draft, ...p };
    setDraft(d);
    if (step.autoAdvance) {
      window.setTimeout(() => next(d), 180);
    }
  };

  const back = () => {
    if (index === 0) props.onCancel?.();
    else setIndex(index - 1);
  };

  const progress = (index + 1) / active.length;

  return (
    <div className="flow">
      <header className="flow-bar">
        {index > 0 || props.onCancel ? (
          <button type="button" className="nav-back" onClick={back}>
            <BackChevron />
            <span>戻る</span>
          </button>
        ) : (
          <span />
        )}
        <span className="flow-count">
          {index + 1} / {active.length}
        </span>
        <span />
      </header>
      <div className="progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      <main className="flow-body" key={step.id}>
        <h1 className="question">{step.title}</h1>
        {step.help && <p className="question-help">{step.help}</p>}
        <div className="question-input">{step.render(draft, set)}</div>
      </main>

      {!step.autoAdvance && (
        <footer className="flow-footer">
          <button type="button" className="primary" disabled={!step.valid(draft)} onClick={() => next()}>
            {isLast ? '結果を見る' : '次へ'}
          </button>
        </footer>
      )}
    </div>
  );
}
