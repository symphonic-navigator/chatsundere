// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { memoryBodyAdoptsWinner, resolveConflict } from '../../src/sync/resolution.js';

describe('resolveConflict — LWW collections (§7.5)', () => {
  const lwwCollections = [
    'personas',
    'libraries',
    'documents',
    'providers',
    'mcpServers',
    'chats',
    'messages',
    'mindspaces',
  ] as const;

  it('pulled newer updatedAt wins, no repush', () => {
    for (const c of lwwCollections) {
      const r = resolveConflict(c, { id: 'a', updatedAt: 1 }, { id: 'a', updatedAt: 2 });
      expect(r).toEqual({ winner: 'pulled', repush: false });
    }
  });

  it('local newer updatedAt wins and repushes', () => {
    for (const c of lwwCollections) {
      const r = resolveConflict(c, { id: 'a', updatedAt: 5 }, { id: 'a', updatedAt: 2 });
      expect(r).toEqual({ winner: 'local', repush: true });
    }
  });

  it('ties break by higher uuid, deterministically', () => {
    // higher pulled uuid wins
    expect(
      resolveConflict('personas', { id: 'a', updatedAt: 3 }, { id: 'b', updatedAt: 3 }),
    ).toEqual({ winner: 'pulled', repush: false });
    // higher local uuid wins → repush
    expect(
      resolveConflict('personas', { id: 'b', updatedAt: 3 }, { id: 'a', updatedAt: 3 }),
    ).toEqual({ winner: 'local', repush: true });
    // identical row (same id + clock) → local, no repush (idempotent)
    expect(
      resolveConflict('personas', { id: 'a', updatedAt: 3 }, { id: 'a', updatedAt: 3 }),
    ).toEqual({ winner: 'local', repush: false });
  });
});

describe('resolveConflict — settings (server-wins + M-8 replay guard)', () => {
  it('applies a same-or-newer pulled row (server wins) with the applied note', () => {
    expect(resolveConflict('settings', { updatedAt: 1 }, { updatedAt: 2 })).toEqual({
      winner: 'pulled',
      repush: false,
      note: 'settings-applied',
    });
    expect(resolveConflict('settings', { updatedAt: 2 }, { updatedAt: 2 })).toEqual({
      winner: 'pulled',
      repush: false,
      note: 'settings-applied',
    });
  });

  it('replay guard: a strictly older pulled row keeps local and repushes (precedence)', () => {
    expect(resolveConflict('settings', { updatedAt: 5 }, { updatedAt: 2 })).toEqual({
      winner: 'local',
      repush: true,
      note: 'settings-precedence',
    });
  });
});

describe('resolveConflict — memoryJournal state precedence', () => {
  const state = (s: string) => ({ state: s });
  it('higher-precedence pulled state wins (archived > committed > uncommitted)', () => {
    expect(resolveConflict('memoryJournal', state('uncommitted'), state('committed'))).toEqual({
      winner: 'pulled',
      repush: false,
    });
    expect(resolveConflict('memoryJournal', state('committed'), state('archived'))).toEqual({
      winner: 'pulled',
      repush: false,
    });
  });
  it('higher-precedence local state wins and repushes', () => {
    expect(resolveConflict('memoryJournal', state('archived'), state('committed'))).toEqual({
      winner: 'local',
      repush: true,
    });
  });
  it('equal state is an idempotent no-op', () => {
    expect(resolveConflict('memoryJournal', state('committed'), state('committed'))).toEqual({
      winner: 'local',
      repush: false,
    });
  });
});

describe('resolveConflict — vectors stamp adoption', () => {
  const stamp = (codecVersion: number, modelId: string, dim: number) => ({
    codecVersion,
    modelId,
    dim,
  });
  it('adopts a compatible pulled chunk (no repush)', () => {
    expect(resolveConflict('vectors', stamp(1, 'm', 384), stamp(1, 'm', 384))).toEqual({
      winner: 'pulled',
      repush: false,
    });
  });
  it('keeps local on incompatible stamp, never repushes (caller re-embeds)', () => {
    expect(resolveConflict('vectors', stamp(1, 'm', 384), stamp(2, 'm', 384))).toEqual({
      winner: 'local',
      repush: false,
    });
    expect(resolveConflict('vectors', stamp(1, 'm', 384), stamp(1, 'other', 384))).toEqual({
      winner: 'local',
      repush: false,
    });
    expect(resolveConflict('vectors', stamp(1, 'm', 384), stamp(1, 'm', 512))).toEqual({
      winner: 'local',
      repush: false,
    });
  });
});

describe('resolveConflict — memoryBody (never merged)', () => {
  const body = (id: string, version: number, entriesProcessed: number) => ({
    id,
    version,
    entriesProcessed,
  });
  it('higher version wins', () => {
    expect(resolveConflict('memoryBody', body('a', 1, 10), body('b', 2, 3))).toEqual({
      winner: 'pulled',
      repush: false,
    });
    expect(resolveConflict('memoryBody', body('a', 3, 10), body('b', 2, 30))).toEqual({
      winner: 'local',
      repush: true,
    });
  });
  it('tie on version breaks by entriesProcessed', () => {
    expect(resolveConflict('memoryBody', body('a', 2, 5), body('b', 2, 9))).toEqual({
      winner: 'pulled',
      repush: false,
    });
  });
});

describe('resolveConflict — immutable / creation-only collections', () => {
  for (const c of ['pills', 'compactionCheckpoints', 'seedTemplates'] as const) {
    it(`${c}: idempotent no-op on conflict`, () => {
      expect(resolveConflict(c, { id: 'x' }, { id: 'x' })).toEqual({
        winner: 'local',
        repush: false,
      });
    });
  }
});

describe('resolveConflict — blob collections resolve LWW (WS-D §3)', () => {
  // `artefacts`/`attachments` LWW on `updatedAt` with a uuid tie-break; joined the
  // handled set in WS-D (they no longer fall through to the fail-loud branch).
  for (const c of ['artefacts', 'attachments'] as const) {
    it(`${c}: pulled newer updatedAt wins`, () => {
      expect(resolveConflict(c, { id: 'a', updatedAt: 1 }, { id: 'a', updatedAt: 2 })).toEqual({
        winner: 'pulled',
        repush: false,
      });
    });
    it(`${c}: local newer updatedAt wins and repushes`, () => {
      expect(resolveConflict(c, { id: 'a', updatedAt: 5 }, { id: 'a', updatedAt: 2 })).toEqual({
        winner: 'local',
        repush: true,
      });
    });
  }

  // `personaAvatars` LWW on `updatedAt`, keyed 1:1 by `personaId` (no uuid) — an
  // exact-clock tie is the same logical avatar, resolved to local with no repush.
  it('personaAvatars: LWW on updatedAt, tie resolves to local', () => {
    expect(resolveConflict('personaAvatars', { updatedAt: 1 }, { updatedAt: 2 })).toEqual({
      winner: 'pulled',
      repush: false,
    });
    expect(resolveConflict('personaAvatars', { updatedAt: 3 }, { updatedAt: 3 })).toEqual({
      winner: 'local',
      repush: false,
    });
  });
});

describe('memoryBodyAdoptsWinner — anti-ping-pong', () => {
  it('adopts the winner when its processed set covers the local journal view', () => {
    expect(memoryBodyAdoptsWinner(['e1', 'e2'], ['e1', 'e2', 'e3'])).toBe(true);
    expect(memoryBodyAdoptsWinner([], ['e1'])).toBe(true);
  });
  it('re-dreams when the local view has entries the winner has not processed', () => {
    expect(memoryBodyAdoptsWinner(['e1', 'e9'], ['e1', 'e2'])).toBe(false);
  });
});
