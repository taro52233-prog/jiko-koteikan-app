// ② 各社サイトを巡回してメールアドレスを抽出し data/leads-emails.csv を作る
//   メアドが無い場合は「問い合わせフォームの有無」を記録する
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { config } from "../config.js";
import { readCsv, writeCsv } from "./lib/csv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(__dirname, "..", "data", "leads.csv");
const OUT = path.join(__dirname, "..", "data", "leads-emails.csv");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 画像ファイル名等の誤検出を弾く
const BAD_SUFFIX = /\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.extract.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OutreachBot/1.0)" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const emails = new Set();

  // 1) mailto: リンク
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const addr = href.replace(/^mailto:/i, "").split("?")[0].trim();
    if (addr) emails.add(addr);
  });

  // 2) 本文テキストの正規表現マッチ
  const text = $("body").text();
  const matches = text.match(EMAIL_RE) || [];
  for (const m of matches) {
    if (!BAD_SUFFIX.test(m)) emails.add(m);
  }

  // 問い合わせフォームの有無を判定
  const hasForm =
    $("form").length > 0 &&
    $("form input, form textarea").length > 0;

  // 問い合わせページへのリンクを収集（1階層だけ後で辿る）
  const contactLinks = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const label = ($(el).text() || "") + " " + href;
    if (/(contact|inquiry|toiawase|問い合わせ|問合せ|お問い合わせ)/i.test(label)) {
      try {
        contactLinks.add(new URL(href, baseUrl).href);
      } catch {
        /* 無効URLは無視 */
      }
    }
  });

  return { emails: [...emails], hasForm, contactLinks: [...contactLinks] };
}

async function run() {
  const leads = readCsv(IN);
  if (!leads.length) {
    console.error(`❌ ${path.relative(process.cwd(), IN)} が空です。先に npm run collect を実行してください。`);
    process.exit(1);
  }

  const out = [];
  let idx = 0;
  for (const lead of leads) {
    idx++;
    const row = { ...lead, email: "", email_source: "", has_form: "" };
    const site = (lead.サイト || "").trim();

    if (!site) {
      row.email_source = "サイト無し";
      out.push(row);
      console.log(`[${idx}/${leads.length}] ${lead.会社名} … サイト無し`);
      continue;
    }

    const html = await fetchHtml(site);
    let found = null;
    let hasForm = false;

    if (html) {
      const r = extractFromHtml(html, site);
      hasForm = r.hasForm;
      if (r.emails.length) found = { email: r.emails[0], source: site };

      // トップに無ければ問い合わせページを1つだけ追加で見る
      if (!found && config.extract.followContactPage && r.contactLinks.length) {
        await sleep(config.extract.politeDelayMs);
        const contactUrl = r.contactLinks[0];
        const chtml = await fetchHtml(contactUrl);
        if (chtml) {
          const cr = extractFromHtml(chtml, contactUrl);
          hasForm = hasForm || cr.hasForm;
          if (cr.emails.length) found = { email: cr.emails[0], source: contactUrl };
        }
      }
    }

    if (found) {
      row.email = found.email;
      row.email_source = found.source;
      row.has_form = hasForm ? "有" : "";
      console.log(`[${idx}/${leads.length}] ${lead.会社名} … ✉ ${found.email}`);
    } else {
      row.has_form = hasForm ? "有" : "";
      row.email_source = html ? (hasForm ? "フォームのみ" : "取得不可") : "アクセス不可";
      console.log(`[${idx}/${leads.length}] ${lead.会社名} … ${row.email_source}`);
    }

    out.push(row);
    await sleep(config.extract.politeDelayMs);
  }

  const cols = ["会社名", "住所", "電話", "サイト", "place_id", "email", "email_source", "has_form"];
  writeCsv(OUT, out, cols);

  const withEmail = out.filter((r) => r.email).length;
  const withForm = out.filter((r) => !r.email && r.has_form === "有").length;
  console.log(`\n✅ 保存: ${path.relative(process.cwd(), OUT)}`);
  console.log(`   メアド取得 ${withEmail}件 / フォームのみ ${withForm}件 / 全 ${out.length}件`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
