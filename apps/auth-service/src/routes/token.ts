// SPDX-License-Identifier: AGPL-3.0-only

import type { Hono } from 'hono';
import { refreshCookieFor } from '../jwt/issue.js';
import { rotateRefreshToken } from '../jwt/refresh.js';
import { ApiError } from '../middleware/error-envelope.js';

/** Registers POST /v1/token/refresh — reads the HttpOnly refresh cookie, rotates, sets a new cookie. */
export function registerTokenRoutes(app: Hono): void {
  app.post('/v1/token/refresh', async (c) => {
    const cookieHeader = c.req.header('Cookie') ?? '';
    const match = cookieHeader.match(/(?:^|;\s*)refresh_token=([^;]+)/);
    const presented = match?.[1];
    if (!presented) throw new ApiError(401, 'unauthorized', 'Missing refresh cookie');

    const result = await rotateRefreshToken({
      presentedToken: presented,
      userAgent: c.req.header('User-Agent') ?? undefined,
    });

    if (result.outcome !== 'ok' || !result.tokens) {
      throw new ApiError(401, 'unauthorized', 'Refresh token invalid or revoked');
    }

    c.header('Set-Cookie', refreshCookieFor(result.tokens.refreshToken));
    return c.json({
      access_token: result.tokens.accessToken,
      expires_in: result.tokens.expiresIn,
    });
  });
}
