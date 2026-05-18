// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const EnvSchema = v.object({
  VITE_AUTH_URL: v.pipe(v.string(), v.url()),
  VITE_SYNC_URL: v.pipe(v.string(), v.url()),
  VITE_PROXY_URL: v.pipe(v.string(), v.url()),
});

export const env = v.parse(EnvSchema, import.meta.env);
