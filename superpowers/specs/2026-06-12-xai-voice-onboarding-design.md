# xAI Voice Onboarding — Grok TTS/STT via Two Paths + Voice Slot Pickers

**Date:** 2026-06-12
**Status:** Approved by Chris (design conversation 2026-06-12, late session).
Laura spec-pass: **no hard defects, five soft notes — all five incorporated below**
(picker labels, slot-switch notice, visible auto-default, pinned disabled-hint copy,
egress disclosure at the picker).
**Scope:** Snack-sized session between dictation/STT (landed `3deb242` + `acc9092`) and Spec 3 (live voice).

## 1. Context & Goal

The NGO board decided (2026-06-12, unanimous; community 39:0) that xAI TTS supersedes
Mistral Voxtral TTS, whose endpoint-specific content moderation 403s on benign text.
Mistral STT stays — transcription is device-proven uncensored and the EU-hosted
privacy-friendly default for microphone audio.

This unit delivers:

1. **Four new offerings** — Grok TTS and Grok STT, each reachable **directly via xAI**
   and **via nano-gpt** (two independent catalogue offerings per service kind).
2. **Voice slot pickers** in My Settings → Voice — one for TTS, one for STT — following
   the established image-generation slot pattern, because `resolveTts`/`resolveStt`
   currently hardcode `offerings[0]` and we are about to have several.
3. **Mistral TTS leaves the GUI** — the offering and its code stay (registry, transport,
   tests) in case Mistral fixes their moderation, but it is not pickable and never
   auto-resolved.

The TEAL payoff: TEAL v1 *is* the xAI tag snapshot, so both xAI paths run
`teal: 'passthrough'` — the per-offering hook built into `TtsOfferingMeta` on day one
finally earns its keep. Expression tags travel inline in the text; no translation layer.

Reference implementation: chatsune's working xAI voice integration
(`~/workspace/chatsune/backend/modules/integrations/_voice_adapters/_xai.py` and
`_nano_gpt_voice_xai.py`) — empirically proven shapes, ported conceptually, not literally.

## 2. Catalogue — Four New Offerings

| Offering | Provider | `upstreamSlug` | Notes |
|---|---|---|---|
| Grok TTS | `xai` | `grok-tts` (synthetic — xAI's native TTS API takes **no model field**; the slug is our internal identifier only) | `teal: 'passthrough'` |
| Grok STT | `xai` | `grok-stt` (synthetic, same reason) | — |
| Grok TTS | `nano-gpt` | `xai-tts` (real nano-gpt slug) | `teal: 'passthrough'` |
| Grok STT | `nano-gpt` | `xai/speech-to-text/v1` (real nano-gpt slug) | — |

All four: `adapter: { kind: 'generic' }`, `serviceKind: 'tts' | 'stt'`, registered in
`packages/llm-unified/src/providers/xai.ts` and `nano-gpt.ts` beside the existing
LLM/TTI offerings. Display names: `Grok TTS` / `Grok STT` — the existing
"`<displayName>` via `<provider>`" label pattern (cf. "Voxtral Mini TTS via Mistral AI")
disambiguates the two paths in the picker.

`contentModerated: false` for all four as the working assumption — **probe-confirmed at
curation time**; if a probe shows moderation, the flag flips and the existing
`TtsModerationNotice` machinery covers it with zero extra work.

The Mistral offerings are untouched (registry entries, transport code, tests all stay).

## 3. Transports — Per-Offering Request Shapes

`synthesise-speech.ts` and `transcribe-audio.ts` are currently Mistral-shaped hardcodes.
Each gains a per-offering **transport discriminator** carried on the offering meta:

### 3.1 `TtsOfferingMeta` additions

```ts
transport: 'mistral-speech' | 'xai-native' | 'openai-speech';
voices: { kind: 'fetch' } | { kind: 'static'; list: ReadonlyArray<TtsVoice> };
```

| Transport | Used by | Request | Response |
|---|---|---|---|
| `mistral-speech` (existing behaviour, now named) | Mistral Voxtral TTS | `POST /audio/speech`, JSON `{ model, input, voice_id, stream: false }` | base64 MP3 in `audio_data` |
| `xai-native` | Grok TTS (xAI) | `POST /tts`, JSON `{ text, voice_id, language: 'auto' }` — **no `model` field** | **binary MP3 bytes** (`audio/mpeg`) |
| `openai-speech` | Grok TTS (nano-gpt) | `POST /audio/speech`, JSON `{ model, input, voice }` (note: `voice`, not `voice_id`) | MP3 bytes |

### 3.2 `SttOfferingMeta` additions

```ts
transport: 'openai-transcriptions' | 'xai-native';
```

| Transport | Used by | Request | Response |
|---|---|---|---|
| `openai-transcriptions` (existing behaviour, now named) | Mistral Voxtral STT, Grok STT (nano-gpt) | multipart `POST /audio/transcriptions`, fields `file` + `model`; language omitted (auto-detect) | JSON `{ text }` |
| `xai-native` | Grok STT (xAI) | multipart `POST /stt`, field `file` only — **no `model` field**; language omitted (auto-detect) | JSON `{ text }` |

### 3.3 nano-gpt audio auth — `x-api-key`

Chatsune empirics: nano-gpt's audio endpoints authenticate via the **`x-api-key`
header**, not `Authorization: Bearer` (unlike its LLM endpoints). The audio transports
gain a per-offering auth-style override (default `bearer`; the two nano-gpt audio
offerings set `x-api-key`). The curation probe re-confirms whether Bearer also works —
if it does, the override may be dropped, but the spec assumes chatsune's proven shape.

### 3.4 nano-gpt STT webm block — Matroska spoof

nano-gpt's transcription endpoint rejects `audio/webm` (chatsune INS-054, empirically
verified 2026-05-17; alternative spoofs failed). Our dictation blobs:

- **VAD utterances:** always `audio/wav` (`wav-encoder.ts:44`) — unaffected.
- **PTT:** MediaRecorder three-tier fallback `audio/webm;codecs=opus` → `audio/mp4` →
  WAV (`audio-recording.ts:27-30`) — **webm on Chrome/Firefox**, exactly the blocked type.

The `openai-transcriptions` transport therefore spoofs `audio/webm*` blobs as
`audio/x-matroska` (bytes unchanged — webm is a restricted MKV profile) **only when the
offering's provider is nano-gpt**; Mistral accepts webm as-is today and keeps it.
mp4/m4a and WAV are on nano-gpt's whitelist and pass through untouched.

### 3.5 Error mapping

Both new transports map into the existing error taxonomy
(`SpeechSynthesisError`/transcription errors with HTTP status): deterministic
4xx ≠ 408/429 → content-refusal branch (auto-skip for TTS read-aloud, honest copy for
dictation), 429/5xx/network → transient (Retry). No new error classes.

## 4. Voice Lists — Per Offering

- **Grok TTS (xAI direct):** `voices: { kind: 'fetch' }` → `GET /tts/voices`, parsing
  `voice_id`/`id` + `name` (chatsune `_xai.py:86-94`). Pagination handling mirrors the
  existing `listTtsVoices()` defensive loop.
- **Grok TTS (nano-gpt):** `voices: { kind: 'static', list }` — nano-gpt exposes no
  voice-list endpoint. The list, ported verbatim from chatsune
  (`_nano_gpt_voice_xai.py:37-43`):

  | Name | ID | Gender |
  |---|---|---|
  | Eve | `Eve` | female |
  | Ara | `Ara` | female |
  | Leo | `Leo` | male |
  | Rex | `Rex` | male |
  | Sal | `Sal` | neutral |

- **Mistral Voxtral TTS:** `voices: { kind: 'fetch' }` → existing `GET /audio/voices`.

`VoicePicker`'s module-level promise memo (one global voice list) becomes **keyed by the
selected TTS offering ref** — switching the TTS slot re-resolves the list. Eager
name-resolution on mount stays, now against the selected offering's list.

The curation probe checks whether the xAI-direct voice IDs match the five nano-gpt
names — if they do (expected), switching between the two xAI paths keeps persona voices
working seamlessly.

## 5. Voice Slot Pickers — My Settings → Voice

Two new pickers in the existing Voice section, following the image-generation slot
pattern. Labels are direction-anchored (Laura SOFT-1) — the verb, not the abstract
"provider":

- **Read-aloud voice** (TTS slot, in the existing Provider group near the read-aloud
  mode toggle) — subtitle "The voice that reads messages aloud." Lists Grok TTS via
  xAI and Grok TTS via nano-gpt. Mistral Voxtral TTS is **not listed** (superseded —
  fully absent, not disabled; it is dropped, not "coming soon").
- **Speech-to-text** (STT slot, inside the existing Dictation group) — subtitle
  "What turns your speech into text." Lists Voxtral Mini STT via Mistral AI, Grok STT
  via xAI, Grok STT via nano-gpt.

Offerings whose provider is not configured/enabled render **disabled-with-hint**
(disabled over hidden). The hint copy is pinned per offering, provider-named and
actionable (Laura SOFT-4): "Add the xAI provider in My Settings to enable this." /
"Add the nano-gpt provider in My Settings to enable this." / "Add the Mistral AI
provider in My Settings to enable this." The existing offering status line and the
dictation settings group stay where they are.

**Egress disclosure at the decision point (Laura SOFT-5):** the picker entries carry a
subtle one-line note stating where the data goes — STT entries: "Sends microphone audio
to xAI (US)" / "Sends microphone audio via nano-gpt to xAI (US)" / "Sends microphone
audio to Mistral AI (EU)"; TTS entries: "Sends message text to xAI (US)" / "Sends
message text via nano-gpt to xAI (US)". The conscious opt-in is conscious in the UI,
not only in this spec.

**Slot-switch notice (Laura SOFT-2, Chris's call to include):** after the user changes
the Read-aloud-voice slot, a calm static inline note renders under the picker:
"Personas keep their voice picks — if a voice came from the previous provider, re-pick
it in the persona editor." No validation round-trip (the §7 scope cut stands); the
note converts the reactive surprise into an invitation. It clears on leaving the
settings room.

### 5.1 Selection semantics & defaults

Settings gain two nullable offering refs (`"providerId:upstreamSlug"`, the
`substituteVisionModel` pattern):

```ts
ttsOffering: string | null;   // null = auto-default
sttOffering: string | null;   // null = auto-default
```

`null` means **curated auto-default order**, evaluated against configured+enabled
providers at resolve time:

- **TTS:** Grok TTS via xAI → Grok TTS via nano-gpt. (Fewer middlemen first. Mistral
  TTS is never auto-resolved.)
- **STT:** Voxtral Mini STT (Mistral) → Grok STT via xAI → Grok STT via nano-gpt.
  (Chris's call: microphone audio defaults to the EU provider; xAI — US, zdr:false —
  is a conscious opt-in.)

An explicit pick persists the ref and wins. If a picked offering's provider later
becomes unconfigured, resolution falls back to the auto-default order (and the picker
shows the stale pick as disabled-with-hint).

**The auto-default is visible, never blank (Laura SOFT-3):** while a slot is `null`,
the picker renders the *resolved* offering with an "(auto)" affordance — e.g.
"Grok TTS via xAI (auto)" — so the user can always see which provider is actually
speaking/listening without a network tab. When nothing resolves (no provider
configured), the slot shows the existing unconfigured hint.

`resolveTts`/`resolveStt` replace `offerings[0]` with this selection logic; everything
downstream (key decryption, CORS routing, cache) is untouched. The `voiceAudio` cache
key already includes provider + model + voice — switching slots is cache-safe by
construction.

### 5.2 Dexie v23

One migration: seed `ttsOffering: null` and `sttOffering: null` on the settings
singleton. (Head is v22 — re-verify at plan time per the parallel-version-ownership
rule.)

## 6. Mistral TTS GUI Removal

- Not listed in the TTS slot picker; never auto-resolved (§5.1).
- The persona editor's voice-picker `disabledHint` ("Add the Mistral provider…")
  becomes provider-neutral ("Add a voice provider (xAI or nano-gpt)…").
- `TtsModerationNotice` reads the **selected** offering instead of `offerings[0]` —
  with xAI (`contentModerated: false`) it disappears by itself; the mechanism stays
  for any future moderated offering.
- Registry entry, `mistral-speech` transport, and all Mistral TTS tests stay green.

## 7. Persona Voices Across Slot Switches — Conscious Scope Cut

Persona `voice`/`narratorVoice` stay plain voice-ID strings. After the TTS slot moves
to xAI, stored Mistral voice IDs are orphaned:

- The picker shows the raw ID until the user re-picks (eager name resolution finds no
  match in the new offering's list).
- Read-aloud with an orphaned voice goes through the existing constructive error path
  (provider rejects the unknown voice → Retry/Skip + honest copy).
- **No validation round-trip at read-aloud time** — deliberately out of scope for this
  snack-sized unit. Laura's spec-pass confirmed this path is constructively recoverable
  (not a dead-end); her SOFT-2 concern — the *silent* orphaning at the moment of the
  slot switch — is answered by the §5 slot-switch notice, so no deferral is needed.

Between the two xAI paths the five shared names are expected to match (§4 probe), so
that switch should be lossless.

## 8. Curation Probes (via `/curate`, serial, before code freeze)

Empirical truth over docs — each probe run one at a time, full responses inspected:

1. **xAI voice-endpoint CORS from the app origin** — chatsune's UPSTREAM-CORS notes
   wildcard-open CORS on the voice endpoints, unlike xAI chat (`corsHint:
   'requires-proxy'`). If confirmed, the two xAI offerings route **direct**; if not,
   they ride the existing CORS proxy. The offering carries the probed routing.
2. **nano-gpt audio auth** — `x-api-key` (chatsune-proven) vs Bearer.
3. **Voice-ID match** — xAI `GET /tts/voices` IDs vs the five nano-gpt names.
4. **webm acceptance** — re-confirm nano-gpt's block + Matroska spoof; confirm xAI
   direct accepts webm and WAV.
5. **Moderation canary** — the "eintauchen" sentence (the known Voxtral 403 trigger)
   through both TTS paths; sets `contentModerated` honestly.
6. **TEAL passthrough smoke** — a tagged sentence (`[laugh]`, `<whisper>`) through both
   TTS paths; audible expression confirms passthrough end-to-end.

Probe results land in the curation records under `obsidian/models/`.

## 9. Testing

- **llm-unified (bun):** transport branches (xai-native TTS body/binary-MP3 handling,
  xai-native STT multipart, openai-speech voice-field shape, x-api-key auth override,
  webm→Matroska spoof gated to nano-gpt), static-voice-list resolution, offering
  registration (`listTtsOfferings`/`listSttOfferings` counts and metas).
- **user-client (vitest):** slot-picker rendering (configured/unconfigured/disabled
  states with the pinned hint copy, egress notes, Mistral TTS absent from the TTS
  picker, "(auto)" rendering of the resolved default, the slot-switch notice),
  selection persistence + auto-default resolution order in `resolveTts`/`resolveStt`,
  `VoicePicker` per-offering memo keying, `TtsModerationNotice` reading the selected
  offering, Dexie v23 migration.
- No live-provider calls in CI (house rule); live behaviour is covered by the §8 probes
  and §11 manual verification.

## 10. Audit Gates & Egress

- **Larissa:** not a §9.1 path (client-only; no auth/sync/proxy/crypto). Two new egress
  classes logged in `obsidian/insights/security-deferrals.md`:
  spoken message text to xAI / nano-gpt (user-initiated read-aloud), and recorded
  microphone audio to xAI / nano-gpt (opt-in STT pick, no persistence — same lifecycle
  as the Mistral STT egress).
- **Laura:** **spec-pass required** (this document) — new pickers plus a reachability
  change (Mistral TTS removal). Pre-squash pass afterwards per §9.2 discipline.

## 11. Manual Verification (Chris, on device)

Restart `pnpm dev` first — `packages/llm-unified` changes (Vite HMR ignores
`packages/*`).

1. **Slot pickers appear:** My Settings → Voice shows the "Read-aloud voice" and
   "Speech-to-text" pickers with their subtitles. With xAI + nano-gpt + Mistral
   configured: TTS picker offers the two Grok paths (no Mistral entry); STT picker
   offers all three; each entry carries its egress note ("Sends microphone audio to
   xAI (US)" etc.).
2. **Auto-defaults visible:** with both slots untouched, the TTS slot reads
   "Grok TTS via xAI (auto)" and the STT slot "Voxtral Mini STT via Mistral AI (auto)";
   read-aloud actually uses xAI (network tab: `api.x.ai`), dictation Mistral
   (network tab: `api.mistral.ai`).
3. **Grok voice happy path:** pick a Grok voice in the persona editor (voice list loads
   from xAI), read a persona message aloud → MP3 plays, glow walks.
4. **TEAL passthrough:** have the persona produce an expressive message (`[laugh]`,
   `<whisper>`) → the voice audibly laughs/whispers; no tag text is spoken.
5. **Moderation canary:** the known "eintauchen" sentence reads aloud without a skip
   note (Voxtral 403 trigger passes on xAI).
6. **Path switch:** flip the TTS slot to Grok TTS via nano-gpt → the calm slot-switch
   note appears under the picker ("Personas keep their voice picks…") and clears on
   leaving the room; the same persona voice still works (shared voice names), network
   tab shows `nano-gpt.com`.
7. **xAI dictation:** flip the STT slot to Grok STT via xAI → PTT and VAD dictation
   both transcribe.
8. **nano-gpt dictation incl. spoof:** flip to Grok STT via nano-gpt → PTT on
   Chrome/Firefox (webm → Matroska spoof) and a VAD utterance (WAV) both transcribe.
9. **Disabled-with-hint:** disable the nano-gpt provider → its two picker entries grey
   out with an explanatory hint; resolution falls back per the default order.
10. **Moderation notice gone:** with an xAI path selected, the TTS moderation warning
    is absent from My Settings → Voice and the persona editor.
11. **Orphaned voice (scope cut):** a persona still holding a Mistral voice ID shows
    the raw ID in the picker; read-aloud surfaces the constructive error path; picking
    a Grok voice heals it.
