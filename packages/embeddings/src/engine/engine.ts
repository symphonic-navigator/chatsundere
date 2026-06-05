// SPDX-License-Identifier: LGPL-3.0-only
import type { ExecutionMode, ResolvedBackend } from './execution-modes.js';
import type { EmbedKind } from './model-config.js';

export interface EmbeddingEngine {
  readonly backend: ResolvedBackend;
  embed(texts: string[], opts: { kind: EmbedKind }): Promise<Float32Array[]>;
  dispose(): void;
}

export interface CreateEngineOptions {
  executionMode?: ExecutionMode;
  /** Progress callback during model load (download/compile). */
  onProgress?: (data: unknown) => void;
}

interface PendingEmbed {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
}

export function createEmbeddingEngine(opts: CreateEngineOptions = {}): Promise<EmbeddingEngine> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, PendingEmbed>();
  let nextId = 1;
  let backend: ResolvedBackend | null = null;

  return new Promise<EmbeddingEngine>((resolveInit, rejectInit) => {
    const engine: EmbeddingEngine = {
      get backend() {
        if (!backend) throw new Error('Engine not ready');
        return backend;
      },
      embed(texts, embedOpts) {
        return new Promise<Float32Array[]>((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          worker.postMessage({ type: 'embed', id, texts, kind: embedOpts.kind });
        });
      },
      dispose() {
        const err = new Error('Engine disposed');
        for (const p of pending.values()) p.reject(err);
        pending.clear();
        worker.terminate();
      },
    };

    worker.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'ready') {
        backend = msg.backend as ResolvedBackend;
        resolveInit(engine);
        return;
      }
      if (msg?.type === 'result') {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.resolve((msg.embeddings as number[][]).map((row) => Float32Array.from(row)));
        }
        return;
      }
      if (msg?.type === 'error') {
        const err = new Error(msg.message);
        const id = msg.id;
        if (typeof id === 'number') {
          const p = pending.get(id);
          if (p) {
            p.reject(err);
            pending.delete(id);
            return;
          }
        }
        if (!backend) rejectInit(err);
        return;
      }
      if (opts.onProgress && msg?.status) opts.onProgress(msg);
    });

    worker.addEventListener('error', (e) => {
      const err = new Error(`Worker error: ${e.message}`);
      if (!backend) {
        rejectInit(err);
        return;
      }
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    });

    worker.postMessage({ type: 'init', executionMode: opts.executionMode ?? 'auto' });
  });
}
