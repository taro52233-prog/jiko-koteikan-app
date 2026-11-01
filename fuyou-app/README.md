# 扶養ライン（仮称）

扶養の範囲で、あと何円・何時間働けるかを試算する Web アプリ（個人版 MVP）。
要件は `../docs/fuyou-app/requirements.md` を参照。

> 現在のルールは専門家の監修前です。監修が終わるまで、本番の判断には使わないでください。

## 使い方

```bash
npm install
npm run dev      # 開発サーバー http://localhost:5173
npm test         # 計算エンジンのテスト
npm run build    # 本番ビルド（dist/）
```

## 構成

```
src/
  rules/     年ごとの制度ルール（金額・条件・出典・確認日）。法改正はここを差し替える
  engine/    計算エンジン。React に依存しない純粋な関数。テストあり
  ui/        画面（質問の流れ、結果、給与の記録、設定）
  storage.ts 保存先の差し替え口（Web は localStorage、アプリ化したら差し替え）
public/      PWA（manifest、サービスワーカー、アイコン）
```

- 画面と計算を分けているので、スマホアプリ化（Capacitor で包む、または React Native）でもエンジンとルールをそのまま使える。
- `vite.config.ts` の `base: './'` は、アプリに包んだときに相対パスで読み込むための設定。
- 個人のデータは端末内にだけ保存し、外部には送らない。

## ルールを更新するとき

1. `src/rules/<年>.ts` を追加または編集する（出典 `sources` と `meta.lastChecked` も更新）
2. `src/rules/index.ts` に登録する
3. 境界値のテストを `src/engine/evaluate.test.ts` に追加し、`npm test` を通す
4. 監修者の確認後、`meta.reviewStatus` を `'reviewed'`、`meta.reviewer` に名前を入れる
