// apps/user-client/tests/unit/app-routes.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('App routes — /app/history registration', () => {
  it('imports HistoryPage in App.tsx', () => {
    const appTsxPath = resolve(__dirname, '../../src/App.tsx');
    const content = readFileSync(appTsxPath, 'utf-8');
    expect(content).toMatch(/import.*HistoryPage.*from.*history/);
  });

  it('registers /app/history route in App.tsx', () => {
    const appTsxPath = resolve(__dirname, '../../src/App.tsx');
    const content = readFileSync(appTsxPath, 'utf-8');
    expect(content).toMatch(/<Route path="\/app\/history" element={<HistoryPage \/>/);
  });
});
