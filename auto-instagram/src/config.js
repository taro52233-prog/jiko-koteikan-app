/**
 * 設定の一元管理。環境変数を読み、型を揃え、欠落を早期に検出する。
 * すべての既定値は「安全側」（= いきなり本番投稿しない）に倒してある。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(ROOT, '..');

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function list(v, fallback = []) {
  if (!v) return fallback;
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/** .env を読む（ローカル開発用。CI では GitHub Secrets が既に env に入っている） */
function loadDotEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue; // 既存の env を優先
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const env = process.env;

export const config = {
  paths: {
    root: ROOT,
    repoRoot: REPO_ROOT,
    data: path.join(ROOT, 'data'),
    out: path.join(ROOT, 'out'),
    /** GitHub Pages で公開される画像置き場。IG Graph API は「公開URL」しか受け取らない */
    publicDir: path.join(REPO_ROOT, 'docs', 'ig'),
    history: path.join(ROOT, 'data', 'history.json'),
    queue: path.join(ROOT, 'data', 'queue.json'),
    /** 楽天のセール日程（手入力で確定日程を上書きする） */
    events: path.join(ROOT, 'data', 'rakuten-events.json'),
    /** 楽天ROOM の実施ログ（ランクアップ進捗の自己申告） */
    roomLog: path.join(ROOT, 'data', 'room-log.json'),
    /** 実際に所有・使用している商品（ここに登録した物だけ使用体験として書ける） */
    owned: path.join(ROOT, 'data', 'owned-items.json'),
  },

  /** 生成物の公開ベースURL（GitHub Pages）。例: https://<user>.github.io/<repo>/ig */
  publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  /** review = 承認待ちキューに積むだけ / auto = そのまま投稿する */
  postMode: (env.POST_MODE || 'review').toLowerCase(),

  research: {
    provider: (env.RESEARCH_PROVIDER || 'rakuten').toLowerCase(),
    rakutenAppId: env.RAKUTEN_APP_ID || '',
    rakutenAffiliateId: env.RAKUTEN_AFFILIATE_ID || '',
    /** 探索キーワード（カンマ区切り）。空ならランキングAPIのみ使う */
    keywords: list(env.RESEARCH_KEYWORDS),
    /** 楽天ジャンルID（カンマ区切り）。0 = 全ジャンル */
    genreIds: list(env.RESEARCH_GENRE_IDS, ['0']),
    minPrice: num(env.RESEARCH_MIN_PRICE, 1000),
    maxPrice: num(env.RESEARCH_MAX_PRICE, 30000),
    minReviewCount: num(env.RESEARCH_MIN_REVIEW_COUNT, 20),
    minReviewAverage: num(env.RESEARCH_MIN_REVIEW_AVERAGE, 4.0),
    /** 1回の実行で候補として集める件数 */
    poolSize: num(env.RESEARCH_POOL_SIZE, 60),
    /**
     * click      = 楽天ROOM向け。クリック数の最大化（紹介商品が売れなくても報酬になるため）
     * conversion = その商品自体の購入を狙う場合
     */
    scoringProfile: (env.SCORING_PROFILE || 'click').toLowerCase(),
    /** 同一ショップの連投を避ける日数 */
    shopCooldownDays: num(env.RESEARCH_SHOP_COOLDOWN_DAYS, 7),
  },

  content: {
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    /** ブランドの口調。プロンプトにそのまま差し込まれる */
    persona: env.BRAND_PERSONA || '20〜30代の生活者に向けて、誇張せず具体的に語る親しみやすい日本語',
    /** カルーセルの枚数（1 なら単一画像投稿） */
    slides: Math.min(10, Math.max(1, num(env.CONTENT_SLIDES, 5))),
    maxHashtags: num(env.CONTENT_MAX_HASHTAGS, 20),
    /** 景品表示法（ステマ規制）対応。アフィリエイト運用では必ず true のままにすること */
    disclosureRequired: bool(env.CONTENT_DISCLOSURE_REQUIRED, true),
    disclosureText: env.CONTENT_DISCLOSURE_TEXT || '【PR】この投稿にはアフィリエイトリンク・広告が含まれます。',

    // --- 楽天ROOM 用（Instagram とは文字数もトーンも別物なので分けている） ---
    roomPersona: env.ROOM_PERSONA || env.BRAND_PERSONA
      || '節約と時短を大事にする20〜40代。売り込まれるのは苦手だが、良いものは知りたい',
    /** 楽天ROOMのコメントは長いと折り返されて読まれない。80字前後が実用上限 */
    roomMaxChars: num(env.ROOM_MAX_CHARS, 80),
    roomHashtags: num(env.ROOM_HASHTAGS, 5),
    roomDisclosureText: env.ROOM_DISCLOSURE_TEXT || '#PR #広告',
    /** 1日に用意する投稿候補の数（動画のルーティンは1日1〜2投稿） */
    roomPostsPerDay: num(env.ROOM_POSTS_PER_DAY, 2),
    /** お買い物マラソン期に出す買い回りリストの件数（10ショップで倍率上限） */
    kaimawariCount: num(env.KAIMAWARI_COUNT, 10),
    /**
     * 紹介文の書き方。
     * pain-first = 既定。ペインは一人称で実感を込めて書き、解決は推量で書く。
     *              「使ったあとの自分」を想像させつつ、使用体験は主張しない。
     * auto       = data/owned-items.json に登録済みの商品だけ使用体験として書き、
     *              未登録の商品は自動的に pain-first に落とす。
     */
    writingMode: (env.ROOM_WRITING_MODE || 'auto').toLowerCase(),
  },

  /** 使用シーン画像の生成（OpenAI gpt-image-1） */
  scene: {
    enabled: bool(env.SCENE_IMAGE_ENABLED, false),
    apiKey: env.OPENAI_API_KEY || '',
    baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, ''),
    model: env.SCENE_IMAGE_MODEL || 'gpt-image-1',
    /** gpt-image-1 が受け付けるのは 1024x1024 / 1024x1536 / 1536x1024 / auto */
    size: env.SCENE_IMAGE_SIZE || '1024x1536',
    quality: env.SCENE_IMAGE_QUALITY || 'medium',
    /**
     * 生成画像に「AI生成」の小さな表示を焼き込む。
     * 実写と誤認させないための措置。既定で有効。
     */
    label: bool(env.SCENE_IMAGE_LABEL, true),
    labelText: env.SCENE_IMAGE_LABEL_TEXT || 'AI生成イメージ',
  },

  image: {
    width: num(env.IMAGE_WIDTH, 1080),
    height: num(env.IMAGE_HEIGHT, 1350),
    /** 明示指定が無ければ既知のCJKフォントを順に探す */
    fontPathBold: env.FONT_PATH_BOLD || '',
    fontPathRegular: env.FONT_PATH_REGULAR || '',
    accent: env.IMAGE_ACCENT || '#2563EB',
    accent2: env.IMAGE_ACCENT2 || '#0EA5E9',
  },

  instagram: {
    graphVersion: env.IG_GRAPH_VERSION || 'v23.0',
    /** graph.facebook.com（FBページ連携）か graph.instagram.com（Instagram Login）か */
    graphHost: env.IG_GRAPH_HOST || 'graph.facebook.com',
    userId: env.IG_USER_ID || '',
    accessToken: env.IG_ACCESS_TOKEN || '',
    appId: env.META_APP_ID || '',
    appSecret: env.META_APP_SECRET || '',
    /** コンテナ処理完了を待つ最大秒数 */
    containerTimeoutSec: num(env.IG_CONTAINER_TIMEOUT_SEC, 180),
  },

  limits: {
    /** IG Content Publishing API の上限は 24時間あたり 50 件。安全側に絞る */
    maxPostsPerDay: Math.min(50, num(env.MAX_POSTS_PER_DAY, 2)),
  },

  dryRun: bool(env.DRY_RUN, false),
};

/** 実行モードごとに本当に必要な設定だけを検証する */
export function requireConfig(scope) {
  const missing = [];
  const need = (cond, name) => { if (!cond) missing.push(name); };

  if (scope === 'research' || scope === 'run') {
    if (config.research.provider === 'rakuten') need(config.research.rakutenAppId, 'RAKUTEN_APP_ID');
  }
  if (scope === 'build' || scope === 'run') {
    need(config.content.anthropicApiKey, 'ANTHROPIC_API_KEY');
  }
  if (scope === 'publish' || (scope === 'run' && config.postMode === 'auto')) {
    need(config.instagram.userId, 'IG_USER_ID');
    need(config.instagram.accessToken, 'IG_ACCESS_TOKEN');
    need(config.publicBaseUrl, 'PUBLIC_BASE_URL');
  }
  if (missing.length) {
    throw new Error(
      `必要な環境変数が未設定です: ${missing.join(', ')}\n` +
      `auto-instagram/.env.example を参照して設定してください。`
    );
  }
}

export default config;
