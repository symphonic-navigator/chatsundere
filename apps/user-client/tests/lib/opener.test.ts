// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildOpenerInstruction } from '../../src/lib/opener.js';

describe('buildOpenerInstruction', () => {
  it('embeds the trimmed user rules between the curated frame', () => {
    const out = buildOpenerInstruction('  Greet the user as if on OkCupid.  ');
    expect(out).toContain('Compose your opening message');
    expect(out).toContain('Greet the user as if on OkCupid.');
    expect(out).not.toContain('  Greet');
    expect(out).toContain('Reply with the opening message only.');
  });
});
