// SPDX-License-Identifier: AGPL-3.0-only

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  UnrecognisedExportError,
  parseExportBytes,
} from '../../src/lib/third-party-import/parse-export.js';

const CHATGPT_JSON = JSON.stringify([
  {
    conversation_id: 'c1',
    title: 'Zip test',
    create_time: 1721300000,
    update_time: 1721300100,
    current_node: 'a1',
    mapping: {
      root: { id: 'root', parent: null, message: null },
      u1: {
        id: 'u1',
        parent: 'root',
        message: {
          author: { role: 'user' },
          status: 'finished_successfully',
          create_time: 1721300000,
          content: { content_type: 'text', parts: ['hi'] },
        },
      },
      a1: {
        id: 'a1',
        parent: 'u1',
        message: {
          author: { role: 'assistant' },
          status: 'finished_successfully',
          create_time: 1721300050,
          content: { content_type: 'text', parts: ['hello'] },
        },
      },
    },
  },
]);

const GROK_JSON = JSON.stringify({
  conversations: [
    {
      conversation: {
        id: 'g1',
        title: 'Grok',
        create_time: 1721300000000,
        modify_time: 1721300100000,
      },
      responses: [
        {
          response: {
            _id: 'u1',
            parent_response_id: null,
            sender: 'human',
            message: 'hi',
            create_time: 1721300000000,
          },
        },
      ],
    },
  ],
});

describe('parseExportBytes', () => {
  it('detects a ChatGPT zip and parses conversations.json inside it', () => {
    const zipped = zipSync({
      'conversations.json': strToU8(CHATGPT_JSON),
      'user.json': strToU8('{}'),
    });
    const r = parseExportBytes(zipped);
    expect(r.source).toBe('chatgpt');
    expect(r.conversations[0]?.sourceId).toBe('chatgpt/c1');
  });

  it('finds conversations.json in a subdirectory of the zip', () => {
    const zipped = zipSync({ 'export/conversations.json': strToU8(CHATGPT_JSON) });
    expect(parseExportBytes(zipped).conversations).toHaveLength(1);
  });

  it('rejects a zip without conversations.json', () => {
    const zipped = zipSync({ 'other.json': strToU8('{}') });
    expect(() => parseExportBytes(zipped)).toThrow(UnrecognisedExportError);
  });

  it('rejects a zip with non-array conversations.json', () => {
    const zipped = zipSync({ 'conversations.json': strToU8('{}') });
    expect(() => parseExportBytes(zipped)).toThrow(UnrecognisedExportError);
  });

  it('detects raw ChatGPT conversations.json', () => {
    expect(parseExportBytes(strToU8(CHATGPT_JSON)).source).toBe('chatgpt');
  });

  it('accepts an empty ChatGPT export (zero conversations)', () => {
    const r = parseExportBytes(strToU8('[]'));
    expect(r.source).toBe('chatgpt');
    expect(r.conversations).toEqual([]);
  });

  it('detects a Grok export', () => {
    const r = parseExportBytes(strToU8(GROK_JSON));
    expect(r.source).toBe('grok');
    expect(r.conversations[0]?.sourceId).toBe('grok/g1');
  });

  it('rejects junk with UnrecognisedExportError', () => {
    expect(() => parseExportBytes(strToU8('not json at all'))).toThrow(UnrecognisedExportError);
    expect(() => parseExportBytes(strToU8('{"foo": 1}'))).toThrow(UnrecognisedExportError);
  });
});
