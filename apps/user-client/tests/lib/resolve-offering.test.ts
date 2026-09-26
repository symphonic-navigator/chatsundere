// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../src/boot/client-data-db.js';
import { resolveOffering } from '../../src/lib/resolve-offering.js';

// Only nullness of apiKey is read by resolveOffering, so a same-shaped stand-in
// is safe here without sealing a real EncryptedBlob.
const apiKey = {} as ProviderRow['apiKey'];

describe('resolveOffering', () => {
  it('reports provider-unavailable when the provider row is missing', () => {
    const result = resolveOffering(
      { providerId: 'nano-gpt', modelId: 'anthropic/claude-opus-5.5' },
      undefined,
    );
    expect(result).toEqual({ kind: 'provider-unavailable', templateId: 'nano-gpt' });
  });

  it('reports provider-unavailable when apiKey is null (reversible removal)', () => {
    const result = resolveOffering(
      { providerId: 'nano-gpt', modelId: 'anthropic/claude-opus-5.5' },
      { templateId: 'nano-gpt', apiKey: null },
    );
    expect(result).toEqual({ kind: 'provider-unavailable', templateId: 'nano-gpt' });
  });

  it('reports model-unknown for a slug absent from this build’s catalogue', () => {
    const result = resolveOffering(
      { providerId: 'nano-gpt', modelId: 'anthropic/claude-does-not-exist' },
      { templateId: 'nano-gpt', apiKey },
    );
    expect(result).toEqual({
      kind: 'model-unknown',
      templateId: 'nano-gpt',
      modelId: 'anthropic/claude-does-not-exist',
    });
  });

  it('reports model-unknown for an empty modelId', () => {
    const result = resolveOffering(
      { providerId: 'nano-gpt', modelId: '' },
      { templateId: 'nano-gpt', apiKey },
    );
    expect(result).toEqual({ kind: 'model-unknown', templateId: 'nano-gpt', modelId: '' });
  });

  it('resolves ok with the offering for a known slug', () => {
    const result = resolveOffering(
      { providerId: 'nano-gpt', modelId: 'anthropic/claude-opus-5.5' },
      { templateId: 'nano-gpt', apiKey },
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.offering.upstreamSlug).toBe('anthropic/claude-opus-5.5');
    }
  });

  it('offers the update path when this build does not know the provider template', () => {
    const result = resolveOffering(
      { providerId: 'provider-from-the-future', modelId: 'some/model' },
      undefined,
    );
    expect(result).toEqual({
      kind: 'model-unknown',
      templateId: 'provider-from-the-future',
      modelId: 'some/model',
    });
  });

  it('prefers the provider row’s template when deciding whether it is known', () => {
    const result = resolveOffering(
      { providerId: 'row-id', modelId: 'some/model' },
      { templateId: 'provider-from-the-future', apiKey },
    );
    expect(result).toEqual({
      kind: 'model-unknown',
      templateId: 'provider-from-the-future',
      modelId: 'some/model',
    });
  });
});
