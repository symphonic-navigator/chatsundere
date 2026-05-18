// SPDX-License-Identifier: AGPL-3.0-only

import type { Hono } from 'hono';
import { getKeyMaterial } from '../jwt/keys.js';

/** Publishes the public Ed25519 JWK at GET /v1/jwks. */
export function registerJwksRoute(app: Hono): void {
  app.get('/v1/jwks', async (c) => {
    const { publicJwk } = await getKeyMaterial();
    return c.json({ keys: [publicJwk] });
  });
}
