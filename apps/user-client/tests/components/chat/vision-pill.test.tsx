// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../../src/boot/client-data-db.js';
import { VisionPill } from '../../../src/components/chat/VisionPill.js';

const row = (status: PillRow['status'], payload: Record<string, unknown>): PillRow => ({
  id: 'p1',
  messageId: 'm1',
  kind: 'tool-call',
  positionHint: 'above-text',
  status,
  payload: { name: 'describe_image', ...payload },
  createdAt: 1,
});

describe('VisionPill', () => {
  it('shows reading + filename while pending', () => {
    render(<VisionPill row={row('pending', { model: 'gemini', fileName: 'cat.jpg' })} />);
    expect(screen.getByText(/reading image/i)).toBeTruthy();
    expect(screen.getByText(/cat\.jpg/)).toBeTruthy();
  });

  it('expands to the description and model when completed', () => {
    render(
      <VisionPill
        row={row('completed', { model: 'gemini', fileName: 'cat.jpg', result: 'A black cat.' })}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/A black cat\./)).toBeTruthy();
    expect(screen.getByText(/via gemini/i)).toBeTruthy();
  });

  it('shows a failure label when failed', () => {
    render(
      <VisionPill
        row={row('failed', { model: 'gemini', fileName: 'cat.jpg', error: 'timeout' })}
      />,
    );
    expect(screen.getByText(/couldn't read image/i)).toBeTruthy();
  });
});
