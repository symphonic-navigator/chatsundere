# Dictation / STT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Speech as a prompt source — push-to-talk and VAD-driven dictation into the cockpit draft, transcribed by Mistral Voxtral STT direct from the client.

**Architecture:** A `serviceKind: 'stt'` offering in llm-unified (mirror of the TTS precedent) called via a new multipart-capable transport path; chatsune's field-tested capture stack (Silero VAD via `@ricky0123/vad-web`, three-level sensitivity presets, redemption window, Opus/AAC→WAV recording tiers) ported into `lib/voice/dictation/`; a small chat-scoped XState v5 dictation machine (ADR 0034) driving a three-fold `DualActionBtn` morph (Stop > Capture > Send > Mic).

**Tech Stack:** TypeScript strict, XState v5 (already a dependency), `@ricky0123/vad-web` (new dependency), Vitest (user-client), bun test (llm-unified), Dexie v22.

**Spec:** `superpowers/specs/2026-06-12-dictation-stt-design.md` (approved 2026-06-12; CORS probe passed — Mistral STT direct confirmed).

**Reference implementation (read-only source for ports):**
`/home/chris/workspace/chatsune/frontend/src/features/voice/infrastructure/`
(`vadPresets.ts`, `audioCapture.ts`, `audioRecording.ts`, `wavEncoder.ts`).
Subagents: never merge, push, or switch branches.

**House rules that bind every task:**
- British English everywhere; SPDX headers (`LGPL-3.0-only` in packages/llm-unified, `AGPL-3.0-only` in apps/user-client).
- Biome is the pre-commit gate and bans `!` non-null assertions. Tests live under `tests/**` in user-client, co-located `*.test.ts` in llm-unified.
- Run `pnpm typecheck --force` at the gate (Turbo caches lie on test-only changes).
- The user-client vitest baseline has 8 pre-existing failures (cockpit-draft/chat-page/chat-route) — those are NOT yours; zero NEW failures allowed.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/llm-unified/src/transport.ts` | Modify | Accept `FormData` bodies (multipart) |
| `packages/llm-unified/src/transport.test.ts` | Create | Pin FormData/JSON behaviour |
| `packages/llm-unified/src/stt/transcribe-audio.ts` | Create | One STT call: blob in, text out |
| `packages/llm-unified/src/stt/transcribe-audio.test.ts` | Create | Mocked-fetch tests |
| `packages/llm-unified/src/stt/offerings.test.ts` | Create | Registry shape test |
| `packages/llm-unified/src/catalogue/types.ts` | Modify | `SttOfferingMeta`, `Offering.stt` |
| `packages/llm-unified/src/registry.ts` | Modify | `listSttOfferings()` |
| `packages/llm-unified/src/providers/mistral.ts` | Modify | Voxtral STT offering |
| `packages/llm-unified/src/index.ts` | Modify | Export new API |
| `apps/user-client/src/boot/client-data-db.ts` | Modify | Dexie v22: three dictation settings |
| `apps/user-client/src/lib/voice/dictation/vad-presets.ts` | Create | Sensitivity preset table (port 1:1) |
| `apps/user-client/src/lib/voice/dictation/wav-encoder.ts` | Create | Tier-3 WAV fallback (port 1:1) |
| `apps/user-client/src/lib/voice/dictation/audio-recording.ts` | Create | MIME tiers + recorder factory (port 1:1) |
| `apps/user-client/src/lib/voice/dictation/capture.ts` | Create | PTT + VAD capture (port, trimmed) |
| `apps/user-client/src/lib/voice/dictation/resolve-stt.ts` | Create | Provider/auth resolution (resolve-tts mirror) |
| `apps/user-client/src/lib/voice/dictation/dictation-machine.ts` | Create | XState v5 statechart |
| `apps/user-client/src/lib/voice/dictation/use-dictation.ts` | Create | Hook binding machine ↔ UI |
| `apps/user-client/src/components/chat/DualActionBtn.tsx` | Modify | Three-fold morph + gestures + glow |
| `apps/user-client/src/components/chat/Cockpit.tsx` | Modify | Placeholder states, error note, prop threading |
| `apps/user-client/src/routes/app/chat/chat-page.tsx` | Modify | `useDictation` wiring (draft append, auto-send, stop read-aloud) |
| `apps/user-client/src/components/voice/VoiceSection.tsx` | Modify | Dictation settings group |
| `apps/user-client/src/index.css` | Modify | Capture pulse + level glow styles |
| `apps/user-client/tests/lib/voice/dictation/*.test.ts(x)` | Create | Machine, resolve-stt, wav-encoder, recording tests |
| `apps/user-client/tests/components/chat/DualActionBtn.test.tsx` | Create | Morph + gesture tests |
| `apps/user-client/tests/components/voice/VoiceSection.test.tsx` | Modify | Dictation group tests |
| `obsidian/insights/security-deferrals.md` | Modify | Two new egress notes |
| `obsidian/STATUS-CLIENT-ONLY.md` | Modify | Session record (final task) |

---

### Task 1: Multipart transport in llm-unified

STT uploads audio as `multipart/form-data`; `buildRequest` currently JSON-stringifies every body and pins `Content-Type: application/json`. A `FormData` body must pass through untouched (the browser/Bun sets the boundary header itself).

**Files:**
- Modify: `packages/llm-unified/src/transport.ts`
- Create: `packages/llm-unified/src/transport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { buildRequest } from './transport.js';
import type { ProviderConfig } from './types.js';

const provider: ProviderConfig = {
  baseUrl: 'https://api.example.test/v1',
  routing: { kind: 'direct' },
};

describe('buildRequest bodies', () => {
  test('JSON body is stringified with the json content-type', async () => {
    const req = buildRequest({
      provider,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/chat/completions',
      method: 'POST',
      body: { a: 1 },
    });
    expect(req.headers.get('content-type')).toBe('application/json');
    expect(await req.text()).toBe('{"a":1}');
  });

  test('FormData body passes through with a multipart boundary', async () => {
    const form = new FormData();
    form.append('model', 'voxtral-mini-latest');
    const req = buildRequest({
      provider,
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/audio/transcriptions',
      method: 'POST',
      body: form,
    });
    expect(req.headers.get('content-type')).toStartWith('multipart/form-data');
    expect(req.headers.get('authorization')).toBe('Bearer k');
    const echoed = await req.formData();
    expect(echoed.get('model')).toBe('voxtral-mini-latest');
  });
});
```

- [ ] **Step 2: Run it — expect the FormData test to fail**

Run: `cd packages/llm-unified && bun test src/transport.test.ts`
Expected: FAIL — content-type is `application/json`, body is `"{}"`.

- [ ] **Step 3: Implement**

In `transport.ts`, change the two body-touching lines:

```ts
export function buildRequest(args: BuildRequestArgs): Request {
  const { provider, apiKey, corsProxyUrl, corsProxyKey, path, method, body, extraHeaders } = args;
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` });
  // FormData carries its own multipart boundary — setting Content-Type here
  // would destroy it. Only JSON bodies get the explicit header.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (method === 'POST' && !isForm) headers.set('Content-Type', 'application/json');
  // … routing block unchanged …
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
}
```

- [ ] **Step 4: Run the full llm-unified suite**

Run: `cd packages/llm-unified && bun test`
Expected: all green (354 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/transport.ts packages/llm-unified/src/transport.test.ts
git commit -m "Support FormData bodies in the llm-unified transport"
```

---

### Task 2: `transcribeAudio` — the STT call

Mirror of `tts/synthesise-speech.ts`. One audio blob in, transcript text out.

**Files:**
- Create: `packages/llm-unified/src/stt/transcribe-audio.ts`
- Create: `packages/llm-unified/src/stt/transcribe-audio.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { ProviderConfig } from '../types.js';
import { TranscriptionError, transcribeAudio } from './transcribe-audio.js';

const provider: ProviderConfig = {
  baseUrl: 'https://api.mistral.test/v1',
  routing: { kind: 'direct' },
};

function args(fetchFn: typeof fetch, mimeType = 'audio/webm;codecs=opus') {
  return {
    providerConfig: provider,
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    upstreamSlug: 'voxtral-mini-latest',
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: mimeType }),
    mimeType,
    fetchFn,
  };
}

describe('transcribeAudio', () => {
  test('posts multipart with model + file and returns the text', async () => {
    let captured: Request | null = null;
    const fetchFn = (async (req: Request) => {
      captured = req;
      return new Response(JSON.stringify({ text: ' hello there ' }), { status: 200 });
    }) as typeof fetch;
    const result = await transcribeAudio(args(fetchFn));
    expect(result.text).toBe('hello there');
    const sentReq = captured as Request | null;
    expect(sentReq?.url).toBe('https://api.mistral.test/v1/audio/transcriptions');
    const form = await sentReq?.formData();
    expect(form?.get('model')).toBe('voxtral-mini-latest');
    const file = form?.get('file') as File;
    expect(file.name).toBe('recording.webm');
  });

  test('wav mime maps to recording.wav', async () => {
    let name = '';
    const fetchFn = (async (req: Request) => {
      const form = await req.formData();
      name = (form.get('file') as File).name;
      return new Response(JSON.stringify({ text: 'x' }), { status: 200 });
    }) as typeof fetch;
    await transcribeAudio(args(fetchFn, 'audio/wav'));
    expect(name).toBe('recording.wav');
  });

  test('HTTP error throws TranscriptionError with status', async () => {
    const fetchFn = (async () => new Response('nope', { status: 429 })) as typeof fetch;
    await expect(transcribeAudio(args(fetchFn))).rejects.toThrow(TranscriptionError);
    await transcribeAudio(args(fetchFn)).catch((e: TranscriptionError) => {
      expect(e.status).toBe(429);
    });
  });

  test('missing text field throws TranscriptionError(null)', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 })) as typeof fetch;
    await transcribeAudio(args(fetchFn)).catch((e: TranscriptionError) => {
      expect(e.status).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run — expect module-not-found failure**

Run: `cd packages/llm-unified && bun test src/stt/transcribe-audio.test.ts`

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';

const POST_TIMEOUT_MS = 30_000;

/** Typed failure for STT calls (HTTP error, malformed body). */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/** All inputs needed to transcribe one captured utterance. */
export interface TranscribeAudioArgs {
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  upstreamSlug: string;
  blob: Blob;
  mimeType: string;
  signal?: AbortSignal;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface TranscribeAudioResult {
  text: string;
}

/**
 * Keep aligned with the recording tiers in the user-client: the upstream uses
 * the filename extension as a format hint when Content-Type is generic.
 */
function filenameForMime(mimeType: string): string {
  if (mimeType.startsWith('audio/webm')) return 'recording.webm';
  if (mimeType.startsWith('audio/mp4')) return 'recording.m4a';
  return 'recording.wav';
}

/** Transcribe one captured utterance; returns the trimmed transcript text. */
export async function transcribeAudio(args: TranscribeAudioArgs): Promise<TranscribeAudioResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const timeoutSignal = AbortSignal.timeout(POST_TIMEOUT_MS);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;
  const form = new FormData();
  form.append(
    'file',
    new File([args.blob], filenameForMime(args.mimeType), { type: args.mimeType }),
  );
  form.append('model', args.upstreamSlug);
  // `language` deliberately omitted — Voxtral auto-detects (spec D8).
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/audio/transcriptions',
    method: 'POST',
    body: form,
  });
  const response = await fetchFn(request, { signal });
  if (!response.ok) {
    throw new TranscriptionError(`STT upstream ${response.status}`, response.status);
  }
  const payload = (await response.json()) as { text?: unknown };
  if (typeof payload.text !== 'string') {
    throw new TranscriptionError('STT response missing text', null);
  }
  return { text: payload.text.trim() };
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `cd packages/llm-unified && bun test src/stt/`

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/stt/
git commit -m "Add transcribeAudio STT call to llm-unified"
```

---

### Task 3: Catalogue — `SttOfferingMeta`, registry, Voxtral STT offering, exports

**Files:**
- Modify: `packages/llm-unified/src/catalogue/types.ts` (after `TtsOfferingMeta`)
- Modify: `packages/llm-unified/src/registry.ts` (after `listTtsOfferings`)
- Modify: `packages/llm-unified/src/providers/mistral.ts`
- Modify: `packages/llm-unified/src/index.ts`
- Create: `packages/llm-unified/src/stt/offerings.test.ts`

- [ ] **Step 1: Write the failing registry test** (mirror of `tts/offerings.test.ts`)

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests, listSttOfferings } from '../registry.js';

describe('STT offerings', () => {
  beforeAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
    registerBuiltinProviders();
  });
  afterAll(() => {
    _resetRegistryForTests();
    _resetAdapterRegistryForTests();
  });

  test('mistral voxtral STT offering is present', () => {
    const stt = listSttOfferings();
    expect(stt.map((o) => `${o.providerId}:${o.upstreamSlug}`)).toEqual([
      'mistral:voxtral-mini-latest',
    ]);
    const offering = stt[0];
    expect(offering?.serviceKind).toBe('stt');
    expect(offering?.stt?.displayName).toBe('Voxtral Mini STT');
    expect(offering?.stt?.contentModerated).toBe(false);
    expect(offering?.adapter.kind).toBe('generic');
  });
});
```

Run: `cd packages/llm-unified && bun test src/stt/offerings.test.ts` — expect FAIL (`listSttOfferings` does not exist).

- [ ] **Step 2: Add the type** (`catalogue/types.ts`, directly after `TtsOfferingMeta`; also add `stt?: SttOfferingMeta;` to `Offering` after the `tts?:` line)

```ts
/** Metadata carried by a `serviceKind: 'stt'` offering. */
export interface SttOfferingMeta {
  displayName: string;
  /**
   * Whether this provider applies content moderation to transcription input.
   * Unlike Voxtral TTS (which 403s on benign text), the STT endpoint shows no
   * moderation behaviour — kept for symmetry and honesty should that change.
   */
  contentModerated: boolean;
}
```

- [ ] **Step 3: Add the registry lookup** (`registry.ts`, directly after `listTtsOfferings`, same shape — copy the body of `listTtsOfferings` and filter on `'stt'`)

```ts
/** All curated STT offerings across registered providers. */
export function listSttOfferings(): Offering[] {
  // Same iteration as listTtsOfferings — read that function and mirror it
  // exactly, with the serviceKind filter set to 'stt'.
}
```

(Read `registry.ts:77` first; the existing function is the template. Do not invent a new iteration pattern.)

- [ ] **Step 4: Add the offering** (`providers/mistral.ts` — `SttOfferingMeta` import; meta + offering after the TTS entry)

```ts
const STT_META: SttOfferingMeta = {
  displayName: 'Voxtral Mini STT',
  // CORS-probed direct 2026-06-12 (HTTP 200 from the app origin); no
  // moderation behaviour observed on transcription — unlike the TTS endpoint.
  contentModerated: false,
};
```

```ts
  // Voxtral Mini STT — speech-to-text; bypasses the chat adapter entirely.
  {
    canonicalRef: null,
    providerId: 'mistral',
    upstreamSlug: 'voxtral-mini-latest',
    adapter: { kind: 'generic' },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false, jurisdiction: 'EU' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'stt',
    stt: STT_META,
  },
```

- [ ] **Step 5: Export from `index.ts`** — alongside the TTS exports: `listSttOfferings` (next to `listTtsOfferings`), `transcribeAudio`, `TranscriptionError`, and the types `SttOfferingMeta`, `TranscribeAudioArgs`, `TranscribeAudioResult`.

- [ ] **Step 6: Run the full package suite + typecheck**

Run: `cd packages/llm-unified && bun test && cd ../.. && pnpm typecheck --force`
Expected: all green, 14/14 typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-unified/src/
git commit -m "Add serviceKind 'stt' with the Voxtral Mini STT offering"
```

---

### Task 4: Dexie v22 — dictation settings

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`

**PRE-CHECK (parallel-version-ownership rule):** run `rg -n "this.version\(" apps/user-client/src/boot/client-data-db.ts | tail -3` and confirm the head is `version(21)`. If anything claimed v22 in parallel, STOP and surface to Liz.

- [ ] **Step 1: Extend `SettingsRow`** (after the `voiceMode` field)

```ts
  /** Dictation: VAD sensitivity preset (energy thresholds, chatsune-tuned). */
  dictationSensitivity: 'low' | 'medium' | 'high';
  /** Dictation: VAD redemption window (silence tolerance) in ms. */
  dictationRedemptionMs: number;
  /** Dictation: send each completed transcription immediately instead of drafting. */
  dictationAutoSend: boolean;
```

- [ ] **Step 2: Add version 22** (after the `version(21)` block)

```ts
    // Version 22 — dictation/STT. Settings gain the VAD sensitivity preset,
    // the redemption (silence-tolerance) window and the auto-send toggle.
    this.version(22).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (s.dictationSensitivity !== 'low' && s.dictationSensitivity !== 'high')
            s.dictationSensitivity = 'medium';
          if (typeof s.dictationRedemptionMs !== 'number') s.dictationRedemptionMs = 1_728;
          if (typeof s.dictationAutoSend !== 'boolean') s.dictationAutoSend = false;
        });
    });
```

- [ ] **Step 3: Extend the first-launch seed** — find the seeded settings object (search for `voiceMode: 'paragraph'` around line 863) and add the three defaults beside it:

```ts
        dictationSensitivity: 'medium',
        dictationRedemptionMs: 1_728,
        dictationAutoSend: false,
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck --force` — expect 14/14. (Compile errors at SettingsRow call-sites mean a consumer constructs a full SettingsRow — fix by adding the three fields there too.)

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts
git commit -m "Add Dexie v22 dictation settings"
```

---

### Task 5: Capture infrastructure ports (presets, WAV, recording tiers)

Three 1:1 ports. Source files are in the chatsune path given in the header. Adaptations for all three: SPDX header `AGPL-3.0-only`, Biome formatting (semicolons, single quotes per repo config), British English comments (already are), and the import of `VoiceActivationThreshold` moves to the new presets file itself.

**Files:**
- Create: `apps/user-client/src/lib/voice/dictation/vad-presets.ts`
  — port `vadPresets.ts` verbatim **including the comment block** explaining frames and the deliberate medium=high `minSpeechFrames`. Define and export the type here:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** User-facing VAD sensitivity level. Maps to Silero energy thresholds. */
export type VadSensitivity = 'low' | 'medium' | 'high';

export interface VadPreset {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechFrames: number;
}

// Preset table is expressed in frames (matching Silero's native units) and is
// ported 1:1 from chatsune, where the values were tuned empirically on device
// and praised by users — do not replace with vad-web library defaults.
// `minSpeechFrames` is intentionally identical for medium and high (5): short
// utterances otherwise slip below the high threshold's 8-frame minimum and
// never trigger a speech-start. Energy sensitivity (positive/negative
// thresholds) is strictly monotonic across the presets — that is the parameter
// the user actually tunes.
export const VAD_PRESETS: Record<VadSensitivity, VadPreset> = {
  low: { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, minSpeechFrames: 3 },
  medium: { positiveSpeechThreshold: 0.65, negativeSpeechThreshold: 0.5, minSpeechFrames: 5 },
  high: { positiveSpeechThreshold: 0.8, negativeSpeechThreshold: 0.6, minSpeechFrames: 5 },
};

export const REDEMPTION_MS_MIN = 576; // 6 frames — below this VAD gets twitchy
export const REDEMPTION_MS_MAX = 11_520; // 120 frames
export const REDEMPTION_MS_DEFAULT = 1_728; // 18 frames
```

- Create: `apps/user-client/src/lib/voice/dictation/wav-encoder.ts`
  — port `wavEncoder.ts` verbatim (`float32ToWavBlob`). One Biome fix: `samples[i]` is `number | undefined` under `noUncheckedIndexedAccess` — use `samples[i] ?? 0`.
- Create: `apps/user-client/src/lib/voice/dictation/audio-recording.ts`
  — port `audioRecording.ts` verbatim (`pickRecordingMimeType`, `extensionForMimeType`, `createRecorder`).
- Test: `apps/user-client/tests/lib/voice/dictation/wav-encoder.test.ts`
- Test: `apps/user-client/tests/lib/voice/dictation/audio-recording.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { float32ToWavBlob } from '../../../../src/lib/voice/dictation/wav-encoder.js';

describe('float32ToWavBlob', () => {
  it('produces a RIFF/WAVE header with correct sizes', async () => {
    const blob = float32ToWavBlob(new Float32Array(16_000), 16_000); // 1 s silence
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 16_000 * 2);
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    expect(String.fromCharCode(...head.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...head.slice(8, 12))).toBe('WAVE');
  });

  it('clamps out-of-range samples instead of overflowing', async () => {
    const blob = float32ToWavBlob(new Float32Array([2, -2]), 16_000);
    const data = new DataView(await blob.slice(44).arrayBuffer());
    expect(data.getInt16(0, true)).toBe(0x7fff);
    expect(data.getInt16(2, true)).toBe(-0x8000);
  });
});
```

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extensionForMimeType,
  pickRecordingMimeType,
} from '../../../../src/lib/voice/dictation/audio-recording.js';

describe('pickRecordingMimeType', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null when MediaRecorder is unavailable (jsdom default)', () => {
    expect(pickRecordingMimeType()).toBeNull();
  });

  it('prefers webm/opus when supported', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (m: string) => m.startsWith('audio/webm'),
    });
    expect(pickRecordingMimeType()).toBe('audio/webm;codecs=opus');
  });
});

describe('extensionForMimeType', () => {
  it('maps the three tiers', () => {
    expect(extensionForMimeType('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMimeType('audio/mp4')).toBe('m4a');
    expect(extensionForMimeType('audio/wav')).toBe('wav');
  });
});
```

- [ ] **Step 2: Run — expect module-not-found**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/dictation/ --reporter=basic`

- [ ] **Step 3: Create the three files** (port per the file notes above; no test for `vad-presets.ts` — a constant table is a trivial-getter case)

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/dictation/ apps/user-client/tests/lib/voice/dictation/
git commit -m "Port chatsune VAD presets, WAV encoder and recording tiers"
```

---

### Task 6: `capture.ts` — PTT + VAD capture port

**Files:**
- Create: `apps/user-client/src/lib/voice/dictation/capture.ts`

Add the dependency first:

```bash
cd apps/user-client && pnpm add @ricky0123/vad-web@0.0.30
```

This is a **port with deletions** of chatsune's `audioCapture.ts` (597 lines, source path in the header). Read the source file in full before porting. Keep the class-singleton shape and the session-counter race guards exactly — they encode real bugs found on device (orphan VAD after async `MicVAD.new`, stale recorder-chunk arrays, teardown ordering so MediaRecorder flushes before tracks die).

**Keep (verbatim apart from import paths):**
- `AudioCaptureCallbacks` interface (`onSpeechStart`, `onSpeechEnd(CapturedAudio)`, `onVolumeChange`, `onMisfire`) — define `CapturedAudio` locally (chatsune has it in `types.ts`):

```ts
/** One captured utterance, ready for STT upload. */
export interface CapturedAudio {
  /** Raw 16 kHz mono PCM from the capture path. */
  pcm: Float32Array;
  /** Upload-ready payload: Opus/AAC when available, WAV fallback otherwise. */
  blob: Blob;
  mimeType: string;
  /** 0 = container-embedded (MediaRecorder); 16000 for the WAV path. */
  sampleRate: number;
  durationMs: number;
}
```

- `startPTT` / `stopPTT` including the parallel-recorder closure-binding comment and the teardown-order comment.
- `startContinuous` / `stopContinuous` including the session-counter orphan-VAD guard, the MS_PER_FRAME=96 conversion comment, and the per-segment MediaRecorder logic.
- The volume meter (`startVolumeMeter`/`stopVolumeMeter`, analyser + rAF) — it feeds the button glow.
- The misfire handler.
- The CDN constants block including the explanatory comment (`ORT_CDN`/`VAD_CDN`, pinned `onnxruntime-web@1.22.0` and `@ricky0123/vad-web@0.0.30` — must match the installed package version).
- The module-level singleton export (`export const audioCapture = new AudioCaptureImpl()` or equivalent — check the source tail).

**Delete (chatsune-only coupling, YAGNI for Spec 2):**
- All `pauseRedemptionStore` imports and the silence-edge state machine that drives it (`silenceFrames`, `inSpeechSegment`, `redemptionOpen`, `GRACE_FRAMES`, `handleVadFrame`, the `onFrameProcessed` wiring) — that fed chatsune's countdown pie, which we are not building.
- The `externalRecorder` option and `getMediaStream()` (conversation-mode plumbing — Spec 3 re-adds if needed).
- Any visualiser hooks.

**Change:**
- `startContinuous(callbacks, options)` signature only (drop the legacy string form): `options: { sensitivity: VadSensitivity; redemptionMs: number }`, both required — settings are resolved by the caller (the hook), defaults live in Dexie.
- Imports point at the Task-5 files (`./vad-presets.js`, `./audio-recording.js`, `./wav-encoder.js`).
- SPDX header `AGPL-3.0-only`; keep British English comments.

- [ ] **Step 1: Port the file per the keep/delete/change lists**

- [ ] **Step 2: Verify gates** (no unit test — the class is 95 % browser-API plumbing; it is exercised mocked through the machine tests in Task 7 and live on device per spec §11. This judgement is recorded here deliberately.)

Run: `pnpm typecheck --force` and `cd apps/user-client && pnpm exec biome check src/lib/voice/dictation/capture.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/voice/dictation/capture.ts apps/user-client/package.json pnpm-lock.yaml
git commit -m "Port chatsune audio capture for PTT and VAD dictation"
```

---

### Task 7: `resolve-stt.ts`

**Files:**
- Create: `apps/user-client/src/lib/voice/dictation/resolve-stt.ts`
- Create: `apps/user-client/tests/lib/voice/dictation/resolve-stt.test.ts`

Mirror `resolve-tts.ts` (read it first — same db/session/secret plumbing). Differences: `listSttOfferings()` instead of `listTtsOfferings()`; no voice concept; the resolution returns a `transcribe` closure.

- [ ] **Step 1: Write the failing test** — mirror the mocking approach of `tests/lib/voice/resolve-tts.test.ts` (read that file and copy its vi.mock scaffolding for the db, session store and `openSecret`), asserting:
  - no enabled mistral provider row → `{ ok: false, reason: 'no-provider' }`
  - happy path → `ok: true`, `sttLabel === 'Voxtral Mini STT via Mistral AI'`, and `transcribe` delegates to `transcribeAudio` with the decrypted key (mock `@chatsundere/llm-unified`'s `transcribeAudio` and assert the call args).
  - decrypt failure → `{ ok: false, reason: 'no-provider' }`.

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  TranscriptionError,
  getProvider,
  listSttOfferings,
  transcribeAudio,
} from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { openSecret } from '../../secrets.js';

export type SttResolution =
  | {
      ok: true;
      /** Transcribe one captured utterance; throws TranscriptionError on failure. */
      transcribe: (blob: Blob, mimeType: string, signal: AbortSignal) => Promise<string>;
      /** For UI labels, e.g. 'Voxtral Mini STT via Mistral AI'. */
      sttLabel: string;
    }
  | { ok: false; reason: 'no-provider' };

/**
 * Resolve the transcription pipeline, or the constructive reason why it cannot
 * run. Mirrors resolveTts: mk / apiKey / proxy material resolved once, captured
 * by the returned closure. UI-free: no React imports.
 */
export async function resolveStt(): Promise<SttResolution> {
  const offering = listSttOfferings()[0];
  const sttMeta = offering?.stt;
  if (!offering || !sttMeta) return { ok: false, reason: 'no-provider' };

  const providerDef = getProvider(offering.providerId);
  if (!providerDef) return { ok: false, reason: 'no-provider' };

  const db = getClientDataDb();
  const providerRow = (
    await db.providers.where('templateId').equals(offering.providerId).toArray()
  ).find((p) => p.enabled);
  if (!providerRow) return { ok: false, reason: 'no-provider' };

  const mk = useSessionStore.getState().mk;
  if (!mk) {
    console.warn('resolveStt: no master key in session — falling back to no-provider');
    return { ok: false, reason: 'no-provider' };
  }
  let apiKey: string;
  try {
    apiKey = await openSecret(providerRow.apiKey, mk, `provider/${providerRow.id}/api-key`);
  } catch {
    console.warn('resolveStt: failed to decrypt api-key — falling back to no-provider');
    return { ok: false, reason: 'no-provider' };
  }

  const settings = await db.settings.get(1);
  const corsProxyUrl = settings?.corsProxy?.url ?? null;
  let corsProxyKey: string | null = null;
  if (settings?.corsProxy) {
    try {
      corsProxyKey = await openSecret(settings.corsProxy.sharedKey, mk, 'cors-proxy/shared-key');
    } catch {
      console.warn('resolveStt: failed to decrypt cors-proxy key — falling back to no-provider');
      return { ok: false, reason: 'no-provider' };
    }
  }

  const providerConfig = {
    baseUrl: providerDef.baseUrl,
    routing:
      providerDef.corsHint === 'requires-proxy'
        ? ({ kind: 'cors-proxy' } as const)
        : ({ kind: 'direct' } as const),
  };
  const { upstreamSlug } = offering;
  const providerDisplayName = providerDef.displayName;

  const transcribe = async (blob: Blob, mimeType: string, signal: AbortSignal): Promise<string> => {
    try {
      const result = await transcribeAudio({
        providerConfig,
        apiKey,
        corsProxyUrl,
        corsProxyKey,
        upstreamSlug,
        blob,
        mimeType,
        signal,
      });
      return result.text;
    } catch (err) {
      // Provider-boundary logging (the TTS hardening lesson): surface the real
      // cause instead of an opaque UI state; error handling is unchanged.
      const status = err instanceof TranscriptionError ? err.status : null;
      console.error('[voice-stt] transcription failed', { status, bytes: blob.size, mimeType });
      throw err;
    }
  };

  return { ok: true, transcribe, sttLabel: `${sttMeta.displayName} via ${providerDisplayName}` };
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/dictation/resolve-stt.ts apps/user-client/tests/lib/voice/dictation/resolve-stt.test.ts
git commit -m "Add STT provider resolution mirroring resolve-tts"
```

---

### Task 8: The dictation machine

**Files:**
- Create: `apps/user-client/src/lib/voice/dictation/dictation-machine.ts`
- Create: `apps/user-client/tests/lib/voice/dictation/dictation-machine.test.ts`

Read `src/lib/voice/voice-machine.ts` first — match its idioms (deps injected via input, `fromPromise` actors, selectors exported beside the machine).

**Statechart (the heart of the feature — implement exactly this):**

```
idle
  PRESS_START            -> ptt            (capture starts at pointerdown, spec D4)
ptt (entry: deps.startPtt)
  PRESS_END [heldMs < 300] -> vad          (tap: discard scratch capture, start VAD)
  PRESS_END [else]         -> drainingPtt  (stopPtt; its onSpeechEnd spawns the actor)
  PRESS_CANCEL             -> idle         (slide-off / Escape: stopPtt, discard audio)
  CAPTURE_ERROR            -> idle         (context.captureError set: 'permission' | 'device')
vad (entry: deps.startVad with sensitivity+redemptionMs from input)
  SPEECH_END(audio)      -> (spawn transcription actor; pending++; stay)
  MISFIRE                -> (silent; stay)
  TAP                    -> [pending > 0] drainingVad, [else] idle  (deps.stopVad)
  LEAVE                  -> idle           (stopVad + abort all actors)
  CAPTURE_ERROR          -> idle           (context.captureError set)
  (actor done)           -> deps.emitTranscript(text); pending--
  (actor error)          -> context.failed = { blob, mimeType }; pending--   (keep listening)
drainingPtt / drainingVad   ("Transcribing…" — capture is over, actors in flight)
  (last actor done)      -> idle           (emitTranscript on each completion)
  (actor error)          -> failed         (context.failed = { blob, mimeType })
  CANCEL                 -> idle           (abort all in-flight actors)
failed                       (PTT or drain failure — Retry/Discard surface)
  RETRY                  -> drainingPtt    (respawn actor with context.failed blob)
  DISCARD                -> idle           (clear context.failed)
(global) LEAVE           -> idle from every state (stop capture, abort actors)
```

Notes that bind the implementation:
- `DictationDeps`: `{ startPtt(cb): Promise<void>; stopPtt(): void; startVad(cb, opts): Promise<void>; stopVad(): void; transcribe(blob, mimeType, signal): Promise<string>; emitTranscript(text): void }`. The capture callback `cb` translates capture events into machine events (`SPEECH_END`, `MISFIRE`, `CAPTURE_ERROR`) — the hook builds it.
- `heldMs` comes on the `PRESS_END` event (the component measures); 300 is a module constant `TAP_MAX_MS`.
- The transcription actor is `fromPromise` over `deps.transcribe` with the machine-provided signal; the 30 s transport timeout lives in `transcribeAudio` (Task 2), so a hung request rejects into the error path — that is the spec §3.3 timeout-into-Retry/Discard behaviour.
- A `vad`-time actor error sets `context.failed` but does NOT leave `vad` (spec: the session keeps listening). The failed-utterance note renders from context, not from the state value. A later RETRY while in `vad` respawns from `context.failed` (pending++ again); DISCARD clears it.
- `context`: `{ pending: number; failed: { blob: Blob; mimeType: string } | null; captureError: 'permission' | 'device' | null; heldSince: number | null }`.
- `getUserMedia` rejection mapping: `NotAllowedError` → `'permission'`, anything else → `'device'`. The hook maps the thrown error; the machine just stores the tag.
- Export selectors: `selectDictationUiState` returning `'idle' | 'capturing' | 'transcribing'` (capturing = ptt|vad, transcribing = draining*|failed-from-ptt), `selectFailed`, `selectCaptureError`.

- [ ] **Step 1: Write the failing tests** (mocked deps, `vi.useFakeTimers()` where a wait matters; follow `voice-machine.test.ts` actor-testing idioms). The test list — each is one `it`:

1. `PRESS_START` then `PRESS_END` after 500 ms (mock `heldMs: 500`) → `stopPtt` called; delivering `SPEECH_END` then actor resolve `'hello'` → `emitTranscript('hello')`, state back to `idle`.
2. `PRESS_END` with `heldMs: 120` → `stopPtt` called (scratch discarded — no transcription spawned), `startVad` called: tap becomes a VAD session.
3. In `vad`: two `SPEECH_END` events; first actor resolves `'one'` after the second resolves `'two'` → `emitTranscript` called with `'two'` then `'one'` (completion order, spec §3.3) and state stays `vad`.
4. In `vad`: `MISFIRE` → no actor spawned, no error, still `vad`.
5. In `vad`: actor rejects → `selectFailed` non-null, state still `vad` (session keeps listening); `DISCARD` clears it.
6. In `vad` with one pending actor: `TAP` → `drainingVad` (`stopVad` called); actor resolves → `idle`.
7. In `drainingVad`: `CANCEL` → in-flight actor signal aborted, `idle`, no `emitTranscript`.
8. PTT actor rejects → state `failed`; `RETRY` respawns with the SAME blob (assert `transcribe` second call receives the identical Blob instance); resolve → `emitTranscript` + `idle`.
9. `LEAVE` from `vad` with pending actors → `stopVad` called, actors aborted, `idle`.
10. `CAPTURE_ERROR` with `'permission'` in `ptt` → `idle` with `selectCaptureError() === 'permission'`; a following `PRESS_START` clears it.

- [ ] **Step 2: Run — expect failure** (`cd apps/user-client && pnpm vitest run tests/lib/voice/dictation/dictation-machine.test.ts`)

- [ ] **Step 3: Implement the machine** per the statechart block above.

- [ ] **Step 4: Run — expect 10/10 PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/dictation/dictation-machine.ts apps/user-client/tests/lib/voice/dictation/dictation-machine.test.ts
git commit -m "Add the XState dictation machine"
```

---

### Task 9: `use-dictation.ts` — the hook

**Files:**
- Create: `apps/user-client/src/lib/voice/dictation/use-dictation.ts`
- Create: `apps/user-client/tests/lib/voice/dictation/use-dictation.test.tsx`

Read `use-voice-playback.ts` first and match its shape (one actor for the hook's lifetime, deps built once over refs).

**Public interface:**

```ts
export interface DictationArgs {
  /** Append a completed transcript to the draft (always at the end, spec §3.3). */
  onTranscript: (text: string) => void;
  /** Send a transcript as a message (auto-send path). */
  onSend: (text: string) => void;
  /** True while a persona reply streams — auto-send falls back to onTranscript then. */
  isStreamLive: boolean;
  /** Stop an active read-aloud before capture starts (spec §3.5 / D13). */
  stopPlayback: () => void;
}

export interface Dictation {
  uiState: 'idle' | 'capturing' | 'transcribing';
  /** 0..1 mic level for the button glow; 0 when not capturing. */
  level: number;
  /** STT resolvable? false → mic renders disabled-with-tooltip. */
  available: boolean;
  failed: boolean;
  captureError: 'permission' | 'device' | null;
  pressStart: () => void; // pointerdown on the mic
  pressEnd: () => void;   // pointerup — hook computes heldMs itself
  pressCancel: () => void;
  tap: () => void;        // tap while a VAD session listens (stop it)
  cancel: () => void;     // cancel in-flight transcription (draining)
  retry: () => void;
  discard: () => void;
}

export function useDictation(args: DictationArgs): Dictation;
```

Implementation notes that bind:
- **Availability** is a lightweight check for the UI only: `listSttOfferings().length > 0` AND an enabled matching provider row exists (reuse `useProviders()` — same data VoiceSection uses). Full resolution (mk, decrypt) happens lazily inside `pressStart` via `resolveStt()`; a runtime `no-provider` lands in `captureError: 'device'` territory? **No** — it cannot happen: when `available` is false the button is disabled, and a decrypt failure surfaces the §6 note via `failed`-style handling. Implement: `resolveStt()` not-ok inside `pressStart` → set `captureError: 'device'` (the honest catch-all) and never start capture.
- `pressStart` records `performance.now()` in a ref, calls `args.stopPlayback()`, resolves STT (cached for the hook's lifetime after first success in a ref), then sends `PRESS_START`. The machine's `startPtt` dep wraps `audioCapture.startPTT` with a callback bundle that forwards `onSpeechEnd` → `SPEECH_END`, `onVolumeChange` → a `setLevel` rAF-throttled state setter, and maps `getUserMedia` rejections (`NotAllowedError` → `CAPTURE_ERROR 'permission'`).
- `pressEnd` sends `PRESS_END` with `heldMs: performance.now() - pressedAtRef.current`.
- Settings (`dictationSensitivity`, `dictationRedemptionMs`, `dictationAutoSend`) come from `useSettings()` and are read at `startVad` time (a mid-session settings change does not retarget a running session — same stance as playback's play-time reads).
- `emitTranscript` dep: `settings.dictationAutoSend && !args.isStreamLive ? args.onSend(text) : args.onTranscript(text)`. The `isStreamLive` guard is the **no-mid-stream-sends rule**: an auto-send utterance completing while a reply streams appends to the draft instead (predictable, constructive; noted in spec §3.4).
- On unmount / chatId change → send `LEAVE` (machine stops capture + aborts actors).

- [ ] **Step 1: Write the failing tests** (renderHook from `@testing-library/react`; mock `./capture.js`, `./resolve-stt.js`, `../../../data/settings.js`, `../../../data/providers.js` — follow the mock style of `tests/lib/voice/use-voice-playback.test.tsx`):

1. `available` false when no enabled provider row → handlers are no-ops (pressStart does not call resolveStt).
2. pressStart → stopPlayback called BEFORE capture starts (call-order assertion via mock.invocationCallOrder).
3. Full PTT flow: pressStart → pressEnd(550 ms via fake timers) → capture mock delivers SPEECH_END → resolveStt mock's transcribe resolves 'hi' → `onTranscript('hi')`, uiState walked `capturing → transcribing → idle`.
4. autoSend on → same flow calls `onSend('hi')`; with `isStreamLive: true` it calls `onTranscript('hi')` instead.
5. permission rejection from capture mock → `captureError === 'permission'`, uiState `idle`.

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement per the notes**

- [ ] **Step 4: Run — expect PASS; then the whole dictation test dir**

Run: `cd apps/user-client && pnpm vitest run tests/lib/voice/dictation/`

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/dictation/use-dictation.ts apps/user-client/tests/lib/voice/dictation/use-dictation.test.tsx
git commit -m "Add the useDictation hook"
```

---

### Task 10: DualActionBtn — the three-fold morph

**Files:**
- Modify: `apps/user-client/src/components/chat/DualActionBtn.tsx` (full rewrite below)
- Modify: `apps/user-client/src/index.css` (styles at the end)
- Create: `apps/user-client/tests/components/chat/DualActionBtn.test.tsx`

- [ ] **Step 1: Write the failing tests** — each is one `it` (render with `@testing-library/react`, `fireEvent.pointerDown/-Up`):

1. `isStreamLive` → stop button (`data-dual="stop"`), click calls `onStop` (existing behaviour pinned).
2. `hasText` + dictation idle → send arrow, click calls `onSend`.
3. No text, `dictation.available` true, idle → mic button (`data-dual="mic"`); pointerDown calls `pressStart`, pointerUp calls `pressEnd`.
4. No text, `available` false → mic disabled with `title` `"Add a Mistral provider in My Settings to dictate"`.
5. `uiState === 'capturing'` → button has `data-dual="capture"` and `--mic-level` style var set from `level`; click calls `tap`.
6. `uiState === 'capturing'` even WITH `hasText` true → still the capture control, not send (priority rule, spec §3.1).
7. `uiState === 'transcribing'` → `data-dual="cancel-transcribe"`, click calls `cancel`.
8. pointerLeave during a press calls `pressCancel`.

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Rewrite the component**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import type { Dictation } from '../../lib/voice/dictation/use-dictation.js';

interface Props {
  hasText: boolean;
  isStreamLive: boolean;
  personaName: string;
  onSend: () => void;
  onStop: () => void;
  dictation: Dictation;
}

/**
 * The cockpit's single action button. Strict priority (spec 2026-06-12 §3.1):
 * stream-stop > active capture > send > mic. Capture owns the button while a
 * VAD session listens — even once transcripts have landed in the draft —
 * because a running session must keep its stop control.
 */
export function DualActionBtn(p: Props): JSX.Element {
  if (p.isStreamLive) {
    return (
      <button
        type="button"
        className="dual-action-btn"
        data-dual="stop"
        title={`Stop ${p.personaName}`}
        aria-label="Stop"
        onClick={p.onStop}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    );
  }

  if (p.dictation.uiState === 'capturing') {
    return (
      <button
        type="button"
        className="dual-action-btn dual-action-capture"
        data-dual="capture"
        title="Stop listening"
        aria-label="Stop listening"
        style={{ '--mic-level': p.dictation.level } as React.CSSProperties}
        onClick={p.dictation.tap}
        onPointerUp={p.dictation.pressEnd}
        onPointerLeave={p.dictation.pressCancel}
      >
        <MicGlyph />
      </button>
    );
  }

  if (p.dictation.uiState === 'transcribing') {
    return (
      <button
        type="button"
        className="dual-action-btn"
        data-dual="cancel-transcribe"
        title="Cancel transcription"
        aria-label="Cancel transcription"
        onClick={p.dictation.cancel}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    );
  }

  if (p.hasText) {
    return (
      <button
        type="button"
        className="dual-action-btn"
        data-dual="action"
        title="Send"
        aria-label="Send"
        onClick={p.onSend}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M5 12l14-7-5 14-2-7-7-0z" />
        </svg>
      </button>
    );
  }

  const available = p.dictation.available;
  return (
    <button
      type="button"
      className="dual-action-btn"
      data-dual="mic"
      disabled={available ? undefined : true}
      title={available ? 'Hold to talk · tap to dictate' : 'Add a Mistral provider in My Settings to dictate'}
      aria-label={available ? 'Dictate' : 'Microphone (disabled)'}
      onPointerDown={available ? p.dictation.pressStart : undefined}
      onPointerUp={available ? p.dictation.pressEnd : undefined}
      onPointerLeave={available ? p.dictation.pressCancel : undefined}
    >
      <MicGlyph />
    </button>
  );
}

function MicGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
```

(The old `'Voice arrives with Block 4'` placeholder dies here. Note: in the `capturing` branch the pointer handlers stay attached so a HELD PTT press releases correctly — `pressEnd` is idempotent for the tap-started session because the machine ignores `PRESS_END` outside `ptt`.)

- [ ] **Step 4: Add the styles** (end of `index.css`; reuse the design-token variables the file already uses — read neighbouring button styles first):

```css
/* Dictation capture state — organic pulse + mic-level glow (spec §5). */
.dual-action-capture {
  animation: dictation-pulse 1.8s ease-in-out infinite;
  box-shadow: 0 0 calc(6px + 14px * var(--mic-level, 0))
    color-mix(in oklab, currentColor 55%, transparent);
}
@keyframes dictation-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
@media (prefers-reduced-motion: reduce) {
  .dual-action-capture {
    animation: none;
    box-shadow: 0 0 10px color-mix(in oklab, currentColor 45%, transparent);
  }
}
```

- [ ] **Step 5: Run the component tests — expect PASS.** Existing suites touching DualActionBtn (cockpit/chat-page tests) now need the `dictation` prop — fix call-sites with a shared test stub:

```ts
export const idleDictationStub: Dictation = {
  uiState: 'idle', level: 0, available: false, failed: false, captureError: null,
  pressStart: () => {}, pressEnd: () => {}, pressCancel: () => {},
  tap: () => {}, cancel: () => {}, retry: () => {}, discard: () => {},
};
```

(Place in `apps/user-client/tests/helpers/dictation-stub.ts`; import where needed.)

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/DualActionBtn.tsx apps/user-client/src/index.css apps/user-client/tests/
git commit -m "Morph DualActionBtn into the three-fold mic control"
```

---

### Task 11: Cockpit + chat-page wiring

**Files:**
- Modify: `apps/user-client/src/components/chat/Cockpit.tsx`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`

- [ ] **Step 1: Thread the prop.** `Cockpit` gains `dictation: Dictation` in its Props and passes it to `<DualActionBtn …  dictation={p.dictation} />`.

- [ ] **Step 2: Placeholder switch** (Cockpit, the `AutoSizeTextarea`):

```tsx
placeholder={
  p.dictation.uiState === 'capturing'
    ? 'Listening…'
    : p.dictation.uiState === 'transcribing'
      ? 'Transcribing…'
      : `Speak to ${p.persona.name}…`
}
```

- [ ] **Step 3: Error note** (Cockpit, render directly above `.cockpit-row-input`, the same area the reject toast uses — read that block first and match its classes):

```tsx
{p.dictation.failed ? (
  <div className="cockpit-dictation-note" role="alert">
    <span>Couldn&apos;t transcribe.</span>
    <button type="button" onClick={p.dictation.retry}>Retry</button>
    <button type="button" onClick={p.dictation.discard}>Discard</button>
  </div>
) : p.dictation.captureError === 'permission' ? (
  <div className="cockpit-dictation-note" role="alert">
    Allow microphone access in your browser settings, then try again.
  </div>
) : p.dictation.captureError === 'device' ? (
  <div className="cockpit-dictation-note" role="alert">
    The microphone could not be started. Check it is connected and not in use.
  </div>
) : null}
```

Style `.cockpit-dictation-note` alongside the cockpit styles in `index.css` (small, muted, buttons as inline text-buttons — match `.cockpit-reject`'s visual weight).

- [ ] **Step 4: chat-page wiring** (near the `useVoicePlayback` call, `chat-page.tsx:448`):

```tsx
const dictation = useDictation({
  onTranscript: (text) =>
    setDraft((d) => (d.trim().length > 0 ? `${d.trimEnd()} ${text}` : text)),
  onSend: (text) => void onSend(text),
  isStreamLive,
  stopPlayback: voice.stop,
});
```

(`isStreamLive` already exists in the component — search for the prop fed to `Cockpit`. The draft setter uses the functional form so late VAD appends never clobber concurrent edits; appends always land at the end — spec §3.3.) Pass `dictation={dictation}` to `<Cockpit />`. **Check `setDraft`'s type** — if the draft state is not a plain `useState` setter accepting a function, read how `setDraft` is defined (`chat-page.tsx:262`) and use the value-form with the current draft in scope instead.

- [ ] **Step 5: Gates**

Run: `pnpm typecheck --force` then `cd apps/user-client && pnpm vitest run --reporter=basic 2>&1 | tail -20`
Expected: 14/14; vitest at baseline (8 pre-existing failures, zero new).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/Cockpit.tsx apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/src/index.css
git commit -m "Wire dictation into the cockpit and chat page"
```

---

### Task 12: VoiceSection — the Dictation group

**Files:**
- Modify: `apps/user-client/src/components/voice/VoiceSection.tsx`
- Modify: `apps/user-client/tests/components/voice/VoiceSection.test.tsx`

- [ ] **Step 1: Write the failing tests** (extend the existing file; read its render/mocking scaffolding first):

1. Renders a "Dictation" heading with three sensitivity options; the persisted one (`dictationSensitivity`) carries `aria-pressed="true"`; clicking another calls the settings update with `{ dictationSensitivity: 'high' }`.
2. Renders a range input for pause tolerance reflecting `dictationRedemptionMs`; change fires `{ dictationRedemptionMs: <value> }` clamped to [576, 11520].
3. Auto-send toggle: off by default; switching on fires `{ dictationAutoSend: true }` AND the eyes-open note ("Each utterance sends immediately; there is no correction step") is visible when on.
4. STT provider status line: with an enabled mistral row shows "Voxtral Mini STT via Mistral AI"; without shows the add-provider hint.

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Implement.** Reuse the existing `ModeOption` row component for the three sensitivity levels (rename mentally: it is generic enough — `id` becomes the sensitivity value via a parallel `SensitivityOption` wrapper if the typing fights; do NOT fork a near-identical component, widen `ModeOption`'s `id` prop to `string`). The slider:

```tsx
<input
  type="range"
  min={576}
  max={11_520}
  step={96}
  value={settings?.dictationRedemptionMs ?? 1_728}
  aria-label="Pause tolerance"
  onChange={(e) => update.mutate({ dictationRedemptionMs: Number(e.target.value) })}
/>
<span className="text-[11px] text-paper-soft">
  {((settings?.dictationRedemptionMs ?? 1_728) / 1000).toFixed(1)} s of silence ends an utterance
</span>
```

The STT status line mirrors the TTS one (`listSttOfferings()[0]`, `getProvider`, enabled-row check — same code shape directly below the existing Provider block). Auto-send is a simple labelled toggle button (`aria-pressed`) with the conditional note. Section heading order: Read-aloud mode → Provider → **Dictation** (sensitivity → pause tolerance → auto-send → STT provider line).

- [ ] **Step 4: Run — expect PASS** (`pnpm vitest run tests/components/voice/`)

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/voice/VoiceSection.tsx apps/user-client/tests/components/voice/VoiceSection.test.tsx
git commit -m "Add the Dictation settings group to My Settings Voice"
```

---

### Task 13: Documentation, egress log, full gates

**Files:**
- Modify: `obsidian/insights/security-deferrals.md` (append two entries, following the file's existing format — read it first):
  1. **Recorded speech audio to Mistral (user-initiated)** — dictation sends captured microphone audio to the Mistral STT endpoint, direct; gesture-gated per utterance/session; no client-side persistence (machine context only, one retry cycle); strictly more sensitive than the spoken-text TTS egress (raw voice biometrics). Accepted: user-initiated, the feature IS the egress.
  2. **VAD engine assets from jsdelivr** — `onnxruntime-web@1.22.0` WASM + `@ricky0123/vad-web@0.0.30` Silero model fetched from cdn.jsdelivr.net at first VAD use (~14 MB, browser-cached); pinned versions; code/model only, no user data in either direction; VAD inference is fully local. Follow-up consideration: self-hosting re-evaluation rides the existing embeddings/ORT-CDN follow-up.
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` — the session record (squash hash, gates, device-test pointer to spec §11). Written by Liz at squash time, not by a subagent.

- [ ] **Step 1: Append the two egress entries**

- [ ] **Step 2: Run the FULL gate set** (final verification — all five, fresh):

```bash
pnpm typecheck --force          # expect 14/14
pnpm run build --force          # expect 9/9
cd packages/llm-unified && bun test && cd ../..   # expect all green
cd apps/user-client && pnpm vitest run 2>&1 | tail -5 && cd ../..  # baseline 8 fail only
pnpm exec biome check apps/user-client/src packages/llm-unified/src  # clean
```

- [ ] **Step 3: Commit the docs**

```bash
git add obsidian/insights/security-deferrals.md
git commit -m "Log dictation egress classes [skip ci]"
```

---

## Post-plan (Liz, not subagents)

- Laura pre-squash pass (light): verify the built flow honours the spec-pass intent (button priority, error exits, the deferred mic-invisibility unchanged).
- Squash to one feature unit ("Add dictation/STT — push-to-talk, VAD sessions, Voxtral transcription"), verify full-tree capture if a worktree was used (`git diff master..branch` empty + typecheck on master).
- STATUS update + Chris's device test per spec §11 (restart `pnpm dev` — packages/llm-unified changed; `pnpm install` once — vad-web is new).
- Not a Larissa path (client-only, no auth/sync/proxy/crypto) — egress logged in Task 13.

## Self-review notes (plan-time)

- Spec §3.1–§3.5, §4, §5, §6, §7, §8, §9 all map to Tasks 8–11, 1–3/6–7, 10–12, 11, 4, 13, and the per-task tests respectively. Spec §10 (CORS probe) already executed and recorded. Spec §11 is Chris's device list (post-plan).
- The auto-send-while-streaming fallback (Task 9) is an implementation rule the spec does not state explicitly — surfaced to Chris at plan review; if he rejects, auto-send queues instead (small machine change, same surface).
- Type-name continuity verified: `VadSensitivity` (T5) = the settings union (T4) values; `Dictation`/`DictationArgs` (T9) consumed in T10/T11; `CapturedAudio` (T6) consumed by the machine deps (T8); `TranscriptionError` (T2) consumed in T7.
