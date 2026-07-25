// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ArtefactRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact, getArtefact } from '../../src/data/artefacts.js';
import { makeCraftTools } from '../../src/lib/artefact-craft-tools.js';
import type { Tool } from '../../src/tools/types.js';

const CHAT = 'chat-craft-1';
const OTHER_CHAT = 'chat-other';
const PERSONA = 'persona-1';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

function toolByName(tools: Tool[], name: string): Tool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

async function addImageStub(over: Partial<ArtefactRow> = {}): Promise<string> {
  const id = over.id ?? `img-${Date.now()}`;
  const now = Date.now();
  const row: ArtefactRow = {
    id,
    chatId: CHAT,
    personaId: PERSONA,
    projectId: null,
    origin: 'generated',
    kind: 'image',
    format: 'image',
    title: over.title ?? 'A picture',
    fileName: over.fileName ?? 'a-picture.jpg',
    mime: 'image/jpeg',
    content: '',
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
  await getClientDataDb().artefacts.add(row);
  return id;
}

describe('makeCraftTools', () => {
  it('list returns only text artefacts, sets isCurrent, omits images', async () => {
    const currentId = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Calculator',
      content: '<html>calc</html>',
      format: 'html',
    });
    // slightly later update so sort order is deterministic if needed
    await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Notes',
      content: '# notes',
      format: 'markdown',
    });
    await addImageStub({ title: 'Hero image', fileName: 'hero.jpg' });
    // other chat must not appear
    await addGeneratedArtefact({
      chatId: OTHER_CHAT,
      personaId: PERSONA,
      title: 'Elsewhere',
      content: 'x',
    });

    const tools = makeCraftTools({ chatId: CHAT, currentId, allowWrite: true });
    const res = await toolByName(tools, 'list_artefacts').execute({});
    expect(res.ok).toBe(true);
    const body = JSON.parse(res.output) as {
      artefacts: Array<{ id: string; title: string; isCurrent: boolean }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.artefacts).toHaveLength(2);
    expect(body.artefacts.every((a) => a.title !== 'Hero image')).toBe(true);
    expect(body.artefacts.every((a) => a.title !== 'Elsewhere')).toBe(true);
    const current = body.artefacts.find((a) => a.id === currentId);
    expect(current?.isCurrent).toBe(true);
    expect(body.artefacts.filter((a) => a.isCurrent)).toHaveLength(1);
    // newest updatedAt first (Notes was inserted after Calculator)
    expect(body.artefacts[0]?.title).toBe('Notes');
  });

  it('read_current returns full content and metadata', async () => {
    const content = '<!doctype html><title>Calc</title><body>ok</body>';
    const currentId = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Calc',
      content,
      format: 'html',
    });
    const tools = makeCraftTools({ chatId: CHAT, currentId, allowWrite: true });
    const res = await toolByName(tools, 'read_current_artefact').execute({});
    expect(res.ok).toBe(true);
    expect(res.meta).toEqual({ op: 'read_current', targetId: currentId });
    const body = JSON.parse(res.output) as {
      id: string;
      title: string;
      content: string;
      charLength: number;
      format: string;
      mime: string;
    };
    expect(body.id).toBe(currentId);
    expect(body.title).toBe('Calc');
    expect(body.content).toBe(content);
    expect(body.charLength).toBe(content.length);
    expect(body.format).toBe('html');
    expect(body.mime).toBe('text/html');
  });

  it('read_other resolves exact title', async () => {
    const currentId = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Current',
      content: 'current body',
    });
    const otherId = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Reference SPA',
      content: 'other body full',
      format: 'markdown',
    });
    const tools = makeCraftTools({ chatId: CHAT, currentId, allowWrite: false });
    const res = await toolByName(tools, 'read_other_artefact').execute({
      name: 'Reference SPA',
    });
    expect(res.ok).toBe(true);
    expect(res.meta).toEqual({ op: 'read_other', targetId: otherId });
    const body = JSON.parse(res.output) as { id: string; content: string; title: string };
    expect(body.id).toBe(otherId);
    expect(body.content).toBe('other body full');
    expect(body.title).toBe('Reference SPA');
  });

  it('read_other ambiguous name returns error listing candidates', async () => {
    const currentId = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Current',
      content: 'c',
    });
    await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Alpha Draft',
      content: 'a',
    });
    await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Beta Draft',
      content: 'b',
    });
    const tools = makeCraftTools({ chatId: CHAT, currentId, allowWrite: false });
    const res = await toolByName(tools, 'read_other_artefact').execute({ name: 'Draft' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Ambiguous/i);
    expect(res.error).toMatch(/Alpha Draft/);
    expect(res.error).toMatch(/Beta Draft/);
  });

  it('replace_current success updates content', async () => {
    const currentId = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Doc',
      content: 'original body',
      format: 'markdown',
    });
    const before = await getArtefact(currentId);
    if (!before) throw new Error('missing row');

    const tools = makeCraftTools({ chatId: CHAT, currentId, allowWrite: true });
    const res = await toolByName(tools, 'replace_current_artefact').execute({
      expectedUpdatedAt: before.updatedAt,
      content: 'brand new body',
      title: 'Renamed Doc',
    });
    expect(res.ok).toBe(true);
    const body = JSON.parse(res.output) as {
      ok: boolean;
      id: string;
      title: string;
      charLength: number;
      updatedAt: number;
    };
    expect(body.ok).toBe(true);
    expect(body.id).toBe(currentId);
    expect(body.title).toBe('Renamed Doc');
    expect(body.charLength).toBe('brand new body'.length);
    expect(res.meta?.op).toBe('replace_current');
    expect(res.meta?.targetId).toBe(currentId);
    expect(res.meta?.resultingUpdatedAt).toBe(body.updatedAt);

    const after = await getArtefact(currentId);
    expect(after?.content).toBe('brand new body');
    expect(after?.title).toBe('Renamed Doc');
    // fileName left alone per prefer-title-only rename
    expect(after?.fileName).toBe(before.fileName);
    expect(after?.updatedAt).toBeGreaterThan(before.updatedAt);
  });

  it('replace_current rejects stale expectedUpdatedAt', async () => {
    const currentId = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Doc',
      content: 'body',
    });
    const before = await getArtefact(currentId);
    if (!before) throw new Error('missing row');

    const tools = makeCraftTools({ chatId: CHAT, currentId, allowWrite: true });
    const res = await toolByName(tools, 'replace_current_artefact').execute({
      expectedUpdatedAt: before.updatedAt - 1,
      content: 'hijack',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Conflict/i);
    expect(res.error).toContain(String(before.updatedAt));
    expect((await getArtefact(currentId))?.content).toBe('body');
  });

  it('replace_current shrink without force fails; with force succeeds', async () => {
    const prior = 'x'.repeat(500);
    const currentId = await addGeneratedArtefact({
      chatId: CHAT,
      personaId: PERSONA,
      title: 'Big',
      content: prior,
    });
    const before = await getArtefact(currentId);
    if (!before) throw new Error('missing row');

    const small = 'tiny';
    const tools = makeCraftTools({ chatId: CHAT, currentId, allowWrite: true });
    const replace = toolByName(tools, 'replace_current_artefact');

    const denied = await replace.execute({
      expectedUpdatedAt: before.updatedAt,
      content: small,
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/force/i);
    expect((await getArtefact(currentId))?.content).toBe(prior);

    const allowed = await replace.execute({
      expectedUpdatedAt: before.updatedAt,
      content: small,
      force: true,
    });
    expect(allowed.ok).toBe(true);
    expect((await getArtefact(currentId))?.content).toBe(small);
  });

  it('allowWrite false omits replace_current_artefact', () => {
    const tools = makeCraftTools({
      chatId: CHAT,
      currentId: 'any',
      allowWrite: false,
    });
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['list_artefacts', 'read_current_artefact', 'read_other_artefact']);
    expect(names).not.toContain('replace_current_artefact');
  });
});
