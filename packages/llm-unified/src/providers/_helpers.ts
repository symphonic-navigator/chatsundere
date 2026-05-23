// SPDX-License-Identifier: LGPL-3.0-only

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
