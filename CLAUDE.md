# markitdown-yoshi

Microsoft markitdown CLIをラップした自作MCPサーバー。PDF・Word・Excel・PPT・画像・音声等をMarkdownに変換する。

## 技術スタック
- Node.js 18+
- @modelcontextprotocol/sdk v1.11+
- ES modules (type: "module")
- 変換エンジン: `python -m markitdown`（既存CLIに委譲）

## セットアップ
```bash
cd markitdown-yoshi
npm install
```

## ビルド
ビルドステップなし（ES modulesそのまま）

## テスト
```bash
npm test
```

## 起動（MCP server）
```bash
node bin/markitdown-yoshi.js  # stdio経由でMCPプロトコル待受
```

## 開発規約
- **パストラバーサル対策は最優先**: 変換実行前に `validatePath` で必ず検証する。mcp-yoshiへの依存は事後フィルターであり事前ガードの代替にならない
- **spawn は配列引数形式**: シェル経由しないことでコマンドインジェクションを防ぐ
- **stdoutはMCPプロトコル専用**: ログ・警告は必ず `process.stderr` に出す
- **タイムアウト・並列数制限は必須**: Python子プロセスの暴走を防ぐ
- **変換ロジックは自前で書かない**: 既存markitdown CLIに全委譲（保守負担削減）
- **ツール説明文は6コンポーネント**: 目的・引数・戻り値・副作用・前提条件・例外（search-yoshiと同形式）
- エントリポイント: `bin/markitdown-yoshi.js`、コアロジック: `src/converter.js`
- **PDF classifier (v0.2.0+)**: `src/classifier.js` + `src/pdf_classifier.py`。pdf-inspector (firecrawl) のL1判定相当をpypdfで内製（Windows prebuilt未対応のため）。convert() 戻り値に PDF 限定で `pdf_classification` 自動付与、単体ツール `classify_pdf` も提供。pypdf未導入時は graceful degradation（`pdf_classification: null` で続行）

## 設定のカスタマイズ

環境変数で上書き可能:
- `MARKITDOWN_YOSHI_ALLOWED_ROOTS`: 許可ディレクトリ（`;` 区切り）
- `MARKITDOWN_YOSHI_PYTHON`: Python実行コマンド（デフォルト `python`）

## セキュリティモデル

| 層 | 防御対象 | 実装箇所 |
|---|---------|---------|
| パス検証 | パストラバーサル | `converter.js` validatePath |
| spawn配列 | コマンドインジェクション | `converter.js` runMarkitdown |
| サイズ上限 | リソース枯渇（入力） | `converter.js` validatePath |
| 文字数上限 | リソース枯渇（出力） | `converter.js` truncate |
| タイムアウト | 暴走プロセス | `converter.js` runMarkitdown |
| 並列数制限 | 同時実行によるリソース枯渇 | `converter.js` Semaphore |
| UTF-8強制 | Windows文字化け | `converter.js` PYTHONIOENCODING |

## 既知の制限
- Windows依存（パス区切り文字・エンコーディング処理がWindows前提）
- Python + markitdown が別途必要（このパッケージ自体には同梱しない）
- **pypdf** も別途必要（PDF classifier 機能使用時のみ）。`pip install pypdf` で導入。未導入時は `pdf_classification: null` で graceful degradation し、markdown 変換本体は通常通り動作
- npm公開はしていない（ローカル専用）
