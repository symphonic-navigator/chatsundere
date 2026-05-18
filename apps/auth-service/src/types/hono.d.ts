// SPDX-License-Identifier: AGPL-3.0-only
//
// Module augmentation so that c.get('claims') / c.set('claims', ...) are
// typed consistently throughout the application without needing per-file casts.

import type { AccessClaims } from '../jwt/verify.js';

declare module 'hono' {
  interface ContextVariableMap {
    claims: AccessClaims;
    request_id: string;
  }
}
