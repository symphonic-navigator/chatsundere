// SPDX-License-Identifier: LGPL-3.0-only

export { ALGO_VERSION, HKDF_HASH, WRAP_ALGO } from './types.js';
export type { AMK, DEK, MasterKey, RecoveryKey, WrappedKey } from './types.js';
export { CryptoError } from './errors.js';
export type { CryptoErrorCode } from './errors.js';
export {
  deriveAmkFromOpaqueExportKey,
  deriveAmkFromPrfOutput,
  deriveAmkFromRecoveryKey,
  deriveMkProofValue,
  generateMasterKey,
  generateRecoveryKey,
  recoveryKeyFromBase32,
  recoveryKeyToBase32,
  unwrapMasterKey,
  wrapMasterKey,
} from './stubs.js';
