// vite.config.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "file:///home/user/chatsundere/node_modules/.pnpm/@tailwindcss+vite@4.3.0_vite@6.4.2_@types+node@25.8.0_jiti@2.7.0_lightningcss@1.32.0_terser@5.47.1_yaml@2.9.0_/node_modules/@tailwindcss/vite/dist/index.mjs";
import react from "file:///home/user/chatsundere/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.2_@types+node@25.8.0_jiti@2.7.0_lightningcss@1.32.0_terser@5.47.1_yaml@2.9.0_/node_modules/@vitejs/plugin-react/dist/index.js";
import { defineConfig } from "file:///home/user/chatsundere/node_modules/.pnpm/vite@6.4.2_@types+node@25.8.0_jiti@2.7.0_lightningcss@1.32.0_terser@5.47.1_yaml@2.9.0/node_modules/vite/dist/node/index.js";
import { VitePWA } from "file:///home/user/chatsundere/node_modules/.pnpm/vite-plugin-pwa@0.21.2_vite@6.4.2_@types+node@25.8.0_jiti@2.7.0_lightningcss@1.32.0_terser@5._4jboskp6hsa25dvwjapkm5etlm/node_modules/vite-plugin-pwa/dist/index.js";

// src/mcp/oauth/client-metadata.ts
function clientMetadataUrl(origin) {
  return `${origin}/oauth/client-metadata.json`;
}
function redirectUri(origin) {
  return `${origin}/oauth/callback`;
}
function buildClientMetadata(origin) {
  return {
    client_id: clientMetadataUrl(origin),
    client_name: "Chatsundere",
    client_uri: origin,
    redirect_uris: [redirectUri(origin)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none"
  };
}

// vite.config.ts
var __vite_injected_original_import_meta_url = "file:///home/user/chatsundere/apps/user-client/vite.config.ts";
function dbDumpReceiver() {
  return {
    name: "chatsundere-db-dump-receiver",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dump-db", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf-8");
            const dumpDir = path.resolve(process.cwd(), "../../dumps");
            if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
            const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
            const file = path.join(dumpDir, `db-${ts}.json`);
            fs.writeFileSync(file, body);
            const relFile = path.relative(path.resolve(process.cwd(), "../.."), file);
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, file: relFile }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })
            );
          }
        });
        req.on("error", () => {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: "request stream error" }));
        });
      });
    }
  };
}
function oauthDevRoutes() {
  return {
    name: "chatsundere-oauth-dev-routes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0];
        if (pathname === "/oauth/client-metadata.json") {
          const host = req.headers.host ?? "";
          if (!/^[A-Za-z0-9.-]+(:[0-9]+)?$/.test(host)) {
            res.statusCode = 400;
            res.end();
            return;
          }
          const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(buildClientMetadata(`${proto}://${host}`)));
          return;
        }
        if (pathname === "/oauth/callback") {
          const file = path.resolve(server.config.root, "oauth-callback.html");
          const html = await server.transformIndexHtml(
            "/oauth/callback",
            fs.readFileSync(file, "utf-8")
          );
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.setHeader("referrer-policy", "no-referrer");
          res.setHeader("cache-control", "no-store");
          res.end(html);
          return;
        }
        next();
      });
    }
  };
}
var vite_config_default = defineConfig({
  base: process.env.VITE_BASE ?? "/",
  build: {
    rollupOptions: {
      input: { main: "index.html", "oauth-callback": "oauth-callback.html" },
      output: {
        // Split the heavyweight, eagerly-imported vendors (katex, shiki core)
        // into their own chunks so the app-shell index chunk stays under
        // workbox's precache cap (obsidian/insights/follow-ups-index.md —
        // main-chunk code-split). mermaid is already dynamically imported
        // (MermaidBlock). For shiki, match core + engines but NOT
        // @shikijs/langs / @shikijs/themes: those grammar/theme modules are
        // loaded on demand and already emit their own lazy chunks — forcing
        // them into the shiki chunk here would collapse ~200 lazy grammars
        // into one eager blob, defeating the split.
        manualChunks(id) {
          if (id.includes("node_modules/katex")) return "katex";
          if ((id.includes("/node_modules/shiki/") || id.includes("/node_modules/@shikijs/")) && !id.includes("/@shikijs/langs/") && !id.includes("/@shikijs/themes/"))
            return "shiki";
          return void 0;
        }
      }
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? "dev"),
    __APP_SHA__: JSON.stringify(process.env.APP_SHA ?? "dev"),
    __APP_BUILT_AT__: JSON.stringify(process.env.APP_BUILT_AT ?? "dev")
  },
  plugins: [
    react(),
    tailwindcss(),
    dbDumpReceiver(),
    oauthDevRoutes(),
    VitePWA({
      // 'prompt' keeps the generated sw.js waiting until it receives SKIP_WAITING.
      // injectRegister: false because src/sw/register.ts owns registration: the
      // plugin's registerSW reloads every tab once any tab applies an update.
      registerType: "prompt",
      injectRegister: false,
      base: process.env.VITE_BASE ?? "/",
      scope: process.env.VITE_BASE ?? "/",
      devOptions: { enabled: true },
      manifest: {
        id: "/",
        name: "Chatsundere",
        short_name: "Chatsundere",
        description: "A local-first AI companion you control end to end.",
        start_url: process.env.VITE_BASE ?? "/",
        scope: process.env.VITE_BASE ?? "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#050210",
        theme_color: "#050210",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}"],
        // The main chunk crossed workbox's 2 MiB precache default (master sat
        // <1 kB under it). The app shell MUST be precached for offline, so the
        // limit is raised; the real cure is code-splitting the main chunk —
        // tracked in obsidian/insights/follow-ups-index.md.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: "/index.html",
        // Every same-origin path that is NOT part of this SPA must be listed
        // here, or the SW's navigate-fallback shadows it with our index.html.
        // `/model/` serves the self-hosted embedding weights (config/tokenizer
        // JSON + the int8 ONNX). Without this denylist entry the SW's
        // navigate-fallback shadows those asset requests with index.html, so
        // transformers.js receives HTML and every backend fails with
        // "Unexpected token '<'… No backend available" (Chunk A device test).
        // `/admin/` is the separately-built admin-client, baked into the same
        // image and served same-origin so it can read the user-client's
        // IndexedDB account (see apps/user-client/Dockerfile step 5). Without
        // it, navigating to /admin/ renders the user-client shell — the admin
        // never mounts and the page shows only our background.
        // `/oauth/` holds the standalone callback page and the client metadata
        // document; the shell would answer them without their headers and with
        // Google Fonts attached, on a URL whose query carries a one-time code.
        navigateFallbackDenylist: [
          /^\/auth\/v1\//,
          /^\/api\//,
          /^\/model\//,
          /^\/admin\//,
          /^\/oauth\//
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "fonts",
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 }
            }
          },
          {
            // Belt-and-braces: never cache API responses even if they slip through.
            // Covers /api/v1/ (current canonical prefix), /auth/v1/ (legacy),
            // and /api/auth/ (legacy variant). In dev mode with VitePWA's
            // devOptions enabled, an unmatched cross-origin request to the
            // auth-service was being dropped by Workbox instead of falling
            // through to the network — this catches every /api/ shape.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/v1/"),
            handler: "NetworkOnly"
          }
        ]
      }
    })
  ],
  server: {
    port: 3e3,
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
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    },
    // Dev-only same-origin shim: forward /admin/* to the admin-client dev
    // server so the shared-IndexedDB design (spec §6.1.1) works without a
    // reverse proxy in development. In production Traefik does this; here
    // Vite's proxy stands in for it.
    proxy: {
      "/admin": {
        target: "http://localhost:5174",
        changeOrigin: false,
        ws: true
      }
    }
  },
  // `vite preview` (serving the production build locally) gets the same isolation
  // headers so the multi-threaded WASM path can be tested against a real build.
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    }
  },
  resolve: {
    alias: {
      // Resolve @chatsundere/llm-unified to its TypeScript source rather than
      // the built dist/, so curation/adapter changes are live in the dev server
      // without a manual `pnpm --filter @chatsundere/llm-unified build`. Vite
      // resolves the package's `.js`-extension imports to their `.ts` siblings,
      // so the NodeNext-style source works under the bundler.
      "@chatsundere/llm-unified": fileURLToPath(
        new URL("../../packages/llm-unified/src/index.ts", __vite_injected_original_import_meta_url)
      ),
      // Same reasoning for @chatsundere/ui-shared: resolve to TypeScript source
      // rather than dist/. The package's `exports` points at dist/index.js, but
      // a `pnpm build`/`typecheck` runs ui-shared's `rm -rf dist && tsc`, which
      // briefly deletes that file out from under a running dev server (Vite then
      // logs "Failed to load url …/ui-shared/dist/index.js"). Consuming the
      // source removes the dist dependency and gives live HMR on shared edits.
      "@chatsundere/ui-shared": fileURLToPath(
        new URL("../../packages/ui-shared/src/index.ts", __vite_injected_original_import_meta_url)
      )
    }
  },
  // `@huggingface/transformers` must NOT be pre-bundled: the dep optimiser
  // mangles its `new URL('ort-wasm-…', import.meta.url)` asset references, so
  // onnxruntime-web cannot locate its WASM factory and every backend fails with
  // "Unexpected token '<'… No backend available" (the SPA fallback HTML). The
  // embeddings package's own dev server excludes it for the same reason.
  optimizeDeps: { exclude: ["qr-scanner/qr-scanner-worker.min.js", "@huggingface/transformers"] },
  // The embedding engine runs as an ES-module Web Worker.
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    css: false,
    include: ["tests/**/*.test.{ts,tsx}"]
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAic3JjL21jcC9vYXV0aC9jbGllbnQtbWV0YWRhdGEudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL2NoYXRzdW5kZXJlL2FwcHMvdXNlci1jbGllbnRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL3VzZXIvY2hhdHN1bmRlcmUvYXBwcy91c2VyLWNsaWVudC92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS91c2VyL2NoYXRzdW5kZXJlL2FwcHMvdXNlci1jbGllbnQvdml0ZS5jb25maWcudHNcIjsvLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQUdQTC0zLjAtb25seVxuaW1wb3J0IGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5pbXBvcnQgdGFpbHdpbmRjc3MgZnJvbSAnQHRhaWx3aW5kY3NzL3ZpdGUnO1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcbmltcG9ydCB7IHR5cGUgUGx1Z2luLCBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IFZpdGVQV0EgfSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xuaW1wb3J0IHsgYnVpbGRDbGllbnRNZXRhZGF0YSB9IGZyb20gJy4vc3JjL21jcC9vYXV0aC9jbGllbnQtbWV0YWRhdGEnO1xuXG4vKipcbiAqIERldi1vbmx5IFBPU1QgL19fZHVtcC1kYiBlbmRwb2ludC4gVGhlIERldkR1bXBCdXR0b24gaW4gdGhlIHVzZXItY2xpZW50XG4gKiBjb2xsZWN0cyBldmVyeSBEZXhpZSB0YWJsZSBpbnRvIGEgSlNPTiBwYXlsb2FkIGFuZCBQT1NUcyBpdCBoZXJlOyB0aGlzXG4gKiBwbHVnaW4gd3JpdGVzIHRoZSBwYXlsb2FkIHRvIDxyZXBvLXJvb3Q+L2R1bXBzL2RiLTx0aW1lc3RhbXA+Lmpzb24gc28gYVxuICogZGVidWdnZXIgKGh1bWFuIG9yIG90aGVyd2lzZSkgY2FuIGluc3BlY3QgSW5kZXhlZERCIHN0YXRlIGZyb20gZGlzay5cbiAqXG4gKiBgYXBwbHk6ICdzZXJ2ZSdgIGtlZXBzIHRoaXMgZW50aXJlbHkgb3V0IG9mIHByb2R1Y3Rpb24gYnVpbGRzLlxuICovXG5mdW5jdGlvbiBkYkR1bXBSZWNlaXZlcigpOiBQbHVnaW4ge1xuICByZXR1cm4ge1xuICAgIG5hbWU6ICdjaGF0c3VuZGVyZS1kYi1kdW1wLXJlY2VpdmVyJyxcbiAgICBhcHBseTogJ3NlcnZlJyxcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKCcvX19kdW1wLWRiJywgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgICAgIGlmIChyZXEubWV0aG9kICE9PSAnUE9TVCcpIHtcbiAgICAgICAgICBuZXh0KCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGNodW5rczogQnVmZmVyW10gPSBbXTtcbiAgICAgICAgcmVxLm9uKCdkYXRhJywgKGNodW5rOiBCdWZmZXIpID0+IGNodW5rcy5wdXNoKGNodW5rKSk7XG4gICAgICAgIHJlcS5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBib2R5ID0gQnVmZmVyLmNvbmNhdChjaHVua3MpLnRvU3RyaW5nKCd1dGYtOCcpO1xuICAgICAgICAgICAgLy8gdml0ZSBkZXYgcnVucyBmcm9tIGFwcHMvdXNlci1jbGllbnQvLCBzbyBzdGVwIHR3byBsZXZlbHMgdXAuXG4gICAgICAgICAgICBjb25zdCBkdW1wRGlyID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICcuLi8uLi9kdW1wcycpO1xuICAgICAgICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKGR1bXBEaXIpKSBmcy5ta2RpclN5bmMoZHVtcERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICBjb25zdCB0cyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5yZXBsYWNlKC9bOi5dL2csICctJyk7XG4gICAgICAgICAgICBjb25zdCBmaWxlID0gcGF0aC5qb2luKGR1bXBEaXIsIGBkYi0ke3RzfS5qc29uYCk7XG4gICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKGZpbGUsIGJvZHkpO1xuICAgICAgICAgICAgY29uc3QgcmVsRmlsZSA9IHBhdGgucmVsYXRpdmUocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICcuLi8uLicpLCBmaWxlKTtcbiAgICAgICAgICAgIHJlcy5zdGF0dXNDb2RlID0gMjAwO1xuICAgICAgICAgICAgcmVzLnNldEhlYWRlcignY29udGVudC10eXBlJywgJ2FwcGxpY2F0aW9uL2pzb24nKTtcbiAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBvazogdHJ1ZSwgZmlsZTogcmVsRmlsZSB9KSk7XG4gICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcmVzLnN0YXR1c0NvZGUgPSA1MDA7XG4gICAgICAgICAgICByZXMuc2V0SGVhZGVyKCdjb250ZW50LXR5cGUnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgICAgICAgcmVzLmVuZChcbiAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoeyBvazogZmFsc2UsIGVycm9yOiBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSkgfSksXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJlcS5vbignZXJyb3InLCAoKSA9PiB7XG4gICAgICAgICAgcmVzLnN0YXR1c0NvZGUgPSA1MDA7XG4gICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IG9rOiBmYWxzZSwgZXJyb3I6ICdyZXF1ZXN0IHN0cmVhbSBlcnJvcicgfSkpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogRGV2IHN0YW5kLWlucyBmb3Igd2hhdCBuZ2lueCBkb2VzIGluIHByb2R1Y3Rpb246IHRoZSBPQXV0aCBjbGllbnQgbWV0YWRhdGFcbiAqIGRvY3VtZW50IGFuZCB0aGUgc3RhbmRhbG9uZSBjYWxsYmFjayBwYWdlLiBgYXBwbHk6ICdzZXJ2ZSdgIGtlZXBzIGl0IG91dCBvZlxuICogYnVpbGRzICh0aGUgcGFnZSBpdHNlbGYgaXMgYSBzZWNvbmQgcm9sbHVwIGlucHV0KS5cbiAqL1xuZnVuY3Rpb24gb2F1dGhEZXZSb3V0ZXMoKTogUGx1Z2luIHtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiAnY2hhdHN1bmRlcmUtb2F1dGgtZGV2LXJvdXRlcycsXG4gICAgYXBwbHk6ICdzZXJ2ZScsXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShhc3luYyAocmVxLCByZXMsIG5leHQpID0+IHtcbiAgICAgICAgY29uc3QgcGF0aG5hbWUgPSAocmVxLnVybCA/PyAnJykuc3BsaXQoJz8nKVswXTtcbiAgICAgICAgaWYgKHBhdGhuYW1lID09PSAnL29hdXRoL2NsaWVudC1tZXRhZGF0YS5qc29uJykge1xuICAgICAgICAgIGNvbnN0IGhvc3QgPSByZXEuaGVhZGVycy5ob3N0ID8/ICcnO1xuICAgICAgICAgIC8vIFNhbWUgYWxsb3ctbGlzdCBhcyBuZ2lueDogdGhlIGhvc3QgaXMgZW1iZWRkZWQgaW4gSlNPTi5cbiAgICAgICAgICBpZiAoIS9eW0EtWmEtejAtOS4tXSsoOlswLTldKyk/JC8udGVzdChob3N0KSkge1xuICAgICAgICAgICAgcmVzLnN0YXR1c0NvZGUgPSA0MDA7XG4gICAgICAgICAgICByZXMuZW5kKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHByb3RvID0gcmVxLmhlYWRlcnNbJ3gtZm9yd2FyZGVkLXByb3RvJ10gPT09ICdodHRwcycgPyAnaHR0cHMnIDogJ2h0dHAnO1xuICAgICAgICAgIHJlcy5zZXRIZWFkZXIoJ2NvbnRlbnQtdHlwZScsICdhcHBsaWNhdGlvbi9qc29uJyk7XG4gICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeShidWlsZENsaWVudE1ldGFkYXRhKGAke3Byb3RvfTovLyR7aG9zdH1gKSkpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGF0aG5hbWUgPT09ICcvb2F1dGgvY2FsbGJhY2snKSB7XG4gICAgICAgICAgY29uc3QgZmlsZSA9IHBhdGgucmVzb2x2ZShzZXJ2ZXIuY29uZmlnLnJvb3QsICdvYXV0aC1jYWxsYmFjay5odG1sJyk7XG4gICAgICAgICAgY29uc3QgaHRtbCA9IGF3YWl0IHNlcnZlci50cmFuc2Zvcm1JbmRleEh0bWwoXG4gICAgICAgICAgICAnL29hdXRoL2NhbGxiYWNrJyxcbiAgICAgICAgICAgIGZzLnJlYWRGaWxlU3luYyhmaWxlLCAndXRmLTgnKSxcbiAgICAgICAgICApO1xuICAgICAgICAgIHJlcy5zZXRIZWFkZXIoJ2NvbnRlbnQtdHlwZScsICd0ZXh0L2h0bWw7IGNoYXJzZXQ9dXRmLTgnKTtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKCdyZWZlcnJlci1wb2xpY3knLCAnbm8tcmVmZXJyZXInKTtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKCdjYWNoZS1jb250cm9sJywgJ25vLXN0b3JlJyk7XG4gICAgICAgICAgcmVzLmVuZChodG1sKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgbmV4dCgpO1xuICAgICAgfSk7XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYmFzZTogcHJvY2Vzcy5lbnYuVklURV9CQVNFID8/ICcvJyxcbiAgYnVpbGQ6IHtcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBpbnB1dDogeyBtYWluOiAnaW5kZXguaHRtbCcsICdvYXV0aC1jYWxsYmFjayc6ICdvYXV0aC1jYWxsYmFjay5odG1sJyB9LFxuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIC8vIFNwbGl0IHRoZSBoZWF2eXdlaWdodCwgZWFnZXJseS1pbXBvcnRlZCB2ZW5kb3JzIChrYXRleCwgc2hpa2kgY29yZSlcbiAgICAgICAgLy8gaW50byB0aGVpciBvd24gY2h1bmtzIHNvIHRoZSBhcHAtc2hlbGwgaW5kZXggY2h1bmsgc3RheXMgdW5kZXJcbiAgICAgICAgLy8gd29ya2JveCdzIHByZWNhY2hlIGNhcCAob2JzaWRpYW4vaW5zaWdodHMvZm9sbG93LXVwcy1pbmRleC5tZCBcdTIwMTRcbiAgICAgICAgLy8gbWFpbi1jaHVuayBjb2RlLXNwbGl0KS4gbWVybWFpZCBpcyBhbHJlYWR5IGR5bmFtaWNhbGx5IGltcG9ydGVkXG4gICAgICAgIC8vIChNZXJtYWlkQmxvY2spLiBGb3Igc2hpa2ksIG1hdGNoIGNvcmUgKyBlbmdpbmVzIGJ1dCBOT1RcbiAgICAgICAgLy8gQHNoaWtpanMvbGFuZ3MgLyBAc2hpa2lqcy90aGVtZXM6IHRob3NlIGdyYW1tYXIvdGhlbWUgbW9kdWxlcyBhcmVcbiAgICAgICAgLy8gbG9hZGVkIG9uIGRlbWFuZCBhbmQgYWxyZWFkeSBlbWl0IHRoZWlyIG93biBsYXp5IGNodW5rcyBcdTIwMTQgZm9yY2luZ1xuICAgICAgICAvLyB0aGVtIGludG8gdGhlIHNoaWtpIGNodW5rIGhlcmUgd291bGQgY29sbGFwc2UgfjIwMCBsYXp5IGdyYW1tYXJzXG4gICAgICAgIC8vIGludG8gb25lIGVhZ2VyIGJsb2IsIGRlZmVhdGluZyB0aGUgc3BsaXQuXG4gICAgICAgIG1hbnVhbENodW5rcyhpZCkge1xuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL2thdGV4JykpIHJldHVybiAna2F0ZXgnO1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIChpZC5pbmNsdWRlcygnL25vZGVfbW9kdWxlcy9zaGlraS8nKSB8fCBpZC5pbmNsdWRlcygnL25vZGVfbW9kdWxlcy9Ac2hpa2lqcy8nKSkgJiZcbiAgICAgICAgICAgICFpZC5pbmNsdWRlcygnL0BzaGlraWpzL2xhbmdzLycpICYmXG4gICAgICAgICAgICAhaWQuaW5jbHVkZXMoJy9Ac2hpa2lqcy90aGVtZXMvJylcbiAgICAgICAgICApXG4gICAgICAgICAgICByZXR1cm4gJ3NoaWtpJztcbiAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBkZWZpbmU6IHtcbiAgICBfX0FQUF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KHByb2Nlc3MuZW52LkFQUF9WRVJTSU9OID8/ICdkZXYnKSxcbiAgICBfX0FQUF9TSEFfXzogSlNPTi5zdHJpbmdpZnkocHJvY2Vzcy5lbnYuQVBQX1NIQSA/PyAnZGV2JyksXG4gICAgX19BUFBfQlVJTFRfQVRfXzogSlNPTi5zdHJpbmdpZnkocHJvY2Vzcy5lbnYuQVBQX0JVSUxUX0FUID8/ICdkZXYnKSxcbiAgfSxcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgdGFpbHdpbmRjc3MoKSxcbiAgICBkYkR1bXBSZWNlaXZlcigpLFxuICAgIG9hdXRoRGV2Um91dGVzKCksXG4gICAgVml0ZVBXQSh7XG4gICAgICAvLyAncHJvbXB0JyBrZWVwcyB0aGUgZ2VuZXJhdGVkIHN3LmpzIHdhaXRpbmcgdW50aWwgaXQgcmVjZWl2ZXMgU0tJUF9XQUlUSU5HLlxuICAgICAgLy8gaW5qZWN0UmVnaXN0ZXI6IGZhbHNlIGJlY2F1c2Ugc3JjL3N3L3JlZ2lzdGVyLnRzIG93bnMgcmVnaXN0cmF0aW9uOiB0aGVcbiAgICAgIC8vIHBsdWdpbidzIHJlZ2lzdGVyU1cgcmVsb2FkcyBldmVyeSB0YWIgb25jZSBhbnkgdGFiIGFwcGxpZXMgYW4gdXBkYXRlLlxuICAgICAgcmVnaXN0ZXJUeXBlOiAncHJvbXB0JyxcbiAgICAgIGluamVjdFJlZ2lzdGVyOiBmYWxzZSxcbiAgICAgIGJhc2U6IHByb2Nlc3MuZW52LlZJVEVfQkFTRSA/PyAnLycsXG4gICAgICBzY29wZTogcHJvY2Vzcy5lbnYuVklURV9CQVNFID8/ICcvJyxcbiAgICAgIGRldk9wdGlvbnM6IHsgZW5hYmxlZDogdHJ1ZSB9LFxuICAgICAgbWFuaWZlc3Q6IHtcbiAgICAgICAgaWQ6ICcvJyxcbiAgICAgICAgbmFtZTogJ0NoYXRzdW5kZXJlJyxcbiAgICAgICAgc2hvcnRfbmFtZTogJ0NoYXRzdW5kZXJlJyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdBIGxvY2FsLWZpcnN0IEFJIGNvbXBhbmlvbiB5b3UgY29udHJvbCBlbmQgdG8gZW5kLicsXG4gICAgICAgIHN0YXJ0X3VybDogcHJvY2Vzcy5lbnYuVklURV9CQVNFID8/ICcvJyxcbiAgICAgICAgc2NvcGU6IHByb2Nlc3MuZW52LlZJVEVfQkFTRSA/PyAnLycsXG4gICAgICAgIGRpc3BsYXk6ICdzdGFuZGFsb25lJyxcbiAgICAgICAgb3JpZW50YXRpb246ICdwb3J0cmFpdCcsXG4gICAgICAgIGJhY2tncm91bmRfY29sb3I6ICcjMDUwMjEwJyxcbiAgICAgICAgdGhlbWVfY29sb3I6ICcjMDUwMjEwJyxcbiAgICAgICAgaWNvbnM6IFtcbiAgICAgICAgICB7IHNyYzogJy9pY29ucy9pY29uLTE5Mi5wbmcnLCBzaXplczogJzE5MngxOTInLCB0eXBlOiAnaW1hZ2UvcG5nJyB9LFxuICAgICAgICAgIHsgc3JjOiAnL2ljb25zL2ljb24tNTEyLnBuZycsIHNpemVzOiAnNTEyeDUxMicsIHR5cGU6ICdpbWFnZS9wbmcnIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3JjOiAnL2ljb25zL2ljb24tbWFza2FibGUtNTEyLnBuZycsXG4gICAgICAgICAgICBzaXplczogJzUxMng1MTInLFxuICAgICAgICAgICAgdHlwZTogJ2ltYWdlL3BuZycsXG4gICAgICAgICAgICBwdXJwb3NlOiAnbWFza2FibGUnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgd29ya2JveDoge1xuICAgICAgICBnbG9iUGF0dGVybnM6IFsnKiovKi57anMsY3NzLGh0bWwsaWNvLHN2Zyx3b2ZmMn0nXSxcbiAgICAgICAgLy8gVGhlIG1haW4gY2h1bmsgY3Jvc3NlZCB3b3JrYm94J3MgMiBNaUIgcHJlY2FjaGUgZGVmYXVsdCAobWFzdGVyIHNhdFxuICAgICAgICAvLyA8MSBrQiB1bmRlciBpdCkuIFRoZSBhcHAgc2hlbGwgTVVTVCBiZSBwcmVjYWNoZWQgZm9yIG9mZmxpbmUsIHNvIHRoZVxuICAgICAgICAvLyBsaW1pdCBpcyByYWlzZWQ7IHRoZSByZWFsIGN1cmUgaXMgY29kZS1zcGxpdHRpbmcgdGhlIG1haW4gY2h1bmsgXHUyMDE0XG4gICAgICAgIC8vIHRyYWNrZWQgaW4gb2JzaWRpYW4vaW5zaWdodHMvZm9sbG93LXVwcy1pbmRleC5tZC5cbiAgICAgICAgbWF4aW11bUZpbGVTaXplVG9DYWNoZUluQnl0ZXM6IDMgKiAxMDI0ICogMTAyNCxcbiAgICAgICAgbmF2aWdhdGVGYWxsYmFjazogJy9pbmRleC5odG1sJyxcbiAgICAgICAgLy8gRXZlcnkgc2FtZS1vcmlnaW4gcGF0aCB0aGF0IGlzIE5PVCBwYXJ0IG9mIHRoaXMgU1BBIG11c3QgYmUgbGlzdGVkXG4gICAgICAgIC8vIGhlcmUsIG9yIHRoZSBTVydzIG5hdmlnYXRlLWZhbGxiYWNrIHNoYWRvd3MgaXQgd2l0aCBvdXIgaW5kZXguaHRtbC5cbiAgICAgICAgLy8gYC9tb2RlbC9gIHNlcnZlcyB0aGUgc2VsZi1ob3N0ZWQgZW1iZWRkaW5nIHdlaWdodHMgKGNvbmZpZy90b2tlbml6ZXJcbiAgICAgICAgLy8gSlNPTiArIHRoZSBpbnQ4IE9OTlgpLiBXaXRob3V0IHRoaXMgZGVueWxpc3QgZW50cnkgdGhlIFNXJ3NcbiAgICAgICAgLy8gbmF2aWdhdGUtZmFsbGJhY2sgc2hhZG93cyB0aG9zZSBhc3NldCByZXF1ZXN0cyB3aXRoIGluZGV4Lmh0bWwsIHNvXG4gICAgICAgIC8vIHRyYW5zZm9ybWVycy5qcyByZWNlaXZlcyBIVE1MIGFuZCBldmVyeSBiYWNrZW5kIGZhaWxzIHdpdGhcbiAgICAgICAgLy8gXCJVbmV4cGVjdGVkIHRva2VuICc8J1x1MjAyNiBObyBiYWNrZW5kIGF2YWlsYWJsZVwiIChDaHVuayBBIGRldmljZSB0ZXN0KS5cbiAgICAgICAgLy8gYC9hZG1pbi9gIGlzIHRoZSBzZXBhcmF0ZWx5LWJ1aWx0IGFkbWluLWNsaWVudCwgYmFrZWQgaW50byB0aGUgc2FtZVxuICAgICAgICAvLyBpbWFnZSBhbmQgc2VydmVkIHNhbWUtb3JpZ2luIHNvIGl0IGNhbiByZWFkIHRoZSB1c2VyLWNsaWVudCdzXG4gICAgICAgIC8vIEluZGV4ZWREQiBhY2NvdW50IChzZWUgYXBwcy91c2VyLWNsaWVudC9Eb2NrZXJmaWxlIHN0ZXAgNSkuIFdpdGhvdXRcbiAgICAgICAgLy8gaXQsIG5hdmlnYXRpbmcgdG8gL2FkbWluLyByZW5kZXJzIHRoZSB1c2VyLWNsaWVudCBzaGVsbCBcdTIwMTQgdGhlIGFkbWluXG4gICAgICAgIC8vIG5ldmVyIG1vdW50cyBhbmQgdGhlIHBhZ2Ugc2hvd3Mgb25seSBvdXIgYmFja2dyb3VuZC5cbiAgICAgICAgLy8gYC9vYXV0aC9gIGhvbGRzIHRoZSBzdGFuZGFsb25lIGNhbGxiYWNrIHBhZ2UgYW5kIHRoZSBjbGllbnQgbWV0YWRhdGFcbiAgICAgICAgLy8gZG9jdW1lbnQ7IHRoZSBzaGVsbCB3b3VsZCBhbnN3ZXIgdGhlbSB3aXRob3V0IHRoZWlyIGhlYWRlcnMgYW5kIHdpdGhcbiAgICAgICAgLy8gR29vZ2xlIEZvbnRzIGF0dGFjaGVkLCBvbiBhIFVSTCB3aG9zZSBxdWVyeSBjYXJyaWVzIGEgb25lLXRpbWUgY29kZS5cbiAgICAgICAgbmF2aWdhdGVGYWxsYmFja0RlbnlsaXN0OiBbXG4gICAgICAgICAgL15cXC9hdXRoXFwvdjFcXC8vLFxuICAgICAgICAgIC9eXFwvYXBpXFwvLyxcbiAgICAgICAgICAvXlxcL21vZGVsXFwvLyxcbiAgICAgICAgICAvXlxcL2FkbWluXFwvLyxcbiAgICAgICAgICAvXlxcL29hdXRoXFwvLyxcbiAgICAgICAgXSxcbiAgICAgICAgcnVudGltZUNhY2hpbmc6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICB1cmxQYXR0ZXJuOiAoeyB1cmwgfSkgPT5cbiAgICAgICAgICAgICAgdXJsLm9yaWdpbiA9PT0gJ2h0dHBzOi8vZm9udHMuZ29vZ2xlYXBpcy5jb20nIHx8XG4gICAgICAgICAgICAgIHVybC5vcmlnaW4gPT09ICdodHRwczovL2ZvbnRzLmdzdGF0aWMuY29tJyxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdDYWNoZUZpcnN0JyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiAnZm9udHMnLFxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDgsIG1heEFnZVNlY29uZHM6IDYwICogNjAgKiAyNCAqIDkwIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgLy8gQmVsdC1hbmQtYnJhY2VzOiBuZXZlciBjYWNoZSBBUEkgcmVzcG9uc2VzIGV2ZW4gaWYgdGhleSBzbGlwIHRocm91Z2guXG4gICAgICAgICAgICAvLyBDb3ZlcnMgL2FwaS92MS8gKGN1cnJlbnQgY2Fub25pY2FsIHByZWZpeCksIC9hdXRoL3YxLyAobGVnYWN5KSxcbiAgICAgICAgICAgIC8vIGFuZCAvYXBpL2F1dGgvIChsZWdhY3kgdmFyaWFudCkuIEluIGRldiBtb2RlIHdpdGggVml0ZVBXQSdzXG4gICAgICAgICAgICAvLyBkZXZPcHRpb25zIGVuYWJsZWQsIGFuIHVubWF0Y2hlZCBjcm9zcy1vcmlnaW4gcmVxdWVzdCB0byB0aGVcbiAgICAgICAgICAgIC8vIGF1dGgtc2VydmljZSB3YXMgYmVpbmcgZHJvcHBlZCBieSBXb3JrYm94IGluc3RlYWQgb2YgZmFsbGluZ1xuICAgICAgICAgICAgLy8gdGhyb3VnaCB0byB0aGUgbmV0d29yayBcdTIwMTQgdGhpcyBjYXRjaGVzIGV2ZXJ5IC9hcGkvIHNoYXBlLlxuICAgICAgICAgICAgdXJsUGF0dGVybjogKHsgdXJsIH0pID0+XG4gICAgICAgICAgICAgIHVybC5wYXRobmFtZS5zdGFydHNXaXRoKCcvYXBpLycpIHx8IHVybC5wYXRobmFtZS5zdGFydHNXaXRoKCcvYXV0aC92MS8nKSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdOZXR3b3JrT25seScsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSksXG4gIF0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDMwMDAsXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcbiAgICAvLyBDcm9zcy1vcmlnaW4gaXNvbGF0aW9uIChTdHVmZSBBIFx1MjAxNCBkZXYpLiBDT09QK0NPRVAgbWFrZSB0aGUgcGFnZVxuICAgIC8vIGNyb3NzT3JpZ2luSXNvbGF0ZWQsIHdoaWNoIGV4cG9zZXMgU2hhcmVkQXJyYXlCdWZmZXIgXHUyMTkyIHRoZSBlbWJlZGRpbmdcbiAgICAvLyBlbmdpbmUncyBXQVNNIGJhY2tlbmQgY2FuIHJ1biBtdWx0aS10aHJlYWRlZCAob3RoZXJ3aXNlIGl0IGlzIHBpbm5lZCB0byBhXG4gICAgLy8gc2luZ2xlIHRocmVhZCkuIE9ubHkgbWF0dGVycyBvbiBzZXR1cHMgd2l0aG91dCByZWFsIFdlYkdQVSAoc29mdHdhcmUgR1BVIC9cbiAgICAvLyBubyBzaGFkZXItZjE2KSwgd2hpY2ggZmFsbCBiYWNrIHRvIFdBU00uIGBjcmVkZW50aWFsbGVzc2AgaXMgdXNlZCBpbnN0ZWFkXG4gICAgLy8gb2YgYHJlcXVpcmUtY29ycGAgc28gY3Jvc3Mtb3JpZ2luIG5vLWNvcnMgc3VicmVzb3VyY2VzIChlLmcuIHRoZSBWQUQgQ0ROXG4gICAgLy8gYXNzZXRzIG9uIGpzZGVsaXZyKSBrZWVwIGxvYWRpbmcgd2l0aG91dCBuZWVkaW5nIENPUlAgaGVhZGVyczsgdGhlXG4gICAgLy8gZW1iZWRkaW5nIE9SVCBXQVNNIGlzIHNhbWUtb3JpZ2luIChyZXNvbHZlZCB2aWEgaW1wb3J0Lm1ldGEudXJsKSwgc28gaXQgaXNcbiAgICAvLyB1bmFmZmVjdGVkIGVpdGhlciB3YXkuIFByb2R1Y3Rpb24gaXNvbGF0aW9uIChHaXRIdWIgUGFnZXMsIFNhZmFyaSkgaXNcbiAgICAvLyBTdHVmZSBCIHZpYSB0aGUgc2VydmljZSB3b3JrZXIuXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0Nyb3NzLU9yaWdpbi1PcGVuZXItUG9saWN5JzogJ3NhbWUtb3JpZ2luJyxcbiAgICAgICdDcm9zcy1PcmlnaW4tRW1iZWRkZXItUG9saWN5JzogJ2NyZWRlbnRpYWxsZXNzJyxcbiAgICB9LFxuICAgIC8vIERldi1vbmx5IHNhbWUtb3JpZ2luIHNoaW06IGZvcndhcmQgL2FkbWluLyogdG8gdGhlIGFkbWluLWNsaWVudCBkZXZcbiAgICAvLyBzZXJ2ZXIgc28gdGhlIHNoYXJlZC1JbmRleGVkREIgZGVzaWduIChzcGVjIFx1MDBBNzYuMS4xKSB3b3JrcyB3aXRob3V0IGFcbiAgICAvLyByZXZlcnNlIHByb3h5IGluIGRldmVsb3BtZW50LiBJbiBwcm9kdWN0aW9uIFRyYWVmaWsgZG9lcyB0aGlzOyBoZXJlXG4gICAgLy8gVml0ZSdzIHByb3h5IHN0YW5kcyBpbiBmb3IgaXQuXG4gICAgcHJveHk6IHtcbiAgICAgICcvYWRtaW4nOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3NCcsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogZmFsc2UsXG4gICAgICAgIHdzOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICAvLyBgdml0ZSBwcmV2aWV3YCAoc2VydmluZyB0aGUgcHJvZHVjdGlvbiBidWlsZCBsb2NhbGx5KSBnZXRzIHRoZSBzYW1lIGlzb2xhdGlvblxuICAvLyBoZWFkZXJzIHNvIHRoZSBtdWx0aS10aHJlYWRlZCBXQVNNIHBhdGggY2FuIGJlIHRlc3RlZCBhZ2FpbnN0IGEgcmVhbCBidWlsZC5cbiAgcHJldmlldzoge1xuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDcm9zcy1PcmlnaW4tT3BlbmVyLVBvbGljeSc6ICdzYW1lLW9yaWdpbicsXG4gICAgICAnQ3Jvc3MtT3JpZ2luLUVtYmVkZGVyLVBvbGljeSc6ICdjcmVkZW50aWFsbGVzcycsXG4gICAgfSxcbiAgfSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAvLyBSZXNvbHZlIEBjaGF0c3VuZGVyZS9sbG0tdW5pZmllZCB0byBpdHMgVHlwZVNjcmlwdCBzb3VyY2UgcmF0aGVyIHRoYW5cbiAgICAgIC8vIHRoZSBidWlsdCBkaXN0Lywgc28gY3VyYXRpb24vYWRhcHRlciBjaGFuZ2VzIGFyZSBsaXZlIGluIHRoZSBkZXYgc2VydmVyXG4gICAgICAvLyB3aXRob3V0IGEgbWFudWFsIGBwbnBtIC0tZmlsdGVyIEBjaGF0c3VuZGVyZS9sbG0tdW5pZmllZCBidWlsZGAuIFZpdGVcbiAgICAgIC8vIHJlc29sdmVzIHRoZSBwYWNrYWdlJ3MgYC5qc2AtZXh0ZW5zaW9uIGltcG9ydHMgdG8gdGhlaXIgYC50c2Agc2libGluZ3MsXG4gICAgICAvLyBzbyB0aGUgTm9kZU5leHQtc3R5bGUgc291cmNlIHdvcmtzIHVuZGVyIHRoZSBidW5kbGVyLlxuICAgICAgJ0BjaGF0c3VuZGVyZS9sbG0tdW5pZmllZCc6IGZpbGVVUkxUb1BhdGgoXG4gICAgICAgIG5ldyBVUkwoJy4uLy4uL3BhY2thZ2VzL2xsbS11bmlmaWVkL3NyYy9pbmRleC50cycsIGltcG9ydC5tZXRhLnVybCksXG4gICAgICApLFxuICAgICAgLy8gU2FtZSByZWFzb25pbmcgZm9yIEBjaGF0c3VuZGVyZS91aS1zaGFyZWQ6IHJlc29sdmUgdG8gVHlwZVNjcmlwdCBzb3VyY2VcbiAgICAgIC8vIHJhdGhlciB0aGFuIGRpc3QvLiBUaGUgcGFja2FnZSdzIGBleHBvcnRzYCBwb2ludHMgYXQgZGlzdC9pbmRleC5qcywgYnV0XG4gICAgICAvLyBhIGBwbnBtIGJ1aWxkYC9gdHlwZWNoZWNrYCBydW5zIHVpLXNoYXJlZCdzIGBybSAtcmYgZGlzdCAmJiB0c2NgLCB3aGljaFxuICAgICAgLy8gYnJpZWZseSBkZWxldGVzIHRoYXQgZmlsZSBvdXQgZnJvbSB1bmRlciBhIHJ1bm5pbmcgZGV2IHNlcnZlciAoVml0ZSB0aGVuXG4gICAgICAvLyBsb2dzIFwiRmFpbGVkIHRvIGxvYWQgdXJsIFx1MjAyNi91aS1zaGFyZWQvZGlzdC9pbmRleC5qc1wiKS4gQ29uc3VtaW5nIHRoZVxuICAgICAgLy8gc291cmNlIHJlbW92ZXMgdGhlIGRpc3QgZGVwZW5kZW5jeSBhbmQgZ2l2ZXMgbGl2ZSBITVIgb24gc2hhcmVkIGVkaXRzLlxuICAgICAgJ0BjaGF0c3VuZGVyZS91aS1zaGFyZWQnOiBmaWxlVVJMVG9QYXRoKFxuICAgICAgICBuZXcgVVJMKCcuLi8uLi9wYWNrYWdlcy91aS1zaGFyZWQvc3JjL2luZGV4LnRzJywgaW1wb3J0Lm1ldGEudXJsKSxcbiAgICAgICksXG4gICAgfSxcbiAgfSxcbiAgLy8gYEBodWdnaW5nZmFjZS90cmFuc2Zvcm1lcnNgIG11c3QgTk9UIGJlIHByZS1idW5kbGVkOiB0aGUgZGVwIG9wdGltaXNlclxuICAvLyBtYW5nbGVzIGl0cyBgbmV3IFVSTCgnb3J0LXdhc20tXHUyMDI2JywgaW1wb3J0Lm1ldGEudXJsKWAgYXNzZXQgcmVmZXJlbmNlcywgc29cbiAgLy8gb25ueHJ1bnRpbWUtd2ViIGNhbm5vdCBsb2NhdGUgaXRzIFdBU00gZmFjdG9yeSBhbmQgZXZlcnkgYmFja2VuZCBmYWlscyB3aXRoXG4gIC8vIFwiVW5leHBlY3RlZCB0b2tlbiAnPCdcdTIwMjYgTm8gYmFja2VuZCBhdmFpbGFibGVcIiAodGhlIFNQQSBmYWxsYmFjayBIVE1MKS4gVGhlXG4gIC8vIGVtYmVkZGluZ3MgcGFja2FnZSdzIG93biBkZXYgc2VydmVyIGV4Y2x1ZGVzIGl0IGZvciB0aGUgc2FtZSByZWFzb24uXG4gIG9wdGltaXplRGVwczogeyBleGNsdWRlOiBbJ3FyLXNjYW5uZXIvcXItc2Nhbm5lci13b3JrZXIubWluLmpzJywgJ0BodWdnaW5nZmFjZS90cmFuc2Zvcm1lcnMnXSB9LFxuICAvLyBUaGUgZW1iZWRkaW5nIGVuZ2luZSBydW5zIGFzIGFuIEVTLW1vZHVsZSBXZWIgV29ya2VyLlxuICB3b3JrZXI6IHsgZm9ybWF0OiAnZXMnIH0sXG4gIHRlc3Q6IHtcbiAgICBlbnZpcm9ubWVudDogJ2pzZG9tJyxcbiAgICBnbG9iYWxzOiB0cnVlLFxuICAgIHNldHVwRmlsZXM6IFsnLi90ZXN0cy9zZXR1cC50cyddLFxuICAgIGNzczogZmFsc2UsXG4gICAgaW5jbHVkZTogWyd0ZXN0cy8qKi8qLnRlc3Que3RzLHRzeH0nXSxcbiAgfSxcbn0pO1xuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL2NoYXRzdW5kZXJlL2FwcHMvdXNlci1jbGllbnQvc3JjL21jcC9vYXV0aFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvdXNlci9jaGF0c3VuZGVyZS9hcHBzL3VzZXItY2xpZW50L3NyYy9tY3Avb2F1dGgvY2xpZW50LW1ldGFkYXRhLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3VzZXIvY2hhdHN1bmRlcmUvYXBwcy91c2VyLWNsaWVudC9zcmMvbWNwL29hdXRoL2NsaWVudC1tZXRhZGF0YS50c1wiOy8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBR1BMLTMuMC1vbmx5XG5cbi8qKiBUaGUgT0F1dGggQ2xpZW50IElEIE1ldGFkYXRhIERvY3VtZW50IHRoaXMgYXBwIHB1Ymxpc2hlcyBhdCBpdHMgb3duIG9yaWdpbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2xpZW50TWV0YWRhdGEge1xuICBjbGllbnRfaWQ6IHN0cmluZztcbiAgY2xpZW50X25hbWU6IHN0cmluZztcbiAgY2xpZW50X3VyaTogc3RyaW5nO1xuICByZWRpcmVjdF91cmlzOiBzdHJpbmdbXTtcbiAgZ3JhbnRfdHlwZXM6IHN0cmluZ1tdO1xuICByZXNwb25zZV90eXBlczogc3RyaW5nW107XG4gIHRva2VuX2VuZHBvaW50X2F1dGhfbWV0aG9kOiAnbm9uZSc7XG59XG5cbi8qKiBUaGUgVVJMIGEgc2VydmVyIGZldGNoZXMgdG8gbGVhcm4gYWJvdXQgdGhpcyBhcHA7IGRvdWJsZXMgYXMgdGhlIGBjbGllbnRfaWRgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsaWVudE1ldGFkYXRhVXJsKG9yaWdpbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke29yaWdpbn0vb2F1dGgvY2xpZW50LW1ldGFkYXRhLmpzb25gO1xufVxuXG4vKiogV2hlcmUgdGhlIGF1dGhvcmlzYXRpb24gc2VydmVyIHNlbmRzIHRoZSBicm93c2VyIGJhY2sgdG8uICovXG5leHBvcnQgZnVuY3Rpb24gcmVkaXJlY3RVcmkob3JpZ2luOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7b3JpZ2lufS9vYXV0aC9jYWxsYmFja2A7XG59XG5cbi8qKiBUaGUgbWV0YWRhdGEgZG9jdW1lbnQgZm9yIGFuIG9yaWdpbjsgbmdpbnggZ2VuZXJhdGVzIHRoZSBzYW1lIHNoYXBlIGZyb20gdGhlIHJlcXVlc3QgaG9zdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENsaWVudE1ldGFkYXRhKG9yaWdpbjogc3RyaW5nKTogQ2xpZW50TWV0YWRhdGEge1xuICByZXR1cm4ge1xuICAgIGNsaWVudF9pZDogY2xpZW50TWV0YWRhdGFVcmwob3JpZ2luKSxcbiAgICBjbGllbnRfbmFtZTogJ0NoYXRzdW5kZXJlJyxcbiAgICBjbGllbnRfdXJpOiBvcmlnaW4sXG4gICAgcmVkaXJlY3RfdXJpczogW3JlZGlyZWN0VXJpKG9yaWdpbildLFxuICAgIGdyYW50X3R5cGVzOiBbJ2F1dGhvcml6YXRpb25fY29kZScsICdyZWZyZXNoX3Rva2VuJ10sXG4gICAgcmVzcG9uc2VfdHlwZXM6IFsnY29kZSddLFxuICAgIHRva2VuX2VuZHBvaW50X2F1dGhfbWV0aG9kOiAnbm9uZScsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGlzUHJpdmF0ZUlwdjQoaG9zdDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IG0gPSAvXihcXGR7MSwzfSlcXC4oXFxkezEsM30pXFwuKFxcZHsxLDN9KVxcLihcXGR7MSwzfSkkLy5leGVjKGhvc3QpO1xuICBpZiAoIW0pIHJldHVybiBmYWxzZTtcbiAgY29uc3QgYSA9IE51bWJlcihtWzFdKTtcbiAgY29uc3QgYiA9IE51bWJlcihtWzJdKTtcbiAgcmV0dXJuIChcbiAgICBhID09PSAwIHx8XG4gICAgYSA9PT0gMTAgfHxcbiAgICBhID09PSAxMjcgfHxcbiAgICAoYSA9PT0gMTAwICYmIGIgPj0gNjQgJiYgYiA8PSAxMjcpIHx8XG4gICAgKGEgPT09IDE2OSAmJiBiID09PSAyNTQpIHx8XG4gICAgKGEgPT09IDE3MiAmJiBiID49IDE2ICYmIGIgPD0gMzEpIHx8XG4gICAgKGEgPT09IDE5MiAmJiBiID09PSAxNjgpXG4gICk7XG59XG5cbi8qKiBEb3R0ZWQgZm9ybSBvZiBhbiBJUHY0LW1hcHBlZCBJUHY2IHRhaWwgKGA6OmZmZmY6YS5iLmMuZGAgb3IgYDo6ZmZmZjpoaGhoOmhoaGhgKSwgZWxzZSBudWxsLiAqL1xuZnVuY3Rpb24gbWFwcGVkSXB2NChpbm5lcjogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IG0gPSAvXig/OjB7MCw0fTopezIsNX1mZmZmOiguKykkLy5leGVjKGlubmVyKTtcbiAgY29uc3QgdGFpbCA9IG0/LlsxXTtcbiAgaWYgKCF0YWlsKSByZXR1cm4gbnVsbDtcbiAgaWYgKHRhaWwuaW5jbHVkZXMoJy4nKSkgcmV0dXJuIHRhaWw7XG4gIGNvbnN0IGggPSAvXihbMC05YS1mXXsxLDR9KTooWzAtOWEtZl17MSw0fSkkLy5leGVjKHRhaWwpO1xuICBpZiAoIWgpIHJldHVybiBudWxsO1xuICBjb25zdCBoaSA9IE51bWJlci5wYXJzZUludChoWzFdID8/ICcnLCAxNik7XG4gIGNvbnN0IGxvID0gTnVtYmVyLnBhcnNlSW50KGhbMl0gPz8gJycsIDE2KTtcbiAgcmV0dXJuIGAke2hpID4+IDh9LiR7aGkgJiAyNTV9LiR7bG8gPj4gOH0uJHtsbyAmIDI1NX1gO1xufVxuXG5jb25zdCBOT05fUFVCTElDX1NVRkZJWEVTID0gWycubG9jYWxob3N0JywgJy5sb2NhbCcsICcuaW50ZXJuYWwnLCAnLmxhbicsICcuaG9tZS5hcnBhJ107XG5cbi8qKlxuICogV2hldGhlciBhIHB1YmxpYyBhdXRob3Jpc2F0aW9uIHNlcnZlciBjb3VsZCBmZXRjaCBvdXIgbWV0YWRhdGEgZG9jdW1lbnQuXG4gKiBGYWxzZSBtZWFucyB0aGUgYXBwIG11c3QgZ28gc3RyYWlnaHQgdG8gZHluYW1pYyByZWdpc3RyYXRpb24gaW5zdGVhZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUHVibGljbHlGZXRjaGFibGVPcmlnaW4ob3JpZ2luOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgbGV0IHVybDogVVJMO1xuICB0cnkge1xuICAgIHVybCA9IG5ldyBVUkwob3JpZ2luKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICh1cmwucHJvdG9jb2wgIT09ICdodHRwczonKSByZXR1cm4gZmFsc2U7XG4gIC8vIGBsb2NhbGhvc3QuYCBhbmQgYGJveC5sb2NhbC5gIGFyZSB0aGUgc2FtZSBuYW1lcyB3aXRoIGEgcm9vdCBkb3QuXG4gIGNvbnN0IGhvc3QgPSB1cmwuaG9zdG5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9cXC4rJC8sICcnKTtcbiAgaWYgKGhvc3QgPT09ICdsb2NhbGhvc3QnIHx8IE5PTl9QVUJMSUNfU1VGRklYRVMuc29tZSgoc3VmZml4KSA9PiBob3N0LmVuZHNXaXRoKHN1ZmZpeCkpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChpc1ByaXZhdGVJcHY0KGhvc3QpKSByZXR1cm4gZmFsc2U7XG4gIGlmIChob3N0LnN0YXJ0c1dpdGgoJ1snKSkge1xuICAgIC8vIElQdjYgbGl0ZXJhbHM6IGxvb3BiYWNrLCB1bmlxdWUtbG9jYWwgYW5kIGxpbmstbG9jYWwgYXJlIG5ldmVyIHB1YmxpYy5cbiAgICBjb25zdCBpbm5lciA9IGhvc3Quc2xpY2UoMSwgLTEpO1xuICAgIGNvbnN0IG1hcHBlZCA9IG1hcHBlZElwdjQoaW5uZXIpO1xuICAgIGlmIChtYXBwZWQgIT09IG51bGwpIHJldHVybiAhaXNQcml2YXRlSXB2NChtYXBwZWQpO1xuICAgIHJldHVybiAhKGlubmVyID09PSAnOjoxJyB8fCBpbm5lciA9PT0gJzo6JyB8fCAvXmZbY2RdLy50ZXN0KGlubmVyKSB8fCAvXmZlWzg5YWJdLy50ZXN0KGlubmVyKSk7XG4gIH1cbiAgcmV0dXJuIGhvc3QuaW5jbHVkZXMoJy4nKTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFDQSxPQUFPLFFBQVE7QUFDZixPQUFPLFVBQVU7QUFDakIsU0FBUyxxQkFBcUI7QUFDOUIsT0FBTyxpQkFBaUI7QUFDeEIsT0FBTyxXQUFXO0FBQ2xCLFNBQXNCLG9CQUFvQjtBQUMxQyxTQUFTLGVBQWU7OztBQ09qQixTQUFTLGtCQUFrQixRQUF3QjtBQUN4RCxTQUFPLEdBQUcsTUFBTTtBQUNsQjtBQUdPLFNBQVMsWUFBWSxRQUF3QjtBQUNsRCxTQUFPLEdBQUcsTUFBTTtBQUNsQjtBQUdPLFNBQVMsb0JBQW9CLFFBQWdDO0FBQ2xFLFNBQU87QUFBQSxJQUNMLFdBQVcsa0JBQWtCLE1BQU07QUFBQSxJQUNuQyxhQUFhO0FBQUEsSUFDYixZQUFZO0FBQUEsSUFDWixlQUFlLENBQUMsWUFBWSxNQUFNLENBQUM7QUFBQSxJQUNuQyxhQUFhLENBQUMsc0JBQXNCLGVBQWU7QUFBQSxJQUNu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
