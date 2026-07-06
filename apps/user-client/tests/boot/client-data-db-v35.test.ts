// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type MasterKey, asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type PersonaRow,
  type ProviderRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { providerApiKeySlot } from '../../src/data/providers.js';
import { openSecret, sealSecret } from '../../src/lib/secrets.js';

/** Minimal v34 store set — Dexie creates the rest at head-open. */
const V34_MIN_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  personas: 'id, providerId',
} as const;

const mk: MasterKey = asMasterKey(getRandomBytes(32));

async function plantV34(providers: ProviderRow[], personas: PersonaRow[] = []): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  db.version(34).stores(V34_MIN_STORES);
  await db.open();
  await db.table('providers').bulkAdd(providers);
  if (personas.length > 0) await db.table('personas').bulkAdd(personas);
  db.close();
}

function provRow(
  id: string,
  enabled: boolean,
  updatedAt: number,
  apiKey: ProviderRow['apiKey'],
): ProviderRow {
  return {
    id,
    templateId: 'nano-gpt',
    displayName: 'nano-gpt',
    baseUrl: '',
    apiKey,
    routing: { kind: 'direct' },
    enabled,
    createdAt: 0,
    updatedAt,
  };
}

function personaRow(id: string, providerId: string): PersonaRow {
  return {
    id,
    name: 'Test Persona',
    tagline: '',
    colour: '#000000',
    font: 'sans',
    instructions: '',
    canonicalId: null,
    providerId,
    modelId: 'some-model',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('client-data-db v35 (provider id → templateId)', () => {
  beforeEach(async () => await _resetClientDataDbForTests());
  afterEach(async () => await _resetClientDataDbForTests());

  it('opens at verno 35 on a fresh install', async () => {
    await openClientDataDb();
    expect(getClientDataDb().verno).toBe(35);
  });

  it('collapses two nano-gpt rows to one keyed by templateId, preserving the sealed key', async () => {
    // The survivor (enabled) is sealed under its OLD uuid slot.
    const survivorId = 'uuid-enabled';
    const sealed = await sealSecret('real-key', mk, `provider/${survivorId}/api-key`);
    const dud = await sealSecret('dud', mk, 'provider/uuid-disabled/api-key');
    await plantV34([
      provRow('uuid-disabled', false, 100, dud),
      provRow(survivorId, true, 50, sealed),
    ]);

    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(35);

    const rows = (await db.providers
      .where('templateId')
      .equals('nano-gpt')
      .toArray()) as ProviderRow[];
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.id).toBe('nano-gpt');
    expect(row?.keySlot).toBe(survivorId);
    // The preserved blob still opens under the keySlot-derived context.
    // biome-ignore lint/style/noNonNullAssertion: row's presence is asserted via toHaveLength(1) above
    expect(await openSecret(row!.apiKey, mk, providerApiKeySlot(row!))).toBe('real-key');
    expect(await db.providers.get('uuid-disabled')).toBeUndefined();
    expect(await db.providers.get('uuid-enabled')).toBeUndefined();
  });

  it('rekeys a singleton provider and is idempotent on re-open', async () => {
    const sealed = await sealSecret('k', mk, 'provider/uuid-x/api-key');
    await plantV34([
      {
        ...provRow('uuid-x', true, 1, sealed),
        templateId: 'openrouter',
        displayName: 'openrouter',
      },
    ]);
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const first = await getClientDataDb().providers.get('openrouter');
    expect(first?.id).toBe('openrouter');
    expect(first?.keySlot).toBe('uuid-x');

    // Re-open (no version change) must not disturb the migrated row.
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const again = await getClientDataDb().providers.get('openrouter');
    expect(again?.keySlot).toBe('uuid-x');
    expect(await getClientDataDb().providers.toArray()).toHaveLength(1);
  });

  it('remaps persona.providerId from an old provider uuid to the new templateId', async () => {
    const sealed = await sealSecret('k', mk, 'provider/uuid-solo/api-key');
    await plantV34(
      [{ ...provRow('uuid-solo', true, 1, sealed), templateId: 'openrouter' }],
      [personaRow('persona-1', 'uuid-solo')],
    );
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const db = getClientDataDb();

    const persona = await db.personas.get('persona-1');
    expect(persona?.providerId).toBe('openrouter');
    // The old uuid row is gone, so a stale providerId would silently 404.
    expect(await db.providers.get('uuid-solo')).toBeUndefined();
  });

  it('remaps a persona pointing at a loser-duplicate uuid to the shared templateId', async () => {
    const survivorId = 'uuid-enabled';
    const loserId = 'uuid-disabled';
    const sealed = await sealSecret('real-key', mk, `provider/${survivorId}/api-key`);
    const dud = await sealSecret('dud', mk, `provider/${loserId}/api-key`);
    await plantV34(
      [provRow(loserId, false, 100, dud), provRow(survivorId, true, 50, sealed)],
      [personaRow('persona-loser', loserId), personaRow('persona-survivor', survivorId)],
    );
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const db = getClientDataDb();

    expect((await db.personas.get('persona-loser'))?.providerId).toBe('nano-gpt');
    expect((await db.personas.get('persona-survivor'))?.providerId).toBe('nano-gpt');
  });
});
