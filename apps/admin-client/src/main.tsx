// SPDX-License-Identifier: AGPL-3.0-only
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import { attachConnectivityListeners } from '@chatsundere/ui-shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { queryClient } from './lib/query-client.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Wire the connectivity store to window online/offline events. The pre-login
// decision tree uses `navigator.onLine` directly, but downstream features
// (top-bar status indicator, server-reachability dispatch from login) read
// from the store.
attachConnectivityListeners();

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
