// SPDX-License-Identifier: LGPL-3.0-only

export type {
  Capability,
  ConfigField,
  KnownModel,
  ProviderDefinition,
  ProviderConfig,
  WireMessage,
  StreamChunk,
  ProbeResult,
} from './types.js';

export { registerProvider, getProvider, listProviders } from './registry.js';

export { composeSystemPrompt, type CompositionLayers } from './composition.js';

export { buildRequest, type BuildRequestArgs } from './transport.js';

export { parseOpenAiSseStream, type ParseOpts } from './streaming.js';

export {
  streamCompletion,
  type StreamCompletionArgs,
} from './adapters/openai-chat-completions.js';

export { probeProvider, type ProbeArgs } from './probe.js';

// Register Block-1 built-in providers on first import.
import { registerBuiltinProviders } from './providers/_register-builtins.js';
registerBuiltinProviders();
