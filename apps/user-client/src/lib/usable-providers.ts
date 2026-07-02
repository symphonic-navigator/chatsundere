// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useMemo } from 'react';
import type { ProviderRow } from '../boot/client-data-db.js';
import { useProviders } from '../data/providers.js';
import { useServerGate } from './server-gate.js';

/**
 * Template ids of *usable* providers: enabled AND with a working route —
 * either not proxy-required, or the account's authenticated proxy is available.
 * The single source of truth for the summary and model availability.
 */
export function usableTemplateIds(providers: ProviderRow[], hasProxy: boolean): string[] {
  return providers
    .filter((p) => p.enabled)
    .filter((p) => getProvider(p.templateId)?.corsHint !== 'requires-proxy' || hasProxy)
    .sort((a, b) => a.createdAt - b.createdAt) // first-configured first (first-come default)
    .map((p) => p.templateId);
}

/** Hook form: reads providers + the server 'proxy' gate and returns usable template ids. */
export function useUsableTemplateIds(): string[] {
  const providers = useProviders();
  const hasProxy = useServerGate('proxy').enabled;
  return useMemo(
    () => usableTemplateIds(providers.data ?? [], hasProxy),
    [providers.data, hasProxy],
  );
}
