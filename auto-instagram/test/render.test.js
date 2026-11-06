import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCanvas } from '@napi-rs/canvas';
import { renderCarousel } from '../src/image/render.js';

/** テスト用の商品写真をその場で作り、ローカルHTTPで配る（外部依存を持ち込まない） */
function makeProductJpeg() {
  const c = createCanvas(900, 900);
  const g = c.getContext('2d');
  g.fillStyle = '#E2E8F0'; g.fillRect(0, 0, 900, 900);
  g.fillStyle = '#94A3B8'; g.fillRect(180, 240, 540, 420);
  g.fillStyle = '#475569'; g.fillRect(240, 300, 420, 60);
  return c.encodeSync('jpeg', 90);
}

test('カルーセル画像が日本語込みで生成できる', async (t) => {
  const jpeg = makeProductJpeg();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end(jpeg);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());

  const item = {
    id: 'shop:item-1',
    name: 'ステンレス 真空断熱 タンブラー 470ml 蓋付き 保温 保冷',
    price: 2480,
    shopName: 'テストショップ',
    reviewCount: 1342,
    reviewAverage: 4.56,
    images: [`${base}/a.jpg`, `${base}/b.jpg`],
  };
  const content = {
    hook: { title: '氷が溶けない、あの感覚。', sub: 'レビュー1342件の定番タンブラー' },
    slides: [
      { title: '真空断熱で温度をキープ', body: '内側と外側のあいだを真空にすることで、外気の影響を受けにくい構造になっています。' },
      { title: '蓋つきでこぼれにくい', body: 'デスクでの作業中や移動中でも中身がこぼれにくく、持ち運びやすい仕様です。' },
      { title: '470mlの使いやすい容量', body: 'ペットボトル1本分より少し多め。1回の給水で足りる、ちょうどいいサイズ感です。' },
    ],
    cta: { title: '詳細はプロフィールから', body: '気になった方は保存しておくと、あとから見返せます。' },
  };

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-render-'));
  const cfg = { width: 1080, height: 1350, accent: '#2563EB', accent2: '#0EA5E9', fontPathBold: '', fontPathRegular: '' };

  // シーン画像あり（自前生成の想定）と無しの両方を出す
  const sceneBuffer = (() => {
    const c = createCanvas(1024, 1536);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 1536);
    grad.addColorStop(0, '#F1E9DC'); grad.addColorStop(1, '#8A9BA8');
    g.fillStyle = grad; g.fillRect(0, 0, 1024, 1536);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 900, 1024, 636);
    return c.encodeSync('jpeg', 88);
  })();

  const { files } = await renderCarousel({ item, content, cfg, outDir, slug: 'test-slug', sceneBuffer });

  assert.equal(files.length, 5, 'カバー + 本文3枚 + CTA = 5枚');
  for (const f of files) {
    const buf = fs.readFileSync(f);
    assert.ok(buf.length > 15000, `${path.basename(f)} が小さすぎる (${buf.length}B) = 描画されていない疑い`);
    assert.ok(buf.length < 8 * 1024 * 1024, 'Instagramの8MB上限を超えている');
    assert.equal(buf[0], 0xff, 'JPEGのマジックナンバー');
    assert.equal(buf[1], 0xd8, 'JPEGのマジックナンバー');
  }
  // 目視確認用に残す
  fs.cpSync(path.join(outDir, 'test-slug'), path.join(process.cwd(), 'out', 'sample'), { recursive: true });

  // シーン画像が無い場合もクラッシュせず表紙を作れること
  const plain = await renderCarousel({ item, content, cfg, outDir, slug: 'no-scene' });
  assert.equal(plain.files.length, 5);
  fs.cpSync(path.join(outDir, 'no-scene'), path.join(process.cwd(), 'out', 'no-scene'), { recursive: true });
});
