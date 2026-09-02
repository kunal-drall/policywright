/**
 * emit-mcp-schemas.ts — write the MCP tools' JSON Schemas (draft 2020-12) to
 * schemas/mcp/ from the Zod definitions in src/mcp/schemas.ts, so reviewers
 * can read the contracts without running the server. The server advertises
 * the same conversion in `tools/list` (test/mcp.test.ts asserts equality).
 *
 * Usage:
 *   npm run mcp:schemas            # (re)write schemas/mcp/*.json
 *   npm run mcp:schemas -- --check # exit 1 if any committed file differs (CI)
 *
 * Files are formatted with the repository's Prettier config so `npm run
 * format:check` and this script agree byte-for-byte.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { z } from 'zod';
import { ErrorEnvelopeSchema, TOOL_NAMES, TOOL_SCHEMAS } from '../src/mcp/schemas.js';

const OUT_DIR = fileURLToPath(new URL('../schemas/mcp/', import.meta.url));
const TARGET = 'draft-2020-12';

async function render(schema: z.ZodType, io: 'input' | 'output'): Promise<string> {
  const json = z.toJSONSchema(schema, { target: TARGET, io });
  const options = (await prettier.resolveConfig(OUT_DIR)) ?? {};
  return prettier.format(JSON.stringify(json, null, 2), { ...options, parser: 'json' });
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const files: { name: string; content: string }[] = [];
  for (const tool of TOOL_NAMES) {
    files.push({
      name: `${tool}.input.json`,
      content: await render(TOOL_SCHEMAS[tool].input, 'input'),
    });
    files.push({
      name: `${tool}.output.json`,
      content: await render(TOOL_SCHEMAS[tool].output, 'output'),
    });
  }
  files.push({ name: 'error.json', content: await render(ErrorEnvelopeSchema, 'output') });

  mkdirSync(OUT_DIR, { recursive: true });
  let drifted = 0;
  for (const file of files) {
    const path = join(OUT_DIR, file.name);
    if (check) {
      let existing: string | null = null;
      try {
        existing = readFileSync(path, 'utf8');
      } catch {
        existing = null;
      }
      if (existing !== file.content) {
        drifted += 1;
        process.stderr.write(
          `schemas/mcp/${file.name}: ${existing === null ? 'missing' : 'differs from src/mcp/schemas.ts'}\n`,
        );
      }
    } else {
      writeFileSync(path, file.content);
      process.stdout.write(`wrote schemas/mcp/${file.name}\n`);
    }
  }
  if (check) {
    if (drifted > 0) {
      process.stderr.write(`${drifted} schema file(s) out of date — run: npm run mcp:schemas\n`);
      process.exit(1);
    }
    process.stdout.write(`schemas/mcp/ matches src/mcp/schemas.ts (${files.length} files)\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
