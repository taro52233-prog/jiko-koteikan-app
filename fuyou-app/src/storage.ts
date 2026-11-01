import type { Answers, Records } from './engine/types';

/**
 * 保存先の差し替え口。
 * Web版は localStorage、スマホアプリ化したら Capacitor Preferences などに差し替える。
 * 個人版のデータは端末の中にだけ保存し、サーバーには送らない。
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const localStore: KeyValueStore = {
  get: (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* 保存できない環境（プライベートブラウズなど）では何もしない */
    }
  },
  remove: (k) => {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* noop */
    }
  },
};

let store: KeyValueStore = localStore;
export function setStore(s: KeyValueStore) {
  store = s;
}

const KEY = 'fuyou.v1';

export interface SavedData {
  version: 1;
  year: number;
  answers: Answers | null;
  /** 年ごとの給与の記録 */
  records: Record<number, Records>;
}

export function load(): SavedData | null {
  const raw = store.get(KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as SavedData;
    return d.version === 1 ? d : null;
  } catch {
    return null;
  }
}

export function save(d: SavedData) {
  store.set(KEY, JSON.stringify(d));
}

export function clearAll() {
  store.remove(KEY);
}
