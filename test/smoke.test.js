// スモークテスト — 基本的な動作とセキュリティ検証
// 実行: node test/smoke.test.js

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';


import assert from 'node:assert/strict';
import { convert, validatePath, supportedFormats, _clearCache } from '../src/converter.js';
import { classifyPdf, _clearCache as _clearClassifierCache } from '../src/classifier.js';
import { LRUCache } from '../src/cache.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(`  ${err.message}`);
    if (err.stack) console.error(`  ${err.stack.split('\n').slice(1, 3).join('\n  ')}`);
    failed++;
  }
}

async function assertThrows(fn, pattern, msg) {
  try {
    await fn();
    throw new Error(`Expected error matching ${pattern}, but none thrown: ${msg}`);
  } catch (err) {
    if (!pattern.test(err.message)) {
      throw new Error(`Expected "${pattern}", got "${err.message}": ${msg}`);
    }
  }
}

// テスト用の一時ファイル準備（C:/work/配下 = 許可ディレクトリ内）
const TMP_DIR = path.join(process.cwd(), '_test_tmp');
const SMALL_TXT = path.join(TMP_DIR, 'small.txt');
const LARGE_BIN = path.join(TMP_DIR, 'large.bin');

function setup() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(SMALL_TXT, 'Hello markitdown-yoshi テスト\nこれは日本語テキスト。', 'utf8');
  // 11MB のダミーファイル（MAX_FILE_SIZE=10MB を超過）
  fs.writeFileSync(LARGE_BIN, Buffer.alloc(11 * 1024 * 1024));
}

function teardown() {
  try {
    if (fs.existsSync(SMALL_TXT)) fs.unlinkSync(SMALL_TXT);
    if (fs.existsSync(LARGE_BIN)) fs.unlinkSync(LARGE_BIN);
    if (fs.existsSync(TMP_DIR)) fs.rmdirSync(TMP_DIR);
  } catch {
    // ignore
  }
}

setup();

// ==== セキュリティテスト（パストラバーサル・サイズ） ====

await test('validatePath: 許可外パス（C:/Windows/...）でエラー', async () => {
  assert.throws(
    () => validatePath('C:/Windows/System32/drivers/etc/hosts'),
    /outside allowed roots/
  );
});

await test('validatePath: 許可外パス（相対パスでの脱出試行）でエラー', async () => {
  // C:/work 配下に見えるが、resolveすると外に出るパターン
  // 実際には path.resolve が正規化するので、文字列操作ではバイパスできない
  assert.throws(
    () => validatePath('C:/work/../../Windows/System32/cmd.exe'),
    /outside allowed roots/
  );
});

await test('validatePath: 存在しないファイルでエラー', async () => {
  assert.throws(
    () => validatePath(path.join(process.cwd(), 'does-not-exist-xyz-123.pdf')),
    /not found/i
  );
});

await test('validatePath: ディレクトリ指定でエラー', async () => {
  assert.throws(
    () => validatePath(process.cwd()),
    /not a regular file/i
  );
});

await test('validatePath: サイズ超過ファイルでエラー', async () => {
  assert.throws(
    () => validatePath(LARGE_BIN),
    /too large/i
  );
});

await test('validatePath: 空文字でエラー', async () => {
  assert.throws(() => validatePath(''), /non-empty string/);
});

await test('validatePath: 非文字列でエラー', async () => {
  assert.throws(() => validatePath(123), /non-empty string/);
});

// ==== LRUキャッシュ単体テスト ====

await test('LRUCache: set → get が成功', async () => {
  const cache = new LRUCache(3, 1000);
  cache.set(SMALL_TXT, 'hello');
  const val = cache.get(SMALL_TXT);
  assert.equal(val, 'hello');
});

await test('LRUCache: TTL超過で null 返却', async () => {
  const cache = new LRUCache(3, 10); // 10ms TTL
  cache.set(SMALL_TXT, 'hello');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(cache.get(SMALL_TXT), null);
});

await test('LRUCache: ファイル変更で別エントリ扱い（mtime変化）', async () => {
  const cache = new LRUCache(3, 10_000);
  cache.set(SMALL_TXT, 'v1');
  // ファイルを変更 → mtime更新 → キャッシュキーが変わる
  await new Promise(r => setTimeout(r, 10));
  fs.writeFileSync(SMALL_TXT, 'changed content', 'utf8');
  assert.equal(cache.get(SMALL_TXT), null);
  // 元に戻す（他テストへの副作用防止）
  fs.writeFileSync(SMALL_TXT, 'Hello markitdown-yoshi テスト\nこれは日本語テキスト。', 'utf8');
});

// ==== 機能テスト ====

await test('supportedFormats: 非空の配列を返す', async () => {
  const formats = supportedFormats();
  assert.ok(Array.isArray(formats));
  assert.ok(formats.length > 0);
  assert.ok(formats.includes('pdf'));
});

await test('convert: 小さなtxtファイル変換成功（Python側に依存）', async () => {
  _clearCache();
  try {
    const result = await convert(SMALL_TXT);
    assert.ok(typeof result.markdown === 'string');
    assert.ok(result.markdown.length > 0);
    assert.equal(result.cached, false);
  } catch (err) {
    // markitdown未インストール等の環境問題はスキップ（実環境でのみ実行可能）
    if (/Failed to spawn|ENOENT/.test(err.message)) {
      console.log(`  SKIP (python/markitdown not available): ${err.message}`);
      return;
    }
    throw err;
  }
});

await test('convert: 2回目はキャッシュヒット', async () => {
  try {
    // 1回目
    await convert(SMALL_TXT);
    // 2回目
    const result = await convert(SMALL_TXT);
    assert.equal(result.cached, true);
  } catch (err) {
    if (/Failed to spawn|ENOENT/.test(err.message)) {
      console.log(`  SKIP (python/markitdown not available)`);
      return;
    }
    throw err;
  }
});

await test('convert: 許可外パスでエラー（convert経由でも）', async () => {
  await assertThrows(
    () => convert('C:/Windows/System32/drivers/etc/hosts'),
    /outside allowed roots/,
    'convert should reject paths outside allowed roots'
  );
});

await test('convert: サイズ超過でエラー（spawn非実行）', async () => {
  await assertThrows(
    () => convert(LARGE_BIN),
    /too large/i,
    'convert should reject oversized files before spawning'
  );
});

// ==== PDF classifier テスト（v0.2.0+）====

await test('convert: 非PDFで pdf_classification が付与されない', async () => {
  _clearCache();
  _clearClassifierCache();
  try {
    const result = await convert(SMALL_TXT);
    // 非PDF なので pdf_classification は undefined（JSON serialize で省略）
    assert.equal(result.pdf_classification, undefined);
  } catch (err) {
    if (/Failed to spawn|ENOENT/.test(err.message)) {
      console.log(`  SKIP (python/markitdown not available)`);
      return;
    }
    throw err;
  }
});

await test('classifyPdf: 存在するtxtファイル（.pdf拡張子チェックは呼び側責務、関数自体はpathで動く）', async () => {
  _clearClassifierCache();
  // .txt を渡してもpypdf側でエラーになり pdf_type="Unknown" を返す想定。
  // spawnやpypdfがない環境では null を返す（graceful degradation）。
  const result = await classifyPdf(SMALL_TXT);
  if (result === null) {
    console.log('  SKIP (python/pypdf not available → null)');
    return;
  }
  // pypdf 導入済みなら Unknown を返す（.txt は PDF として開けない）
  assert.ok(typeof result.pdf_type === 'string', 'pdf_type should be string');
  assert.ok(['TextBased', 'Scanned', 'Mixed', 'ImageBased', 'Unknown'].includes(result.pdf_type));
});

await test('classifyPdf: 戻り値スキーマ確認（必須キー）', async () => {
  _clearClassifierCache();
  const result = await classifyPdf(SMALL_TXT);
  if (result === null) {
    console.log('  SKIP (python/pypdf not available)');
    return;
  }
  for (const key of ['pdf_type', 'page_count', 'pages_needing_ocr', 'confidence', 'text_pages', 'empty_pages']) {
    assert.ok(key in result, `missing key: ${key}`);
  }
  assert.ok(Array.isArray(result.pages_needing_ocr), 'pages_needing_ocr should be array');
  assert.ok(typeof result.confidence === 'number', 'confidence should be number');
});

await test('classifyPdf: 2回目はキャッシュヒット', async () => {
  _clearClassifierCache();
  const first = await classifyPdf(SMALL_TXT);
  if (first === null) {
    console.log('  SKIP (python/pypdf not available)');
    return;
  }
  const second = await classifyPdf(SMALL_TXT);
  assert.equal(second.cached, true, 'second call should be cache hit');
});

await test('MCP TOOLS: classify_pdf がtoolsリストに含まれる', async () => {
  const { TOOLS } = await import('../src/index.js');
  const toolNames = TOOLS.map(t => t.name);
  assert.ok(toolNames.includes('classify_pdf'), `classify_pdf missing. Got: ${toolNames.join(', ')}`);
  assert.ok(toolNames.includes('convert'), 'convert should still be present');
  assert.ok(toolNames.includes('supported_formats'), 'supported_formats should still be present');
  // classify_pdf の description に6コンポーネントが含まれているか軽くチェック
  const classifyTool = TOOLS.find(t => t.name === 'classify_pdf');
  for (const keyword of ['目的:', '引数:', '戻り値:', '副作用:', '前提条件:', '例外:']) {
    assert.ok(classifyTool.description.includes(keyword), `description missing ${keyword}`);
  }
});

// ==== 結果集計 ====

teardown();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
