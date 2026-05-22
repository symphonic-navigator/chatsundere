// SPDX-License-Identifier: AGPL-3.0-only
//
// Module augmentation so that c.get('claims') / c.set('claims', ...) are
// typed consistently throughout the application without needing per-file casts.

import type { AccessClaims } from '../jwt/verify.js';

declare module 'hono' {
  interface ContextVariableMap {
    claims: AccessClaims;
    /**
     * Server-side session id (the access-token jti claim). Set by the
     * bearerAuth middleware alongside `claims`. Use as the key prefix for
     * per-session state such as step-up grace windows per ADR 0027.
     */
    sessionId: string;
    request_id: string;
  }
}
