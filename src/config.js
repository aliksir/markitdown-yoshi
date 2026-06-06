// 設定値（セキュリティ・制限）
import path from 'node:path';

// 許可ディレクトリ（この配下のファイルのみ変換可能）
// 環境変数 MARKITDOWN_YOSHI_ALLOWED_ROOTS で上書き可能（;区切り）
import os from 'node:os';

const HOME = os.homedir();
const DEFAULT_ALLOWED_ROOTS = [
  process.cwd(),
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Desktop'),
];

function parseAllowedRoots() {
  const envVar = process.env.MARKITDOWN_YOSHI_ALLOWED_ROOTS;
  const roots = envVar ? envVar.split(';') : DEFAULT_ALLOWED_ROOTS;
  return roots
    .map(r => path.resolve(r).replace(/\\/g, '/').toLowerCase())
    .filter(r => {
      // ファイルシステムルートやホームディレクトリ直下は拒否（セキュリティ）
      if (r === '/' || /^[a-z]:\/$/i.test(r) || r === HOME.replace(/\\/g, '/').toLowerCase()) {
        process.stderr.write(`[markitdown-yoshi] 許可ルートが広すぎます（無視）: ${r}\n`);
        return false;
      }
      return true;
    });
}

export const CONFIG = Object.freeze({
  ALLOWED_ROOTS: parseAllowedRoots(),
  MAX_FILE_SIZE: 10 * 1024 * 1024,       // 10MB（入力ファイルサイズ上限）
  MAX_OUTPUT_CHARS: 500 * 1024,           // 500KB（Markdown出力文字数上限）
  TIMEOUT_MS: 30_000,                     // 30秒（spawn実行タイムアウト）
  MAX_CONCURRENT: 2,                      // 同時実行数上限
  CACHE_MAX_ENTRIES: 50,                  // LRUキャッシュ最大エントリ数
  CACHE_TTL_MS: 60 * 60 * 1000,           // 1時間（キャッシュTTL）
  PYTHON_CMD: process.env.MARKITDOWN_YOSHI_PYTHON || 'python'
});

// markitdownが対応するフォーマット（静的リスト）
export const SUPPORTED_FORMATS = Object.freeze([
  'pdf', 'docx', 'pptx', 'xlsx', 'xls',
  'html', 'htm', 'csv', 'json', 'xml',
  'txt', 'md',
  'jpg', 'jpeg', 'png', 'bmp', 'tiff',
  'mp3', 'wav', 'm4a',
  'zip', 'epub',
  'youtube_url'
]);
