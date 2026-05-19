// SPDX-License-Identifier: AGPL-3.0-only
import { assertRuntimeSupport } from '@chatsundere/crypto';

const MISSING_PATTERN = /Missing required runtime APIs:\s*(.+)$/i;

export function checkRuntime(): { ok: true } | { ok: false; missing: string[] } {
  try {
    assertRuntimeSupport();
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const match = message.match(MISSING_PATTERN);
    const missing = match?.[1]?.split(',').map((s) => s.trim()) ?? ['unknown'];
    return { ok: false, missing };
  }
}
