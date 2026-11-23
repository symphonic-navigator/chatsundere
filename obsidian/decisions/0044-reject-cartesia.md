# ADR 0044: Cartesia is not integrated

## Status

Accepted (2026-11-23), decided by Chris. Analysis: [`obsidian/insights/2026-11-22-cartesia-pre-analysis.md`](../insights/2026-11-22-cartesia-pre-analysis.md).

## Context

Cartesia (Sonic TTS, Ink STT) was assessed as a second voice provider for 0.6.0, next to ElevenLabs. The pre-analysis, from public documentation only, found a good technical fit: plain REST, a voice list with server-side search and useful metadata, cloning through the API, and roughly half the price of Eleven v4 for TTS and a third to half of Scribe for STT. TEAL v2 would have needed a translation table rather than passthrough, which is a cost but not a blocker.

Then we read the legal terms against our [Freedom Criteria](../FREEDOM-CRITERIA.md). Two clauses rule Cartesia out on their own, whatever the technology or the price:

1. **US residency only.** Terms of Service §1 (revised 2024-06-14) requires users to "reside in the United States or any of its territories". The Privacy Policy (revised 2026-11-15) says the services "are designed for users in the United States only". In Chatsundere every user brings their own key, so every user is Cartesia's customer under these terms. A user in Vienna, or anywhere else outside the US, would breach them on the day they sign up, and Cartesia could end their account at any time.
2. **Rubber clauses on content.** Terms §4.2(11) bans "obscene" content without defining it. The Acceptable Use Policy (revised 2025-07-23) adds a catch-all for anything that, "in our sole discretion, contradicts our values or is objectionable". Neither has a carve-out for fiction. Explicit adult role-play, explicit prose and dark fiction, which criteria 1–3 make central to Chatsundere, are exactly what such clauses can cover. Enforcement is suspension or termination at Cartesia's discretion, after the fact.

We draw hard lines ourselves (ADR 0040, the harm principle). We understand why a provider bans the genuinely illegal or dangerous, and why it excludes sanctioned regimes. What we do not accept:

- A provider that shuts out ordinary countries by default.
- A provider that keeps an undefined moral standard, which it can apply to our users whenever it likes.

A clear, narrow rule can be judged; a rubber clause can only be feared.

## Decision

1. **Cartesia is not integrated**: not in 0.6.0, not as a restricted option, not through an aggregator offering we curate.
2. **Each clause is a dealbreaker on its own.** Fixing one is not enough.
3. **Reconsider only when both are gone**:
   - terms that admit users outside the US (sanctions aside);
   - content rules that are specific enough to judge, in the way ElevenLabs names its categories.

   Default training on inputs (opt-out form) would still need a plain notice in that case.

## Consequences

- **ElevenLabs stays the only direct voice provider with TEAL v2.** The cost advantage Cartesia would have offered (TTS at about Eleven v4 Turbo prices, STT well below Scribe) is given up knowingly.
- **No Cartesia code is written.** The pre-analysis stays as the record of the technical facts, should the terms ever change.
- **The two reasons become part of provider vetting.** Before a voice or chat provider is onboarded, `/curate` checks its terms for residency restrictions beyond sanctions, and for undefined content standards that it enforces at its own discretion. Either one stops the onboarding before any code is written.
