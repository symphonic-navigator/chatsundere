// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { addMediaArtefact, findMediaArtefactByKey } from '../../src/data/media-artefacts.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';

function setOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
}

function audioInput(chatId = 'c1') {
  return {
    chatId,
    personaId: 'p1',
    key: 'gen:abc',
    kind: 'audio' as const,
    mime: 'audio/mpeg',
    title: 'Morning Birdsong!',
    bytes: new Blob(['ID3-audio-bytes'], { type: 'audio/mpeg' }),
    probe: { durationMs: 4200, poster: null },
    serverName: 'ElevenLabs',
    toolName: 'generate_speech',
  };
}

function videoInput(chatId = 'c1') {
  return {
    ...audioInput(chatId),
    key: 'url:https://cdn.example/v.mp4',
    kind: 'video' as const,
    mime: 'video/mp4',
    title: 'A Short Clip',
    bytes: new Blob(['video-bytes'], { type: 'video/mp4' }),
    probe: {
      durationMs: 8000,
      poster: { blob: new Blob(['poster'], { type: 'image/jpeg' }), width: 640, height: 360 },
    },
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _setTriggerCycle(async () => undefined);
  setImmediateDrain(async () => undefined);
});

afterEach(async () => {
  _resetTriggersForTests();
  setImmediateDrain(async () => undefined);
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ mk: null });
});

describe('addMediaArtefact', () => {
  it('writes an audio artefact with provenance and the de-dup key', async () => {
    const id = await addMediaArtefact(audioInput());
    const row = await getClientDataDb().artefacts.get(id);
    expect(row?.kind).toBe('audio');
    expect(row?.format).toBe('audio');
    expect(row?.origin).toBe('generated');
    expect(row?.mime).toBe('audio/mpeg');
    expect(row?.title).toBe('Morning Birdsong!');
    expect(row?.fileName).toBe('morning-birdsong.mp3');
    expect(row?.mediaMeta).toEqual({
      key: 'gen:abc',
      durationMs: 4200,
      serverName: 'ElevenLabs',
      toolName: 'generate_speech',
    });
    expect(row?.thumbBlob).toBeUndefined();
    expect((row?.blob as Blob).size).toBe(audioInput().bytes.size);
  });

  it('stores the video poster as the thumbnail with its dimensions', async () => {
    const id = await addMediaArtefact(videoInput());
    const row = await getClientDataDb().artefacts.get(id);
    expect(row?.kind).toBe('video');
    expect(row?.format).toBe('video');
    expect(row?.fileName).toBe('a-short-clip.mp4');
    expect((row?.thumbBlob as Blob).size).toBe(6);
    expect(row?.width).toBe(640);
    expect(row?.height).toBe(360);
  });

  it('local-only: writes no outbox rows and no refs', async () => {
    const id = await addMediaArtefact(videoInput());
    const row = await getClientDataDb().artefacts.get(id);
    expect(row?.blobRef).toBeUndefined();
    expect(await getClientDataDb().syncOutbox.count()).toBe(0);
  });

  it('linked: enqueues a blob-put per blob plus one upsert', async () => {
    setOnline();
    const id = await addMediaArtefact(videoInput());
    const row = await getClientDataDb().artefacts.get(id);
    const rows = await getClientDataDb().syncOutbox.toArray();
    const puts = rows.filter((r) => r.op === 'blob-put').map((r) => r.blobId);
    expect(puts.sort()).toEqual([row?.blobRef?.blobId, row?.thumbBlobRef?.blobId].sort());
    expect(rows.filter((r) => r.op === 'upsert')).toHaveLength(1);
  });

  it('linked audio: one blob-put (no poster) plus one upsert', async () => {
    setOnline();
    await addMediaArtefact(audioInput());
    const rows = await getClientDataDb().syncOutbox.toArray();
    expect(rows.filter((r) => r.op === 'blob-put')).toHaveLength(1);
    expect(rows.filter((r) => r.op === 'upsert')).toHaveLength(1);
  });
});

describe('findMediaArtefactByKey', () => {
  it('finds a saved artefact by chat and key', async () => {
    const id = await addMediaArtefact(audioInput('c1'));
    expect((await findMediaArtefactByKey('c1', 'gen:abc'))?.id).toBe(id);
  });

  it('does not find it in another chat or under another key', async () => {
    await addMediaArtefact(audioInput('c1'));
    expect(await findMediaArtefactByKey('c2', 'gen:abc')).toBeUndefined();
    expect(await findMediaArtefactByKey('c1', 'gen:other')).toBeUndefined();
  });
});
