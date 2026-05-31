// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { ProviderRow } from '../../src/boot/client-data-db.js';
import { usableTemplateIds } from '../../src/lib/usable-providers.js';

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (id: string) =>
    id === 'wafer' ? { corsHint: 'requires-proxy' } : { corsHint: 'direct' },
}));

const row = (templateId: string, enabled: boolean): ProviderRow =>
  ({ id: `r-${templateId}`, templateId, enabled }) as ProviderRow;

describe('usableTemplateIds', () => {
  it('includes enabled direct providers', () => {
    expect(usableTemplateIds([row('chutes', true)], false)).toEqual(['chutes']);
  });
  it('excludes disabled providers', () => {
    expect(usableTemplateIds([row('chutes', false)], true)).toEqual([]);
  });
  it('excludes proxy-required providers when no proxy is set', () => {
    expect(usableTemplateIds([row('wafer', true)], false)).toEqual([]);
  });
  it('includes proxy-required providers when a proxy is set', () => {
    expect(usableTemplateIds([row('wafer', true)], true)).toEqual(['wafer']);
  });
});
