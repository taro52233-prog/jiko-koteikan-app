import { useEffect, useId, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { parseNumber } from './format';

/* ---------- アイコン（必要最小限） ---------- */

export function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
      <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BackChevron() {
  return (
    <svg viewBox="0 0 12 20" width="11" height="19" aria-hidden="true">
      <path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 背面のスクロールを止める */
function useScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

/* ---------- 選択肢 ---------- */

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
                <svg viewBox="0 0 16 16" width="17" height="17">
                  <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 数値の入力 ---------- */

/** 数値の入力欄。表示はカンマ区切り、全角数字も受け付ける。step を渡すと −／＋ ボタンが付く */
export function NumberField(props: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit: string;
  placeholder?: string;
  decimal?: boolean;
  autoFocus?: boolean;
  step?: number;
  min?: number;
  max?: number;
}) {
  const id = useId();
  const fmt = (v: number | null) => (v === null ? '' : v.toLocaleString('ja-JP', { maximumFractionDigits: 2 }));
  const [text, setText] = useState(fmt(props.value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(fmt(props.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value, focused]);

  const bump = (dir: 1 | -1) => {
    const step = props.step ?? 1;
    const min = props.min ?? 0;
    const max = props.max ?? Number.POSITIVE_INFINITY;
    const cur = props.value ?? 0;
    const v = Math.min(max, Math.max(min, Math.round((cur + dir * step) * 100) / 100));
    setText(fmt(v));
    props.onChange(v);
  };

  return (
    <div className="row field">
      <label className="row-label" htmlFor={id}>
        {props.label}
      </label>
      <span className="field-input">
        <input
          id={id}
          inputMode={props.decimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={props.placeholder ?? '0'}
          value={text}
          autoFocus={props.autoFocus}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onChange={(e) => {
            setText(e.target.value);
            props.onChange(parseNumber(e.target.value));
          }}
        />
        <span className="unit">{props.unit}</span>
      </span>
      {props.step !== undefined && (
        <span className="stepper">
          <button type="button" aria-label={`${props.label}を減らす`} onClick={() => bump(-1)} disabled={(props.value ?? 0) <= (props.min ?? 0)}>
            <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
              <path d="M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <span className="stepper-sep" aria-hidden="true" />
          <button type="button" aria-label={`${props.label}を増やす`} onClick={() => bump(1)}>
            <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
              <path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      )}
    </div>
  );
}

/* ---------- グループ ---------- */

export function Group(props: { children: ReactNode; footer?: ReactNode; header?: ReactNode }) {
  return (
    <section className="group-wrap">
      {props.header && <h3 className="group-header">{props.header}</h3>}
      <div className="group">{props.children}</div>
      {props.footer && <p className="group-footer">{props.footer}</p>}
    </section>
  );
}

/* ---------- 大きい見出しのページ（スクロールすると上部バーに小さく出る） ---------- */

export function NavPage(props: { title: string; eyebrow?: string; trailing?: ReactNode; children: ReactNode }) {
  const headRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = headRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), {
      rootMargin: '-52px 0px 0px 0px',
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="page">
      <header className={`nav${collapsed ? ' is-collapsed' : ''}`}>
        <span />
        <span className="nav-title">{props.title}</span>
        <span className="nav-trailing">{props.trailing}</span>
      </header>
      <div className="page-head" ref={headRef}>
        {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
        <h1 className="large-title">{props.title}</h1>
      </div>
      {props.children}
    </div>
  );
}

/* ---------- 右から重なる画面（左端からスワイプで戻る） ---------- */

export function PushPage(props: { title: string; backLabel: string; onBack: () => void; children: ReactNode }) {
  useScrollLock();
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(props.onBack, 240);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' || e.clientX > 28) return;
    drag.current = { x: e.clientX, y: e.clientY, active: false };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.active) {
      if (Math.abs(e.clientY - d.y) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (dx > 8) {
        d.active = true;
        el.setPointerCapture(e.pointerId);
      }
    }
    if (d.active) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${Math.max(0, dx)}px)`;
    }
  };
  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d?.active || !el) return;
    const dx = e.clientX - d.x;
    el.style.transition = '';
    if (dx > el.clientWidth * 0.33) {
      el.style.transform = 'translateX(100%)';
      window.setTimeout(props.onBack, 220);
    } else {
      el.style.transform = '';
    }
  };

  return (
    <div className={`push-layer${leaving ? ' is-leaving' : ''}`}>
      <div
        ref={ref}
        className="push-page"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <header className="nav is-collapsed is-fixed">
          <button type="button" className="nav-back" onClick={close}>
            <BackChevron />
            <span>{props.backLabel}</span>
          </button>
          <span className="nav-title">{props.title}</span>
          <span />
        </header>
        <div className="push-body">{props.children}</div>
      </div>
    </div>
  );
}

/* ---------- 下から出る画面（つまみを下にスワイプで閉じる） ---------- */

export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode }) {
  useScrollLock();
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ y: number } | null>(null);

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(props.onClose, 220);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onPointerDown = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent) => {
    const el = ref.current;
    if (!drag.current || !el) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  };
  const onPointerUp = (e: RPointerEvent) => {
    const el = ref.current;
    if (!drag.current || !el) return;
    const dy = e.clientY - drag.current.y;
    drag.current = null;
    el.style.transition = '';
    if (dy > 110) {
      el.style.transform = 'translateY(100%)';
      window.setTimeout(props.onClose, 200);
    } else {
      el.style.transform = '';
    }
  };

  return (
    <div className={`sheet-backdrop${leaving ? ' is-leaving' : ''}`} onClick={close}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle-area" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className="grabber" aria-hidden="true" />
          <header className="sheet-bar">
            <button type="button" className="text-button" onClick={close}>
              キャンセル
            </button>
            <h2 className="sheet-title">{props.title}</h2>
            <span className="sheet-action">{props.action}</span>
          </header>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

/* ---------- 進み具合のバー ---------- */

export function Meter(props: { ratio: number; status: string; label: string }) {
  const pct = Math.max(0, Math.min(1, props.ratio)) * 100;
  return (
    <span className="meter" role="img" aria-label={props.label}>
      <span className={`meter-fill fill-${props.status}`} style={{ width: `${pct}%` }} />
    </span>
  );
}
