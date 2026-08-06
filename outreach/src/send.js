// ④ 送信。デフォルトは【ドライラン】（送らず内容確認のみ）。
//   実送信は  npm run send:live  （最終確認プロンプトあり／Gmail使用）
import "dotenv/config";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { config, sender } from "../config.js";
import { readCsv, writeCsv } from "./lib/csv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTBOX = path.join(__dirname, "..", "data", "outbox.csv");
const LOG = path.join(__dirname, "..", "data", "sent-log.csv");
const UNSUB = path.join(__dirname, "..", "data", "unsubscribe.csv");

const LIVE = process.argv.includes("--live");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => (rl.close(), res(a.trim()))));
}

async function run() {
  const outbox = readCsv(OUTBOX);
  const queue = outbox.filter((r) => r.status !== "送信済み" && (r.email || "").trim());
  const unsubSet = new Set(readCsv(UNSUB).map((r) => (r.email || "").toLowerCase()));
  const targets = queue
    .filter((r) => !unsubSet.has((r.email || "").toLowerCase()))
    .slice(0, config.send.dailyLimit);

  if (!targets.length) {
    console.log("送信対象がありません（未送信0件、または上限到達）。");
    return;
  }

  console.log(`対象 ${targets.length}件（本日上限 ${config.send.dailyLimit}件）\n`);

  // ── ドライラン ─────────────────────────────
  if (!LIVE) {
    for (const r of targets) {
      console.log(`── To: ${r.email}  (${r.会社名})`);
      console.log(`   Subject: ${r.subject}`);
      console.log(`   Body(先頭): ${r.body.split("\n").slice(0, 2).join(" / ")}...`);
    }
    console.log(`\n🟡 ドライランです。実際には送信していません。`);
    console.log(`   内容OKなら:  npm run send:live`);
    return;
  }

  // ── 実送信 ────────────────────────────────
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.error("❌ GMAIL_USER / GMAIL_APP_PASSWORD が未設定です（Googleアプリパスワードを使用）。");
    process.exit(1);
  }

  const ans = await ask(`⚠ ${targets.length}件に実送信します。本当に送りますか？ (yes/no) > `);
  if (ans.toLowerCase() !== "yes") {
    console.log("中止しました。");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  try {
    await transporter.verify();
  } catch (e) {
    console.error("❌ Gmail認証に失敗:", e.message);
    process.exit(1);
  }

  const fromName = sender.companyName || user;
  const logRows = readCsv(LOG);

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${user}>`,
        to: r.email,
        subject: r.subject,
        text: r.body,
      });
      r.status = "送信済み";
      r.sent_at = new Date().toISOString();
      logRows.push({ 会社名: r.会社名, email: r.email, subject: r.subject, sent_at: r.sent_at, result: "OK", detail: info.messageId });
      console.log(`[${i + 1}/${targets.length}] ✅ ${r.email}`);
    } catch (e) {
      r.status = "失敗";
      logRows.push({ 会社名: r.会社名, email: r.email, subject: r.subject, sent_at: new Date().toISOString(), result: "NG", detail: e.message });
      console.log(`[${i + 1}/${targets.length}] ❌ ${r.email} : ${e.message}`);
    }

    // 進捗を都度保存（途中で止めても安全）
    writeCsv(OUTBOX, outbox, ["会社名", "email", "subject", "body", "status", "sent_at"]);
    writeCsv(LOG, logRows, ["会社名", "email", "subject", "sent_at", "result", "detail"]);

    if (i < targets.length - 1) {
      const { minIntervalMs: lo, maxIntervalMs: hi } = config.send;
      const wait = lo + Math.floor(Math.random() * Math.max(0, hi - lo));
      console.log(`   …次の送信まで ${Math.round(wait / 1000)}秒`);
      await sleep(wait);
    }
  }

  const ok = logRows.filter((r) => r.result === "OK").length;
  console.log(`\n✅ 完了。送信ログ: ${path.relative(process.cwd(), LOG)}（累計OK ${ok}件）`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
