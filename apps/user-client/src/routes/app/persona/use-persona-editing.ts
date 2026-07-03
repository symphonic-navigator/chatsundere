// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback } from 'react';
import type { PersonaRow } from '../../../boot/client-data-db.js';
import { usePersona, useUpdatePersona } from '../../../data/personas.js';
import { useClass2Gate } from '../../../sync/gate.js';

/**
 * Always-save editing binding for a single persona. `patch` writes to the DB
 * immediately (no draft, no dirty flag) and the query cache invalidates.
 *
 * A persona edit is a Class-2 write (spec §5). When `disabled` (a linked account
 * whose server is unreachable, §11.2), `patch` becomes a guarded no-op so the
 * dense auto-save editor never fires doomed writes offline; every editing
 * surface should reflect `disabled`/`tooltip` on its controls (disabled over
 * hidden). A local-only user is never gated.
 */
export function usePersonaEditing(id: string | null): {
  persona: PersonaRow | null | undefined;
  patch: (p: Partial<Omit<PersonaRow, 'id' | 'createdAt'>>) => Promise<void>;
  disabled: boolean;
  tooltip: string | null;
} {
  const query = usePersona(id);
  const update = useUpdatePersona();
  const gate = useClass2Gate();
  const patch = useCallback(
    async (p: Partial<Omit<PersonaRow, 'id' | 'createdAt'>>) => {
      if (!id) return;
      if (gate.disabled) return; // guarded: the affordance should be disabled
      await update.mutateAsync({ id, patch: p });
    },
    [id, gate.disabled, update.mutateAsync],
  );
  return { persona: query.data, patch, disabled: gate.disabled, tooltip: gate.tooltip };
}
