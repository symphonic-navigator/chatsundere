// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback } from 'react';
import type { PersonaRow } from '../../../boot/client-data-db.js';
import { usePersona, useUpdatePersona } from '../../../data/personas.js';

/** Always-save editing binding for a single persona. `patch` writes to the DB
 *  immediately (no draft, no dirty flag) and the query cache invalidates. */
export function usePersonaEditing(id: string | null): {
  persona: PersonaRow | null | undefined;
  patch: (p: Partial<Omit<PersonaRow, 'id' | 'createdAt'>>) => Promise<void>;
} {
  const query = usePersona(id);
  const update = useUpdatePersona();
  const patch = useCallback(
    async (p: Partial<Omit<PersonaRow, 'id' | 'createdAt'>>) => {
      if (!id) return;
      await update.mutateAsync({ id, patch: p });
    },
    [id, update.mutateAsync],
  );
  return { persona: query.data, patch };
}
