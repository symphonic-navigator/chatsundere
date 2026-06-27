// SPDX-License-Identifier: AGPL-3.0-only

import { env } from '../env.js';

/**
 * The single CORS proxy the alpha routes proxy-gated upstreams through. The URL
 * is fixed for hosted users — they supply only the access key (see
 * {@link CorsProxyBlock}). Self-hosters can point the build at their own proxy
 * via the `VITE_PROXY_URL` build-time variable. Transitional scaffolding: at
 * beta the authenticated proxy moves server-side and this constant retires.
 */
export const CORS_PROXY_URL = env.VITE_PROXY_URL ?? 'https://cors-proxy.tidesson.net';
