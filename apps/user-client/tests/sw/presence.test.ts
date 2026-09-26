// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { otherClientsOpen, startPresenceResponder } from '../../src/sw/presence.js';

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) {
      if (c !== this && c.name === this.name)
        queueMicrotask(() => c.onmessage?.({ data } as MessageEvent));
    }
  }
  close() {
    FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
  }
}
const original = globalThis.BroadcastChannel;
beforeEach(() => {
  FakeChannel.all = [];
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeChannel;
});
afterEach(() => {
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = original;
});

it('reports no other clients when nobody answers', async () => {
  expect(await otherClientsOpen(20)).toBe(false);
});

it("ignores its own tab's responder", async () => {
  const stop = startPresenceResponder();
  expect(await otherClientsOpen(20)).toBe(false);
  stop();
});

it('reports another client when a responder answers', async () => {
  const stop = startPresenceResponder();
  // Simulate a different tab by creating a separate channel that answers 'presence?'.
  const differentTabChannel = new FakeChannel('chatsundere-clients');
  differentTabChannel.onmessage = (e: MessageEvent) => {
    if (e.data?.type === 'presence?') {
      differentTabChannel.postMessage({ type: 'presence!' });
    }
  };
  expect(await otherClientsOpen(20)).toBe(true);
  stop();
  differentTabChannel.close();
});

it('treats a missing BroadcastChannel as sole client', async () => {
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = undefined;
  expect(await otherClientsOpen(20)).toBe(false);
});

it('imports without crypto.randomUUID (non-secure self-hosted contexts)', async () => {
  vi.resetModules();
  vi.stubGlobal('crypto', {});
  try {
    const mod = await import('../../src/sw/presence.js');
    expect(await mod.otherClientsOpen(20)).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
