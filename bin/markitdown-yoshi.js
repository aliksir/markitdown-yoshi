#!/usr/bin/env node
// CLI entry point for markitdown-yoshi MCP server
import { main } from '../src/index.js';

main().catch((err) => {
  process.stderr.write(`[markitdown-yoshi] Fatal: ${err.message}\n`);
  process.exit(1);
});
