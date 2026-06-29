# Screen Effects & the Integrations subsystem — design spec

- **Status:** Draft for review
- **Date:** 2026-06-29
- **Author:** Liz
- **Scope:** Client-only (`apps/user-client`, `packages/llm-unified`). No backend, no crypto.
- **Implementation:** Deferred — spec and plan now, build later.

---

## 1. Context & motivation

The "emoji shower" was a beloved feature in chatsune (the predecessor). It was built quickly, almost as an easter egg, yet users adore it — Discord feedback repeatedly asks for it back ("Why no emoji showers like in Fox 🥺", "Soren loved the emoticon showers and used them often"). It is not core functionality, but it is a *heart* feature: it makes the companion feel alive and present. We are pulling it forward deliberately for that reason.

This time we do not merely port it. We use it to introduce a first-class, reusable concept: an **Integrations subsystem**. Screen Effects is the first integration; more will follow. The architecture is the durable deliverable; the emoji shower is its first inhabitant.

### What chatsune did (inherited learnings)

- Tag syntax `<screen_effect rising_emojis 💖 🤘 🔥>` (angle brackets, whitespace-split), parsed char-by-char by a streaming `ResponseTagBuffer`, dispatched to `executeTag(integrationId, command, args)`.
- A single effect, `rising_emojis` (1–5 emojis, `Intl.Segmenter` for ZWJ/skin-tone safety), rendered as a monospace **pill** inline plus a brief full-screen overlay.
- Randomisation lived in the **renderer**, not the parser → persisted re-renders look identical to the live stream (idempotent).
- `prefers-reduced-motion` selected a gentler profile, captured **once at trigger time**.
- Effects were fire-and-forget; the inline pill was independent of the overlay; effects carry no prose meaning.

We keep every one of those patterns. We change three things deliberately:

1. **Square-bracket grammar** `[sfx:emoji-shower …]` — because chatsundere already owns a square-bracket inline-marker pipeline (TEAL), and two competing bracket parsers on one stream would collide.
2. **Integration-returned display text**, soft-glowing in the persona's mindspace colour — replacing chatsune's static monospace pill. The integration decides, on the fly, what the in-stream text looks like.
3. **First-class Integrations subsystem** with a tag-prefix registry and shared argument extraction, rather than a one-off feature.

---

## 2. Goals & non-goals

### Goals

- Introduce an **Integrations subsystem**: integrations register a tag prefix and share a common tag-extraction step; each returns inline display text plus an optional side-effect.
- Re-deliver the **emoji shower** as the first integration (`sfx:emoji-shower`).
- Replay the effect during **read-aloud**, not only during live streaming.
- A single global on/off toggle, housed in **My Settings → Voice** alongside the existing presentation toggles (`spectrumEnabled`, etc.).

### Non-goals (now)

- No per-persona configuration of screen effects (see §11 — it is global by nature).
- No second effect beyond `emoji-shower`.
- No backend involvement of any kind (client-only feature).
- No richer argument grammar (`key=value`, quoted strings). Deferred to a future integration that needs it.
- No unification of TEAL into the Integrations subsystem (see §11, Future A).

---

## 3. Architecture overview

### 3.1 Relationship to TEAL (decision B)

chatsundere already has **TEAL** — a closed-vocabulary, char-by-char streaming inline-marker system (`packages/llm-unified/src/teal/*`, consumed in `apps/user-client`). TEAL performs *pure display substitution* with **no side-effects** (`[laugh]` → 😄, `<whisper>…` → CSS class).

An integration is semantically different: it returns *dynamic* display **and** a side-effect (the overlay event). Folding the two natures into one framework (the rejected option A) buys little and risks regressions on the streaming hot-path. So:

> **Decision B:** The Integrations subsystem is a new, independent subsystem. It shares **only** the one existing `[...]` stream detector. When that detector matches a **registered integration prefix** (e.g. `sfx:`), it routes the tag to the Integration registry; otherwise the text flows through TEAL unchanged.

This keeps TEAL untouched, gives integrations a clean home, and avoids a second bracket tokeniser on the same stream.

The detector lives in `teal-streaming.ts` (`INLINE_RX`, the `transformTealStream` state machine). The weiche is a single added branch: after a complete `[...]` token is recognised, test its content for a registered prefix before handing it to `resolveTealInline`.

### 3.2 The Integration interface

```ts
interface Integration {
  /** Registered namespace, e.g. 'sfx'. Unique across integrations. */
  readonly prefix: string;

  /** Reads the relevant toggle. The parsing/registry layer is always live;
   *  `enabled` gates only the side-effect (see §6). */
  enabled(settings: SettingsRow): boolean;

  /**
   * Resolve a matched tag. `command` and `rawArgs` come from the shared
   * extractor (§3.3). Returns the inline display text plus an optional
   * effect trigger, or null when the command is unknown (tag left literal).
   */
  handle(command: string, rawArgs: string, ctx: IntegrationContext): IntegrationResult | null;

  /** Prompt fragment, injected by the composition layer only when `enabled` (see §5). */
  readonly systemPrompt: string;
}

interface IntegrationResult {
  /** Inline text to render, soft-glowing (§4.2). '' renders nothing inline. */
  display: string;
  /** Optional side-effect, dispatched to the overlay (§4.3, §4.4). */
  effect?: EffectTrigger;
}
```

`IntegrationContext` carries what a handler may need that is not in the tag itself (e.g. the resolved mindspace palette for display styling, the reduced-motion flag at trigger time). Kept minimal; grown only when a concrete handler needs more.

### 3.3 Tag grammar & shared argument extraction (decision A)

Grammar:

```
[<prefix>:<command> <rawArgs>]
```

- `prefix` — a registered namespace (`sfx`).
- `command` — a single token (`emoji-shower`).
- `rawArgs` — **everything after the first space until the closing `]`, verbatim**.

The shared extractor returns exactly `{ prefix, command, rawArgs }`. It does **not** tokenise `rawArgs`. Each integration interprets `rawArgs` itself — `emoji-shower` segments it with `Intl.Segmenter`; a future integration may bring its own mini-parser.

Rationale (decision A): the example emojis arrive glued (`🔥🦊💖`, one run, no spaces) and emoji need grapheme segmentation, not whitespace splitting. A heavier shared schema (`key=value`, quotes) would be over-engineering now. The future "special" integration inherited from chatsune is the known consumer that will add structured parsing on top of `rawArgs` — and it is the reason `rawArgs` stays raw rather than being eagerly tokenised.

The prefix registry maps `prefix → Integration`. Registration is static (integrations are first-party, compiled in) — there is no dynamic/user-supplied integration registration in this scope.

---

## 4. Data model & rendering

### 4.1 Canonical text (core principle)

> The **canonical, stored** assistant message text contains the **literal tag** `[sfx:emoji-shower 🔥🦊💖]`. That same literal text is what is sent back to the model as conversation history.

Consequences:

- The model sees its own tags in prior turns → it knows it already showered last turn, and the context has no holes.
- Display is a **pure render-time transform** of the canonical text; never persisted.
- The effect is a **side-effect derivable from the canonical text** → re-playable (read-aloud) and idempotent on re-render.

This mirrors how TEAL already treats `[laugh]`: stored raw, transformed at render. Read-aloud segmentation is already TEAL-neutral (it retains bracket markup verbatim and strips only at synthesis time), so integration tags ride the same neutral path.

### 4.2 Inline display rendering

The integration's `display` string is rendered inline with a **soft glow in the persona's mindspace accent colour** — the same colour source the Spectrum Analyser uses (`palette.accent` from the resolved mindspace; `SpectrumAnalyser.tsx` reads it via the mindspace store). The aesthetic target is the Spectrum Analyser's luminous glow, not a monospace pill.

Mechanism — reuse TEAL's marker-survival machinery, no new render path:

- **Finalised render:** the preprocess step (`preprocess-teal.ts`) emits the `display` text wrapped in PUA sentinels carrying an `sfx-glow` marker; the rehype plugin (`rehype-teal.ts`) turns the marker into a `.sfx-glow` span. The glow colour is applied via a CSS custom property already available on the message container (the mindspace accent), so the span needs no per-render inline colour.
- **Streaming render:** the per-chunk transform (`transformTealStream`, surfaced in `MessageBlock.tsx`) emits the `display` text in a `stream-tok` span carrying the same glow class, so the glow is present live, not only after finalisation.

Both paths render the **same** `display` text with the **same** glow.

### 4.3 The overlay effect

A single global, fire-and-forget overlay component, mounted once high in the app tree (above content, below modals — chatsune used z-index 90; we follow). It listens for `EffectTrigger`s, renders each as a short-lived particle animation, and removes it on completion (with a safety timeout fallback for the case where `animationend` never fires — backgrounded tab, jsdom).

Properties (chatsune parity):

- **Randomisation lives in the renderer**, computed at spawn — start X, horizontal drift, size, start/end rotation, per-particle duration — so whenever a shower *does* play it is fresh, never a frozen snapshot baked into stored data. (A bare re-render/scroll of a persisted message does **not** auto-replay the overlay — that would be effect-spam through history. The overlay fires only from the two trigger sources in §4.4; the persistent visual artefact of a past shower is its inline glow, not a replay.)
- **Reduced motion captured once at trigger time** (`window.matchMedia('(prefers-reduced-motion: reduce)').matches`), passed into the renderer to select the profile. This matches the existing reduced-motion discipline (`SpectrumAnalyser.tsx`, and ~11 other components).

Two profiles:

| Profile | Trigger | Count | Spawn window | Feel |
|---|---|---|---|---|
| `FULL` | default | ~40 | ~2.8 s | the full, joyful shower |
| `REDUCED` | `prefers-reduced-motion` | ~4 | ~1.2 s | a single gentle wisp — "just enough that you saw something happened" |

Profile numbers are starting points, tunable during implementation; the *structure* (two profiles, reduced-motion trigger) is fixed.

### 4.4 Trigger sources (decision B — both now)

The overlay knows only "play effect X now". *Who* asks is an interchangeable **trigger source**; both derive from canonical text:

1. **Live-stream source.** When the streaming detector recognises a complete integration tag (closing `]` seen), and the integration is `enabled`, dispatch its `EffectTrigger`. Fires once, during generation.
2. **Read-aloud source.** Read-aloud segments a stored message into `SpeechSegment`s, each carrying a `charRange` into the canonical text and exposing segment-level progress (`currentSegmentId` / `currentMessageId` via the voice state machine — the same signal the Spectrum Analyser and voice-glow already consume). When the segment whose `charRange` contains an integration tag becomes active, dispatch the effect. Fires when the user plays the message back.

Live (during generation) and replay (user presses Read) are distinct moments → no double-fire. Read-aloud granularity is segment-level (no sub-segment audio timing exists); a tag triggers at the boundary of the segment that contains it. This is the natural analogue of chatsune's `syncWithTts`, at the granularity chatsundere actually exposes.

---

## 5. System prompt segment

A new prompt segment is added to the composition registry (`composition.ts` `SEGMENTS`, Band 1 — behaviour & voice, present in all jobs). It is **gated on the toggle**: injected only when `screenEffectsEnabled` is true.

Rationale (revised after Laura's spec-pass): an earlier draft injected the segment unconditionally, on the theory that read-aloud replay and a possible toggle-back needed the model to always know the capability. That theory does not hold — read-aloud replay reads the **stored canonical text** (which already contains the literal tag, §4.1), *not* the prompt segment; the segment governs only *future generation*. Leaving it always-on meant "off" never stopped the persona producing new showers, contradicting the toggle's own label and leaving the user's "make the showers stop" goal unreachable. So:

> **Off stops new emissions.** When the toggle is off, the segment is omitted, the model is not encouraged to emit tags, and new messages stop accruing shower markers. Tag-parsing and inline rendering remain **always live** (§3.1, §4.2), so historical and imported messages still render their stored tags with no holes.

Wording principles (final copy during implementation, British English):

- Describe the markup `[sfx:emoji-shower 🔥🦊💖]` and the 1–5 emoji rule.
- **Use sparingly** — at most once per response, only when the moment genuinely carries it (a celebration, a flirt, a punchline).
- Effects are **silent** and carry **no prose meaning** — the words still do the talking.

---

## 6. "Off" semantics (four layers)

The toggle gates exactly two layers — future emission and the overlay — while leaving the rendering of already-stored text intact:

| Layer | on | off |
|---|---|---|
| Tag parsing (detector recognises `[sfx:…]`) | live | **stays live** (never disabled) |
| Inline display (`🚿🔥🦊💖🚿`, soft-glow) | shown | **stays shown** — it is message content |
| Screen overlay (the shower) | plays | **suppressed** |
| System-prompt segment (future emission) | injected | **omitted** (§5) — model stops emitting new tags |

"Off" means: **no new showers, and no on-screen motion.** New messages stop accruing shower markers (segment omitted), and no overlay plays. Inline display of *already-stored* tags remains, because it is part of what the persona "said" — suppressing it would punch holes in persisted/imported messages. This is the honest reading of the label "Screen Effects: off".

---

## 7. Settings & UI

### 7.1 The toggle

A global boolean `screenEffectsEnabled` on `SettingsRow` (the singleton settings row, alongside `spectrumEnabled`, `animationsEnabled`, etc.). Read via `useSettings()`, written via `useUpdateSettings()` (the established pattern). Global because the feature is a presentation **behaviour** (behaviour-axis → global), not persona **content** — per-persona control would only nag; the user either wants showers or does not.

### 7.2 Where it is surfaced — My Settings → Voice

The toggle lives at the **bottom of the My Settings → Voice page** (`routes/app/settings/voice.tsx`), directly alongside its sibling presentation toggle `spectrumEnabled`. This is the user's mental-model home for "how the companion looks/behaves on screen" — a user hunting "how do I turn off emoji showers?" reaches for *My Settings*, not the externally-facing *My Integrations* page. It surfaces with the same toggle pattern the Voice section already uses (button + short description), at the same click-depth as the spectrum toggle.

The relevant entrance-hall tile meta gains **"FX"** (e.g. "Voice · FX"), so the capability is discoverable from the hall, not buried.

`screenEffectsEnabled` is global state on `SettingsRow`; only its *surfacing* lives in the Voice page.

> **Note — architecture vs surfacing.** Screen Effects is *architecturally* an integration (it registers a tag prefix in the Integrations subsystem, §3), but its *single on/off control* is surfaced where presentation toggles live, not on the *My Integrations* page. The two are deliberately decoupled: subsystem membership is an implementation fact; the user only ever sees one switch, in the place they expect it. **The *My Integrations* page is not touched by this work.**

---

## 8. The `emoji-shower` integration concretely

- **Tag:** `[sfx:emoji-shower <emoji…>]`, e.g. `[sfx:emoji-shower 🔥🦊💖]`.
- **`handle`:** segments `rawArgs` with `Intl.Segmenter`, keeps emoji graphemes (ZWJ/skin-tone safe), caps at 5 (extra dropped), and:
  - 0 valid emoji → returns `null` (tag left literal — rare, malformed).
  - 1–5 emoji → returns:
    - `display = '🚿' + emoji + '🚿'` → e.g. `🚿🔥🦊💖🚿`. The shower-heads are **indicators only** — a deliberately "in your face" nod to the feature's name.
    - `effect = { kind: 'emoji-shower', emoji: [<the chosen emoji>] }` → the overlay rains **only the chosen emoji** (`🔥🦊💖`), **not** the shower-heads.

---

## 9. Security & privacy

- Entirely client-side. No data crosses the wire; the server is not involved.
- Integrations are **first-party and compiled in** — there is no user-supplied or remote integration registration in this scope, so the registry is not an injection surface (unlike MCP servers, which is exactly why they live under a separate, warning-bannered tab).
- The feature touches no auth, crypto, sync, or proxy code → no Larissa gate. It *does* add a user-reachable flow → **Laura spec-pass** applies and has been done. She raised one hard defect (always-injecting the prompt segment made "off" dishonest) — resolved in §5/§6 by gating the segment on the toggle. Soft notes: placement moved to My Settings → Voice (§7.2); the two notes about *My Integrations* (stale tile meta, trust-banner bleed) are moot now that the page is untouched; remaining soft notes (single-row tab over-structure, 🚿 glyphs) are accepted as deliberate/deferred. A pre-squash Laura pass on the built flow still applies.

---

## 10. Manual verification (device-tested by Chris)

1. With Screen Effects **on**, prompt a persona to celebrate; confirm `[sfx:emoji-shower …]` renders inline as `🚿…🚿` soft-glowing in the mindspace colour, and a shower of the chosen emoji plays over the screen, once.
2. Confirm the stored message, re-opened later, still shows the inline glow — and that scrolling to it does **not** auto-replay the overlay (no effect-spam through history).
3. Press **Read** on that message; confirm the shower replays when read-aloud reaches the tag's segment.
4. Toggle Screen Effects **off** (My Settings → Voice, bottom). Confirm: (a) the same *historical* message still shows its inline glow but plays **no** overlay, on re-render and on Read; (b) new messages no longer contain `[sfx:…]` tags at all (the model is no longer prompted to emit them). Toggle back **on** → new showers return.
5. Enable OS **reduced motion**; trigger a shower — confirm the gentle `REDUCED` profile (a brief wisp), not the full shower.
6. Send `[sfx:emoji-shower]` with no emoji and with >5 emoji; confirm graceful handling (literal tag; capped to 5).
7. Confirm the Voice settings tile/meta shows "FX" and the toggle sits at the bottom of the Voice page; confirm *My Integrations* is **unchanged**.

---

## 11. Future work (recorded, not built)

- **Future A — unify TEAL as the first "expression" integration.** Conceptually appealing (one tag framework); deferred because the gain is small and the regression risk on the streaming hot-path is real. Revisit once the Integrations subsystem has proven itself.
- **The "Built In" tab / Integrations management UI.** An earlier draft surfaced Screen Effects under a new "Built In" tab on *My Integrations* (next to "MCP servers"). Dropped now that the single toggle lives in My Settings → Voice. It returns when the **next** integration ships — that one brings non-trivial UI, at which point the tab structure (external/untrusted MCP vs first-party Built In, mirroring a real trust boundary) earns its keep with actual content rather than a single row.
- **The "special" integration from chatsune.** Inherited later; it is the known consumer that will add a structured mini-parser on top of `rawArgs` (§3.3). It is *why* `rawArgs` stays raw now.
- **Per-persona screen-effects control.** Possible content-axis refinement if ever wanted; explicitly out of scope (§2, §7.1).
- **Sub-segment / word-level read-aloud sync.** Not possible without custom Web Audio instrumentation (no `currentTime` exposed today); segment-level is sufficient.

This spec adds an entry to `obsidian/insights/future-feature-couplings.md`: the read-aloud trigger source couples Screen Effects to the voice/read-aloud subsystem at the segment-event seam.

---

## 12. Rough file map (for the plan)

New (subsystem):
- `packages/llm-unified/src/integrations/*` (or a client-side equivalent) — registry, shared extractor, `Integration` interface, `emoji-shower` integration, prompt segment.
- `apps/user-client/src/components/effects/ScreenEffectsOverlay.tsx` + the emoji-shower renderer.

Touched (docking points found during exploration):
- `…/teal/teal-streaming.ts` — add the registered-prefix weiche to the existing detector.
- `…/teal/preprocess-teal.ts`, `…/teal/rehype-teal.ts` — `sfx-glow` marker survival + `.sfx-glow` span.
- `apps/user-client/src/.../MessageBlock.tsx` — streaming-path glow span; overlay trigger wiring.
- `packages/llm-unified/src/.../composition.ts` — register the always-on prompt segment.
- `apps/user-client/src/boot/client-data-db.ts` — `screenEffectsEnabled` on `SettingsRow`.
- `apps/user-client/src/routes/app/settings/voice.tsx` (and/or the Voice toggle component) — the Screen Effects on/off row at the bottom.
- `apps/user-client/src/routes/app/entrance-hall.tsx` — the Voice settings tile meta gains "FX".
- voice: read-aloud trigger source hooking `currentSegmentId` / `charRange` (`use-voice-playback.ts` / voice state machine).
- app root — mount `ScreenEffectsOverlay`.

*(Not touched: `apps/user-client/src/routes/app/integrations.tsx` — the My Integrations page is untouched by this work; see §7.2 and §11.)*

(Exact paths confirmed against the codebase at plan time.)
