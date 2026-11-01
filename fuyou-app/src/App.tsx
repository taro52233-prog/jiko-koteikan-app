import { useEffect, useMemo, useState } from 'react';
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
        <img className="welcome-icon" src="./icon.svg" alt="" width="72" height="72" />
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

function TabIcon({ id, active }: { id: Tab; active: boolean }) {
  const sw = 1.8;
  if (id === 'status') {
    return (
      <svg viewBox="0 0 28 28" width="27" height="27" aria-hidden="true">
        <circle cx="14" cy="14" r="9.5" fill="none" stroke="currentColor" strokeWidth={active ? 3.2 : sw} opacity="0.3" />
        <path d="M14 4.5a9.5 9.5 0 1 1-8.2 14.3" fill="none" stroke="currentColor" strokeWidth={active ? 3.2 : sw} strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'records') {
    return (
      <svg viewBox="0 0 28 28" width="27" height="27" aria-hidden="true">
        {active ? (
          <>
            <rect x="5" y="15" width="4.5" height="8" rx="1.5" fill="currentColor" />
            <rect x="11.75" y="9" width="4.5" height="14" rx="1.5" fill="currentColor" />
            <rect x="18.5" y="5" width="4.5" height="18" rx="1.5" fill="currentColor" />
          </>
        ) : (
          <>
            <rect x="5.9" y="15.9" width="2.7" height="6.2" rx="1" fill="none" stroke="currentColor" strokeWidth={sw} />
            <rect x="12.65" y="9.9" width="2.7" height="12.2" rx="1" fill="none" stroke="currentColor" strokeWidth={sw} />
            <rect x="19.4" y="5.9" width="2.7" height="16.2" rx="1" fill="none" stroke="currentColor" strokeWidth={sw} />
          </>
        )}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 28 28" width="27" height="27" aria-hidden="true">
      <path d="M5 8h18M5 14h18M5 20h18" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      {[
        [10, 8],
        [18, 14],
        [9, 20],
      ].map(([cx, cy]) => (
        <circle key={cy} cx={cx} cy={cy} r="2.6" fill={active ? 'currentColor' : 'var(--bar-bg)'} stroke="currentColor" strokeWidth={sw} />
      ))}
    </svg>
  );
}

function TabBar(props: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: 'status', label: '状況' },
    { id: 'records', label: '記録' },
    { id: 'settings', label: '設定' },
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
          <TabIcon id={i.id} active={props.tab === i.id} />
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
  const [openWall, setOpenWall] = useState<string | null>(null);

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
        <Results
          evaluation={evaluation}
          rules={rules}
          openId={openWall}
          onOpen={setOpenWall}
          onEditAnswers={() => setMode('flow')}
          onGoRecords={() => setTab('records')}
        />
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
          answers={data.answers}
          onEditAnswers={() => setMode('flow')}
          onClear={() => {
            clearAll();
            setData({ version: 1, year: currentYear(today), answers: null, records: {} });
            setMode('welcome');
          }}
        />
      )}
      <TabBar
        tab={tab}
        onChange={(t) => {
          setOpenWall(null);
          if (t === tab) window.scrollTo({ top: 0, behavior: 'smooth' });
          setTab(t);
        }}
      />
    </div>
  );
}
