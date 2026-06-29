// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { IMAGE_PLACEHOLDER_TEXT, exportPersona } from '../../src/data/chatsundere-export.js';
import { gunzip, untar } from '../../src/lib/chatsune-import/archive-reader.js';

async function readArchiveFile(blob: Blob, name: string): Promise<unknown> {
  const files = untar(await gunzip(new Uint8Array(await blob.arrayBuffer())));
  const f = files.find((e) => e.name === name);
  return f ? JSON.parse(new TextDecoder().decode(f.bytes)) : undefined;
}

describe('exportPersona', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    const db = getClientDataDb();
    // Seed: a provider with an encrypted key, a persona bound to it,
    // one chat, one message, and one image attachment.
    await db.providers.add({
      id: 'prov-1',
      templateId: 'anthropic',
      displayName: 'A',
      baseUrl: '',
      apiKey: { ciphertext: new Uint8Array([9, 9, 9]), nonce: new Uint8Array([1]), version: 1 },
      routing: 'proxy',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    } as never);
    await db.personas.add({
      id: 'p1',
      name: 'Fable',
      providerId: 'prov-1',
      modelId: 'claude-opus-4-8',
      mcpOverrides: { 'srv-1': true },
      libraryIds: ['lib-x'],
      lastInteractionAt: 123,
    } as never);
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: 't',
      createdAt: 1,
      lastMessageAt: 2,
    } as never);
    await db.messages.add({
      id: 'm1',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      createdAt: 1,
    } as never);
    await db.attachments.add({
      id: 'a1',
      chatId: 'c1',
      messageId: 'm1',
      origin: 'upload',
      kind: 'image',
      fileName: 'x.png',
      mime: 'image/png',
      order: 0,
      state: 'active',
      blob: new Blob([new Uint8Array([1, 2])]),
    } as never);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('exports modelRef and never the provider key (security invariant)', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    const persona = (await readArchiveFile(blob, 'persona.json')) as Record<string, unknown>;
    expect(persona.modelRef).toEqual({
      providerTemplateId: 'anthropic',
      modelId: 'claude-opus-4-8',
    });
    expect(persona.providerId).toBeUndefined();
    expect(persona.modelId).toBeUndefined();
    expect(persona.mcpOverrides).toBeUndefined();
    expect(persona.libraryIds).toBeUndefined();
    expect(persona.lastInteractionAt).toBeUndefined();
    // No archive file may carry the key bytes (9,9,9) — assert no apiKey anywhere.
    expect(JSON.stringify(persona)).not.toContain('apiKey');
    // Belt-and-braces: decompress the whole archive and scan every entry's UTF-8
    // text for the string 'apiKey' — the provider key is an EncryptedBlob whose
    // JSON representation would surface the key name, not just the ciphertext bytes.
    const dec = new TextDecoder();
    const allEntries = untar(await gunzip(new Uint8Array(await blob.arrayBuffer())));
    for (const entry of allEntries) {
      expect(
        dec.decode(entry.bytes),
        `entry "${entry.name}" must not contain apiKey`,
      ).not.toContain('apiKey');
    }
  });

  it('replaces a dropped image attachment with a placeholder when images off', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    const attachments = (await readArchiveFile(blob, 'attachments.json')) as Array<
      Record<string, unknown>
    >;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.kind).toBe('text');
    expect(attachments[0]?.text).toBe(IMAGE_PLACEHOLDER_TEXT);
    const names = untar(await gunzip(new Uint8Array(await blob.arrayBuffer()))).map((f) => f.name);
    expect(names.some((n) => n.startsWith('blobs/'))).toBe(false);
  });
});
