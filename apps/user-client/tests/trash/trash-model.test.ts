import { describe, expect, it } from 'vitest';

import {
  PARENT_FIELD_COLLECTION,
  TRASH_HIERARCHY,
  deriveTrashMeta,
} from '../../src/trash/trash-model';

describe('deriveTrashMeta', () => {
  it('groups a chat under its persona card', () => {
    expect(deriveTrashMeta('chats', 'c1', { id: 'c1', personaId: 'p1' })).toEqual({
      entityKind: 'chat',
      rootGroup: 'persona:p1',
      parentRef: { field: 'personaId', id: 'p1' },
    });
  });

  it('treats a persona as its own root card', () => {
    expect(deriveTrashMeta('personas', 'p1', { id: 'p1' })).toEqual({
      entityKind: 'persona',
      rootGroup: 'persona:p1',
      parentRef: null,
    });
  });

  it('groups a document under its library card', () => {
    expect(deriveTrashMeta('documents', 'd1', { id: 'd1', libraryId: 'l1' })).toEqual({
      entityKind: 'document',
      rootGroup: 'library:l1',
      parentRef: { field: 'libraryId', id: 'l1' },
    });
  });

  it('lifts a message rootGroup to the persona via the resolver', () => {
    expect(deriveTrashMeta('messages', 'm1', { id: 'm1', chatId: 'c1' }, () => 'p1')).toEqual({
      entityKind: 'chatChild',
      rootGroup: 'persona:p1',
      parentRef: { field: 'chatId', id: 'c1' },
    });
  });

  it('falls back to the chat rootGroup for a message with no resolver', () => {
    expect(deriveTrashMeta('messages', 'm1', { id: 'm1', chatId: 'c1' })).toEqual({
      entityKind: 'chatChild',
      rootGroup: 'chats:c1',
      parentRef: { field: 'chatId', id: 'c1' },
    });
  });

  it('falls back to the chat rootGroup when the resolver returns null', () => {
    expect(deriveTrashMeta('messages', 'm1', { id: 'm1', chatId: 'c1' }, () => null)).toEqual({
      entityKind: 'chatChild',
      rootGroup: 'chats:c1',
      parentRef: { field: 'chatId', id: 'c1' },
    });
  });

  it('groups a pill under its message (best-effort, no deep resolver)', () => {
    expect(deriveTrashMeta('pills', 'pl1', { id: 'pl1', messageId: 'm1' })).toEqual({
      entityKind: 'chatChild',
      rootGroup: 'messages:m1',
      parentRef: { field: 'messageId', id: 'm1' },
    });
  });

  it('treats a personaAvatar key as its persona id', () => {
    expect(deriveTrashMeta('personaAvatars', 'p1', {})).toEqual({
      entityKind: 'chatChild',
      rootGroup: 'persona:p1',
      parentRef: { field: 'personaId', id: 'p1' },
    });
  });

  it('falls back to a top-level chat card when personaId is absent', () => {
    expect(deriveTrashMeta('chats', 'c9', { id: 'c9' })).toEqual({
      entityKind: 'chat',
      rootGroup: 'chats:c9',
      parentRef: null,
    });
  });

  it('treats an empty-string foreign key as absent', () => {
    expect(deriveTrashMeta('chats', 'c9', { id: 'c9', personaId: '' })).toEqual({
      entityKind: 'chat',
      rootGroup: 'chats:c9',
      parentRef: null,
    });
  });

  it('groups a memory row under its persona card', () => {
    expect(deriveTrashMeta('memoryJournal', 'j1', { id: 'j1', personaId: 'p1' })).toEqual({
      entityKind: 'memory',
      rootGroup: 'persona:p1',
      parentRef: { field: 'personaId', id: 'p1' },
    });
  });

  it('falls back to a top-level memory card when personaId is absent', () => {
    expect(deriveTrashMeta('memoryBody', 'b1', { id: 'b1' })).toEqual({
      entityKind: 'memory',
      rootGroup: 'memoryBody:b1',
      parentRef: null,
    });
  });

  it('lifts an attachment rootGroup to the persona via the resolver', () => {
    expect(deriveTrashMeta('attachments', 'a1', { id: 'a1', chatId: 'c1' }, () => 'p1')).toEqual({
      entityKind: 'chatChild',
      rootGroup: 'persona:p1',
      parentRef: { field: 'chatId', id: 'c1' },
    });
  });

  it('gives an unknown collection an ungrouped top-level card', () => {
    expect(deriveTrashMeta('vectors', 'v1', { id: 'v1' })).toEqual({
      entityKind: 'chatChild',
      rootGroup: 'vectors:v1',
      parentRef: null,
    });
  });
});

describe('PARENT_FIELD_COLLECTION', () => {
  it('maps each parent field to its parent collection', () => {
    expect(PARENT_FIELD_COLLECTION.personaId).toBe('personas');
    expect(PARENT_FIELD_COLLECTION.chatId).toBe('chats');
    expect(PARENT_FIELD_COLLECTION.messageId).toBe('messages');
    expect(PARENT_FIELD_COLLECTION.libraryId).toBe('libraries');
  });
});

describe('TRASH_HIERARCHY', () => {
  it("lists a persona's direct cascade children", () => {
    expect(TRASH_HIERARCHY.personas).toEqual([
      { collection: 'chats', field: 'personaId' },
      { collection: 'memoryJournal', field: 'personaId' },
      { collection: 'memoryBody', field: 'personaId' },
      { collection: 'personaAvatars', field: 'personaId' },
    ]);
  });

  it("lists a chat's direct cascade children", () => {
    expect(TRASH_HIERARCHY.chats).toEqual([
      { collection: 'messages', field: 'chatId' },
      { collection: 'attachments', field: 'chatId' },
      { collection: 'artefacts', field: 'chatId' },
    ]);
  });
});
