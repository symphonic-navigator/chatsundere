# ElevenLabs via nano-gpt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Offer Eleven v4 and v4 Turbo through the existing nano-gpt provider, with a live voice list.

**Architecture:** Two TTS offerings on the `openai-speech` transport, plus one new fetched voice source (`nano-gpt-audio-models`) that reads nano-gpt's public audio-models catalogue. Client wiring is limited to the default order, the egress note, and a slug-aware memo key.

**Tech Stack:** TypeScript strict, bun test, Vitest, Biome.

**Spec:** `superpowers/specs/2026-11-16-elevenlabs-via-nano-gpt-design.md` (approved).

## Global Constraints

- British English; SPDX headers (`LGPL-3.0-only` in llm-unified, `AGPL-3.0-only` in user-client); one-line JSDoc on public items; strict TS; no live calls in tests.
- Commit per task. Subject capitalised, no Conventional Commits prefix. Trailer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Subagents never merge, push or switch branches.

## Review Focus

1. **A model entry missing from the catalogue response** (nano-gpt renames a slug): the voice list fails cleanly (picker error and Retry), it does not show an empty list as if the account had no voices. Tested in Task 1.
2. **v4 and Turbo share one voice list, but the memo must not mix models whose lists differ:** the key includes the slug for this source. Tested in Task 2.

---

### Task 1: Offerings and the `nano-gpt-audio-models` voice source (llm-unified)

**Files:** `packages/llm-unified/src/catalogue/types.ts` and `schema.ts` (endpoint union), `src/tts/voices.ts` (+ test), `src/providers/nano-gpt.ts` (+ offerings tests)

**Interfaces:**
- `ListTtsVoicesArgs` gains `upstreamSlug?: string`, required for `'nano-gpt-audio-models'`.
- The endpoint union gains `'nano-gpt-audio-models'`.

- [ ] **Failing tests:**
  - `listTtsVoices({ endpoint: 'nano-gpt-audio-models', upstreamSlug: 'elevenlabs/eleven-v4', … })` requests path `/audio-models?type=tts&detailed=true`. It returns `{ voices: [{id:'Laura',name:'Laura'}, …], hiddenCount }` from the entry whose `id` matches.
  - A catalogue voice named "Kid Voice" is hidden and counted.
  - A missing slug entry throws `SpeechSynthesisError('voices: model not in catalogue', null)`.
  - The offerings exist: refs `nano-gpt:elevenlabs/eleven-v4` and `…-turbo`, display names `Eleven v4` / `Eleven v4 Turbo`, `transport: 'openai-speech'`, `teal: 'v2'`, `voices: { kind: 'fetch', endpoint: 'nano-gpt-audio-models' }`, `contentModerated: true` (same TODO comment as the direct ElevenLabs offerings), trust `{ tee: false, zdr: false, jurisdiction: 'US' }`, `freedomOrientedDeployment: null`, `confidence: 'verified'`.
  - The schema accepts the new endpoint.
- [ ] **RED, then implement, then GREEN.** Run `cd packages/llm-unified && bun test` and `pnpm typecheck`.
- [ ] **Commit** "Offer Eleven v4 through nano-gpt".

### Task 2: Client wiring (user-client)

**Files:** `apps/user-client/src/lib/voice/voice-list.ts` (memo key), `voice-list-active.ts` / `VoicePicker.tsx` (pass `upstreamSlug` to `listTtsVoices`), `src/lib/voice/select-offering.ts`, `src/components/voice/VoiceSection.tsx` (+ tests)

- [ ] **Failing tests:**
  - `voiceListKey` for `nano-gpt-audio-models` includes the upstream slug (v4 and Turbo get different keys). Other sources are unchanged.
  - `TTS_DEFAULT_ORDER` ends `[…'elevenlabs:eleven_v4','elevenlabs:eleven_v4_turbo','nano-gpt:elevenlabs/eleven-v4','nano-gpt:elevenlabs/eleven-v4-turbo']`.
  - Egress note "Sends message text via nano-gpt to ElevenLabs (US)" for both refs.
  - The picker passes `upstreamSlug` through.
- [ ] **RED, then implement, then GREEN.** Run the full user-client suite once (`pnpm vitest run --reporter=dot`) and `pnpm typecheck`.
- [ ] **Commit** "Wire Eleven v4 via nano-gpt into voice settings".

### Task 3 (Liz): Curation and gate

- [ ] Listening sample through the real pipeline text.
- [ ] Record latency, the voice list, TEAL behaviour and the asynchronous STT in `obsidian/models/eleven-v4.md`.
- [ ] Full gate.
- [ ] Laura light pass on the picker.
