// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SECURITY_TILE_LABEL,
  adminLaunchUrl,
  openAdminConsole,
} from '../../src/routes/app/account/admin-tile.js';

describe('adminLaunchUrl', () => {
  const url = 'https://admin.example';

  it('returns the URL for an admin when a URL is configured', () => {
    expect(adminLaunchUrl('admin', url)).toBe(url);
    expect(adminLaunchUrl('primary_admin', url)).toBe(url);
  });

  it('returns null for a non-admin regardless of URL', () => {
    expect(adminLaunchUrl('user', url)).toBeNull();
    expect(adminLaunchUrl(null, url)).toBeNull();
  });

  it('returns null for an admin when no URL is configured', () => {
    expect(adminLaunchUrl('admin', undefined)).toBeNull();
    expect(adminLaunchUrl('primary_admin', '')).toBeNull();
  });
});

describe('SECURITY_TILE_LABEL', () => {
  // Laura SOFT-1: both capabilities must stay legible on the tile face, or the
  // merge buries change-passphrase.
  it('names both passphrase and biometrics', () => {
    expect(SECURITY_TILE_LABEL).toMatch(/passphrase/i);
    expect(SECURITY_TILE_LABEL).toMatch(/biometrics/i);
  });
});

describe('openAdminConsole', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the URL in a new tab with noopener,noreferrer', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openAdminConsole('https://admin.example');
    expect(open).toHaveBeenCalledWith('https://admin.example', '_blank', 'noopener,noreferrer');
  });
});
