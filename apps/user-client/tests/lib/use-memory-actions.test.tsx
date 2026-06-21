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
}));
vi.mock('../../src/lib/queryClient.js', () => ({ queryClient: { invalidateQueries: vi.fn() } }));

import { useMemoryActions } from '../../src/lib/use-memory-actions.js';

afterEach(() => vi.clearAllMocks());

describe('useMemoryActions', () => {
  it('learnNow goes pending → idle on success and forces extraction', async () => {
    resolveMemoryPipelineArgs.mockResolvedValue({ persona: { id: 'p1' } });
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
    const { result } = renderHook(() => useMemoryActions('c1'));
    await act(async () => {
      await result.current.consolidateNow();
    });
    await waitFor(() => expect(result.current.consolidateState.status).toBe('error'));
  });
});
