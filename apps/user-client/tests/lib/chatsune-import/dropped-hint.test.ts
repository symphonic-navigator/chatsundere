// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildDroppedHint, countDropped } from '../../../src/lib/chatsune-import/dropped-hint.js';

describe('countDropped', () => {
  it('counts the rich arrays on a message', () => {
    const counts = countDropped({
      role: 'assistant',
      content: 'hi',
      image_refs: [{}, {}],
      tool_calls: [{}],
      attachments: null,
      artefact_refs: undefined as never,
      knowledge_context: [{}],
    });
    expect(counts).toEqual({
      images: 2,
      toolCalls: 1,
      attachments: 0,
      artefacts: 0,
      knowledgeLookups: 1,
    });
  });
});

describe('buildDroppedHint', () => {
  it('returns null when nothing was dropped', () => {
    expect(
      buildDroppedHint({
        images: 0,
        toolCalls: 0,
        attachments: 0,
        artefacts: 0,
        knowledgeLookups: 0,
      }),
    ).toBeNull();
  });

  it('summarises a single category in the singular', () => {
    expect(
      buildDroppedHint({
        images: 0,
        toolCalls: 1,
        attachments: 0,
        artefacts: 0,
        knowledgeLookups: 0,
      }),
    ).toBe('[1 tool call from the original message was not imported.]');
  });

  it('joins multiple categories with commas and "and", and pluralises', () => {
    expect(
      buildDroppedHint({
        images: 2,
        toolCalls: 1,
        attachments: 0,
        artefacts: 0,
        knowledgeLookups: 0,
      }),
    ).toBe('[2 images and 1 tool call from the original message were not imported.]');
  });
});
