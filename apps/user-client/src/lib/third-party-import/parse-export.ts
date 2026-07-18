// SPDX-License-Identifier: AGPL-3.0-only

import { strFromU8, unzipSync } from 'fflate';
import { parseChatGptExport } from './chatgpt.js';
import { parseGrokExport } from './grok.js';
import { type ParseResult, isRecord } from './types.js';

/** The picked file is not a ChatGPT or Grok export (spec §9 copy lives in the UI). */
export class UnrecognisedExportError extends Error {}

/**
 * Content-based format detection + dispatch (spec §4): zip magic → ChatGPT zip;
 * top-level JSON array → ChatGPT conversations.json; object with a
 * conversations array → Grok. Pure and synchronous — runs inside the worker.
 */
export function parseExportBytes(bytes: Uint8Array): ParseResult {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = unzipSync(bytes, {
      filter: (f) => f.name === 'conversations.json' || f.name.endsWith('/conversations.json'),
    });
    const name = Object.keys(entries)[0];
    const inner = name === undefined ? undefined : entries[name];
    if (inner === undefined)
      throw new UnrecognisedExportError('zip contains no conversations.json');
    const parsed = parseJson(strFromU8(inner));
    if (Array.isArray(parsed)) return parseChatGptExport(parsed);
    throw new UnrecognisedExportError('zip conversations.json is not a ChatGPT export');
  }

  const parsed = parseJson(strFromU8(bytes));
  if (Array.isArray(parsed)) return parseChatGptExport(parsed);
  if (isRecord(parsed) && Array.isArray(parsed.conversations)) return parseGrokExport(parsed);
  throw new UnrecognisedExportError('neither a ChatGPT nor a Grok export');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new UnrecognisedExportError('file is not valid JSON');
  }
}
