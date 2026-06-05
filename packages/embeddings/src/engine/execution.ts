// SPDX-License-Identifier: LGPL-3.0-only
import {
  type FeatureExtractionPipeline,
  type ProgressCallback,
  env,
  pipeline,
} from '@huggingface/transformers';
import type { ExecutionMode, ResolvedBackend } from './execution-modes.js';
import { MODEL_ID } from './model-config.js';

export type { ExecutionMode, ResolvedBackend } from './execution-modes.js';

// Self-hosted only — load from our own origin, never call huggingface.co at
// runtime (spec §2). allowLocalModels MUST be enabled explicitly: in the browser
// transformers.js defaults it to false, so disabling remote without enabling
// local leaves both off and every backend fails config validation.
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/model/';

const WEBGPU_PROBE_MS = 4_000;
const PIPELINE_INIT_TIMEOUT_MS = 180_000;

const FALLBACK_CHAIN: {
  mode: Exclude<ExecutionMode, 'auto'>;
  device: 'webgpu' | 'wasm';
  singleThread: boolean;
}[] = [
  { mode: 'webgpu', device: 'webgpu', singleThread: false },
  { mode: 'wasm-multi', device: 'wasm', singleThread: false },
  { mode: 'wasm-single', device: 'wasm', singleThread: true },
];

export interface CreateExtractorOptions {
  progress_callback?: ProgressCallback;
  /** Skip these modes (e.g. after a runtime WebGPU failure). */
  skipModes?: Exclude<ExecutionMode, 'auto'>[];
}

function applyWasmThreads(singleThread: boolean) {
  const wasm = env.backends.onnx?.wasm;
  if (!wasm) return;
  // Multi-thread WASM needs SharedArrayBuffer, which the browser only exposes
  // under crossOriginIsolated (COOP/COEP). Without it, degrade to a single
  // thread rather than letting init fail.
  const isolated = globalThis.crossOriginIsolated === true;
  wasm.numThreads =
    singleThread || !isolated
      ? 1
      : Math.min(4, Math.ceil((navigator.hardwareConcurrency || 4) / 2));
}

export function getWasmThreadsConfigured(): number {
  return env.backends.onnx?.wasm?.numThreads ?? 1;
}

function getSessionDevice(extractor: FeatureExtractionPipeline): string {
  const model = extractor.model as {
    sessions?: Record<string, { config?: { device?: string } }>;
  };
  return model.sessions?.model?.config?.device ?? 'unknown';
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} (timeout after ${ms / 1000}s)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Minimal WebGPU shape — the standard DOM lib does not ship WebGPU types, and we
// only need requestAdapter() for the probe. Avoids a @webgpu/types dependency.
interface MinimalGpu {
  requestAdapter(): Promise<unknown>;
}

function getGpu(): MinimalGpu | undefined {
  return (navigator as unknown as { gpu?: MinimalGpu }).gpu;
}

/** Chromium exposes navigator.gpu before WebGPU is actually usable (Linux/Vivaldi without flags). */
export async function probeWebGpu(): Promise<{ ok: boolean; reason: string }> {
  const gpu = getGpu();
  if (!gpu) {
    return { ok: false, reason: 'navigator.gpu not present' };
  }
  try {
    const adapter = await withTimeout(
      gpu.requestAdapter(),
      WEBGPU_PROBE_MS,
      'WebGPU requestAdapter',
    );
    if (!adapter) {
      return {
        ok: false,
        reason: 'requestAdapter() → null (typical without --enable-unsafe-webgpu)',
      };
    }
    return { ok: true, reason: 'adapter OK' };
  } catch (err) {
    return { ok: false, reason: formatError(err) };
  }
}

async function smokeTestInference(extractor: FeatureExtractionPipeline): Promise<void> {
  await withTimeout(
    extractor(['embedding smoke test'], { normalize: true, pooling: 'cls' }),
    60_000,
    'WebGPU/WASM smoke test',
  );
}

export function buildAttemptList(
  executionMode: ExecutionMode,
  skipModes: Exclude<ExecutionMode, 'auto'>[] = [],
): typeof FALLBACK_CHAIN {
  const base =
    executionMode === 'auto'
      ? FALLBACK_CHAIN
      : FALLBACK_CHAIN.filter((a) => a.mode === executionMode);
  return base.filter((a) => !skipModes.includes(a.mode));
}

export async function createFeatureExtractor(
  dtype: 'int8' | 'fp32',
  executionMode: ExecutionMode,
  options: CreateExtractorOptions = {},
): Promise<{ extractor: FeatureExtractionPipeline; backend: ResolvedBackend }> {
  const { progress_callback, skipModes = [] } = options;
  const attempts = buildAttemptList(executionMode, skipModes);

  if (attempts.length === 0) {
    throw new Error(`No backend attempts left (skipModes: ${skipModes.join(', ')})`);
  }

  const fallbackTrail: string[] = [];
  let lastError: unknown = null;

  for (const attempt of attempts) {
    if (attempt.device === 'webgpu') {
      const probe = await probeWebGpu();
      if (!probe.ok) {
        const line = `webgpu: skipped (${probe.reason})`;
        if (executionMode === 'auto') {
          fallbackTrail.push(line);
          continue;
        }
        throw new Error(line);
      }
    }

    try {
      applyWasmThreads(attempt.singleThread);

      const extractor = await withTimeout(
        pipeline('feature-extraction', MODEL_ID, {
          dtype,
          device: attempt.device,
          progress_callback,
        }),
        PIPELINE_INIT_TIMEOUT_MS,
        `pipeline init (${attempt.mode})`,
      );

      await smokeTestInference(extractor);

      const sessionDevice = getSessionDevice(extractor);
      const wasmThreads = getWasmThreadsConfigured();

      if (executionMode === 'auto' && fallbackTrail.length > 0) {
        fallbackTrail.push(`→ ${attempt.mode} OK`);
      }

      return {
        extractor,
        backend: {
          executionMode: attempt.mode,
          device: sessionDevice,
          dtype,
          wasmThreadsConfigured: wasmThreads,
          webgpuAvailable: 'gpu' in navigator,
          crossOriginIsolated: globalThis.crossOriginIsolated === true,
          fallbackTrail,
        },
      };
    } catch (err) {
      lastError = err;
      const line = `${attempt.mode}: ${formatError(err)}`;
      if (executionMode === 'auto') {
        fallbackTrail.push(line);
      } else {
        throw new Error(line, err instanceof Error ? { cause: err } : undefined);
      }
    }
  }

  const detail = executionMode === 'auto' ? fallbackTrail.join('\n') : formatError(lastError);
  throw new Error(
    executionMode === 'auto'
      ? `No backend available:\n${detail}`
      : `${executionMode} failed: ${detail}`,
  );
}

/** Runtime fallback: WebGPU init OK, inference fails (rare, mostly Linux without flags). */
export function shouldRetryWithWasmFallback(
  executionMode: ExecutionMode,
  backend: ResolvedBackend | null,
): boolean {
  return executionMode === 'auto' && backend?.executionMode === 'webgpu';
}

export function wasmFallbackSkipModes(): Exclude<ExecutionMode, 'auto'>[] {
  return ['webgpu'];
}
