// SPDX-License-Identifier: AGPL-3.0-only

import { collectDefaultMetrics, register } from 'prom-client';

let initialised = false;

export function initialiseMetrics(): void {
  if (initialised) return;
  collectDefaultMetrics({ register, prefix: 'sync_' });
  initialised = true;
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return { body: await register.metrics(), contentType: register.contentType };
}
