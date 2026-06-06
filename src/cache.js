// LRU + TTL キャッシュ
// ファイルパス + mtime をキーとし、同じファイルの再変換を回避する

import fs from 'node:fs';

export class LRUCache {
  constructor(maxEntries, ttlMs) {
    this.max = maxEntries;
    this.ttl = ttlMs;
    this.map = new Map();
  }

  /**
   * キャッシュキーを生成（ファイルパス + mtime + size）
   * ファイルが変更されたら自動的に別エントリとして扱われる
   */
  _makeKey(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return `${filePath}::${stat.mtimeMs}::${stat.size}`;
    } catch {
      return null;
    }
  }

  get(filePath) {
    const key = this._makeKey(filePath);
    if (!key) return null;

    const entry = this.map.get(key);
    if (!entry) return null;

    // TTL チェック
    if (Date.now() - entry.time > this.ttl) {
      this.map.delete(key);
      return null;
    }

    // LRU: アクセスしたエントリを最新位置に移動
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(filePath, value) {
    const key = this._makeKey(filePath);
    if (!key) return;

    // 容量超過時、最古のエントリを削除
    if (this.map.size >= this.max) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }

    this.map.set(key, { value, time: Date.now() });
  }

  clear() {
    this.map.clear();
  }

  size() {
    return this.map.size;
  }
}
