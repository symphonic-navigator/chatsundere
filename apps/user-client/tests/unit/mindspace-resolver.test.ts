// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { MindspaceRow, PersonaRow } from '../../src/boot/client-data-db.js';
import { resolveMindspace } from '../../src/state/mindspace-resolver.js';

function makeMindspace(id: string, displayName: string): MindspaceRow {
  return {
    id,
    displayName,
    palette: {
      bg: '#000',
      surfaceBase: 'rgba(0,0,0,0)',
      surfaceRaised: 'rgba(0,0,0,0)',
      surfaceInput: 'rgba(0,0,0,0)',
      accent: '#fff',
      accentSubtle: 'rgba(255,255,255,0)',
      accentBorder: 'rgba(255,255,255,0)',
      accentBorderActive: 'rgba(255,255,255,0)',
      accentGlow: 'rgba(255,255,255,0)',
      text: {
        primary: '#fff',
        secondary: '#fff',
        muted: '#fff',
        ghost: '#fff',
      },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 0,
  };
}

function makePersona(id: string, mindspaceId: string | null): PersonaRow {
  return {
    id,
    name: 'p',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'i',
    providerId: 'pv',
    modelId: 'm',
    mindspaceId,
    aboutMeOverride: null,
    temperature: 0.85,
    adultPersona: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('resolveMindspace', () => {
  const aurum = makeMindspace('aurum', 'Aurum');
  const verdan = makeMindspace('verdan', 'Verdan');
  const mindspaces = [aurum, verdan];

  it('returns persona-override mindspace when set', () => {
    const persona = makePersona('p', 'verdan');
    const resolved = resolveMindspace({ persona, defaultMindspaceId: 'aurum', mindspaces });
    expect(resolved.id).toBe('verdan');
  });

  it('returns user default when persona has no mindspace override', () => {
    const persona = makePersona('p', null);
    const resolved = resolveMindspace({ persona, defaultMindspaceId: 'aurum', mindspaces });
    expect(resolved.id).toBe('aurum');
  });

  it('returns user default when no persona is active', () => {
    const resolved = resolveMindspace({ persona: null, defaultMindspaceId: 'aurum', mindspaces });
    expect(resolved.id).toBe('aurum');
  });

  it('falls back to first mindspace when defaultMindspaceId is missing from the list', () => {
    const resolved = resolveMindspace({
      persona: null,
      defaultMindspaceId: 'gone',
      mindspaces,
    });
    expect(resolved.id).toBe('aurum'); // first one
  });

  it('throws when mindspaces list is empty', () => {
    expect(() =>
      resolveMindspace({ persona: null, defaultMindspaceId: 'aurum', mindspaces: [] }),
    ).toThrow(/no mindspaces/i);
  });
});
