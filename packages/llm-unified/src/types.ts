// SPDX-License-Identifier: LGPL-3.0-only

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

export interface KnownModel {
  id: string;
  displayName: string;
  notes?: string;
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
  knownModels: KnownModel[];
  sortPriority: number;
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export type StreamChunk =
  | { type: 'token'; text: string }
  | { type: 'tool-call'; toolCallId: string; name: string; argumentsJson: string }
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown' }
  | { type: 'error'; message: string };

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
