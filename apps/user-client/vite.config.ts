// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
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
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\/v1\//, /^\/api\//],
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
  optimizeDeps: { exclude: ['qr-scanner/qr-scanner-worker.min.js'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: false,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
