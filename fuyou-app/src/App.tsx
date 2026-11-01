import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { evaluate } from './engine/evaluate';
import type { Answers, Records } from './engine/types';
import { getRules, supportedYears } from './rules';
import { clearAll, load, save, type SavedData } from './storage';
import { Questionnaire, emptyDraft } from './ui/Questionnaire';
import { RecordsView } from './ui/RecordsView';
import { Results } from './ui/Results';
import { Settings } from './ui/Settings';

export const APP_NAME = '扶養ライン';

type Tab = 'status' | 'records' | 'settings';

function currentYear(today: Date) {
  const y = today.getFullYear();
  return supportedYears.includes(y) ? y : supportedYears[supportedYears.length - 1];
}

function Welcome(props: { onStart: () => void; unreviewed: boolean }) {
  return (
    <div className="welcome">
      <div className="welcome-body">
        <p className="eyebrow">{APP_NAME}</p>
        <h1 className="welcome-title">
          扶養の範囲で、
          <br />
          あとどれだけ
          <br />
          働けるか。
        </h1>
        <ul className="welcome-points">
          <li>
            <strong>壁ごとに、あと何円・何時間</strong>
            <span>税金、健康保険、勤務先の社会保険、夫の会社の手当まで。</span>
          </li>
          <li>
            <strong>あなたの条件に合わせて判定</strong>
            <span>いくつかの質問に答えるだけ。あてはまらない壁は表示しません。</span>
          </li>
          <li>
            <strong>根拠を確認できる</strong>
            <span>判定ごとに、もとにした資料と確かさを表示します。</span>
          </li>
        </ul>
      </div>
      <footer className="welcome-footer">
        <button type="button" className="primary" onClick={props.onStart}>
          はじめる
        </button>
        <p className="fine-print">
          所要時間は3分ほどです。入力内容はこの端末の中だけに保存されます。
          {props.unreviewed && '現在は専門家の監修前の試作版です。結果は目安としてご利用ください。'}
        </p>
      </footer>
    </div>
  );
}

function TabBar(props: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: ReactNode }[] = [
    {
      id: 'status',
      label: '状況',
      icon: (
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path d="M4 19h16M7 15v-4M12 15V7M17 15v-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'records',
      label: '給与の記録',
      icon: (
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <rect x="5" y="4" width="14" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 9h6M9 13h6M9 17h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: '設定',
      icon: (
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="9" cy="7" r="2" fill="var(--bg-elevated)" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="15" cy="12" r="2" fill="var(--bg-elevated)" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="8" cy="17" r="2" fill="var(--bg-elevated)" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ),
    },
  ];
  return (
    <nav className="tabbar" aria-label="メインメニュー">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          className={`tab${props.tab === i.id ? ' is-active' : ''}`}
          aria-current={props.tab === i.id ? 'page' : undefined}
          onClick={() => props.onChange(i.id)}
        >
          {i.icon}
          <span>{i.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const today = useMemo(() => new Date(), []);
  const [data, setData] = useState<SavedData>(
    () => load() ?? { version: 1, year: currentYear(today), answers: null, records: {} },
  );
  const [mode, setMode] = useState<'welcome' | 'flow' | 'app'>(data.answers ? 'app' : 'welcome');
  const [tab, setTab] = useState<Tab>('status');

  useEffect(() => {
    save(data);
  }, [data]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode, tab]);

  const rules = getRules(data.year)!;
  const records: Records = data.records[data.year] ?? {};
  const evaluation = useMemo(
    () => (data.answers ? evaluate(data.answers, records, rules, today) : null),
    [data.answers, records, rules, today],
  );

  const finishFlow = (a: Answers) => {
    setData({ ...data, answers: a });
    setMode('app');
    setTab('status');
  };

  if (mode === 'welcome') {
    return <Welcome onStart={() => setMode('flow')} unreviewed={rules.meta.reviewStatus === 'unreviewed'} />;
  }
  if (mode === 'flow' || !data.answers || !evaluation) {
    return (
      <Questionnaire
        initial={data.answers ?? emptyDraft}
        onDone={finishFlow}
        onCancel={() => setMode(data.answers ? 'app' : 'welcome')}
      />
    );
  }

  return (
    <div className="shell">
      {tab === 'status' && (
        <Results evaluation={evaluation} rules={rules} onEditAnswers={() => setMode('flow')} onGoRecords={() => setTab('records')} />
      )}
      {tab === 'records' && (
        <RecordsView
          year={data.year}
          records={records}
          answers={data.answers}
          projection={evaluation.projection}
          onChange={(r) => setData({ ...data, records: { ...data.records, [data.year]: r } })}
        />
      )}
      {tab === 'settings' && (
        <Settings
          rules={rules}
          onEditAnswers={() => setMode('flow')}
          onClear={() => {
            clearAll();
            setData({ version: 1, year: currentYear(today), answers: null, records: {} });
            setMode('welcome');
          }}
        />
      )}
      <TabBar tab={tab} onChange={setTab} />
    </div>
  );
}
