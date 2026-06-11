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
  listTtsOfferings,
  listTtiOfferings,
  MODALITY_ORDER,
  providerServiceKinds,
  aggregateServiceKinds,
  providersContributing,
} from './registry.js';
export { registerAdapter, getAdapter } from './adapter-registry.js';

export { buildPrompt, type BuildPromptInputs, type PromptJob } from './composition.js';
export { NSFW_PROMPT, TONALITY_PROMPT } from './identity/chatsundere-identity.js';

export {
  TEAL_EXPRESSION_PROMPT,
  TEAL_INLINE_TAGS,
  TEAL_WRAPPING_TAGS,
  TEAL_VERSION,
  type TealInlineTag,
  type TealWrappingTag,
  isTealWrapping,
  matchTealInline,
  stripTeal,
} from './teal/teal.js';

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

export {
  defaultConfigFor,
  isImageModelConfig,
  maxCountFor,
  type GptImage2Config,
  type ImageModelConfig,
  type SeedreamConfig,
  type TtiGroupId,
  type XaiImagineConfig,
  type ZImageConfig,
} from './tti/config.js';
export {
  generateImages,
  ImageGenerationError,
  type GenerateImagesArgs,
  type GenerateImagesResult,
  type ImageGenItem,
  type ImageRequestBase,
} from './tti/generate-images.js';
export {
  synthesiseSpeech,
  SpeechSynthesisError,
  type SynthesiseSpeechArgs,
  type SynthesiseSpeechResult,
} from './tts/synthesise-speech.js';
export { listTtsVoices, type TtsVoice, type ListTtsVoicesArgs } from './tts/voices.js';
// Register Block-1 built-in providers on first import.
import { registerBuiltinProviders } from './providers/_register-builtins.js';
registerBuiltinProviders();
