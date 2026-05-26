// SPDX-License-Identifier: AGPL-3.0-only

declare const __APP_VERSION__: string;
declare const __APP_SHA__: string;
declare const __APP_BUILT_AT__: string;

export interface VersionInfo {
  version: string; // "0.0.1" | "0.0.1-pre.42" | "dev"
  sha: string; // "1796752" | "dev"
  builtAt: string; // ISO-8601 UTC | "dev"
}

/**
 * Build-time-injected version info. Defaults to "dev" everywhere when the
 * globals aren't defined (local dev, vitest, etc.). The GitHub Actions
 * `pages.yml` workflow injects these via Vite `define` at build time.
 */
export const APP_VERSION: VersionInfo = {
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  sha: typeof __APP_SHA__ !== 'undefined' ? __APP_SHA__ : 'dev',
  builtAt: typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : 'dev',
};
