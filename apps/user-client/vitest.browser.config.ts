// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

/**
 * Real-browser smoke tests (genuine IndexedDB, no fake-indexeddb). Set
 * CHROMIUM_PATH to an existing Chromium executable; browsers are never
 * downloaded by this repo.
 */
export default defineConfig({
  test: {
    include: ['tests-browser/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true,
      providerOptions: { launch: { executablePath: process.env.CHROMIUM_PATH } },
    },
  },
});
