// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { toBase64Url } from '../../src/encoding/base64url.js';
import { computeBlindId, deriveDek, encodeRow } from '../../src/index.js';
import { PADDED_COLLECTIONS, openRecord, sealRecord } from '../../src/sync-envelope/seal.js';
import { asMasterKey } from '../../src/types.js';

const mk = asMasterKey(new Uint8Array(32).fill(7));
const byId = (row: unknown) => (row as { id: string }).id;

describe('sealRecord / openRecord', () => {
  it('round-trips an unpadded chats row', async () => {
    const row = { id: 'c1', personaId: 'p1', title: 'hi', updatedAt: 5 };
    const sealed = await sealRecord(mk, 'chats', row.id, row);
    expect(await openRecord(mk, 'chats', sealed.blindId, sealed, byId)).toEqual(row);
  });

  it('round-trips a padded personas row with adultPersona: true', async () => {
    const row = { id: 'p1', name: 'x', adultPersona: true, instructions: 'long'.repeat(50) };
    const sealed = await sealRecord(mk, 'personas', row.id, row);
    expect(await openRecord(mk, 'personas', sealed.blindId, sealed, byId)).toEqual(row);
  });

  it('round-trips a providers row with a nested EncryptedBlob Uint8Array field', async () => {
    const row = {
      id: 'pr1',
      apiKey: { ciphertext: new Uint8Array([9, 8, 7]), nonce: new Uint8Array(12) },
    };
    const opened = (await openRecord(
      mk,
      'providers',
      (
        await sealRecord(mk, 'providers', row.id, row)
      ).blindId,
      await sealRecord(mk, 'providers', row.id, row),
      byId,
    )) as typeof row;
    expect(opened.apiKey.ciphertext).toBeInstanceOf(Uint8Array);
    expect([...opened.apiKey.ciphertext]).toEqual([9, 8, 7]);
  });

  it('round-trips a vectors row with the composite key d1#0', async () => {
    const row = {
      id: 'd1#0',
      codes: new Uint8Array(64),
      scales: new Uint8Array(8),
      tags: ['lib1'],
    };
    const sealed = await sealRecord(mk, 'vectors', row.id, row);
    expect(await openRecord(mk, 'vectors', sealed.blindId, sealed, byId)).toEqual(row);
  });

  it('produces a fresh nonce and ciphertext per seal', async () => {
    const row = { id: 'c1', title: 'same' };
    const a = await sealRecord(mk, 'chats', row.id, row);
    const b = await sealRecord(mk, 'chats', row.id, row);
    expect([...a.nonce]).not.toEqual([...b.nonce]);
    expect([...a.ciphertext]).not.toEqual([...b.ciphertext]);
  });

  it('AAD tamper matrix: foreign blindId, foreign collection, flipped byte each throw', async () => {
    const row = { id: 'c1', title: 'hi' };
    const sealed = await sealRecord(mk, 'chats', row.id, row);
    const foreignBlind = await computeBlindId(mk, 'chats', 'other');
    await expect(openRecord(mk, 'chats', foreignBlind, sealed, byId)).rejects.toThrow();
    await expect(openRecord(mk, 'messages', sealed.blindId, sealed, byId)).rejects.toThrow();
    const flipped = { nonce: sealed.nonce, ciphertext: new Uint8Array(sealed.ciphertext) };
    flipped.ciphertext[0] = (flipped.ciphertext[0] ?? 0) ^ 0xff;
    await expect(openRecord(mk, 'chats', sealed.blindId, flipped, byId)).rejects.toThrow();
  });

  it('rejects a row whose inner key does not re-HMAC to the fetched blind id', async () => {
    const row = { id: 'a', title: 'hi' };
    const sealed = await sealRecord(mk, 'chats', row.id, row);
    // AAD passes (same blindId), but extractKey lies about the inner key.
    await expect(openRecord(mk, 'chats', sealed.blindId, sealed, () => 'b')).rejects.toThrow();
  });

  it('pads padded collections only; GCM tag adds 16 bytes', async () => {
    const personas = await sealRecord(mk, 'personas', 'p1', { id: 'p1', name: 'x' });
    expect(PADDED_COLLECTIONS.has('personas')).toBe(true);
    expect((personas.ciphertext.length - 16) % 1024).toBe(0); // bucketed plaintext
    const chats = await sealRecord(mk, 'chats', 'c1', { id: 'c1', title: 'hi' });
    // unpadded: plaintext = 4 (prefix) + json length; ciphertext = plaintext + 16
    const json = new TextEncoder().encode(JSON.stringify({ id: 'c1', title: 'hi' }));
    expect(chats.ciphertext.length).toBe(4 + json.length + 16);
    const grants = await sealRecord(mk, 'mcpOAuthGrants', 'g1', { id: 'g1', tokens: null });
    expect(PADDED_COLLECTIONS.has('mcpOAuthGrants')).toBe(true);
    expect((grants.ciphertext.length - 16) % 1024).toBe(0);
  });

  it('opens an unpadded grant record sealed before padding', async () => {
    const row = { id: 'g1', tokens: null };
    const blindId = await computeBlindId(mk, 'mcpOAuthGrants', row.id);
    // Hand-built legacy record: 4-byte LE length prefix + JSON, no bucket padding.
    const encoded = encodeRow(row);
    const plaintext = new Uint8Array(4 + encoded.length);
    new DataView(plaintext.buffer).setUint32(0, encoded.length, true);
    plaintext.set(encoded, 4);
    const enc = new TextEncoder();
    const aadParts = [enc.encode('chatsundere-sync-v1'), enc.encode('mcpOAuthGrants'), blindId];
    const aad = new Uint8Array(aadParts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const part of aadParts) {
      aad.set(part, off);
      off += part.length;
    }
    const dek = await deriveDek(mk, 'sync/collection/mcpOAuthGrants-v1');
    const key = await crypto.subtle.importKey(
      'raw',
      dek as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad },
        key,
        plaintext as BufferSource,
      ),
    );
    expect(await openRecord(mk, 'mcpOAuthGrants', blindId, { nonce, ciphertext }, byId)).toEqual(
      row,
    );
  });

  it('ciphertextHash equals SHA-256(ciphertext)', async () => {
    const sealed = await sealRecord(mk, 'chats', 'c1', { id: 'c1' });
    const expected = new Uint8Array(
      await crypto.subtle.digest('SHA-256', sealed.ciphertext as BufferSource),
    );
    expect([...sealed.ciphertextHash]).toEqual([...expected]);
  });

  it('NSFW invariant: no adultPersona/nsfw/true bytes on the wire outside ciphertext', async () => {
    const persona = await sealRecord(mk, 'personas', 'p1', { id: 'p1', adultPersona: true });
    const seed = await sealRecord(mk, 'seedTemplates', 's1', { id: 's1', nsfw: true });
    for (const s of [persona, seed]) {
      const wire = [
        'personas',
        toBase64Url(s.blindId),
        toBase64Url(s.nonce),
        toBase64Url(s.ciphertextHash),
      ].join('|');
      expect(wire).not.toContain('adultPersona');
      expect(wire).not.toContain('nsfw');
      expect(wire).not.toContain('true');
    }
  });
});
