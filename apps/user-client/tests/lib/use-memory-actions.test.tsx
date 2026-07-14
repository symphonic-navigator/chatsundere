// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveMemoryPipelineArgs = vi.fn();
const runExtraction = vi.fn();
const runDreaming = vi.fn();
vi.mock('../../src/memory/resolve-args.js', () => ({
  resolveMemoryPipelineArgs: (...a: unknown[]) => resolveMemoryPipelineArgs(...a),
}));
vi.mock('../../src/memory/pipeline.js', () => ({
  runExtraction: (...a: unknown[]) => runExtraction(...a),
  runDreaming: (...a: unknown[]) => runDreaming(...a),
  // classify-error.js imports this from the real pipeline module; re-export it
  // here so that unmocked module still resolves the class it checks against.
  MemoryInvalidOutputError: class MemoryInvalidOutputError extends Error {},
}));
const tryAcquireMemoryLock = vi.fn();
const releaseMemoryLock = vi.fn();
vi.mock('../../src/memory/mutex.js', () => ({
  tryAcquireMemoryLock: (...a: unknown[]) => tryAcquireMemoryLock(...a),
  releaseMemoryLock: (...a: unknown[]) => releaseMemoryLock(...a),
}));
const toastShow = vi.fn();
vi.mock('../../src/state/toast.store.js', () => ({
  toastStore: { show: (...a: unknown[]) => toastShow(...a) },
}));
const invalidateQueries = vi.fn();
vi.mock('../../src/lib/queryClient.js', () => ({
  queryClient: { invalidateQueries: (...a: unknown[]) => invalidateQueries(...a) },
}));

import { useMemoryActions } from '../../src/lib/use-memory-actions.js';

afterEach(() => vi.clearAllMocks());

describe('useMemoryActions', () => {
  it('learnNow goes pending → idle on success and forces extraction', async () => {
    resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
    tryAcquireMemoryLock.mockReturnValue(true);
    runExtraction.mockResolvedValue(2);
    const { result } = renderHook(() => useMemoryActions('c1'));
    await act(async () => {
      await result.current.learnNow();
    });
    expect(runExtraction).toHaveBeenCalledWith({ persona: { id: 'p1' } }, { force: true });
    await waitFor(() => expect(result.current.learnState.status).toBe('idle'));
  });

  it('consolidateNow sets error when resolution fails', async () => {
    resolveMemoryPipelineArgs.mockRejectedValue(new Error('master key unavailable'));
    tryAcquireMemoryLock.mockReturnValue(true);
    const { result } = renderHook(() => useMemoryActions('c1'));
    await act(async () => {
      await result.current.consolidateNow();
    });
    await waitFor(() => expect(result.current.consolidateState.status).toBe('error'));
    expect(result.current.consolidateState.error).toBe('no-credentials');
  });

  it('shows the busy toast and stays idle when the mutex is held', async () => {
    resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
    tryAcquireMemoryLock.mockReturnValue(false);
    const { result } = renderHook(() => useMemoryActions('c1'));
    await act(async () => {
      await result.current.consolidateNow();
    });
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Already working on this — give it a moment.' }),
    );
    expect(runDreaming).not.toHaveBeenCalled();
    expect(result.current.consolidateState.status).toBe('idle');
  });

  it('acquires and releases the mutex around a successful consolidate', async () => {
    resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
    tryAcquireMemoryLock.mockReturnValue(true);
    runDreaming.mockResolvedValue(true);
    const { result } = renderHook(() => useMemoryActions('c1'));
    await act(async () => {
      await result.current.consolidateNow();
    });
    expect(tryAcquireMemoryLock).toHaveBeenCalledWith('p1');
    expect(releaseMemoryLock).toHaveBeenCalledWith('p1');
  });

  it('invalidates the memory queries per slice via onSlice', async () => {
    resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
    tryAcquireMemoryLock.mockReturnValue(true);
    runDreaming.mockImplementation(async (_a: unknown, opts: { onSlice?: () => void }) => {
      opts.onSlice?.();
      opts.onSlice?.();
      return true;
    });
    const { result } = renderHook(() => useMemoryActions('c1'));
    await act(async () => {
      await result.current.consolidateNow();
    });
    const memoryInvalidations = invalidateQueries.mock.calls.filter(
      (c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['memory', 'p1'] }),
    );
    expect(memoryInvalidations.length).toBeGreaterThanOrEqual(2);
  });

  it('classifies the failure, counts partial slices, and still invalidates on error', async () => {
    resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
    tryAcquireMemoryLock.mockReturnValue(true);
    runDreaming.mockImplementation(async (_a: unknown, opts: { onSlice?: () => void }) => {
      opts.onSlice?.();
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    const { result } = renderHook(() => useMemoryActions('c1'));
    await act(async () => {
      await result.current.consolidateNow();
    });
    await waitFor(() => expect(result.current.consolidateState.status).toBe('error'));
    expect(result.current.consolidateState.error).toBe('timeout');
    expect(result.current.consolidateState.partialSlices).toBe(1);
    expect(releaseMemoryLock).toHaveBeenCalledWith('p1');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['memory', 'p1'] });
  });

  it('records lastAttempted for error-slot precedence', async () => {
    resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
    tryAcquireMemoryLock.mockReturnValue(true);
    runExtraction.mockResolvedValue(1);
    const { result } = renderHook(() => useMemoryActions('c1'));
    expect(result.current.lastAttempted).toBeNull();
    await act(async () => {
      await result.current.learnNow();
    });
    expect(result.current.lastAttempted).toBe('learn');
  });
});
