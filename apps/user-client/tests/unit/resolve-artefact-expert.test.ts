import { describe, expect, it } from 'vitest';
import { resolveArtefactExpert } from '../../src/lib/resolve-artefact-expert.js';

describe('resolveArtefactExpert', () => {
  it('returns null when no global expert is set', () => {
    expect(resolveArtefactExpert(null, {})).toBeNull();
    expect(resolveArtefactExpert(undefined, {})).toBeNull();
  });

  it('parses a "templateId:slug" ref into an OfferingRef', () => {
    expect(resolveArtefactExpert('anthropic:opus-4-8', {})).toEqual({
      providerId: 'anthropic',
      upstreamSlug: 'opus-4-8',
    });
  });

  it('splits only on the first colon', () => {
    expect(resolveArtefactExpert('prov:a:b', {})).toEqual({
      providerId: 'prov',
      upstreamSlug: 'a:b',
    });
  });

  it('honours the per-chat opt-out (absent ⇒ on)', () => {
    const ref = 'anthropic:opus-4-8';
    expect(resolveArtefactExpert(ref, {})).not.toBeNull();
    expect(resolveArtefactExpert(ref, { useArtefactExpertModel: true })).not.toBeNull();
    expect(resolveArtefactExpert(ref, { useArtefactExpertModel: false })).toBeNull();
  });

  it('returns null for a malformed ref', () => {
    expect(resolveArtefactExpert('nocolon', {})).toBeNull();
  });
});
