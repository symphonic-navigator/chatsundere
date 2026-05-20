// SPDX-License-Identifier: AGPL-3.0-only
import * as v from 'valibot';

const EnvSchema = v.object({
  VITE_AUTH_URL: v.pipe(v.string(), v.url()),
  VITE_SYNC_URL: v.pipe(v.string(), v.url()),
  VITE_PROXY_URL: v.pipe(v.string(), v.url()),
  VITE_ADMIN_API_MODE: v.optional(
    v.union([v.literal('mock'), v.literal('live'), v.literal('hybrid')]),
    'hybrid',
  ),
});

export const env = v.parse(EnvSchema, import.meta.env);
