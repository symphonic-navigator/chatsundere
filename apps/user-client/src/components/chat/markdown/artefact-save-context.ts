// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext } from 'react';

export interface ArtefactSaveContextValue {
  chatId: string;
  personaId: string;
  /** Save a fenced code block (or Mermaid) as an artefact, with a toast. */
  saveCodeBlock: (input: { content: string; lang: string }) => void;
}

/** Provided by MessageBlock around a message's markdown so code/Mermaid blocks
 *  can offer a one-tap save. Null when markdown renders outside a chat message
 *  (e.g. the lightbox doc preview) — the save button is then not rendered. */
export const ArtefactSaveContext = createContext<ArtefactSaveContextValue | null>(null);

export function useArtefactSave(): ArtefactSaveContextValue | null {
  return useContext(ArtefactSaveContext);
}
