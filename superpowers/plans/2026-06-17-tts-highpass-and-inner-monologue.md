# TTS High-Pass Cleanup + Inner-Monologue Easter Egg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gentle, user-selectable high-pass cleanup filter to all TTS playback, and a manual "read inner monologue" easter egg that vocalises a chain-of-thought trace with an ethereal reverb effect.

**Architecture:** Both features attach to the existing Web Audio graph in `AudioSink` (`source → analyser → destination`). `AudioSink.play()` gains a *filter profile* describing the node chain. The cleanup filter is a single Butterworth high-pass derived at play time from a global setting plus a per-offering recommendation. The monologue is an isolated second `AudioSink` driven by a dedicated hook, using a procedurally-synthesised impulse response for reverb (no shipped asset).

**Tech Stack:** TypeScript (strict), Web Audio API (`BiquadFilterNode`, `ConvolverNode`, `GainNode`), React 18, Dexie (IndexedDB), Valibot, `@chatsundere/llm-unified`, Bun test runner (llm-unified) / Vitest (user-client).

## Global Constraints

- **British English** in all code, comments, copy, commit messages, log strings — no mixed-language strings.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justification comment.
- No `!` non-null assertions (Biome bans them — the pre-commit gate runs Biome).
- The CI gate is `pnpm typecheck` (covers tests). Run `pnpm typecheck` AND `pnpm --filter @chatsundere/user-client test` (Vitest) / `bun test` (llm-unified) yourself before each commit; Turbo caches typecheck, so use `pnpm typecheck --force` if a prior task touched only tests.
- Every package-public function carries at least a one-line JSDoc.
- Commit messages: free-form imperative, capitalised subject. Co-author trailer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Do NOT append `[skip ci]` (these are code commits).
- **Subagents never merge, push, or switch branches.** Commit on the current branch only.
- The expected Vitest baseline failures are the 8 Node-localStorage environmental failures — a 9th new failure is real. `AudioSink` is not testable under jsdom; do not attempt to test it — cover behaviour via the pure helpers and the manual-verification steps.

**Spec:** `superpowers/specs/2026-06-17-tts-highpass-and-inner-monologue-design.md`

---

## PHASE A — High-Pass Cleanup

### Task 1: `defaultHighpassHz` offering metadata

**Files:**
- Modify: `packages/llm-unified/src/catalogue/types.ts` (`TtsOfferingMeta`, ~line 83)
- Modify: `packages/llm-unified/src/catalogue/schema.ts` (the TTS-meta valibot object)
- Modify: `packages/llm-unified/src/providers/xai.ts` (`TTS_META`)
- Modify: `packages/llm-unified/src/providers/nano-gpt.ts` (`GROK_TTS_META`)
- Test: `packages/llm-unified/src/registry.test.ts` (create if absent, else append)

**Interfaces:**
- Produces: `TtsOfferingMeta.defaultHighpassHz?: 50 | 100` — the recommended cleanup cut-off when the user setting is "Auto". xAI offerings set `50`; all others leave it `undefined`.

- [ ] **Step 1: Write the failing test**

In `packages/llm-unified/src/registry.test.ts`, append (or create the file with the standard imports):

```ts
import { describe, expect, test } from 'bun:test';
import { listTtsOfferings } from './registry.js';

describe('defaultHighpassHz cleanup recommendation', () => {
  test('xAI TTS offerings recommend a 50 Hz high-pass (bass-heavy)', () => {
    const xai = listTtsOfferings().filter((o) => o.upstreamSlug.includes('tts') && o.providerId === 'xai');
    expect(xai.length).toBeGreaterThan(0);
    for (const o of xai) expect(o.tts?.defaultHighpassHz).toBe(50);
  });

  test('the nano-gpt Grok TTS offering also recommends 50 Hz', () => {
    const grok = listTtsOfferings().find((o) => o.providerId === 'nano-gpt' && o.upstreamSlug.includes('tts'));
    expect(grok?.tts?.defaultHighpassHz).toBe(50);
  });

  test('non-xAI TTS offerings leave the recommendation undefined', () => {
    const mistral = listTtsOfferings().find((o) => o.providerId === 'mistral');
    expect(mistral?.tts?.defaultHighpassHz).toBeUndefined();
  });
});
```

Check the exact export name in `registry.ts` (the file uses `listProviders().flatMap(p => p.offerings.filter(o => o.serviceKind === 'tts'))`). If no `listTtsOfferings` export exists, add one:

```ts
/** Every registered offering whose serviceKind is 'tts'. */
export function listTtsOfferings(): Offering[] {
  return listProviders().flatMap((p) => p.offerings.filter((o) => o.serviceKind === 'tts'));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/registry.test.ts`
Expected: FAIL — `defaultHighpassHz` is `undefined` for xAI (field does not exist yet).

- [ ] **Step 3: Add the field to the type**

In `types.ts`, inside `interface TtsOfferingMeta` (after `voices`):

```ts
  /**
   * Recommended high-pass cut-off (Hz) for the "Auto" cleanup setting. Bass-heavy
   * providers — xAI TTS pushes notable energy below ~80 Hz — set 50 so users can
   * raise the volume without the low end dominating. Providers needing no cleanup
   * leave this undefined (Auto then resolves to off). See the 2026-06-17 audio spec.
   */
  defaultHighpassHz?: 50 | 100;
```

- [ ] **Step 4: Add the field to the valibot schema**

In `schema.ts`, find the object validating TTS meta (it validates `displayName`, `teal`, `contentModerated`, `transport`, `voices`). Add:

```ts
  defaultHighpassHz: v.optional(v.picklist([50, 100])),
```

- [ ] **Step 5: Set the recommendation on the xAI offerings**

In `providers/xai.ts`, in the `TTS_META` object, add `defaultHighpassHz: 50,`.
In `providers/nano-gpt.ts`, in the `GROK_TTS_META` object, add `defaultHighpassHz: 50,`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/registry.test.ts`
Expected: PASS (all three).
Then: `pnpm typecheck --force`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-unified/src/catalogue/types.ts packages/llm-unified/src/catalogue/schema.ts packages/llm-unified/src/providers/xai.ts packages/llm-unified/src/providers/nano-gpt.ts packages/llm-unified/src/registry.ts packages/llm-unified/src/registry.test.ts
git commit -m "Add defaultHighpassHz cleanup recommendation to TTS offering meta

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Filter-profile types + `resolveCleanupProfile`

**Files:**
- Create: `apps/user-client/src/lib/voice/voice-filter.ts`
- Test: `apps/user-client/src/lib/voice/voice-filter.test.ts`

**Interfaces:**
- Produces:
  - `type VoiceFilterProfile = { kind: 'plain' } | { kind: 'highpass'; hz: 50 | 100 } | { kind: 'monologue' }`
  - `type TtsHighpassSetting = 'auto' | 'off' | 50 | 100`
  - `resolveCleanupProfile(setting: TtsHighpassSetting, recommendation: 50 | 100 | undefined): VoiceFilterProfile` — pure.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { resolveCleanupProfile } from './voice-filter.js';

describe('resolveCleanupProfile', () => {
  it("auto with a recommendation uses the recommended cut-off", () => {
    expect(resolveCleanupProfile('auto', 50)).toEqual({ kind: 'highpass', hz: 50 });
    expect(resolveCleanupProfile('auto', 100)).toEqual({ kind: 'highpass', hz: 100 });
  });

  it("auto with no recommendation is plain (no filtering)", () => {
    expect(resolveCleanupProfile('auto', undefined)).toEqual({ kind: 'plain' });
  });

  it("off is always plain regardless of recommendation", () => {
    expect(resolveCleanupProfile('off', 50)).toEqual({ kind: 'plain' });
    expect(resolveCleanupProfile('off', undefined)).toEqual({ kind: 'plain' });
  });

  it("an explicit Hz value overrides the recommendation", () => {
    expect(resolveCleanupProfile(100, 50)).toEqual({ kind: 'highpass', hz: 100 });
    expect(resolveCleanupProfile(50, undefined)).toEqual({ kind: 'highpass', hz: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test voice-filter`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`apps/user-client/src/lib/voice/voice-filter.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** The node chain AudioSink builds downstream of the source for one playback. */
export type VoiceFilterProfile =
  | { kind: 'plain' }
  | { kind: 'highpass'; hz: 50 | 100 }
  | { kind: 'monologue' };

/** The global cleanup-filter setting. 'auto' follows the offering recommendation. */
export type TtsHighpassSetting = 'auto' | 'off' | 50 | 100;

/**
 * Resolve the cleanup filter profile from the user setting and the active
 * offering's recommendation. 'auto' adopts the recommendation (or plain when
 * none), 'off' is always plain, and an explicit Hz value always wins. Pure.
 */
export function resolveCleanupProfile(
  setting: TtsHighpassSetting,
  recommendation: 50 | 100 | undefined,
): VoiceFilterProfile {
  if (setting === 'off') return { kind: 'plain' };
  if (setting === 'auto') {
    return recommendation ? { kind: 'highpass', hz: recommendation } : { kind: 'plain' };
  }
  return { kind: 'highpass', hz: setting };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test voice-filter`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/voice-filter.ts apps/user-client/src/lib/voice/voice-filter.test.ts
git commit -m "Add voice filter profile types and cleanup-profile resolver

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: `ttsHighpass` setting — schema, migration, seed

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (`SettingsRow`, the seed object ~line 953, a new `this.version(26)` block)

**Interfaces:**
- Produces: `SettingsRow.ttsHighpass: TtsHighpassSetting` (imported from `../lib/voice/voice-filter.js`), default `'auto'`.

- [ ] **Step 1: Add the field to `SettingsRow`**

In `client-data-db.ts`, add the import near the other type imports at the top:

```ts
import type { TtsHighpassSetting } from '../lib/voice/voice-filter.js';
```

In `interface SettingsRow`, after the spectrum fields (after `spectrumBarCount`):

```ts
  /** TTS cleanup high-pass: 'auto' follows the offering recommendation, 'off'
   *  disables it, 50/100 force a fixed cut-off (behaviour-axis — global). */
  ttsHighpass: TtsHighpassSetting;
```

- [ ] **Step 2: Add the seed default**

In the settings seed object (the one setting `spectrumEnabled: true, spectrumStyle: 'soft'`, ~line 953), add:

```ts
        ttsHighpass: 'auto',
```

- [ ] **Step 3: Add the Dexie v26 migration**

After the `this.version(25)…` block, add:

```ts
    // Version 26 — TTS high-pass cleanup. Settings gain `ttsHighpass`
    // (behaviour-axis, global), defaulting to the 'auto' recommendation.
    this.version(26).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Partial<SettingsRow>) => {
          if (
            s.ttsHighpass !== 'auto' &&
            s.ttsHighpass !== 'off' &&
            s.ttsHighpass !== 50 &&
            s.ttsHighpass !== 100
          )
            s.ttsHighpass = 'auto';
        });
    });
```

(The `settings` table has no indexed fields changing, so no `.stores()` clause is needed — match the pattern of v22/v24 which are `.upgrade()`-only.)

- [ ] **Step 4: Verify the build**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: only the 8 known Node-localStorage baseline failures, no new failures.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts
git commit -m "Add ttsHighpass setting with Dexie v26 migration and seed default

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: `AudioSink` filter-profile plumbing (plain + highpass)

**Files:**
- Modify: `apps/user-client/src/lib/voice/audio-sink.ts`
- Modify: `apps/user-client/src/lib/voice/use-voice-playback.ts` (the two `sink.play` call sites, lines 107 & 117)

**Interfaces:**
- Consumes: `VoiceFilterProfile` from `voice-filter.js` (Task 2).
- Produces: `AudioSink.play(blob: Blob, opts: { profile: VoiceFilterProfile; signal?: AbortSignal }): Promise<void>` — the signal moves into `opts`.

This task changes the signature and keeps behaviour identical (both call sites pass `{ profile: { kind: 'plain' } }`); Task 5 swaps in the resolved cleanup profile. The `monologue` branch of the chain builder is added in Task 9 — here it falls through to plain so the type is exhaustive without the reverb wiring yet.

- [ ] **Step 1: Add the chain builder and update `play`**

In `audio-sink.ts`, add the import:

```ts
import type { VoiceFilterProfile } from './voice-filter.js';
```

Add a private field for the per-play filter nodes and a builder, and rewrite `play`. Replace the `play(blob, signal)` method and add `buildChain`:

```ts
  /** Filter nodes created for the current play, disconnected on stop/replace. */
  private chain: AudioNode[] = [];

  /**
   * Build the profile's node chain between the source and the analyser. Returns
   * the node the source connects INTO. Created nodes are tracked on `this.chain`
   * so stop()/dispose() can disconnect them. The 'monologue' branch is wired in
   * a later task; until then it behaves as plain.
   */
  private buildChain(ctx: AudioContext, profile: VoiceFilterProfile, sink: AudioNode): AudioNode {
    this.chain = [];
    if (profile.kind === 'highpass') {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = profile.hz;
      hp.Q.value = 0.707; // Butterworth — gentle 12 dB/octave, not steep
      hp.connect(sink);
      this.chain.push(hp);
      return hp;
    }
    // 'plain' (and 'monologue' until Task 9): no intermediate nodes.
    return sink;
  }
```

Update the `play` method signature and body (the `signal` now lives in `opts`):

```ts
  async play(blob: Blob, opts: { profile: VoiceFilterProfile; signal?: AbortSignal }): Promise<void> {
    const { profile, signal } = opts;
    this.stop();
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (signal?.aborted) return;
    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const sink: AudioNode = this.analyser ?? ctx.destination;
      source.connect(this.buildChain(ctx, profile, sink));

      const abortHandler = () => {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // already stopped
        }
        if (this.source === source) this.source = null;
        resolve();
      };

      source.onended = () => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        if (this.source === source) this.source = null;
        resolve();
      };

      this.source = source;
      signal?.addEventListener('abort', abortHandler, { once: true });
      source.start();
    });
  }
```

In `stop()`, disconnect the chain nodes after stopping the source — add at the end of the `if (this.source)` block (or just before `this.source = null`):

```ts
    for (const node of this.chain) node.disconnect();
    this.chain = [];
```

- [ ] **Step 2: Update the two call sites in `use-voice-playback.ts`**

Line ~107: `await sink.play(blob, signal);` → `await sink.play(blob, { profile: { kind: 'plain' }, signal });`
Line ~117: `await sink.play(fresh, signal);` → `await sink.play(fresh, { profile: { kind: 'plain' }, signal });`

- [ ] **Step 3: Verify the build**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: 8 baseline failures only.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/lib/voice/audio-sink.ts apps/user-client/src/lib/voice/use-voice-playback.ts
git commit -m "Thread filter profiles through AudioSink playback (plain + highpass)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Resolve and apply the cleanup profile at play time

**Files:**
- Modify: `apps/user-client/src/lib/voice/resolve-tts.ts` (`TtsResolution`, `resolveTts` return)
- Modify: `apps/user-client/src/lib/voice/use-voice-playback.ts` (a setting ref + the `play` closure)

**Interfaces:**
- Consumes: `resolveCleanupProfile` (Task 2), `TtsResolution.defaultHighpassHz`, `settings.data.ttsHighpass` (Task 3).
- Produces: `TtsResolution` (ok branch) gains `defaultHighpassHz: 50 | 100 | undefined`.

- [ ] **Step 1: Expose the recommendation from `resolveTts`**

In `resolve-tts.ts`, add to the `ok: true` branch of `TtsResolution`:

```ts
      /** The active offering's cleanup high-pass recommendation, for the 'auto' setting. */
      defaultHighpassHz: 50 | 100 | undefined;
```

In the `resolveTts` return (the `return { ok: true, fetchAudio, voiceLabel, cacheKeyFor };` at the end), add the field — `ttsMeta` is already destructured in scope:

```ts
  return { ok: true, fetchAudio, voiceLabel, cacheKeyFor, defaultHighpassHz: ttsMeta.defaultHighpassHz };
```

- [ ] **Step 2: Read the setting through a ref and apply it in `use-voice-playback.ts`**

Add the import:

```ts
import { resolveCleanupProfile, type TtsHighpassSetting } from './voice-filter.js';
```

After `const settings = useSettings();` and the `sinkRef`/`resolutionRef` declarations, add a ref that mirrors the current setting (so the `deps`-built-once `play` closure reads a live value, never a stale capture):

```ts
  // The play closure is built once (useMemo []), so it must read the cleanup
  // setting through a ref rather than capturing it. Updated every render.
  const cleanupSettingRef = useRef<TtsHighpassSetting>('auto');
  cleanupSettingRef.current = settings.data?.ttsHighpass ?? 'auto';
```

In the `play` closure (inside the `useMemo`), compute the profile from the setting ref + the active resolution's recommendation, and pass it to both `sink.play` calls:

```ts
    const play = async (blob: Blob, segment: SpeechSegment, signal: AbortSignal): Promise<void> => {
      const sink = sinkRef.current;
      if (!sink) throw new Error('voice: play after dispose');
      const profile = resolveCleanupProfile(
        cleanupSettingRef.current,
        resolutionRef.current?.defaultHighpassHz,
      );
      try {
        await sink.play(blob, { profile, signal });
      } catch {
        const resolution = resolutionRef.current;
        if (!resolution) throw new Error('voice: decode-retry with no active resolution');
        await cacheDelete(resolution.cacheKeyFor(segment));
        const fresh = await resolution.fetchAudio(segment, signal);
        await sink.play(fresh, { profile, signal });
      }
    };
```

- [ ] **Step 3: Verify the build**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: 8 baseline failures only.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/lib/voice/resolve-tts.ts apps/user-client/src/lib/voice/use-voice-playback.ts
git commit -m "Apply the resolved cleanup high-pass to read-aloud playback

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: The cleanup control in `VoiceSection`

**Files:**
- Modify: `apps/user-client/src/components/voice/VoiceSection.tsx`

**Interfaces:**
- Consumes: `settings.ttsHighpass` (Task 3), `useUpdateSettings` (existing).

- [ ] **Step 1: Add the control block**

In `VoiceSection.tsx`, read the value near the other settings reads (after `const spectrumBarCount = …`):

```ts
  const ttsHighpass = settings?.ttsHighpass ?? 'auto';
```

Add a new section after the "Read-aloud voice slot" `</div>` and before the "Dictation" section. The `ModeOption` component already exists in this file; reuse it. Note `ModeOption.onSelect` passes no argument, so each option calls `update.mutate` directly:

```tsx
      {/* ── Voice cleanup (high-pass) ───────────────────────────────────────── */}
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-widest text-paper-soft">
          Voice cleanup
        </div>
        <div className="flex flex-col gap-2">
          <ModeOption
            id="hp-auto"
            label="Auto"
            description="Cleans up bass-heavy voices automatically (recommended)"
            selected={ttsHighpass === 'auto'}
            onSelect={() => update.mutate({ ttsHighpass: 'auto' })}
          />
          <ModeOption
            id="hp-off"
            label="Off"
            description="No filtering"
            selected={ttsHighpass === 'off'}
            onSelect={() => update.mutate({ ttsHighpass: 'off' })}
          />
          <ModeOption
            id="hp-50"
            label="50 Hz"
            description="Gentle low-end trim"
            selected={ttsHighpass === 50}
            onSelect={() => update.mutate({ ttsHighpass: 50 })}
          />
          <ModeOption
            id="hp-100"
            label="100 Hz"
            description="Stronger low-end trim"
            selected={ttsHighpass === 100}
            onSelect={() => update.mutate({ ttsHighpass: 100 })}
          />
        </div>
      </div>
```

- [ ] **Step 2: Verify the build**

Run: `pnpm typecheck --force`
Expected: PASS.

- [ ] **Step 3: Manual verification (Chris, on device)**

- My Settings → Voice shows the new "Voice cleanup" control with Auto selected by default.
- With an xAI TTS voice, read a message aloud at Auto — confirm the 50 Hz cut is engaged and the low end no longer dominates when volume is raised.
- Toggle Off / 50 / 100 — confirm audible, gentle differences, no thin/steep artefacts.
- Switch to a non-xAI TTS offering at Auto — confirm no filtering.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/voice/VoiceSection.tsx
git commit -m "Add the voice cleanup high-pass control to My Settings

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## PHASE B — Inner-Monologue Easter Egg

### Task 7: Monologue text — plain-text + chunking pure functions

**Files:**
- Create: `apps/user-client/src/lib/voice/monologue-text.ts`
- Test: `apps/user-client/src/lib/voice/monologue-text.test.ts`

**Interfaces:**
- Produces:
  - `toPlainMonologueText(trace: string): string` — strip Markdown emphasis/code/heading markers, collapse whitespace.
  - `chunkForSynthesis(text: string, maxLen?: number): string[]` — split on sentence/paragraph boundaries into chunks ≤ `maxLen` (default 600); never splits mid-word; drops empty chunks.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { chunkForSynthesis, toPlainMonologueText } from './monologue-text.js';

describe('toPlainMonologueText', () => {
  it('strips common Markdown markers', () => {
    expect(toPlainMonologueText('I should **really** check `foo` and *bar*')).toBe(
      'I should really check foo and bar',
    );
  });
  it('collapses whitespace and trims', () => {
    expect(toPlainMonologueText('  hmm\n\n  let me   think  ')).toBe('hmm let me think');
  });
  it('drops heading hashes and list bullets', () => {
    expect(toPlainMonologueText('# Plan\n- first\n- second')).toBe('Plan first second');
  });
});

describe('chunkForSynthesis', () => {
  it('returns a single chunk when under the limit', () => {
    expect(chunkForSynthesis('one two three', 600)).toEqual(['one two three']);
  });
  it('splits on sentence boundaries when over the limit', () => {
    const a = `${'a'.repeat(400)}.`;
    const b = `${'b'.repeat(400)}.`;
    expect(chunkForSynthesis(`${a} ${b}`, 600)).toEqual([a, b]);
  });
  it('drops empty input to an empty array', () => {
    expect(chunkForSynthesis('   ', 600)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test monologue-text`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reduce a raw chain-of-thought trace to plain prose for synthesis. Strips the
 * Markdown emphasis/code/heading/list markers a reasoning model commonly emits
 * (traces carry no TEAL expression markup, so no passthrough concern) and
 * collapses whitespace. Deliberately light-touch — not a full Markdown parser.
 */
export function toPlainMonologueText(trace: string): string {
  return trace
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s*[-*+]\s+/gm, '') // list bullets
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split text into synthesis-sized chunks (≤ maxLen), breaking on sentence
 * boundaries where possible and never mid-word. Empty/whitespace input yields [].
 */
export function chunkForSynthesis(text: string, maxLen = 600): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];

  // Split into sentences, keeping the terminator, then greedily pack.
  const sentences = trimmed.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (current && current.length + 1 + s.length > maxLen) {
      chunks.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
    // A single sentence longer than maxLen is hard-split on spaces.
    while (current.length > maxLen) {
      const cut = current.lastIndexOf(' ', maxLen);
      const at = cut > 0 ? cut : maxLen;
      chunks.push(current.slice(0, at).trim());
      current = current.slice(at).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test monologue-text`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/monologue-text.ts apps/user-client/src/lib/voice/monologue-text.test.ts
git commit -m "Add monologue text plain-text and chunking helpers

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 8: Procedural reverb impulse response

**Files:**
- Create: `apps/user-client/src/lib/voice/monologue-reverb.ts`
- Test: `apps/user-client/src/lib/voice/monologue-reverb.test.ts`

**Interfaces:**
- Produces:
  - `fillImpulseChannel(out: Float32Array, sampleRate: number, decay: number, seed: number): void` — pure; fills `out` with exponentially-decaying noise. `seed` makes the two stereo channels differ deterministically (no `Math.random`, which is banned in some contexts and non-deterministic for tests).
  - `buildMonologueImpulse(ctx: BaseAudioContext, durationS?: number, decay?: number): AudioBuffer` — thin wrapper creating a stereo buffer and filling both channels (untestable in jsdom; covered by manual verification).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { fillImpulseChannel } from './monologue-reverb.js';

describe('fillImpulseChannel', () => {
  it('fills the whole buffer and stays within [-1, 1]', () => {
    const out = new Float32Array(48_000);
    fillImpulseChannel(out, 48_000, 2.5, 1);
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it('decays — late energy is far below early energy', () => {
    const out = new Float32Array(48_000);
    fillImpulseChannel(out, 48_000, 2.5, 1);
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) {
        const x = out[i] ?? 0;
        sum += x * x;
      }
      return Math.sqrt(sum / (to - from));
    };
    expect(rms(36_000, 48_000)).toBeLessThan(rms(0, 12_000) * 0.5);
  });

  it('is deterministic for a given seed', () => {
    const a = new Float32Array(1_000);
    const b = new Float32Array(1_000);
    fillImpulseChannel(a, 48_000, 2.5, 7);
    fillImpulseChannel(b, 48_000, 2.5, 7);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test monologue-reverb`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A diffuse reverb tail is, at heart, thousands of overlapping reflections —
 * mathematically close to exponentially-decaying noise. We synthesise the
 * impulse response rather than ship a measured one: for the inner monologue's
 * deliberately "no real room" character this is more fitting than any real hall.
 */

/** Deterministic [-1, 1) noise from an integer state (mulberry32-style). Pure. */
function nextNoise(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = ((t ^ (t >>> 14)) >>> 0) / 0xffffffff; // [0, 1]
  return { value: u * 2 - 1, state: t | 0 };
}

/**
 * Fill `out` with exponentially-decaying noise: out[i] = noise * (1 - i/N)^decay.
 * `seed` selects the deterministic noise sequence so stereo channels differ.
 */
export function fillImpulseChannel(
  out: Float32Array,
  _sampleRate: number,
  decay: number,
  seed: number,
): void {
  const n = out.length;
  let state = seed | 0;
  for (let i = 0; i < n; i++) {
    const step = nextNoise(state);
    state = step.state;
    const envelope = (1 - i / n) ** decay;
    out[i] = step.value * envelope;
  }
}

/**
 * Build a stereo procedural impulse response for the monologue convolver.
 * `durationS` is the tail length; `decay` shapes the envelope steepness.
 */
export function buildMonologueImpulse(
  ctx: BaseAudioContext,
  durationS = 2.2,
  decay = 2.5,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationS));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  fillImpulseChannel(buffer.getChannelData(0), sampleRate, decay, 1);
  fillImpulseChannel(buffer.getChannelData(1), sampleRate, decay, 2);
  return buffer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test monologue-reverb`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/monologue-reverb.ts apps/user-client/src/lib/voice/monologue-reverb.test.ts
git commit -m "Add procedural reverb impulse response for the inner monologue

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 9: `AudioSink` monologue profile (reverb + high-pass)

**Files:**
- Modify: `apps/user-client/src/lib/voice/audio-sink.ts` (the `buildChain` method from Task 4)

**Interfaces:**
- Consumes: `buildMonologueImpulse` (Task 8).

The monologue chain: `source → highpass(~280 Hz) → [ dry gain + wet(convolver) gain ] → analyser`. The high-pass thins the low end toward airy/distant; the convolver adds the ethereal tail; dry/wet ≈ 50/50. All created nodes go on `this.chain` so `stop()` disconnects them.

- [ ] **Step 1: Add the monologue branch to `buildChain`**

In `audio-sink.ts`, add the import:

```ts
import { buildMonologueImpulse } from './monologue-reverb.js';
```

Replace the `buildChain` method's fall-through so `monologue` builds its chain (keep the `highpass` branch from Task 4 above it):

```ts
  private buildChain(ctx: AudioContext, profile: VoiceFilterProfile, sink: AudioNode): AudioNode {
    this.chain = [];
    if (profile.kind === 'highpass') {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = profile.hz;
      hp.Q.value = 0.707;
      hp.connect(sink);
      this.chain.push(hp);
      return hp;
    }
    if (profile.kind === 'monologue') {
      // Ethereal / otherworldly: thin the low end, then split into a dry path and
      // a reverberant wet path summed back together (~50/50). Starting values —
      // device-tuned afterwards (see the 2026-06-17 audio spec §4.5).
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 280;
      hp.Q.value = 0.7;

      const dry = ctx.createGain();
      dry.gain.value = 0.5;

      const wet = ctx.createGain();
      wet.gain.value = 0.5;

      const convolver = ctx.createConvolver();
      convolver.buffer = buildMonologueImpulse(ctx);

      hp.connect(dry);
      dry.connect(sink);
      hp.connect(convolver);
      convolver.connect(wet);
      wet.connect(sink);

      this.chain.push(hp, dry, wet, convolver);
      return hp;
    }
    return sink; // 'plain'
  }
```

- [ ] **Step 2: Verify the build**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: 8 baseline failures only.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/voice/audio-sink.ts
git commit -m "Build the inner-monologue reverb chain in AudioSink

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 10: `useMonologuePlayback` hook

**Files:**
- Create: `apps/user-client/src/lib/voice/use-monologue-playback.ts`

**Interfaces:**
- Consumes: `resolveTts` (Task 5), `toPlainMonologueText` + `chunkForSynthesis` (Task 7), `AudioSink` (Task 9), `SpeechSegment` (existing).
- Produces:
  ```ts
  interface MonologuePlayback {
    /** Read the given trace with the monologue effect. `id` keys which pill is active. */
    read: (id: string, trace: string) => Promise<void>;
    stop: () => void;
    /** The id currently playing, or null. */
    activeId: string | null;
    /** Why read() would fail right now (UI hint): 'no-voice' when no TTS offering/voice resolves. */
    disabledReason: 'no-voice' | null;
  }
  function useMonologuePlayback(persona: PersonaRow | null, onStart?: () => void): MonologuePlayback
  ```

The hook owns its OWN `AudioSink` (isolation from the voice machine). `read` resolves the persona's TTS pipeline, reduces the trace to plain text, chunks it, and plays each chunk sequentially through the monologue profile. `onStart` fires before the first chunk plays (the chat page uses it to stop read-aloud — §4.4 mutual exclusion). Synthetic `SpeechSegment`s reuse `resolution.fetchAudio` (cache + in-flight dedup for free).

- [ ] **Step 1: Write the hook**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PersonaRow } from '../../boot/client-data-db.js';
import { AudioSink } from './audio-sink.js';
import { chunkForSynthesis, toPlainMonologueText } from './monologue-text.js';
import { resolveTts } from './resolve-tts.js';
import type { SpeechSegment } from './segmentation.js';

export interface MonologuePlayback {
  read: (id: string, trace: string) => Promise<void>;
  stop: () => void;
  activeId: string | null;
  disabledReason: 'no-voice' | null;
}

/** A synthetic segment for one monologue chunk — reuses the TTS fetch/cache path. */
function chunkSegment(index: number, text: string): SpeechSegment {
  return {
    segmentId: `monologue:${index}`,
    spokenText: text,
    paragraphIndex: index,
    ordinalInParagraph: 0,
    voice: 'dialogue', // resolves to persona.voice (not the narrator voice)
  };
}

/**
 * Isolated playback for the inner-monologue easter egg. Owns its own AudioSink
 * (never the voice machine's), so reading a chain-of-thought never perturbs
 * read-aloud / live-voice sequencing. `onStart` fires before the first chunk so
 * the caller can enforce one-voice-at-a-time (stop read-aloud).
 */
export function useMonologuePlayback(
  persona: PersonaRow | null,
  onStart?: () => void,
): MonologuePlayback {
  const sinkRef = useRef<AudioSink | null>(null);
  if (sinkRef.current === null) sinkRef.current = new AudioSink();
  const abortRef = useRef<AbortController | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [disabledReason, setDisabledReason] = useState<'no-voice' | null>(null);

  // Dispose the sink and abort any play on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void sinkRef.current?.dispose();
      sinkRef.current = null;
    };
  }, []);

  // Disabled hint: probe whether a TTS pipeline resolves for this persona.
  // biome-ignore lint/correctness/useExhaustiveDependencies: probe reads only persona's TTS fields
  useEffect(() => {
    if (!persona) {
      setDisabledReason('no-voice');
      return;
    }
    let cancelled = false;
    resolveTts(persona)
      .then((r) => {
        if (!cancelled) setDisabledReason(r.ok ? null : 'no-voice');
      })
      .catch(() => {
        if (!cancelled) setDisabledReason('no-voice');
      });
    return () => {
      cancelled = true;
    };
  }, [persona?.id, persona?.voice, persona?.narratorVoice]);

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    sinkRef.current?.stop();
    setActiveId(null);
  }, []);

  const read = useCallback(
    async (id: string, trace: string): Promise<void> => {
      if (!persona) return;
      // Re-tapping the playing pill stops it (toggle).
      if (abortRef.current && activeId === id) {
        stop();
        return;
      }
      stop(); // stop any other monologue first
      onStart?.(); // §4.4: caller stops read-aloud — one voice at a time

      const chunks = chunkForSynthesis(toPlainMonologueText(trace));
      if (chunks.length === 0) return;

      const resolution = await resolveTts(persona);
      if (!resolution.ok) {
        setDisabledReason('no-voice');
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setActiveId(id);
      const sink = sinkRef.current;
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (controller.signal.aborted || !sink) break;
          const segment = chunkSegment(i, chunks[i] ?? '');
          const blob = await resolution.fetchAudio(segment, controller.signal);
          if (controller.signal.aborted) break;
          await sink.play(blob, { profile: { kind: 'monologue' }, signal: controller.signal });
        }
      } catch {
        // Synthesis/decode failure or abort — fail quiet for an easter egg.
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setActiveId(null);
        }
      }
    },
    [persona, activeId, onStart, stop],
  );

  return { read, stop, activeId, disabledReason };
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: 8 baseline failures only.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/voice/use-monologue-playback.ts
git commit -m "Add isolated useMonologuePlayback hook for the inner monologue

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 11: Wire the button — ReasoningPill, prop threading, hosting & mutual exclusion

**Files:**
- Modify: `apps/user-client/src/components/chat/ReasoningPill.tsx`
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx` (the `ReasoningPill` render at line 508, and the component/render-helper props)
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx` (the component that renders `MessageBlock` — thread the prop through)
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx` (host the hook, wire mutual exclusion, pass to `<ChatStream>` at line 581)

**Interfaces:**
- Consumes: `MonologuePlayback` (Task 10), the existing `voice` (`useVoicePlayback`, line 458, for `voice.stop()`), and `isLiveVoice` (line 458 — the live-voice-active boolean already in `chat-page.tsx`).

The hook is hosted at the chat-page level (one AudioSink for the view). It is wired so starting a monologue stops read-aloud (`onStart` → `voice.stop()`), and the button is disabled during live-voice mode (`isLiveVoice`) and while the reasoning group is still streaming. A small controller object is threaded `chat-page → ChatStream → MessageBlock → ReasoningPill`. Confirm `message.id` (or the in-scope message-id identifier) is available in the MessageBlock groups-render helper — it renders `ReasoningPill` inside a `groups.map((group, idx) => …)`; `idx` is the group index used for `monologueId`.

- [ ] **Step 1: Define the controller prop and render the button in `ReasoningPill`**

In `ReasoningPill.tsx`, export a single-sourced controller type, extend the props, and render a button in the open body. Add above the props interface:

```ts
/** Inner-monologue read controller threaded from the chat page. */
export interface MonologueController {
  read: (id: string, trace: string) => void;
  activeId: string | null;
  disabledReason: 'no-voice' | null;
  /** Set when reading is suppressed by mode (live voice) — button renders disabled with that reason. */
  suppressedReason: 'live-voice' | null;
}
```

Add to `ReasoningPillProps`:

```ts
  /** Stable id for this reasoning group (e.g. `${messageId}:${groupIdx}`). */
  monologueId: string;
  /** Inner-monologue read controller, or null when unavailable. */
  monologue: MonologueController | null;
```

In the open branch (after the `<section>` that renders `p.text`), add the button. It is rendered whenever the pill is open (positional quietness, not interaction-gated — Laura SOFT-1), present-but-disabled while streaming (Laura SOFT-3), and disabled-with-remedy-tooltip when no voice/suppressed (Laura SOFT-2):

```tsx
  const m = p.monologue;
  const streaming = p.isLive || p.isStreamingDraft;
  const disabledReason: string | null = m === null
    ? 'Inner monologue is unavailable here.'
    : m.suppressedReason === 'live-voice'
      ? 'Not during live voice.'
      : streaming
        ? 'Available once the thought is complete.'
        : m.disabledReason === 'no-voice'
          ? 'Add a read-aloud voice in My Settings → Voice to hear this.'
          : null;
  const isPlaying = m?.activeId === p.monologueId;
```

Render inside `reasoning-pill-open`, after the `<section>`:

```tsx
        <button
          type="button"
          className="reasoning-pill-monologue"
          data-playing={isPlaying ? 'true' : 'false'}
          disabled={disabledReason !== null}
          title={disabledReason ?? (isPlaying ? 'Stop' : 'Read this thought aloud')}
          aria-label={isPlaying ? 'Stop inner monologue' : 'Read this thought aloud'}
          onClick={(e) => {
            e.stopPropagation();
            if (disabledReason === null && m) m.read(p.monologueId, p.text);
          }}
        >
          {/* simple speaker/headphones glyph — present, visible affordance */}
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2 5 H4 L7 2 V12 L4 9 H2 Z M10 4 Q12 7 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
```

Add a minimal style for `.reasoning-pill-monologue` near the existing reasoning-pill styles (wherever `.reasoning-pill-body` is styled — search the user-client CSS for `reasoning-pill-body`):

```css
.reasoning-pill-monologue {
  position: absolute;
  top: 0.35rem;
  right: 0.35rem;
  display: inline-flex;
  padding: 0.2rem;
  border-radius: 0.3rem;
  color: var(--paper-soft, currentColor);
  opacity: 0.7;
  transition: opacity 120ms ease;
}
.reasoning-pill-monologue:hover:not(:disabled) { opacity: 1; }
.reasoning-pill-monologue:disabled { opacity: 0.3; cursor: not-allowed; }
.reasoning-pill-monologue[data-playing='true'] { opacity: 1; color: var(--paper, currentColor); }
.reasoning-pill-open { position: relative; }
```

(If `.reasoning-pill-open` already has a `position`, do not duplicate it.)

- [ ] **Step 2: Thread the props through `MessageBlock`**

In `MessageBlock.tsx`, the component must receive the `monologue` controller and the message id. Add to its props interface a `monologue` field of the same type as `ReasoningPill`'s, then pass it at the `ReasoningPill` render (~line 508) along with a stable id:

```tsx
        <ReasoningPill
          // …existing props (text, isLive, isStreamingDraft, mindspace, font)…
          monologueId={`${message.id}:${idx}`}
          monologue={props.monologue}
        />
```

(Use whatever the in-scope message-id and group-index identifiers are named — `message.id` and the `idx` from the groups `.map`. Confirm by reading the surrounding code.)

- [ ] **Step 3: Host the hook and wire mutual exclusion in `chat-page.tsx`**

Below the `const voice = useVoicePlayback(...)` line (458), add the monologue hook. `onStart` stops read-aloud; the controller carries `suppressedReason: 'live-voice'` while `isLiveVoice` is true (the button then renders disabled, not absent — disabled-over-hidden). Use the `effectivePersona` already passed to `useVoicePlayback`:

```tsx
  const monologue = useMonologuePlayback(effectivePersona, () => voice.stop());
  const monologueController = {
    read: (id: string, trace: string) => void monologue.read(id, trace),
    activeId: monologue.activeId,
    disabledReason: monologue.disabledReason,
    suppressedReason: isLiveVoice ? ('live-voice' as const) : null,
  };
```

Stop the monologue when live voice starts (so the two never overlap) — add an effect near the other live-voice effects:

```tsx
  useEffect(() => {
    if (isLiveVoice) monologue.stop();
  }, [isLiveVoice, monologue.stop]);
```

Pass `monologue={monologueController}` to `<ChatStream …>` (line 581).

- [ ] **Step 3b: Thread the prop `ChatStream → MessageBlock`**

In `ChatStream.tsx`, add a `monologue` prop of the controller type and forward it to each `<MessageBlock … monologue={monologue} />`. In `MessageBlock.tsx`, add `monologue` to its props and pass it into the groups-render helper (or read it from the component scope if the helper is an inline closure), then to `<ReasoningPill … monologue={monologue} monologueId={\`${message.id}:${idx}\`} />`. Define the controller type once (e.g. export `MonologueController` from `ReasoningPill.tsx`) and import it in both `MessageBlock` and `ChatStream` rather than re-declaring the shape, to keep the type single-sourced.

- [ ] **Step 4: Verify the build**

Run: `pnpm typecheck --force`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: 8 baseline failures only.

- [ ] **Step 5: Manual verification (Chris, on device)**

Run the full §7 list from the spec, in particular:
- Open a CoT pill on a reasoning model, tap the button → ethereal reverb + high-pass, "in-head / otherworldly", not telephone-thin.
- With read-aloud playing, tap the button → read-aloud stops (one voice).
- Enter live voice → button disabled with "Not during live voice."
- No TTS offering → button disabled with the remedy tooltip.
- Open a pill mid-stream → button present-but-disabled, enables in place on completion.
- Re-tap the playing button → it stops (toggle).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/ReasoningPill.tsx apps/user-client/src/components/chat/MessageBlock.tsx apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Wire the inner-monologue read button with mutual exclusion

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

(Include any intermediate component file — e.g. `ChatStream.tsx` — touched while threading the prop.)

---

## Self-Review Notes

- **Spec coverage:** §2 filter profiles → Tasks 2/4/9. §3 cleanup (setting, offering meta, resolution, DSP, scope) → Tasks 1/2/3/4/5/6. §4 monologue (trigger/placement, never-automatic, isolation, mutual exclusion, effect chain, synthesis) → Tasks 7/8/9/10/11. §4.1 Laura SOFT-1/2/3 affordance details → Task 11 Step 1. §3.1 Laura SOFT-4 labels → Task 6. §5 out-of-scope respected (no presence boost, no per-persona override, no configurable monologue, no shipped IR, no walking-glow). §6 testing → pure-function tests in Tasks 1/2/7/8. §7 manual verification → Tasks 6 & 11.
- **Type consistency:** `VoiceFilterProfile` / `TtsHighpassSetting` defined in Task 2, consumed identically in Tasks 3/4/5/9/10. `resolveCleanupProfile(setting, recommendation)` signature stable across Tasks 2 & 5. `defaultHighpassHz: 50 | 100 | undefined` consistent across Tasks 1/5. `AudioSink.play(blob, { profile, signal })` consistent across Tasks 4/5/9/10.
- **Audit gate:** Phase A/B are user-client + llm-unified only — no `auth/sync/proxy/crypto`. No Larissa. Laura's spec-pass already folded into the spec; a light pre-squash Laura pass on the built monologue button (Task 11) is the lead's call before squashing.
- **Squash:** these are pre-public `master` commits; the eventual squash unit is one feature — Chris/Liz squashes, subagents do not.
