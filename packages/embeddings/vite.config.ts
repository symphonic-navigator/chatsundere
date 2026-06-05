// SPDX-License-Identifier: LGPL-3.0-only
import { defineConfig } from 'vite';

// COOP/COEP enable crossOriginIsolated → WASM threads (spec §8).
export default defineConfig({
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { format: 'es' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
