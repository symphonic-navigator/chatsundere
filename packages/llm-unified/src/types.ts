// SPDX-License-Identifier: LGPL-3.0-only
import type { Offering } from './catalogue/types.js';

export type Capability = 'llm' | 'streaming' | 'tools' | 'json-mode' | 'vision';

export interface ConfigField {
  key: string;
  label: string;
  fieldType: 'text' | 'password' | 'url' | 'select';
  secret: boolean;
  required: boolean;
  description: string;
  options?: { value: string; label: string }[];
}

export interface ProviderDefinition {
  id: string;
  displayName: string;
  iconKey: string;
  baseUrl: string;
  shape: 'openai-chat-completions';
  capabilities: Capability[];
  configFields: ConfigField[];
  probe: { path: string; method: 'GET' | 'POST' };
  secretFields: ReadonlySet<string>;
  corsHint: 'direct' | 'inofficial' | 'requires-proxy';
  offerings: Offering[];
  sortPriority: number;
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

/**
 * Per-response token accounting, normalised to one shape across providers.
 * Adapters extract this from the upstream `usage` object (which varies per
 * provider) inside their `parseChunk`.
 */
export interface NormalisedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Present when the provider reports reasoning/thinking tokens separately. */
  reasoningTokens?: number;
  /** Present when the provider reports prompt-cache hits. */
  cachedTokens?: number;
}

export type StreamChunk =
  | { type: 'token'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; name: string; argumentsJson: string }
  | { type: 'usage'; usage: NormalisedUsage }
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown' }
  | { type: 'error'; message: string };

/**
 * Engine → adapter intent for reasoning. Per-provider translation
 * to body shape (`{reasoning:{enabled,effort}}` vs `{think:bool}` vs
 * model-slug swap) is the adapter layer's responsibility.
 */
export type ReasoningIntent =
  | { enabled: false }
  | { enabled: true; effort?: 'low' | 'medium' | 'high' };

export interface ProbeResult {
  ok: boolean;
  status: number;
  modelCount?: number;
  reason?: string;
}

/**
 * Minimal view onto a stored `ProviderRow`. Pass into transport/adapter
 * without coupling llm-unified to the user-client persistence types.
 */
export interface ProviderConfig {
  baseUrl: string;
  routing: { kind: 'direct' } | { kind: 'cors-proxy' };
}
