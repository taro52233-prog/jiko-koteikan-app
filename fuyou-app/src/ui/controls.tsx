import { useEffect, useId, useState, type ReactNode } from 'react';
import { parseNumber } from './format';

export interface Option<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

export function ChoiceList<T extends string>(props: {
  options: Option<T>[];
  value: T | null | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className="group" role="radiogroup">
      {props.options.map((o) => {
        const selected = props.value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`row row-button${selected ? ' is-selected' : ''}`}
            onClick={() => props.onChange(o.value)}
          >
            <span className="row-main">
              <span className="row-label">{o.label}</span>
              {o.detail && <span className="row-detail">{o.detail}</span>}
            </span>
            <span className="check" aria-hidden="true">
              {selected && (
                <svg viewBox="0 0 16 16" width="16" height="16">
                  <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 数値の入力欄。表示はカンマ区切り、全角数字も受け付ける */
export function NumberField(props: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit: string;
  placeholder?: string;
  decimal?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const fmt = (v: number | null) => (v === null ? '' : v.toLocaleString('ja-JP', { maximumFractionDigits: 2 }));
  const [text, setText] = useState(fmt(props.value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(fmt(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value, focused]);

  return (
    <label className="row field" htmlFor={id}>
      <span className="row-label">{props.label}</span>
      <span className="field-input">
        <input
          id={id}
          inputMode={props.decimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          placeholder={props.placeholder ?? '0'}
          value={text}
          autoFocus={props.autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            props.onChange(parseNumber(e.target.value));
          }}
        />
        <span className="unit">{props.unit}</span>
      </span>
    </label>
  );
}

export function Group(props: { children: ReactNode; footer?: ReactNode; header?: ReactNode }) {
  return (
    <section className="group-wrap">
      {props.header && <h3 className="group-header">{props.header}</h3>}
      <div className="group">{props.children}</div>
      {props.footer && <p className="group-footer">{props.footer}</p>}
    </section>
  );
}

export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [props]);

  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-bar">
          <button type="button" className="text-button" onClick={props.onClose}>
            閉じる
          </button>
          <h2 className="sheet-title">{props.title}</h2>
          <span className="sheet-action">{props.action}</span>
        </header>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}
