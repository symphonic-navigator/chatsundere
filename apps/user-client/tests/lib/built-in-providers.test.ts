// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROVIDERS } from '../../src/lib/built-in-providers.js';

describe('BUILT_IN_PROVIDERS', () => {
  it('includes xAI with a monogram', () => {
    const xai = BUILT_IN_PROVIDERS.find((p) => p.id === 'xai');
    expect(xai).toEqual({ id: 'xai', name: 'xAI', monogram: 'xA' });
  });
});
