// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  createSeedTemplate,
  deleteSeedTemplate,
  getSeedTemplate,
  listSeedTemplates,
  updateSeedTemplate,
} from '../../src/data/seed-templates.js';

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('seedTemplates CRUD', () => {
  it('opens at version 33 on a fresh install', () => {
    expect(getClientDataDb().verno).toBe(34);
  });

  it('creates and reads back a template with greeting + body', async () => {
    const id = await createSeedTemplate({
      name: 'Mid-thread primer',
      description: '',
      nsfw: false,
      greeting: 'Oh, you again — good.',
      body: [
        { role: 'user', text: 'hey' },
        { role: 'persona', text: 'hey yourself' },
      ],
    });
    const row = await getSeedTemplate(id);
    expect(row?.greeting).toBe('Oh, you again — good.');
    expect(row?.body).toHaveLength(2);
    expect(row?.body[0]?.role).toBe('user');
  });

  it('lists newest first', async () => {
    const first = await createSeedTemplate({
      name: 'First',
      description: '',
      nsfw: false,
      greeting: null,
      body: [{ role: 'user', text: 'a' }],
    });
    const second = await createSeedTemplate({
      name: 'Second',
      description: '',
      nsfw: false,
      greeting: null,
      body: [{ role: 'user', text: 'b' }],
    });
    const rows = await listSeedTemplates();
    expect(rows.map((r) => r.id)).toEqual([second, first]);
  });

  it('patches fields and bumps updatedAt', async () => {
    const id = await createSeedTemplate({
      name: 'Original',
      description: '',
      nsfw: false,
      greeting: null,
      body: [{ role: 'user', text: 'a' }],
    });
    const before = await getSeedTemplate(id);
    await updateSeedTemplate(id, { name: 'Renamed', nsfw: true });
    const after = await getSeedTemplate(id);
    expect(after?.name).toBe('Renamed');
    expect(after?.nsfw).toBe(true);
    expect(after?.updatedAt).toBeGreaterThanOrEqual(before?.updatedAt ?? 0);
  });

  it('deletes a template', async () => {
    const id = await createSeedTemplate({
      name: 'Doomed',
      description: '',
      nsfw: false,
      greeting: 'hi',
      body: [],
    });
    await deleteSeedTemplate(id);
    expect(await getSeedTemplate(id)).toBeUndefined();
  });
});
