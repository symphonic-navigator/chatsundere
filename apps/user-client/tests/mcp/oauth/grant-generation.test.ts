// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { McpOAuthGrantRow } from '../../../src/boot/client-data-db.js';
import { isHoldBlocking } from '../../../src/mcp/oauth/ensure-token.js';
import {
  acceptedFields,
  ackFields,
  generationOf,
  hasPendingNewSignIn,
  isGrantDead,
  isGrantHeld,
  isGrantLive,
  isGrantPaused,
  judgePulledGrant,
  nextGeneration,
  seenOf,
  stampForPush,
} from '../../../src/mcp/oauth/grant-generation.js';

const blob = { version: 1 as const, ciphertext: new Uint8Array([1]), nonce: new Uint8Array(12) };

function row(overrides: Partial<McpOAuthGrantRow> = {}): McpOAuthGrantRow {
  return {
    id: 'srv',
    resource: 'https://mcp.example/mcp',
    issuer: 'https://auth.example',
    tokenEndpoint: 'https://auth.example/token',
    revocationEndpoint: null,
    clientId: 'c',
    registration: 'dcr',
    scope: null,
    tokenRoute: 'direct',
    tokens: blob,
    claim: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('absent generations', () => {
  it('read as 0', () => {
    expect(generationOf(undefined)).toBe(0);
    expect(generationOf(null)).toBe(0);
    expect(generationOf({})).toBe(0);
    expect(seenOf({})).toBe(0);
    expect(seenOf(null)).toBe(0);
  });

  it('absent generations read as 0 and apply', () => {
    expect(judgePulledGrant({}, {})).toEqual({ kind: 'apply' });
  });
});

describe('nextGeneration', () => {
  it('is max(seen, base) + 1', () => {
    expect(nextGeneration({ seenGeneration: 9 }, 4)).toBe(10);
    expect(nextGeneration({}, 7)).toBe(8);
    expect(nextGeneration({ seenGeneration: 3 }, 7)).toBe(8);
  });
});

describe('stampForPush', () => {
  it('stamps the new generation, mirrors it into seen and clears the hold', () => {
    const input = row({ generation: 7, seenGeneration: 7, heldGeneration: 4 });
    const out = stampForPush(input, 7);
    expect(out.generation).toBe(8);
    expect(out.seenGeneration).toBe(8);
    expect(out.heldGeneration).toBeNull();
    expect({ ...out, generation: 0, seenGeneration: 0, heldGeneration: null }).toEqual({
      ...input,
      generation: 0,
      seenGeneration: 0,
      heldGeneration: null,
    });
  });
});

describe('judgePulledGrant', () => {
  it('refuses a pulled generation below the high-water mark', () => {
    expect(judgePulledGrant({ seenGeneration: 9 }, { generation: 4 })).toEqual({
      kind: 'refuse',
      heldGeneration: 4,
    });
  });
  it('applies an equal generation', () => {
    expect(judgePulledGrant({ seenGeneration: 9 }, { generation: 9 })).toEqual({ kind: 'apply' });
  });
  it('applies when there is no local row', () => {
    expect(judgePulledGrant(undefined, { generation: 0 })).toEqual({ kind: 'apply' });
  });
});

describe('acceptedFields', () => {
  it('raises seen to the pulled generation and clears the hold', () => {
    expect(acceptedFields({ seenGeneration: 3 }, { generation: 9 })).toEqual({
      seenGeneration: 9,
      heldGeneration: null,
    });
    expect(acceptedFields(undefined, {})).toEqual({ seenGeneration: 0, heldGeneration: null });
  });
});

describe('ackFields', () => {
  it('acknowledges a push at or above the high-water mark', () => {
    expect(ackFields({ seenGeneration: 9 }, 9)).toEqual({
      seenGeneration: 9,
      heldGeneration: null,
    });
    expect(ackFields({ seenGeneration: 9 }, 12)).toEqual({
      seenGeneration: 12,
      heldGeneration: null,
    });
  });
  it('changes nothing for a push below it', () => {
    expect(ackFields({ seenGeneration: 9 }, 4)).toBeNull();
  });
});

describe('liveness', () => {
  it('isGrantHeld', () => {
    expect(isGrantHeld({})).toBe(false);
    expect(isGrantHeld({ heldGeneration: null })).toBe(false);
    expect(isGrantHeld({ heldGeneration: 0 })).toBe(true);
    expect(isGrantHeld({ heldGeneration: 4 })).toBe(true);
  });
  it('isGrantDead', () => {
    expect(isGrantDead({ tokens: null })).toBe(true);
    expect(isGrantDead({ tokens: null, pendingTokens: null })).toBe(true);
    expect(isGrantDead({ tokens: null, pendingTokens: blob })).toBe(false);
    expect(isGrantDead({ tokens: blob })).toBe(false);
  });
  it('isGrantLive', () => {
    expect(isGrantLive(row({ heldGeneration: null }))).toBe(true);
    expect(isGrantLive(row({ heldGeneration: 4 }))).toBe(false);
    expect(isGrantLive(row({ tokens: null, pendingTokens: blob }))).toBe(true);
    expect(isGrantLive(row({ tokens: null }))).toBe(false);
    expect(isGrantLive(undefined)).toBe(false);
    // A new sign-in waiting to publish is this device's own fresh grant, held or not.
    expect(
      isGrantLive(row({ heldGeneration: 4, pendingTokens: blob, pendingNewFamily: true })),
    ).toBe(true);
    expect(
      isGrantLive(row({ heldGeneration: 4, pendingTokens: blob, pendingNewFamily: false })),
    ).toBe(false);
  });
  it('isGrantPaused', () => {
    expect(isGrantPaused(row({ heldGeneration: null }))).toBe(false);
    expect(isGrantPaused(row({ heldGeneration: 4 }))).toBe(true);
    expect(isGrantPaused(row({ heldGeneration: 4, pendingTokens: blob }))).toBe(true);
    expect(
      isGrantPaused(row({ heldGeneration: 4, pendingTokens: blob, pendingNewFamily: true })),
    ).toBe(false);
    // The new-family flag alone, without a pair, exempts nothing.
    expect(isGrantPaused(row({ heldGeneration: 4, pendingNewFamily: true }))).toBe(true);
  });
});

describe('display and gate agree', () => {
  const pendings: { name: string; fields: Partial<McpOAuthGrantRow> }[] = [
    { name: 'no pending pair', fields: { pendingTokens: null, pendingNewFamily: false } },
    { name: 'an ordinary pending pair', fields: { pendingTokens: blob, pendingNewFamily: false } },
    { name: 'a new-family pending pair', fields: { pendingTokens: blob, pendingNewFamily: true } },
    { name: 'a stray new-family flag', fields: { pendingTokens: null, pendingNewFamily: true } },
  ];
  for (const heldGeneration of [null, 0, 4]) {
    for (const p of pendings) {
      it(`held ${heldGeneration} with ${p.name}: paused exactly when the gate blocks`, () => {
        const r = row({ heldGeneration, ...p.fields });
        expect(isGrantPaused(r)).toBe(isHoldBlocking(r));
        expect(isHoldBlocking(r)).toBe(heldGeneration !== null && !hasPendingNewSignIn(r));
      });
    }
  }
});
