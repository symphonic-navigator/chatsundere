# xAI Voice Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard Grok TTS and Grok STT via two paths each (xAI direct, nano-gpt), add Read-aloud-voice / Speech-to-text slot pickers to My Settings → Voice, and remove Mistral Voxtral TTS from the GUI while keeping its code.

**Architecture:** Four new `serviceKind: 'tts' | 'stt'` offerings in the llm-unified catalogue with per-offering transport discriminators (the existing Mistral hardcodes become the named `mistral-speech` / `openai-transcriptions` transports); a pure client-side offering selector (explicit settings ref → curated auto-default order) replaces the `offerings[0]` hardcode in `resolveTts`/`resolveStt`; two slot pickers in the Voice settings section drive the selector.

**Tech Stack:** TypeScript strict, Bun test (llm-unified), Vitest (user-client), Dexie v23 migration, Biome.

**Spec:** `superpowers/specs/2026-06-12-xai-voice-onboarding-design.md` — read it first.

**Probe results (live, 2026-06-12, all serial — these are FACTS, not assumptions):**

- xAI voice endpoints are CORS-open (`access-control-allow-origin/methods/headers: *` incl. preflight) → both xAI offerings route **direct** despite the provider's `corsHint: 'requires-proxy'` (chat needs the proxy; voice does not). Hence the new `corsOverride` field.
- `GET https://api.x.ai/v1/tts/voices` → **unpaginated** `{ "voices": [{ "voice_id", "name", "language", "gender" }] }`. The five multilingual voices: `ara`, `eve`, `leo`, `rex`, `sal` (**lowercase IDs**, capitalised names).
- `POST https://api.x.ai/v1/tts` body `{ text, voice_id, language: "auto" }` (NO `model` field) → **binary MP3** (`audio/mpeg`, 24 kHz mono). Moderation canary ("Lass uns direkt eintauchen und loslegen.") → 200. TEAL-tagged text → 200.
- `POST https://api.x.ai/v1/stt` multipart `file` only (NO `model` field) → `{ "text", "language", "duration", "words" }`; accepts MP3, WAV and webm.
- nano-gpt `POST /api/v1/audio/speech` body `{ model: "xai-tts", input, voice }` → **binary MP3** (48 kHz, ID3-tagged). **Bearer auth works** (no `x-api-key` override needed — chatsune's header was habit, not requirement). **Lowercase voice IDs work** → one ID namespace across both paths, persona voices survive path switches.
- nano-gpt `POST /api/v1/audio/transcriptions` multipart `file` + `model: "xai/speech-to-text/v1"` → `{ "text", ... }`. `audio/webm` → **HTTP 400** (whitelist: MP3, WAV, OGG, OPUS, FLAC, AAC, MP4, M4A, MKV). Same bytes as `audio/x-matroska` + `.mkv` filename → **200** (INS-054 re-proven).
- Moderation canary passes on both TTS paths → `contentModerated: false` on all four offerings.

**House rules for every task:** British English everywhere; no `!` non-null assertions (Biome bans them); `strict` + `noUncheckedIndexedAccess`; comments explain non-obvious *why* only; subagents never merge, push, or switch branches.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/llm-unified/src/catalogue/types.ts` | Modify | `TtsTransportKind`/`SttTransportKind`, voices source, `corsOverride`, meta extensions |
| `packages/llm-unified/src/providers/mistral.ts` | Modify | Name the existing transports on the two Voxtral metas |
| `packages/llm-unified/src/providers/xai.ts` | Modify | Add Grok TTS + Grok STT offerings (`corsOverride: 'direct'`) |
| `packages/llm-unified/src/providers/nano-gpt.ts` | Modify | Add Grok TTS (static voices) + Grok STT (webm spoof) offerings |
| `packages/llm-unified/src/tts/synthesise-speech.ts` | Modify | Transport branches: `mistral-speech` / `xai-native` / `openai-speech` |
| `packages/llm-unified/src/stt/transcribe-audio.ts` | Modify | Transport branches + Matroska spoof |
| `packages/llm-unified/src/tts/voices.ts` | Modify | `mistral-paginated` / `xai-flat` fetch endpoints |
| `apps/user-client/src/lib/voice/select-offering.ts` | Create | Pure offering selection (explicit ref → auto order), pickable lists |
| `apps/user-client/src/boot/client-data-db.ts` | Modify | `ttsOffering`/`sttOffering` settings fields + Dexie v23 |
| `apps/user-client/src/lib/voice/resolve-tts.ts` | Modify | Selection + corsOverride + transport args |
| `apps/user-client/src/lib/voice/dictation/resolve-stt.ts` | Modify | Selection + corsOverride + transport args |
| `apps/user-client/src/components/voice/VoicePicker.tsx` | Modify | Per-offering voice memo, static list, neutral error copy |
| `apps/user-client/src/components/voice/OfferingSlotPicker.tsx` | Create | Reusable slot picker (auto row, disabled-with-hint, egress notes) |
| `apps/user-client/src/components/voice/VoiceSection.tsx` | Modify | Wire the two slot pickers + slot-switch notice |
| `apps/user-client/src/components/voice/TtsModerationNotice.tsx` | Modify | Read the *selected* offering |
| `apps/user-client/src/routes/app/persona-editor.tsx` | Modify | Provider-neutral disabled hints |
| `obsidian/models/grok-voice.md` | Create | Curation record with the probe log |
| `obsidian/insights/security-deferrals.md` | Modify | Two new egress classes |

---

### Task 1: Catalogue types + the four offerings

**Files:**
- Modify: `packages/llm-unified/src/catalogue/types.ts`
- Modify: `packages/llm-unified/src/providers/mistral.ts` (TTS_META/STT_META only)
- Modify: `packages/llm-unified/src/providers/xai.ts`
- Modify: `packages/llm-unified/src/providers/nano-gpt.ts`
- Test: `packages/llm-unified/src/tts/offerings.test.ts`, `packages/llm-unified/src/stt/offerings.test.ts`

- [ ] **Step 1: Extend the offering types**

In `catalogue/types.ts`, add above `TtsOfferingMeta`:

```ts
/** How a TTS offering's synthesis request is shaped on the wire. */
export type TtsTransportKind = 'mistral-speech' | 'xai-native' | 'openai-speech';

/** How an STT offering's transcription request is shaped on the wire. */
export type SttTransportKind = 'openai-transcriptions' | 'xai-native';

/** Where a TTS offering's voice list comes from. */
export type TtsVoiceSource =
  | { kind: 'fetch'; endpoint: 'mistral-paginated' | 'xai-flat' }
  | { kind: 'static'; list: ReadonlyArray<{ id: string; name: string }> };
```

Extend `TtsOfferingMeta` with two fields (keep the existing `displayName`/`teal`/`contentModerated` docs):

```ts
  /** Wire shape of the synthesis request — see synthesise-speech.ts. */
  transport: TtsTransportKind;
  /** Voice-list source. nano-gpt exposes no voice endpoint, so its Grok
   *  offering carries a static list (probed live 2026-06-12). */
  voices: TtsVoiceSource;
```

Extend `SttOfferingMeta`:

```ts
  /** Wire shape of the transcription request — see transcribe-audio.ts. */
  transport: SttTransportKind;
  /**
   * nano-gpt rejects `audio/webm` outright but accepts the identical bytes as
   * `audio/x-matroska` (webm is a restricted MKV profile — chatsune INS-054,
   * re-proven live 2026-06-12). When true, webm blobs are sent spoofed.
   */
  spoofWebmAsMatroska?: boolean;
```

Extend `Offering` (after `confidence`):

```ts
  /**
   * Routing override for this offering when it diverges from the provider's
   * corsHint. xAI chat needs the CORS proxy, but its voice endpoints are
   * wildcard-open (probed 2026-06-12) and route direct.
   */
  corsOverride?: 'direct';
```

- [ ] **Step 2: Name the Mistral transports**

In `providers/mistral.ts`:

```ts
const TTS_META: TtsOfferingMeta = {
  displayName: 'Voxtral Mini TTS',
  teal: 'strip',
  // Voxtral runs a content-moderation filter that 403s on benign text (device
  // finding 2026-06-12). Surfaced to the user; read-aloud auto-skips refusals.
  contentModerated: true,
  transport: 'mistral-speech',
  voices: { kind: 'fetch', endpoint: 'mistral-paginated' },
};

const STT_META: SttOfferingMeta = {
  displayName: 'Voxtral Mini STT',
  // CORS-probed direct 2026-06-12 (HTTP 200 from the app origin); no
  // moderation behaviour observed on transcription — unlike the TTS endpoint.
  contentModerated: false,
  transport: 'openai-transcriptions',
};
```

- [ ] **Step 3: Write the failing offering tests**

Replace the single test body in `src/tts/offerings.test.ts` (keep the describe/beforeAll/afterAll shell):

```ts
  test('TTS offerings: mistral strip + the two probed Grok paths', () => {
    const tts = listTtsOfferings();
    expect(tts.map((o) => `${o.providerId}:${o.upstreamSlug}`).sort()).toEqual([
      'mistral:voxtral-mini-tts-2603',
      'nano-gpt:xai-tts',
      'xai:grok-tts',
    ]);

    const mistral = tts.find((o) => o.providerId === 'mistral');
    expect(mistral?.tts?.teal).toBe('strip');
    expect(mistral?.tts?.contentModerated).toBe(true);
    expect(mistral?.tts?.transport).toBe('mistral-speech');
    expect(mistral?.tts?.voices).toEqual({ kind: 'fetch', endpoint: 'mistral-paginated' });
    expect(mistral?.corsOverride).toBeUndefined();

    const xaiDirect = tts.find((o) => o.providerId === 'xai');
    expect(xaiDirect?.tts?.teal).toBe('passthrough');
    expect(xaiDirect?.tts?.contentModerated).toBe(false);
    expect(xaiDirect?.tts?.transport).toBe('xai-native');
    expect(xaiDirect?.tts?.voices).toEqual({ kind: 'fetch', endpoint: 'xai-flat' });
    expect(xaiDirect?.corsOverride).toBe('direct');
    expect(xaiDirect?.adapter.kind).toBe('generic');

    const nano = tts.find((o) => o.providerId === 'nano-gpt');
    expect(nano?.tts?.teal).toBe('passthrough');
    expect(nano?.tts?.transport).toBe('openai-speech');
    expect(nano?.tts?.voices).toEqual({
      kind: 'static',
      list: [
        { id: 'ara', name: 'Ara' },
        { id: 'eve', name: 'Eve' },
        { id: 'leo', name: 'Leo' },
        { id: 'rex', name: 'Rex' },
        { id: 'sal', name: 'Sal' },
      ],
    });
    expect(nano?.corsOverride).toBeUndefined();
  });
```

Mirror in `src/stt/offerings.test.ts`:

```ts
  test('STT offerings: mistral + the two probed Grok paths', () => {
    const stt = listSttOfferings();
    expect(stt.map((o) => `${o.providerId}:${o.upstreamSlug}`).sort()).toEqual([
      'mistral:voxtral-mini-latest',
      'nano-gpt:xai/speech-to-text/v1',
      'xai:grok-stt',
    ]);

    const mistral = stt.find((o) => o.providerId === 'mistral');
    expect(mistral?.stt?.transport).toBe('openai-transcriptions');
    expect(mistral?.stt?.spoofWebmAsMatroska).toBeUndefined();

    const xaiDirect = stt.find((o) => o.providerId === 'xai');
    expect(xaiDirect?.stt?.transport).toBe('xai-native');
    expect(xaiDirect?.stt?.contentModerated).toBe(false);
    expect(xaiDirect?.corsOverride).toBe('direct');

    const nano = stt.find((o) => o.providerId === 'nano-gpt');
    expect(nano?.stt?.transport).toBe('openai-transcriptions');
    expect(nano?.stt?.spoofWebmAsMatroska).toBe(true);
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/tts/offerings.test.ts src/stt/offerings.test.ts`
Expected: FAIL (only the Mistral offerings exist; meta fields missing).

- [ ] **Step 5: Add the xAI offerings**

In `providers/xai.ts`, add metas above `offerings` and two entries after the TTI offering (import `SttOfferingMeta`, `TtsOfferingMeta` from `../catalogue/types.js`):

```ts
const TTS_META: TtsOfferingMeta = {
  displayName: 'Grok TTS',
  // TEAL v1 IS the xAI tag snapshot — tags travel verbatim and are voiced.
  teal: 'passthrough',
  // Moderation canary (the Voxtral 403 trigger sentence) passed live 2026-06-12.
  contentModerated: false,
  transport: 'xai-native',
  voices: { kind: 'fetch', endpoint: 'xai-flat' },
};

const STT_META: SttOfferingMeta = {
  displayName: 'Grok STT',
  contentModerated: false,
  transport: 'xai-native',
};
```

```ts
  // Grok TTS — text-to-speech; bypasses the chat adapter entirely. The /tts
  // endpoint takes no model field; the slug is our internal identifier only.
  {
    canonicalRef: null,
    providerId: 'xai',
    upstreamSlug: 'grok-tts',
    adapter: { kind: 'generic' },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live probes 2026-06-12: CORS preflight, synthesis, canary, TEAL
    serviceKind: 'tts',
    tts: TTS_META,
    // Voice endpoints are wildcard-CORS-open, unlike chat (probed 2026-06-12).
    corsOverride: 'direct',
  },
  // Grok STT — speech-to-text; /stt takes no model field either.
  {
    canonicalRef: null,
    providerId: 'xai',
    upstreamSlug: 'grok-stt',
    adapter: { kind: 'generic' },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live probes 2026-06-12: MP3/WAV/webm all transcribed
    serviceKind: 'stt',
    stt: STT_META,
    corsOverride: 'direct',
  },
```

- [ ] **Step 6: Add the nano-gpt offerings**

In `providers/nano-gpt.ts` (import the meta types), add near the TTI metas:

```ts
// nano-gpt's xAI voice wrapper exposes no voice-list endpoint; this static
// list mirrors xAI's five multilingual voices. Lowercase IDs are the canonical
// namespace — both paths accept them (probed live 2026-06-12), so persona
// voice picks survive a path switch.
const GROK_VOICES = [
  { id: 'ara', name: 'Ara' },
  { id: 'eve', name: 'Eve' },
  { id: 'leo', name: 'Leo' },
  { id: 'rex', name: 'Rex' },
  { id: 'sal', name: 'Sal' },
] as const;

const GROK_TTS_META: TtsOfferingMeta = {
  displayName: 'Grok TTS',
  teal: 'passthrough', // nano-gpt forwards xAI expression tags untranslated
  contentModerated: false, // moderation canary passed live 2026-06-12
  transport: 'openai-speech',
  voices: { kind: 'static', list: GROK_VOICES },
};

const GROK_STT_META: SttOfferingMeta = {
  displayName: 'Grok STT',
  contentModerated: false,
  transport: 'openai-transcriptions',
  spoofWebmAsMatroska: true, // INS-054: webm 400s, identical bytes pass as MKV
};
```

Two offerings appended to the `offerings` array (same literal shape as the xAI ones, with `providerId: 'nano-gpt'`, slugs `'xai-tts'` / `'xai/speech-to-text/v1'`, `trust: { tee: false, zdr: false, jurisdiction: 'US' }` — nano-gpt routes to xAI upstream — `confidence: 'verified'`, **no** `corsOverride` since nano-gpt is CORS-open already, and probe comments referencing 2026-06-12).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test`
Expected: PASS, no regressions across the whole suite.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Add Grok TTS/STT offerings on xAI and nano-gpt with transport metadata"
```

---

### Task 2: TTS transport branches in synthesiseSpeech

**Files:**
- Modify: `packages/llm-unified/src/tts/synthesise-speech.ts`
- Test: `packages/llm-unified/src/tts/synthesise-speech.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the existing test file (mirror its fetch-stub style — it injects `fetchFn` and asserts on the captured `Request`). New cases:

```ts
test('xai-native: posts {text, voice_id, language} to /tts and returns the binary blob', async () => {
  let captured: Request | null = null;
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]); // ID3 sentinel bytes
  const fetchFn = (async (req: Request) => {
    captured = req;
    return new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch;

  const result = await synthesiseSpeech({
    providerConfig: { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'direct' } },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    upstreamSlug: 'grok-tts',
    teal: 'passthrough',
    transport: 'xai-native',
    text: '[laugh] Hello',
    voiceId: 'eve',
    fetchFn,
  });

  const req = captured as Request | null;
  expect(req?.url).toBe('https://api.x.ai/v1/tts');
  const body = JSON.parse(await (req as Request).text()) as Record<string, unknown>;
  // No model field; TEAL passthrough keeps the tag verbatim.
  expect(body).toEqual({ text: '[laugh] Hello', voice_id: 'eve', language: 'auto' });
  expect(result.mimeType).toBe('audio/mpeg');
  expect(result.blob.size).toBe(mp3.byteLength);
});

test('openai-speech: posts {model, input, voice} to /audio/speech and returns the binary blob', async () => {
  let captured: Request | null = null;
  const fetchFn = (async (req: Request) => {
    captured = req;
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    });
  }) as typeof fetch;

  await synthesiseSpeech({
    providerConfig: { baseUrl: 'https://nano-gpt.com/api/v1', routing: { kind: 'direct' } },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    upstreamSlug: 'xai-tts',
    teal: 'passthrough',
    transport: 'openai-speech',
    text: 'Hello',
    voiceId: 'eve',
    fetchFn,
  });

  const req = captured as Request | null;
  expect(req?.url).toBe('https://nano-gpt.com/api/v1/audio/speech');
  const body = JSON.parse(await (req as Request).text()) as Record<string, unknown>;
  expect(body).toEqual({ model: 'xai-tts', input: 'Hello', voice: 'eve' });
});
```

Also update every existing call in this test file with `transport: 'mistral-speech'` (the new required arg) and keep those tests green.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd packages/llm-unified && bun test src/tts/synthesise-speech.test.ts`
Expected: FAIL — `transport` unknown / wrong body shape.

- [ ] **Step 3: Implement the transport branches**

In `synthesise-speech.ts`: add `transport: TtsTransportKind` to `SynthesiseSpeechArgs` (import the type). Replace the single request build + base64 parse with:

```ts
  const isMistral = args.transport === 'mistral-speech';
  const path = args.transport === 'xai-native' ? '/tts' : '/audio/speech';
  const body =
    args.transport === 'xai-native'
      ? { text: input, voice_id: args.voiceId, language: 'auto' }
      : args.transport === 'openai-speech'
        ? { model: args.upstreamSlug, input, voice: args.voiceId }
        : { model: args.upstreamSlug, input, voice_id: args.voiceId, stream: false };
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path,
    method: 'POST',
    body,
  });
  const response = await fetchFn(request, { signal });
  if (!response.ok) {
    throw new SpeechSynthesisError(`TTS upstream ${response.status}`, response.status);
  }
  if (!isMistral) {
    // xAI (direct and via nano-gpt) returns raw MP3 bytes, not base64 JSON.
    const blob = await response.blob();
    const contentType = response.headers.get('content-type');
    const mimeType = (contentType ? contentType.split(';')[0] : null) ?? 'audio/mpeg';
    return { blob, mimeType };
  }
  const payload = (await response.json()) as { audio_data?: unknown };
  if (typeof payload.audio_data !== 'string') {
    throw new SpeechSynthesisError('TTS response missing audio_data', null);
  }
  return { blob: b64ToBlob(payload.audio_data, 'audio/mpeg'), mimeType: 'audio/mpeg' };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/tts/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Branch synthesiseSpeech by TTS transport kind"
```

---

### Task 3: STT transport branches + Matroska spoof in transcribeAudio

**Files:**
- Modify: `packages/llm-unified/src/stt/transcribe-audio.ts`
- Test: `packages/llm-unified/src/stt/transcribe-audio.test.ts`

- [ ] **Step 1: Write the failing tests**

New cases (existing tests gain `transport: 'openai-transcriptions'`):

```ts
test('xai-native: multipart to /stt without a model field', async () => {
  let captured: Request | null = null;
  const fetchFn = (async (req: Request) => {
    captured = req;
    return new Response(JSON.stringify({ text: ' hi ' }), { status: 200 });
  }) as typeof fetch;

  const result = await transcribeAudio({
    providerConfig: { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'direct' } },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    upstreamSlug: 'grok-stt',
    transport: 'xai-native',
    blob: new Blob([new Uint8Array([1])], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    fetchFn,
  });

  const req = captured as Request | null;
  expect(req?.url).toBe('https://api.x.ai/v1/stt');
  const form = await (req as Request).formData();
  expect(form.get('model')).toBeNull();
  const file = form.get('file') as File;
  expect(file.name).toBe('recording.wav');
  expect(result.text).toBe('hi');
});

test('spoofWebmAsMatroska rewrites webm blobs to audio/x-matroska + .mkv', async () => {
  let captured: Request | null = null;
  const fetchFn = (async (req: Request) => {
    captured = req;
    return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
  }) as typeof fetch;

  await transcribeAudio({
    providerConfig: { baseUrl: 'https://nano-gpt.com/api/v1', routing: { kind: 'direct' } },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    upstreamSlug: 'xai/speech-to-text/v1',
    transport: 'openai-transcriptions',
    spoofWebmAsMatroska: true,
    blob: new Blob([new Uint8Array([1])], { type: 'audio/webm' }),
    mimeType: 'audio/webm;codecs=opus',
    fetchFn,
  });

  const form = await (captured as unknown as Request).formData();
  const file = form.get('file') as File;
  expect(file.name).toBe('recording.mkv');
  expect(file.type).toBe('audio/x-matroska');
  expect(form.get('model')).toBe('xai/speech-to-text/v1');
});

test('spoof flag leaves non-webm blobs untouched', async () => {
  let captured: Request | null = null;
  const fetchFn = (async (req: Request) => {
    captured = req;
    return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
  }) as typeof fetch;

  await transcribeAudio({
    providerConfig: { baseUrl: 'https://nano-gpt.com/api/v1', routing: { kind: 'direct' } },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    upstreamSlug: 'xai/speech-to-text/v1',
    transport: 'openai-transcriptions',
    spoofWebmAsMatroska: true,
    blob: new Blob([new Uint8Array([1])], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    fetchFn,
  });

  const form = await (captured as unknown as Request).formData();
  const file = form.get('file') as File;
  expect(file.name).toBe('recording.wav');
  expect(file.type).toBe('audio/wav');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd packages/llm-unified && bun test src/stt/transcribe-audio.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `TranscribeAudioArgs`: `transport: SttTransportKind;` and `spoofWebmAsMatroska?: boolean;` (import the type). Replace the form/request build:

```ts
  // nano-gpt's whitelist 400s on audio/webm but accepts the identical bytes as
  // Matroska — webm is a restricted MKV profile (chatsune INS-054, re-proven
  // live 2026-06-12). Bytes are untouched; only the declared type and the
  // extension hint change.
  const spoof = args.spoofWebmAsMatroska === true && args.mimeType.startsWith('audio/webm');
  const fileType = spoof ? 'audio/x-matroska' : args.mimeType;
  const filename = spoof ? 'recording.mkv' : filenameForMime(args.mimeType);
  const form = new FormData();
  form.append('file', new File([args.blob], filename, { type: fileType }));
  // xAI's /stt endpoint takes no model field; the slug is internal-only there.
  if (args.transport === 'openai-transcriptions') form.append('model', args.upstreamSlug);
  // `language` deliberately omitted on both transports — auto-detect.
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: args.transport === 'xai-native' ? '/stt' : '/audio/transcriptions',
    method: 'POST',
    body: form,
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/stt/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Branch transcribeAudio by STT transport kind with Matroska spoof"
```

---

### Task 4: Voice-list endpoints in listTtsVoices

**Files:**
- Modify: `packages/llm-unified/src/tts/voices.ts`
- Test: `packages/llm-unified/src/tts/voices.test.ts` (create if absent; check for an existing voices test first and extend it)

- [ ] **Step 1: Write the failing test**

```ts
test('xai-flat: parses {voices:[{voice_id,name}]} from /tts/voices in one shot', async () => {
  let captured: Request | null = null;
  const fetchFn = (async (req: Request) => {
    captured = req;
    return new Response(
      JSON.stringify({
        voices: [
          { voice_id: 'ara', name: 'Ara', language: 'multilingual', gender: 'female' },
          { voice_id: 'eve', name: 'Eve', language: 'multilingual', gender: 'female' },
          { malformed: true },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const voices = await listTtsVoices({
    providerConfig: { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'direct' } },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    endpoint: 'xai-flat',
    fetchFn,
  });

  expect((captured as Request | null)?.url).toBe('https://api.x.ai/v1/tts/voices');
  expect(voices).toEqual([
    { id: 'ara', name: 'Ara' },
    { id: 'eve', name: 'Eve' },
  ]);
});
```

Existing callers/tests gain `endpoint: 'mistral-paginated'`.

- [ ] **Step 2: Run to verify it fails**, `cd packages/llm-unified && bun test src/tts/voices.test.ts`

- [ ] **Step 3: Implement**

`ListTtsVoicesArgs` gains `endpoint: 'mistral-paginated' | 'xai-flat';`. At the top of `listTtsVoices`:

```ts
  if (args.endpoint === 'xai-flat') {
    // xAI returns the whole catalogue in one unpaginated response (probed
    // 2026-06-12) with `voice_id` rather than `id`.
    const request = buildRequest({
      provider: args.providerConfig,
      apiKey: args.apiKey,
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      path: '/tts/voices',
      method: 'GET',
    });
    const response = await fetchFn(request, { signal: args.signal });
    if (!response.ok) {
      throw new SpeechSynthesisError(`voices upstream ${response.status}`, response.status);
    }
    const payload = (await response.json()) as { voices?: unknown };
    if (!Array.isArray(payload.voices)) {
      throw new SpeechSynthesisError('voices response missing voices array', null);
    }
    const voices: TtsVoice[] = [];
    for (const item of payload.voices) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { voice_id?: unknown }).voice_id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string'
      ) {
        voices.push({
          id: (item as { voice_id: string }).voice_id,
          name: (item as { name: string }).name,
        });
      }
    }
    return voices;
  }
```

(the existing paginated loop stays as the `mistral-paginated` path).

- [ ] **Step 4: Run to verify pass**, `cd packages/llm-unified && bun test` — full package green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add the unpaginated xAI voice-list endpoint to listTtsVoices"
```

---

### Task 5: Offering selection helper + Dexie v23

**Files:**
- Create: `apps/user-client/src/lib/voice/select-offering.ts`
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Test: `apps/user-client/tests/lib/voice/select-offering.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/voice/select-offering.test.ts
import { registerBuiltinProviders } from '@chatsundere/llm-unified';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../../src/boot/client-data-db.js';
import {
  offeringRef,
  pickableSttOfferings,
  pickableTtsOfferings,
  selectSttOffering,
  selectTtsOffering,
} from '../../../src/lib/voice/select-offering.js';

function row(templateId: string, enabled = true): ProviderRow {
  return { templateId, enabled } as ProviderRow;
}

describe('select-offering', () => {
  beforeAll(() => registerBuiltinProviders());

  it('TTS auto order prefers xAI direct over nano-gpt; Mistral TTS never resolves', () => {
    expect(offeringRef(selectTtsOffering(null, [row('xai'), row('nano-gpt'), row('mistral')]).offering))
      .toBe('xai:grok-tts');
    expect(offeringRef(selectTtsOffering(null, [row('nano-gpt'), row('mistral')]).offering))
      .toBe('nano-gpt:xai-tts');
    expect(selectTtsOffering(null, [row('mistral')])).toBeNull();
  });

  it('STT auto order prefers Mistral (EU privacy default)', () => {
    expect(offeringRef(selectSttOffering(null, [row('xai'), row('mistral')]).offering))
      .toBe('mistral:voxtral-mini-latest');
    expect(offeringRef(selectSttOffering(null, [row('xai'), row('nano-gpt')]).offering))
      .toBe('xai:grok-stt');
  });

  it('explicit pick wins; a stale pick falls back to the auto order', () => {
    const rows = [row('xai'), row('nano-gpt')];
    const picked = selectTtsOffering('nano-gpt:xai-tts', rows);
    expect(offeringRef(picked.offering)).toBe('nano-gpt:xai-tts');
    expect(picked.auto).toBe(false);
    const stale = selectTtsOffering('nano-gpt:xai-tts', [row('xai'), row('nano-gpt', false)]);
    expect(offeringRef(stale.offering)).toBe('xai:grok-tts');
    expect(stale.auto).toBe(true);
  });

  it('pickable lists: TTS excludes Mistral Voxtral; STT lists all three', () => {
    expect(pickableTtsOfferings().map(offeringRef)).toEqual(['xai:grok-tts', 'nano-gpt:xai-tts']);
    expect(pickableSttOfferings().map(offeringRef).sort()).toEqual([
      'mistral:voxtral-mini-latest',
      'nano-gpt:xai/speech-to-text/v1',
      'xai:grok-stt',
    ]);
  });
});
```

(Note: the non-null test calls intentionally rely on the selections being non-null — use a small local `mustSelect` helper that throws on null instead of `!`, e.g. `function sel(r: SelectedOffering | null): SelectedOffering { if (!r) throw new Error('expected a selection'); return r; }` — Biome bans non-null assertions. Adjust the assertions accordingly.)

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/select-offering.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the selector**

```ts
// apps/user-client/src/lib/voice/select-offering.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { type Offering, listSttOfferings, listTtsOfferings } from '@chatsundere/llm-unified';
import type { ProviderRow } from '../../boot/client-data-db.js';

/** Stable offering reference — the settings persistence format. */
export function offeringRef(o: Offering): string {
  return `${o.providerId}:${o.upstreamSlug}`;
}

/**
 * Curated TTS auto-default order: fewest middlemen first. Mistral Voxtral TTS
 * is deliberately absent — superseded by the board decision 2026-06-12 (its
 * registry entry and transport stay for a possible Mistral comeback).
 */
export const TTS_DEFAULT_ORDER: readonly string[] = ['xai:grok-tts', 'nano-gpt:xai-tts'];

/**
 * Curated STT auto-default order: Mistral first so microphone audio defaults
 * to the EU provider; the xAI paths (US, zdr false) are conscious opt-ins.
 */
export const STT_DEFAULT_ORDER: readonly string[] = [
  'mistral:voxtral-mini-latest',
  'xai:grok-stt',
  'nano-gpt:xai/speech-to-text/v1',
];

export interface SelectedOffering {
  offering: Offering;
  /** True when the slot resolved via the auto-default order (no explicit pick). */
  auto: boolean;
}

function isConfigured(o: Offering, rows: readonly ProviderRow[]): boolean {
  return rows.some((r) => r.templateId === o.providerId && r.enabled);
}

function select(
  all: Offering[],
  order: readonly string[],
  pickedRef: string | null,
  rows: readonly ProviderRow[],
): SelectedOffering | null {
  if (pickedRef) {
    const picked = all.find((o) => offeringRef(o) === pickedRef);
    if (picked && isConfigured(picked, rows)) return { offering: picked, auto: false };
    // Stale pick (provider removed or disabled) — fall through to auto.
  }
  for (const ref of order) {
    const candidate = all.find((o) => offeringRef(o) === ref);
    if (candidate && isConfigured(candidate, rows)) return { offering: candidate, auto: true };
  }
  return null;
}

/** Resolve the active TTS offering from the persisted ref + provider rows. */
export function selectTtsOffering(
  pickedRef: string | null,
  rows: readonly ProviderRow[],
): SelectedOffering | null {
  return select(listTtsOfferings(), TTS_DEFAULT_ORDER, pickedRef, rows);
}

/** Resolve the active STT offering from the persisted ref + provider rows. */
export function selectSttOffering(
  pickedRef: string | null,
  rows: readonly ProviderRow[],
): SelectedOffering | null {
  return select(listSttOfferings(), STT_DEFAULT_ORDER, pickedRef, rows);
}

/** The offerings the Read-aloud-voice slot picker lists, in auto-order. */
export function pickableTtsOfferings(): Offering[] {
  const all = listTtsOfferings();
  return TTS_DEFAULT_ORDER.flatMap((ref) => all.filter((o) => offeringRef(o) === ref));
}

/** The offerings the Speech-to-text slot picker lists, in auto-order. */
export function pickableSttOfferings(): Offering[] {
  const all = listSttOfferings();
  return STT_DEFAULT_ORDER.flatMap((ref) => all.filter((o) => offeringRef(o) === ref));
}
```

(If `registerBuiltinProviders` is not exported from the package root, check `packages/llm-unified/src/index.ts` and use whatever the existing user-client tests import to get the registry populated — `resolve-tts.test.ts` shows the established pattern. Follow it.)

- [ ] **Step 4: Dexie v23**

In `boot/client-data-db.ts`: add to `SettingsRow` after `dictationAutoSend`:

```ts
  /** Read-aloud TTS offering ref "providerId:upstreamSlug"; null = curated auto-default. */
  ttsOffering: string | null;
  /** Dictation STT offering ref "providerId:upstreamSlug"; null = curated auto-default. */
  sttOffering: string | null;
```

After the `version(22)` block:

```ts
    // Version 23 — xAI voice onboarding. Settings gain the two voice slot
    // refs; null means the curated auto-default order resolves at runtime.
    this.version(23).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (s.ttsOffering === undefined) s.ttsOffering = null;
          if (s.sttOffering === undefined) s.sttOffering = null;
        });
    });
```

Also add `ttsOffering: null, sttOffering: null` to the settings seed object in `seedBuiltinsIfNeeded` (search for where `voiceMode` is seeded; mirror it).

**Dexie ownership check (parallel-version rule):** before writing, confirm v22 is still the head version in the file and no other in-flight branch claims v23. If the head moved, renumber.

- [ ] **Step 5: Run to verify pass**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/select-offering.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add voice offering selector and Dexie v23 slot settings"
```

---

### Task 6: Rewire resolveTts / resolveStt

**Files:**
- Modify: `apps/user-client/src/lib/voice/resolve-tts.ts`
- Modify: `apps/user-client/src/lib/voice/dictation/resolve-stt.ts`
- Test: `apps/user-client/tests/lib/voice/resolve-tts.test.ts`, `apps/user-client/tests/lib/voice/dictation/resolve-stt.test.ts`

- [ ] **Step 1: Write/adjust the failing tests**

Read both existing test files first and keep their harness (they stub the registry/db/session). Add cases:

1. **Selection respected:** with settings `ttsOffering: 'nano-gpt:xai-tts'` and both providers enabled, `resolveTtsTransport()` returns the nano-gpt offering (assert `offering.upstreamSlug === 'xai-tts'`).
2. **Auto default:** with `ttsOffering: null` and xAI + nano-gpt enabled, the xAI offering wins.
3. **corsOverride routing:** with the xAI offering selected (provider `corsHint: 'requires-proxy'` but offering `corsOverride: 'direct'`), the returned `providerConfig.routing` is `{ kind: 'direct' }` and no CORS-proxy key is required.
4. **STT mirror:** `sttOffering: null` + Mistral & xAI enabled → Mistral; explicit `'xai:grok-stt'` → xAI with direct routing.
5. **Transport args forwarded:** the `synthesiseSpeech`/`transcribeAudio` calls receive `transport`/`spoofWebmAsMatroska` from the offering meta (spy on the module like the existing tests do).

- [ ] **Step 2: Run to verify the new cases fail**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/resolve-tts.test.ts tests/lib/voice/dictation/resolve-stt.test.ts`

- [ ] **Step 3: Implement**

`resolve-tts.ts` — `resolveTtsTransport()` reshape (the function body order changes: DB reads first, then selection):

```ts
  const db = getClientDataDb();
  const providerRows = await db.providers.toArray();
  const settings = await db.settings.get(1);

  const selected = selectTtsOffering(settings?.ttsOffering ?? null, providerRows);
  if (!selected) return null;
  const { offering } = selected;
  const ttsMeta = offering.tts;
  if (!ttsMeta) return null;

  const providerDef = getProvider(offering.providerId);
  if (!providerDef) return null;
  const providerRow = providerRows.find((p) => p.templateId === offering.providerId && p.enabled);
  if (!providerRow) return null;
```

Routing honours the override:

```ts
  // Per-offering override first: xAI's voice endpoints are CORS-open even
  // though the provider-level hint says requires-proxy (probed 2026-06-12).
  const direct = offering.corsOverride === 'direct' || providerDef.corsHint !== 'requires-proxy';
  const providerConfig = {
    baseUrl: providerDef.baseUrl,
    routing: direct ? ({ kind: 'direct' } as const) : ({ kind: 'cors-proxy' } as const),
  };
```

Replace the local `TtsMeta` interface with the package type: `ttsMeta: TtsOfferingMeta` (import type from `@chatsundere/llm-unified`; it must be exported there — add the export to the package index if missing). The `synthesiseSpeech` call gains `transport: ttsMeta.transport`. Everything else (mk/openSecret/proxy/cache/closures) stays as-is.

`resolve-stt.ts` mirrors it: provider rows + settings first, `selectSttOffering(settings?.sttOffering ?? null, providerRows)`, the same `direct` derivation, and the `transcribeAudio` call gains `transport: sttMeta.transport, spoofWebmAsMatroska: sttMeta.spoofWebmAsMatroska`.

- [ ] **Step 4: Run the two suites + typecheck**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/` then `pnpm typecheck --force` from the repo root.
Expected: voice suites green; typecheck 14/14.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Resolve TTS/STT through the slot selector with per-offering CORS override"
```

---

### Task 7: VoicePicker — per-offering memo, static lists, neutral copy

**Files:**
- Modify: `apps/user-client/src/components/voice/VoicePicker.tsx`
- Test: `apps/user-client/tests/components/voice/VoicePicker.test.tsx`

- [ ] **Step 1: Write/adjust the failing tests**

Keep the existing harness (it stubs `resolveTtsTransport` and `listTtsVoices`). Add:

1. **Static list short-circuit:** when the resolved transport's offering meta has `voices: { kind: 'static', list: [{ id: 'eve', name: 'Eve' }, ...] }`, the picker shows those voices without calling `listTtsVoices` (assert the stub was not called).
2. **Per-offering memo:** after voices loaded for offering A, a re-render with the resolved transport now pointing at offering B triggers a fresh load (the module memo must not serve A's list for B). Use `_resetVoicePickerCacheForTests` between unrelated tests as today.
3. **Neutral error copy:** the load-failure message no longer names Mistral — assert on the new copy: `Couldn't load the voice list — check your connection and your voice provider's account.`

- [ ] **Step 2: Run to verify fail**, `pnpm vitest run tests/components/voice/VoicePicker.test.tsx`

- [ ] **Step 3: Implement**

Replace the single module promise with a ref-keyed map:

```ts
// Module-level memo keyed by offering ref: one fetch per offering per session,
// shared across all picker instances. Switching the TTS slot re-resolves.
const voicesPromises = new Map<string, Promise<TtsVoice[]>>();

/** Reset the cached voices promises. Exposed for tests only. */
export function _resetVoicePickerCacheForTests(): void {
  voicesPromises.clear();
}

async function fetchVoices(retry = false): Promise<TtsVoice[]> {
  const transport = await resolveTtsTransport();
  if (!transport) return [];
  const meta = transport.ttsMeta;
  // nano-gpt exposes no voice-list endpoint; its offering carries the list.
  if (meta.voices.kind === 'static') return [...meta.voices.list];
  const ref = `${transport.offering.providerId}:${transport.offering.upstreamSlug}`;
  if (retry) voicesPromises.delete(ref);
  let promise = voicesPromises.get(ref);
  if (!promise) {
    promise = listTtsVoices({
      providerConfig: transport.providerConfig,
      apiKey: transport.apiKey,
      corsProxyUrl: transport.corsProxyUrl,
      corsProxyKey: transport.corsProxyKey,
      endpoint: meta.voices.endpoint,
      signal: AbortSignal.timeout(15_000),
    });
    voicesPromises.set(ref, promise);
    promise.catch(() => {
      voicesPromises.delete(ref);
    });
  }
  return promise;
}
```

Update the error copy string in the JSX accordingly. The static-list branch returns `{ id: string; name: string }` entries — structurally identical to `TtsVoice`.

- [ ] **Step 4: Run to verify pass**, `pnpm vitest run tests/components/voice/VoicePicker.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Key the voice-list memo by offering and honour static voice lists"
```

---

### Task 8: Slot pickers in VoiceSection + selected-offering moderation notice + persona-editor copy

**Files:**
- Create: `apps/user-client/src/components/voice/OfferingSlotPicker.tsx`
- Modify: `apps/user-client/src/components/voice/VoiceSection.tsx`
- Modify: `apps/user-client/src/components/voice/TtsModerationNotice.tsx`
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (two `disabledHint` strings)
- Test: `apps/user-client/tests/components/voice/VoiceSection.test.tsx`, `apps/user-client/tests/components/voice/OfferingSlotPicker.test.tsx` (new)

- [ ] **Step 1: Write the failing OfferingSlotPicker tests**

```tsx
// Behavioural surface to pin (render with @testing-library/react like VoiceSection.test.tsx):
// 1. Collapsed trigger shows the explicit selection's label when value is set.
// 2. Collapsed trigger shows `${autoLabel} (auto)` when value is null and autoLabel resolves.
// 3. Collapsed trigger shows the unconfigured fallback copy when value is null and autoLabel is null.
// 4. Open list renders an "Automatic" row first, then one row per entry with label + egress note.
// 5. An unconfigured entry renders disabled (aria-disabled, click is a no-op) and shows its disabledHint.
// 6. Clicking a configured entry calls onSelect(ref) and collapses; clicking "Automatic" calls onSelect(null).
```

Write these as six concrete `it(...)` cases against the props interface below.

- [ ] **Step 2: Implement OfferingSlotPicker**

```tsx
// apps/user-client/src/components/voice/OfferingSlotPicker.tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';

export interface SlotEntry {
  /** Offering ref "providerId:upstreamSlug" — the persisted value. */
  refId: string;
  /** e.g. "Grok TTS via xAI". */
  label: string;
  /** Where the data goes — the conscious-opt-in line (spec §5). */
  egressNote: string;
  configured: boolean;
  /** Shown on the row when not configured, e.g. "Add the xAI provider…". */
  disabledHint: string;
}

interface Props {
  label: string;
  subtitle: string;
  entries: SlotEntry[];
  /** Persisted ref or null for the curated auto-default. */
  value: string | null;
  /** Resolved auto-default label, or null when nothing resolves. */
  autoLabel: string | null;
  /** Copy for the collapsed trigger when nothing is configured at all. */
  unconfiguredCopy: string;
  onSelect: (refId: string | null) => void;
}

/**
 * A voice slot picker (Read-aloud voice / Speech-to-text) following the
 * image-generation slot pattern: explicit pick or visible auto-default,
 * disabled-over-hidden entries with actionable hints, and an egress note per
 * entry so the privacy choice is conscious in the UI, not only in the spec.
 */
export function OfferingSlotPicker({
  label,
  subtitle,
  entries,
  value,
  autoLabel,
  unconfiguredCopy,
  onSelect,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);

  const selectedEntry = value === null ? null : (entries.find((e) => e.refId === value) ?? null);
  const triggerText =
    selectedEntry?.label ?? (autoLabel !== null ? `${autoLabel} (auto)` : unconfiguredCopy);

  function pick(refId: string | null): void {
    onSelect(refId);
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-widest text-paper-soft">{label}</div>
      <p className="text-[11px] text-paper-soft">{subtitle}</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Pick ${label}`}
        className="flex items-center justify-between rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-paper hover:border-paper-soft"
      >
        <span className={autoLabel !== null || selectedEntry ? 'text-paper' : 'text-paper-soft'}>
          {triggerText}
        </span>
        <span className="text-paper-soft">▾</span>
      </button>

      {open ? (
        <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-white/10 bg-surface-raised">
          <button
            type="button"
            aria-pressed={value === null}
            onClick={() => pick(null)}
            className={`w-full px-3 py-2 text-left text-sm ${
              value === null
                ? 'bg-white/5 text-paper'
                : 'text-paper-soft hover:bg-white/[0.03] hover:text-paper'
            }`}
          >
            Automatic
            <span className="mt-0.5 block text-[11px] text-paper-soft">
              Picks the best configured option for you.
            </span>
          </button>

          {entries.map((entry) =>
            entry.configured ? (
              <button
                key={entry.refId}
                type="button"
                aria-pressed={entry.refId === value}
                onClick={() => pick(entry.refId)}
                className={`w-full px-3 py-2 text-left text-sm ${
                  entry.refId === value
                    ? 'bg-white/5 text-paper'
                    : 'text-paper-soft hover:bg-white/[0.03] hover:text-paper'
                }`}
              >
                {entry.label}
                <span className="mt-0.5 block text-[11px] text-paper-soft">{entry.egressNote}</span>
              </button>
            ) : (
              <div
                key={entry.refId}
                aria-disabled="true"
                className="w-full px-3 py-2 text-left text-sm text-paper-soft/50"
              >
                {entry.label}
                <span className="mt-0.5 block text-[11px]">{entry.disabledHint}</span>
              </div>
            ),
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="border-t border-white/5 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Run the new picker tests**, expect PASS; then write the failing VoiceSection tests

Extend `VoiceSection.test.tsx`:

1. The "Read-aloud voice" picker lists exactly the two Grok entries (no Mistral TTS).
2. The "Speech-to-text" picker lists all three STT entries; Mistral's egress note reads "Sends microphone audio to Mistral AI (EU)".
3. With only Mistral enabled, the TTS trigger shows the unconfigured copy and both Grok rows are disabled with provider-named hints.
4. With xAI enabled and `ttsOffering: null`, the trigger shows "Grok TTS via xAI (auto)".
5. Picking the other TTS entry persists `ttsOffering` (assert the `useUpdateSettings` mutation arg) and shows the slot-switch notice ("Personas keep their voice picks — if a voice came from the previous provider, re-pick it in the persona editor.").
6. The moderation notice is absent when an xAI path is selected, present when a `contentModerated: true` offering is (cover via `TtsModerationNotice` props/mocks).

- [ ] **Step 4: Implement VoiceSection wiring**

In `VoiceSection.tsx`, replace the two status blocks ("Provider" and "STT Provider") with `OfferingSlotPicker` instances. Selection inputs come from `useSettings()` + `useProviders()` + the Task-5 helpers:

```tsx
const EGRESS_NOTES: Record<string, string> = {
  'xai:grok-tts': 'Sends message text to xAI (US)',
  'nano-gpt:xai-tts': 'Sends message text via nano-gpt to xAI (US)',
  'xai:grok-stt': 'Sends microphone audio to xAI (US)',
  'nano-gpt:xai/speech-to-text/v1': 'Sends microphone audio via nano-gpt to xAI (US)',
  'mistral:voxtral-mini-latest': 'Sends microphone audio to Mistral AI (EU)',
};

function slotEntries(offerings: Offering[], rows: ProviderRow[]): SlotEntry[] {
  return offerings.map((o) => {
    const providerName = getProvider(o.providerId)?.displayName ?? o.providerId;
    const meta = o.serviceKind === 'tts' ? o.tts : o.stt;
    return {
      refId: offeringRef(o),
      label: `${meta?.displayName ?? o.upstreamSlug} via ${providerName}`,
      egressNote: EGRESS_NOTES[offeringRef(o)] ?? '',
      configured: rows.some((r) => r.templateId === o.providerId && r.enabled),
      disabledHint: `Add the ${providerName} provider in My Settings to enable this.`,
    };
  });
}
```

The TTS slot block (replacing the old "Provider" block; `TtsModerationNotice` stays beneath it):

```tsx
const ttsSelected = selectTtsOffering(settings?.ttsOffering ?? null, rows);
const ttsAutoLabel =
  ttsSelected?.auto === true
    ? `${ttsSelected.offering.tts?.displayName ?? ''} via ${getProvider(ttsSelected.offering.providerId)?.displayName ?? ''}`
    : null;
```

```tsx
<OfferingSlotPicker
  label="Read-aloud voice"
  subtitle="The voice that reads messages aloud."
  entries={slotEntries(pickableTtsOfferings(), rows)}
  value={settings?.ttsOffering ?? null}
  autoLabel={ttsAutoLabel}
  unconfiguredCopy="Add the xAI or nano-gpt provider to enable read-aloud."
  onSelect={(refId) => {
    update.mutate({ ttsOffering: refId });
    setShowTtsSwitchNote(true);
  }}
/>
{showTtsSwitchNote ? (
  <p className="mt-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-paper-soft">
    Personas keep their voice picks — if a voice came from the previous provider, re-pick it in
    the persona editor.
  </p>
) : null}
```

The STT slot mirrors it inside the Dictation group (label "Speech-to-text", subtitle "What turns your speech into text.", unconfigured copy "Add the Mistral AI, xAI or nano-gpt provider to dictate.", no switch note). `showTtsSwitchNote` is a plain `useState(false)` — unmount (leaving the room) clears it, per spec.

- [ ] **Step 5: TtsModerationNotice reads the selected offering**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { selectTtsOffering } from '../../lib/voice/select-offering.js';

/**
 * A standing notice that the SELECTED TTS offering is content-moderated and may
 * decline benign passages. Renders null when the active offering synthesises
 * whatever it is given (both Grok paths — probed 2026-06-12) or when nothing
 * resolves. The mechanism outlives the Mistral-TTS GUI removal on purpose: any
 * future moderated offering lights it up again.
 */
export function TtsModerationNotice(): JSX.Element | null {
  const { data: settings } = useSettings();
  const { data: providerRows } = useProviders();
  const selected = selectTtsOffering(settings?.ttsOffering ?? null, providerRows ?? []);
  if (!selected?.offering.tts?.contentModerated) return null;

  return (
    <p className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[11px] leading-relaxed text-paper-soft">
      Heads up — the voice provider applies content moderation and may decline some passages, even
      harmless ones. Read-aloud skips a declined passage and carries on.
    </p>
  );
}
```

- [ ] **Step 6: Persona-editor hint copy**

Both `disabledHint` strings (`persona-editor.tsx`, the two `VoicePicker`s) become:
`"Add a voice provider (xAI or nano-gpt) in My Settings to enable voice."`
Update `tests/routes/persona-editor.voice-pickers.test.tsx` if it asserts the old copy.

- [ ] **Step 7: Run the component suites**

Run: `cd apps/user-client && pnpm vitest run tests/components/voice/ tests/routes/persona-editor.voice-pickers.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Add voice slot pickers with egress notes and selected-offering moderation notice"
```

---

### Task 9: Documentation — curation record, egress log, STATUS

**Files:**
- Create: `obsidian/models/grok-voice.md`
- Modify: `obsidian/insights/security-deferrals.md`

- [ ] **Step 1: Curation record**

`obsidian/models/grok-voice.md`: a Model Curation Record (mirror the structure of an existing record in `obsidian/models/`, e.g. `gpt-image-2.md`) covering both Grok voice offerings on both paths. Must contain: the probe log from this plan's header (CORS, endpoints, body shapes, binary responses, voice list + lowercase-ID finding, Bearer-on-nano finding, webm/Matroska finding, moderation canary, TEAL smoke), the four offering refs, and a Manual verification section pointing at spec §11.

- [ ] **Step 2: Security-deferrals egress entries**

Append two entries to `obsidian/insights/security-deferrals.md` (mirror the existing dictation-egress entry's format): spoken message text to xAI / via nano-gpt (user-initiated read-aloud, opt-in via slot, no persistence beyond the local voiceAudio cache), and recorded microphone audio to xAI / via nano-gpt (conscious opt-in pick, egress note shown at the picker, no persistence).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "Record Grok voice curation probes and the new egress classes [skip ci]"
```

---

## Final gates (orchestrator, on the worktree branch before squash)

1. `pnpm typecheck --force` → 14/14.
2. `pnpm run build --force` → 9/9.
3. `cd packages/llm-unified && bun test` → 0 fail.
4. `cd apps/user-client && pnpm vitest run` → exactly the 8-failure Node-26-localStorage baseline, nothing new.
5. Biome clean on changed files (pre-commit hook enforces).
6. **Laura pre-squash pass** (flow change: slot pickers + Mistral TTS removal).
7. Squash onto master (one commit, free-form imperative subject, Liz co-author tag), verify full-tree capture (`git diff master..branch` empty), typecheck on master, worktree cleanup.
8. Update `obsidian/STATUS-CLIENT-ONLY.md` (this unit done; Spec 3 next), commit `[skip ci]`. Chris pushes.

## Manual verification

Spec §11 — eleven device steps (Chris). Restart `pnpm dev` first; `packages/llm-unified` changed.
