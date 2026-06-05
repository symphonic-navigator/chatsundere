// SPDX-License-Identifier: AGPL-3.0-only
import type { WireContentPart } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import { buildEngineWireMessages } from '../../src/lib/stream-engine.js';

describe('buildEngineWireMessages multimodal', () => {
  it('accepts a WireContentPart[] as the user content (current turn)', () => {
    const content: WireContentPart[] = [
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xxx' } },
    ];
    const msgs = buildEngineWireMessages('SYS', [], content, []);
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content });
  });

  it('still accepts a plain string (no attachments)', () => {
    const msgs = buildEngineWireMessages('SYS', [], 'hello', []);
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'hello' });
  });
});
