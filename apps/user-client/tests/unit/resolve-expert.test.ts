// SPDX-License-Identifier: AGPL-3.0-only
import { asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { resolveExpert } from '../../src/data/send-message';
import { sealSecret } from '../../src/lib/secrets';

// Pick a known LLM offering from nano-gpt that has reasoning (steps) so the
// maxReasoningIntent result is predictable. deepseek-v4-flash uses STEPS mode
// with a high step — maxReasoningIntent picks the last non-offStep step.
const TEST_OFFERING = nanoGpt.offerings.find(
  (o) => o.canonicalRef === 'deepseek-v4-flash' && o.serviceKind === 'llm',
);
if (!TEST_OFFERING) throw new Error('test invariant: deepseek-v4-flash not in nano-gpt offerings');
const REF = `nano-gpt:${TEST_OFFERING.upstreamSlug}`;

async function seedProvider(mk: ReturnType<typeof asMasterKey>): Promise<string> {
  const db = await openClientDataDb();
  const providerId = 'test-provider-id';
  const apiKey = await sealSecret('test-key-value', mk, `provider/${providerId}/api-key`);
  await db.providers.add({
    id: providerId,
    templateId: 'nano-gpt',
    displayName: 'nano-gpt test',
    baseUrl: nanoGpt.baseUrl,
    apiKey,
    routing: { kind: 'direct' },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  return providerId;
}

describe('resolveExpert', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    // Ensure the DB handle is initialised — getClientDataDb() throws otherwise.
    await openClientDataDb();
  });

  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });

  it('returns null when ref is null', async () => {
    const mk = asMasterKey(getRandomBytes(32));
    const result = await resolveExpert(null, mk, null, null);
    expect(result).toBeNull();
  });

  it('returns null when ref has no colon separator', async () => {
    const mk = asMasterKey(getRandomBytes(32));
    const result = await resolveExpert('nocolon', mk, null, null);
    expect(result).toBeNull();
  });

  it('returns null for an unknown provider template id', async () => {
    const mk = asMasterKey(getRandomBytes(32));
    const result = await resolveExpert('no-such-provider:some-slug', mk, null, null);
    expect(result).toBeNull();
  });

  it('returns null for a known provider but unknown upstream slug', async () => {
    const mk = asMasterKey(getRandomBytes(32));
    const result = await resolveExpert('nano-gpt:no-such-slug', mk, null, null);
    expect(result).toBeNull();
  });

  it('returns null when no enabled provider row exists for the template', async () => {
    const mk = asMasterKey(getRandomBytes(32));
    // No provider row added — DB is empty after reset.
    const result = await resolveExpert(REF, mk, null, null);
    expect(result).toBeNull();
  });

  it('returns the full base + modelLabel + reasoning for a configured offering', async () => {
    const mk = asMasterKey(getRandomBytes(32));
    await seedProvider(mk);

    const result = await resolveExpert(REF, mk, 'https://proxy.example', 'proxy-key');

    expect(result).not.toBeNull();

    // base fields
    expect(result?.base.provider.id).toBe('nano-gpt');
    expect(result?.base.apiKey).toBe('test-key-value');
    expect(result?.base.corsProxyUrl).toBe('https://proxy.example');
    expect(result?.base.corsProxyKey).toBe('proxy-key');
    expect(result?.base.target).toBeDefined();

    // routing: nano-gpt corsHint is 'inofficial' → direct
    expect(result?.base.providerConfig.routing.kind).toBe('direct');

    // modelLabel: deepseek-v4-flash has a canonical entry with displayName
    expect(typeof result?.modelLabel).toBe('string');
    expect(result?.modelLabel.length).toBeGreaterThan(0);
    // The canonical displayName for deepseek-v4-flash is 'DeepSeek V4 Flash'
    expect(result?.modelLabel).toBe('DeepSeek V4 Flash');

    // reasoning: STEPS mode → maxReasoningIntent picks the last non-offStep step
    expect(result?.reasoning).toEqual({ enabled: true, effort: 'high' });
  });

  it('decrypted api-key matches the sealed value', async () => {
    const mk = asMasterKey(getRandomBytes(32));
    await seedProvider(mk);

    const result = await resolveExpert(REF, mk, null, null);
    expect(result?.base.apiKey).toBe('test-key-value');
  });
});
