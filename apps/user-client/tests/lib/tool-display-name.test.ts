// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { toolDisplayName } from '../../src/lib/tool-display-name.js';

describe('toolDisplayName', () => {
  it('maps a tool with a display name to it', () => {
    expect(toolDisplayName('write_memory_entry')).toBe('Remembered');
  });

  it('falls back to the raw name', () => {
    expect(toolDisplayName('web_search')).toBe('web_search');
  });

  it('does not treat inherited object keys as display names', () => {
    expect(toolDisplayName('constructor')).toBe('constructor');
  });
});
