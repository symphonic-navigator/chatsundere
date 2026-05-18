// SPDX-License-Identifier: AGPL-3.0-only

import pino from 'pino';

export function createLogger(level: string, isDev: boolean) {
  return pino({
    level,
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
