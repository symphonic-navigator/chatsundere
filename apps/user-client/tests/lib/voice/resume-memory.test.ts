// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetResumeMemoryForTests,
  clearPosition,
  peekPosition,
  rememberPosition,
} from '../../../src/lib/voice/resume-memory.js';

afterEach(() => _resetResumeMemoryForTests());

describe('resume-memory', () => {
  it('remembers and peeks a position', () => {
    rememberPosition('chat-a', { messageId: 'm1', segmentIndex: 3, paragraphIndex: 1 });
    expect(peekPosition('chat-a')).toEqual({ messageId: 'm1', segmentIndex: 3, paragraphIndex: 1 });
  });

  it('returns null for a chat with no remembered position', () => {
    expect(peekPosition('chat-unknown')).toBeNull();
  });

  it('peek is non-destructive — re-reading still returns the position', () => {
    rememberPosition('chat-a', { messageId: 'm1', segmentIndex: 2, paragraphIndex: 0 });
    expect(peekPosition('chat-a')).toEqual({ messageId: 'm1', segmentIndex: 2, paragraphIndex: 0 });
    expect(peekPosition('chat-a')).toEqual({ messageId: 'm1', segmentIndex: 2, paragraphIndex: 0 });
  });

  it('clear forgets the position', () => {
    rememberPosition('chat-a', { messageId: 'm1', segmentIndex: 1, paragraphIndex: 0 });
    clearPosition('chat-a');
    expect(peekPosition('chat-a')).toBeNull();
  });

  it('overwrites a prior position for the same chat', () => {
    rememberPosition('chat-a', { messageId: 'm1', segmentIndex: 1, paragraphIndex: 0 });
    rememberPosition('chat-a', { messageId: 'm2', segmentIndex: 5, paragraphIndex: 2 });
    expect(peekPosition('chat-a')).toEqual({ messageId: 'm2', segmentIndex: 5, paragraphIndex: 2 });
  });

  it('isolates positions per chat', () => {
    rememberPosition('chat-a', { messageId: 'm1', segmentIndex: 1, paragraphIndex: 0 });
    rememberPosition('chat-b', { messageId: 'm9', segmentIndex: 7, paragraphIndex: 3 });
    expect(peekPosition('chat-a')).toEqual({ messageId: 'm1', segmentIndex: 1, paragraphIndex: 0 });
    expect(peekPosition('chat-b')).toEqual({ messageId: 'm9', segmentIndex: 7, paragraphIndex: 3 });
    clearPosition('chat-a');
    expect(peekPosition('chat-a')).toBeNull();
    expect(peekPosition('chat-b')).toEqual({ messageId: 'm9', segmentIndex: 7, paragraphIndex: 3 });
  });
});
