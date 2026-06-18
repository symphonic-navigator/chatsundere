// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Dev-only POST /__dump-db endpoint. The DevDumpButton in the user-client
 * collects every Dexie table into a JSON payload and POSTs it here; this
 * plugin writes the payload to <repo-root>/dumps/db-<timestamp>.json so a
 * debugger (human or otherwise) can inspect IndexedDB state from disk.
 *
 * `apply: 'serve'` keeps this entirely out of production builds.
 */
function dbDumpReceiver(): Plugin {
  return {
    name: 'chatsundere-db-dump-receiver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dump-db', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            // vite dev runs from apps/user-client/, so step two levels up.
            const dumpDir = path.resolve(process.cwd(), '../../dumps');
            if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const file = path.join(dumpDir, `db-${ts}.json`);
            fs.writeFileSync(file, body);
            const relFile = path.relative(path.resolve(process.cwd(), '../..'), file);
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: relFile }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
            );
          }
        });
        req.on('error', () => {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: 'request stream error' }));
        });
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
    __APP_SHA__: JSON.stringify(process.env.APP_SHA ?? 'dev'),
    __APP_BUILT_AT__: JSON.stringify(process.env.APP_BUILT_AT ?? 'dev'),
  },
  plugins: [
    react(),
    tailwindcss(),
    dbDumpReceiver(),
    VitePWA({
      registerType: 'prompt',
      base: process.env.VITE_BASE ?? '/',
      scope: process.env.VITE_BASE ?? '/',
      devOptions: { enabled: true },
      manifest: {
        id: '/',
        name: 'Chatsundere',
        short_name: 'Chatsundere',
        description: 'A local-first AI companion you control end to end.',
        start_url: process.env.VITE_BASE ?? '/',
        scope: process.env.VITE_BASE ?? '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#050210',
        theme_color: '#050210',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        // The main chunk crossed workbox's 2 MiB precache default (master sat
        // <1 kB under it). The app shell MUST be precached for offline, so the
        // limit is raised; the real cure is code-splitting the main chunk —
        // tracked in obsidian/insights/follow-ups-index.md.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        // `/model/` serves the self-hosted embedding weights (config/tokenizer
        // JSON + the int8 ONNX). Without this denylist entry the SW's
        // navigate-fallback shadows those asset requests with index.html, so
        // transformers.js receives HTML and every backend fails with
        // "Unexpected token '<'… No backend available" (Chunk A device test).
        navigateFallbackDenylist: [/^\/auth\/v1\//, /^\/api\//, /^\/model\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' ||
              url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            // Belt-and-braces: never cache API responses even if they slip through.
            // Covers /api/v1/ (current canonical prefix), /auth/v1/ (legacy),
            // and /api/auth/ (legacy variant). In dev mode with VitePWA's
            // devOptions enabled, an unmatched cross-origin request to the
            // auth-service was being dropped by Workbox instead of falling
            // through to the network — this catches every /api/ shape.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/v1/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    strictPort: true,
    // Cross-origin isolation (Stufe A — dev). COOP+COEP make the page
    // crossOriginIsolated, which exposes SharedArrayBuffer → the embedding
    // engine's WASM backend can run multi-threaded (otherwise it is pinned to a
    // single thread). Only matters on setups without real WebGPU (software GPU /
    // no shader-f16), which fall back to WASM. `credentialless` is used instead
    // of `require-corp` so cross-origin no-cors subresources (e.g. the VAD CDN
    // assets on jsdelivr) keep loading without needing CORP headers; the
    // embedding ORT WASM is same-origin (resolved via import.meta.url), so it is
    // unaffected either way. Production isolation (GitHub Pages, Safari) is
    // Stufe B via the service worker.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    // Dev-only same-origin shim: forward /admin/* to the admin-client dev
    // server so the shared-IndexedDB design (spec §6.1.1) works without a
    // reverse proxy in development. In production Traefik does this; here
    // Vite's proxy stands in for it.
    proxy: {
      '/admin': {
        target: 'http://localhost:5174',
        changeOrigin: false,
        ws: true,
      },
    },
  },
  // `vite preview` (serving the production build locally) gets the same isolation
  // headers so the multi-threaded WASM path can be tested against a real build.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  resolve: {
    alias: {
      // Resolve @chatsundere/llm-unified to its TypeScript source rather than
      // the built dist/, so curation/adapter changes are live in the dev server
      // without a manual `pnpm --filter @chatsundere/llm-unified build`. Vite
      // resolves the package's `.js`-extension imports to their `.ts` siblings,
      // so the NodeNext-style source works under the bundler.
      '@chatsundere/llm-unified': fileURLToPath(
        new URL('../../packages/llm-unified/src/index.ts', import.meta.url),
      ),
      // Same reasoning for @chatsundere/ui-shared: resolve to TypeScript source
      // rather than dist/. The package's `exports` points at dist/index.js, but
      // a `pnpm build`/`typecheck` runs ui-shared's `rm -rf dist && tsc`, which
      // briefly deletes that file out from under a running dev server (Vite then
      // logs "Failed to load url …/ui-shared/dist/index.js"). Consuming the
      // source removes the dist dependency and gives live HMR on shared edits.
      '@chatsundere/ui-shared': fileURLToPath(
        new URL('../../packages/ui-shared/src/index.ts', import.meta.url),
      ),
    },
  },
  // `@huggingface/transformers` must NOT be pre-bundled: the dep optimiser
  // mangles its `new URL('ort-wasm-…', import.meta.url)` asset references, so
  // onnxruntime-web cannot locate its WASM factory and every backend fails with
  // "Unexpected token '<'… No backend available" (the SPA fallback HTML). The
  // embeddings package's own dev server excludes it for the same reason.
  optimizeDeps: { exclude: ['qr-scanner/qr-scanner-worker.min.js', '@huggingface/transformers'] },
  // The embedding engine runs as an ES-module Web Worker.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: false,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
