// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering, WireMessage } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db.js';
import {
  CONTEXT_FLOOR,
  contextAdjustable,
  effectiveFloor,
  outOfWindowCount,
  resolveContextWindow,
  truncateToWindow,
} from '../../src/lib/context-window.js';

function offering(recommended: number, max: number): Offering {
  // Only the `context` field is read by these helpers.
  return { context: { recommended, max } } as unknown as Offering;
}
function persona(contextWindow: number | null): PersonaRow {
  return { contextWindow } as unknown as PersonaRow;
}

describe('effectiveFloor / contextAdjustable', () => {
  it('caps the floor at the offering max', () => {
    expect(effectiveFloor(offering(50_000, 50_000))).toBe(50_000);
    expect(effectiveFloor(offering(200_000, 1_000_000))).toBe(CONTEXT_FLOOR);
  });
  it('is not adjustable when max is at or below the floor', () => {
    expect(contextAdjustable(offering(40_000, 40_000))).toBe(false);
    expect(contextAdjustable(offering(200_000, 1_000_000))).toBe(true);
  });
});

describe('resolveContextWindow', () => {
  it('uses recommended when persona override is null', () => {
    expect(resolveContextWindow(persona(null), offering(200_000, 1_000_000))).toBe(200_000);
  });
  it('clamps a persona override into [effectiveFloor, max]', () => {
    expect(resolveContextWindow(persona(10_000), offering(200_000, 1_000_000))).toBe(CONTEXT_FLOOR);
    expect(resolveContextWindow(persona(2_000_000), offering(200_000, 1_000_000))).toBe(1_000_000);
    expect(resolveContextWindow(persona(300_000), offering(200_000, 1_000_000))).toBe(300_000);
  });
});

describe('truncateToWindow', () => {
  const sys: WireMessage = { role: 'system', content: 'x'.repeat(400) }; // 100 tokens
  const u = (n: number): WireMessage => ({ role: 'user', content: 'x'.repeat(n * 4) }); // n tokens
  it('returns unchanged when within budget', () => {
    const msgs = [sys, u(10), u(10), u(5)];
    expect(truncateToWindow(msgs, 1000)).toEqual({ messages: msgs, trimmed: 0 });
  });
  it('drops oldest history first until within budget, keeping system + current', () => {
    const msgs = [sys, u(50), u(50), u(50), u(5)]; // total 255
    const res = truncateToWindow(msgs, 200);
    expect(res.trimmed).toBe(2);
    expect(res.messages[0]).toBe(sys);
    expect(res.messages[res.messages.length - 1]).toBe(msgs[4]);
    // the kept set must be within budget
    const kept = res.messages.reduce(
      (s, m) => s + Math.ceil((typeof m.content === 'string' ? m.content.length : 0) / 4),
      0,
    );
    expect(kept).toBeLessThanOrEqual(200);
  });
  it('never drops below system + current even if over budget', () => {
    const msgs = [sys, u(500)];
    expect(truncateToWindow(msgs, 10)).toEqual({ messages: msgs, trimmed: 0 });
  });
});

describe('outOfWindowCount', () => {
  it('counts the oldest messages that fall outside the window', () => {
    // budget 100, system 40 -> 60 remaining; messages newest-first 30,30,30
    expect(outOfWindowCount([30, 30, 30], 40, 100)).toBe(1);
  });
  it('keeps at least the newest message', () => {
    expect(outOfWindowCount([30, 30], 95, 100)).toBe(1);
  });
  it('returns 0 when everything fits', () => {
    expect(outOfWindowCount([10, 10, 10], 10, 1000)).toBe(0);
  });
});
