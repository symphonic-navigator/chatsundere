// SPDX-License-Identifier: AGPL-3.0-only

import type { Hono } from 'hono';
import { loadEnv } from '../env.js';

/**
 * Public, unauthenticated backend self-description (spec §7). The client learns
 * the proxy URL rather than hard-coding it, so self-hosting is first-class. No
 * state, no secret, no DB read — sourced from the validated PROXY_PUBLIC_URL.
 */
export function registerConfigRoute(app: Hono): void {
  app.get('/api/v1/config', (c) => {
    const env = loadEnv();
    return c.json({ proxyUrl: env.PROXY_PUBLIC_URL, features: ['proxy'] });
  });
}
