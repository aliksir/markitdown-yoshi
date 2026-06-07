> Japanese version: [README.ja.md](README.ja.md)

# markitdown-yoshi

> Convert it properly... Yoshi!

A self-hosted MCP server wrapping Microsoft's markitdown CLI. Converts PDF, Word, Excel, PowerPoint, images, audio, and more to Markdown directly from Claude Code.

## Why build our own?

- **No external APIs, local processing only**: Zero telemetry, zero cost
- **Security controls**: Path traversal prevention, size limits, timeouts, and concurrency caps -- all managed internally
- **Delegates to the existing CLI**: All conversion logic is handled by `python -m markitdown`, keeping maintenance minimal

## Requirements

- Node.js 18+
- Python 3.10+ with markitdown (`pip install 'markitdown[all]'`)
- (Optional) pypdf (`pip install pypdf`) -- for PDF classifier. Without it, classification returns `null` but conversion works fine

## Setup

```bash
git clone https://github.com/aliksir/markitdown-yoshi.git
cd markitdown-yoshi
npm install
```

## Claude Code MCP Registration

Add to your `.mcp.json`:

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

## Available Tools

### `convert(file_path, max_chars?)`
Converts a file to Markdown. Only files within allowed directories are accepted.

- Returns: `{ markdown, truncated, cached, pdf_classification? }` (`pdf_classification` is included only for PDFs; omitted on cache hits)
- Default limits: 10 MB input, 500 KB output, 30-second timeout, 2 concurrent conversions

### `classify_pdf(file_path)` (v0.2.0+)
Classifies a PDF as text-based, scanned, or mixed. An in-house implementation equivalent to pdf-inspector (firecrawl) L1 classification using pypdf.

- Returns: `{ pdf_type: "TextBased"|"Scanned"|"Mixed"|"Unknown", page_count, pages_needing_ocr, confidence, text_pages, empty_pages, cached }`
- Algorithm: Each page's `extract_text()` output is checked for length >= 5 characters to determine text presence; the ratio determines classification (L1 = Tj/TJ operator level only)
- L1 scope means `ImageBased` (Do operator detection) is not returned; scanned PDFs are classified as `Scanned`
- No external communication (pypdf is pure Python, MIT licensed)
- If pypdf is not installed, returns `{ pdf_type: "Unknown", error: "pypdf not installed..." }` gracefully

### `supported_formats()`
Returns a list of supported file formats.

## Security

See the "Security Model" section in `CLAUDE.md` for details.

## Related Tools

- [pii-mask-yoshi](https://github.com/aliksir/pii-mask-yoshi) -- PII auto-masking MCP server. Calls `python -m markitdown` directly when reading binary files via `safe_read` (operates independently from markitdown-yoshi)
- [neko-not-yoshi](https://github.com/aliksir/neko-not-yoshi) -- Blocked word and custom pattern definitions

## License
MIT
