// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db.js';
import { AvatarField } from '../../../src/routes/app/persona-editor.js';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('AvatarField', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders an avatar field with a change affordance', () => {
    render(
      <AvatarField
        personaId="p1"
        name="Aria"
        colour="#fff"
        pending={null}
        onPick={() => {}}
        onRemove={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: /change avatar/i })).toBeInTheDocument();
  });

  it('renders a Remove button', () => {
    render(
      <AvatarField
        personaId="p1"
        name="Aria"
        colour="#fff"
        pending={null}
        onPick={() => {}}
        onRemove={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('shows the monogram when pending is "remove"', () => {
    render(
      <AvatarField
        personaId="p1"
        name="Aria"
        colour="#fff"
        pending="remove"
        onPick={() => {}}
        onRemove={() => {}}
      />,
      { wrapper },
    );
    // "remove" state renders a monogram div (two uppercase chars)
    expect(screen.getByText('AR')).toBeInTheDocument();
  });

  it('preview applies the confirmed crop (not the whole image)', () => {
    // jsdom has no object-URL support — stub it for the preview effect.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => {};
    try {
      const { container, unmount } = render(
        <AvatarField
          personaId="p1"
          name="Aria"
          colour="#fff"
          pending={{
            blob: new Blob(['x'], { type: 'image/webp' }),
            mime: 'image/webp',
            width: 100,
            height: 100,
            crop: { x: 0, y: 0, zoom: 1 },
          }}
          onPick={() => {}}
          onRemove={() => {}}
        />,
        { wrapper },
      );
      const preview = container.querySelector('[data-avatar-preview]') as HTMLElement;
      expect(preview).not.toBeNull();
      // cropToBackground(100, 100, {0,0,1}, 48) → cover-fit to the 48px box.
      // The bug rendered bg-cover with no explicit size; the fix sets it.
      expect(preview.style.backgroundSize).toBe('48px 48px');
      expect(preview.className).not.toContain('bg-cover');
      // Unmount now, while the object-URL stubs are still in place, so the
      // revoke in the cleanup effect does not hit the restored (absent) global.
      unmount();
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it('shows a monogram placeholder when personaId is null (create mode)', () => {
    render(
      <AvatarField
        personaId={null}
        name="New"
        colour="#fff"
        pending={null}
        onPick={() => {}}
        onRemove={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByText('NE')).toBeInTheDocument();
  });
});
