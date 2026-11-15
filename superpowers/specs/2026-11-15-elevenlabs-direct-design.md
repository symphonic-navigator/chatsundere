# ElevenLabs Direct — TTS (Eleven v4, v4 Turbo), STT (Scribe) and the Account Voice Selector

**Date:** 2026-11-15
**Status:** Draft, pending Chris's approval
**Target:** 0.4.0 (`master`) — a new provider with a new transport is a feature, not a maintenance item (CLAUDE.md §12)
**Part of:** the 0.4.0 ElevenLabs track, step 1 of 3 (see §12)
**Research and probes:** Kumbu² `/SWE/Chatsundere/Memory/elevenlabs.md` (live probes 2026-11-15)

---

## 1. Purpose and the why

Users asked for ElevenLabs, above all its new model **Eleven v4** (released 2026-09-28).
They are enthusiastic for two reasons: v4 is the most expressive TTS we have heard, and
ElevenLabs speaks profanity, which matters to our users. The community (roughly 90 %
women) wants to hear **the voices it loves**, which means voices people clone or collect
on their own ElevenLabs account. Chris also wants ElevenLabs' speech-to-text (Scribe) as a
further option, *"so a single API key covers both directions"*.

Chatsundere is a neutral tool here, in the spirit of a CD-burning program sold "for
backups": what users clone on their own ElevenLabs account is their responsibility, under
their own contract with ElevenLabs. **We never name or suggest a purpose** for custom
voices, in the product or in marketing.

## 2. Decisions

| # | Decision | Decided by, because |
|---|---|---|
| D1 | ElevenLabs becomes a **regular provider in the existing registry**, the first one with no chat models; the catalogue is extended rather than a separate voice module built. | Chris, because it is the structurally simpler path — Ockham's razor against the whole system: one key, one setup flow, the same pickers. |
| D2 | **TEAL `passthrough`**, no translator in this step. | Chris and the probes: raw TEAL `<whisper>…</whisper>` whispered audibly, the normal voice returned afterwards without a reset tag, and `[laugh]` came out as a casual, wry laugh. No tag, emoji or bracket is ever read aloud. |
| D3 | **Custom voices are cloned on the ElevenLabs website**, not in Chatsundere. | Chris, because anyone able to wire two or three upstreams into Chatsundere can clone on their website. |
| D4 | The voice selector lists **the account's voices only** (`GET /v2/voices`), with search and filters. No browsing of the public voice library. | Chris, because users assemble their library on the ElevenLabs website themselves in this version, and that is fine. |
| D5 | **Juvenile voices are always filtered out**, by a narrow, openly documented keyword filter on name and description (§6.5), recorded in ADR 0040. | Chris, because of the SCAI line: here we are the ones who censor, but openly and very narrowly. It covers about 99 % of cases and keeps people with harmful intent away from the product. |
| D6 | **A persona keeps a single voice ID** (option B). When the ID does not exist at the active TTS service, the picker says so and asks for a new choice. No per-provider voice map. | Chris, explicitly: switching providers is extremely rare, and the nerd users who try everything can live with picking again. A per-provider map would be over-engineered. |
| D7 | Two TTS offerings, **Eleven v4** and **Eleven v4 Turbo**, plus one STT offering, **Scribe v2**. | My call: v4 for read-aloud quality, Turbo for Live Voice latency (1.6 s vs 2.2–2.6 s to first byte for ~150 characters, probed). The user picks in the existing slot pickers. |
| D8 | **No voice-settings sliders** (stability, similarity, clone strength). The account's stored per-voice settings apply. | My call: omakase over options (CLAUDE.md §11). |
| D9 | **REST per segment**, like Grok. WebSocket streaming is out of scope. | My call: it fits the existing voice machine unchanged. |
| D10 | No moderation canary probes from Claude sessions. `contentModerated` is set after Chris's own manual test (§11, step 10). | Chris, because he does not want trouble with Anthropic. |

## 3. Goals, non-goals, anti-goals

**Goals**
- A user adds one ElevenLabs key in *My Settings → Providers* and can then pick Eleven v4 or
  v4 Turbo as the read-aloud voice service and Scribe as the dictation service.
- The persona voice picker lists the account's voices, including cloned ones, with search
  ("cov" finds a voice called Cove), a filter for own vs predefined voices, and a gender filter.
- Juvenile voices never appear and are never synthesised.
- The key never shows up in any debug or diagnostics surface.

**Non-goals (this step)**
- In-app cloning (D3) and the public voice library (D4).
- Voice preview playback in the picker. The account's voices were heard on the ElevenLabs
  website when they were added, so the picker does not need it yet.
- TEAL v2 (emotion tags such as `[annoyed]`): step 2 of the track (§12).
- ElevenLabs via nano-gpt: step 3 of the track (§12).
- WebSocket streaming, the multi-speaker dialogue endpoint, `previous_text` / `next_text`
  continuity, IPA pronunciation, EU data residency hosts, zero-retention mode (enterprise only).

**Anti-goals** — this fails even if it technically works when:
- a persona silently falls back to a different voice (Principle of Least Astonishment);
- a juvenile-labelled voice can be selected or heard by any path, including a stored or
  imported ID;
- the `xi-api-key` value appears in the model debugger, logs or a diagnostic report;
- anything in the product or its copy hints at cloning a particular voice.

## 4. Constraints

| Constraint | Hard/soft | Why, and its price |
|---|---|---|
| The key is sent as header `xi-api-key`, no prefix. A `Bearer` `Authorization` header is refused (401), and sending both is refused too. | **Hard** | Upstream contract, probed 2026-11-15. |
| `xi-api-key` is redacted wherever request headers are recorded. | **Hard** | Security: the model debugger records request headers (`transport.ts` `SECRET_REQUEST_HEADERS`). |
| The juvenile filter is applied in `llm-unified`, so every consumer of the voice list sees the filtered list. | **Hard** | D5 says "always"; a filter in one UI component would leak through any other path. |
| Browser calls go direct; ElevenLabs answers wildcard CORS including preflight (`allow-headers: *`). | Soft | Probed. If an upstream change breaks it, routing through the cors-proxy is the fallback; stop and ask before building that. |
| No live provider call in CI; probes are local or in a cloud session with the network secret. | **Hard** | CLAUDE.md §10, curation rule. |
| British English everywhere in the repo. | **Hard** | CLAUDE.md §3.7. |
| Mobile-first at 380 px for the picker. | **Hard** | CLAUDE.md §3.4. |

## 5. Approaches considered

1. **Extend the existing catalogue (chosen, D1).** ElevenLabs is a normal `ProviderDefinition`
   with only `tts`/`stt` offerings; an auth scheme on the definition, new transport kinds, a
   richer voice source, and a picker that shows search and filters when the source carries
   metadata. Trade-off: a few places that assume every provider has chat models must tolerate
   one that has none.
2. **A separate voice-provider module** next to the LLM registry, with its own key storage.
   Trade-off: no LLM assumptions touched, but key management and settings UI duplicated, and two
   ways to set up a provider (against "single uniform flows"). Rejected.

## 6. Design — `packages/llm-unified`

### 6.1 Auth scheme on the provider definition

`ProviderDefinition` gains an optional `auth` field. `buildRequest` sees only a `ProviderConfig`
(`{ baseUrl, routing }`), which is assembled by hand in several places (`probe.ts`,
`provider.tsx`, `lib/voice/voice-transport.ts`, `lib/model-debug.ts` …). So `ProviderConfig`
gains the same optional `auth`, and every place that builds a config fills it from the definition,
preferably via one helper that derives a config from a definition (my call: it closes the gap
once instead of at each call site, and an omitted `auth` keeps today's Bearer behaviour). The
field:

```ts
/** How the API key travels; defaults to `{ header: 'Authorization', prefix: 'Bearer' }`. */
auth?: { header: string; prefix?: string };
```

ElevenLabs sets `{ header: 'xi-api-key' }`. `buildRequest` (`transport.ts:156`) sets the
key header from this scheme instead of the fixed `Authorization: Bearer`, and with a
non-default header it must **not** also set `Authorization` (upstream refuses both). The
cors-proxy path keeps its own `x-chatsundere-authorization` header untouched.

**Redaction:** `xi-api-key` joins `SECRET_REQUEST_HEADERS`. In addition, `redactRequestHeaders`
redacts whatever header name the request's `ProviderConfig.auth.header` names, so a future scheme
cannot slip through. (If threading the config into the redactor is awkward, the static entry
alone satisfies the hard constraint; the builder chooses.)

### 6.2 The provider

`providers/elevenlabs.ts`, registered in `_register-builtins.ts`:

- `id: 'elevenlabs'`, `displayName: 'ElevenLabs'`, `baseUrl: 'https://api.elevenlabs.io/v1'`.
- `probe: { path: '/models', method: 'GET' }`: verifies the key, costs no credits.
- `corsHint: 'direct'`.
- `capabilities`: the `Capability` union gains `'tts'` and `'stt'`; ElevenLabs declares
  `['tts', 'stt']`. Existing providers are not changed (their voice offerings already work
  without it). The builder checks every `capabilities` consumer for an implicit "has `llm`"
  assumption.
- `shape` is typed `'openai-chat-completions'` today. For a provider with no chat offerings it
  is never used for chat; the builder either widens the type (`'none'`) or leaves the value
  with a comment. Settle it in the plan.
- Trust on every offering: `{ tee: false, zdr: false, jurisdiction: 'US' }`.
- `freedomOrientedDeployment: null` (the **Uncensored?** badge) and `confidence: 'verified'` after
  curation. Decided by Chris: `null` until his manual moderation test (§11, step 10). If nothing is
  refused there, it becomes `true`.
- `catalogue/schema.ts` (`TtsOfferingMetaSchema` and the STT schema) gains the new `transport`
  value and voice `endpoint`; otherwise the catalogue entries fail validation.
- The probe reads `{ data: [...] }` for a model count; ElevenLabs' `/v1/models` returns a bare
  array, so no count is shown. That is harmless and needs no change.

### 6.3 The offerings

| Ref | Kind | `upstreamSlug` | Transport | Notes |
|---|---|---|---|---|
| `elevenlabs:eleven_v4` | TTS | `eleven_v4` | `elevenlabs` | `displayName: 'Eleven v4'`, TEAL `passthrough` |
| `elevenlabs:eleven_v4_turbo` | TTS | `eleven_v4_turbo` | `elevenlabs` | `displayName: 'Eleven v4 Turbo'`, TEAL `passthrough` |
| `elevenlabs:scribe_v2` | STT | `scribe_v2` | `elevenlabs` | `displayName: 'Scribe'` |

- Both TTS offerings: `voices: { kind: 'fetch', endpoint: 'elevenlabs-v2' }`.
- `contentModerated`: per D10, set from Chris's manual test. Until then the builder puts `true`
  with a `// TODO(Chris manual test)` comment, because showing the moderation notice wrongly is
  the honest failure mode; showing none wrongly is not.
- `defaultHighpassHz`: none unless curation hears a bass problem.

### 6.4 Transports

**TTS** — `TtsTransportKind` gains `'elevenlabs'`; the `wireFor` switch gets:

- path `/text-to-speech/{voiceId}?output_format=mp3_44100_128` (voice ID URL-encoded);
- body `{ text, model_id: upstreamSlug }`. No `language_code` (auto-detection worked for
  German and English), no `voice_settings` (D8);
- decode `raw-audio` (`audio/mpeg`, 44.1 kHz mono, 128 kbps; probed).

**STT** — `SttTransportKind` gains `'elevenlabs'`; `transcribeAudio` gets:

- path `/speech-to-text`, multipart `file` plus `model_id` (**not** `model`) and
  `tag_audio_events=false`. Dictation must not insert `[laughs]` into the user's text;
- webm/opus, wav and m4a are all accepted as they are (probed), so no `spoofWebmAsMatroska`;
- response `{ text, language_code, words, … }`; only `text` is read.

The existing comment in `transcribeAudio` ("a future third transport coherently inherits the
openai-style defaults") no longer holds; make the transport branching explicit/exhaustive,
mirroring `wireFor`.

**Errors:** upstream errors are JSON `{ detail: { status, message, … } }` (404
`voice_not_found`, 400 `model_not_found`, 401 auth). The existing typed errors carry the HTTP
status; no new error type is needed.

### 6.5 Voice source with metadata, and the juvenile filter

`TtsVoice` gains optional metadata, filled only by sources that have it:

```ts
export interface TtsVoice {
  id: string;
  name: string;
  /** 'own' for cloned/professional/generated voices, 'predefined' for premade ones. */
  origin?: 'own' | 'predefined';
  gender?: 'female' | 'male' | 'neutral';
  language?: string;     // ISO 639-1 from labels.language
  description?: string;
}
```

`listTtsVoices` with `endpoint: 'elevenlabs-v2'`:
- `GET /v2/voices?page_size=100`, following `next_page_token` while `has_more`;
- maps `category === 'premade'` → `'predefined'`, every other category → `'own'`;
- reads `labels.gender`, `labels.language`, `description`;
- applies `isJuvenileVoice` and drops matches **before** returning.

`isJuvenileVoice(voice)` — a pure function in `tts/juvenile-filter.ts` over a **data list** of
terms, matched case-insensitively on **whole words** against name and description:

- English: `kid`, `kids`, `kiddo`, `child`, `children`, `childlike`, `childish`, `teen`,
  `teens`, `teenage`, `teenager`, `boy`, `schoolboy`, `schoolgirl`, `little girl`, `young girl`,
  `toddler`, `baby`, `minor`;
- German: `kinderstimme`, `kindlich`, `jugendlich`, `teenie`, `schüler`, `schülerin`,
  `schulmädchen`, `mädchenstimme`.

Deliberately **not** listed, with the reason in the ADR: `girl` (adult voices often call
themselves that), `young` (ElevenLabs' `age: young` covers adults, 8 of the premade voices),
and the German `kind` (it collides with English "kind"). `baby` **stays**, decided by Chris,
because "baby" as a pet name for a woman normalises exactly what must not be normalised: a hard
line that society should draw even harder, all liberality notwithstanding. Known accepted false
positive: an adult narrator described as "children's storyteller" is filtered. Hard and narrow
beats clever.

ElevenLabs has **no child label** (`age` is only `young`/`middle_aged`/`old`; the public
library holds kid and teen voices labelled `young`), which is why the filter works on text.
This is written into ADR 0040.

**Synthesis guard:** because D5 says "never synthesised" and §3 forbids a surprise voice,
`resolveTts` refuses a stored voice ID that the active offering's voice list does not contain,
for **every** source with a list (fetched or static), not only ElevenLabs. For ElevenLabs that
list is the filtered one. (Laura H3: without this, an ElevenLabs ID sent to Grok yields a surprise
default voice or a vague error.)

- **Main voice** not in the list → the existing `no-voice` reason.
- **Narrator voice** not in the list → treated as unset, so narration uses the main voice, which
  is the documented default ("defaults to the main voice"). The picker shows the stale hint on the
  narrator slot.
- The guard runs **before** the voice-cache lookup, so no cached audio of a refused ID is replayed.
- **List cannot be loaded** (network, 401, timeout): for Grok and other non-ElevenLabs sources,
  synthesis proceeds as today, because an outage must not silence voice. For an `elevenlabs-v2`
  source it refuses with a new reason `voices-unavailable` and the copy "Couldn't load your
  ElevenLabs voices — try again." The juvenile rule wins over availability (fail closed), and the
  copy says what is actually wrong.

### 6.6 One shared voice-list memo

Today the memo is a private `Map` inside `components/voice/VoicePicker.tsx`, unreachable from
`resolveTts`. It moves into `lib/voice/` as one shared module used by the picker (names, list) and
by the guard. It is keyed by **provider and voice source**, not by offering, so Eleven v4 and
v4 Turbo share one list. It is **invalidated each time a picker opens**, so a voice cloned or added
on the ElevenLabs website appears without reloading the app. Opening a picker costs one free
`GET`; the guard and the name resolution reuse the last result. No refresh control is needed.

## 7. Design — `apps/user-client`

### 7.1 Voice picker: search and filters

When the loaded voices carry metadata (any `origin` set), `VoicePicker`'s open state shows,
above the list:

```
┌──────────────────────────────────────┐
│ 🔍 Search voices…                    │
│ [ All ] [ Own ] [ Predefined ]       │
│ [ Any ] [ Female ] [ Male ]          │
├──────────────────────────────────────┤
│ None                                 │
│ Cove                        own  ♀   │
│ Raya – Loud and Reassuring  de  ♀    │
│ …                                    │
└──────────────────────────────────────┘
```

- Search matches name and description, case-insensitive substring, client-side (the account
  list is small and already loaded).
- Two segmented filters (`cs-segmented`, as on the font page); defaults **All / Any**.
- Each row carries small inline-marker pills (CLAUDE.md §11) for `own` and language; the gender
  glyph is the builder's styling call.
- Empty result from search or filters: "No voice matches" with a **Clear search and filters**
  action (no dead end).
- Empty account (none at all, or none left after the juvenile filter) with no search or filter
  active: "No voices on your ElevenLabs account yet — add them on the ElevenLabs website."
- **Open about the filter:** when the juvenile filter removed at least one voice, a quiet line at
  the foot of the list says "2 voices hidden by our juvenile-voice rule" (singular for one). It is
  always shown when the count is above zero and is not dismissable. Decided by Chris, because we
  set this limit openly: hard against harm, as free as possible as long as nobody comes to harm
  (John Stuart Mill's harm principle). `listTtsVoices` therefore makes the hidden count available
  next to the list (the exact return shape is the builder's call).
- **No autofocus** on the search field (the mobile keyboard would cover the list). Each time the
  picker opens, search is empty and the filters are back on **All / Any**.
- Sources without metadata (Grok, the nano-gpt static list) render exactly as today.

### 7.1a Which service the voices come from

The persona voice block in `font-voice.tsx` gains one quiet line above the pickers:

> Voices from **Eleven v4 via ElevenLabs** · change in My Settings → Voice

The label comes from the active TTS offering, and the second half links to the Voice settings.
Why (Laura H2): a user who already has nano-gpt or xAI keeps auto-resolving to Grok after adding
the ElevenLabs key. Without this line their own voices are simply missing, and nothing says why or
where to switch. The default order stays as it is (D7: the user picks).

### 7.2 Stale voice ID (D6)

When a stored `persona.voice` or `narratorVoice` is not in the loaded list, the picker shows,
instead of the raw ID:

> This voice isn't available at **ElevenLabs** — choose a new one.

with the service name from the active TTS offering. It appears **only when the list loaded**
(`status === 'loaded'`). If loading failed, the existing error and Retry copy stay, because
"isn't available" would then be a false claim. This replaces the current "fall back to the raw ID"
last resort for all services. Read-aloud for that persona then fails the way it does for `no-voice`,
now on every service thanks to the guard in §6.5. The chat tooltip in `MessageControls.tsx:42`
becomes "Choose a voice for this persona in its editor", which reads right for both the missing and
the stale case.

### 7.3 Copy and wiring

- `font-voice.tsx`: the disabled hint "Add a voice provider (xAI or nano-gpt)…" becomes
  service-neutral, e.g. "Add a voice provider (xAI, nano-gpt or ElevenLabs) in My Settings to
  enable voice." (or a list built from the registry; builder's call).
- `VoiceSection.tsx` `EGRESS_NOTES`: `elevenlabs:eleven_v4` and `…_turbo` → "Sends message text
  to ElevenLabs (US)"; `elevenlabs:scribe_v2` → "Sends microphone audio to ElevenLabs (US)".
- `select-offering.ts`: append `elevenlabs:eleven_v4`, then `elevenlabs:eleven_v4_turbo`, to
  `TTS_DEFAULT_ORDER`, and `elevenlabs:scribe_v2` to the end of `STT_DEFAULT_ORDER`. Mistral (EU)
  stays first for STT; ElevenLabs is auto-picked only when it is the only voice provider.
- `settings/provider.tsx`: "Test a model" is **disabled with a reason** for a provider without
  chat offerings: "ElevenLabs offers voices only. Choose it under My Settings → Voice, then pick a
  voice on a persona's Font & Voice page." (Disabled over hidden, CLAUDE.md §11. Laura H1: there is
  no test on the Font & Voice page, so the copy must not send the user there to test.)
- `settings/provider.tsx:259`: the success copy "Key valid · LLM unlocked" depends on capabilities.
  For a voice-only provider it reads "Key valid · voices unlocked".
- `VoiceSection.tsx` `unconfiguredCopy` (lines 170 and 300), the `font-voice.tsx` hint, and any
  other copy that names the voice services gain ElevenLabs.

## 8. ADR 0040 — Juvenile voices are filtered out

`obsidian/decisions/0040-filter-juvenile-voices.md`, Nygard style: context (ElevenLabs account
voices, no child label, the SCAI line), decision (hard keyword filter in `llm-unified`, list in
a data file, synthesis guard), consequences (accepted false positives, the list grows by
curation only, never by heuristics, and applies to every future voice provider with metadata; the
picker states the hidden count openly).

The ADR also records the stance in both directions, in Chris's words: hard against harm, as free
as possible as long as nobody comes to harm (John Stuart Mill). It secures the reference deployment
and sets a clear sign. Chatsundere cannot control what others do with the software. But under the
AGPLv3 a deployer who removes the filter and offers the modified app to users has to publish that
source, and so has to answer publicly why they make such a thing possible.

## 9. Curation records

Via `/curate`: `obsidian/providers/elevenlabs.md` (auth header, CORS, probe, errors, trust) and
`obsidian/models/eleven-v4.md` (both TTS offerings and Scribe, probe log, TEAL behaviour per tag,
latency). Curation probes the TEAL v1 wrapping tags not yet heard (`slow`, `fast`,
`higher-pitch`, `lower-pitch`, `build-intensity`, `decrease-intensity`, `singing`, `sing-song`,
`hum-tune`, `laugh-speak`, `emphasis`) in a few hundred characters and hands the MP3s to Chris.
A tag that misbehaves audibly (read aloud, or wrecking the sentence) is noted in the record; if
one does, `passthrough` gets a narrow strip list for this transport, not a translator.

## 10. Testing

- **llm-unified (bun test):**
  - `buildRequest` with `auth: { header: 'xi-api-key' }` sets exactly that header and no
    `Authorization`, and the default scheme is unchanged;
  - redaction drops `xi-api-key`;
  - `wireFor('elevenlabs')` path, query and body;
  - Scribe multipart fields (`model_id`, `tag_audio_events`);
  - `listTtsVoices('elevenlabs-v2')` pagination, metadata mapping and filtering;
  - `isJuvenileVoice` against a table of names, including the deliberate non-matches
    (`girl`, `young`, "kind and warm");
  - offerings registry entries.
- **user-client (Vitest):** picker search and both filters; empty result with clear; stale-ID
  hint names the service and appears only when loaded; empty-account state; the hidden-count
  line (absent at zero, singular and plural); "Test a model"
  disabled with a reason for a voice-only provider; `resolveTts` refuses an unknown ID on every
  listed source, before the cache lookup, falls back to the main voice for a stale narrator ID, and
  returns `voices-unavailable` when the ElevenLabs list cannot load; the shared memo is invalidated
  on picker open and shared between v4 and v4 Turbo.
- **Gate:** `pnpm test`, `pnpm typecheck`, `pnpm run build`, Biome.
- **Audits:** Laura spec-pass on §7 before the plan; Larissa on the diff for §6.1 (header
  scheme and redaction), although `llm-unified` is not a mandatory Larissa path. It is the
  judgement call of CLAUDE.md §9.1, made because a key leak path is in play.

## 11. Manual verification (Chris, on device)

1. **Add the provider.** *My Settings → Providers → ElevenLabs*, paste the key, **Test & Save**.
   Pass: "Key valid · voices unlocked" flashes and you land back on the provider list, with
   ElevenLabs listed.
2. **Model test is honest.** Open ElevenLabs in the provider list again and look at **Test a
   model**. Pass: it is greyed out, and the reason points you to My Settings → Voice.
3. **Your own voices are findable.** Before switching anything, open a persona → *Font & Voice*.
   Pass: a line names the current service (e.g. Grok) and links to My Settings → Voice.
4. **Pick the service.** Follow that link; read-aloud service → **Eleven v4 via ElevenLabs**.
   Pass: the egress note says "Sends message text to ElevenLabs (US)".
5. **Search.** Open a persona → *Font & Voice* → **Voice**, type "cov". Pass: only Cove (or
   your cloned voice) remains in the list.
6. **Filters.** Tap **Own**, then **Female**. Pass: only your own female voices remain; **All /
   Any** brings back everything.
7. **Expression.** Pick a voice, ask the persona for something with a whisper and a laugh, and
   let it read aloud. Pass: it whispers and laughs audibly, and no tag is ever spoken.
8. **Turbo in Live Voice.** Switch the service to **Eleven v4 Turbo** and hold a short
   Live Voice exchange. Pass: replies start noticeably faster than with v4.
9. **Stale voice.** Switch the service back to Grok. Pass: the persona's voice slot says the
   voice isn't available at xAI and asks for a new choice; nothing plays with a surprise voice.
10. **Moderation, by hand (D10).** Read aloud a reply with strong profanity and an explicit
   adult passage of your own choosing. Pass: tell Liz whether ElevenLabs refused anything; that
   sets `contentModerated`.
11. **Dictation.** Dictation service → **Scribe via ElevenLabs**, dictate a sentence and laugh
    once. Pass: the text is right, with no "[laughs]" inserted.
12. **Juvenile filter.** On the ElevenLabs website, add a library voice named like "… Kid …"
    or "… Teen …" to your account, then reopen the picker (no app reload). Pass: it does not
    appear, and the foot of the list says "1 voice hidden by our juvenile-voice rule".

## 12. The 0.4.0 ElevenLabs track

Decided by Chris, step by step rather than at once:

1. **This spec** — ElevenLabs direct.
2. **TEAL v2** — emotion and attitude tags (`[annoyed]`, `[mischievously]`, …), where ElevenLabs
   goes beyond TEAL v1, with display render rows, the prompt segment, and a translator that
   strips them for Grok. Recorded here as the obvious next step, not a wish list.
3. **ElevenLabs via nano-gpt** — last.

## 13. Left to the builder

- Widening `shape` vs commenting it (§6.2); provider-aware vs static redaction (§6.1).
- Gender glyph vs text pill, and the exact pill styling (§7.1).
- Whether the provider list in the disabled hint is literal or built from the registry (§7.3).
- How the voice-list memo is keyed and invalidated internally, within §6.6.
