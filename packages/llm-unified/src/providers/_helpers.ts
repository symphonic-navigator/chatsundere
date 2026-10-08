// SPDX-License-Identifier: LGPL-3.0-only

import type { Offering } from '../catalogue/types.js';
import type { ConfigField } from '../types.js';

export function apiKeyField(label: string): ConfigField {
  return {
    key: 'api_key',
    label,
    fieldType: 'password',
    secret: true,
    required: true,
    description: 'Encrypted at rest using your Master Key. Stored only on this device.',
  };
}

/** Mark an offering as live-probed to accept replayed tool calls whose tool is
 *  absent from the request (`orphan-tool-replay` suite scenario). */
export function withOrphanReplay(o: Offering): Offering {
  return {
    ...o,
    profile: { ...o.profile, toolCalls: { ...o.profile.toolCalls, orphanReplay: true } },
  };
}
