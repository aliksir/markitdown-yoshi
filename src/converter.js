// セキュアな markitdown 変換ラッパー
// - パストラバーサル対策: 許可ディレクトリ検証
// - コマンドインジェクション対策: spawn の配列引数形式（シェル経由せず）
// - サイズ爆発対策: spawn 前に入力サイズチェック + 出力文字数上限
// - タイムアウト: 30秒でSIGKILL
// - 並列数制限: セマフォ（デフォルト2）
// - UTF-8: Windows環境での文字化け対策

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, SUPPORTED_FORMATS } from './config.js';
import { LRUCache } from './cache.js';
import { Semaphore } from './semaphore.js';
import { classifyPdf } from './classifier.js';

const cache = new LRUCache(CONFIG.CACHE_MAX_ENTRIES, CONFIG.CACHE_TTL_MS);

// ==== 並列数制限セマフォ（classifier と別インスタンス） ====
const semaphore = new Semaphore(CONFIG.MAX_CONCURRENT);

// ==== パス検証（パストラバーサル対策）====
export function validatePath(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('file_path must be a non-empty string');
  }

  // 絶対パス化 + OS差吸収 + 小文字化（Windows）
  const resolved = path.resolve(filePath);
  const normalized = resolved.replace(/\\/g, '/').toLowerCase();

  // 許可ディレクトリ配下か検証
  const allowed = CONFIG.ALLOWED_ROOTS.some(root =>
    normalized === root || normalized.startsWith(root + '/')
  );
  if (!allowed) {
    throw new Error(
      `Path outside allowed roots: ${resolved} (allowed: ${CONFIG.ALLOWED_ROOTS.join(', ')})`
    );
  }

  // 存在確認
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  // ディレクトリでないこと
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a regular file: ${resolved}`);
  }

  // サイズ上限チェック（spawn前にファイルサイズで弾く）
  if (stat.size > CONFIG.MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${stat.size} bytes > ${CONFIG.MAX_FILE_SIZE} bytes`
    );
  }

  return resolved;
}

// ==== spawn実行（stream収集 + UTF-8 + タイムアウト）====
async function runMarkitdown(resolvedPath) {
  return new Promise((resolve, reject) => {
    // spawn の配列引数 → シェル経由せず → コマンドインジェクション防止
    const child = spawn(
      CONFIG.PYTHON_CMD,
      ['-m', 'markitdown', resolvedPath],
      {
        env: {
          ...process.env,
          // Windowsでの日本語文字化け対策
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        },
        windowsHide: true
      }
    );

    const stdoutChunks = [];
    const stderrChunks = [];
    let killed = false;

    // タイムアウト: SIGKILL で確実終了
    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, CONFIG.TIMEOUT_MS);

    // stream収集（maxBuffer問題を回避）
    child.stdout.on('data', chunk => stdoutChunks.push(chunk));
    child.stderr.on('data', chunk => stderrChunks.push(chunk));

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        return reject(new Error(`markitdown timed out after ${CONFIG.TIMEOUT_MS}ms`));
      }
      if (code !== 0) {
        const errText = Buffer.concat(stderrChunks).toString('utf8');
        return reject(new Error(`markitdown exited with code ${code}: ${errText.slice(0, 500)}`));
      }
      const out = Buffer.concat(stdoutChunks).toString('utf8');
      resolve(out);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn markitdown: ${err.message}`));
    });
  });
}

// ==== 文字数切り詰め ====
function truncate(text, maxChars) {
  if (text.length <= maxChars) return { markdown: text, truncated: false };
  return {
    markdown: text.slice(0, maxChars) + '\n\n[...truncated]',
    truncated: true
  };
}

// ==== メインエントリ ====
// PDF の場合は分類結果（pdf_classification）を戻り値に自動付与。
// キャッシュヒット時は classification を取得しない（高速パス優先、必要なら classify_pdf ツールを別途呼ぶ）。
// classifier が失敗（pypdf未導入・タイムアウト等）した場合は pdf_classification: null で返す。
export async function convert(filePath, maxChars) {
  const resolved = validatePath(filePath);
  const limit = Math.min(
    typeof maxChars === 'number' && maxChars > 0 ? maxChars : CONFIG.MAX_OUTPUT_CHARS,
    CONFIG.MAX_OUTPUT_CHARS
  );

  // キャッシュヒット（分類は付与しない — 必要なら classify_pdf ツールで単体取得）
  const cached = cache.get(resolved);
  if (cached !== null) {
    return { ...truncate(cached, limit), cached: true };
  }

  // 並列数制限付きで実行
  const markdown = await semaphore.run(() => runMarkitdown(resolved));
  cache.set(resolved, markdown);

  const result = { ...truncate(markdown, limit), cached: false };

  // PDF なら分類結果を付与（markitdown の後に走るため +~20ms。失敗時は null）
  if (resolved.toLowerCase().endsWith('.pdf')) {
    result.pdf_classification = await classifyPdf(resolved);
  }

  return result;
}

export function supportedFormats() {
  return [...SUPPORTED_FORMATS];
}

// テスト用にキャッシュをリセット
export function _clearCache() {
  cache.clear();
}
