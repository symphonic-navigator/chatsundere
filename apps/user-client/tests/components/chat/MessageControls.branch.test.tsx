// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow } from '../../../src/boot/client-data-db.js';
import { MessageControls } from '../../../src/components/chat/MessageControls.js';

const msg: MessageRow = {
  id: 'm1',
  chatId: 'c1',
  role: 'persona',
  contentBlocks: [{ type: 'text', text: 'hi' }],
  createdAt: 1,
  bookmarked: false,
  streamingState: 'complete',
};

describe('MessageControls branch button', () => {
  it('calls onBranch when enabled', () => {
    const onBranch = vi.fn();
    render(
      <MessageControls message={msg} onCopy={() => {}} onBookmark={() => {}} onBranch={onBranch} />,
    );
    const btn = screen.getByRole('button', { name: /Branch/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onBranch).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a stream is live', () => {
    const onBranch = vi.fn();
    render(
      <MessageControls
        message={msg}
        onCopy={() => {}}
        onBookmark={() => {}}
        onBranch={onBranch}
        branchDisabled
      />,
    );
    const btn = screen.getByRole('button', { name: /Branch/ });
    expect(btn).toBeDisabled();
  });
});

describe('MessageControls read-aloud button', () => {
  it('calls onReadAloud when enabled (no disabled reason)', () => {
    const onReadAloud = vi.fn();
    render(
      <MessageControls
        message={msg}
        onCopy={() => {}}
        onBookmark={() => {}}
        onReadAloud={onReadAloud}
        readDisabledReason={null}
      />,
    );
    const btn = screen.getByRole('button', { name: /Read/ });
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute('title', 'Read this message aloud');
    fireEvent.click(btn);
    expect(onReadAloud).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no-provider', 'Set up a TTS provider in My Settings'],
    ['no-voice', 'Give this persona a voice in its editor'],
    ['nothing', 'Nothing to read aloud in this message'],
  ] as const)('disables with the %s tone tooltip', (reason, tooltip) => {
    render(
      <MessageControls
        message={msg}
        onCopy={() => {}}
        onBookmark={() => {}}
        onReadAloud={() => {}}
        readDisabledReason={reason}
      />,
    );
    const btn = screen.getByRole('button', { name: /Read/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', tooltip);
  });

  it('omits the Read button on user messages', () => {
    render(
      <MessageControls
        message={{ ...msg, role: 'user' }}
        onCopy={() => {}}
        onBookmark={() => {}}
        onReadAloud={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Read/ })).toBeNull();
  });
});

describe('MessageControls regenerate tooltip', () => {
  it('titles the regenerate button "Regenerate this reply" for a normal reply', () => {
    render(
      <MessageControls
        message={msg}
        onCopy={() => {}}
        onBookmark={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Regenerate/ })).toHaveAttribute(
      'title',
      'Regenerate this reply',
    );
  });

  it('titles the regenerate button "Re-roll the greeting" for an opener message', () => {
    render(
      <MessageControls
        message={{ ...msg, kind: 'opener' }}
        onCopy={() => {}}
        onBookmark={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Regenerate/ })).toHaveAttribute(
      'title',
      'Re-roll the greeting',
    );
  });
});
