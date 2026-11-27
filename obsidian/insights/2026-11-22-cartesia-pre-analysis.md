# Cartesia for Chatsundere 0.6.0 — pre-analysis

> **Outcome:** Chris rejected Cartesia on 2026-11-23, see [ADR 0044](../decisions/0044-reject-cartesia.md). The recommendation below is kept as written.

**Date:** 2026-11-22 · **Scope:** desk research from public documentation only, no API key yet, no probes, no code.
**Question:** Can Cartesia join ElevenLabs as a TTS + STT provider in Chatsundere 0.6.0, how does it fit TEAL v2, and do we *want* it under our Freedom Criteria ([`FREEDOM-CRITERIA.md`](../FREEDOM-CRITERIA.md))?

> Everything below is **docs truth, not probe truth** (CLAUDE.md §13: "empirical truth over docs"). Items marked 🔬 must be confirmed with tomorrow's key before anything is locked in.

---

## TL;DR

| Topic | Verdict |
|---|---|
| Technical fit (TTS + STT) | ✅ Good. Plain REST, multipart STT, voice list with server-side search. Fits the ElevenLabs pattern: one new `transport`, one new voice `endpoint`. |
| TEAL v2 | ⚠️ Partial. Cartesia speaks **emotions** (58 values, *English only, beta*), **`[laughter]`**, **speed** and **volume**. No whisper, no other sounds, no wrapping tags. Needs a **translation table**, not passthrough. |
| Voices via API | ✅ Yes, with search (`q`), gender, language/locale, own-vs-public, accents, tagline, description, preview URL. No age field. |
| Own voices | ✅ Instant cloning via API from **Pro ($5/mo)**, 3–10 s clip. Professional clones from **Startup ($49/mo)**, 2 slots. |
| Price vs ElevenLabs | 💶 TTS **≈ half of Eleven v4**, about Eleven v4 Turbo level. STT (ink-whisper batch) **≈ a third to half of Scribe**. But Cartesia is subscription + credits, not true pay-as-you-go. |
| ToS vs freedom criteria | ❌ **Weaker than ElevenLabs on every axis we care about:** vague "obscene" ban plus a "sole discretion / objectionable" catch-all, default training on inputs *and* outputs (opt-out form), and a ToS that says users must **reside in the US**. |
| **Recommendation** | **Integrate only as a clearly marked restricted option, and only after the US-residency question is settled.** It is not a freedom provider; it is a cheap, fast voice. ElevenLabs stays our expressive, freedom-leaning default. Details in §7. |

---

## 1. Where Cartesia would plug in (current architecture)

From `packages/llm-unified`:

- Voice-only providers are ordinary `ProviderDefinition`s with `shape: 'none'`, `capabilities: ['tts', 'stt']`, and voice `Offering`s (`serviceKind: 'tts' | 'stt'`), exactly like `providers/elevenlabs.ts`.
- TTS dispatch is by `TtsTransportKind` in `tts/synthesise-speech.ts` (`'mistral-speech' | 'xai-native' | 'openai-speech' | 'elevenlabs'`); STT by `SttTransportKind` in `stt/transcribe-audio.ts`.
- Voice lists by `TtsVoiceSource.endpoint` in `tts/voices.ts` (`'elevenlabs-v2'`, …), with the juvenile filter (ADR 0040) applied before the list leaves `llm-unified`.
- TEAL is a per-offering **level**: `teal: 'none' | 'v1' | 'v2'`, and synthesis strips what lies above it. ElevenLabs is `v2` (passthrough), Grok `v1`, Mistral `none`.
- Calls go **from the browser** with the user's own key (BYOK, vault-encrypted), directly when CORS allows (`corsHint: 'direct'`) or through the cors-proxy.

A Cartesia integration therefore needs:

1. `providers/cartesia.ts` with offerings for TTS and STT.
2. A new `TtsTransportKind` `'cartesia'` and `SttTransportKind` `'cartesia'`.
3. A new voice endpoint `'cartesia-voices'`.
4. **An auth extension:** Cartesia wants `Authorization: Bearer <key>` *plus* a mandatory **`Cartesia-Version`** header. `ProviderDefinition.auth` today knows a header name only; it needs a static extra header (small, generic change).
5. **A TEAL translation path** (see §3), which is new territory.

## 2. API facts (from docs)

### Auth and conventions

- Base `https://api.cartesia.ai`. `Authorization: Bearer sk_car_…` (server-side `X-Api-Key` also accepted).
- `Cartesia-Version` is **required**; current value `2026-08-14`. Pin it in the provider definition.
- Errors (version ≥ 2026-03-01): JSON `{ error_code, title, message, request_id, doc_url? }`.
- Cartesia says "never ship an API key in browser code" and offers short-lived **access tokens** (`POST /access-token`, grants `tts`/`stt`, max 3600 s). For BYOK this advice targets *developers* shipping *their* key; in Chatsundere the key is the user's own and lives in their own client, same as ElevenLabs. Option for later: mint a 1-hour token from the vault key and use only the token for requests, which narrows the blast radius if something leaks.
- 🔬 **CORS is not documented.** If it is not open, route through the cors-proxy; it must forward `Authorization` and `Cartesia-Version` untouched.

### TTS

- `POST /tts/bytes`, JSON body:
  - `model_id`: `sonic-3.6` (default), `sonic-3.5`, `sonic-3`, `sonic-latest`. Curate `sonic-3.6`; **never `sonic-latest`** (a moving alias defeats curation).
  - `transcript` (no documented max length 🔬), `voice` (`{ id }` or the ID string), `output_format` (`{ container: 'mp3', sample_rate: 44100, bit_rate: 128000 }` matches what we play today), `language` / `locale`, `generation_config` `{ speed 0.6–1.5, volume 0.5–2.0, emotion }`, `pronunciation_dict_id`.
  - Response: audio bytes, streamed with chunked encoding.
- Also SSE (`/tts/sse`, raw PCM only, word and phoneme timestamps) and WebSocket (`/tts/websocket`, continuations). Not needed for read-aloud; interesting later for Live Voice latency.
- No `previous_text`/`next_text` equivalent in `/tts/bytes`; continuity across segments is a WebSocket feature. 🔬 Listen for seams between segments.
- Concurrency per plan is low: **TTS 2 (Free), 3 (Pro), 5 (Startup), 15 (Scale)**. Our segmented read-aloud must not fire more than that in parallel, or it gets throttled. 🔬 Check the error shape on overflow.

### STT

- `POST /stt`, multipart: `file`, `model: 'ink-whisper'` (only batch model), `language`, `timestamp_granularities[]=word`.
- Formats include **webm**, m4a, wav, ogg, mp3, flac, so no container spoof is needed. 🔬 Confirm with a real MediaRecorder blob.
- Response `{ type: 'transcript', request_id, text, language, duration, words? }`. We read `text` only.
- ⚠️ **`language` defaults to `en`, and omitted language can come back *translated into English*.** We must always send the user's dictation language. That is a real behavioural trap.
- Realtime: `/stt/websocket` (manual finalize) and `/stt/turns/websocket` (`ink-2`, built-in turn detection, en/fr/hi/ja/es only). Not needed for dictation today.
- 🔬 An `/audio/transcriptions` path is named in the access-token grants, which hints at an OpenAI-compatible STT endpoint. If it exists, `'openai-transcriptions'` could be reused without a new transport.

## 3. TEAL v2 fit

### What Cartesia understands

- **Emotion** (beta, **English only**): self-closing `<emotion value="…"/>`, 58 values. Best-trained: `neutral, calm, angry, content, sad, scared`. Voices with the strongest emotional response named in the docs: Leo, Jace, Kyle, Gavin, Maya, Tessa, Dana, Marian.
- **Laughter:** `[laughter]`, and nothing else nonverbal.
- **Speed:** `<speed ratio="0.6–1.5"/>`, self-closing. **Volume:** `<volume ratio="0.5–2.0"/>`, self-closing.
- **Break:** `<break time="500ms"/>`. **Spell:** `<spell>…</spell>`.
- 🔬 **Unknown.** Whether unknown `[brackets]` or `<tags>` are **spoken aloud**. For ElevenLabs we proved that nothing is ever spoken; for Cartesia we must assume they might be until a Scribe or ink round trip says otherwise.

### Why passthrough does not work

TEAL writes moods as `[annoyed]`, sounds as `[laugh]`, prosody as `<whisper>…</whisper>`. Cartesia's syntax is different for every one of them, so passthrough would at best be ignored and at worst read aloud. Neither `v1` nor `v2` stripping fits either: `v1` keeps sounds Cartesia cannot voice.

### Proposed mapping (a deterministic table, no heuristics)

| TEAL | Cartesia | Note |
|---|---|---|
| Moods: `excited, amazed, proud, angry, sarcastic, anxious, scared, hesitant, confused, tired, bored, sad, curious, content, peaceful, affectionate, flirtatious` | `<emotion value="same"/>` | 1:1 |
| `annoyed` → `frustrated`, `startled` → `surprised`, `nervous` → `anxious`, `let-down` → `disappointed`, `thoughtful` → `contemplative`, `bitter` → `contempt`, `seductive` → `flirtatious`, `shy` → `insecure`, `pouting` → `hurt`, `playful` / `mischievous` / `teasing` → `happy` (or drop) | `<emotion value="…"/>` | Nearest neighbour; the companion tones lose nuance. To be judged by ear. |
| End of paragraph (mood scope ends) | `<emotion value="neutral"/>` at the next paragraph | Keeps TEAL's "a new paragraph starts neutral" rule. |
| `[laugh]`, `[chuckle]`, `[giggle]` | `[laughter]` | |
| `<soft>`, `<whisper>` … `</…>` | `<volume ratio="0.6"/>` … `<volume ratio="1"/>` | A quieter voice, **not** a whisper. |
| `<loud>` … | `<volume ratio="1.5"/>` … `<volume ratio="1"/>` | |
| `<slow>` / `<fast>` … | `<speed ratio="0.8"/>` / `<speed ratio="1.25"/>` … reset to 1 | |
| `[long-pause]`, `[pause]` (if present) | `<break time="1s"/>` / `500ms` | Sparingly: the docs warn that many breaks can cause hallucination. |
| Every other sound and wrapping tag | stripped | |
| Moods in non-English messages | stripped | Emotion is English-only per the docs. 🔬 Test whether German simply ignores it. |

**Design consequence, for Chris to decide:** this is a *translator*, which the TEAL v2 build deliberately avoided ("approach 1: a level per offering, no translator heuristics"). A clean way to keep that spirit: add a **TEAL dialect** next to the level (`teal: { level: 'v2', dialect: 'cartesia' }`), where a dialect is a pure lookup table applied after stripping. It stays deterministic and testable, and Grok, Mistral and ElevenLabs are untouched.

**Expressiveness compared with ElevenLabs:** clearly lower. No whisper, no sighs, gasps, yawns or the other B sounds, and moods only in English. For a German-speaking or ERP-heavy user base, Cartesia is the "fast and cheap" voice, not the "magic" voice.

## 4. Voices: listing and metadata

`GET /voices?limit=100&starting_after=…` (cursor paging, `has_more`, `next_page`).

**Filters (server-side):** `q` (name, description or ID search), `is_owner`, `gender` (`masculine | feminine | gender_neutral`), `language` (bare `de` = every German accent, or a locale `de-AT`), `include_archived`, `expand[]=preview_file_url`.

**Per voice:** `id` (UUID), `name`, `tagline` (≤ 32 chars), `description`, `gender`, `accents[] { accent, locale, is_native }`, `is_owner`, `is_pro` (professional clone), `access` (`private | public`), `visibility`, `status`, `created_at`, `preview_file_url` (auth required). No `age`, no tags or labels, no use-case field.

**Fit with our picker:** better than ElevenLabs for search (server-side `q`), and gender and accent map straight onto the existing filters. "Own vs predefined" = `is_owner`. The picker decision for ElevenLabs was **account voices only**. Cartesia has no "add to my library" in the API (no starring), so "account voices" would mean *own clones only*, which leaves new users with an empty list. **Decision needed:** show own voices plus the public catalogue, with `is_owner` as a filter.

**Juvenile filter (ADR 0040):** still needed and still works by keywords. Run it on `name`, `tagline` and `description`. Cartesia's own AUP forbids output that "relates to or represents individuals under the age of 18", so our filter and their policy point the same way.

## 5. Own voices (cloning)

- **Instant clone via API:** `POST /voices/clone`, multipart `clip` (≤ 16 MB; wav, mp3, ogg, webm, flac), `name`, `language` (required), optional `tagline`, `description`, `accent`, `access`. The docs say 3–10 s of source audio. Available from **Pro ($5/mo)**.
- **Professional voice clone (fine-tune):** from **Startup ($49/mo)** with 2 slots, Scale 4. Training is free, and speech costs the same 1 credit per character.
- **Localise** a voice into another accent: 225 credits per accent.
- **Voice changer and mixing are sunset** (2026). Voice embeddings no longer work, so voice IDs only.
- Consent: the AUP requires your own voice or "explicit consent"; no verification step is described.
- **Fit with our stance:** cloning stays on the provider's website, as with ElevenLabs (Chris, 2026-11-15). The API would allow in-app cloning, but that would turn us from a "neutral tool" into the cloning surface. Recommendation: **do not** build in-app cloning for 0.6.0.

## 6. Price compared with ElevenLabs

Official pages, read 2026-11-22. Cartesia sells **monthly subscriptions with credits** (TTS ≈ 1 credit per character; ink-whisper batch STT = 1 credit per 2 s), optional overage on paid plans, and a rollover cap of 2× the monthly credits. ElevenLabs API bills **per character or per hour at the same rate on every tier**, with pay-as-you-go.

### TTS, $ per 1M characters

| | Cartesia Pro ($5/mo, 100K) | Cartesia Startup ($49, 1.25M) | Cartesia Scale ($299, 8M) | Cartesia overage | ElevenLabs v4 | ElevenLabs v4 Turbo | v4 via nano-gpt |
|---|---|---|---|---|---|---|---|
| per 1M chars | **$50** | **$39** | **$37** | $65 / $45 / $38 | **$80** | **$40** | $136 |
| ≈ per hour of speech (~45–48K chars) | $2.25–2.40 | $1.76–1.88 | $1.68–1.79 | | ≈ $3.60–3.85 | ≈ $1.80–1.90 | ≈ $6.10–6.50 |

### STT, $ per hour of audio

| | Cartesia ink-whisper batch | Cartesia ink-whisper realtime | Cartesia ink-2 realtime | ElevenLabs Scribe v2 batch | Scribe v2 realtime |
|---|---|---|---|---|---|
| per hour | **$0.07–0.09** | $0.14–0.18 | $0.40–0.54 | **$0.20** | $0.22 |

### What that means for a Chatsundere user

- A heavy read-aloud user (≈ 1 hour of speech a month) pays **$5 at Cartesia Pro**, which covers about 2 hours, against roughly **$3.60–3.85 at ElevenLabs v4 PAYG**. For light users ElevenLabs PAYG is cheaper, because Cartesia has no plan without a monthly fee that includes commercial use. The Free plan has no commercial licence; for a private BYOK user that may not matter, but we should not recommend it.
- At equal volume, Cartesia costs about **half of Eleven v4** and roughly **the same as Eleven v4 Turbo**.
- STT is **2–3× cheaper** than Scribe, but Chris's verdict on Scribe ("verdammt gut, extrem schnell") sets the bar. ink-whisper is a Whisper-family model; quality is 🔬.
- Discrepancies in Cartesia's own docs (FAQ "3 credits/s, $0.39/h" against docs "1 credit per 2 s" for batch) suggest the FAQ means ink-2. 🔬 Check the real credit burn with the key.

## 7. ToS review against the Freedom Criteria

Documents: Terms of Service (last revised **2024-06-14**), Acceptable Use Policy (2025-07-23), Privacy Policy (2026-11-15), Safety page, Disclosure Requirements (undated). All at `cartesia.ai/legal/…`.

### 7.1 Content: does Cartesia add censorship on top?

| Point | Cartesia | ElevenLabs (for comparison, from our provider record) |
|---|---|---|
| Adult content between consenting adults | Not expressly allowed or banned. ToS 4.2(11) bans "**obscene**" content (undefined). | Bans only specific categories (visual explicit acts, incest, bestiality, necrophilia, non-consensual content, real people without consent, minors). |
| Catch-all | AUP: "any other content that, **in our sole discretion**, contradicts our values or is objectionable." | Enforcement "in context". |
| Fiction / violence | No fiction carve-out. Bans content that will "describe or encourage violent acts". Read literally, a heist or thriller scene could fall under it. | — |
| Profanity | Not mentioned (so presumably fine). | Not mentioned. |
| Minors | Hard ban, including output that "relates to or represents" under-18s. | Hard ban. |
| Monitoring | ToS 5.3: may review inputs and outputs "using automated and manual tools", may "remove, screen, edit, or delete" content, uses content "for … content moderation". | — |
| Enforcement | Warning, suspension, termination at Cartesia's sole discretion. ToS 9.3: suspension "for any or no reason". | Removal, restriction, suspension. |

**Reading against our criteria:** criterion 1 (ERP on a consenting-adults footing) and criterion 3 (explicit prose on request) collide with an undefined "obscene" ban plus a values-based catch-all. Criterion 2 (dark fiction) collides with a violence clause that has no fiction carve-out. This is not a hard line on illegal or dangerous content (which we would welcome); it is **moralistic discretion**. Whether Cartesia *enforces* it is unknown. That is a job for Chris's manual test, as with ElevenLabs, and not for canaries from Claude sessions.

→ Provisional catalogue values: `contentModerated: true`, `freedomOrientedDeployment: false` (**restricted**) *by written policy*. Cartesia earns `null` or `true` only if they clarify adult fiction in writing, not merely because a hand test went through, since the risk is account termination after the fact, not a refusal at request time.

### 7.2 Data use (an E2EE product sends companion text in plaintext to them)

- **Trains on inputs and outputs by default** (Privacy §3, ToS 5.3(c): perpetual, irrevocable licence "for … model training"). Inputs include "text prompts, voice or audio recordings" — for us that means **chat text for TTS and the user's voice for STT**.
- **Opt-out** exists through a web form (`play.cartesia.ai/privacy/data-controls`), and only for the future. It is not limited to Enterprise.
- No retention periods, no zero-data-retention option. Deletion on account closure is "may, but is not obligated to".
- ElevenLabs is no saint either (ZDR is Enterprise-only), but default training on intimate companion conversations is the one thing our users would least expect.

→ If we integrate: provider setup must show, plainly, "Cartesia trains on what you send unless you opt out" with a link to the form. Trust row: TEE ❌, ZDR ❌, Jurisdiction US.

### 7.3 Jurisdiction: the blocker to clarify first

- ToS §1: users must be 18 or older **and "reside in the United States or any of its territories"**.
- Privacy Policy: the services "are designed for users in the United States only and are not intended for users located outside the United States".
- California law, JAMS individual arbitration (30-day opt-out), Santa Clara County courts.

Chris is in Vienna, and much of the community is in Europe. Read literally, **a European user's own Cartesia account would breach Cartesia's Terms from day one**, which gives Cartesia a ready reason to terminate it. The ToS dates from 2024 and may lag behind Cartesia's international sales (Cartesia lists 40+ languages, which suggests it does sell abroad). 🔬 When creating the account tomorrow: does sign-up ask for a country? Is there an international or business ToS, or a DPA (`cartesia.ai/legal/dpa`) that overrides §1? If not, an email to Cartesia is worth it before we ship.

### 7.4 Voice cloning

- Own voice or "explicit consent" only. No celebrities, deceased persons, political candidates, or anyone without express permission. No verification described.
- This matches our "neutral tool" stance: users clone on Cartesia's site under their own contract.

### 7.5 Output licence

- Cartesia claims **no ownership** of inputs or outputs. Commercial use only on paid tiers (Pro and above). No attribution required. Cartesia does not warrant that you own the output.
- Unproblematic for us: the user owns their audio. Our AGPL code is unaffected, because we call an API and redistribute nothing.

### 7.6 AI disclosure requirement

- Apps that let end users "interact with AI" must tell them, *before* the first interaction, that (a) they talk to an AI and (b) conversations "are being recorded and may be shared with Cartesia".
- In Chatsundere's BYOK model **the user is the Cartesia customer**, so the duty is essentially theirs and trivially met, since nobody mistakes a companion app for a human. Still, a one-line notice in the Cartesia provider setup (combined with the training notice in 7.2) costs nothing and keeps us clean.

## 8. Recommendation

**Do not let Cartesia into 0.6.0 as a freedom provider. Integrate it, if at all, as an honest, clearly labelled "fast and affordable, restricted" voice, and only after the US-residency question is answered.**

Why:

1. **Freedom:** the written policy (undefined "obscene", "objectionable in our sole discretion", no fiction carve-out, monitoring) is **broader and vaguer than ElevenLabs'**, and the risk is account loss after the fact. Our community's core use (ERP, explicit prose, dark fiction) is exactly what the vague clauses cover.
2. **Privacy:** default training on intimate text and voice is at odds with what Chatsundere stands for. It is opt-out-able, but users must be told.
3. **Jurisdiction:** "US residents only" could make every European user's account invalid from the start. That is the one point that could turn "restricted" into "do not integrate".
4. **TEAL:** a noticeably poorer fit (moods English-only, no whisper, laughter as the only sound), and it needs a new dialect mechanism.
5. **What speaks for it:** roughly half the price of Eleven v4, very cheap STT, server-side voice search with good metadata, low latency (its whole pitch), API cloning. For users who want "good enough, fast, cheap", it is a genuine option.

**Suggested order if Chris says go:**

1. Tomorrow with the key: probe CORS, auth plus `Cartesia-Version`, `/voices` (count, German voices), `/tts/bytes` with TEAL dialect probes (are unknown tags spoken?), `/stt` with a webm blob and `language: de`, and real credit burn. Check sign-up and the DPA for the residency clause.
2. Chris decides: (a) TEAL dialect mechanism yes or no, (b) picker shows own plus public voices, (c) badge `restricted`.
3. Spec in `superpowers/specs/`, Laura spec-pass (picker and setup notices), then the build. Larissa is not needed unless the cors-proxy changes (it lives in `apps/proxy-service`), in which case she is.
4. Curation records `obsidian/providers/cartesia.md` and `obsidian/models/sonic-3.6.md`, and a diary entry for 0.6.0.

If the residency point comes back negative (no international terms), the recommendation becomes **"don't integrate, revisit when their terms change"**.

---

## Sources

Cartesia docs (read through markdown mirrors, 2026-11-22):
[TTS bytes](https://docs.cartesia.ai/api-reference/tts/bytes.md) ·
[TTS SSE](https://docs.cartesia.ai/api-reference/tts/sse.md) ·
[SSML tags](https://docs.cartesia.ai/build-with-cartesia/capability-guides/ssml-tags.md) ·
[Volume, speed, emotion](https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion.md) ·
[API conventions](https://docs.cartesia.ai/use-the-api/api-conventions.md) ·
[Client authentication](https://docs.cartesia.ai/get-started/authenticate-your-client-applications.md) ·
[Access token](https://docs.cartesia.ai/api-reference/auth/access-token.md) ·
[List voices](https://docs.cartesia.ai/api-reference/voices/list.md) ·
[Get voice](https://docs.cartesia.ai/2026-03-01/api-reference/voices/get.md) ·
[Clone voice](https://docs.cartesia.ai/api-reference/voices/clone.md) ·
[Deprecated models](https://docs.cartesia.ai/build-with-cartesia/tts-models/voice-ids.md) ·
[Fine-tune voices](https://docs.cartesia.ai/api-reference/fine-tunes/list-voices.md) ·
[STT batch](https://docs.cartesia.ai/api-reference/stt/transcribe.md) ·
[STT endpoints compared](https://docs.cartesia.ai/use-the-api/stt/compare-endpoints.md) ·
[Docs pricing](https://docs.cartesia.ai/pricing.md)

Cartesia commercial and legal:
[Pricing](https://cartesia.ai/pricing) ·
[Terms of Service](https://www.cartesia.ai/legal/terms) ·
[Acceptable Use Policy](https://cartesia.ai/legal/acceptable-use) ·
[Privacy Policy](https://cartesia.ai/legal/privacy) ·
[Safety](https://cartesia.ai/legal/safety) ·
[Disclosure Requirements](https://www.cartesia.ai/legal/disclosure-requirements)

ElevenLabs and cross-checks:
[ElevenLabs API pricing](https://elevenlabs.io/pricing/api) ·
[GLBGPT Eleven v4 pricing](https://www.glbgpt.com/hub/eleven-v4-pricing/) ·
[eesel Cartesia pricing](https://www.eesel.ai/blog/cartesia-sonic-3-pricing) (2025, partly outdated) ·
[Dupple Cartesia pricing](https://dupple.com/learn/cartesia-pricing.md)

Repo: `obsidian/FREEDOM-CRITERIA.md`, `obsidian/providers/elevenlabs.md`, `obsidian/models/eleven-v4.md`, `packages/llm-unified/src/{providers/elevenlabs.ts, catalogue/types.ts, teal/teal.ts, tts/, stt/}`.
