// SPDX-License-Identifier: AGPL-3.0-only

import type { Hono } from 'hono';
import { loadEnv } from '../env.js';

/**
 * Public, unauthenticated backend self-description (spec §7, sync spec §11). The
 * client learns the proxy/sync URLs rather than hard-coding them, so self-hosting
 * is first-class. Each URL and its feature flag appear only when configured, so
 * an operator running any subset of the services emits a coherent topology. No
 * state, no secret, no DB read.
 */
export function registerConfigRoute(app: Hono): void {
  app.get('/api/v1/config', (c) => {
    const env = loadEnv();
    const features: string[] = [];
    const body: { proxyUrl?: string; syncUrl?: string; features: string[] } = { features };
    if (env.PROXY_PUBLIC_URL) {
      body.proxyUrl = env.PROXY_PUBLIC_URL;
      features.push('proxy');
    }
    if (env.SYNC_PUBLIC_URL) {
      body.syncUrl = env.SYNC_PUBLIC_URL;
      features.push('sync');
    }
    return c.json(body);
  });
}
