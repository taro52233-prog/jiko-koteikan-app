/**
 * フォント解決。日本語が豆腐(□)になるのは自動生成で最も多い事故なので、
 * 「見つからなければ静かに英語フォントで代替」ではなく明示的に失敗させる。
 */
import fs from 'node:fs';
import { GlobalFonts } from '@napi-rs/canvas';
import { warn } from '../util.js';

export const FAMILY = 'PostJP';

/** 環境ごとに存在しうる CJK フォントを優先度順に並べたもの */
const CANDIDATES_BOLD = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKjp-Bold.otf',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
  '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
  '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf',
  '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
];
const CANDIDATES_REGULAR = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKjp-Regular.otf',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
  '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
  '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
];

function firstExisting(explicit, candidates) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (explicit) warn(`指定フォントが見つかりません: ${explicit}`);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

let registered = false;

/** @returns {{bold:string, regular:string}} 実際に使われたフォントのパス */
export function registerFonts({ fontPathBold, fontPathRegular } = {}) {
  if (registered) return registered;

  const bold = firstExisting(fontPathBold, CANDIDATES_BOLD);
  const regular = firstExisting(fontPathRegular, CANDIDATES_REGULAR) || bold;

  if (!bold) {
    throw new Error(
      '日本語フォントが見つかりません。CI では以下を実行してください:\n' +
      '  sudo apt-get update && sudo apt-get install -y fonts-noto-cjk\n' +
      'または FONT_PATH_BOLD / FONT_PATH_REGULAR でパスを指定してください。'
    );
  }

  GlobalFonts.registerFromPath(bold, `${FAMILY}Bold`);
  GlobalFonts.registerFromPath(regular, FAMILY);
  registered = { bold, regular };
  return registered;
}

export const font = (size, weight = 'bold') =>
  `${size}px ${weight === 'bold' ? `${FAMILY}Bold` : FAMILY}`;
