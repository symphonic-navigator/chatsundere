// SPDX-License-Identifier: MIT

/** Response shape of the public backend-discovery endpoint `GET /api/v1/config`. */
export interface ServerConfig {
  proxyUrl?: string;
  syncUrl?: string;
  adminUrl?: string;
  /** Feature flags; servers may send strings this client does not know yet. */
  features: string[];
}

/** Feature flags the client understands today. */
export type KnownServerFeature = 'proxy' | 'sync' | 'blobs' | 'admin';
