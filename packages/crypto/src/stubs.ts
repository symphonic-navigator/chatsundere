// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from './errors.js';
import type { AMK, MasterKey, RecoveryKey, WrappedKey } from './types.js';

const NOT_IMPLEMENTED = 'Stub — implement in the crypto unit';

function stub(): never {
  throw new CryptoError('internal', NOT_IMPLEMENTED);
}

export async function generateMasterKey(): Promise<MasterKey> {
  return stub();
}

export async function generateRecoveryKey(): Promise<RecoveryKey> {
  return stub();
}

export function recoveryKeyToBase32(_key: RecoveryKey): string {
  return stub();
}

export function recoveryKeyFromBase32(_s: string): RecoveryKey {
  return stub();
}

export async function deriveAmkFromOpaqueExportKey(_exportKey: Uint8Array): Promise<AMK> {
  return stub();
}

export async function deriveAmkFromPrfOutput(_prfOutput: Uint8Array): Promise<AMK> {
  return stub();
}

export async function deriveAmkFromRecoveryKey(_rk: RecoveryKey): Promise<AMK> {
  return stub();
}

export async function wrapMasterKey(_mk: MasterKey, _amk: AMK): Promise<WrappedKey> {
  return stub();
}

export async function unwrapMasterKey(_wrapped: WrappedKey, _amk: AMK): Promise<MasterKey> {
  return stub();
}

export async function deriveMkProofValue(_mk: MasterKey): Promise<Uint8Array> {
  return stub();
}
