import { useState } from 'react';
import type { Answers, MonthRecord, Projection, Records } from '../engine/types';
import { Group, NumberField, Sheet } from './controls';
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
  const estimate = hours !== null ? Math.round(hours * props.answers.hourlyWage + (commute ?? 0)) : null;

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
      <Group footer="給与明細の「総支給額」を入力してください。賞与は含めず、最初の質問で入力した賞与の見込みに入れてください。">
        <NumberField label="総支給額" unit="円" value={gross} onChange={setGross} placeholder="例 98,000" autoFocus />
        <NumberField label="うち通勤手当" unit="円" value={commute} onChange={setCommute} />
        <NumberField label="働いた時間" unit="時間" value={hours} onChange={setHours} placeholder="任意" decimal />
      </Group>

      {estimate !== null && gross === null && (
        <div className="center">
          <button type="button" className="text-button" onClick={() => setGross(estimate)}>
            時給から計算して入れる（{yen(estimate)}円）
          </button>
        </div>
      )}
      {estimate !== null && gross !== null && Math.abs(estimate - gross) > props.answers.hourlyWage && (
        <p className="group-footer">
          時給×時間から計算すると{yen(estimate)}円です。残業・深夜の割増や手当があれば、明細の金額のほうが正確です。
        </p>
      )}
      {commute !== null && gross !== null && commute > gross && <p className="group-footer warn">通勤手当が総支給額を上回っています。</p>}

      {props.initial && (
        <div className="center">
          <button type="button" className="text-button danger" onClick={() => props.onSave(null)}>
            この月の記録を削除
          </button>
        </div>
      )}
    </Sheet>
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
  const p = props.projection;

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">{props.year}年</p>
        <h1 className="large-title">給与の記録</h1>
      </header>

      <section className="summary">
        <div>
          <p className="summary-label">記録した合計</p>
          <p className="summary-value num">{yen(p.ytdGross)}円</p>
        </div>
        <div>
          <p className="summary-label">1〜12月の見込み</p>
          <p className="summary-value num">{yen(p.calendarGross)}円</p>
        </div>
      </section>

      <Group footer="明細が届いたら、その月の総支給額を入れてください。記録のない月は、直近の記録の平均で見込みます。">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const r = props.records[m];
          return (
            <button key={m} type="button" className="row row-button" onClick={() => setEditing(m)}>
              <span className="row-label month">{m}月</span>
              <span className={`row-value num${r ? '' : ' muted'}`}>
                {r ? `${yen(r.gross)}円` : '未記録'}
                {r?.hours != null && <span className="row-sub"> {hoursText(r.hours)}時間</span>}
              </span>
              <svg className="chevron" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
                <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          );
        })}
      </Group>

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
    </div>
  );
}
