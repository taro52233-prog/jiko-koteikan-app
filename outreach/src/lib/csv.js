// 依存を増やさない最小限のCSV読み書き（RFC4180風・ダブルクォート対応）
import fs from "node:fs";
import path from "node:path";

function escapeField(v) {
  const s = v === undefined || v === null ? "" : String(v);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function writeCsv(filePath, rows, columns) {
  const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
  const lines = [cols.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => escapeField(row[c])).join(","));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Excelで文字化けしないようUTF-8 BOMを付与
  fs.writeFileSync(filePath, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

export function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  let text = fs.readFileSync(filePath, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM除去

  const records = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        records.push(row);
        field = "";
        row = [];
      } else if (ch === "\r") {
        // skip; \n が処理する
      } else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  if (!records.length) return [];

  const header = records[0];
  return records
    .slice(1)
    .filter((r) => r.some((c) => c !== "")) // 空行除去
    .map((r) => {
      const obj = {};
      header.forEach((h, idx) => (obj[h] = r[idx] ?? ""));
      return obj;
    });
}
