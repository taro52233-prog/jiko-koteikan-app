// ③ メアド取得済みの相手だけ営業文面を自動生成
//   data/outbox.csv（送信キュー）＋ data/previews/*.txt（人が目視確認用）を作る
//   特定電子メール法に必要な「送信者情報」「配信停止」を必ず末尾に付与する
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, sender } from "../config.js";
import { readCsv, writeCsv } from "./lib/csv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(__dirname, "..", "data", "leads-emails.csv");
const OUT = path.join(__dirname, "..", "data", "outbox.csv");
const PREVIEW_DIR = path.join(__dirname, "..", "data", "previews");
const UNSUB = path.join(__dirname, "..", "data", "unsubscribe.csv");

function merge(tpl, ctx) {
  return tpl.replace(/\{([^}]+)\}/g, (m, key) => (ctx[key] !== undefined ? ctx[key] : m));
}

function legalFooter() {
  const lines = [
    "─────────────────────────",
    sender.companyName,
    sender.personName ? `担当：${sender.personName}` : "",
    sender.address ? `住所：${sender.address}` : "",
    sender.tel ? `TEL：${sender.tel}` : "",
    sender.email ? `Email：${sender.email}` : "",
    sender.website || "",
    "",
    "※本メールは貴社サイト等で公開されているアドレス宛にお送りしています。",
    "※今後の配信をご希望されない場合は、お手数ですが本メールにご返信ください。",
    "  以後お送りしないよう対応いたします。",
    "─────────────────────────",
  ].filter((l) => l !== "");
  return lines.join("\n");
}

function checkSender() {
  const missing = [];
  if (!sender.companyName) missing.push("SENDER_COMPANY");
  if (!sender.address) missing.push("SENDER_ADDRESS"); // 法律上ほぼ必須
  if (!sender.email) missing.push("GMAIL_USER");
  if (missing.length) {
    console.error("❌ 送信者情報が不足しています（.env）：" + missing.join(", "));
    console.error("   特定電子メール法により、送信者の名称・住所・連絡先の表示が必要です。");
    process.exit(1);
  }
}

function safeFileName(s) {
  return s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
}

function run() {
  checkSender();

  const leads = readCsv(IN);
  if (!leads.length) {
    console.error(`❌ ${path.relative(process.cwd(), IN)} が空です。先に npm run extract を実行してください。`);
    process.exit(1);
  }

  const unsubSet = new Set(readCsv(UNSUB).map((r) => (r.email || "").toLowerCase()));
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  // 既存プレビューを掃除
  for (const f of fs.readdirSync(PREVIEW_DIR)) {
    if (f.endsWith(".txt")) fs.unlinkSync(path.join(PREVIEW_DIR, f));
  }

  const outbox = [];
  let skipped = 0;
  for (const lead of leads) {
    const email = (lead.email || "").trim();
    if (!email) {
      skipped++;
      continue;
    }
    if (unsubSet.has(email.toLowerCase())) {
      skipped++;
      continue;
    }

    const ctx = {
      ...lead,
      自社名: sender.companyName,
      担当者名: sender.personName,
    };
    const subject = merge(config.template.subject, ctx);
    const body = merge(config.template.body, ctx) + "\n\n" + legalFooter();

    outbox.push({
      会社名: lead.会社名,
      email,
      subject,
      body,
      status: "未送信",
      sent_at: "",
    });

    const fname = `${String(outbox.length).padStart(3, "0")}_${safeFileName(lead.会社名)}.txt`;
    fs.writeFileSync(
      path.join(PREVIEW_DIR, fname),
      `To: ${email}\nSubject: ${subject}\n\n${body}\n`,
      "utf8"
    );
  }

  writeCsv(OUT, outbox, ["会社名", "email", "subject", "body", "status", "sent_at"]);
  console.log(`✅ 送信キュー ${outbox.length}件を ${path.relative(process.cwd(), OUT)} に生成`);
  console.log(`   プレビュー: ${path.relative(process.cwd(), PREVIEW_DIR)}/*.txt （送信前に必ず目視確認を）`);
  if (skipped) console.log(`   スキップ ${skipped}件（メアド無し／配信停止済み）`);
}

run();
