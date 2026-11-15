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
