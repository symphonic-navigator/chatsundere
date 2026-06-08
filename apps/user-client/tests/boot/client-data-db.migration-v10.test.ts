// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';

describe('Dexie v10 migration', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('backfills personas.contextWindow=null and exposes personaAvatars', async () => {
    const db = await openClientDataDb();
    const id = crypto.randomUUID();
    await db.personas.add({
      id,
      name: 'Test',
      tagline: '',
      colour: '#fff',
      font: 'serif',
      instructions: 'hi',
      canonicalId: null,
      providerId: '',
      modelId: '',
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const got = await db.personas.get(id);
    expect(got?.contextWindow).toBeNull();
    // personaAvatars table is usable
    await db.personaAvatars.put({
      personaId: id,
      blob: new Blob(['x'], { type: 'image/webp' }),
      mime: 'image/webp',
      width: 100,
      height: 100,
      crop: { x: 0, y: 0, zoom: 1 },
      updatedAt: Date.now(),
    });
    expect(await db.personaAvatars.get(id)).not.toBeUndefined();
  });
});
