// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'bun:test';
import {
  SYNC_COLLECTIONS,
  type SyncPushRequest,
  type SyncPushResult,
  revokedJtiKey,
  revokedSubKey,
} from '../src/index.js';

describe('sync shared-types', () => {
  test('revocation key builders match the spec §9 shape', () => {
    expect(revokedJtiKey('j1')).toBe('revoked:jti:j1');
    expect(revokedSubKey('s1')).toBe('revoked:sub:s1');
  });

  test('the collection allowlist has the 18 v1 collections incl. the 3 blob collections', () => {
    expect(SYNC_COLLECTIONS).toContain('personas');
    expect(SYNC_COLLECTIONS).toContain('vectors');
    // WS-D (blob transport) admitted the three blob-bearing collections: their
    // records sync with BlobRef sentinels, while the bytes travel sealed via the
    // separate blob channel.
    expect(SYNC_COLLECTIONS).toContain('personaAvatars');
    expect(SYNC_COLLECTIONS).toContain('artefacts');
    expect(SYNC_COLLECTIONS).toContain('attachments');
    expect(SYNC_COLLECTIONS.length).toBe(18);
  });

  test('the wire types compile with the documented shapes', () => {
    const req: SyncPushRequest = {
      records: [
        {
          blindId: 'b',
          collection: 'chats',
          envelopeVersion: 1,
          baseRev: 0,
          deleted: false,
          nonce: 'n',
          ciphertext: 'c',
          ciphertextHash: 'h',
        },
      ],
    };
    const ok: SyncPushResult = { status: 'ok', rev: 1 };
    const err: SyncPushResult = {
      status: 'error',
      code: 'quota_exceeded',
      usedBytes: 1,
      quotaBytes: 2,
    };
    expect(req.records[0]?.collection).toBe('chats');
    expect(ok.status).toBe('ok');
    expect(err.status).toBe('error');
  });
});
