// SPDX-License-Identifier: LGPL-3.0-only
import type { ServerConfig } from '@chatsundere/shared-types';
import * as v from 'valibot';

// http is permitted only for loopback hosts (dev); everything else must be
// https so a misconfigured operator is caught loudly at probe time (spec §4).
function isAcceptableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

const AcceptableUrl = v.pipe(v.string(), v.check(isAcceptableUrl));

// looseObject: unknown top-level keys are tolerated (forward compatibility).
const ServerConfigSchema = v.looseObject({
  proxyUrl: v.optional(AcceptableUrl),
  syncUrl: v.optional(AcceptableUrl),
  adminUrl: v.optional(AcceptableUrl),
  features: v.array(v.string()),
});

/** Validate a discovery response; null means "not a Chatsundere backend". */
export function parseServerConfig(value: unknown): ServerConfig | null {
  const result = v.safeParse(ServerConfigSchema, value);
  if (!result.success) return null;
  const { proxyUrl, syncUrl, adminUrl, features } = result.output;
  return {
    ...(proxyUrl === undefined ? {} : { proxyUrl }),
    ...(syncUrl === undefined ? {} : { syncUrl }),
    ...(adminUrl === undefined ? {} : { adminUrl }),
    features,
  };
}
