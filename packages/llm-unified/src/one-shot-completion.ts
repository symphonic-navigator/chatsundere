// SPDX-License-Identifier: LGPL-3.0-only
import { NANO_GPT_PAIRS } from './providers/_nano-gpt-pairs.js';
import { buildRequest } from './transport.js';
import type { KnownModel, ProviderConfig, ProviderDefinition, WireMessage } from './types.js';

export interface OneShotArgs {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  model: KnownModel;
  messages: WireMessage[];
  bodyExtras: Record<string, unknown>;
  signal?: AbortSignal;
}

interface OneShotResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Non-streaming completion. Used by background jobs (title generation,
 * memory extraction, etc.) where streaming token-by-token is unnecessary.
 * Honours the same nano-gpt pair-map quirks as streamCompletion.
 */
export async function runOneShotCompletion(args: OneShotArgs): Promise<string> {
  let modelId = args.model.id;
  const extras = { ...args.bodyExtras };
  if (args.provider.id === 'nano-gpt') {
    const pair = NANO_GPT_PAIRS[args.model.id];
    if (pair && pair.switchingMode === 'slug') {
      const thinkingOn = extras.thinking === true;
      modelId = thinkingOn ? (pair.thinkingSlug ?? pair.nonThinkingSlug) : pair.nonThinkingSlug;
      extras.thinking = undefined;
    }
  }
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/chat/completions',
    method: 'POST',
    body: { model: modelId, messages: args.messages, stream: false, ...extras },
  });
  const response = await fetch(request, { signal: args.signal });
  if (!response.ok) {
    throw new Error(`one-shot upstream returned ${response.status}`);
  }
  const json = (await response.json()) as OneShotResponse;
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('one-shot returned empty content');
  }
  return content;
}
