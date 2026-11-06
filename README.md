# jiko-koteikan-app

3つの独立したプロジェクトが同居しています。

## `index.html`
鋼の自己肯定感アプリ（単一HTML）。GitHub Pages で公開中。

## [`auto-instagram/`](auto-instagram/README.md)
楽天ROOM / Instagram の商品リサーチ・投稿制作を自動化するパイプライン。**GitHub Actions で稼働中**。

- **楽天ROOM**: 毎朝7時に「今日やること」が Issue で届く（投稿だけ手動＝規約準拠）
- **Instagram**: リサーチから投稿まで完全自動（Meta のアプリ審査が必要）

Node.js / サーバー不要。

## [`threads-affiliate-assistant/`](threads-affiliate-assistant/README.md)
Threads × 楽天アフィリエイトの半自動運用ツール。**現在は未稼働**（別リポジトリから履歴ごと移管）。

Python / FastAPI。親投稿にはリンクを置かず、自分のコメント欄に `【PR】`＋リンクを付ける構成。

```bash
cd threads-affiliate-assistant
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # 各キーを記入
.venv/bin/python -m pytest      # 19件
.venv/bin/uvicorn app.web:app --host 0.0.0.0 --port 8000
```

---

## 2つのツールの関係

同じ「商品を選んで紹介文を作る」仕事をしていますが、**実行基盤が違います**。

| | auto-instagram | threads-affiliate-assistant |
| --- | --- | --- |
| 言語 | Node.js | Python / FastAPI |
| 実行基盤 | GitHub Actions（サーバー不要） | **常時起動のサーバーが必要**（APScheduler） |
| 承認方法 | GitHub Issue のラベル | Web の承認画面 |
| 状態の保存 | JSON（リポジトリにコミット） | SQLite（`data/` は gitignore） |
| 投稿先 | 楽天ROOM（手動）/ Instagram（自動） | Threads（自動） |

設計思想は共通です — 承認ゲートを必ず通す / 使っていない商品の体験談を書かせない / 景表法のPR表記を機械的に強制する / スクレイピングせず公式APIのみ。

### 既知の重複

次の3つは両方に別実装で存在します。片方を直してももう片方には反映されません。

| 機能 | auto-instagram | threads-affiliate-assistant |
| --- | --- | --- |
| 楽天APIクライアント | `src/research/rakuten.js` | `app/rakuten_client.py` |
| Claude による文章生成 | `src/content/` | `app/generator.py` |
| コンプライアンス検査 | `src/content/room.js` `sanitizeRoom()` | `app/compliance.py` |

### 今後やるとしたら

`threads-affiliate-assistant` は現在サーバーが必要なため動かしていません。GitHub Actions に載せるには2点の置き換えが要ります（`app/jobs.py` に CLI エントリ `main(argv)` があるので、ジョブ部分はそのまま流用できます）。

1. 承認UI（FastAPI）→ GitHub Issue 方式（`auto-instagram/src/publish/review.js` と同じやり方）
2. SQLite → リポジトリにコミットされる JSON（`auto-instagram/src/store/` と同じやり方）
