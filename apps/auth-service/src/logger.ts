// SPDX-License-Identifier: AGPL-3.0-only
import pino, { type Logger } from 'pino';

const REDACT_PATHS: string[] = [
  '*.passphrase',
  '*.passphrase_confirmation',
  '*.recovery_key',
  '*.recovery_key_string',
  '*.wrapped_master_key',
  '*.wrap_nonce',
  '*.registration_request',
  '*.registration_record',
  '*.registration_response',
  '*.ke1',
  '*.ke2',
  '*.ke3',
  '*.startLoginRequest',
  '*.loginResponse',
  '*.finishLoginRequest',
  '*.prfOutput',
  '*.credential_id',
  '*.public_key',
  '*.proof',
  '*.verifier_key',
  '*.recovery_verifier_key',
  '*.access_token',
  '*.refresh_token',
  '*.cookie',
  '*.set-cookie',
  '*.authorization',
  '*.AUTH_JWT_PRIVATE_KEY',
  '*.INVITATION_HMAC_KEY',
  '*.REFRESH_TOKEN_HMAC_KEY',
  '*.HMAC_KEY_PENDING_CODES',
];

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  });
}
