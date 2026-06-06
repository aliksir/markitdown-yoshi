// 設定値（セキュリティ・制限）
import path from 'node:path';

// 許可ディレクトリ（この配下のファイルのみ変換可能）
// 新たなディレクトリを追加したい場合は環境変数 MARKITDOWN_YOSHI_ALLOWED_ROOTS で上書き可能（;区切り）
const DEFAULT_ALLOWED_ROOTS = [
  'C:/work',
  'C:/Users/aliks/Documents',
  'C:/Users/aliks/Downloads',
  'C:/Users/aliks/Desktop'
];

function parseAllowedRoots() {
  const envVar = process.env.MARKITDOWN_YOSHI_ALLOWED_ROOTS;
  const roots = envVar ? envVar.split(';') : DEFAULT_ALLOWED_ROOTS;
  // 正規化: OSパス形式に揃える + 小文字化（Windowsの大文字小文字無視対応）
  return roots.map(r => path.resolve(r).replace(/\\/g, '/').toLowerCase());
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
