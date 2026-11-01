import { useState } from 'react';
import type { RuleSet } from '../rules/types';
import { Group } from './controls';

export function Settings(props: { rules: RuleSet; onEditAnswers: () => void; onClear: () => void }) {
  const m = props.rules.meta;
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="large-title">設定</h1>
      </header>

      <Group>
        <button type="button" className="row row-button" onClick={props.onEditAnswers}>
          <span className="row-label">回答を見直す</span>
          <svg className="chevron" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
            <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
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
        <p>
          このアプリは個別の税務相談や、社会保険の手続きの代行は行いません。
        </p>
        <h3>データの保存</h3>
        <p>入力した内容はこの端末の中にだけ保存され、外部には送信されません。</p>
      </section>

      {confirming ? (
        <Group footer="入力した回答と給与の記録をすべて消去します。元に戻せません。">
          <button type="button" className="row row-button danger" onClick={props.onClear}>
            <span className="row-label">消去する</span>
          </button>
          <button type="button" className="row row-button" onClick={() => setConfirming(false)}>
            <span className="row-label">やめる</span>
          </button>
        </Group>
      ) : (
        <Group>
          <button type="button" className="row row-button danger" onClick={() => setConfirming(true)}>
            <span className="row-label">すべてのデータを消去</span>
          </button>
        </Group>
      )}
    </div>
  );
}
