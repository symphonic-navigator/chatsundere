// SPDX-License-Identifier: LGPL-3.0-only

export type ExecutionMode = 'auto' | 'webgpu' | 'wasm-multi' | 'wasm-single';

export interface ResolvedBackend {
  executionMode: ExecutionMode;
  device: string;
  dtype: string;
  wasmThreadsConfigured: number;
  webgpuAvailable: boolean;
  crossOriginIsolated: boolean;
  fallbackTrail: string[];
}

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  auto: 'Auto (WebGPU → WASM multi → WASM single)',
  webgpu: 'WebGPU (forced)',
  'wasm-multi': 'WASM multi-thread',
  'wasm-single': 'WASM single-thread',
};

export function formatBackendLabel(backend: ResolvedBackend): string {
  const threads =
    backend.executionMode === 'webgpu' ? '' : ` · ${backend.wasmThreadsConfigured} WASM thread(s)`;
  return `${backend.executionMode} (${backend.device})${threads}`;
}
