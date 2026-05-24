import type { KnownModel } from '@chatsundere/llm-unified';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CockpitMenu } from '../../src/components/chat/CockpitMenu';
import type { ReasoningState } from '../../src/lib/reasoning-resolver';

function mkModel(reasoning: KnownModel['reasoning']): KnownModel {
  return { id: 'x', displayName: 'X', contextWindow: 1000, reasoning, vision: false, tools: false };
}

const noReason = mkModel({ kind: 'no_reasoning', defaultOn: false, replayReasoning: false });
const alwaysOnPlain = mkModel({ kind: 'always_on', defaultOn: true, replayReasoning: true });
const alwaysOnBuckets = mkModel({
  kind: 'always_on',
  effort: { buckets: ['low', 'high'], defaultBucket: 'high' },
  defaultOn: true,
  replayReasoning: true,
});
const optionalPlain = mkModel({ kind: 'optional', defaultOn: true, replayReasoning: false });
const optionalBuckets = mkModel({
  kind: 'optional',
  effort: { buckets: ['low', 'medium', 'high'], defaultBucket: 'medium' },
  defaultOn: true,
  replayReasoning: false,
});

describe('CockpitMenu', () => {
  it('no_reasoning → renders null section (entire menu may still wrap something but no reasoning UI)', () => {
    const { container } = render(
      <CockpitMenu
        model={noReason}
        reasoning={{ mode: 'off' }}
        onReasoningChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-section="reasoning"]')).toBeNull();
  });

  it('always_on without effort → no reasoning section', () => {
    const { container } = render(
      <CockpitMenu
        model={alwaysOnPlain}
        reasoning={{ mode: 'on' }}
        onReasoningChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-section="reasoning"]')).toBeNull();
  });

  it('always_on + buckets → bucket selector, no Off button', () => {
    const { container } = render(
      <CockpitMenu
        model={alwaysOnBuckets}
        reasoning={{ mode: 'bucket', bucket: 'high' }}
        onReasoningChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-section="reasoning"]')).not.toBeNull();
    expect(container.querySelector('[data-bucket="low"]')).not.toBeNull();
    expect(container.querySelector('[data-bucket="high"]')).not.toBeNull();
    expect(container.querySelector('[data-action="off"]')).toBeNull();
  });

  it('optional without effort → on/off toggle', () => {
    const { container } = render(
      <CockpitMenu
        model={optionalPlain}
        reasoning={{ mode: 'on' }}
        onReasoningChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-action="on"]')).not.toBeNull();
    expect(container.querySelector('[data-action="off"]')).not.toBeNull();
    expect(container.querySelector('[data-bucket]')).toBeNull();
  });

  it('optional + effort → buckets + Off button', () => {
    const { container } = render(
      <CockpitMenu
        model={optionalBuckets}
        reasoning={{ mode: 'bucket', bucket: 'medium' }}
        onReasoningChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-section="reasoning"]')).not.toBeNull();
    expect(container.querySelector('[data-bucket="low"]')).not.toBeNull();
    expect(container.querySelector('[data-bucket="medium"]')).not.toBeNull();
    expect(container.querySelector('[data-bucket="high"]')).not.toBeNull();
    expect(container.querySelector('[data-action="off"]')).not.toBeNull();
  });

  it('clicking a bucket fires onReasoningChange with bucket state', () => {
    const onChange = vi.fn<(r: ReasoningState) => void>();
    const { container } = render(
      <CockpitMenu
        model={optionalBuckets}
        reasoning={{ mode: 'bucket', bucket: 'medium' }}
        onReasoningChange={onChange}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('[data-bucket="high"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({ mode: 'bucket', bucket: 'high' });
  });

  it('clicking Off fires onReasoningChange with off state', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CockpitMenu
        model={optionalBuckets}
        reasoning={{ mode: 'bucket', bucket: 'medium' }}
        onReasoningChange={onChange}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('[data-action="off"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({ mode: 'off' });
  });

  it('clicking On (in optional/no-effort) fires onReasoningChange with on state', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CockpitMenu
        model={optionalPlain}
        reasoning={{ mode: 'off' }}
        onReasoningChange={onChange}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('[data-action="on"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({ mode: 'on' });
  });

  it('active bucket has data-active="true"', () => {
    const { container } = render(
      <CockpitMenu
        model={optionalBuckets}
        reasoning={{ mode: 'bucket', bucket: 'high' }}
        onReasoningChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const high = container.querySelector('[data-bucket="high"]') as HTMLElement;
    const low = container.querySelector('[data-bucket="low"]') as HTMLElement;
    expect(high.getAttribute('data-active')).toBe('true');
    expect(low.getAttribute('data-active')).toBeNull();
  });
});
