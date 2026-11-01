import { useState } from 'react';
import type { Answers, MonthRecord, Projection, Records } from '../engine/types';
import { Chevron, Group, NavPage, NumberField, Sheet } from './controls';
import { hoursText, yen } from './format';

function Editor(props: {
  month: number;
  initial: MonthRecord | undefined;
  answers: Answers;
  onSave: (r: MonthRecord | null) => void;
  onClose: () => void;
}) {
  const [gross, setGross] = useState<number | null>(props.initial?.gross ?? null);
  const [commute, setCommute] = useState<number | null>(props.initial?.commute ?? props.answers.commuteMonthly);
  const [hours, setHours] = useState<number | null>(props.initial?.hours ?? null);

  const valid = gross !== null && (commute ?? 0) <= gross;
  const estimate = hours !== null && hours > 0 ? Math.round(hours * props.answers.hourlyWage + (commute ?? 0)) : null;

  return (
    <Sheet
      title={`${props.month}月の給与`}
      onClose={props.onClose}
      action={
        <button type="button" className="text-button strong" disabled={!valid} onClick={() => props.onSave({ gross: gross!, commute: commute ?? 0, hours })}>
          保存
        </button>
      }
    >
      <Group footer="給与明細の「総支給額」を入力してください。賞与は含めません。">
        <NumberField label="総支給額" unit="円" value={gross} onChange={setGross} placeholder="例 98,000" />
        <NumberField label="うち通勤手当" unit="円" value={commute} onChange={setCommute} />
        <NumberField label="働いた時間" unit="時間" value={hours} onChange={setHours} placeholder="任意" decimal step={1} />
      </Group>

      {estimate !== null && (
        <Group footer="残業・深夜の割増や手当があれば、明細の金額のほうが正確です。">
          <button type="button" className="row row-button" onClick={() => setGross(estimate)}>
            <span className="row-main">
              <span className="row-label accent">時給×時間で入れる</span>
              <span className="row-detail num">
                {yen(props.answers.hourlyWage)}円 × {hoursText(hours!)}時間{commute ? ` ＋ 通勤手当` : ''} ＝ {yen(estimate)}円
              </span>
            </span>
          </button>
        </Group>
      )}
      {commute !== null && gross !== null && commute > gross && <p className="group-footer warn">通勤手当が総支給額を上回っています。</p>}

      {props.initial && (
        <Group>
          <button type="button" className="row row-button danger" onClick={() => props.onSave(null)}>
            <span className="row-label">この月の記録を削除</span>
          </button>
        </Group>
      )}
    </Sheet>
  );
}

/** 月ごとの棒グラフ。記録した月は濃く、見込みの月は薄く表示する */
function MonthChart(props: { records: Records; projection: Projection; selected: number | null; onSelect: (m: number) => void }) {
  const p = props.projection;
  const values = Array.from({ length: 12 }, (_, i) => {
    const r = props.records[i + 1];
    return r ? { v: r.gross, recorded: true } : { v: p.paceGross, recorded: false };
  });
  const max = Math.max(1, ...values.map((x) => x.v));
  const sel = props.selected;
  const selValue = sel !== null ? values[sel - 1] : null;

  return (
    <section className="card chart-card">
      <div className="chart-head">
        <div>
          <p className="chart-label">{sel !== null ? `${sel}月${selValue!.recorded ? '' : '（見込み）'}` : '1〜12月の見込み'}</p>
          <p className="chart-value num">{yen(sel !== null ? selValue!.v : p.calendarGross)}円</p>
        </div>
        <ul className="chart-legend" aria-label="凡例">
          <li>
            <span className="swatch is-recorded" aria-hidden="true" />
            記録
          </li>
          <li>
            <span className="swatch" aria-hidden="true" />
            見込み
          </li>
        </ul>
      </div>
      <div className="chart" role="list">
        {values.map((x, i) => (
          <button
            key={i}
            type="button"
            role="listitem"
            className={`bar${x.recorded ? ' is-recorded' : ''}${sel === i + 1 ? ' is-selected' : ''}`}
            aria-label={`${i + 1}月 ${yen(x.v)}円${x.recorded ? '' : '（見込み）'}`}
            onClick={() => props.onSelect(i + 1)}
          >
            <span className="bar-track">
              <span className="bar-fill" style={{ height: `${(x.v / max) * 100}%` }} />
            </span>
            <span className="bar-month num">{i + 1}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function RecordsView(props: {
  year: number;
  records: Records;
  answers: Answers;
  projection: Projection;
  onChange: (r: Records) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const p = props.projection;

  return (
    <NavPage title="給与の記録" eyebrow={`${props.year}年`}>
      <MonthChart records={props.records} projection={p} selected={selected} onSelect={(m) => setSelected(selected === m ? null : m)} />

      <Group header="月ごとの総支給額" footer="明細が届いたら、その月の総支給額を入れてください。記録のない月は、直近の記録の平均で見込みます。">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const r = props.records[m];
          return (
            <button key={m} type="button" className="row row-button" onClick={() => setEditing(m)}>
              <span className="row-label month">{m}月</span>
              <span className={`row-value num${r ? '' : ' muted'}`}>
                {r ? `${yen(r.gross)}円` : '未記録'}
                {r?.hours != null && <span className="row-sub"> {hoursText(r.hours)}時間</span>}
              </span>
              <Chevron />
            </button>
          );
        })}
      </Group>

      <dl className="totals">
        <div>
          <dt>記録した合計</dt>
          <dd className="num">{yen(p.ytdGross)}円</dd>
        </div>
        <div>
          <dt>うち通勤手当</dt>
          <dd className="num">{yen(p.ytdCommute)}円</dd>
        </div>
      </dl>

      {editing !== null && (
        <Editor
          month={editing}
          initial={props.records[editing]}
          answers={props.answers}
          onClose={() => setEditing(null)}
          onSave={(r) => {
            const next = { ...props.records };
            if (r) next[editing] = r;
            else delete next[editing];
            props.onChange(next);
            setEditing(null);
          }}
        />
      )}
    </NavPage>
  );
}
