// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  ParseExportError,
  parseThirdPartyExport,
} from '../../src/lib/third-party-import/worker-host.js';

/** Minimal fake Worker capturing handlers so the test drives the protocol. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function fileOf(text: string): Blob {
  return new Blob([text], { type: 'application/json' });
}

describe('parseThirdPartyExport', () => {
  it('resolves with the worker result and terminates the worker', async () => {
    const fake = new FakeWorker();
    const handle = parseThirdPartyExport(fileOf('[]'), () => fake as unknown as Worker);
    await vi.waitFor(() => expect(fake.posted).toHaveLength(1));
    const payload = { source: 'chatgpt', conversations: [], failures: [] };
    fake.onmessage?.({ data: { ok: true, result: payload } } as MessageEvent);
    await expect(handle.result).resolves.toEqual(payload);
    expect(fake.terminated).toBe(true);
  });

  it('rejects with the reported error kind', async () => {
    const fake = new FakeWorker();
    const handle = parseThirdPartyExport(fileOf('junk'), () => fake as unknown as Worker);
    await vi.waitFor(() => expect(fake.posted).toHaveLength(1));
    fake.onmessage?.({
      data: { ok: false, kind: 'unrecognised', message: 'nope' },
    } as MessageEvent);
    await expect(handle.result).rejects.toMatchObject({ kind: 'unrecognised' });
  });

  it('maps a worker crash to worker-crashed', async () => {
    const fake = new FakeWorker();
    const handle = parseThirdPartyExport(fileOf('[]'), () => fake as unknown as Worker);
    await vi.waitFor(() => expect(fake.posted).toHaveLength(1));
    fake.onerror?.({});
    await expect(handle.result).rejects.toMatchObject({ kind: 'worker-crashed' });
    expect(fake.terminated).toBe(true);
  });

  it('cancel terminates the worker and rejects with cancelled', async () => {
    const fake = new FakeWorker();
    const handle = parseThirdPartyExport(fileOf('[]'), () => fake as unknown as Worker);
    handle.cancel();
    await expect(handle.result).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fake.terminated).toBe(true);
    expect(handle.result).toBeInstanceOf(Promise);
    expect(new ParseExportError('cancelled', 'x').kind).toBe('cancelled');
  });
});
