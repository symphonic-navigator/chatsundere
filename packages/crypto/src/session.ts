// SPDX-License-Identifier: LGPL-3.0-only

import { deriveDek } from './dek.js';
import { CryptoError } from './errors.js';
import { aeadDecrypt, aeadEncrypt } from './primitives/aead.js';
import { computeRecoveryProof } from './recovery.js';
import { type AMK, type DEK, type MasterKey, type RecoveryKey, WRAP_ALGO } from './types.js';

export interface MasterKeySessionInit {
  mk: MasterKey;
  userId: string;
  username: string;
  mode: 'local' | 'linked';
  online: boolean;
  role?: 'primary_admin' | 'admin' | 'user';
  accessToken?: string;
  recoveryKey?: RecoveryKey;
}

export interface MasterKeySession {
  readonly id: string;
  readonly userId: string;
  readonly username: string;
  readonly mode: 'local' | 'linked';
  readonly online: boolean;
  readonly role?: 'primary_admin' | 'admin' | 'user';
  readonly accessToken?: string;
  deriveDek(context: string): Promise<DEK>;
  encrypt(
    plaintext: Uint8Array,
    context: string,
  ): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }>;
  decrypt(args: {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    context: string;
  }): Promise<Uint8Array>;
  produceRecoveryProof(nonce: Uint8Array, serverId: string): Promise<Uint8Array>;
  close(): void;
}

export function createMasterKeySession(init: MasterKeySessionInit): MasterKeySession {
  let mk: MasterKey | null = init.mk;
  let recoveryKey: RecoveryKey | null = init.recoveryKey ?? null;
  const id = crypto.randomUUID();

  function requireMk(): MasterKey {
    if (!mk) throw new CryptoError('expired_state', 'session has been closed');
    return mk;
  }

  function contextAad(context: string): Uint8Array {
    return new TextEncoder().encode(`${init.userId}::dek::${context}::v1`);
  }

  return {
    id,
    userId: init.userId,
    username: init.username,
    mode: init.mode,
    online: init.online,
    role: init.role,
    accessToken: init.accessToken,

    async deriveDek(context: string) {
      // Capture at call time: if close() races with this await, the local
      // reference is still the valid bytes we started with.
      const localMk = requireMk();
      return deriveDek(localMk, context);
    },

    async encrypt(plaintext: Uint8Array, context: string) {
      // Capture before the first await to avoid a close()-during-await race.
      const localMk = requireMk();
      const dek = await deriveDek(localMk, context);
      const aad = contextAad(context);
      // DEKs are 32-byte AES-256 keys, identical at runtime to AMKs;
      // the brand distinction is compile-time discipline only.
      const dekAsKey = dek as unknown as AMK;
      const wrapped = await aeadEncrypt(dekAsKey, plaintext, aad);
      return { ciphertext: wrapped.ciphertext, nonce: wrapped.nonce };
    },

    async decrypt(args: { ciphertext: Uint8Array; nonce: Uint8Array; context: string }) {
      // Capture before the first await to avoid a close()-during-await race.
      const localMk = requireMk();
      const dek = await deriveDek(localMk, args.context);
      const aad = contextAad(args.context);
      // Same brand cast as in encrypt — DEK and AMK are both 32-byte keys.
      const dekAsKey = dek as unknown as AMK;
      // integrity_hmac is an IndexedDB persistence invariant, not an at-encrypt-time
      // field; session-level encrypt/decrypt operates on transient data, so we
      // supply an empty buffer here.
      return aeadDecrypt(
        dekAsKey,
        {
          ciphertext: args.ciphertext,
          nonce: args.nonce,
          algo: WRAP_ALGO,
          aad,
          integrity_hmac: new Uint8Array(),
        },
        aad,
      );
    },

    async produceRecoveryProof(nonce: Uint8Array, serverId: string) {
      if (!recoveryKey) {
        throw new CryptoError('wrong_recovery_key', 'session has no recovery key in scope');
      }
      return computeRecoveryProof(recoveryKey, nonce, init.username, serverId);
    },

    close() {
      if (mk) {
        // Zero the underlying buffer before dropping the reference (best-effort).
        mk.fill(0);
        mk = null;
      }
      if (recoveryKey) {
        recoveryKey.fill(0);
        recoveryKey = null;
      }
    },
  };
}
