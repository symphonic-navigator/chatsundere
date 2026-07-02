// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

/**
 * All three URLs point at server-coupled services (auth, sync, proxy)
 * which are out of scope for Block 1's local-only / standalone-mode
 * surface. They are therefore optional at boot — server-coupled code
 * paths that consume them (e.g. recovery-from-scratch) must validate
 * presence themselves at the point of use, or be Block-2-gated.
 *
 * When Block 2 re-enables the server-coupled paths, callers that need
 * a URL should either runtime-check `env.VITE_AUTH_URL` (and surface a
 * "server not configured" message) or be unreachable when unset (per
 * the onboarding-matrix gating in `routes/onboarding/matrix.tsx`).
 */
const EnvSchema = v.object({
  VITE_AUTH_URL: v.optional(v.pipe(v.string(), v.url())),
  VITE_SYNC_URL: v.optional(v.pipe(v.string(), v.url())),
  VITE_INVITE_REQUEST_URL: v.optional(v.pipe(v.string(), v.url())),
});

export const env = v.parse(EnvSchema, import.meta.env);
