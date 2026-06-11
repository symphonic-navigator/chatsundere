// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MessageRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { MINDSPACE_FALLBACK } from '../../../src/components/chat/ChatStream.js';
import { MessageBlock } from '../../../src/components/chat/MessageBlock.js';

function persona(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return {
    id: 'p1',
    name: 'Fable',
    tagline: '',
    colour: '#8d6dff',
    font: 'serif',
    instructions: '',
    canonicalId: null,
    providerId: 'x',
    modelId: 'y',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.7,
    adultPersona: false,
    chatsundereTonality: false,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'third',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: 'v1',
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function personaMessage(text: string): MessageRow {
  return {
    id: 'm1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
  };
}

/** Message with two text blocks separated by a pill (blockIndex 0 = first text, 2 = second text). */
function multiBlockMessage(text0: string, pillId: string, text2: string): MessageRow {
  return {
    id: 'm2',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [
      { type: 'text', text: text0 },
      { type: 'pill', pillId },
      { type: 'text', text: text2 },
    ],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
  };
}

function renderBlock(
  message: MessageRow,
  currentSegmentId: string | null,
  voiceMode: 'paragraph' | 'sentence',
) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MessageBlock
        message={message}
        pills={new Map()}
        persona={persona()}
        mindspace={MINDSPACE_FALLBACK}
        displayName="Me"
        expanded={false}
        onToggleExpand={() => {}}
        onCopy={() => {}}
        onBookmark={() => {}}
        currentSegmentId={currentSegmentId}
        voiceMode={voiceMode}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('MessageBlock voice glow', () => {
  it('toggles voice-glow-active on the sentence span and does NOT re-parse on advance', async () => {
    const raw =
      'This is the first reasonably long sentence here, standing alone. ' +
      'This is the second reasonably long sentence here, also alone.';
    // A STABLE message reference (the production case — same MessageRow flows
    // through until TanStack invalidates) so the no-reparse invariant is real.
    const message = personaMessage(raw);
    const qc = new QueryClient();
    const node = (currentSegmentId: string | null): JSX.Element => (
      <QueryClientProvider client={qc}>
        <MessageBlock
          message={message}
          pills={new Map()}
          persona={persona()}
          mindspace={MINDSPACE_FALLBACK}
          displayName="Me"
          expanded={false}
          onToggleExpand={() => {}}
          onCopy={() => {}}
          onBookmark={() => {}}
          currentSegmentId={currentSegmentId}
          voiceMode="sentence"
        />
      </QueryClientProvider>
    );
    const { container, rerender } = render(node('0:0'));

    await waitFor(() => {
      expect(container.querySelector('[data-voice-seg="0:0"]')).not.toBeNull();
    });
    const seg0Before = container.querySelector('[data-voice-seg="0:0"]');
    expect(seg0Before?.classList.contains('voice-glow-active')).toBe(true);
    expect(
      container.querySelector('[data-voice-seg="0:1"]')?.classList.contains('voice-glow-active'),
    ).toBe(false);

    // Advance to the second segment with the SAME message reference.
    rerender(node('0:1'));
    await waitFor(() => {
      expect(
        container.querySelector('[data-voice-seg="0:1"]')?.classList.contains('voice-glow-active'),
      ).toBe(true);
    });
    const seg0After = container.querySelector('[data-voice-seg="0:0"]');
    expect(seg0After?.classList.contains('voice-glow-active')).toBe(false);
    // Same DOM node survived the advance → the markdown was not re-parsed.
    expect(seg0After).toBe(seg0Before);
  });

  it('glows the right paragraph element in paragraph mode (seg id on the <p>)', async () => {
    const raw = 'First paragraph long enough here.\n\nSecond paragraph also long enough here.';
    const { container } = renderBlock(personaMessage(raw), '0:1', 'paragraph');
    await waitFor(() => {
      // After the fix: data-voice-para is block-qualified "0:1", not bare "1".
      expect(container.querySelector('[data-voice-para="0:1"]')).not.toBeNull();
    });
    // In paragraph mode the second paragraph's <p> carries data-voice-seg 0:1
    // directly, so the seg query matches and that element glows.
    const second = container.querySelector('[data-voice-seg="0:1"]');
    expect(second?.classList.contains('voice-glow-active')).toBe(true);
    const first = container.querySelector('[data-voice-seg="0:0"]');
    expect(first?.classList.contains('voice-glow-active')).toBe(false);
  });

  it('falls back to the paragraph element when the active id has no matching span', async () => {
    // Roleplay narration paragraph mode wraps a single asterisk-cut span per
    // voice. We feed a segment id whose paragraph exists but whose span was not
    // emitted on the glow side for paragraph 1, exercising the data-voice-para
    // fallback. Two paragraphs, paragraph mode: paragraph 1 maps to id 0:1.
    const raw = 'Alpha paragraph long enough here now.\n\nBeta paragraph also long enough now.';
    // Sentence mode so paragraph-mode element-level tagging is OFF, yet the only
    // emitted segment per paragraph still wraps in a span; we then ask for a
    // paragraph-mode-style id mapping by parsing paragraphIndex from segments.
    const { container } = renderBlock(personaMessage(raw), '0:1', 'sentence');
    await waitFor(() => {
      // After the fix: data-voice-para is block-qualified "0:1", not bare "1".
      expect(container.querySelector('[data-voice-para="0:1"]')).not.toBeNull();
    });
    // Whichever element carries the glow, it must be within paragraph 1, never
    // paragraph 0 — the fallback must not mis-highlight a different paragraph.
    const active = container.querySelector('.voice-glow-active');
    expect(active).not.toBeNull();
    const para1 = container.querySelector('[data-voice-para="0:1"]');
    expect(para1?.contains(active) || para1 === active).toBe(true);
    const para0 = container.querySelector('[data-voice-para="0:0"]');
    expect(para0?.contains(active)).toBe(false);
  });

  it('anchors the plain paragraph to raw index 1 even when paragraph 0 splits on multiline math (I1)', async () => {
    // Raw paragraph 0 carries multiline display math, which preprocessMath
    // rewrites into THREE processed paragraphs. The plain paragraph 1 must still
    // anchor to raw index "0:1" and glow when its segment is active — not drift
    // to "0:2"/"0:3" as the bare processed-index pairing produced.
    const raw =
      'Here is \\[\nx = 1\\\\\ny = 2\n\\] inline end.\n\n' +
      'A plain sentence stands here on its own line afterwards too.';
    const { container } = renderBlock(personaMessage(raw), '0:1', 'sentence');
    await waitFor(() => {
      expect(container.querySelector('[data-voice-para="0:1"]')).not.toBeNull();
    });
    // The drift indices must never appear.
    expect(container.querySelector('[data-voice-para="0:2"]')).toBeNull();
    expect(container.querySelector('[data-voice-para="0:3"]')).toBeNull();
    // The active segment 0:1 glows, inside the raw-index-1 paragraph.
    const active = container.querySelector('.voice-glow-active');
    expect(active).not.toBeNull();
    const para1 = container.querySelector('[data-voice-para="0:1"]');
    expect(para1?.contains(active) || para1 === active).toBe(true);
  });

  it('does NOT glow block 0 paragraph when the active segment belongs to block 2 paragraph 0 (never-mis-highlight contract)', async () => {
    // Regression: before the fix, both block 0 and block 2 had data-voice-para="0"
    // (bare paragraph index). The fallback query `[data-voice-para="0"]` would
    // match block 0's paragraph even when the active segment was in block 2.
    // After the fix, data-voice-para is "2:0" for block 2 paragraph 0, so the
    // query is block-qualified and can never mis-highlight across blocks.
    const text0 = 'Block zero paragraph here, long enough to be spoken.';
    const text2 = 'Block two paragraph here, also long enough to be spoken.';
    // Segment ids: block 0 → "0:0"; block 2 → "2:0".
    // Active segment "2:0" belongs to block 2; block 0's "0:0" must NOT glow.
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MessageBlock
          message={multiBlockMessage(text0, 'pill-a', text2)}
          pills={
            new Map([['pill-a', { id: 'pill-a', chatId: 'c1', kind: 'expert', meta: {} } as never]])
          }
          persona={persona()}
          mindspace={MINDSPACE_FALLBACK}
          displayName="Me"
          expanded={false}
          onToggleExpand={() => {}}
          onCopy={() => {}}
          onBookmark={() => {}}
          currentSegmentId="2:0"
          voiceMode="paragraph"
        />
      </QueryClientProvider>,
    );
    // Wait for the block 2 paragraph to be stamped with its block-qualified anchor.
    await waitFor(() => {
      expect(container.querySelector('[data-voice-para="2:0"]')).not.toBeNull();
    });
    // The glow must land inside the block 2 paragraph, not block 0's paragraph.
    const glowing = container.querySelector('.voice-glow-active');
    expect(glowing).not.toBeNull();
    const para2 = container.querySelector('[data-voice-para="2:0"]');
    const para0 = container.querySelector('[data-voice-para="0:0"]');
    // para0 must exist (block 0 is also rendered) to confirm we're not trivially passing.
    expect(para0).not.toBeNull();
    expect(para2?.contains(glowing) || para2 === glowing).toBe(true);
    expect(para0?.contains(glowing)).toBe(false);
  });
});
