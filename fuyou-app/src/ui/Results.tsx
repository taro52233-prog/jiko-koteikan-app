import type { Evaluation, Wall, WallStatus } from '../engine/types';
import type { RuleSet } from '../rules/types';
import { Chevron, Group, Meter, NavPage, PushPage } from './controls';
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

function isOver(w: Wall) {
  return w.margin !== null && (w.margin < 0 || (w.thresholdKind === 'below' && w.margin === 0));
}

function marginText(w: Wall): string | null {
  if (w.margin === null) return null;
  if (w.unit === 'weeklyHours') {
    if (w.status === 'over') return `週${hoursText(w.value ?? 0)}時間で条件を満たす`;
    if (w.margin <= 0) return null;
    return `週あと${hoursText(w.margin)}時間`;
  }
  if (isOver(w)) return `${yen(Math.abs(w.margin))}円 超える`;
  return `あと${yen(w.margin)}円`;
}

function ratio(w: Wall): number | null {
  if (w.threshold === null || w.value === null || w.threshold <= 0) return null;
  return w.value / w.threshold;
}

function valueText(w: Wall, v: number) {
  return w.unit === 'yen' ? `${yen(v)}円` : `週${hoursText(v)}時間`;
}

export function StatusMark({ status }: { status: WallStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ---------- 円形のゲージ ---------- */

function Ring(props: { wall: Wall }) {
  const w = props.wall;
  const r = ratio(w) ?? 0;
  const size = 212;
  const stroke = 16;
  const radius = (size - stroke) / 2;
  const c = 2 * Math.PI * radius;
  const shown = Math.max(0, Math.min(1, r));
  return (
    <div className="ring" role="img" aria-label={`${w.title}まで${marginText(w) ?? ''}`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="ring-track" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={`ring-fill fill-${w.status}`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * shown} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">
        <span className="ring-prefix">あと</span>
        <span className="ring-number num">
          {yen(w.margin ?? 0)}
          <span className="ring-unit">円</span>
        </span>
        <span className="ring-percent num">基準の{Math.round(r * 100)}%</span>
      </div>
    </div>
  );
}

/* ---------- 壁の詳細 ---------- */

function WallDetail({ w, rules }: { w: Wall; rules: RuleSet }) {
  const r = ratio(w);
  const m = marginText(w);
  return (
    <div className="detail">
      <div className="detail-head">
        <p className="eyebrow">{GROUP_LABEL[w.group]}</p>
        <h1 className="detail-title">{w.title}</h1>
        <p className="detail-lead">{w.lead}</p>
      </div>

      <section className="card detail-card">
        <StatusMark status={w.status} />
        {m && <p className={`detail-margin num${isOver(w) ? ' is-over' : ''}`}>{m}</p>}
        {w.unit === 'yen' && w.marginHours !== null && w.margin !== null && w.margin > 0 && (
          <p className="detail-sub num">今の時給で約{hoursText(w.marginHours)}時間分</p>
        )}
        {r !== null && (
          <>
            <Meter ratio={r} status={w.status} label={`基準の${Math.round(r * 100)}%`} />
            <div className="meter-legend num">
              <span>
                {w.unit === 'yen' ? '見込み' : '契約'} {valueText(w, w.value!)}
              </span>
              <span>
                基準 {valueText(w, w.threshold!)}
                {w.thresholdKind === 'below' ? '未満' : '以下'}
              </span>
            </div>
          </>
        )}
      </section>

      {w.plan && w.status !== 'na' && w.plan.maxMonthly > 0 && (
        <Group header="今年の残りの目安" footer={`記録のない残り${w.plan.remainingMonths}か月で、この範囲に収めると超えません。`}>
          <div className="row">
            <span className="row-label">1か月あたり</span>
            <span className="row-value num">{yen(w.plan.maxMonthly)}円まで</span>
          </div>
          <div className="row">
            <span className="row-label">週あたり</span>
            <span className="row-value num">約{hoursText(w.plan.maxWeeklyHours)}時間まで</span>
          </div>
        </Group>
      )}
      {w.plan && w.status !== 'na' && w.plan.maxMonthly <= 0 && (
        <Group header="今年の残りの目安">
          <div className="row">
            <span className="row-label">これまでの給与と賞与の見込みだけで、今年はこの基準を超える見込みです。</span>
          </div>
        </Group>
      )}

      <Group header="内訳">
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
      </section>

      {w.sourceIds.length > 0 && (
        <Group header="根拠" footer={`資料の最終確認日 ${rules.meta.lastChecked.replace(/-/g, '/')}`}>
          {w.sourceIds.map((id) => {
            const s = rules.sources[id];
            if (!s) return null;
            return (
              <a key={id} className="row row-button source-row" href={s.url} target="_blank" rel="noreferrer">
                <span className="row-main">
                  <span className="row-label">{s.title}</span>
                  <span className="row-detail">{s.kind === 'primary' ? '一次資料' : '解説記事'}</span>
                </span>
                <Chevron />
              </a>
            );
          })}
        </Group>
      )}
    </div>
  );
}

/* ---------- 一覧 ---------- */

function WallRow({ w, onOpen }: { w: Wall; onOpen: () => void }) {
  const r = ratio(w);
  const m = marginText(w);
  const muted = w.status === 'na';
  return (
    <button type="button" className={`row row-button wall-row${muted ? ' is-muted' : ''}`} onClick={onOpen}>
      <span className="row-main">
        <span className="row-label">{w.title}</span>
        {!muted && r !== null && <Meter ratio={r} status={w.status} label={`基準の${Math.round(r * 100)}%`} />}
        {!muted && (
          <span className="row-detail">
            <StatusMark status={w.status} />
            {m && <span className="num wall-margin">{m}</span>}
          </span>
        )}
      </span>
      <Chevron />
    </button>
  );
}

export function Results(props: {
  evaluation: Evaluation;
  rules: RuleSet;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onEditAnswers: () => void;
  onGoRecords: () => void;
}) {
  const { evaluation: e, rules } = props;
  const n = e.nearest;
  const p = e.projection;
  const open = props.openId ? e.walls.find((w) => w.id === props.openId) ?? null : null;

  const visible = e.walls.filter((w) => w.status !== 'na');
  const hidden = e.walls.filter((w) => w.status === 'na');
  const overCount = visible.filter((w) => w.status === 'over').length;

  return (
    <>
      <NavPage title="扶養の状況" eyebrow={`${e.year}年の見込み`}>
        <section className="card hero">
          {n ? (
            <>
              <Ring wall={n} />
              <p className="hero-title">{n.title}まで</p>
              {n.marginHours !== null && <p className="hero-sub num">今の時給で約{hoursText(n.marginHours)}時間分</p>}
            </>
          ) : (
            <p className="hero-statement">金額の壁で、まだ超えていないものはありません。</p>
          )}
          {overCount > 0 && (
            <p className="hero-alert">
              <StatusMark status="over" />
              <span>{overCount}件の壁</span>
            </p>
          )}
          <dl className="hero-stats">
            <div>
              <dt>1〜12月の見込み</dt>
              <dd className="num">{yen(p.calendarGross)}円</dd>
            </div>
            <div>
              <dt>計算のもと</dt>
              <dd>{p.paceFrom === 'records' ? `記録${p.recordedMonths}か月分` : '契約内容'}</dd>
            </div>
          </dl>
          {p.paceFrom === 'contract' && (
            <button type="button" className="hero-link" onClick={props.onGoRecords}>
              <span>給与を記録して、実際のペースで計算する</span>
              <Chevron />
            </button>
          )}
        </section>

        <Group header="壁の一覧">
          {visible.map((w) => (
            <WallRow key={w.id} w={w} onOpen={() => props.onOpen(w.id)} />
          ))}
        </Group>

        {hidden.length > 0 && (
          <Group header="あなたにはあてはまらない壁">
            {hidden.map((w) => (
              <WallRow key={w.id} w={w} onOpen={() => props.onOpen(w.id)} />
            ))}
          </Group>
        )}

        <Group>
          <button type="button" className="row row-button" onClick={props.onEditAnswers}>
            <span className="row-label accent">回答を見直す</span>
            <Chevron />
          </button>
        </Group>

        <p className="fine-print">
          この結果は入力内容にもとづく試算です。健康保険の扶養は扶養してくれる人の保険者が、税金は税務署が、手当は勤務先が最終的に判断します。
          {rules.meta.reviewStatus === 'unreviewed' && '現在のルールは専門家の監修前です。'}
        </p>
      </NavPage>

      {open && (
        <PushPage title={open.title.replace(/（.*）$/, '')} backLabel="状況" onBack={() => props.onOpen(null)}>
          <WallDetail w={open} rules={rules} />
        </PushPage>
      )}
    </>
  );
}
