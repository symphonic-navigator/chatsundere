// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ArtefactRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';
import { makeListArtefactsTool } from '../../src/integrations/artefact/artefact-integration.js';
import type { IntegrationContext } from '../../src/integrations/types.js';

const CHAT = 'chat-list-1';
const OTHER = 'chat-list-other';
const PERSONA = 'p-list';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

function ctx(over: Partial<IntegrationContext> = {}): IntegrationContext {
  return {
    nsfwAllowed: false,
    tonalityEnabled: false,
    globalInstructions: '',
    location: null,
    webSearch: null,
    webFetch: null,
    useProxy: false,
    webSearchTierId: null,
    artefactExpert: null,
    chatId: CHAT,
    personaId: PERSONA,
    personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    getKey: async () => 'k',
    ...over,
  };
}

describe('list_artefacts persona tool', () => {
  it('returns text artefacts for the chat without bodies or isCurrent', async () => {
    await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Calc',
      content: '<html>c</html>',
      format: 'html',
    });
    await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Notes',
      content: '# n',
      format: 'markdown',
    });
    await addGeneratedArtefact({
      chatId: OTHER,
      personaId: PERSONA,
      title: 'Elsewhere',
      content: 'x',
    });
    const now = Date.now();
    const image: ArtefactRow = {
      id: 'img-1',
      chatId: CHAT,
      personaId: PERSONA,
      projectId: null,
      origin: 'generated',
      kind: 'image',
      format: 'image',
      title: 'Pic',
      fileName: 'pic.jpg',
      mime: 'image/jpeg',
      content: '',
      tags: [],
      favourite: false,
      createdAt: now,
      updatedAt: now,
    };
    await getClientDataDb().artefacts.add(image);

    const tool = makeListArtefactsTool(ctx());
    const r = await tool.execute({});
    expect(r.ok).toBe(true);
    const body = JSON.parse(r.output) as {
      artefacts: Array<Record<string, unknown>>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.artefacts).toHaveLength(2);
    expect(body.artefacts.every((a) => a.title !== 'Elsewhere')).toBe(true);
    expect(body.artefacts.every((a) => a.title !== 'Pic')).toBe(true);
    expect(body.artefacts.every((a) => !('content' in a))).toBe(true);
    expect(body.artefacts.every((a) => !('isCurrent' in a))).toBe(true);
    expect(body.artefacts[0]?.title).toBe('Notes');
    for (const a of body.artefacts) {
      expect(typeof a.id).toBe('string');
      expect(typeof a.fileName).toBe('string');
      expect(typeof a.format).toBe('string');
      expect(typeof a.charLength).toBe('number');
      expect(typeof a.updatedAt).toBe('number');
    }
  });
});
