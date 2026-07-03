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
