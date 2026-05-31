// SPDX-License-Identifier: AGPL-3.0-only

/** Display metadata for the built-in providers (monograms are curated). */
export const BUILT_IN_PROVIDERS = [
  { id: 'chutes', name: 'Chutes', monogram: 'Ch' },
  { id: 'tensorix', name: 'Tensorix', monogram: 'Te' },
  { id: 'mistral', name: 'Mistral AI', monogram: 'Mi' },
  { id: 'wafer', name: 'Wafer', monogram: 'Wa' },
  { id: 'novita', name: 'Novita AI', monogram: 'No' },
  { id: 'ollama-cloud', name: 'Ollama Cloud', monogram: 'Ol' },
  { id: 'nano-gpt', name: 'nano-gpt.com', monogram: 'nG' },
  { id: 'openrouter', name: 'OpenRouter', monogram: 'OR' },
] as const;

export type ProviderTemplateId = (typeof BUILT_IN_PROVIDERS)[number]['id'];
