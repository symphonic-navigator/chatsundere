// SPDX-License-Identifier: LGPL-3.0-only
import type { FeatureExtractionPipeline, ProgressCallback } from '@huggingface/transformers';
import type { ExecutionMode, ResolvedBackend } from './execution-modes.js';
import {
  createFeatureExtractor,
  shouldRetryWithWasmFallback,
  wasmFallbackSkipModes,
} from './execution.js';
import { type EmbedKind, POOLING, applyPrefix } from './model-config.js';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface InitRequest {
  type: 'init';
  executionMode: ExecutionMode;
}
interface EmbedRequest {
  type: 'embed';
  id: number;
  texts: string[];
  kind: EmbedKind;
}
type WorkerRequest = InitRequest | EmbedRequest;

let pipelineInstance: FeatureExtractionPipeline | null = null;
let pipelineExecutionMode: ExecutionMode = 'auto';
let activeBackend: ResolvedBackend | null = null;

function resetPipeline() {
  pipelineInstance = null;
}

async function loadPipeline(
  progress_callback?: ProgressCallback,
  skipModes: Exclude<ExecutionMode, 'auto'>[] = [],
): Promise<ResolvedBackend> {
  resetPipeline();
  const { extractor, backend } = await createFeatureExtractor('int8', pipelineExecutionMode, {
    progress_callback,
    skipModes,
  });
  pipelineInstance = extractor;
  activeBackend = backend;
  return backend;
}

async function getPipelineInstance(): Promise<FeatureExtractionPipeline> {
  if (!pipelineInstance) await loadPipeline();
  const inst = pipelineInstance;
  if (!inst) throw new Error('Pipeline failed to initialise');
  return inst;
}

async function reloadWasmFallback(): Promise<ResolvedBackend> {
  const trail = [
    ...(activeBackend?.fallbackTrail ?? []),
    'runtime: WebGPU inference failed → WASM fallback',
  ];
  const backend = await loadPipeline(undefined, wasmFallbackSkipModes());
  activeBackend = { ...backend, fallbackTrail: trail };
  return activeBackend;
}

function normaliseEmbeddings(raw: number[] | number[][]): number[][] {
  if (!raw.length) return [];
  if (typeof raw[0] === 'number') return [raw as number[]];
  return raw as number[][];
}

async function embedBatch(
  extractor: FeatureExtractionPipeline,
  texts: string[],
  kind: EmbedKind,
): Promise<number[][]> {
  const prefixed = texts.map((t) => applyPrefix(t, kind));
  const output = await extractor(prefixed, { normalize: true, pooling: POOLING });
  return normaliseEmbeddings(output.tolist());
}

async function embedWithRuntimeFallback(texts: string[], kind: EmbedKind): Promise<number[][]> {
  try {
    const extractor = await getPipelineInstance();
    return await embedBatch(extractor, texts, kind);
  } catch (firstErr) {
    if (!shouldRetryWithWasmFallback(pipelineExecutionMode, activeBackend)) throw firstErr;
    await reloadWasmFallback();
    const extractor = await getPipelineInstance();
    return await embedBatch(extractor, texts, kind);
  }
}

const postProgress: ProgressCallback = (data) => {
  ctx.postMessage(data);
};

ctx.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      pipelineExecutionMode = msg.executionMode;
      const backend = await loadPipeline(postProgress);
      ctx.postMessage({ type: 'ready', backend });
      return;
    }
    if (msg.type === 'embed') {
      const embeddings = await embedWithRuntimeFallback(msg.texts, msg.kind);
      ctx.postMessage({ type: 'result', id: msg.id, embeddings });
      return;
    }
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      id: msg.type === 'embed' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
});

ctx.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  ctx.postMessage({
    type: 'error',
    message: `Unhandled: ${reason instanceof Error ? reason.message : String(reason)}`,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
