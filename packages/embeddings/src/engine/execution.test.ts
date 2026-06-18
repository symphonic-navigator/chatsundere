// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedBackend } from './execution-modes.js';
import {
  buildAttemptList,
  probeWebGpu,
  shouldRetryWithWasmFallback,
  wasmFallbackSkipModes,
} from './execution.js';

describe('buildAttemptList', () => {
  it('auto mode yields the full fallback chain in order', () => {
    expect(buildAttemptList('auto').map((a) => a.mode)).toEqual([
      'webgpu',
      'wasm-multi',
      'wasm-single',
    ]);
  });
  it('a forced mode yields only that mode', () => {
    expect(buildAttemptList('wasm-multi').map((a) => a.mode)).toEqual(['wasm-multi']);
  });
  it('skipModes removes attempts (e.g. after a WebGPU runtime failure)', () => {
    expect(buildAttemptList('auto', ['webgpu']).map((a) => a.mode)).toEqual([
      'wasm-multi',
      'wasm-single',
    ]);
  });
});

describe('shouldRetryWithWasmFallback', () => {
  const webgpuBackend: ResolvedBackend = {
    executionMode: 'webgpu',
    device: 'webgpu',
    dtype: 'int8',
    wasmThreadsConfigured: 0,
    webgpuAvailable: true,
    crossOriginIsolated: true,
    fallbackTrail: [],
  };
  it('retries only in auto mode after a webgpu backend failed', () => {
    expect(shouldRetryWithWasmFallback('auto', webgpuBackend)).toBe(true);
  });
  it('does not retry in a forced mode', () => {
    expect(shouldRetryWithWasmFallback('webgpu', webgpuBackend)).toBe(false);
  });
  it('does not retry when the backend was not webgpu', () => {
    expect(
      shouldRetryWithWasmFallback('auto', { ...webgpuBackend, executionMode: 'wasm-multi' }),
    ).toBe(false);
  });
});

describe('wasmFallbackSkipModes', () => {
  it('skips webgpu', () => {
    expect(wasmFallbackSkipModes()).toEqual(['webgpu']);
  });
});

describe('probeWebGpu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports not-ok when navigator.gpu is absent', async () => {
    vi.stubGlobal('navigator', {});
    const r = await probeWebGpu();
    expect(r.ok).toBe(false);
  });

  it('reports not-ok when requestAdapter resolves null', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve(null) } });
    const r = await probeWebGpu();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('null');
  });

  it('rejects a software adapter (SwiftShader) — slower than WASM', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: () =>
          Promise.resolve({
            info: {
              vendor: 'google',
              architecture: 'swiftshader',
              description: 'SwiftShader Device',
            },
            features: { has: () => true },
          }),
      },
    });
    const r = await probeWebGpu();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/software/i);
  });

  it('rejects a hardware adapter that lacks shader-f16 (q4f16 GPU path needs it)', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: () =>
          Promise.resolve({
            info: { vendor: 'nvidia', architecture: 'turing' },
            features: { has: (f: string) => f !== 'shader-f16' },
          }),
      },
    });
    const r = await probeWebGpu();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/shader-f16/i);
  });

  it('reports ok for a hardware adapter with shader-f16', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: () =>
          Promise.resolve({
            info: { vendor: 'nvidia', architecture: 'turing' },
            features: { has: () => true },
          }),
      },
    });
    const r = await probeWebGpu();
    expect(r.ok).toBe(true);
  });
});
