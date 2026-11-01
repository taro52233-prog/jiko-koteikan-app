import { useState } from 'react';
import type { Evaluation, Wall, WallStatus } from '../engine/types';
import type { RuleSet } from '../rules/types';
import { Group, Sheet } from './controls';
import { hoursText, yen } from './format';

export const STATUS_LABEL: Record<WallStatus, string> = {
  safe: '超えない見込み',
  near: 'もうすぐ',
  over: '超える見込み',
  check: '確認が必要',
  na: '対象外',
};

const CONFIDENCE_LABEL = {
  confirmed: '入力内容から確定',
  estimate: '見込み',
  needs_check: '保険者・勤務先への確認が必要',
} as const;

const GROUP_LABEL = {
  social: '社会保険',
  supporter_tax: '扶養してくれる人の税金',
  self_tax: 'あなたの税金',
  allowance: '会社の手当',
} as const;

function marginText(w: Wall): string | null {
  if (w.margin === null) return null;
  if (w.unit === 'weeklyHours') {
    if (w.status === 'over') return `週${hoursText(w.value ?? 0)}時間で、条件を満たしています`;
    if (w.margin <= 0) return null;
    return `週あと${hoursText(w.margin)}時間`;
  }
  if (w.margin < 0 || (w.thresholdKind === 'below' && w.margin === 0)) {
    return `${yen(Math.abs(w.margin))}円 超える見込み`;
  }
  return `あと${yen(w.margin)}円`;
}

function StatusMark({ status }: { status: WallStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function WallDetail({ w, rules }: { w: Wall; rules: RuleSet }) {
  const m = marginText(w);
  return (
    <>
      <div className="detail-head">
        <p className="eyebrow">{GROUP_LABEL[w.group]}</p>
        <h2 className="detail-title">{w.title}</h2>
        <p className="detail-lead">{w.lead}</p>
        <StatusMark status={w.status} />
      </div>

      <Group>
        {w.threshold !== null && (
          <div className="row">
            <span className="row-label">基準</span>
            <span className="row-value num">
              {w.unit === 'yen' ? `${yen(w.threshold)}円${w.thresholdKind === 'below' ? '未満' : '以下'}` : `週${hoursText(w.threshold)}時間${w.thresholdKind === 'below' ? '未満' : '以下'}`}
            </span>
          </div>
        )}
        {w.value !== null && (
          <div className="row">
            <span className="row-label">{w.unit === 'yen' ? '見込み' : '契約上の時間'}</span>
            <span className="row-value num">{w.unit === 'yen' ? `${yen(w.value)}円` : `週${hoursText(w.value)}時間`}</span>
          </div>
        )}
        {m && (
          <div className="row">
            <span className="row-label">余裕</span>
            <span className="row-value num">{m}</span>
          </div>
        )}
        {w.unit === 'yen' && w.marginHours !== null && w.margin !== null && w.margin > 0 && (
          <div className="row">
            <span className="row-label">時間にすると</span>
            <span className="row-value num">約{hoursText(w.marginHours)}時間</span>
          </div>
        )}
        {w.extra?.map((x) => (
          <div className="row" key={x.label}>
            <span className="row-label">{x.label}</span>
            <span className="row-value num">{x.value}</span>
          </div>
        ))}
        <div className="row">
          <span className="row-label">確かさ</span>
          <span className="row-value">{CONFIDENCE_LABEL[w.confidence]}</span>
        </div>
      </Group>

      {w.plan && w.status !== 'na' && (
        <Group header="今年の残りの目安">
          <div className="row">
            <span className="row-label">1か月あたり</span>
            <span className="row-value num">{yen(w.plan.maxMonthly)}円まで</span>
          </div>
          <div className="row">
            <span className="row-label">週あたり</span>
            <span className="row-value num">約{hoursText(w.plan.maxWeeklyHours)}時間まで</span>
          </div>
          <div className="row">
            <span className="row-label">対象の月数</span>
            <span className="row-value num">{w.plan.remainingMonths}か月</span>
          </div>
        </Group>
      )}

      <section className="prose">
        <h3>判定のもとにしたもの</h3>
        <p>{w.basis}</p>
        <h3>超えるとどうなるか</h3>
        <p>{w.consequence}</p>
        {w.notes.length > 0 && (
          <>
            <h3>補足</h3>
            <ul>
              {w.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
        {w.sourceIds.length > 0 && (
          <>
            <h3>根拠</h3>
            <ul className="sources">
              {w.sourceIds.map((id) => {
                const s = rules.sources[id];
                if (!s) return null;
                return (
                  <li key={id}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                    <span className="source-kind">{s.kind === 'primary' ? '一次資料' : '解説記事'}</span>
                  </li>
                );
              })}
            </ul>
            <p className="muted">資料の最終確認日 {rules.meta.lastChecked.replace(/-/g, '/')}</p>
          </>
        )}
      </section>
    </>
  );
}

export function Results(props: { evaluation: Evaluation; rules: RuleSet; onEditAnswers: () => void; onGoRecords: () => void }) {
  const { evaluation: e, rules } = props;
  const [open, setOpen] = useState<Wall | null>(null);
  const n = e.nearest;
  const p = e.projection;

  const visible = e.walls.filter((w) => w.status !== 'na');
  const hidden = e.walls.filter((w) => w.status === 'na');
  const overCount = visible.filter((w) => w.status === 'over').length;

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">{e.year}年の見込み</p>
        <h1 className="large-title">扶養の状況</h1>
      </header>

      <section className="hero">
        {n ? (
          <>
            <p className="hero-label">次の壁　{n.title}</p>
            <p className="hero-number num">
              <span className="hero-prefix">あと</span>
              {yen(n.margin!)}
              <span className="hero-unit">円</span>
            </p>
            {n.marginHours !== null && <p className="hero-sub num">今の時給で約{hoursText(n.marginHours)}時間分</p>}
          </>
        ) : (
          <>
            <p className="hero-label">次の壁</p>
            <p className="hero-statement">金額の壁で、まだ超えていないものはありません。</p>
          </>
        )}
        {overCount > 0 && <p className="hero-alert">{overCount}件の壁を超える見込みです。</p>}
        <div className="hero-meta">
          <span>
            1〜12月の見込み <strong className="num">{yen(p.calendarGross)}円</strong>
          </span>
          <span>
            {p.paceFrom === 'records' ? `記録 ${p.recordedMonths}か月分から計算` : '契約内容から計算'}
          </span>
        </div>
        {p.paceFrom === 'contract' && (
          <button type="button" className="text-button hero-link" onClick={props.onGoRecords}>
            給与を記録すると、実際のペースで計算します
          </button>
        )}
      </section>

      <section className="group-wrap">
        <h3 className="group-header">壁の一覧</h3>
        <div className="group">
          {visible.map((w) => {
            const m = marginText(w);
            return (
              <button key={w.id} type="button" className="row row-button wall-row" onClick={() => setOpen(w)}>
                <span className="row-main">
                  <span className="row-label">{w.title}</span>
                  <span className="row-detail">
                    <StatusMark status={w.status} />
                    {m && <span className="num wall-margin">{m}</span>}
                  </span>
                </span>
                <svg className="chevron" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
                  <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            );
          })}
        </div>
      </section>

      {hidden.length > 0 && (
        <section className="group-wrap">
          <h3 className="group-header">あなたにはあてはまらない壁</h3>
          <div className="group">
            {hidden.map((w) => (
              <button key={w.id} type="button" className="row row-button wall-row is-muted" onClick={() => setOpen(w)}>
                <span className="row-main">
                  <span className="row-label">{w.title}</span>
                </span>
                <svg className="chevron" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
                  <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="fine-print">
        この結果は入力内容にもとづく試算です。健康保険の扶養は扶養してくれる人の保険者が、税金は税務署が、手当は勤務先が最終的に判断します。
        {rules.meta.reviewStatus === 'unreviewed' && '現在のルールは専門家の監修前です。'}
      </p>
      <div className="center">
        <button type="button" className="text-button" onClick={props.onEditAnswers}>
          回答を見直す
        </button>
      </div>

      {open && (
        <Sheet title="詳細" onClose={() => setOpen(null)}>
          <WallDetail w={open} rules={rules} />
        </Sheet>
      )}
    </div>
  );
}
