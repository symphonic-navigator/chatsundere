# Provider Curation Record — ElevenLabs

**Onboarded:** 2026-11-15 (Liz, live probes in a cloud session) · **Status:** curated,
voice only: two TTS offerings (Eleven v4, Eleven v4 Turbo) and one STT offering (Scribe).
Spec: [`2026-11-15-elevenlabs-direct-design`](../../superpowers/specs/2026-11-15-elevenlabs-direct-design.md).
Model record: [[../models/eleven-v4]].

ElevenLabs is the first provider in Chatsundere with **no chat models**. Users asked
for it because Eleven v4 is the most expressive TTS we have heard, and because it speaks
profanity. Custom voices are cloned on the ElevenLabs website, not in Chatsundere.

## Base characteristics

- **id:** `elevenlabs` · **displayName:** ElevenLabs · **capabilities:** `['tts', 'stt']`
  · **shape:** `none`
- **Base URL:** `https://api.elevenlabs.io/v1`.
- **Auth:** header **`xi-api-key`, no prefix** (`ProviderDefinition.auth`). A Bearer
  `Authorization` header is refused (401 `invalid_authorization_header`), and sending
  both headers is refused too (401 `api_key_with_authorization_header_not_allowed`).
  `xi-api-key` is in `SECRET_REQUEST_HEADERS`, so the model debugger never records it.
- **Key for curation:** a cloud-environment network secret for `api.elevenlabs.io`,
  header `xi-api-key`. Never in CI.
- **Probe:** `GET /models` returns a bare array, so no model count is shown, and it costs
  no credits.
- **CORS:** wildcard-open, including preflight (`allow-origin: *`, `allow-headers: *`,
  POST), so `corsHint: 'direct'`. The cors-proxy forwards `xi-api-key` untouched.
- **sortPriority:** 50 (voice-only providers sort after the chat providers).

## Trust

| Property | Status |
|---|---|
| TEE | ❌ none |
| ZDR | ❌ zero-retention mode (`enable_logging=false`) is enterprise-only |
| Jurisdiction | US (EU, India and Singapore residency hosts exist; not used) |

## Content policy

The Use Policy (last updated 2026-10-09) does not mention profanity. It forbids slurs
"used to attack or demean", visual depictions of explicit sexual acts, erotica involving
incest, bestiality or necrophilia, non-consensual intimate content, intimate audio of real
people without their consent, and anything involving minors. Enforcement is "in context":
removal, restriction or suspension of the account.

**No moderation canaries are sent from Claude sessions** (Chris, 2026-11-15).
`contentModerated: true` and `freedomOrientedDeployment: null` (the **Uncensored?** badge)
stay until Chris's manual moderation test (spec §11, step 10). If nothing is refused,
`contentModerated` becomes `false` and `freedomOrientedDeployment` becomes `true`.

## Errors

JSON `{ detail: { status, message, … } }`: 404 `voice_not_found`, 400 `model_not_found`,
401 for auth. The typed TTS/STT errors carry the HTTP status.

## Voices

`GET /v2/voices?page_size=100` (path `../v2/voices` against the v1 base), paged by
`next_page_token` while `has_more`. Each voice carries `category` (`premade` → predefined,
anything else → own), `labels.gender`, `labels.language`, `labels.descriptive`,
`description` and a preview URL (unused). Juvenile voices are filtered out before the
list leaves `llm-unified` ([ADR 0040](../decisions/0040-filter-juvenile-voices.md)).
