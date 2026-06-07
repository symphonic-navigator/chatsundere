// SPDX-License-Identifier: AGPL-3.0-only
import { attachConnectivityListeners } from '@chatsundere/ui-shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { openDb } from './boot/open-db.js';
import { reconcileStaging } from './boot/reconcile-staging.js';
import { checkRuntime } from './boot/runtime-check.js';
import { startKnowledgeIngestion } from './knowledge/start-ingestion.js';
import { useBootStore } from './state/boot.store.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');
const root = createRoot(rootEl);

function render() {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

async function boot() {
  const runtime = checkRuntime();
  if (!runtime.ok) {
    useBootStore.getState().set({ kind: 'runtime_failure', missing: runtime.missing });
    render();
    return;
  }
  try {
    await openDb();
  } catch (e) {
    useBootStore
      .getState()
      .set({ kind: 'db_failure', error: e instanceof Error ? e.message : String(e) });
    render();
    return;
  }
  attachConnectivityListeners();
  void startKnowledgeIngestion();
  const staging = await reconcileStaging();
  useBootStore.getState().set({ kind: 'ready', staging });
  render();

  // Register the service worker after the UI is ready so the splash and
  // boot errors are never obscured by SW registration noise.
  const { registerServiceWorker } = await import('./sw/register.js');
  registerServiceWorker();
}

// Render once at "pending" so the user sees the splash promptly.
render();
void boot();
