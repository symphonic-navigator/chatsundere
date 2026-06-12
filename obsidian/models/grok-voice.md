# Model Curation Record — Grok Voice (TTS + STT)

> Curation record for the Grok voice capabilities — speech synthesis and
> transcription — on **both paths** (xAI direct, nano-gpt). See
> [[../providers/xai]] and [[../providers/nano-gpt]] for the shared provider
> mechanics. Voice offerings have no CanonicalModel — identity lives on the
> offering (`serviceKind: 'tts' | 'stt'`).

- **Identity:** Grok Voice (xAI) · TTS + STT · four offerings across two providers
- **Status:** curated 2026-06-12 — supersedes Mistral Voxtral TTS in the GUI
  (NGO board decision 2026-06-12; the Voxtral code and registry entries stay)
- **🔒 Privacy:** xAI is US jurisdiction, no TEE / no ZDR (`zdr: false`) — see
  [[../providers/xai]] for the future NGO-negotiated ZDR possibility. The
  nano-gpt path adds a middleman hop before the same upstream. Hence the
  curated STT auto-default keeps Mistral (EU) first; xAI is a conscious opt-in.
- **NSFW / moderation:** `contentModerated: false` on **all four** offerings —
  canary-probed (see below). The known Voxtral-TTS 403 trigger passes.
- **confidence:** `verified` — live probes on 2026-06-12, all serial, full
  responses inspected.

## Offerings — the four refs

| Offering ref | Kind | Transport | Voice source | TEAL |
|---|---|---|---|---|
| `xai:grok-tts` | TTS | `xai-native` | `fetch` (`xai-flat`) | `passthrough` |
| `xai:grok-stt` | STT | `xai-native` | — | — |
| `nano-gpt:xai-tts` | TTS | `openai-speech` | `static` (five-voice list) | `passthrough` |
| `nano-gpt:xai/speech-to-text/v1` | STT | `openai-transcriptions` (+ `spoofWebmAsMatroska`) | — | — |

The xAI slugs `grok-tts` / `grok-stt` are **synthetic** — xAI's native voice
endpoints take **no model field**; the slugs are internal identifiers only.
The nano-gpt slugs are real catalogue slugs.

`teal: 'passthrough'` on both TTS paths because TEAL v1 *is* the xAI tag
snapshot — expression tags travel inline in the text, no translation layer.

## Probe log (2026-06-12, serial)

### CORS — both xAI offerings route direct

The xAI voice endpoints answer wildcard-open CORS **including preflight**
(`access-control-allow-origin` / `-methods` / `-headers: *`) — unlike xAI
chat, whose provider-level `corsHint` is `requires-proxy`. Both xAI voice
offerings therefore route **direct** from the browser, implemented as
`Offering.corsOverride: 'direct'`.

### xAI TTS — `POST https://api.x.ai/v1/tts`

- Body `{ text, voice_id, language: "auto" }` — **no `model` field**.
- Response: **binary MP3 bytes** (`audio/mpeg`), 24 kHz mono, ~128 kbps.
- Moderation canary "Lass uns direkt eintauchen und loslegen." (the known
  Voxtral-TTS 403 trigger) → **HTTP 200**.
- TEAL-tagged text (`[laugh]`, `<whisper>`) → **HTTP 200**; audible
  verification of the expression is a device test (spec §11 step 4).

### xAI voice list — `GET https://api.x.ai/v1/tts/voices`

- **Unpaginated** `{ voices: [{ voice_id, name, language, gender, age? }] }`.
- The five multilingual voices: `ara`, `eve`, `leo`, `rex`, `sal` —
  **lowercase IDs, capitalised names**. Many further language-specific voices
  exist beyond the five.

### xAI STT — `POST https://api.x.ai/v1/stt`

- Multipart, field `file` only — **no `model` field**.
- Response: `{ text, language, duration, words[] }`.
- Accepted in live probes: MP3, WAV (16 kHz mono), and webm/opus — no
  container spoofing needed on the direct path.

### nano-gpt TTS — `POST /api/v1/audio/speech`

- Body `{ model: "xai-tts", input, voice }` (OpenAI speech shape — `voice`,
  not `voice_id`).
- Response: **binary MP3** (48 kHz, ID3-tagged).
- Moderation canary → **HTTP 200**; TEAL-tagged text → **HTTP 200**.

### nano-gpt STT — `POST /api/v1/audio/transcriptions`

- Multipart `file` + `model: "xai/speech-to-text/v1"`.
- Response: `{ text, language: "auto-detect", duration }`.
- `audio/webm` → **HTTP 400** "Unsupported file type: audio/webm. Supported
  types: MP3, WAV, OGG, OPUS, FLAC, AAC, MP4, M4A, MKV".
- The **identical bytes** declared `audio/x-matroska` with a `.mkv` filename
  → **HTTP 200** (chatsune INS-054 re-proven). Implemented as
  `SttOfferingMeta.spoofWebmAsMatroska` — declared MIME type and filename
  only; the audio bytes are unchanged (webm is a restricted MKV profile).

## Findings

- **One voice-ID namespace across both paths.** Lowercase voice IDs (`eve`)
  work on the nano-gpt path too, matching the xAI-direct `voice_id`s — so
  persona voice picks survive switching between the two Grok TTS paths.
  (The nano-gpt path has no voice-list endpoint; its offering carries the
  static five-voice list: Ara, Eve, Leo, Rex, Sal.)
- **Bearer auth works on nano-gpt audio.** chatsune used `x-api-key` out of
  habit, not necessity — probed live: `Authorization: Bearer` is accepted, so
  no per-offering auth override exists. The spec's assumed `x-api-key`
  override (§3.3) was dropped on probe evidence.
- **webm/Matroska spoof is nano-gpt-only.** xAI direct accepts webm as-is;
  Mistral accepts webm as-is; only the nano-gpt transcription endpoint blocks
  it, and only the declared type is touched.
- **Moderation:** `contentModerated: false` recorded for all four offerings,
  canary-based (the "eintauchen" sentence that 403s on Voxtral TTS returns
  200 on both Grok TTS paths).

## Implementation surface

- Transports: `mistral-speech` / `xai-native` / `openai-speech` (TTS) and
  `openai-transcriptions` / `xai-native` (STT) in
  `packages/llm-unified/src/tts/synthesise-speech.ts` and
  `stt/transcribe-audio.ts`.
- Voice sources: `fetch` `mistral-paginated` / `fetch` `xai-flat` / static
  five-voice list (`packages/llm-unified/src/tts/voices.ts`).
- Slot pickers "Read-aloud voice" and "Speech-to-text" in My Settings → Voice,
  with curated auto-default orders — TTS: Grok TTS via xAI → via nano-gpt;
  STT: Voxtral Mini STT (Mistral, EU-privacy default) → Grok STT via xAI →
  via nano-gpt. Settings refs `ttsOffering` / `sttOffering` (Dexie v23).
- Mistral Voxtral TTS is removed from the GUI (not pickable, never
  auto-resolved); its registry entry, transport, and tests stay.

## Manual verification

The eleven device-test steps live in
[[../../superpowers/specs/2026-06-12-xai-voice-onboarding-design|spec §11]]
(`superpowers/specs/2026-06-12-xai-voice-onboarding-design.md`) — slot
pickers, visible auto-defaults, Grok voice happy path, audible TEAL
passthrough, moderation canary, path switch, xAI and nano-gpt dictation
(including the Matroska spoof on Chrome/Firefox PTT), disabled-with-hint
fallback, moderation-notice absence, and the orphaned-voice scope cut. Not
duplicated here; Chris runs them on device.
