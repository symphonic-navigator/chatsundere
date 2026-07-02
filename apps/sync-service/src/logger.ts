// SPDX-License-Identifier: AGPL-3.0-only

import pino from 'pino';

// Never log S3 credentials, even if an env-shaped object is ever logged (blob
// spec §8/§18 [L]). Defence-in-depth: the hand-rolled S3 client keeps creds out
// of its error messages, but this redacts them at the logger too.
const REDACT_PATHS = [
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  '*.S3_ACCESS_KEY_ID',
  '*.S3_SECRET_ACCESS_KEY',
  'env.S3_ACCESS_KEY_ID',
  'env.S3_SECRET_ACCESS_KEY',
];

export function createLogger(level: string, isDev: boolean) {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  });
}
