// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DualActionBtn } from '../../../src/components/chat/DualActionBtn.js';
import type { Dictation } from '../../../src/lib/voice/dictation/use-dictation.js';
import { idleDictationStub } from '../../helpers/dictation-stub.js';

function makeDictation(overrides: Partial<Dictation> = {}): Dictation {
  return { ...idleDictationStub, ...overrides };
}

describe('DualActionBtn', () => {
  // ── 1. stream-stop priority ─────────────────────────────────────────────────
  it('isStreamLive → stop button (data-dual="stop"), click calls onStop', () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    const { container } = render(
      <DualActionBtn
        hasText={true}
        isStreamLive={true}
        personaName="Fable"
        onSend={onSend}
        onStop={onStop}
        dictation={idleDictationStub}
      />,
    );
    const btn = container.querySelector('[data-dual="stop"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  // ── 2. send arrow ───────────────────────────────────────────────────────────
  it('hasText + dictation idle → send arrow (data-dual="action"), click calls onSend', () => {
    const onSend = vi.fn();
    const { container } = render(
      <DualActionBtn
        hasText={true}
        isStreamLive={false}
        personaName="Fable"
        onSend={onSend}
        onStop={vi.fn()}
        dictation={idleDictationStub}
      />,
    );
    const btn = container.querySelector('[data-dual="action"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  // ── 3. mic available — pointer handlers wired ───────────────────────────────
  it('no text, dictation.available true, idle → mic (data-dual="mic"); pointerDown calls pressStart, pointerUp calls pressEnd', () => {
    const pressStart = vi.fn();
    const pressEnd = vi.fn();
    const { container } = render(
      <DualActionBtn
        hasText={false}
        isStreamLive={false}
        personaName="Fable"
        onSend={vi.fn()}
        onStop={vi.fn()}
        dictation={makeDictation({ available: true, pressStart, pressEnd })}
      />,
    );
    const btn = container.querySelector('[data-dual="mic"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    fireEvent.pointerDown(btn);
    expect(pressStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    expect(pressEnd).toHaveBeenCalledTimes(1);
  });

  // ── 4. mic unavailable ──────────────────────────────────────────────────────
  it('no text, available false → mic disabled with tooltip', () => {
    const { container } = render(
      <DualActionBtn
        hasText={false}
        isStreamLive={false}
        personaName="Fable"
        onSend={vi.fn()}
        onStop={vi.fn()}
        dictation={makeDictation({ available: false })}
      />,
    );
    const btn = container.querySelector('[data-dual="mic"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Add a Mistral provider in My Settings to dictate');
  });

  // ── 5. capturing — inline style carries --mic-level, click calls tap ────────
  it('uiState === "capturing" → data-dual="capture", style has --mic-level from level; click calls tap', () => {
    const tap = vi.fn();
    const { container } = render(
      <DualActionBtn
        hasText={false}
        isStreamLive={false}
        personaName="Fable"
        onSend={vi.fn()}
        onStop={vi.fn()}
        dictation={makeDictation({ uiState: 'capturing', level: 0.75, tap })}
      />,
    );
    const btn = container.querySelector('[data-dual="capture"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.style.getPropertyValue('--mic-level')).toBe('0.75');
    fireEvent.click(btn);
    expect(tap).toHaveBeenCalledTimes(1);
  });

  // ── 6. capture priority over send ───────────────────────────────────────────
  it('uiState === "capturing" WITH hasText true → still capture control, not send', () => {
    const { container } = render(
      <DualActionBtn
        hasText={true}
        isStreamLive={false}
        personaName="Fable"
        onSend={vi.fn()}
        onStop={vi.fn()}
        dictation={makeDictation({ uiState: 'capturing', level: 0.5, tap: vi.fn() })}
      />,
    );
    expect(container.querySelector('[data-dual="capture"]')).not.toBeNull();
    expect(container.querySelector('[data-dual="action"]')).toBeNull();
  });

  // ── 7. transcribing — click calls cancel ───────────────────────────────────
  it('uiState === "transcribing" → data-dual="cancel-transcribe", click calls cancel', () => {
    const cancel = vi.fn();
    const { container } = render(
      <DualActionBtn
        hasText={false}
        isStreamLive={false}
        personaName="Fable"
        onSend={vi.fn()}
        onStop={vi.fn()}
        dictation={makeDictation({ uiState: 'transcribing', cancel })}
      />,
    );
    const btn = container.querySelector('[data-dual="cancel-transcribe"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  // ── 8. pointerLeave during press calls pressCancel ─────────────────────────
  it('pointerLeave during a press (mic state) calls pressCancel', () => {
    const pressCancel = vi.fn();
    const { container } = render(
      <DualActionBtn
        hasText={false}
        isStreamLive={false}
        personaName="Fable"
        onSend={vi.fn()}
        onStop={vi.fn()}
        dictation={makeDictation({ available: true, pressCancel })}
      />,
    );
    const btn = container.querySelector('[data-dual="mic"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    fireEvent.pointerLeave(btn);
    expect(pressCancel).toHaveBeenCalledTimes(1);
  });
});
