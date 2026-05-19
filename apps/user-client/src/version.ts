// SPDX-License-Identifier: AGPL-3.0-only

// Injected at build time by the Vite `define` block in vite.config.ts.
// The declaration tells TypeScript the global exists; the value is replaced
// at bundle time with the npm_package_version string.
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
