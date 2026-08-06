// ① 堺市近辺の葬儀社をGoogle Places API(New)で収集し data/leads.csv を作る
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { writeCsv } from "./lib/csv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "leads.csv");

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error("❌ GOOGLE_PLACES_API_KEY が未設定です。.env を確認してください。");
  process.exit(1);
}

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "nextPageToken",
].join(",");

async function searchText(query, pageToken) {
  const body = {
    textQuery: query,
    languageCode: config.search.language,
    regionCode: config.search.region,
    locationBias: {
      circle: {
        center: {
          latitude: config.search.center.lat,
          longitude: config.search.center.lng,
        },
        radius: config.search.radiusMeters,
      },
    },
  };
  if (pageToken) body.pageToken = pageToken;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": FIELDS,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places API ${res.status}: ${text}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const byId = new Map();

  for (const query of config.search.queries) {
    let pageToken;
    let page = 0;
    do {
      page++;
      let data;
      try {
        data = await searchText(query, pageToken);
      } catch (e) {
        console.error(`  ⚠ "${query}" p${page}: ${e.message}`);
        break;
      }
      const places = data.places || [];
      for (const p of places) {
        if (!byId.has(p.id)) {
          byId.set(p.id, {
            会社名: p.displayName?.text || "",
            住所: p.formattedAddress || "",
            電話: p.nationalPhoneNumber || "",
            サイト: p.websiteUri || "",
            place_id: p.id,
          });
        }
      }
      console.log(`  "${query}" p${page}: +${places.length}件 (累計 ${byId.size})`);
      pageToken = data.nextPageToken;
      if (pageToken) await sleep(2000); // 次ページトークンは少し待つと安定
    } while (pageToken);
  }

  const rows = [...byId.values()];
  writeCsv(OUT, rows, ["会社名", "住所", "電話", "サイト", "place_id"]);
  console.log(`\n✅ ${rows.length}件を ${path.relative(process.cwd(), OUT)} に保存しました。`);
  const noSite = rows.filter((r) => !r.サイト).length;
  if (noSite) console.log(`   （うち ${noSite}件 はサイトURL無し → メアド抽出は対象外になります）`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
