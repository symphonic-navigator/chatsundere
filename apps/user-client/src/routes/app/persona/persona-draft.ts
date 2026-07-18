// SPDX-License-Identifier: AGPL-3.0-only
import type {
  MindspaceRow,
  PersonaRow,
  ProviderRow,
  SettingsRow,
} from '../../../boot/client-data-db.js';

export type DraftPersona = Omit<PersonaRow, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Generate a safe default draft for the persona create step. Falls back to
 * sensible constants when query data is still loading (undefined).
 */
export function defaultDraft(
  settings: SettingsRow | undefined,
  mindspaces: MindspaceRow[] | undefined,
  providers: ProviderRow[] | undefined,
): DraftPersona {
  const defaultMindspace = mindspaces?.find((m) => m.id === settings?.defaultMindspaceId);
  const firstEnabled = providers?.find((p) => p.enabled);
  return {
    name: '',
    tagline: '',
    colour: defaultMindspace?.palette.accent ?? '#c9a84c',
    font: 'sans',
    instructions: '',
    canonicalId: null,
    providerId: firstEnabled?.id ?? '',
    modelId: '',
    backgroundCanonicalId: null,
    greetingUsesBackgroundModel: false,
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    useMemory: true,
    memoryInstructions: '',
  };
}
