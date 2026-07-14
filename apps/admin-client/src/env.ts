// SPDX-License-Identifier: AGPL-3.0-only
import * as v from 'valibot';

/**
 * Every field is optional, so this schema cannot reject the production
 * environment — the image supplies no VITE_* values and the parse below runs
 * at module scope, before React mounts (spec §1). Exported so the regression
 * test can assert that property directly.
 *
 * VITE_AUTH_URL is a dev-only override; the auth base URL comes from the
 * linked account row at runtime (see lib/server-urls.ts). VITE_SYNC_URL and
 * VITE_PROXY_URL were removed — the admin never read them.
 */
export const EnvSchema = v.object({
  VITE_AUTH_URL: v.optional(v.pipe(v.string(), v.url())),
  // Where "Open user-client" sends the operator. In production the user-client
  // sits at the domain root and the admin-client under /admin/, so `/` is
  // correct; in dev the two run on separate ports, so this is the full origin
  // (e.g. http://localhost:3000). Not v.url() — `/` is a valid relative value.
  VITE_USER_CLIENT_URL: v.optional(v.pipe(v.string(), v.minLength(1)), '/'),
});

export const env = v.parse(EnvSchema, import.meta.env);
