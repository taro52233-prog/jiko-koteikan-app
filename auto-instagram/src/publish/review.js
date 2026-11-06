/**
 * 人間の承認ゲート（GitHub Issue ベース）。
 *
 * 「完全自動」にするほど、誤爆したときの回収コストが跳ね上がる。
 * 既定は review モード = Issue を立てて、ラベル `ig-approved` が付いたものだけ公開する。
 * 十分に精度が出たら POST_MODE=auto に切り替える、という運用を想定している。
 * GITHUB_TOKEN だけで動くので追加の PAT は不要。
 */
import { fetchJson, warn, log } from '../util.js';

const API = 'https://api.github.com';
export const APPROVE_LABEL = 'ig-approved';
export const REVIEW_LABEL = 'ig-review';

function ctx() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  return {
    token, repo,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
  };
}

function body({ item, content, imageUrls, slug }) {
  const preview = imageUrls.map((u, i) => `<img src="${u}" width="180" alt="slide ${i + 1}">`).join(' ');
  return `## 投稿候補: ${item.name}

${preview}

| 項目 | 値 |
| --- | --- |
| 価格 | ${item.price.toLocaleString('ja-JP')}円 |
| レビュー | ★${item.reviewAverage} (${item.reviewCount}件) |
| ショップ | ${item.shopName} |
| スコア | ${item.score ?? '-'} |
| 商品ページ | ${item.url} |
| slug | \`${slug}\` |

### 本文

\`\`\`
${content.fullCaption}
\`\`\`

---

**公開する** → この Issue に \`${APPROVE_LABEL}\` ラベルを付けてください（次回の publish 実行で投稿されます）
**見送る** → この Issue を close してください`;
}

/** 任意の Issue を立てる汎用版。GitHub 外で実行しているときは null を返す */
export async function createIssue({ title, body, labels = [] }) {
  const c = ctx();
  if (!c) { warn('GITHUB_TOKEN/GITHUB_REPOSITORY が無いためIssueを作成しません'); return null; }
  const res = await fetchJson(`${API}/repos/${c.repo}/issues`, {
    method: 'POST', headers: c.headers,
    body: JSON.stringify({ title, body, labels }),
  }, { label: 'gh-create-issue', retries: 2 });
  log(`Issueを作成: #${res.number}`);
  return res.number;
}

/** 承認待ち Issue を立てる。GitHub 外で実行しているときは何もしない */
export async function openReviewIssue(payload) {
  const c = ctx();
  if (!c) { warn('GITHUB_TOKEN/GITHUB_REPOSITORY が無いためレビューIssueを作成しません'); return null; }
  try {
    const res = await fetchJson(`${API}/repos/${c.repo}/issues`, {
      method: 'POST',
      headers: c.headers,
      body: JSON.stringify({
        title: `[IG投稿承認] ${payload.item.name.slice(0, 60)}`,
        body: body(payload),
        labels: [REVIEW_LABEL],
      }),
    }, { label: 'gh-create-issue', retries: 2 });
    log(`承認Issueを作成: #${res.number}`);
    return res.number;
  } catch (e) {
    warn(`承認Issueの作成に失敗（キューには積まれています）: ${e.message}`);
    return null;
  }
}

/** `ig-approved` ラベルが付いた Issue 番号の集合を返す */
export async function fetchApprovedIssueNumbers() {
  const c = ctx();
  if (!c) return new Set();
  try {
    const issues = await fetchJson(
      `${API}/repos/${c.repo}/issues?labels=${APPROVE_LABEL}&state=open&per_page=50`,
      { headers: c.headers }, { label: 'gh-list-issues', retries: 2 });
    return new Set(issues.map((i) => i.number));
  } catch (e) {
    warn(`承認Issueの取得に失敗: ${e.message}`);
    return new Set();
  }
}

export async function closeIssue(number, comment) {
  const c = ctx();
  if (!c || !number) return;
  try {
    if (comment) {
      await fetchJson(`${API}/repos/${c.repo}/issues/${number}/comments`, {
        method: 'POST', headers: c.headers, body: JSON.stringify({ body: comment }),
      }, { label: 'gh-comment', retries: 1 });
    }
    await fetchJson(`${API}/repos/${c.repo}/issues/${number}`, {
      method: 'PATCH', headers: c.headers, body: JSON.stringify({ state: 'closed' }),
    }, { label: 'gh-close-issue', retries: 1 });
  } catch (e) {
    warn(`Issue #${number} のクローズに失敗: ${e.message}`);
  }
}

/** 失敗を握り潰さず可視化する */
export async function reportFailure(title, detail) {
  const c = ctx();
  if (!c) return;
  try {
    await fetchJson(`${API}/repos/${c.repo}/issues`, {
      method: 'POST', headers: c.headers,
      body: JSON.stringify({ title: `[IG自動投稿 失敗] ${title}`, body: detail, labels: ['ig-failure'] }),
    }, { label: 'gh-failure-issue', retries: 1 });
  } catch (e) {
    warn(`失敗Issueの作成に失敗: ${e.message}`);
  }
}
