// SPDX-License-Identifier: AGPL-3.0-only
import * as v from 'valibot';

const EnvSchema = v.object({
  VITE_AUTH_URL: v.pipe(v.string(), v.url()),
  VITE_SYNC_URL: v.pipe(v.string(), v.url()),
  VITE_PROXY_URL: v.pipe(v.string(), v.url()),
  // Where "Open user-client" sends the operator. In production the user-client
  // sits at the domain root and the admin-client under /admin/, so `/` is
  // correct; in dev the two run on separate ports, so this is the full origin
  // (e.g. http://localhost:3000). Not v.url() — `/` is a valid relative value.
  VITE_USER_CLIENT_URL: v.optional(v.pipe(v.string(), v.minLength(1)), '/'),
});

export const env = v.parse(EnvSchema, import.meta.env);
