// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildDroppedHint, countDropped } from '../../../src/lib/chatsune-import/dropped-hint.js';

describe('countDropped', () => {
  it('counts the legacy top-level arrays on a message', () => {
    const counts = countDropped({
      role: 'assistant',
      content: 'hi',
      image_refs: [{ id: 'i1' }, { id: 'i2' }],
      tool_calls: [{ tool_call_id: 't1' }],
      attachments: null,
      artefact_refs: undefined as never,
      knowledge_context: [{ documentId: 'd1' }],
    });
    expect(counts).toEqual({
      images: 2,
      toolCalls: 1,
      attachments: 0,
      artefacts: 0,
      knowledgeLookups: 1,
    });
  });

  it('counts images that live only in the new events timeline', () => {
    const counts = countDropped({
      role: 'assistant',
      content: 'see',
      events: [{ kind: 'image', refs: [{ id: 'x' }, { id: 'y' }] }],
    });
    expect(counts.images).toBe(2);
  });

  it('deduplicates an item present in both the legacy field and events (by id)', () => {
    const counts = countDropped({
      role: 'assistant',
      content: 'see',
      image_refs: [{ id: 'x' }],
      tool_calls: [{ tool_call_id: 't' }],
      events: [
        { kind: 'image', refs: [{ id: 'x' }] },
        { kind: 'tool_call', tool_call_id: 't' },
      ],
    });
    expect(counts.images).toBe(1);
    expect(counts.toolCalls).toBe(1);
  });

  it('counts a tool call that lives only in events', () => {
    const counts = countDropped({
      role: 'assistant',
      content: '',
      events: [{ kind: 'tool_call', tool_call_id: 't' }],
    });
    expect(counts.toolCalls).toBe(1);
  });

  it('counts an artefact carried as an events ref', () => {
    const counts = countDropped({
      role: 'assistant',
      content: '',
      events: [{ kind: 'artefact', ref: { artefact_id: 'a1' } }],
    });
    expect(counts.artefacts).toBe(1);
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
