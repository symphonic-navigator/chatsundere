// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

vi.mock('../../../src/data/providers.js', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../../../src/lib/server-gate.js', () => ({
  useServerGate: () => ({ enabled: false, reason: 'local-only', tooltip: null }),
}));
vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  aggregateServiceKinds: () => [],
  getProvider: () => null,
}));
vi.mock('@chatsundere/ui-shared', () => ({
  motion: { respectsReducedMotion: () => true },
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { createProject } from '../../../src/projects/fs.js';
import { ProjectsGate } from '../../../src/routes/app/projects/ProjectsGate.js';
import { Settings } from '../../../src/routes/app/settings.js';
import { SettingsPreviewsPage } from '../../../src/routes/app/settings/previews.js';
import { toastStore, useToastStore } from '../../../src/state/toast.store.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  toastStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/settings" element={<Settings />} />
          <Route path="/app/settings/previews" element={<SettingsPreviewsPage />} />
          <Route element={<ProjectsGate />}>
            <Route path="/app/projects" element={<p>Project list</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function setFlag(on: boolean): Promise<void> {
  await getClientDataDb().settings.update(1, { previews: { projects: on } });
}

describe('Previews preview flag', () => {
  it('always shows the Previews tile in My Settings', async () => {
    renderAt('/app/settings');
    expect(await screen.findByRole('button', { name: /Previews/ })).toBeInTheDocument();
    expect(screen.getByText('try early features')).toBeInTheDocument();
  });

  it('shows the Projects tile only when the flag is on', async () => {
    renderAt('/app/settings');
    await screen.findByRole('button', { name: /Previews/ });
    expect(screen.queryByRole('button', { name: /Projects \(preview\)/ })).toBeNull();
  });

  it('shows the Projects tile when the flag is on', async () => {
    await setFlag(true);
    renderAt('/app/settings');
    expect(await screen.findByRole('button', { name: /Projects \(preview\)/ })).toBeInTheDocument();
  });

  it('toggling writes settings.previews.projects', async () => {
    renderAt('/app/settings/previews');
    expect(
      await screen.findByText(
        'An early look at project files. Projects live on this device only for now.',
      ),
    ).toBeInTheDocument();
    const toggle = await screen.findByRole('switch', { name: 'Projects (preview)' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(async () =>
      expect((await getClientDataDb().settings.get(1))?.previews?.projects).toBe(true),
    );
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle);
    await waitFor(async () =>
      expect((await getClientDataDb().settings.get(1))?.previews?.projects).toBe(false),
    );
  });

  it('names the project count in the turn-off line', async () => {
    await setFlag(true);
    await createProject('One');
    await createProject('Two');
    renderAt('/app/settings/previews');
    expect(
      await screen.findByText(
        'Turning this off hides Projects; your 2 projects stay on this device and return when you turn it back on.',
      ),
    ).toBeInTheDocument();
  });

  it('uses the singular turn-off line for one project', async () => {
    await setFlag(true);
    await createProject('Only');
    renderAt('/app/settings/previews');
    expect(
      await screen.findByText(
        'Turning this off hides Projects; your 1 project stays on this device and returns when you turn it back on.',
      ),
    ).toBeInTheDocument();
  });

  it('shows a warning toast when the toggle cannot be saved', async () => {
    renderAt('/app/settings/previews');
    const toggle = await screen.findByRole('switch', { name: 'Projects (preview)' });
    vi.spyOn(getClientDataDb().settings, 'update').mockRejectedValueOnce(new Error('disk full'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
        'Could not save the setting. Please try again.',
      ),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('shows no turn-off line without projects', async () => {
    await setFlag(true);
    renderAt('/app/settings/previews');
    await screen.findByRole('switch', { name: 'Projects (preview)' });
    expect(screen.queryByText(/Turning this off hides Projects/)).toBeNull();
  });

  it('redirects /app/projects to Previews with a notice while the flag is off', async () => {
    renderAt('/app/projects');
    expect(await screen.findByText('Projects is a preview — turn it on here.')).toBeInTheDocument();
    expect(screen.queryByText('Project list')).toBeNull();
  });

  it('lets /app/projects through when the flag is on', async () => {
    await setFlag(true);
    renderAt('/app/projects');
    expect(await screen.findByText('Project list')).toBeInTheDocument();
  });
});
