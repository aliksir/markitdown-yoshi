// PDF classifier — pdf_classifier.py を spawn して結果を JSON で受け取る
// - セキュリティ: spawn 配列引数（シェル経由せず）、UTF-8、タイムアウト、セマフォ
// - graceful degradation: python/pypdf 未導入やタイムアウト時は null を返す（呼び出し側で「分類不能」として扱う）
// - キャッシュ: cache.js の LRUCache を converter と別インスタンスで使う

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { LRUCache } from './cache.js';
import { Semaphore } from './semaphore.js';

const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'pdf_classifier.py'
);

// converter.js と別インスタンス（デッドロック回避・独立TTL管理）
const classifierCache = new LRUCache(CONFIG.CACHE_MAX_ENTRIES, CONFIG.CACHE_TTL_MS);

// 独立セマフォ（converter と共有するとデッドロック可能性あり、インスタンスを分ける）
const classifierSemaphore = new Semaphore(CONFIG.MAX_CONCURRENT);

// ==== spawn で pdf_classifier.py を呼ぶ ====
async function runClassifier(resolvedPath) {
  return new Promise((resolve, reject) => {
    // spawn 配列引数 → シェル経由なし → コマンドインジェクション防止
    const child = spawn(
      CONFIG.PYTHON_CMD,
      [SCRIPT_PATH, resolvedPath],
      {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        },
        windowsHide: true
      }
    );

    const stdoutChunks = [];
    const stderrChunks = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, CONFIG.TIMEOUT_MS);

    child.stdout.on('data', chunk => stdoutChunks.push(chunk));
    child.stderr.on('data', chunk => stderrChunks.push(chunk));

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        return reject(new Error(`pdf_classifier timed out after ${CONFIG.TIMEOUT_MS}ms`));
      }
      if (code !== 0) {
        const errText = Buffer.concat(stderrChunks).toString('utf8');
        return reject(new Error(`pdf_classifier exited with code ${code}: ${errText.slice(0, 500)}`));
      }
      const out = Buffer.concat(stdoutChunks).toString('utf8').trim();
      try {
        resolve(JSON.parse(out));
      } catch (err) {
        reject(new Error(`pdf_classifier output not JSON: ${err.message} / raw: ${out.slice(0, 200)}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn pdf_classifier: ${err.message}`));
    });
  });
}

// ==== 公開API ====
// resolvedPath は呼び出し側で validatePath 済みの前提。
// 戻り値: 分類結果オブジェクト or null（spawn失敗・タイムアウト・pypdf未インストール等のgraceful degradation）
export async function classifyPdf(resolvedPath) {
  // キャッシュヒット
  const cached = classifierCache.get(resolvedPath);
  if (cached !== null) {
    return { ...cached, cached: true };
  }

  try {
    const result = await classifierSemaphore.run(() => runClassifier(resolvedPath));
    classifierCache.set(resolvedPath, result);
    return { ...result, cached: false };
  } catch (err) {
    // graceful degradation: spawn 失敗・pypdf 未導入・タイムアウト等は null
    // stderr に警告を出し、呼び出し側は pdf_classification を undefined 扱いで続行
    process.stderr.write(`[classifier] skipped (${err.message})\n`);
    return null;
  }
}

// テスト用
export function _clearCache() {
  classifierCache.clear();
}
