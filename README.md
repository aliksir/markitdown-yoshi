# markitdown-yoshi

> ちゃんと変換してヨシッ！

Microsoft markitdown CLIをラップした自作MCPサーバー。Claude CodeからPDF・Word・Excel・PPT・画像・音声などをMarkdownに変換できる。

## なぜ自作か

- **外部API不使用・ローカル処理のみ**: テレメトリゼロ・課金ゼロ
- **セキュリティ制御**: パストラバーサル・サイズ爆発・タイムアウト・並列数を自前で制御
- **既存CLIに委譲**: 変換ロジックは `python -m markitdown` に全委譲、メンテ負担最小

## 要件

- Node.js 18+
- Python 3.10+ + markitdown (`pip install 'markitdown[all]'`)
- （任意）pypdf (`pip install pypdf`) — PDF classifier 機能用。未導入時は classification が `null` になるだけで変換本体は動作

## セットアップ

```bash
git clone https://github.com/aliksir/markitdown-yoshi.git
cd markitdown-yoshi
npm install
```

## Claude Code MCP 登録

`.mcp.json` に追記:

```json
{
  "mcpServers": {
    "markitdown-yoshi": {
      "command": "node",
      "args": ["/path/to/markitdown-yoshi/bin/markitdown-yoshi.js"]
    }
  }
}
```

## 提供ツール

### `convert(file_path, max_chars?)`
ファイルをMarkdownに変換する。許可ディレクトリ配下のみ対応。

- 戻り値: `{ markdown, truncated, cached, pdf_classification? }`（PDFの場合のみ `pdf_classification` 自動付与。キャッシュヒット時は省略）
- デフォルト上限: 入力10MB、出力500KB、タイムアウト30秒、並列2

### `classify_pdf(file_path)` （v0.2.0+）
PDFをテキストベース/スキャン画像/混在に分類する。pdf-inspector (firecrawl) のL1判定相当を pypdf で内製。

- 戻り値: `{ pdf_type: "TextBased"|"Scanned"|"Mixed"|"Unknown", page_count, pages_needing_ocr, confidence, text_pages, empty_pages, cached }`
- 判定アルゴ: 各ページの `extract_text()` 長 ≥ 5文字で text判定、比率から分類（L1 = Tj/TJ 相当のみ）
- L1スコープのため `ImageBased`（Do operator検出ベース）は返さない。スキャンPDFは `Scanned`
- 外部通信なし（pypdfは純Python、MIT）
- pypdf未導入時は `{ pdf_type: "Unknown", error: "pypdf not installed..." }` でgraceful return

### `supported_formats()`
対応ファイル形式の一覧を返す。

## セキュリティ

詳細は `CLAUDE.md` の「セキュリティモデル」参照。

## 関連ツール

- [pii-mask-yoshi](https://github.com/aliksir/pii-mask-yoshi) — PII自動マスクMCPサーバー。`safe_read` でバイナリファイルを読む際に `python -m markitdown` を直接呼び出す（markitdown-yoshiとは独立動作）
- [neko-not-yoshi](https://github.com/aliksir/neko-not-yoshi) — NGワード・カスタムパターン定義

## ライセンス
MIT
