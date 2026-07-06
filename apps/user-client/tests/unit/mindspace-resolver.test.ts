// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { MindspaceRow } from '../../src/boot/client-data-db.js';
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
    updatedAt: 0,
  };
}

describe('resolveMindspace', () => {
  const aurum = makeMindspace('aurum', 'Aurum');
  const verdan = makeMindspace('verdan', 'Verdan');
  const mindspaces = [aurum, verdan];

  it('returns persona-override mindspace when set', () => {
    const resolved = resolveMindspace({
      persona: { mindspaceId: 'verdan', textureOverride: null },
      defaultMindspaceId: 'aurum',
      defaultTexture: null,
      mindspaces,
    });
    expect(resolved?.id).toBe('verdan');
  });

  it('returns user default when persona has no mindspace override', () => {
    const resolved = resolveMindspace({
      persona: { mindspaceId: null, textureOverride: null },
      defaultMindspaceId: 'aurum',
      defaultTexture: null,
      mindspaces,
    });
    expect(resolved?.id).toBe('aurum');
  });

  it('returns user default when no persona is active', () => {
    const resolved = resolveMindspace({
      persona: null,
      defaultMindspaceId: 'aurum',
      defaultTexture: null,
      mindspaces,
    });
    expect(resolved?.id).toBe('aurum');
  });

  it('falls back to first mindspace when defaultMindspaceId is missing from the list', () => {
    const resolved = resolveMindspace({
      persona: null,
      defaultMindspaceId: 'gone',
      defaultTexture: null,
      mindspaces,
    });
    expect(resolved?.id).toBe('aurum'); // first one
  });

  it('returns null when mindspaces list is empty', () => {
    const resolved = resolveMindspace({
      persona: null,
      defaultMindspaceId: 'aurum',
      defaultTexture: null,
      mindspaces: [],
    });
    expect(resolved).toBeNull();
  });
});

describe('mindspace-resolver — texture priority', () => {
  const ms = (id: string, texture: 'cloudy' | 'aurora' | 'grain'): MindspaceRow => ({
    id,
    displayName: `MS-${id}`,
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
      text: { primary: '#fff', secondary: '#fff', muted: '#fff', ghost: '#fff' },
    },
    texture,
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
  });

  it('returns persona.textureOverride if set', () => {
    const r = resolveMindspace({
      persona: { mindspaceId: 'a', textureOverride: 'grain' },
      defaultMindspaceId: 'a',
      defaultTexture: 'aurora',
      mindspaces: [ms('a', 'cloudy')],
    });
    expect(r?.texture).toBe('grain');
  });

  it('falls back to settings.userTexture when persona.textureOverride is null', () => {
    const r = resolveMindspace({
      persona: { mindspaceId: 'a', textureOverride: null },
      defaultMindspaceId: 'a',
      defaultTexture: 'aurora',
      mindspaces: [ms('a', 'cloudy')],
    });
    expect(r?.texture).toBe('aurora');
  });

  it('falls back to mindspace.texture when neither override nor user-default is set', () => {
    const r = resolveMindspace({
      persona: null,
      defaultMindspaceId: 'a',
      defaultTexture: null,
      mindspaces: [ms('a', 'cloudy')],
    });
    expect(r?.texture).toBe('cloudy');
  });
});
