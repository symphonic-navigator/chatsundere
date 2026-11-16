# Model Curation Record — Eleven v4, Eleven v4 Turbo and Scribe

> Voice offerings on [[../providers/elevenlabs]]. Voice offerings have no CanonicalModel:
> identity lives on the offering (`serviceKind: 'tts' | 'stt'`).

- **Identity:** Eleven v4 (released 2026-09-28) and its low-latency sibling Eleven v4
  Turbo for TTS, plus Scribe v2 for STT.
- **Status:** curated on 2026-11-15, `confidence: verified`, from live probes, all run
  serially with every response inspected.
- **Moderation:** not probed (decided by Chris). See the provider record.

## Offerings

| Offering ref | Kind | Transport | Voice source | TEAL |
|---|---|---|---|---|
| `elevenlabs:eleven_v4` | TTS | `elevenlabs` | `fetch` (`elevenlabs-v2`) | `passthrough` |
| `elevenlabs:eleven_v4_turbo` | TTS | `elevenlabs` | `fetch` (`elevenlabs-v2`) | `passthrough` |
| `elevenlabs:scribe_v2` | STT | `elevenlabs` | — | — |

`GET /v1/models` also lists `eleven_v3`, `eleven_v3_conversational`,
`eleven_multilingual_v2`, the flash and turbo v2 families, and two speech-to-speech
models. Only the v4 pair is curated. Both v4 models take 10,000 characters per request
and support 94 languages.

## Probe log (2026-11-15)

### TTS: `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`

- Body `{ text, model_id }`. Optional: `language_code`, `voice_settings`,
  `previous_text`/`next_text` (accepted), `seed`, `apply_text_normalization`.
- Response: raw `audio/mpeg`, 44.1 kHz mono at 128 kbps, ID3-tagged. Headers carry
  `Character-Cost` and `Request-Id`, both CORS-exposed.
- **Latency for about 150 characters, non-streaming** (time to first byte): v4 2.2–2.6 s,
  v4 Turbo 1.6 s.
- German with Raya (a professional voice, `language_code: de`) works. Auto-detection also
  worked without the code.

### TEAL v1 under `passthrough`

**No tag, bracket or emoji is ever spoken.** This was checked with a Scribe round trip for
every probe.

| TEAL | Behaviour on v4 | Evidence |
|---|---|---|
| `<whisper>…</whisper>` | Whispers audibly, and the normal voice comes back afterwards without a reset tag | Chris listened (probes 01–03). The span is 1–2 dB quieter on v4 and about 5 dB quieter on Turbo. |
| `[laugh]` | A casual, wry "kche" rather than "hahaha". Chris likes it. | Chris listened (probe 01); Scribe misses it |
| `[sigh]`, `[laughs]` (in German) | Audible | Scribe hears [seufzt] and [lacht] (probe 05) |
| `[hum-tune]` | Hums | Scribe hears [humming] (probe 09) |
| `[tsk]`, `[gasp]`, `[giggle]` | Audible | Scribe hears [lips smacking], [gasps] and [laughs] (probe 10) |
| `<slow>`, `<fast>` | **No measurable effect.** Speaking rate 2.73 vs 2.66 words/s | Probe 07; harmless, simply ignored |
| `<higher-pitch>`, `<lower-pitch>`, `<build-intensity>`, `<decrease-intensity>`, `<emphasis>`, `<sing-song>`, `<singing>`, `<laugh-speak>` | Not spoken. Audible effect unconfirmed | Probes 07–10; MP3s are with Chris for a listen |
| 😂 | Not spoken | Probe 06 |

Consequence: `passthrough` is right for v1. No tag needs stripping. Tags that ElevenLabs
ignores cost nothing.

### STT: `POST /v1/speech-to-text`

- Multipart `file`, `model_id: scribe_v2`, `tag_audio_events=false` (dictation must not
  insert `[laughs]`). There is no `model` field.
- webm/opus, wav (16 kHz mono) and m4a are all accepted as they are, so no container spoof
  is needed.
- Response: `{ language_code, language_probability, text, words[] }`. Only `text` is read.

## Open

- Chris's moderation hand test sets `contentModerated` and the freedom badge.
- Chris to listen to probes 07–10 for the prosody tags.

## TEAL v2 (2026-11-16)

ElevenLabs is TEAL level `v2`, so every known tag is sent. Grok (xAI direct and nano-gpt) is
`v1`, and Mistral is `none`. Spec:
[`2026-11-16-teal-v2-design`](../../superpowers/specs/2026-11-16-teal-v2-design.md).

**Listening test** (Eleven v4, voice Jessica, `seed: 42`, the same sentence each time, all
harmless):

| Probe | Result |
|---|---|
| Companion tones `affectionate`, `teasing`, `flirtatious`, `seductive`, `shy`, `pouting` | **Confirmed by Chris's ear.** Each is audibly performed as named. Against the untagged control (5.0 s, −24.7 dB) they run 5.2–5.8 s and are up to 2 dB quieter; the strongest are seductive, pouting and shy. No tag is spoken. |
| New sounds `clear-throat`, `gulp`, `yawn`, `sniffle`, `groan`, `scoff` | All six are audible. Scribe hears [clears throat], [gulps], [yawns], [sniffs], "Ugh" and [scoffs]. |
| `[sarcastic]` against no tag, same words | 4.1 s against 3.5 s, a slower, drawn-out delivery. Chris confirmed the sarcasm. |

**Tag mix with the v2 prompt** (spec D7: the guard that Grok users must not lose v1 sounds).
Measured as 12 companion prompts × 4 samples through nano-gpt, at temperature 0.8:

| Prompt | Grok 4.3: v1 inline / wrapping per reply | Moods per paragraph |
|---|---|---|
| v1 (before) | 0.98 / 0.27 | — |
| v2, first draft | 0.88 / 0.19 | 0.36 |
| v2 as merged ("a mood is never a substitute for a wrapping tag", "most paragraphs carry no mood") | 0.92 / 0.23 | 0.16 |

GLM 5.3, re-measured on 2026-11-16 with lower concurrency and a larger token budget (48/48 replies each; the earlier failures were self-inflicted): v1 inline 1.90 → 1.69 (−11 %), wrapping 0.60 → 0.42 (−30 %), moods in 21 % of paragraphs. Read: GLM over-dosed v1 markup before (about 2.5 per reply against the prompt's 0–2) and now sits at about 2.1. Chris judges on device whether GLM with a Grok voice sounds any flatter.

**Grok strip, verified:** at level `v1`, `[sarcastic] … [laugh] … [shy] … <whisper>…</whisper> [yawn]`
reaches Grok as `… [laugh] … <whisper>…</whisper> …`. Audible check (nano-gpt `xai-tts`, voice `eve`, after a transient HTTP 500 on all TTS models earlier that day): Scribe hears "Oh, great. [laughs] That is just wonderful news. Come here and sit with me. Long day?". The laugh survives, and no mood is spoken.
