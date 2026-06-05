// SPDX-License-Identifier: LGPL-3.0-only

export type {
  Capability,
  CacheControl,
  ConfigField,
  ProviderDefinition,
  ProviderConfig,
  WireContentPart,
  WireMessage,
  WireToolCall,
  StreamChunk,
  NormalisedUsage,
  ProbeResult,
  ReasoningIntent,
} from './types.js';

export {
  registerProvider,
  getProvider,
  listProviders,
  rankOfferings,
  listOfferings,
  getOffering,
  MODALITY_ORDER,
  providerServiceKinds,
  aggregateServiceKinds,
  providersContributing,
} from './registry.js';
export { registerAdapter, getAdapter } from './adapter-registry.js';

export { buildPrompt, type BuildPromptInputs, type PromptJob } from './composition.js';
export { NSFW_PROMPT, TONALITY_PROMPT } from './identity/chatsundere-identity.js';

export { buildRequest, type BuildRequestArgs } from './transport.js';

export { parseOpenAiSseStream, type ParseOpts } from './streaming.js';

export { streamCompletion, type StreamCompletionArgs } from './stream-completion.js';

export type { ToolDef } from './adapter-contract.js';

export type {
  WebLocation,
  WebContext,
  WebSearchHit,
  WebSearchResult,
  WebFetchResult,
  WebTrait,
  SearchTier,
  WebSearchOpts,
  WebOfferingMeta,
  WebInterfacingProvider,
} from './integrations/web-interfacing.js';

export {
  registerWebAdapter,
  resolveWebAdapter,
  _resetWebAdapterRegistryForTests,
  type WebAdapterFactory,
} from './integrations/web-adapter-registry.js';

export { runOneShotCompletion, type OneShotArgs } from './one-shot-completion.js';

export { probeProvider, type ProbeArgs } from './probe.js';

export {
  formatRetryEvent,
  withStreamingRetry,
  type RetryEvent,
  type OnRetry,
  type RetryErrorKind,
  type StreamingRetryOpts,
} from './retry.js';

// Catalogue data model (CanonicalModel, Offering, ModelProfile, validation, freedom).
export * from './catalogue/index.js';

// Register Block-1 built-in providers on first import.
import { registerBuiltinProviders } from './providers/_register-builtins.js';
registerBuiltinProviders();
