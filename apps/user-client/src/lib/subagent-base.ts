// SPDX-License-Identifier: AGPL-3.0-only
import type {
  CompletionTarget,
  ProviderConfig,
  ProviderDefinition,
} from '@chatsundere/llm-unified';

/** The resolved subset of streaming args a short-lived, structurally-isolated
 *  subagent call needs (the author and the expert). Resolved on the send path,
 *  which holds the MasterKey. Shared so the two subagents cannot drift. */
export interface SubagentBase {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  target: CompletionTarget;
}

/**
 * Time-to-first-byte cap for artefact subagent passes, overriding the 15 s
 * streaming default. These runs are headless: a reasoning model prefilling a
 * whole artefact body routinely needs longer than 15 s before the first chunk,
 * and the user is watching a progress pill rather than a live stream. The main
 * chat keeps the short default, where a fast failure on a stalled provider is
 * the more useful behaviour. Only the *start* of the response is capped — once
 * headers arrive the body may stream for as long as it needs.
 */
export const SUBAGENT_INITIAL_RESPONSE_TIMEOUT_MS = 120_000;
