# ElevenLabs Direct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ElevenLabs as a voice-only provider (Eleven v4, Eleven v4 Turbo, Scribe v2) with an account voice picker offering search, filters and an open juvenile-voice filter.

**Architecture:** Extend the existing catalogue (spec D1): a header auth scheme on `ProviderDefinition`/`ProviderConfig`, new `'elevenlabs'` TTS/STT transports, an `'elevenlabs-v2'` voice source carrying metadata and a hidden count, one shared voice-list memo in the client used by the picker and by a synthesis guard.

**Tech Stack:** TypeScript strict, `packages/llm-unified` (bun test), `apps/user-client` (React 18, Vitest, Tailwind v4), Biome.

**Spec:** `superpowers/specs/2026-11-15-elevenlabs-direct-design.md`. Read it in full; section numbers below refer to it.

## Global Constraints

- British English in every identifier, comment, test name, log string and user-facing string (CLAUDE.md §3.7).
- Licence headers: `// SPDX-License-Identifier: LGPL-3.0-only` in `packages/llm-unified`, `// SPDX-License-Identifier: AGPL-3.0-only` in `apps/user-client`.
- No live ElevenLabs call in any test; inject `fetchFn` (CLAUDE.md §10).
- The key travels as header `xi-api-key` with no prefix, and never together with `Authorization` (§4).
- Every package-public function carries at least a one-line JSDoc.
- No `any` without an inline reason; `noUncheckedIndexedAccess` is on.
- Mobile-first at 380 px; no autofocus on the picker search (§7.1).
- Commit after each task on the current branch, subject capitalised, no Conventional Commits prefix, trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. **Subagents never merge, push or switch branches.**
- Gates per task: the package's own test command; at the end `pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm biome check .` (or the repo's `lint` script).

## Review Focus

1. **A stored voice ID that belongs to another service** (persona set up with Grok's `eve`, service now ElevenLabs, and the reverse): the user expects a "choose a new one" hint and no audio in a different voice. Tested in Task 5 (`resolveTts refuses an unknown voice on a static list`) and Task 6 (stale hint).
2. **A juvenile voice ID reaching synthesis by a path other than the picker** (imported persona, a voice set before the filter): it must never play. Tested in Task 5 (`resolveTts refuses a filtered ElevenLabs voice even when cached audio exists`).
3. **The ElevenLabs voice list failing to load (401 after a key rotation, offline)**: nothing plays, and the copy says the voices could not be loaded rather than "give this persona a voice". Tested in Task 5 (`voices-unavailable`).
4. **A voice name with odd casing or punctuation** ("TEEN-Spirit", "Kidd Rock", "Kind & Warm"): whole-word, case-insensitive matching filters the first and keeps the other two. Tested in Task 3.
5. **The key leaking into diagnostics**: any request built with `auth.header` must have that header redacted. Tested in Task 1 (every built-in provider's `auth.header` is in the secret set).

---

### Task 1: Header auth scheme and redaction

**Files:**
- Modify: `packages/llm-unified/src/types.ts` (`ProviderDefinition`, `ProviderConfig`)
- Modify: `packages/llm-unified/src/transport.ts` (`SECRET_REQUEST_HEADERS`, `buildRequest`)
- Modify: `packages/llm-unified/src/probe.ts` (pass the definition's scheme)
- Test: `packages/llm-unified/src/transport.test.ts`, `packages/llm-unified/src/probe.test.ts`

**Interfaces:**
- Produces: `export interface ProviderAuthScheme { header: string; prefix?: string }`; `ProviderDefinition.auth?: ProviderAuthScheme`; `ProviderConfig.auth?: ProviderAuthScheme`. Omitted means `{ header: 'Authorization', prefix: 'Bearer' }`.

- [ ] **Step 1: Write the failing tests** in `transport.test.ts`:
  - `buildRequest uses the xi-api-key header and no Authorization when the scheme says so`: config `{ baseUrl: 'https://api.elevenlabs.io/v1', routing: { kind: 'direct' }, auth: { header: 'xi-api-key' } }`, key `'k'` → `headers.get('xi-api-key') === 'k'`, `headers.get('authorization') === null`.
  - `buildRequest keeps Bearer Authorization when no scheme is given` (existing behaviour pinned).
  - `buildRequest applies a prefix when the scheme carries one`: `{ header: 'X-Api-Key', prefix: 'Token' }` → `'Token k'`.
  - `redactRequestHeaders drops xi-api-key`.
  - `every built-in provider's auth header is redacted`: for each `listProviders()` with `auth`, `SECRET_REQUEST_HEADERS.has(auth.header.toLowerCase())` (export the set if it is not exported).
- [ ] **Step 2:** In `probe.test.ts`: `probeProvider sends the definition's auth scheme` (definition with `auth: { header: 'xi-api-key' }`, the captured request has `xi-api-key` and no `authorization`); and `probeProvider reports ok with no model count for a bare-array body` (`[{ "model_id": "eleven_v4" }]` → `{ ok: true, modelCount: undefined }`).
- [ ] **Step 3: Run** `cd packages/llm-unified && bun test src/transport.test.ts src/probe.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.** Types as in Interfaces. `buildRequest` sets the key header from `provider.auth` (header name as given, value `prefix ? \`${prefix} ${apiKey}\` : apiKey`), and sets no `Authorization` when a non-default header is used. The cors-proxy branch keeps its `x-chatsundere-authorization` and `x-cors-proxy-target` headers unchanged. Add `'xi-api-key'` to `SECRET_REQUEST_HEADERS`. In `probeProvider`, build with `{ ...args.config, auth: args.config.auth ?? args.definition.auth }`.
- [ ] **Step 5: Run** the same command. Expected: PASS, and the full `bun test` stays green.
- [ ] **Step 6: Commit** "Add a header auth scheme to provider configs".

### Task 2: ElevenLabs transports, provider and offerings

**Files:**
- Modify: `packages/llm-unified/src/types.ts` (`Capability` gains `'tts' | 'stt'`)
- Modify: `packages/llm-unified/src/catalogue/types.ts` (`TtsTransportKind`, `SttTransportKind`, `TtsVoiceSource` endpoint union)
- Modify: `packages/llm-unified/src/catalogue/schema.ts` (the same picklists)
- Modify: `packages/llm-unified/src/tts/synthesise-speech.ts` (`wireFor`)
- Modify: `packages/llm-unified/src/stt/transcribe-audio.ts` (explicit transport switch)
- Create: `packages/llm-unified/src/providers/elevenlabs.ts`
- Modify: `packages/llm-unified/src/providers/_register-builtins.ts`
- Test: `tts/synthesise-speech.test.ts`, `stt/transcribe-audio.test.ts`, `tts/offerings.test.ts`, `stt/offerings.test.ts`, `providers/builtins.test.ts`

**Interfaces:**
- Consumes: `ProviderAuthScheme` (Task 1).
- Produces: `TtsTransportKind` includes `'elevenlabs'`; `SttTransportKind` includes `'elevenlabs'`; `TtsVoiceSource` fetch endpoint union includes `'elevenlabs-v2'`; offering refs `elevenlabs:eleven_v4`, `elevenlabs:eleven_v4_turbo`, `elevenlabs:scribe_v2`.

- [ ] **Step 1: Write failing tests:**
  - `synthesise-speech.test.ts` › `elevenlabs transport posts to text-to-speech with model_id`: voiceId `'a b'`, slug `eleven_v4` → URL ends `/text-to-speech/a%20b?output_format=mp3_44100_128`, JSON body exactly `{ text, model_id: 'eleven_v4' }`, response `audio/mpeg` bytes → blob with `mimeType 'audio/mpeg'`.
  - `transcribe-audio.test.ts` › `elevenlabs transport sends model_id and tag_audio_events=false to speech-to-text`: path `/speech-to-text`, form fields `model_id === 'scribe_v2'`, `tag_audio_events === 'false'`, no `model` field; a webm blob is sent as `audio/webm` (no spoof); response `{ text: ' Hi ', language_code: 'eng' }` → `{ text: 'Hi' }`.
  - offering/registry tests: the three refs exist; both TTS offerings have `teal: 'passthrough'`, `transport: 'elevenlabs'`, `voices: { kind: 'fetch', endpoint: 'elevenlabs-v2' }`, `contentModerated: true`; all three have `trust: { tee: false, zdr: false, jurisdiction: 'US' }` and `freedomOrientedDeployment: null`; the provider has `auth: { header: 'xi-api-key' }`, `capabilities: ['tts', 'stt']`, `probe: { path: '/models', method: 'GET' }`, `corsHint: 'direct'`, `baseUrl: 'https://api.elevenlabs.io/v1'`; the catalogue schema accepts the entries.
- [ ] **Step 2: Run** `cd packages/llm-unified && bun test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Follow `providers/xai.ts` for the shape. Display names: `'Eleven v4'`, `'Eleven v4 Turbo'`, `'Scribe'`. `contentModerated: true` carries the comment `// TODO(Chris manual test, spec §11 step 10): set from the moderation hand test`. `confidence: 'verified'` (live probes 2026-11-15). For `shape`, add `'none'` to its union and use it here (decided: honest over a misleading value). In `transcribeAudio`, replace the two `transport !== 'xai-native'` checks with one exhaustive `switch` returning `{ path, fields }`, as `wireFor` does.
- [ ] **Step 4: Run** `bun test`. Expected: PASS.
- [ ] **Step 5: Commit** "Add the ElevenLabs provider with Eleven v4 and Scribe".

### Task 3: Voice metadata, the juvenile filter and the `elevenlabs-v2` source

**Files:**
- Create: `packages/llm-unified/src/tts/juvenile-filter.ts`
- Modify: `packages/llm-unified/src/tts/voices.ts`
- Modify: `packages/llm-unified/src/index.ts` (exports)
- Test: `packages/llm-unified/src/tts/juvenile-filter.test.ts`, `packages/llm-unified/src/tts/voices.test.ts`

**Interfaces:**
- Produces:
  - `TtsVoice` gains `origin?: 'own' | 'predefined'`, `gender?: 'female' | 'male' | 'neutral'`, `language?: string`, `description?: string`.
  - `export interface TtsVoiceList { voices: TtsVoice[]; hiddenCount: number }`.
  - `listTtsVoices(args): Promise<TtsVoiceList>`. **This changes the return type**; the existing sources return `hiddenCount: 0`. `ListTtsVoicesArgs.endpoint` gains `'elevenlabs-v2'`.
  - `export const JUVENILE_VOICE_TERMS: readonly string[]` and `export function isJuvenileVoice(v: { name: string; description?: string }): boolean`, both exported from the package index.

- [ ] **Step 1: Write failing tests.**
  - `juvenile-filter.test.ts`: a table test. True for "Munni - Animated Kid Character", "Isabel - Soft Spoken Teen", "TEEN-Spirit", "Baby Doll", "Kinderstimme Lea", "schulmädchen", and a description "a little girl voice". False for "Jessica - Playful, Bright, Warm", "Sweet girl next door" (`girl` is deliberately absent), "Young and confident" (`young` is deliberately absent), "Kind & Warm", "Kidd Rock".
  - `voices.test.ts` › `elevenlabs-v2 pages through next_page_token, maps metadata and filters juveniles`: page 1 `{ voices: [premade Jessica (labels gender female, language en), cloned "Cove"], has_more: true, next_page_token: 't' }`, page 2 `{ voices: [premade "Piku - Expressive Kid Character"], has_more: false }`. The second request URL contains `next_page_token=t`, page size is 100. Result `{ voices: [Jessica{origin:'predefined',gender:'female',language:'en'}, Cove{origin:'own'}], hiddenCount: 1 }`.
  - `voices.test.ts` › `xai-flat and mistral-paginated report hiddenCount 0` (adapt the existing assertions to `.voices`).
- [ ] **Step 2: Run** `bun test src/tts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Terms exactly as spec §6.5, English plus German, multi-word phrases included (`little girl`, `young girl`). Match whole words, case-insensitive, with Unicode-aware boundaries (`(?<![\p{L}\p{N}])term(?![\p{L}\p{N}])`, flag `iu`), so "schulmädchen" matches and "Kidd" does not. Use `GET /v2/voices?page_size=100` (plus `&next_page_token=…`). The mapping `category === 'premade'` → `'predefined'`, anything else → `'own'`; `labels.gender`, `labels.language`, `description`. Filter before returning and count what was dropped.
- [ ] **Step 4: Run** `bun test`. Expected: PASS.
- [ ] **Step 5: Commit** "List ElevenLabs account voices with metadata and the juvenile filter".

### Task 4: Shared voice-list memo in the client

**Files:**
- Create: `apps/user-client/src/lib/voice/voice-list.ts`
- Modify: `apps/user-client/src/components/voice/VoicePicker.tsx` (drop its private memo, use the module)
- Modify: `apps/user-client/src/lib/voice/voice-transport.ts` (carry `auth` into `providerConfig`)
- Modify: `apps/user-client/src/lib/voice/resolve-tts.ts` (`TtsTransport.providerConfig` type gains `auth?`)
- Test: `apps/user-client/tests/lib/voice/voice-list.test.ts`

**Interfaces:**
- Consumes: `listTtsVoices`, `TtsVoiceList` (Task 3); `resolveTtsTransport` (existing).
- Produces:
  - `export function voiceListKey(t: TtsTransport): string`: `${providerId}:static:${upstreamSlug}` for static sources, `${providerId}:${endpoint}` for fetched ones, so v4 and v4 Turbo share one key.
  - `export function loadVoiceList(opts?: { fresh?: boolean }): Promise<{ key: string; list: TtsVoiceList } | null>`: null when no TTS transport. `fresh` drops the memo for that key first. Static sources resolve to `{ voices: [...list], hiddenCount: 0 }`. A rejected promise is evicted only while it still owns the slot (keep the existing rule).
  - `export function _resetVoiceListForTests(): void`.

- [ ] **Step 1: Write failing tests** (`voice-list.test.ts`, mock `resolveTtsTransport` and `listTtsVoices`):
  - `v4 and v4 Turbo share one fetch` (two calls, different upstream slugs, same provider/endpoint → `listTtsVoices` called once).
  - `fresh refetches` (second call with `{ fresh: true }` → called twice).
  - `a failed fetch is evicted and the next call retries`.
  - `static sources need no fetch`.
- [ ] **Step 2: Run** `cd apps/user-client && pnpm vitest run tests/lib/voice/voice-list.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the module and switch `VoicePicker` to it: opening the picker calls `loadVoiceList({ fresh: true })` (spec §6.6), and eager name resolution calls `loadVoiceList()`. In `voice-transport.ts`, set `auth: providerDef.auth` on the `providerConfig` it builds (widen `VoiceTransportMaterial.providerConfig` to `ProviderConfig`).
- [ ] **Step 4: Run** the test and `tests/components/voice/VoicePicker.test.tsx`. Expected: PASS (update the picker tests that reset the old private memo to `_resetVoiceListForTests`).
- [ ] **Step 5: Commit** "Share one voice-list memo between picker and synthesis".

### Task 5: Synthesis guard and the `voices-unavailable` reason

**Files:**
- Modify: `apps/user-client/src/lib/voice/resolve-tts.ts`
- Modify: the reason unions and copy in `components/chat/MessageControls.tsx`, `ChatStream.tsx`, `MessageBlock.tsx`, `InteractionMode.tsx`, and `ReasoningPill.tsx` if it surfaces TTS reasons (follow every `'no-voice'` union)
- Test: `apps/user-client/tests/lib/voice/resolve-tts.test.ts`, the existing `MessageControls` test

**Interfaces:**
- Consumes: `loadVoiceList` (Task 4).
- Produces: `TtsResolution` failure reason `'no-provider' | 'no-voice' | 'voices-unavailable'`.

- [ ] **Step 1: Write failing tests** in `resolve-tts.test.ts`:
  - `refuses an unknown main voice on a static list` (nano-gpt static list, `persona.voice = 'abc123'` → `{ ok: false, reason: 'no-voice' }`).
  - `refuses an unknown main voice on a fetched list` (xAI list without it → `no-voice`).
  - `a stale narrator voice falls back to the main voice` (narrator ID absent from the list; a narrator segment synthesises with `persona.voice`).
  - `refuses a filtered ElevenLabs voice even when cached audio exists` (the list omits it because it was filtered, the cache holds an entry for that ID → `no-voice`, and the cache is never read).
  - `returns voices-unavailable when the ElevenLabs list fails` (the list rejects → `{ ok: false, reason: 'voices-unavailable' }`).
  - `proceeds as today when a non-ElevenLabs list fails` (the xAI list rejects → `ok: true`).
- [ ] **Step 2:** In the MessageControls test: `read tooltip for voices-unavailable` → `"Couldn't load your ElevenLabs voices — try again."`, and `read tooltip for no-voice` → `"Choose a voice for this persona in its editor"`.
- [ ] **Step 3: Run** `pnpm vitest run tests/lib/voice/resolve-tts.test.ts` plus the controls test. Expected: FAIL.
- [ ] **Step 4: Implement** the guard right after the existing `!persona.voice` check and before any cache use, per spec §6.5. "ElevenLabs" means `ttsMeta.voices.kind === 'fetch' && ttsMeta.voices.endpoint === 'elevenlabs-v2'` (no provider-id check). Thread the new reason through every union found by grepping `'no-voice'`.
- [ ] **Step 5: Run** the full user-client suite (`pnpm vitest run`). Expected: PASS apart from the known baseline flakes noted in STATUS.
- [ ] **Step 6: Commit** "Refuse voices the active service does not list".

### Task 6: Picker search, filters, hidden count and the stale hint

**Files:**
- Modify: `apps/user-client/src/components/voice/VoicePicker.tsx`
- Test: `apps/user-client/tests/components/voice/VoicePicker.test.tsx`

**Interfaces:**
- Consumes: `loadVoiceList` and `TtsVoiceList` (Tasks 3–4); the active offering label via `resolveTtsTransport` (`${ttsMeta.displayName} via ${providerDisplayName}`; the stale hint needs only the provider display name).

- [ ] **Step 1: Write failing tests** (exact copy from spec §7.1–7.2):
  - `shows search and filters only when voices carry metadata` (an ElevenLabs list has them; a Grok list without `origin` renders as today).
  - `search matches name and description case-insensitively` ("cov" → only Cove).
  - `Own and Female filters combine`; `the defaults are All and Any`.
  - `reopening resets search and filters`; `the search field is not autofocused`.
  - `filter miss shows "No voice matches" and Clear search and filters restores the list`.
  - `empty account shows the ElevenLabs website hint`: "No voices on your ElevenLabs account yet — add them on the ElevenLabs website."
  - `hidden count line`: absent at 0, "1 voice hidden by our juvenile-voice rule", "2 voices hidden by our juvenile-voice rule".
  - `stale ID shows the choose-again hint naming the service only when loaded`: "This voice isn't available at ElevenLabs — choose a new one." On load error, the existing error and Retry copy appear and no stale hint.
  - Each row shows an `own` pill for own voices and a language pill when `language` is set.
- [ ] **Step 2: Run** `pnpm vitest run tests/components/voice/VoicePicker.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with the existing `cs-segmented` pattern for both filters (labels `All`/`Own`/`Predefined` and `Any`/`Female`/`Male`) and the inline-marker pill style used elsewhere for `own` and language (CLAUDE.md §11). The gender glyph is the implementer's call. Keep the list scrollable at 380 px with the search and filters above it.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** "Add search, filters and the open juvenile notice to the voice picker".

### Task 7: Settings, service line and copy wiring

**Files:**
- Modify: `apps/user-client/src/routes/app/persona/font-voice.tsx` (service line §7.1a, disabled hint)
- Modify: `apps/user-client/src/components/voice/VoiceSection.tsx` (`EGRESS_NOTES`, both `unconfiguredCopy`)
- Modify: `apps/user-client/src/lib/voice/select-offering.ts` (default orders)
- Modify: `apps/user-client/src/routes/app/settings/provider.tsx` (Test a model, success copy)
- Test: `tests/routes/app/persona-font-voice.test.tsx`, `tests/components/voice/VoiceSection.test.tsx`, `tests/lib/voice/select-offering.test.ts`, `tests/component/settings-provider.test.tsx`

**Interfaces:**
- Consumes: provider `capabilities` (Task 2); `resolveTtsTransport`.

- [ ] **Step 1: Write failing tests** with the exact strings:
  - Font & Voice: the line "Voices from Eleven v4 via ElevenLabs · change in My Settings → Voice", whose second part links to the Voice settings route. Disabled hint: "Add a voice provider (xAI, nano-gpt or ElevenLabs) in My Settings to enable voice."
  - VoiceSection: egress "Sends message text to ElevenLabs (US)" for both TTS refs and "Sends microphone audio to ElevenLabs (US)" for `elevenlabs:scribe_v2`. Unconfigured copy: "Add the xAI, nano-gpt or ElevenLabs provider to enable read-aloud." and "Add the Mistral AI, xAI, nano-gpt or ElevenLabs provider to dictate."
  - select-offering: `TTS_DEFAULT_ORDER` ends `['elevenlabs:eleven_v4', 'elevenlabs:eleven_v4_turbo']`; `STT_DEFAULT_ORDER` ends `['elevenlabs:scribe_v2']` with Mistral still first; with only an ElevenLabs row, TTS auto-resolves to `elevenlabs:eleven_v4`.
  - Provider page for ElevenLabs: "Test a model" is disabled, with "ElevenLabs offers voices only. Choose it under My Settings → Voice, then pick a voice on a persona's Font & Voice page." visible. The success badge reads "✓ Key valid · voices unlocked"; xAI still reads "✓ Key valid · LLM unlocked".
- [ ] **Step 2: Run** the four test files. Expected: FAIL.
- [ ] **Step 3: Implement.** A provider is "voice only" when `!capabilities.includes('llm')`. Derive the reason string from `definition.displayName` so it is not hard-wired to ElevenLabs.
- [ ] **Step 4: Run** the full user-client suite. Expected: PASS (baseline flakes excepted).
- [ ] **Step 5: Commit** "Wire ElevenLabs into voice settings and provider setup".

### Task 8: ADR 0040, curation records and the gate

**Files:**
- Create: `obsidian/decisions/0040-filter-juvenile-voices.md` (content per spec §8, incl. the Mill stance and the AGPLv3 consequence)
- Create: `obsidian/providers/elevenlabs.md`, `obsidian/models/eleven-v4.md` (from the Kumbu² note and spec §9; Liz runs the remaining TEAL wrapping-tag probes and attaches the MP3s for Chris)
- Modify: `obsidian/decisions/README.md` if it indexes ADRs

- [ ] **Step 1:** Write the ADR and the two records, then commit "Record ADR 0040 and the ElevenLabs curation" (`[skip ci]` only if this commit is docs-only).
- [ ] **Step 2: Full gate** from the repo root: `pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm biome check .`. Expected: all green apart from known baseline flakes; report any other failure.
- [ ] **Step 3 (Liz, not a subagent):** Larissa on the Task 1 diff (auth scheme, redaction, probe), and Laura pre-squash on Tasks 6–7. Fix or log deferrals, then push.
