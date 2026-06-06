// markitdown-yoshi MCP server
// Microsoft markitdown CLIをラップした自作MCPサーバー

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { convert, supportedFormats } from './converter.js';
import { classifyPdf } from './classifier.js';
import { validatePath } from './converter.js';
import { CONFIG, SUPPORTED_FORMATS } from './config.js';

// smoke.test.js から参照できるよう TOOLS を export
export const TOOLS = [
  {
    name: 'convert',
    description: [
      '目的: ファイルをMarkdownに変換する。Microsoft markitdown CLIを内部で呼び出す。',
      `引数: file_path (string, 必須) — 変換対象の絶対パス。許可ディレクトリ配下（${CONFIG.ALLOWED_ROOTS.join(', ')}）のみ。max_chars (number, 省略可) — Markdown出力文字数上限（デフォルト${CONFIG.MAX_OUTPUT_CHARS}、最大同値）。`,
      '戻り値: { markdown: string, truncated: boolean, cached: boolean, pdf_classification?: object | null }。PDFのみ pdf_classification を自動付与（キャッシュヒット時は省略、classifier失敗時は null）。',
      `副作用: 変換結果をLRUキャッシュ（${CONFIG.CACHE_MAX_ENTRIES}件、${CONFIG.CACHE_TTL_MS / 60000}分TTL）に保存。`,
      `前提条件: python -m markitdown が実行可能であること（Python側でmarkitdownがインストール済み）。`,
      `例外: 許可外パス、ファイル未存在、ディレクトリ指定、${CONFIG.MAX_FILE_SIZE}バイト超過、${CONFIG.TIMEOUT_MS}msタイムアウト、markitdown変換失敗でエラー。`
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '変換対象ファイルの絶対パス（許可ディレクトリ配下のみ）'
        },
        max_chars: {
          type: 'number',
          description: `Markdown出力文字数上限（デフォルト${CONFIG.MAX_OUTPUT_CHARS}、最大同値）`,
          minimum: 1
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'classify_pdf',
    description: [
      '目的: PDFがテキストベースかスキャン画像か分類する。OCRが必要なページを0-indexedで特定する。pdf-inspector (firecrawl) のL1判定相当をpypdfで内製。',
      `引数: file_path (string, 必須) — PDFファイルの絶対パス。許可ディレクトリ配下（${CONFIG.ALLOWED_ROOTS.join(', ')}）のみ。`,
      '戻り値: { pdf_type: "TextBased"|"Scanned"|"Mixed"|"Unknown", page_count: number, pages_needing_ocr: number[], confidence: number (0.0-1.0), text_pages: number, empty_pages: number, cached: boolean, error?: string }。pypdf未インストール時は { error: "pypdf not installed..." } を含むUnknown返却、またはnull。L1判定のためImageBasedは返さない（Do operator検出はL2スコープ外）。',
      '副作用: 分類結果をLRUキャッシュ（50件、1時間TTL、converter.jsとは別インスタンス）に保存。',
      '前提条件: python + pypdf インストール済み。pypdf未導入時は pdf_type="Unknown" でgraceful return。',
      '例外: 許可外パス、ファイル未存在、ディレクトリ指定、サイズ超過でエラー。暗号化/破損PDFは pdf_type="Unknown" で正常return。'
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'PDFファイルの絶対パス（許可ディレクトリ配下のみ）'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'supported_formats',
    description: [
      '目的: markitdownが対応するファイルフォーマット一覧を返す。',
      '引数: なし。',
      '戻り値: { formats: string[] } — 拡張子の配列。',
      '副作用: なし（読み取り専用）。',
      '前提条件: なし（静的リスト）。',
      '例外: なし。'
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

export function createServer() {
  const server = new Server(
    { name: 'markitdown-yoshi', version: '0.2.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    if (name === 'convert') {
      try {
        const result = await convert(args.file_path, args.max_chars);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err.message}`
            }
          ],
          isError: true
        };
      }
    }

    if (name === 'classify_pdf') {
      try {
        const resolved = validatePath(args.file_path);
        const result = await classifyPdf(resolved);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err.message}`
            }
          ],
          isError: true
        };
      }
    }

    if (name === 'supported_formats') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ formats: supportedFormats() }, null, 2)
          }
        ]
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true
    };
  });

  return server;
}

export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdoutはMCPプロトコル専用。ログはstderrへ。
  process.stderr.write('[markitdown-yoshi] MCP server started — ちゃんと変換してヨシッ！\n');
}
