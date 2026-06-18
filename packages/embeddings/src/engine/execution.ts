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

/** ONNX weight format. int8 is the WASM-optimal choice; q4f16 is the WebGPU
 *  choice (4-bit weights + fp16 compute — needs the `shader-f16` feature).
 *  int8 on the WebGPU EP falls quantized ops back to the CPU and is far slower
 *  than WASM, so the device→dtype mapping below never pairs them. */
export type EmbedDtype = 'int8' | 'q4f16' | 'fp16' | 'fp32';

const FALLBACK_CHAIN: {
  mode: Exclude<ExecutionMode, 'auto'>;
  device: 'webgpu' | 'wasm';
  singleThread: boolean;
  dtype: EmbedDtype;
}[] = [
  { mode: 'webgpu', device: 'webgpu', singleThread: false, dtype: 'q4f16' },
  { mode: 'wasm-multi', device: 'wasm', singleThread: false, dtype: 'int8' },
  { mode: 'wasm-single', device: 'wasm', singleThread: true, dtype: 'int8' },
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
// only need requestAdapter() + adapter info/features for the probe. Avoids a
// @webgpu/types dependency.
interface MinimalAdapterInfo {
  vendor?: string;
  architecture?: string;
  description?: string;
}
interface MinimalAdapter {
  info?: MinimalAdapterInfo;
  requestAdapterInfo?(): Promise<MinimalAdapterInfo>;
  features?: { has(name: string): boolean };
}
interface MinimalGpu {
  requestAdapter(): Promise<MinimalAdapter | null>;
}

function getGpu(): MinimalGpu | undefined {
  return (navigator as unknown as { gpu?: MinimalGpu }).gpu;
}

/** CPU software renderers expose a WebGPU adapter but run on the CPU, slower than
 *  WASM for this workload — detect and reject them. */
function isSoftwareAdapter(info: MinimalAdapterInfo | undefined): boolean {
  const s =
    `${info?.vendor ?? ''} ${info?.architecture ?? ''} ${info?.description ?? ''}`.toLowerCase();
  return /swiftshader|llvmpipe|lavapipe|basic render|microsoft basic|software/.test(s);
}

async function getAdapterInfo(adapter: MinimalAdapter): Promise<MinimalAdapterInfo | undefined> {
  if (adapter.info) return adapter.info;
  if (adapter.requestAdapterInfo) {
    try {
      return await adapter.requestAdapterInfo();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Decide whether WebGPU is the right backend. Chromium exposes navigator.gpu
 * before WebGPU is usable (Linux/Vivaldi without flags → null adapter), and on
 * Linux it often falls back to the SwiftShader software renderer — which is
 * slower than WASM. We also require `shader-f16`, because the WebGPU dtype is
 * q4f16; without f16 the GPU path cannot run, so WASM (int8) is the better choice.
 */
export async function probeWebGpu(): Promise<{ ok: boolean; reason: string }> {
  const gpu = getGpu();
  if (!gpu) {
    return { ok: false, reason: 'navigator.gpu not present' };
  }
  let adapter: MinimalAdapter | null;
  try {
    adapter = await withTimeout(gpu.requestAdapter(), WEBGPU_PROBE_MS, 'WebGPU requestAdapter');
  } catch (err) {
    return { ok: false, reason: formatError(err) };
  }
  if (!adapter) {
    return {
      ok: false,
      reason: 'requestAdapter() → null (typical without --enable-unsafe-webgpu)',
    };
  }
  const info = await getAdapterInfo(adapter);
  if (isSoftwareAdapter(info)) {
    const what = info?.architecture || info?.description || 'software renderer';
    return {
      ok: false,
      reason: `software adapter (${what}) — slower than WASM, using WASM instead`,
    };
  }
  if (!adapter.features?.has?.('shader-f16')) {
    return {
      ok: false,
      reason: 'no shader-f16 (q4f16 GPU path unavailable) — using WASM instead',
    };
  }
  return { ok: true, reason: 'hardware adapter with shader-f16' };
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
          dtype: attempt.dtype,
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
          dtype: attempt.dtype,
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
