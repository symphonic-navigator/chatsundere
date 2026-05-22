// SPDX-License-Identifier: AGPL-3.0-only
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0-dev'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      devOptions: { enabled: true },
      manifest: {
        id: '/',
        name: 'Chatsundere',
        short_name: 'Chatsundere',
        description: 'A local-first AI companion you control end to end.',
        start_url: '/',
        scope: '/',
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
