# Mode 1 — Provider onboarding

Trigger: "onboard chutes" / "let's integrate <provider>". You and the maintainer
establish and document a new provider before any of its models are curated.
First read [`catalogue-model.md`](catalogue-model.md) and
[`conventions.md`](conventions.md).

## Checklist to establish and document

- **Documentation URL.** The provider's API reference — the empirical baseline,
  but trust the live probe over the docs where they disagree.
- **Key file under `keys/`.** Convention `keys/.{provider}-test-key` (e.g.
  `keys/.chutes-test-key`). Confirm the file exists and the key works against the
  provider's `/models` endpoint. Keys never enter CI.
- **Base characteristics.** ZDR (zero data retention), TEE (trusted execution
  environment), DSGVO/GDPR posture, and the jurisdiction the deployment sits in.
  These become the offering `trust` fields and the 🔒 Privacy badge.
- **`/models` (or `/tags`) metadata analysis.** Fetch the model list and study
  the slug conventions — how reasoning siblings, TEE deployments, and variants
  are named. This is what the `ProviderScanner` will tame.
- **The `usage` reporting quirk.** Where, and whether, the provider surfaces a
  per-response `usage` object (often only on the final SSE event, sometimes
  omitted entirely). Record it; it shapes every adapter's `parseChunk`.
- **Existing chatsune code.** If chatsune already talks to this provider, read
  that integration first — it captures real behaviour you would otherwise
  re-derive.

## Artefacts produced

- **A `ProviderScanner`** in `packages/llm-unified/src/providers/curation/`. The
  nano-gpt reference is `provider-scanner.ts`: the `ProviderScanner` interface
  (`providerId`, `listOfferings(): Promise<DiscoveredOffering[]>`) and
  `groupNanoGptSlugs`, which collapses the raw slug list into `DiscoveredOffering`s
  (`providerId`, `baseSlug`, optional `reasoningVariant`, optional `teeVariant`).
  It tames the slug-zoo: a bare slug plus an optional `:thinking` reasoning
  sibling; `TEE/`-prefixed deployments that use `-thinking` (hyphen, not colon)
  for their reasoning sibling — bare and TEE are **separate** offerings;
  slug-swap reasoning generally. Write the equivalent for the new provider's slug
  conventions.
- **The `ProviderDefinition` registration.** Register the provider so the runtime
  knows it. Built-in providers are wired in
  `packages/llm-unified/src/providers/_register-builtins.ts` via
  `registerBuiltinProviders()` (which calls `registerNanoGpt`, `registerNovita`,
  `registerOllamaCloud`). Add the new provider's `registerX()` alongside them.
  `ProviderDefinition` (`src/types.ts`) carries `id`, `displayName`, `baseUrl`,
  `shape: 'openai-chat-completions'`, `capabilities`, `configFields`, `probe`,
  `corsHint`, `knownModels`, and `sortPriority`.
- **A Provider Curation Record** at `obsidian/providers/<id>.md` — base
  characteristics, slug conventions, the `usage` quirk, key and documentation
  references, and the reasoning behind the onboarding choices. See
  [`conventions.md`](conventions.md) for the Record genre.

With the provider onboarded, curate its models via
[`model-curation.md`](model-curation.md).
