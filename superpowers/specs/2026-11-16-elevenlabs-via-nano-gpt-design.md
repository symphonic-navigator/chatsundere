# ElevenLabs via nano-gpt — Short Design

**Date:** 2026-11-16
**Status:** Approved by Chris (2026-11-16)
**Target:** 0.4.0 (`master`), ElevenLabs track step 3 of 3
**Builds on:** [`2026-11-15-elevenlabs-direct-design`](2026-11-15-elevenlabs-direct-design.md) (step 1)
and [`2026-11-16-teal-v2-design`](2026-11-16-teal-v2-design.md) (step 2).
**Memory:** Kumbu² `/SWE/Chatsundere/Memory/elevenlabs.md`.

## Why

There are two groups of users (Chris):

- **Privacy-conscious users** who route everything through nano-gpt, because there their
  identity is masked.
- **People who want to try ElevenLabs** without committing to an account there.

Chatsundere's scene nearly all has nano-gpt subscriptions. Most will want to *hear* the quality,
and those who like it will roughly switch to the direct path from step 1. Hence: **no high-end
implementation; take what nano-gpt offers.**

## Decisions

| # | Decision | Decided by, because |
|---|---|---|
| D1 | Two TTS offerings on the existing nano-gpt provider: `elevenlabs/eleven-v4` and `elevenlabs/eleven-v4-turbo`. | Chris: both, as in step 1 (v4 for read-aloud, Turbo for Live Voice). |
| D2 | No custom voice-ID entry and no price display. | Chris: take what nano-gpt offers; Grok and Mistral show no price either. |
| D3 | No ElevenLabs STT via nano-gpt. | Liz, agreed by Chris. nano-gpt's Scribe is asynchronous (HTTP 202 `{status: pending, run_id}`, then polling), which would be new machinery for dictation. Group a already has STT via nano-gpt (Grok, Voxtral), and group b wants to hear the voice, not dictate. |
| D4 | TEAL level `v2`. | Probed: `[teasing]` is not spoken and `[laugh]` is audible through nano-gpt. |

## Approaches

1. **Two offerings on the existing transport plus one new voice source (chosen).** It reuses
   `openai-speech` exactly as Grok via nano-gpt does.
2. **A separate "ElevenLabs via nano-gpt" provider.** Rejected: one nano-gpt key should cover
   everything, as it does today.

## Design

- **Offerings** (`packages/llm-unified/src/providers/nano-gpt.ts`), next to Grok's TTS:
  - refs `nano-gpt:elevenlabs/eleven-v4` and `nano-gpt:elevenlabs/eleven-v4-turbo`;
  - display names `Eleven v4` and `Eleven v4 Turbo`;
  - `transport: 'openai-speech'`, `teal: 'v2'`;
  - `contentModerated` mirrors the direct ElevenLabs offerings (`true` until Chris's step-1
    moderation test; then both paths change together);
  - `freedomOrientedDeployment: null`, `confidence: 'verified'`;
  - trust `{ tee: false, zdr: false, jurisdiction: 'US' }`, with the middleman hop noted in the
    record.
- **Voice source `{ kind: 'fetch'; endpoint: 'nano-gpt-audio-models' }`**:
  - It calls `GET /audio-models?type=tts&detailed=true` against the provider's base URL
    (`https://nano-gpt.com/api/v1`), which is public and CORS-open (probed).
  - It picks the entry whose `id` equals the offering's `upstreamSlug`, and maps
    `supported_parameters.voices` (names only) to `TtsVoice { id: name, name }`.
  - The juvenile filter and `hiddenCount` apply as everywhere.
  - Because the list depends on the model, the voice-list memo key includes the upstream slug
    for this source.
  - Without labels the picker shows no filters, only the plain list with search, as for Grok.
- **Request:** `POST /audio/speech` with `{ model, input, voice }`, where voice is the name. It
  returns `audio/mpeg`.
- **Copy and wiring:**
  - `TTS_DEFAULT_ORDER` gains both refs after the direct ElevenLabs ones.
  - Egress note: "Sends message text via nano-gpt to ElevenLabs (US)".
  - Any copy that names the voice services (the read-aloud unconfigured line, the font-voice
    hint) mentions nothing new, because nano-gpt is already named.
- **Curation** (`obsidian/models/eleven-v4.md`, new section): a listening sample through nano-gpt,
  latency (5.7–7.5 s for a short sentence against about 2.5 s direct; tell users in the record,
  not in the UI), the voice list, the TEAL check, and the 202-async STT finding.

## Non-goals

STT via nano-gpt, custom voice IDs, price display, and voice labels or filters for this source.

## Manual verification (Chris, on device)

1. With only a nano-gpt key, go to My Settings → Voice and set read-aloud to **Eleven v4 via
   nano-gpt**. Pass: the egress note names nano-gpt and ElevenLabs.
2. Open a persona's Font & Voice. Pass: the voice list shows the 21 names, search finds "lau",
   and no filter bar appears.
3. Read a teasing reply aloud. Pass: you hear the tease, and no tag is spoken.
4. Switch to **Eleven v4 Turbo via nano-gpt** and hold a short Live Voice exchange. Pass: it
   works; slower than direct is expected.
5. Switch back to Grok via nano-gpt. Pass: the persona's voice slot asks for a new choice (the
   stale hint from step 1).
