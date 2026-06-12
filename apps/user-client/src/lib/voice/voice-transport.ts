// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import type { ProviderRow, SettingsRow } from '../../boot/client-data-db.js';
import { openSecret } from '../secrets.js';
import type { SelectedOffering } from './select-offering.js';

/** The transport material shared by the TTS and STT resolvers. */
export interface VoiceTransportMaterial {
  providerConfig: { baseUrl: string; routing: { kind: 'direct' } | { kind: 'cors-proxy' } };
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
}

/**
 * Resolve the transport material (auth + routing + proxy) for an already-selected
 * voice offering. Shared policy for resolveTtsTransport and resolveStt: provider
 * lookup, master-key check, api-key decrypt, the direct-routing computation, and
 * the proxy-decrypt fatal/lenient split. Returns null when resolution fails —
 * callers map that to their own no-provider shape. `logLabel` keeps each
 * resolver's warn prefix (e.g. 'resolveTts'). UI-free: no React imports.
 */
export async function resolveVoiceTransportMaterial(
  selected: SelectedOffering,
  providerRows: readonly ProviderRow[],
  settings: SettingsRow | undefined,
  logLabel: string,
): Promise<VoiceTransportMaterial | null> {
  const { offering } = selected;

  const providerDef = getProvider(offering.providerId);
  if (!providerDef) return null;

  // Invariant: the selector's isConfigured already guaranteed an enabled row
  // exists for this offering — this guard is defence-in-depth.
  const providerRow = providerRows.find((p) => p.templateId === offering.providerId && p.enabled);
  if (!providerRow) return null;

  // Resolve mk from the session store — same pattern as send-message.ts.
  const mk = useSessionStore.getState().mk;
  if (!mk) {
    console.warn(`${logLabel}: no master key in session — falling back to no-provider`);
    return null;
  }

  let apiKey: string;
  try {
    apiKey = await openSecret(providerRow.apiKey, mk, `provider/${providerRow.id}/api-key`);
  } catch {
    console.warn(`${logLabel}: failed to decrypt api-key — falling back to no-provider`);
    return null;
  }

  // Per-offering override first: xAI's voice endpoints are CORS-open even
  // though the provider-level hint says requires-proxy (probed 2026-06-12).
  const direct = offering.corsOverride === 'direct' || providerDef.corsHint !== 'requires-proxy';
  const providerConfig = {
    baseUrl: providerDef.baseUrl,
    routing: direct ? ({ kind: 'direct' } as const) : ({ kind: 'cors-proxy' } as const),
  };

  // Resolve the optional CORS proxy material.
  const corsProxyUrl = settings?.corsProxy?.url ?? null;
  let corsProxyKey: string | null = null;
  if (settings?.corsProxy) {
    try {
      corsProxyKey = await openSecret(settings.corsProxy.sharedKey, mk, 'cors-proxy/shared-key');
    } catch {
      // Fatal only when the request actually routes through the proxy; a
      // direct offering proceeds without proxy material.
      if (!direct) {
        console.warn(
          `${logLabel}: failed to decrypt cors-proxy/shared-key — falling back to no-provider`,
        );
        return null;
      }
      console.warn(
        `${logLabel}: failed to decrypt cors-proxy/shared-key — proceeding on direct routing`,
      );
    }
  }

  return { providerConfig, apiKey, corsProxyUrl, corsProxyKey };
}
