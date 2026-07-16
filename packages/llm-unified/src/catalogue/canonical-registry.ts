// SPDX-License-Identifier: LGPL-3.0-only
import { listOfferings } from '../registry.js';
import { MISTRAL_FORMATTING_INSTRUCTIONS } from './model-instructions.js';
import type { CanonicalModel } from './types.js';

/** Curated, provider-independent identities. The user picks one of these. */
export const CANONICALS: CanonicalModel[] = [
  {
    id: 'deepseek-v3.2',
    displayName: 'DeepSeek V3.2',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote: 'DeepSeek open-weight model; judged freedom-oriented by Chris (2026-05-30).',
    unsuitableAsBackgroundWorker: true,
  },
  {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote: 'DeepSeek open-weight model; judged freedom-oriented by Chris (2026-05-30).',
    unsuitableAsBackgroundWorker: true,
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote: 'DeepSeek open-weight model; judged freedom-oriented by Chris (2026-05-30).',
    unsuitableAsBackgroundWorker: true,
  },
  {
    id: 'glm-5',
    displayName: 'GLM 5',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote:
      'z-ai/Zhipu open-weight model; judged freedom-oriented for Chatsundere by Chris (2026-05-30).',
  },
  {
    id: 'glm-5.1',
    displayName: 'GLM 5.1',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote:
      'z-ai/Zhipu open-weight model; judged freedom-oriented for Chatsundere by Chris (2026-05-30).',
  },
  {
    id: 'glm-5.2',
    displayName: 'GLM 5.2',
    family: 'glm',
    // Text-only flagship; z-ai markets it for creative writing and roleplay. A
    // 1M-token context model (vs the ~200k of GLM 5/5.1 — measured per provider).
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote:
      'z-ai/Zhipu open-weight model; the GLM-family freedom judgement (Chris, 2026-05-30) carried forward to 5.2.',
  },
  {
    id: 'kimi-k2.6',
    displayName: 'Kimi K2.6',
    family: 'kimi',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote: 'Moonshot open-weight model; judged freedom-oriented by Chris (2026-05-30).',
  },
  {
    id: 'kimi-k3',
    displayName: 'Kimi K3',
    family: 'kimi',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    // Moonshot AI is a PRC company subject to KPCh content obligations, so the
    // model-intrinsic freedom is genuinely UNKNOWN until measured (Chris,
    // 2026-07-16): `null`, not `false` — absence of evidence is not evidence of
    // restriction. Moonshot may drop censorship for Western API clients (rumoured,
    // unconfirmed). Revisit once the eval lands. See [[../../obsidian/models/kimi-k3]].
    freedomOriented: null,
    freedomNote:
      'Moonshot AI is a PRC company (KPCh content obligations); freedom orientation not yet assessed — unknown pending eval (Chris, 2026-07-16).',
  },
  {
    id: 'gemma-4-31b',
    displayName: 'Gemma 4 31B',
    family: 'gemma',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote: 'Google open-weight model; judged freedom-oriented by Chris (2026-05-30).',
  },
  {
    id: 'qwen3.5-397b-a17b',
    displayName: 'Qwen3.5 397B A17B',
    family: 'qwen',
    // Wafer's /models reports reasoning:false, but the live probe contradicts it
    // (empirical truth over docs, CLAUDE.md §13): `reasoning_effort:medium`
    // yields ~4.7k reasoning tokens, `none` yields zero — a clean on/off toggle.
    // So reasoning IS a required capability. MoE, 397B total / 17B active.
    requiredCaps: { tools: true, reasoning: true, vision: true },
    // Freedom not yet assessed by Chris (2026-05-31) — badge resolves to
    // 'unknown' until judged. Alibaba open-weight family.
    freedomOriented: null,
  },
  {
    id: 'mimo-v2.5-omni',
    displayName: 'MiMo V2.5 Omni',
    family: 'mimo',
    // Omni is natively multimodal and vision works on novita: 100% on real
    // photos, ~88% on the suite's synthetic solid-colour image (the rare miss is
    // a reasoning-leak artefact of that image, not a fault — see the Model
    // Curation Record). Caveats: image input must be a base64 data URL (remote
    // URLs 400), and the model is verbose on synthetic images so a tight
    // max_tokens can truncate before the answer — the adapter sends none.
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'Xiaomi open-weight omni-modal model; judged freedom-oriented by Chris (2026-05-31).',
  },
  {
    id: 'mimo-v2.5-pro',
    displayName: 'MiMo V2.5 Pro',
    family: 'mimo',
    // Pro is TEXT-ONLY — novita rejects image_url with "model features vision
    // not support" (input_modalities: [text]). Agentic/long-horizon coding focus.
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote: 'Xiaomi open-weight agentic model; judged freedom-oriented by Chris (2026-05-31).',
  },
  {
    id: 'mistral-small-4',
    displayName: 'Mistral Small 4',
    family: 'mistral',
    // Reasoning is a binary toggle on the Mistral API (reasoning_effort
    // high/none); thinking arrives inside delta.content as a polymorphic
    // typed-item array, not in reasoning_content. Vision + tools confirmed in
    // the chatsune integration. Context window 256k.
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'Mistral flagship; judged freedom-oriented by Chris (2026-05-31): uncensored and notably liberal towards adult expression (more so than the open-weight Chinese models), with licences permissive enough for our API integration.',
    modelInstructions: MISTRAL_FORMATTING_INSTRUCTIONS,
  },
  {
    id: 'mistral-medium-3-5',
    displayName: 'Mistral Medium 3.5',
    family: 'mistral',
    // Same reasoning toggle as Small 4. Note the upstream slug is the literal
    // `mistral-medium-3-5`, NOT `-latest` (small/large use `-latest`).
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'Mistral flagship; judged freedom-oriented by Chris (2026-05-31): uncensored and notably liberal towards adult expression, with licences permissive enough for our API integration.',
    modelInstructions: MISTRAL_FORMATTING_INSTRUCTIONS,
  },
  {
    id: 'mistral-large-3',
    displayName: 'Mistral Large 3',
    family: 'mistral',
    // Large 3 has NO reasoning (chatsune: has_reasoning=False). Vision + tools.
    requiredCaps: { tools: true, reasoning: false, vision: true },
    freedomOriented: true,
    freedomNote:
      'Mistral flagship; judged freedom-oriented by Chris (2026-05-31): uncensored and notably liberal towards adult expression, with licences permissive enough for our API integration.',
    modelInstructions: MISTRAL_FORMATTING_INSTRUCTIONS,
  },
  // --- Claude (Anthropic) — censored at source → not freedom-oriented;
  // surfaced with the CENSORED badge. Delivered via nano-gpt (the anonymising
  // router) per ADR 0032, except Sonnet 5 which is curated on OpenRouter (the
  // user owns the upstream route there). ---
  {
    id: 'claude-haiku-4.5',
    displayName: 'Claude Haiku 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-sonnet-4.5',
    displayName: 'Claude Sonnet 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-sonnet-4.6',
    displayName: 'Claude Sonnet 4.6',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Curated on OpenRouter, a US router/aggregator: the user owns the upstream route and any key-level guardrails, and OpenRouter adds no filter of its own. effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.5',
    displayName: 'Claude Opus 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.6',
    displayName: 'Claude Opus 4.6',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.7',
    displayName: 'Claude Opus 4.7',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.8',
    displayName: 'Claude Opus 4.8',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. SM-Bench run 2adbdf74 (2026-06-09): NSFW (System Prompt) 98.62% clears the canary, but Overfit 34.43%, EQ Boundaries 53.65% and Adversarial (Hostile Logic) 79.51% all miss the 90% bar. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  // --- ChatGPT (OpenAI) — censored at source → not freedom-oriented; surfaced
  // with the CENSORED badge. Onboarded 2026-07-06 on explicit user request
  // (people asked for OpenAI models by name); the badge is the honest signal of
  // what they are opting into. Curated on BOTH nano-gpt (the anonymising router)
  // and OpenRouter (US router) — both route verbatim and add no censorship of
  // their own, so effectiveFreedom is driven purely by the model being censored
  // at source. gpt-4o/4.1 are non-reasoning; the GPT-5 family reasons with a
  // steerable effort surface (probed live 2026-07-06). ---
  {
    id: 'chatgpt-4o',
    displayName: 'ChatGPT 4o',
    family: 'chatgpt',
    // The floating `openai/gpt-4o` alias — OpenAI silently repoints it, so which
    // checkpoint it resolves to on any given day is undisclosed (the "unclarified"
    // checkpoint). Non-reasoning; vision + tools.
    requiredCaps: { tools: true, reasoning: false, vision: true },
    freedomOriented: false,
    freedomNote:
      'OpenAI aligns/censors the model at source → not freedom-oriented. Both curated deployments (nano-gpt, OpenRouter) route verbatim and add no censorship of their own, so effectiveFreedom is "restricted" → CENSORED badge (Chris, 2026-07-06). Onboarded on explicit user request.',
  },
  {
    id: 'chatgpt-4o-2024-11-20',
    displayName: 'ChatGPT 4o 11/24',
    family: 'chatgpt',
    // The pinned November 2024 checkpoint — tonally the closest available to the
    // scene-beloved "GG" 4o (the ~6-month "adult mode" era), which OpenAI does
    // not expose via the API. Non-reasoning; vision + tools.
    requiredCaps: { tools: true, reasoning: false, vision: true },
    freedomOriented: false,
    freedomNote:
      'OpenAI aligns/censors the model at source → not freedom-oriented. Both curated deployments (nano-gpt, OpenRouter) route verbatim and add no censorship of their own, so effectiveFreedom is "restricted" → CENSORED badge (Chris, 2026-07-06). Onboarded on explicit user request.',
  },
  {
    id: 'chatgpt-4.1',
    displayName: 'ChatGPT 4.1',
    family: 'chatgpt',
    // Non-reasoning flagship; vision + tools. 1M-token window upstream
    // (recommended capped at our 200k sweet-spot — measured per provider).
    requiredCaps: { tools: true, reasoning: false, vision: true },
    freedomOriented: false,
    freedomNote:
      'OpenAI aligns/censors the model at source → not freedom-oriented. Both curated deployments (nano-gpt, OpenRouter) route verbatim and add no censorship of their own, so effectiveFreedom is "restricted" → CENSORED badge (Chris, 2026-07-06). Onboarded on explicit user request.',
  },
  {
    id: 'chatgpt-5',
    displayName: 'ChatGPT 5',
    family: 'chatgpt',
    // The marketed "GPT-5" is served by the `openai/gpt-5.1` endpoint (Chris's
    // mapping). Reasoning model: effort genuinely modulates the trace on
    // OpenRouter (low ~4 reasoning tokens, high ~165 — probed live 2026-07-06),
    // so a steps control. Reasoning summary surfaces on nano-gpt natively and on
    // OpenRouter behind `include_reasoning`. Vision + tools.
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'OpenAI aligns/censors the model at source → not freedom-oriented. Both curated deployments (nano-gpt, OpenRouter) route verbatim and add no censorship of their own, so effectiveFreedom is "restricted" → CENSORED badge (Chris, 2026-07-06). Onboarded on explicit user request.',
  },
  {
    id: 'chatgpt-5.4',
    displayName: 'ChatGPT 5.4',
    family: 'chatgpt',
    // Reasoning model with a steerable effort surface; vision + tools. 1M-token
    // window upstream (recommended capped at our 200k sweet-spot).
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'OpenAI aligns/censors the model at source → not freedom-oriented. Both curated deployments (nano-gpt, OpenRouter) route verbatim and add no censorship of their own, so effectiveFreedom is "restricted" → CENSORED badge (Chris, 2026-07-06). Onboarded on explicit user request.',
  },
  {
    id: 'chatgpt-5.5',
    displayName: 'ChatGPT 5.5',
    family: 'chatgpt',
    // Reasoning model with a steerable effort surface; vision + tools. 1M-token
    // window upstream (recommended capped at our 200k sweet-spot).
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'OpenAI aligns/censors the model at source → not freedom-oriented. Both curated deployments (nano-gpt, OpenRouter) route verbatim and add no censorship of their own, so effectiveFreedom is "restricted" → CENSORED badge (Chris, 2026-07-06). Onboarded on explicit user request.',
  },
  {
    id: 'grok-4.3',
    displayName: 'Grok 4.3',
    family: 'grok',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'xAI/Grok refuses near-nothing; freedom-oriented model and deployment (Chris, 2026-06-02).',
  },
  {
    id: 'grok-4.20',
    displayName: 'Grok 4.20',
    family: 'grok',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    // Earlier excluded as "multi-agent only" (2026-06-02) — that was a
    // misread: the plain Grok 4.20 is an ordinary reasoning chat model, distinct
    // from the separate `*-multi-agent` slug. Reversed and curated 2026-06-28.
    freedomNote:
      'xAI/Grok refuses near-nothing; freedom-oriented model and deployment (Chris, 2026-06-28).',
  },
  {
    id: 'grok-4.5',
    displayName: 'Grok 4.5',
    family: 'grok',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'xAI/Grok refuses near-nothing; Grok 4.5 is judged even more freedom-oriented than 4.3 (Chris, 2026-07-09, tested and approved).',
  },
  {
    id: 'inkling',
    displayName: 'Inkling',
    family: 'inkling',
    // Thinking Machines' first public model (Mira Murati's lab). Sparse MoE,
    // 975B total / 41B active, natively multimodal (vision + audio in — we surface
    // vision), Apache-2.0. Reasoning is a genuine toggle on nano-gpt, but the trace
    // text is withheld on our route today (a provider-side passthrough gap, not a
    // model limit — see the offering and the Model Curation Record), so the
    // offering carries `reasoningTraceHidden`.
    requiredCaps: { tools: true, reasoning: true, vision: true },
    // Freedom NOT yet assessed: a US model with present-but-leaky guardrails per
    // its own card ("occasional tendency to comply with role-play ... on harmful
    // topics"; recommends external filtering). We await an independent safety
    // evaluation before judging, so effective freedom resolves to 'unknown' — the
    // "Uncensored?" badge. See obsidian/models/inkling.md.
    freedomOriented: null,
  },
];

/** Fresh array so callers may sort/filter freely. */
export function listCanonicals(): CanonicalModel[] {
  return [...CANONICALS];
}

/** Returns the canonical with the given id, or `undefined` if not registered. */
export function getCanonical(id: string): CanonicalModel | undefined {
  return CANONICALS.find((c) => c.id === id);
}

/**
 * Canonicals the user can actually use: those with >= 1 offering on a
 * configured (usable) provider. Returns the available list plus the count of
 * hidden canonicals, for the model picker's quiet footer.
 */
export function availableCanonicals(configuredTemplateIds: string[]): {
  available: CanonicalModel[];
  hiddenCount: number;
} {
  const configured = new Set(configuredTemplateIds);
  const all = listCanonicals();
  const available = all.filter((c) =>
    listOfferings(c.id).some((o) => configured.has(o.providerId)),
  );
  return { available, hiddenCount: all.length - available.length };
}

/**
 * Curated model instructions for an offering's canonical, or `''` when the
 * offering has no canonical or the canonical carries none. The empty string
 * makes the prompt builder drop the segment.
 */
export function resolveModelInstructions(offering: { canonicalRef: string | null }): string {
  if (!offering.canonicalRef) return '';
  return getCanonical(offering.canonicalRef)?.modelInstructions ?? '';
}

/**
 * Whether a model is unfit to run a persona's unattended background chores
 * (title generation, memory, compaction) because it tends to emit reasoning and
 * then stop without a final answer. Currently the DeepSeek family. Drives the
 * background-helper picker filter and the flagged-main-model warning.
 */
export function isUnsuitableAsBackgroundWorker(model: CanonicalModel): boolean {
  return model.unsuitableAsBackgroundWorker === true;
}
