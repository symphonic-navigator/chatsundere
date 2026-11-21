// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { mediaCopy } from '../../../src/components/chat/media/media-copy.js';

const MB = 1_048_576;

describe('mediaCopy.saving', () => {
  it('shows one decimal place below 10 MB', () => {
    expect(mediaCopy.saving('audio', { done: 0.4 * MB, total: 1.2 * MB })).toBe(
      'Saving audio · 0.4 of 1.2 MB',
    );
  });

  it('shows whole numbers from 10 MB', () => {
    expect(mediaCopy.saving('video', { done: 12.4 * MB, total: 48.6 * MB })).toBe(
      'Saving video · 12 of 49 MB',
    );
    expect(mediaCopy.saving('video', { done: 3.25 * MB, total: 48.6 * MB })).toBe(
      'Saving video · 3.3 of 49 MB',
    );
  });

  it('falls back to the plain line without a known total', () => {
    expect(mediaCopy.saving('audio', { done: MB, total: null })).toBe('Saving audio…');
    expect(mediaCopy.saving('audio')).toBe('Saving audio…');
  });
});
