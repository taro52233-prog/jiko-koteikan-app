import { useState } from 'react';
import type { Answers } from '../engine/types';
import type { RuleSet } from '../rules/types';
import { Chevron, Group, NavPage } from './controls';
import { hoursText, yen } from './format';

const INSURANCE: Record<Answers['supporterInsurance'], string> = {
  kyokai: '協会けんぽ',
  kumiai: '健康保険組合',
  kyosai: '共済組合',
  kokuho: '国民健康保険',
  unknown: 'わからない',
};

const SIZE: Record<Answers['employerSize'], string> = {
  '1-10': '10人以下',
  '11-20': '11〜20人',
  '21-35': '21〜35人',
  '36-50': '36〜50人',
  '51+': '51人以上',
  unknown: 'わからない',
};

export function Settings(props: { rules: RuleSet; answers: Answers; onEditAnswers: () => void; onClear: () => void }) {
  const m = props.rules.meta;
  const a = props.answers;
  const [confirming, setConfirming] = useState(false);

  const rows: [string, string][] = [
    ['時給', `${yen(a.hourlyWage)}円`],
    ['契約上の週の時間', `${hoursText(a.weeklyHours)}時間`],
    ['通勤手当（月）', `${yen(a.commuteMonthly)}円`],
    ['扶養してくれる人の保険', INSURANCE[a.supporterInsurance]],
    ['勤務先の人数', a.employerInsured === 'no' ? '社会保険なし' : SIZE[a.employerSize]],
  ];

  return (
    <NavPage title="設定">
      <Group header="あなたの条件">
        {rows.map(([k, v]) => (
          <div className="row" key={k}>
            <span className="row-label">{k}</span>
            <span className="row-value num">{v}</span>
          </div>
        ))}
        <button type="button" className="row row-button" onClick={props.onEditAnswers}>
          <span className="row-label accent">回答を見直す</span>
          <Chevron />
        </button>
      </Group>

      <Group header="使っているルール">
        <div className="row">
          <span className="row-label">対象の年</span>
          <span className="row-value">{m.year}年分</span>
        </div>
        <div className="row">
          <span className="row-label">資料の最終確認日</span>
          <span className="row-value num">{m.lastChecked.replace(/-/g, '/')}</span>
        </div>
        <div className="row">
          <span className="row-label">専門家の監修</span>
          <span className="row-value">{m.reviewStatus === 'reviewed' ? m.reviewer ?? '監修済み' : '監修前'}</span>
        </div>
      </Group>

      <section className="prose">
        <h3>このアプリについて</h3>
        <p>
          入力した内容と給与の記録から、扶養の壁までの余裕を試算します。健康保険の扶養は扶養してくれる人の保険者が、税金は税務署が、手当は勤務先が最終的に判断します。判断に迷うときは、保険者や勤務先に確認してください。
        </p>
        <p>このアプリは個別の税務相談や、社会保険の手続きの代行は行いません。</p>
        <h3>データの保存</h3>
        <p>入力した内容はこの端末の中にだけ保存され、外部には送信されません。</p>
      </section>

      {confirming ? (
        <Group footer="入力した回答と給与の記録をすべて消去します。元に戻せません。">
          <button type="button" className="row row-button danger" onClick={props.onClear}>
            <span className="row-label">消去する</span>
          </button>
          <button type="button" className="row row-button" onClick={() => setConfirming(false)}>
            <span className="row-label accent">やめる</span>
          </button>
        </Group>
      ) : (
        <Group>
          <button type="button" className="row row-button danger" onClick={() => setConfirming(true)}>
            <span className="row-label">すべてのデータを消去</span>
          </button>
        </Group>
      )}
    </NavPage>
  );
}
