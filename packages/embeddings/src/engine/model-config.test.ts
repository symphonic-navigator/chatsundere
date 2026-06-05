// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DOC_PREFIX, QUERY_PREFIX, applyPrefix } from './model-config.js';

describe('applyPrefix', () => {
  it('prepends the query prefix for queries', () => {
    expect(applyPrefix('what is snowflake?', 'query')).toBe(`${QUERY_PREFIX}what is snowflake?`);
  });
  it('leaves documents unprefixed', () => {
    expect(applyPrefix('The Data Cloud!', 'document')).toBe(`${DOC_PREFIX}The Data Cloud!`);
  });
});
