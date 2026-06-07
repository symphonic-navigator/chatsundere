// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

describe('persona canonicalId column', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('persists and reads back canonicalId', async () => {
    const db = getClientDataDb();
    const id = 'p-test-canonical';
    await db.personas.put({
      id,
      name: 'T',
      tagline: '',
      colour: '#fff',
      font: 'serif',
      instructions: 'x',
      canonicalId: 'glm-5.1',
      providerId: 'prov-1',
      modelId: 'zai-org/glm-5.1',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.8,
      adultPersona: false,
      chatsundereTonality: true,
      contextWindow: null,
      libraryIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const row = await db.personas.get(id);
    expect(row?.canonicalId).toBe('glm-5.1');
    await db.personas.delete(id);
  });
});
