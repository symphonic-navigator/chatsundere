// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from 'vitest';
import type { MindspaceRow, PersonaRow } from '../../src/boot/client-data-db.js';
import { useMindspaceStore } from '../../src/state/mindspace.store.js';

function ms(id: string, name: string, accent: string): MindspaceRow {
  return {
    id,
    displayName: name,
    palette: {
      bg: '#000',
      surfaceBase: 'rgba(0,0,0,0)',
      surfaceRaised: 'rgba(0,0,0,0)',
      surfaceInput: 'rgba(0,0,0,0)',
      accent,
      accentSubtle: 'rgba(0,0,0,0)',
      accentBorder: 'rgba(0,0,0,0)',
      accentBorderActive: 'rgba(0,0,0,0)',
      accentGlow: 'rgba(0,0,0,0)',
      text: { primary: '#fff', secondary: '#fff', muted: '#fff', ghost: '#fff' },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 0,
  };
}

function persona(id: string, mindspaceId: string | null): PersonaRow {
  return {
    id,
    name: 'p',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'i',
    canonicalId: null,
    providerId: 'pv',
    modelId: 'm',
    mindspaceId,
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
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('mindspace store', () => {
  beforeEach(() => {
    useMindspaceStore.getState().reset();
  });

  it('returns null resolved before update is called', () => {
    expect(useMindspaceStore.getState().resolved).toBeNull();
  });

  it('resolves to user default with no active persona', () => {
    const aurum = ms('aurum', 'Aurum', '#c9a84c');
    useMindspaceStore.getState().update({
      persona: null,
      defaultMindspaceId: 'aurum',
      defaultTexture: null,
      mindspaces: [aurum],
    });
    expect(useMindspaceStore.getState().resolved?.id).toBe('aurum');
  });

  it('resolves to persona override when set', () => {
    const aurum = ms('aurum', 'Aurum', '#c9a84c');
    const verdan = ms('verdan', 'Verdan', '#6aa97a');
    useMindspaceStore.getState().update({
      persona: persona('p1', 'verdan'),
      defaultMindspaceId: 'aurum',
      defaultTexture: null,
      mindspaces: [aurum, verdan],
    });
    expect(useMindspaceStore.getState().resolved?.id).toBe('verdan');
  });

  it('reset clears resolved back to null', () => {
    const aurum = ms('aurum', 'Aurum', '#c9a84c');
    useMindspaceStore.getState().update({
      persona: null,
      defaultMindspaceId: 'aurum',
      defaultTexture: null,
      mindspaces: [aurum],
    });
    useMindspaceStore.getState().reset();
    expect(useMindspaceStore.getState().resolved).toBeNull();
  });
});
