# Client Block 1 — Chat Foundation — design spec

**Date:** 2026-05-23 (initial); extended same day evening for Phase 2 after Lyra's Settings + Circle + Persona-Editor wireframes landed.
**Status:** Phase 1 implemented; Phase 2 spec extended (Decisions 17–28, § 5 surface architecture); Phase-2 plan + implementation are the next steps.
**Implements:** the "middle slice" of the client-only / standalone-mode work described in [`obsidian/STATUS-CLIENT-ONLY.md`](../../obsidian/STATUS-CLIENT-ONLY.md). Realises the chat-side of [`UX-CONCEPT.md`](../../UX-CONCEPT.md) (Reading + Interaction Mode, Cockpit, Topbar, Entrance Hall, Mindspaces, System-Prompt-Composition, three configured upstream providers) along with the persistence, crypto, and provider-integration backbone the client owns.
**Visual ground truth:** [`chatsundere-prototype.html`](../../chatsundere-prototype.html) (Lyra's interactive wireframe — 2026-05-23 update covers Reading + Interaction + Entrance Hall + Settings + My Circle + Persona Editor; My History wireframe still pending). Where it differs from `UX-CONCEPT.md` the wireframe wins, with two exceptions (§ 2 Decision 6).
**Reference (read-only):** `../chatsune/backend/modules/providers/_registry.py` for the Provider-Registry pattern we port to TypeScript.
**Lead:** Liz, with Chris in walk-through mode; Lyra produces the remaining wireframe (My History) in parallel.
**Out of scope:** Tools execution (data model only), Knowledge Bases, Integrations (sidecar, homelab), Voice (Block 4), Memory system, Compact & Continue, Incognito chats, My Projects, My Treasury, Bookmarks UI (data model only). Sync / proxy / homelab live in [`STATUS-BACKEND.md`](../../obsidian/STATUS-BACKEND.md).

---

## 1. Purpose

Chatsundere has a working auth-service, a paired user-client, an admin-client, and a cross-device-identity surface that is server-side complete. The user-client currently lands authenticated users at `apps/user-client/src/routes/app-shell.tsx` — a `BreathingOrb` placeholder reading *"Your space is ready. Chat, personas, and sync will arrive in upcoming phases."*

This spec replaces that placeholder with a full chat-capable client that runs **standalone** — no server contact required after first launch. The user picks one of three pre-bundled upstream providers (nano-gpt, Novita AI, Ollama Cloud), configures their own API key, composes one or more personas in *My Circle*, and converses through the Reading / Interaction Mode flow Lyra has specified in the wireframe.

The Block-1 deliverable is intentionally *demoable but not feature-complete*: it covers what makes Chatsundere feel like Chatsundere (personas, mindspaces, the sacred bottom edge, the system-prompt composition, the persona-coloured stream) without committing to the larger systems (memory, compaction, tools, treasury, projects) those features depend on.

The deliverable also doubles as the surface that the Discord-recruited neurodivergent-accessibility consultants will review — so polish on the chat surfaces is a Block-1 outcome, not a "we will fix this in v0.2" promise.

---

## 2. Decisions captured during brainstorm

1. **Middle slice, not full UX-CONCEPT.** Block 1 ships *My Circle*, *My Settings*, *My History* (list visible), the chat (Reading + Interaction Mode), the Entrance Hall, and a working Mindspace engine with the two-layer resolution (persona > user-default — no project layer in Block 1). It deliberately ships **without** Treasury, Projects, Memory, Compact & Continue, Incognito, Bookmarks UI, tool execution, KB, voice, and homelab integrations. Stub data models are added for Pills and bookmarks because the chat stream needs them present-but-mostly-empty.

2. **One spec, sequenced in phases.** Block 1 is a single design document covering backbone + surfaces + cross-cutting concerns, with a phased implementation plan (Phase 1–4 below). Sub-specs would risk assumption-collisions between data model and UI; one spec keeps the architecture coherent.

3. **Backbone (Phase 1) is wireframe-unblocked and starts immediately.** UI surfaces are gated on Lyra's wireframes per surface. The Reading Mode + Interaction Mode + Entrance Hall wireframe (`chatsundere-prototype.html`) is in; Settings / Circle / History wireframes are pending. Phase 1 work proceeds in parallel.

4. **Provider scope: one adapter shape, three pre-registered providers, registry-pattern.** Block 1 ships a single adapter for the OpenAI-Chat-Completions wire shape, with three built-in `ProviderDefinition` entries (nano-gpt, Novita AI, Ollama Cloud). Anthropic-direct waits until later (and will then go via OpenRouter with cache-breakpoint support, per Chris). The registry pattern is ported from `../chatsune/backend/modules/providers/_registry.py`, TS-ified.

5. **CORS routing is orthogonal to adapter shape.** A provider's adapter speaks OpenAI-chat-completions; its **transport** is either `direct` or `via-cors-proxy`. The cors-proxy is the generic forwarder at `../cors-proxy` (deployed at `cors-proxy.tidesson.net`), with the shared-secret model documented in its README. Each `ProviderDefinition` carries a `corsHint` (`direct` / `inofficial` / `requires-proxy`) but the user's instance routing is per-`ProviderRow` and stored separately from the template.

6. **Wireframe is visual truth for Block 1, with two exceptions.** Where `chatsundere-prototype.html` and `UX-CONCEPT.md` disagree, the wireframe wins (Cockpit two-row layout, Dim-Overlay on input focus, Live-Mode placeholder button reserved for Block 4 voice work). The two exceptions where UX-CONCEPT wins: (a) Bookmarks remain nested under My History (the wireframe's separate Bookmarks tile was an accidental sixth room); (b) the 5-rooms count of UX-CONCEPT.md.

7. **Secrets-only encryption-at-rest, MasterKey-based.** Block 1 encrypts only the secret fields — `ProviderRow.apiKey` and `Settings.corsProxy.sharedKey` — using the existing `packages/crypto` MasterKey. Messages, personas, settings, chats remain plaintext-at-rest in IndexedDB. Rationale: Block 1 is client-only with no sync requirement; IndexedDB is origin-bound; encrypting messages adds eight-figure write-cost overhead and complicates search/filter for zero security gain in the standalone-mode threat model. Sync-aware encryption is a Phase-1 concern, tracked in `STATUS-BACKEND.md`.

8. **Dexie for a separate user-data DB.** IndexedDB wrapped by Dexie.js. Block 1 user-data lives in a Dexie-managed database named `chatsundere_client_data`, distinct from the existing crypto-managed raw-IDB database `chatsundere` (both origin-bound but separated to keep the cross-package boundary clean). Crypto continues to own its schema and versioning untouched; Block 1's schema lives in `apps/user-client/src/boot/client-data-db.ts`. Dexie's declarative `.version(N).stores({...})` form drives migrations; a `.upgrade()` callback on v1 seeds the three built-in mindspaces and the settings singleton.

9. **Onboarding gating is a Phase-1-internal task, not a separate sprint.** The current `/onboarding` intent matrix has four cells (per [`2026-05-22-user-client-onboarding-overhaul-design.md`](2026-05-22-user-client-onboarding-overhaul-design.md)). Block 1 disables three of them — *I have an invitation*, *Add this device*, *Use a recovery key* — keeping only *Just this device* (local-only) interactive. Disabled tiles render greyed with a tooltip "Coming soon — Block 2+". Hidden is wrong here (UX-CONCEPT § 11 "Disabled over Hidden"); the user must see that the capabilities exist.

10. **Mindspace palette: Aurum locked from wireframe, two more provisional.** The wireframe provides exact hex values for the Aurum mindspace. Block 1 ships Aurum (locked) plus two provisional sister mindspaces — *Azuro* and *Verdan*, derived from the wireframe's `--periwinkle` (#7c9ede) and `--sage` (#74c69d) semantic accents — to demonstrate the resolution-priority engine. The full 7-mindspace palette + final texture set remain open questions for Lyra (see § 9).

11. **System-Prompt Composition is a pure module with stub slots.** A pure functional `composeSystemPrompt(layers)` lives in `packages/llm-unified/src/composition.ts`. Layer order is fixed per UX-CONCEPT § "System Prompt Composition": Global Unlocker → About-Me → Persona-Instructions → Project-Instructions → Memory-Context. Block 1 always passes empty strings for Project-Instructions and Memory-Context — the slots exist so Block-2+ can wire them in without changing the composition contract. Composition is fully unit-tested.

12. **Streaming uses native SSE parsing.** No `eventsource-parser` dependency unless the hand-written parser misses an edge case. Abort via standard `AbortController`. Network errors trigger a single retry; permanent failures surface as a "stream broken" footer on the in-flight message with a retry-from-here button (Phase 3 polish).

13. **Per-chat resolved Mindspace is snapshot at chat creation.** Changing a persona's mindspace later does *not* retroactively re-style old chats. Rationale: the user's memory of "that mindspace was the colour of the conversation about X" should be stable. New chats with the persona pick up the new mindspace.

14. **History-list filters: only "all" + free-text search for Block 1.** UX-CONCEPT lists four filters (all / with-bookmarks / bookmarks-only / search). Block 1 ships "all" + search; "with-bookmarks" and "bookmarks-only" are deferred because the Bookmarks UI itself is deferred (data model present, list UI later). The History tile in the Entrance Hall shows session count.

15. **First-time-user flow: zero providers, zero personas, zero chats — Entrance Hall must guide.** When the user first lands in the Entrance Hall (after local-only onboarding), the Continue-Card slot is hidden; in its place a **Setup-Hints** panel surfaces three sequential "tap to fix" cards: (a) "Add a provider", (b) "Set your Global Unlocker Prompt and About-Me", (c) "Create your first persona". These are the three pre-requisites listed in UX-CONCEPT § "Onboarding". Once the first chat session exists, subsequent launches land directly in Reading Mode of that last chat with the cockpit hidden.

16. **Interaction-Mode auto-close triggers (when not pinned).** Interaction Mode exits automatically on three signals when `isPinned === false`: (a) **Send-tap** with non-empty input, after a brief 100ms delay so the input clears visually first; (b) **Tap anywhere outside the cockpit + topbar** — chat stream, dim-overlay edges, or any non-interactive area; (c) **Input blur combined with the next outside-tap** — blur alone is not enough because mobile keyboards dismiss frequently and a blur-only close would feel twitchy. When `isPinned === true`, none of these triggers close the cockpit; only an explicit Pin-untoggle does. The wireframe currently only implements (a); (b) and (c) are restorations from an earlier wireframe version per Chris.

17. **Seven built-in mindspaces ship in Block 1.** Crimson, Aurum, Verdan, Azuro, Indigaut, Violetta, Rosari — the full palette Lyra finalised in the 2026-05-23 wireframe update. Replaces Decision 10's "Aurum locked + two provisional sister mindspaces". Aurum's hex is still the wireframe ground truth; the other six mindspaces' exact palette values are finalised during Phase-2 implementation against Lyra's swatch (the wireframe carries hex values per swatch class). The rationale for shipping all seven (rather than three) is empirical-feedback-driven: the early-tester pool has a larger appetite for variety than Block 1's minimum demands, and a richer palette is the inexpensive lever to enable that feedback.

18. **Three textures ship functional in Block 1.** Cloudy, Aurora, Grain — Lyra's 2026-05-23 wireframe enumeration. All three are CSS-only with respect for `prefers-reduced-motion` and are user-pickable in the Mindspace-Picker. Replaces Decision 10's "cloudy only".

19. **No explicit animation toggle in Block 1.** `prefers-reduced-motion` is honoured at runtime; `Settings.animationsEnabled` stays in the schema (Phase 1 shipped it) but no UI surfaces a toggle. Re-introduced later if user feedback demands an explicit override beyond the OS-level setting.

20. **Font is a persona property, not a mindspace property.** Even though the Mindspace-Picker visually bundles Color + Texture + Font in a single component (both in Settings → About-Me → Default Mindspace, and in Persona-Editor → Mindspace Override), the data model keeps Font separate. Persona's font lives on `PersonaRow.font` only. Rationale: Font is the visual "voice" of the persona — serif = informal, sans-serif = formal, cursive = dolce vita. Semantic content, not styling. When the user picks "Use user default" for a persona's mindspace override, the font does **not** inherit from the default mindspace; it remains a per-persona choice. (Default for a newly created persona = whatever the user has set as their own display font — see Decision 28.)

21. **My Settings layout: three-card accordion.** My Settings ships as a three-card accordion: **(1) About Me** — about-me textarea + the user's Default-Mindspace-Picker (Color, Texture, user display Font — see Decision 28); **(2) Global System Prompt** — Unlocker textarea only; **(3) Upstream Providers** — list of configured providers + per-provider bottom-sheet editor. Replaces Decision 14's looser "Identity / Providers / CORS / Mindspace-defaults" sectioning. Username is not surfaced (deferred; no use-case in Block 1). Animation toggle is not surfaced (per Decision 19).

22. **Provider editor: auto-probe-on-save, no baseUrl override.** The provider bottom-sheet shows only: API-Key (password input with reveal toggle), and — for providers with `corsHint: 'requires-proxy'` — CORS-Proxy URL + Shared-Key fields directly under the API-Key (mandatory; provider cannot be saved without them). Closing the sheet triggers an automatic probe; the result surfaces inline as a `sheet-status` block. There is no explicit "Test Connection" button. `baseUrl` is fixed by the `ProviderDefinition` template — user cannot override. `ProviderRow.baseUrl` and `ProviderRow.routing` (shipped in Phase 1) become **derived fields**: `baseUrl` always equals `ProviderDefinition.baseUrl`, and `routing.kind` is derived from the template's `corsHint` (`'requires-proxy'` → `'cors-proxy'`, else `'direct'`). The columns remain in the schema for forward compatibility with a future catch-all OpenAI-compatible provider editor, but Phase 2 writes only template-derived values into them. Supersedes the user-editable framing in Decisions 4 and 5.

23. **CORS-Proxy is a global singleton, visually surfaced inside the Ollama-Cloud provider sheet.** `Settings.corsProxy = { url, sharedKey } | null` (shipped in Phase 1) remains the single canonical home for the proxy config. Visually, Lyra's wireframe shows the URL + key fields *inside* the Ollama-Cloud provider sheet (under the API-Key field), because that's where the user first encounters the requirement. When the user fills them there, we write to `Settings.corsProxy` (and any later `requires-proxy` provider sees them pre-filled). Rationale: a typical user has one proxy (Chris's VPS), and re-prompting per-provider would be noise. The Settings accordion does **not** carry a separate CORS-Proxy card — the configuration only ever appears inside a provider sheet that needs it.

24. **My Circle layout: card list + FAB, no detail modal.** Persona cards display Monogram (first two letters of the persona name, rendered in persona colour), Name (in persona colour), and Tagline (new field, see Decision 26). Tap on the card body opens the Persona Editor directly — no intermediate detail modal. A split-action button on each card combines "Chat" (primary action: open the most recent chat with this persona, or start a new one if none) with a dropdown caret that surfaces **New Chat** and **New Incognito Chat** (the latter is a disabled stub in Block 1 — Incognito out of scope). A FAB "+" at the bottom-right of the Circle screen opens an empty Persona Editor for a new persona. Replaces the looser "tap → detail modal with New chat / Edit persona" framing of UX-CONCEPT § "My Circle" and previous Decision 14.

25. **Persona Editor layout: accordion + top-actions + save-bar.** Editor is structured top-down as:
    - **Topbar**: back-button → Circle; centre "Edit Persona" + persona name; right reserved.
    - **Chat-Actions row** (directly under topbar): Continue / New Chat / **Incognito (disabled stub)**.
    - **Accordion sections**:
        - **Identity** (open by default): Name (text input), Tagline (text input).
        - **Custom Instructions**: textarea (the defining persona prompt).
        - **About-Me Override**: textarea with the global About-Me rendered as ghosted placeholder.
        - **Mindspace Override**: Color + Texture + Font picker (same component as Settings, but writes to `PersonaRow.mindspaceId` and `PersonaRow.font`; the picker offers a "Use user default" toggle that clears `mindspaceId` to null — font does *not* inherit and stays whatever the user explicitly selected).
        - **Model**: flat list of all `(provider, model)` pairs across enabled providers, each row showing model name + "via &lt;Provider&gt;"; selecting one writes `PersonaRow.providerId` + `PersonaRow.modelId`. A "Custom model ID" input + "Add" button at the bottom of the list adds a user-typed model under the currently-active provider (re-renders as a normal list option with a "Custom" badge).
        - **Behavior**: Temperature slider (range 0.00–2.00, step 0.05, default 0.85; passed to upstream as `temperature` request param). **Adult-Persona toggle** (boolean; stub for Block-3/4 sanitized-mode filtering — Block 2 stores the value but does not act on it).
    - **Delete-Zone**: red-bordered card with "Delete Persona" button (confirm dialog before commit).
    - **Save-Bar** (sticky to bottom of screen): Cancel + Save Persona buttons; Save persists all accordion sections atomically.

    Replaces Decision 14's looser per-field list.

26. **Three new fields on `PersonaRow`.** `tagline: string` (one-line flair shown in the Circle list; empty allowed), `temperature: number` (0.00–2.00, default 0.85), `adultPersona: boolean` (default false; flag for Block-3/4 sanitized-mode filtering; Block 2 stores but does not act on it). Schema migration strategy lives in the Phase-2 plan; Block 2 may either extend Dexie v1 (if no production data exists at migration time) or land Dexie v2 with an `.upgrade()` callback that backfills defaults on existing rows.

27. **Entrance Hall: five rooms, disabled-stubs for unavailable surfaces, no setup-hints in Block 1.** Hall renders five rooms (Bookmarks is folded into My History per UX-CONCEPT — removing the accidental sixth "My Bookmarks" tile that re-appeared in Lyra's wireframe iteration):
    - **My Circle** — active (count = persona count).
    - **My Projects** — disabled-stub, tooltip "Coming with Block 2+".
    - **My History** — disabled-stub, tooltip "Coming in Phase 4" (wireframe still in flight).
    - **My Treasury** — disabled-stub, tooltip "Coming later".
    - **My Settings** — active (count snippet, e.g. "2 providers connected").

    Disabled-stubs render at 0.4 opacity with `aria-disabled="true"` and a non-interactive tap-state (matches the "Disabled over Hidden" treatment of Decision 9). Continue-Card is hidden in the zero-state (no chats); the Rooms-Grid stays visible. Setup-Hints panel (Decision 15) is deferred — Block 2 ships the Hall without it; the user navigates manually through Settings → Circle to set up. The Hall's mindspace background is the user's `Settings.defaultMindspaceId` resolution (Decision 13 priority engine, no-active-chat branch). Replaces Decision 15.

28. **User has a display Font separate from the Default Mindspace.** `Settings.userFont: 'sans' | 'serif' | 'cursive'` (new column). Used wherever the user's own name renders in the UI: Entrance-Hall greeting, user-message blocks in chat, About-Me-Override-Placeholder-Ghosting, Settings-About-Me-Card preview. Rationale: extends Decision 20's "Font = voice" semantic to the user themselves — the user has a voice too, and the wireframe's Settings Mindspace-Picker shows "Chris" in the chosen font, signalling the user-display-font interpretation. Default = serif (matching the prototype's serif greeting heading). When a new persona is created, its `font` field initialises from `Settings.userFont` (the user's own voice is the natural starting point for a persona they create); the user can change it in the editor.

29. **Texture is a user/persona property, not a mindspace property.** Schema v3 adds `SettingsRow.userTexture: MindspaceTexture` (default `'cloudy'`) and `PersonaRow.textureOverride: MindspaceTexture | null`. `MindspaceRow.texture` survives only as a seed-default for fresh installs; the resolver reads it only when neither user state nor persona-override is set. Texture priority is `persona.textureOverride ?? settings.userTexture ?? mindspace.texture`. Rationale: Chris's Phase-2 device-smoke revealed that the picker's texture choice was clobbered whenever colour changed — because the picker derived `selectedTexture` from `mindspace.texture`, which is a per-mindspace value that varies with the picked colour. Moving texture into user/persona space makes Colour and Texture orthogonal user choices, which matches the mental model expressed in the UI and silences the bug. Migration backfills `userTexture` from the user's default-mindspace.texture and `textureOverride` from null. Supersedes Decisions 10 / 18 only insofar as texture-source-of-truth — the actual texture variants (cloudy, aurora, grain) and the three-variant scope are unchanged.

30. **AutoSizeTextarea for every growable multi-line input.** A small controlled `<textarea>` wrapper (`apps/user-client/src/components/AutoSizeTextarea.tsx`) handles four user surfaces: About Me, Global System Prompt, Custom Instructions, About Me Override. Each instance declares `minRows` and (optionally) `maxRows` so the field starts at a sensible height and caps where unbounded growth would harm usability (Global System Prompt and Custom Instructions cap at 20-30 rows; About Me caps at 20; About Me Override caps at 20). The component is strictly controlled (`value` + `onChange`), so writes fire on every keystroke. If IndexedDB write thrash surfaces in real usage, a small debounce can be added inside each setter wrapper without changing the component's API. Rationale: fixed-height textareas felt cramped on first-touch reviews; growth-with-content removes the noise of an artificially-tiny edit surface.

31. **ProviderSheet uses an explicit Test & Save button; closing via × discards.** Replaces Decision 22's "auto-probe on save (sheet close)" framing — that auto-flow had the side effect of running a probe every time the user closed the sheet for any reason, which was both wasteful and confusing. The new behaviour: closing via × (or clicking the backdrop) discards the in-progress edit; the only way to persist is to click "Test & Save", which seals the API-key, writes the row, probes, and only sets `enabled: true` if the probe succeeds. On success the sheet briefly shows "✓ Key valid" before auto-closing; on failure the sheet stays open with the error visible. The bottom button row also exposes an explicit Cancel mirror of ×. Rationale (Chris's smoke): an Auto-save-on-close that runs network probes is surprising; an explicit Save is the principle-of-least-astonishment path.

32. **Required-field markers (red ✕) at the field and at the accordion header.** Persona Editor's required-field set is `name`, `instructions`, `providerId`, `modelId`. Markers render at both surfaces:
    - **Inline at the field** — Identity's Name input shows a red ✕ next to its label when empty (Identity is outside the accordion, so a header marker is not applicable).
    - **On the accordion header** — Custom Instructions, Model both surface a red ✕ in the closed header when their content is missing, via the new `AccordionCard.requiredMarker?: boolean` prop. The marker has `aria-label={`${label} is required`}`.

    SaveBar's `saveDisabled` mirrors the same set: `!name || !instructions || !providerId || !modelId`. Rationale: feedback discoverability — users should see what is missing at a glance, both before opening an accordion and after.

33. **Persona Editor layout: Identity outside accordion + new section order.** Identity (Name + Tagline) becomes a plain `<section>` at the top of the editor body, always visible. The remaining sections move into accordions in this order: **Custom Instructions → Model → Behavior → Mindspace — Override → About Me — Override**. Rationale: the previous "Identity first inside an accordion" pattern hid the most-edited fields behind a tap; About-Me-Override is the least used and shifts to the bottom. Replaces Decision 25's section sequence; the "Chat-Actions row" (Continue / New Chat / Incognito) and Topbar remain as Decision 25 specified, and the Delete-Zone + Save-Bar at the bottom are unchanged.

34. **Kollision-free monogram algorithm from chatsune.** Persona-card monograms now derive from a five-strategy port of `~/workspace/chatsune/backend/modules/persona/_monogram.py`: multi-part names take first + last initial; single names iterate every letter pair until a kollision-free pair is found; doubled first letter when all pairs are taken; AA…ZZ fallback when no usable letters; `'??'` when every two-letter slot is occupied. Replaces the naïve "first two characters" approach that gave duplicate monograms for any two personas sharing a leading letter. `generateMonogram(name, existing)` returns the kollision-free result; `monogramFor(name)` is a thin wrapper for callers that don't track kollisions (preview-only renderings). The German term-of-art "kollision" survives in the code comments and commit messages as a deliberate marker — anywhere else, British English.

35. **Self-hosted Lora (serif) + Inter (variable sans) typography.** `apps/user-client/public/fonts/` carries `Lora-Regular.woff2` and `Lora-Italic.woff2` (copied from chatsune) plus `Inter-Regular.woff2` (the variable file from upstream `rsms/inter` v4, covering weights 100-900). `src/index.css`'s `@theme` block sets `--font-display: "Lora", Georgia, serif` and `--font-sans: "Inter", system-ui, -apple-system, sans-serif`. No CDN call at runtime. Rationale: Lora has proven typography on chatsune; Inter is a robust mobile-first sans. Self-hosting protects from upstream CDN volatility and from privacy-leaking font-host requests.

---

## 3. High-Level Architecture

The client is organised in six layers, top-down:

```
 UI surfaces       │ React components per surface (Reading, Cockpit, Topbar,
                   │ Entrance Hall, My Settings, My Circle, My History,
                   │ Persona-Editor, Provider-Editor, Mindspace-Picker)
 ──────────────────┼───────────────────────────────────────────────────
 State + queries   │ Zustand stores (session, ui-mode, current-chat,
                   │ mindspace) + TanStack Query (IndexedDB-backed queries
                   │ + mutations)
 ──────────────────┼───────────────────────────────────────────────────
 Persistence       │ Dexie tables (settings, providers, personas, chats,
                   │ messages, pills, mindspaces) + migrations + repository
                   │ functions
 ──────────────────┼───────────────────────────────────────────────────
 Provider          │ packages/llm-unified — registry, ProviderDefinition,
                   │ adapters (openai-chat-completions), composition,
                   │ streaming, probe
 ──────────────────┼───────────────────────────────────────────────────
 Transport         │ direct fetch | via-cors-proxy header rewrite +
                   │ SSE pass-through
 ──────────────────┼───────────────────────────────────────────────────
 Crypto            │ packages/crypto — MasterKey-backed encrypt/decrypt
                   │ of secret fields
```

Cross-cutting:

- **Onboarding gating** lives in `apps/user-client/src/routes/onboarding/intent-matrix.tsx` and is decoupled from the layer stack (it's a routing-level concern).
- **Mindspace engine** is a thin CSS-custom-properties layer that lives next to the UI but is driven by the persistence + state layers.
- **System-prompt composition** is a pure module in `packages/llm-unified` (no React, no IndexedDB).

---

## 4. Phase 1 — Backbone

Wireframe-independent. Starts immediately. Deliverable: an internally testable backbone the rest of Block 1 builds on.

### 4.1 IndexedDB schema (Dexie)

New tables added alongside the existing `local_accounts` table:

```ts
// settings — singleton row, id always = 1
interface SettingsRow {
  id: 1;
  globalUnlockerPrompt: string;       // empty by default
  globalAboutMe: string;              // empty by default
  defaultMindspaceId: string;         // FK to mindspaces
  userFont: 'sans' | 'serif' | 'cursive';  // Phase 2 (Decision 28); default 'serif'
  animationsEnabled: boolean;         // respects prefers-reduced-motion at runtime
  corsProxy: {
    url: string;                      // e.g. 'https://cors-proxy.tidesson.net'
    sharedKey: EncryptedBlob;         // sealed with MasterKey
  } | null;
  createdAt: number;                  // unix ms
  updatedAt: number;
}

// providers — one row per user-configured provider instance
interface ProviderRow {
  id: string;                         // UUIDv7
  templateId: string;                 // FK to ProviderDefinition.id ('nano-gpt' | 'novita' | 'ollama-cloud' | ...)
  displayName: string;                // Phase 2: derived from template; user-overridable in a future block
  baseUrl: string;                    // Phase 2: derived (always = ProviderDefinition.baseUrl); user-overridable in a future block (Decision 22)
  apiKey: EncryptedBlob;              // sealed with MasterKey
  routing: { kind: 'direct' }
         | { kind: 'cors-proxy' };    // Phase 2: derived from ProviderDefinition.corsHint (Decision 22); 'cors-proxy' references Settings.corsProxy
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// mindspaces — palette + texture entries; user-default + persona-overrides
interface MindspaceRow {
  id: string;                         // UUIDv7
  displayName: string;                // 'Crimson', 'Aurum', 'Verdan', 'Azuro', 'Indigaut', 'Violetta', 'Rosari' (Phase 2 ships all seven — Decision 17)
  palette: MindspacePalette;          // see § 6.3
  texture: 'cloudy' | 'aurora' | 'grain';  // Phase 2 ships all three (Decision 18); Phase 1 shipped 'cloudy' only
  builtIn: boolean;                   // true for the seven Block-1 defaults
  createdAt: number;
}

// personas — one entity in My Circle
interface PersonaRow {
  id: string;                         // UUIDv7
  name: string;                       // displayed in persona colour
  tagline: string;                    // Phase 2 (Decision 26); one-line flair shown in Circle list; empty allowed
  colour: string;                     // hex; layered on top of mindspace
  font: 'sans' | 'serif' | 'cursive'; // the persona's voice (Decision 20)
  instructions: string;               // the defining persona text
  providerId: string;                 // FK to providers
  modelId: string;                    // e.g. 'deepseek-v4-flash'
  mindspaceId: string | null;         // override; null = use user default
  aboutMeOverride: string | null;     // null = use global About-Me
  temperature: number;                // Phase 2 (Decision 26); 0.00–2.00; default 0.85; passed to upstream as `temperature` param
  adultPersona: boolean;              // Phase 2 (Decision 26); default false; flag for Block-3/4 sanitized-mode filtering
  createdAt: number;
  updatedAt: number;
}

// chats — one chat session
interface ChatRow {
  id: string;                         // UUIDv7
  personaId: string;                  // FK to personas
  title: string | null;               // null until first user message, then derived
  resolvedMindspaceId: string;        // snapshot at creation; see § 2 Decision 13
  createdAt: number;
  lastMessageAt: number;
  bookmarkedMessageCount: number;     // denormalised counter
  // out-of-Block-1: projectId, compactionState, incognito
}

// messages — one message in a chat
interface MessageRow {
  id: string;                         // UUIDv7
  chatId: string;                     // FK to chats
  role: 'user' | 'persona' | 'system';
  contentBlocks: ContentBlock[];      // see § 6.4
  createdAt: number;
  bookmarked: boolean;
  streamingState: 'complete' | 'incomplete';   // 'incomplete' = stream broke; see § 6.3 partial-stream recovery
  // out-of-Block-1: branchedFromMessageId, compactionId
}

// pills — system events that appear in the stream
interface PillRow {
  id: string;                         // UUIDv7
  messageId: string;                  // FK to messages
  kind: 'tool-call' | 'kb-injection' | 'image-result' | 'voice-expression';
  positionHint: 'inline' | 'above-text';
  status: 'pending' | 'completed' | 'failed';
  payload: unknown;                   // kind-specific; Block 1 renders read-only
  createdAt: number;
}
```

**Indices.** Dexie compound indices:
- `messages.[chatId+createdAt]` (stream ordering)
- `chats.[personaId+lastMessageAt]` (per-persona recency)
- `chats.lastMessageAt` (history list sort)
- `pills.messageId` (pill resolution per message)

**Migrations.** `chatsundere_client_data` v1 declares all seven stores; its `.upgrade()` callback seeds the three built-in mindspaces (Aurum, Azuro, Verdan) and an initial `SettingsRow` with empty strings + Aurum as default. Seeding is gated by an existence check on the singleton settings row so re-running is a no-op. The existing `chatsundere` (crypto-owned) DB is untouched.

### 4.2 `packages/llm-unified`

Currently a stub. Block 1 builds it out.

```
packages/llm-unified/
├── src/
│   ├── index.ts                   // public exports
│   ├── types.ts                   // ProviderDefinition, Capability, ConfigField, etc.
│   ├── registry.ts                // register / get / list / built-ins
│   ├── providers/                 // built-in ProviderDefinition entries
│   │   ├── nano-gpt.ts
│   │   ├── novita.ts
│   │   └── ollama-cloud.ts
│   ├── adapters/
│   │   └── openai-chat-completions.ts
│   ├── transport.ts               // direct vs. via-cors-proxy
│   ├── streaming.ts               // SSE parser, AbortController plumbing
│   ├── composition.ts             // pure System-Prompt-Composition
│   └── probe.ts                   // 'Test Connection'
└── tests/                          // Vitest
```

**`ProviderDefinition` (TS port of Chatsune's pattern):**

```ts
export interface ProviderDefinition {
  id: string;                            // stable id, e.g. 'nano-gpt'
  displayName: string;
  iconKey: string;                       // referenced from a centralised icon map
  baseUrl: string;                       // default upstream
  shape: 'openai-chat-completions';      // Block 1: only one shape
  capabilities: Capability[];
  configFields: ConfigField[];           // schema for the user-facing form
  probe: { path: string; method: 'GET' | 'POST' };
  secretFields: ReadonlySet<string>;
  corsHint: 'direct' | 'inofficial' | 'requires-proxy';
  knownModels: KnownModel[];             // recommended seeds; user can add custom
  sortPriority: number;                  // catalogue order; default 100
}

export type Capability = 'llm' | 'streaming' | 'tools' | 'json-mode' | 'vision';

export interface ConfigField {
  key: string;
  label: string;
  fieldType: 'text' | 'password' | 'url' | 'select';
  secret: boolean;
  required: boolean;
  description: string;
  options?: { value: string; label: string }[];
}

export interface KnownModel {
  id: string;                            // upstream model id, e.g. 'deepseek-v4-flash'
  displayName: string;
  notes?: string;                        // e.g. "Recommended for Block 1 demo"
}
```

**Built-in providers (Block 1):**

```ts
// providers/nano-gpt.ts
registerProvider({
  id: 'nano-gpt',
  displayName: 'nano-gpt',
  iconKey: 'nano-gpt',
  baseUrl: 'https://nano-gpt.com/api/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('nano-gpt API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'inofficial',                // works most of the time
  knownModels: [
    { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', notes: 'Block 1 demo default' },
  ],
  sortPriority: 10,
});

// providers/novita.ts
registerProvider({
  id: 'novita',
  displayName: 'Novita AI',
  iconKey: 'novita',
  baseUrl: 'https://api.novita.ai/v3/openai',     // verify exact path at impl
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('Novita API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'direct',                    // officially supported
  knownModels: [
    { id: 'glm-5.1', displayName: 'GLM 5.1', notes: 'The exotic one' },
  ],
  sortPriority: 20,
});

// providers/ollama-cloud.ts
registerProvider({
  id: 'ollama-cloud',
  displayName: 'Ollama Cloud',
  iconKey: 'ollama',
  baseUrl: 'https://ollama.com/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('Ollama Cloud API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'requires-proxy',            // no CORS headers; cors-proxy required
  knownModels: [
    { id: 'kimi-k2.6', displayName: 'Kimi K2.6', notes: 'Block 1 demo default' },
  ],
  sortPriority: 30,
});
```

The exact `baseUrl` and probe path for each provider is verified against live endpoints during implementation (see § 9 Open Questions).

**Adapter: `openai-chat-completions`.** Pure async-generator that yields `StreamChunk` objects parsed from the SSE stream. Cancels cleanly on `AbortSignal`.

```ts
export async function* streamCompletion(args: {
  provider: ProviderRow;
  decryptedApiKey: string;
  decryptedCorsProxyKey: string | null;
  corsProxyUrl: string | null;
  messages: WireMessage[];           // already composed via composition.ts
  modelId: string;
  signal?: AbortSignal;
}): AsyncIterable<StreamChunk>;
```

**Transport.** A pure builder for the `Request` object:

```ts
export function buildRequest(args: {
  provider: ProviderRow;
  decryptedApiKey: string;
  decryptedCorsProxyKey: string | null;
  corsProxyUrl: string | null;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}): Request;
```

For `routing.kind === 'direct'`: `<baseUrl><path>` with `Authorization: Bearer <apiKey>`.

For `routing.kind === 'cors-proxy'`: `<corsProxyUrl><path>` with headers
- `x-cors-proxy-api-key: <decryptedCorsProxyKey>`
- `x-cors-proxy-target: <baseUrl>`
- `Authorization: Bearer <apiKey>`

per `../cors-proxy/README.md` § "Client usage".

**Streaming.** Hand-written SSE parser over `ReadableStream<Uint8Array>` → `AsyncIterable<StreamChunk>`. Reads `data: ` prefixed lines, handles the OpenAI `data: [DONE]` terminator, parses JSON, yields chunks. AbortController integration uses the standard `signal.addEventListener('abort')` pattern; the reader is released on abort.

**Probe.** A single function `probeProvider(provider, ...): Promise<ProbeResult>` that issues the `ProviderDefinition.probe` request, decodes the response, and returns `{ ok: true; modelCount?: number } | { ok: false; status: number; reason: string }`. Used by My Settings → Provider-Editor → "Test Connection".

### 4.3 Crypto integration

`packages/crypto` already exposes a MasterKey-based seal/open API (used by the auth-service Squash trio). Block 1 adds two thin helpers in `apps/user-client/src/lib/secrets.ts`:

```ts
export async function sealSecret(plaintext: string, mk: MasterKey): Promise<EncryptedBlob>;
export async function openSecret(blob: EncryptedBlob, mk: MasterKey): Promise<string>;
```

`EncryptedBlob` is a typed wrapper (`{ ciphertext: Uint8Array; nonce: Uint8Array; version: 1 }`). Stored in Dexie as a structured-clone-safe value.

Decryption happens at use-time (when an LLM call is about to be made, or when the provider-editor reveals the key on user request). No long-lived decrypted keys in memory.

### 4.4 System-prompt composition

Pure module in `packages/llm-unified/src/composition.ts`:

```ts
export interface CompositionLayers {
  globalUnlocker: string;            // from Settings; empty allowed
  aboutMe: string;                   // global or persona-override; empty allowed
  personaInstructions: string;       // required, non-empty
  projectInstructions: string;       // Block 1: always ''
  memoryContext: string;             // Block 1: always ''
}

export function composeSystemPrompt(layers: CompositionLayers): string;
```

Implementation joins non-empty layers with `\n\n` separators, in the order specified by UX-CONCEPT § "System Prompt Composition". Empty layers are skipped entirely (no leading blank lines). The composed prompt is the `system` role content sent to the upstream. Unit tests cover: all-layers-present, sparse layers, empty about-me, persona-override path, layer ordering, idempotence.

### 4.5 Onboarding gating ("4-Buchstaben-Seite")

The current intent matrix at `apps/user-client/src/routes/onboarding/intent-matrix.tsx` has four cells (per [`2026-05-22-user-client-onboarding-overhaul-design.md`](2026-05-22-user-client-onboarding-overhaul-design.md) § 2 Decision 2). Block 1 modifies the rendering so that three of those cells are disabled:

- **I have an invitation** — disabled, tooltip "Coming with Block 2 server connection"
- **Add this device** — disabled, tooltip "Coming with Block 2 server connection"
- **Use a recovery key** — disabled, tooltip "Coming with Block 2 server connection"
- **Just this device** — interactive, drives into local-only account creation

The disabling is via a `disabled` prop on each cell, not a hidden-render — per UX-CONCEPT § "Disabled over Hidden". Cell visual state for disabled: `opacity: 0.4` plus the existing tooltip surface. Re-enabling when Block 2 lands is a single boolean flip.

---

## 5. Phase 2 — Settings + Circle + Hall

All Phase-2 surfaces have a Lyra wireframe in `chatsundere-prototype.html` (2026-05-23 update). The architecture below is the committed surface design, with deviations from the pre-wireframe spec captured in Decisions 17–28.

### 5.1 Schema additions

Phase 2 extends the Phase-1 Dexie schema. Strategy: if no production data exists at migration time (Chris's device-smoke is still pending at the time the Phase-2 plan is written), extend Dexie v1 in place by adding the new fields with default values during seed; existing builds re-seed cleanly because seeding is gated by an existence check on the singleton settings row. If production data exists, ship Dexie v2 with an `.upgrade()` callback that backfills defaults on existing rows. The Phase-2 plan picks the concrete branch based on the state at plan-write time.

New columns and built-ins (cumulative, regardless of branch):

- `SettingsRow.userFont: 'sans' | 'serif' | 'cursive'` — default `'serif'`.
- `MindspaceRow.texture`: union type extended from `'cloudy'` to `'cloudy' | 'aurora' | 'grain'`.
- `MindspaceRow`: seven built-in rows seeded (Crimson, Aurum, Verdan, Azuro, Indigaut, Violetta, Rosari) — four more than Phase 1's three.
- `PersonaRow.tagline: string` — default `''`.
- `PersonaRow.temperature: number` — default `0.85`.
- `PersonaRow.adultPersona: boolean` — default `false`.

### 5.2 Mindspace engine

The engine sets a fixed set of CSS custom properties at the document root from the resolved `MindspaceRow.palette` for the current context. Resolution priority and palette schema are unchanged from Decision 13; what changes in Phase 2 is the **number of built-in mindspaces** and the **set of available textures**.

```ts
export interface MindspacePalette {
  bg: string;                          // var(--bg-void)
  surfaceBase: string;                 // var(--surface-base)
  surfaceRaised: string;               // var(--surface-raised)
  surfaceInput: string;                // var(--surface-input)
  accent: string;                      // var(--accent) — per-mindspace
  accentSubtle: string;                // var(--accent-subtle)
  accentBorder: string;                // var(--accent-border)
  accentBorderActive: string;          // var(--accent-border-active)
  accentGlow: string;                  // var(--accent-glow)
  text: {
    primary: string;                   // var(--text-primary)
    secondary: string;                 // var(--text-secondary)
    muted: string;                     // var(--text-muted)
    ghost: string;                     // var(--text-ghost)
  };
}
```

**Seven built-in mindspaces.** Seeded on first launch (or backfilled by the schema migration). Hex values for Aurum are locked from the wireframe (`#c9a84c`). The remaining six are sourced from Lyra's swatch CSS classes in `chatsundere-prototype.html` (look for `.swatch-crimson` ... `.swatch-rosari`). The implementation pulls the hex values verbatim; do not approximate. Each mindspace's palette is derived from the accent hex using the same helper Phase 1 ships (`buildMindspace` in `client-data-db.ts`), which composes the `accent*` colours from RGB-tinted opacity layers and the `text.*` colours from a desaturated tint of the accent.

**Three texture renderers.** A single `<MindspaceTexture />` component switches between the three implementations based on the resolved `MindspaceRow.texture` value:

- `cloudy` — Phase 1 implementation, kept intact: two radial-gradient ellipses with `float1` / `float2` keyframes (copied from `mindspace-aurum::before/after` in the wireframe). Animation respects `prefers-reduced-motion` and `Settings.animationsEnabled`.
- `aurora` — soft layered hue-shifting gradient, CSS-only with slow drift. Concrete keyframes implemented from Lyra's `aurora` variant in the wireframe; the variation pattern (slow position drift + soft scale breathing) matches `cloudy` so reduce-motion handling is uniform.
- `grain` — static subtle noise overlay rendered as a small inline-SVG noise pattern set as `background-image` on the mindspace layer. No animation; reduce-motion is naturally a no-op.

**Resolution priority** (unchanged):
1. Active chat → persona's `mindspaceId` if set, else `Settings.defaultMindspaceId`.
2. In a room without an active chat → `Settings.defaultMindspaceId`.
3. Project layer absent in Block 1.

Engine implementation: a `mindspace.store.ts` Zustand store that holds the resolved `MindspacePalette` + texture key, plus a `<MindspaceLayer />` component that mounts at the layout root and writes the palette to `document.documentElement.style.setProperty('--…', …)` whenever the store changes. The store re-evaluates when the current chat / persona / default mindspace changes.

### 5.3 My Settings

Surface at `apps/user-client/src/routes/settings.tsx`. Layout: topbar (back → Hall, context label "Room", context name "My Settings"), then a three-card accordion below. Per-section saves are atomic Dexie transactions (no global submit button; each card commits on collapse or on a section-specific control).

**Accordion card 1: About Me** (icon `◉`).

- **About-Me textarea** — auto-growing; placeholder *"Tell your Circle who you are…"*. Persists to `Settings.globalAboutMe`. Form-help under the field: *"This text is included in every persona's system prompt unless overridden per-persona."*
- **Default Mindspace picker** — composite component that unifies Color + Texture + (user) Font. The picker has a top preview card showing the user's name in the chosen colour + font ("Your space" as tagline), then three rows of choices:
    - **Color** — 7 swatches (Crimson, Aurum, Verdan, Azuro, Indigaut, Violetta, Rosari). Tap to select; selection persists `Settings.defaultMindspaceId` to the matching built-in MindspaceRow.
    - **Texture** — 3 chips (Cloudy, Aurora, Grain). Tap to select; selection updates the *currently-selected* MindspaceRow's `texture` field. We accept that this mutates the built-in row — built-ins are user-mutable in Block 2; a future "reset mindspace" feature in Block 3+ may revisit.
    - **Font** — 3 chips (Sans, Serif, Cursive); selection persists `Settings.userFont` (Decision 28).

**Accordion card 2: Global System Prompt** (icon `⚿`).

- Single auto-growing textarea — the Unlocker prompt. Persists to `Settings.globalUnlockerPrompt`. Form-help: *"This text is prepended to every persona's system prompt. Mainly useful for permissive but cautious open-source models. Always global, no per-persona override."*

**Accordion card 3: Upstream Providers** (icon `⬢`, open by default).

- Header meta line shows *"N of 3 connected"* (live count of `providers WHERE enabled = true`).
- List of three provider rows (one per built-in `ProviderDefinition`). Each row shows monogram (two-letter abbreviation in a coloured tile), display name, status line (`● Connected · Key valid` / `Not connected`), capability badges (`Text` for Block 2; future blocks add `Vision`, `Tools`).
- Tap a row → opens the **Provider Bottom-Sheet** (`provider-sheet`):
    - Header: monogram + provider name + sub-line + close button.
    - **API-Key input** — password-typed `<input>` with reveal-toggle button. Help-text: *"Key is tested automatically when you close this sheet."*
    - **CORS-Proxy fields** (only for providers with `corsHint: 'requires-proxy'`, i.e. Ollama Cloud) — appear directly under the API-Key field as: **Proxy URL** (text input) + **Shared key** (password input with reveal-toggle). Help-text: *"Required for Ollama Cloud. Stored once and reused for any provider that needs a proxy."* Write-through: any value entered here updates `Settings.corsProxy` (the singleton — Decision 23). If `Settings.corsProxy` already has values, the fields are pre-filled.
    - **Status block** (`sheet-status`) — hidden until close. On close, runs the auto-probe (Decision 22) and surfaces `✓ Key valid · N models reachable` (green) or `✗ <status code> · <reason>` (red). Stays visible until the next sheet open. If the probe fails, the provider's `enabled` flag stays false.
    - **Danger zone** — *"Remove this provider"* button. Confirm dialog. Removes the `ProviderRow`. Personas using the removed provider show a red "Provider missing" badge in My Circle until the user re-binds them.

A help-line below the list reads: *"Keys are tested automatically on save. Each provider can be added once. Generic OpenAI-compatible catch-all coming later."*

### 5.4 My Circle

Surface at `apps/user-client/src/routes/circle.tsx`. Layout: topbar (back → Hall, context label "Room", context name "My Circle"), then a vertical list of persona cards, then a floating "+" FAB at the bottom-right.

**Persona card** (`apps/user-client/src/components/persona-card.tsx`):

- Left: **Monogram** — first two letters of the persona name, rendered in the persona's colour against a tinted background derived from the colour.
- Middle: persona name (in persona colour) + tagline (in muted text).
- Right: **Split-action button** — primary "Chat" segment (opens the most recent chat with this persona, or starts a new one if none) + caret segment that opens a small dropdown above the button with two items: **New Chat** (active), **New Incognito Chat** (disabled stub with tooltip *"Coming with Block 3 memory system"*).
- Tap on the card body (outside the split button) → navigate to the Persona Editor for this persona.

**FAB** — round "+" button at bottom-right of the screen. Tap → navigate to the Persona Editor in create mode (blank `PersonaRow` draft). Save persists the new row; Cancel discards.

If a persona's `providerId` references a removed provider, the card shows a small red badge *"Provider missing"* in the right region, and the Chat split-button is disabled (tap shows a tooltip pointing to Settings).

### 5.5 Persona Editor

Surface at `apps/user-client/src/routes/persona-editor.tsx`. Used for both edit (`?id=<personaId>`) and create (no id; draft row).

Layout top-down:

- **Topbar** — back-button → Circle, context label "Edit Persona" (or "New Persona" in create mode), context name = persona name (live-updated as the user types).
- **Chat-Actions row** (only in edit mode, hidden in create mode):
    - **Continue** — opens the most recent chat with this persona, or starts a new one if none.
    - **New Chat** — starts a fresh chat.
    - **Incognito** — disabled stub with tooltip *"Coming with Block 3 memory system"*.
- **Accordion** with six sections:
    - **Identity** (open by default) — Name input + Tagline input. Persists `PersonaRow.name` and `PersonaRow.tagline`. Help under: *"The monogram is derived from the first letters."*
    - **Custom Instructions** — single auto-growing textarea. Persists `PersonaRow.instructions`. Required (cannot save with empty instructions).
    - **About Me — Override** — auto-growing textarea with the global About-Me rendered as ghosted placeholder. Persists `PersonaRow.aboutMeOverride` (null when empty). Help: *"Empty = global About Me is used (shown in gray). Fill in to override for this persona only."*
    - **Mindspace — Override** — same Color + Texture + Font picker component as Settings, but writes to `PersonaRow.mindspaceId` (selected mindspace; nullable via "Use user default" chip in the Color row) + `PersonaRow.font` (always — never inherits, per Decision 20). Preview card at the top of the picker shows the persona name in the chosen colour + font.
    - **Model** — flat list of `(provider, model)` pairs across all enabled providers. Each row shows model name (bold) + "via &lt;Provider&gt;" (muted) + a checkmark when selected. Tap → set `PersonaRow.providerId` + `PersonaRow.modelId`. Below the list: a **Custom Model ID** text input + **Add** button — on Add, the typed model ID is appended as a new row under the currently-selected provider with a "Custom" badge, and the row becomes the selected entry. Custom rows persist into the `PersonaRow.modelId` field (the upstream call uses whatever string is there).
    - **Behavior** — Temperature slider (track + thumb + numeric value display; range 0.00–2.00, step 0.05, default 0.85). Persists `PersonaRow.temperature`. Help under: *"Default 0.85 · range 0.00 – 2.00 in 0.05 steps. Higher = more creative chaos."* Below the slider: a toggle-row labelled **Adult Persona** with help-line *"Hidden when sanitized mode is active. Adult content is governed by the system prompt or custom instructions, not this flag."* Persists `PersonaRow.adultPersona`.
- **Delete-Zone** (only in edit mode) — red-bordered card with **Delete** button. Confirm dialog: *"Delete &lt;persona name&gt;? All chats with this persona will be lost."* On confirm, deletes the `PersonaRow` and cascades by also deleting chats + messages referencing it. Navigates back to Circle.
- **Save-Bar** (sticky to bottom) — **Cancel** (navigates back to Circle, discards unsaved changes) + **Save Persona** (atomic transaction: persists the draft, then navigates back to Circle).

The Save button is disabled when validation fails: empty `name`, empty `instructions`, or no `providerId` selected. In the no-provider case, a tooltip on Save points to Settings; in create mode this is the most common reason a user is blocked.

**New-persona defaults.** When the editor opens in create mode, the draft `PersonaRow` initialises with: `font` = `Settings.userFont`, `colour` = the accent of `Settings.defaultMindspaceId`, `mindspaceId` = null (inherits user default), `temperature` = 0.85, `adultPersona` = false, `aboutMeOverride` = null, `providerId`/`modelId` = first enabled provider's first known model (or empty if no provider is enabled).

### 5.6 Entrance Hall

Surface at `apps/user-client/src/routes/entrance-hall.tsx`, replacing the current `app-shell.tsx` placeholder. Layout per the wireframe:

- **Topbar** — back-button (visible only when at least one chat exists, in which case back → most recent chat in Reading Mode) + context label "Entrance Hall" + right-region reserved.
- **Greeting** — small label *"Welcome back"* + heading `<username>` rendered in `Settings.userFont`.
- **Continue-Card** — gold-tinted card with a subtle glow; shows the most recent chat's persona name + first line of last message. Hidden when no chats exist (zero-state). Tap → opens that chat in Reading Mode.
- **Rooms-Grid** — 2 columns, 5 cards (per Decision 27; the wireframe's sixth "My Bookmarks" tile is dropped — bookmarks live under My History per UX-CONCEPT):
    - **My Circle** — icon `✦`, count *"N personas"*; tap → `/circle`.
    - **My Projects** — disabled-stub, count *"Coming with Block 2+"*; `aria-disabled="true"`, 0.4 opacity, no-op tap.
    - **My History** — disabled-stub, count *"Coming in Phase 4"*; `aria-disabled="true"`, 0.4 opacity, no-op tap.
    - **My Treasury** — disabled-stub, count *"Coming later"*; `aria-disabled="true"`, 0.4 opacity, no-op tap.
    - **My Settings** — icon `⚙`, count snippet *"N providers connected"* (live); tap → `/settings`.

The grid uses CSS `grid-template-columns: 1fr 1fr`. The fifth cell (My Settings) occupies the left half of the third row; the right half stays empty.

The Hall's mindspace background uses the resolved palette from `Settings.defaultMindspaceId` (no-active-chat branch of Decision 13).

No Setup-Hints panel in Block 2 (per Decision 27). The user navigates manually through Settings → Circle to set up.

---

## 6. Phase 3 — Chat

Wireframes complete (`chatsundere-prototype.html`).

### 6.1 Reading Mode

Surface lives at `apps/user-client/src/routes/chat/reading.tsx`. Layout per wireframe:

- No topbar visible
- Stream pane fills the screen
- Bottom affordance (`.affordance` in wireframe) — a thin animated golden bar with `@keyframes glow`
- Date separator between messages from different days (`.date-sep`)
- Compaction-checkpoint stubs render (Block 1 has no compaction, but the data model allows future emission)

**Stream rendering.** Per-message blocks per `MessageRow.contentBlocks`. Each block is either text or a pill reference. Pills are rendered inline via the `<Pill />` component (40% opacity in Reading, full when the message is expanded). Pill positioning (`inline` vs. `above-text`) is honoured at render time.

**Tap-to-expand.** Tapping a message toggles `.expanded`. The expanded state reveals: timestamp above text, controls below text (Branch, Regenerate (only on last persona message), Copy, Bookmark, Read), and the text background highlights (`.msg.expanded .msg-text` per wireframe). Tapping elsewhere collapses any expanded message.

**Sacred bottom edge + auto-follow + pause.** New content during streaming pushes upward from the bottom (the bottom-most pixel of the stream pane is anchored). When the user scrolls up by more than 30px (threshold from wireframe), auto-follow pauses, the affordance fades out, the scroll-to-end button fades in. Reaching the bottom again (manually or via button) re-engages auto-follow.

**Per-message controls actions (Block 1):**
- **Branch** — out-of-scope for Block 1 execution; button visible but disabled with tooltip "Branching arrives later".
- **Regenerate** — re-runs the last persona response. Aborts any in-flight, drops the prior persona message, re-runs the send flow with the same composition.
- **Copy** — copies plain text of the message to the clipboard.
- **Bookmark** — toggles `MessageRow.bookmarked`; chat's `bookmarkedMessageCount` increments/decrements. Block 1 has no cross-chat bookmark list (deferred per § 2 Decision 14); the bookmark state surfaces only as a subtle golden marker on the message itself when set.
- **Read** — out-of-scope (TTS lives in Block 4); button disabled with tooltip.

### 6.2 Interaction Mode

Triggered by tapping the affordance. Per wireframe, this is an overlay state on top of Reading — the stream pane stays in place, dimmed.

**Topbar** (`#interaction-topbar`):
- Left: hamburger button → routes to Entrance Hall
- Centre: `Chat with` (label) + persona name in persona colour
- Right (status group):
  - Journal indicator — sage-coloured pill with pulsing dot + count. **Stubbed in Block 1**: always shows `0` because the memory system is out of scope. Component exists; data binding shows zero.
  - Context-window gauge — golden mini-bar + percentage label. **Live in Block 1**: estimates by counting tokens in the in-memory chat plus composed system prompt, divided by the model's known context window. Token estimation uses a simple character-count heuristic for Block 1 (~4 chars/token); a per-model tokeniser is a follow-up.

**Cockpit** (`#cockpit`):

Row 1 (controls): Plus / Menu / Live-Mode (placeholder, disabled) / spacer / Pin
Row 2 (input + send): textarea (`.cockpit-input`) + dual-action button (mic ↔ send)

- **Plus** — opens unified insertion menu. **In Block 1**: surfaces only "Upload file" (which is a placeholder that lands in `MessageRow.contentBlocks` as a stub block — files are not actually persisted in Block 1 because Treasury is out of scope). All other options (Treasury, Knowledge Base, persona artefact re-insert) are visible but disabled with "Coming later" tooltips.
- **Menu** — opens per-conversation tool menu. **In Block 1**: surfaces only the "Reasoning effort" dropdown (low/medium/high — passed to the upstream as a model-vendor-specific param when supported). Tools toggles are listed but disabled.
- **Live-Mode** (`≈`) — disabled in Block 1; placeholder for Block 4 voice mode.
- **Pin** — toggles `isPinned`. When pinned, the cockpit does not collapse on any of the three auto-close triggers (§ 2 Decision 16).
- **Textarea** — auto-grows up to 160px. Placeholder uses persona name: *"Speak to Aurum…"*.
- **Dual-action button** — mic icon when input is empty, send icon when input has content. **Mic in Block 1**: disabled with tooltip "Voice arrives with Block 4". Send fires the send-flow.

**Dim-Overlay.** When the cockpit input receives focus, the dim overlay activates (`background: rgba(0,0,0,0.55)`). When the input blurs, the dim-overlay fades but Interaction Mode itself does *not* exit on blur alone — exit happens only via the three auto-close triggers in § 2 Decision 16. The chat stream remains visible but de-emphasised throughout.

### 6.3 Streaming integration

```
User types → tap Send →
   1. Insert a user MessageRow into `messages` (status: complete)
   2. Insert a draft persona MessageRow (status: streaming, empty content)
   3. composeSystemPrompt(layers) → systemPrompt
   4. assemble WireMessage[] from the chat's prior messages
   5. streamCompletion({ provider, decryptedKeys, messages, modelId, signal })
   6. for each StreamChunk:
        - append to draft persona message contentBlocks
        - re-render that message live (Zustand store)
        - update token count + context gauge
   7. on stream end:
        - mark draft persona message complete
        - persist final contentBlocks to Dexie
        - update chat.lastMessageAt + chat.title (if first response)
   8. on error/abort:
        - mark draft persona message as failed
        - surface "retry" footer on the message
```

Stream chunks are buffered in memory between persist points to avoid IndexedDB write thrashing. The final persist is one write at stream end.

**Partial-stream recovery.** If the user closes the tab while a stream is in flight, the draft persona message remains in IndexedDB with empty `contentBlocks` and an `incomplete` marker (added to `MessageRow` as `streamingState: 'complete' | 'incomplete'`; default `'complete'`). On next launch, any chat containing an `incomplete` message renders that message with a "stream interrupted" footer and a retry button; the user can either retry the completion (replaces the incomplete) or delete it.

### 6.4 Pills rendering

`<Pill />` component takes a `PillRow`, renders the appropriate icon + label, and respects the Reading/expanded state of its containing message via CSS (`.msg .pill` vs. `.msg.expanded .pill`).

**Content block model** that ties pills into the message stream:

```ts
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pill'; pillId: string };  // FK to PillRow
```

A persona message that invokes a tool produces a stream of text-block / pill-block / text-block / ... — order preserved as the upstream emitted them. The adapter's stream-chunk parser is responsible for recognising tool-call events vs. content tokens (in OpenAI-chat-completions: `delta.content` vs. `delta.tool_calls`). For Block 1, tool-call events produce pills with `status: 'completed'` immediately (no execution) — the pill represents "the persona asked for this tool" as a visible event, without actually running the tool.

**ADR "Tool Display Position"** lands in `obsidian/decisions/` as part of Phase 3, capturing the decision that pill positioning is metadata declared by each registered tool, defaulting to `inline`.

### 6.5 Send-flow integration recap

Bringing all the pieces from § 4.2 + § 4.4 together:

```
PersonaRow + ChatRow → resolve provider + model →
  decrypt ProviderRow.apiKey + Settings.corsProxy.sharedKey →
  composeSystemPrompt({ globalUnlocker, aboutMe, personaInstructions, '', '' }) →
  buildRequest(...) →
  streamCompletion(...) →
  iterate chunks → update draft message + pills →
  persist on end
```

---

## 7. Phase 4 — History + Polish

### 7.1 My History

Surface at `apps/user-client/src/routes/history.tsx`. Layout per UX-CONCEPT § "My History" (no wireframe yet — design will be filled when Lyra delivers).

- List sorted by `lastMessageAt` desc
- Per row: persona name in persona colour, derived title, last-message snippet, relative timestamp, bookmark-count badge
- Search bar (free-text over `chats.title` + `messages.contentBlocks.text`)
- Tap a row → opens the chat in Reading Mode

### 7.2 Setup-Hints in Entrance Hall

Driven by predicate counts on the data model:
- `providers WHERE enabled = true → count = 0` → hint A
- `settings.globalUnlockerPrompt === '' || settings.globalAboutMe === ''` → hint B (only after A is fixed)
- `personas → count = 0` → hint C (only after A + B are fixed)

Once all three are satisfied, the hints panel disappears and the Continue-Card or the Rooms-grid takes the prime slot.

### 7.3 Polish

- Scroll-to-end button — micro-animation on appear/disappear
- Affordance bar — glow timing tuned to feel "breathing", not "snappy" (per UX-CONCEPT § "Cyberpunk Aesthetic")
- Mindspace texture — `aurora-plasma` as a second texture option, finalised once Lyra picks
- Network-loss handling on in-flight streams (retry button surfaces on the broken message)
- Abort handling — `streamCompletion` aborts cleanly on tab close / navigation away
- Edge cases: zero-message persona chat, stream-truncated mid-pill, provider-key invalidated mid-stream

---

## 8. Data Flow

**Sending a message (sequence):**

```
[Cockpit Send tap]
        │
        ▼
[useSendMessage mutation]
        │
        ├── insert userMsg (Dexie)
        ├── insert draftPersonaMsg (Dexie)
        ├── set Zustand store: currentStream = draftPersonaMsg.id
        │
        ▼
[composeSystemPrompt + assemble WireMessage[]]
        │
        ▼
[secrets.openSecret(provider.apiKey, mk)]
[secrets.openSecret(settings.corsProxy.sharedKey, mk) if applicable]
        │
        ▼
[streamCompletion(...) AsyncIterable<StreamChunk>]
        │
        ▼
[for await chunk:]
   ├── append to in-memory store (Zustand)
   ├── recompute token estimate → update gauge
        │
        ▼
[on end:]
   ├── persist final contentBlocks → Dexie messages
   ├── update chat.lastMessageAt
   ├── update chat.title if first response
   ├── clear currentStream
```

**Receiving stream chunks → UI:**

```
streamCompletion → chunk
        │
        ▼
[chat.store.appendChunk(messageId, chunk)]
        │
        ▼
[<Stream /> subscribes to chat.store.messages[messageId]]
        │
        ▼
[<Pill /> subscribes to pill rows for the message]
```

**Persona / Provider / Mindspace edits:**

Standard form → mutation → Dexie write → TanStack Query invalidation → list re-renders.

---

## 9. State Management

Zustand stores:

- `session.store.ts` — already exists. No changes for Block 1.
- `current-chat.store.ts` — new. Holds the active chat id, the in-memory message buffer for the streaming response, the dim-overlay state, the cockpit pin state, the auto-follow state.
- `ui-mode.store.ts` — new. Holds `interactionMode: boolean`, `cockpitOpen: boolean`. Derived selector: `dimOverlayActive`.
- `mindspace.store.ts` — new. Holds the *resolved* palette + texture for the current context, computed by the resolution engine. Re-runs when current chat / persona / default mindspace changes.

TanStack Query:

- `useChats()` — list, sorted by lastMessageAt
- `useChat(id)` — one chat + its messages
- `usePersonas()` — list
- `useProviders()` — list
- `useSettings()` — singleton row

Mutations:
- `useCreateChat`, `useSendMessage`, `useCreatePersona`, `useUpdatePersona`, `useDeletePersona`, `useAddProvider`, `useUpdateProvider`, `useUpdateSettings`

---

## 10. Testing strategy

- **`packages/llm-unified`** — Vitest. Unit tests for: registry register/get/list semantics, composition pure function, transport request builder (direct + cors-proxy variants), streaming parser (synthetic SSE chunks → expected `StreamChunk[]`), probe success + 401 + 5xx cases.
- **`packages/crypto`** — already tested; add sealSecret / openSecret round-trip tests in the user-client suite.
- **Dexie schema** — Vitest with `fake-indexeddb`. Verify migrations run, indices are present, built-in mindspaces seeded.
- **Surfaces (Phase 2–4)** — Vitest component tests for: send-flow happy path (mocked adapter), pin-toggle persistence, dim-overlay focus/blur, tap-to-expand exclusivity, scroll-to-end appearance threshold.
- **Manual verification** (per CLAUDE.md § 10 quality bar) — a "Manual verification" appendix is added at the end of the implementation plan, listing device-tested steps Chris runs himself on his actual phone.

---

## 11. Open questions / external dependencies

- **Provider endpoint verification.** Exact `baseUrl` + probe-path for nano-gpt, Novita, and Ollama Cloud — resolved during Phase 1 implementation against live endpoints (the values shipped in `packages/llm-unified/src/providers/*.ts` are the ground truth).
- **Lyra's wireframe for My History.** Phase 4 starts when this arrives. Settings / Circle / Persona-Editor wireframes landed 2026-05-23.
- **ADR "Tool Display Position".** Lands as part of Phase 3, captured in `obsidian/decisions/`.
- **Provider rate-limits / quotas.** All three providers have rate-limits the client does not yet handle gracefully. Block 1 surfaces upstream 429s as a "rate-limited" footer on the in-flight message; no client-side throttling.
- **Context-window-gauge accuracy.** Block 1 uses a 4-chars-per-token heuristic. A per-model tokeniser (tiktoken, etc.) is a follow-up.
- **Sanitized-mode concept.** `PersonaRow.adultPersona` ships in Phase 2 as a stored boolean with no behaviour. The full sanitized-mode UX (where the toggle lives globally, how it gates persona visibility, how it interacts with built-in personas) is a Block-3/4 design conversation Chris will lead.
- **CORS-proxy distribution.** Out-of-Block-1: how Chris hands out the shared-secret. For now the proxy URL + key are user-entered in the Ollama-Cloud provider sheet (writes through to `Settings.corsProxy`).
- **Built-in mindspace mutability.** Phase 2 lets the user edit a built-in mindspace's `texture` field via the Settings picker (writes to the seeded row). Future blocks may add a "reset to default" affordance; for now we accept that the seeded rows are user-mutable post-seed.
- **Persona-card "Provider missing" badge.** Block 2 ships the badge UI but does not yet support a quick re-bind flow — the user has to open the editor and pick a new model. Re-bind shortcut is a Phase-3-or-later affordance.
- **Bookmark-list UI.** Data model is in (`MessageRow.bookmarked`, `ChatRow.bookmarkedMessageCount`); list rendering deferred per § 2 Decision 14, lives under My History per UX-CONCEPT.

---

## 12. Implementation sequencing

**Default order (Chris's pick at brainstorm):** 1 → 2 → 3 → 4.

- **Phase 1** — landed 2026-05-23 in commit `bc2e6ff` (Backbone: crypto secrets, Dexie client-data DB, onboarding gating, `packages/llm-unified`).
- **Phase 2** — next deliverable; wireframes are in, plan + execution follow immediately.
- **Phase 3** is wireframe-ready (`chatsundere-prototype.html`); follows Phase 2 so the chat surface lands on a configurable backbone, not a hard-coded persona.
- **Phase 4** follows Phase 3 + the History wireframe.

The Phase 2 implementation plan is the immediate next deliverable. It splits Phase 2 into sequenced subagent-friendly chunks per CLAUDE.md § 13 "Subagent preferred" + global preference, with TDD pairing per task and a Manual-Verification appendix for Chris's device-smoke.

---

## 13. Risks

- **Provider endpoint drift.** nano-gpt and Novita are smaller upstreams; their endpoints may change. Mitigation: probe-test is part of every "Add provider" flow; failures surface clearly.
- **CORS-proxy availability.** Ollama-Cloud-via-proxy depends on Chris's VPS being up. Mitigation: clearly differentiate "upstream rejected" vs. "proxy unreachable" in error messages; the user can fall back to nano-gpt or Novita if the proxy is down.
- **Wireframe drift.** UX-CONCEPT.md and the wireframe already disagreed in two places (§ 2 Decision 6). Mitigation: spec treats wireframe as visual truth, deferring concept-level decisions to Lyra + Chris; spec deliberately does *not* lock palette / textures / Bookmarks UI / Treasury — those land later.
- **Local-only data loss.** No sync, no backup. If the user clears site data, all chats + personas + providers vanish. Mitigation: Block 1 does not promise persistence guarantees; the "test deploy" tester pool is informed.

---

## 14. Acceptance criteria

Block 1 is "done" when, starting from a fresh PWA install:

1. The user can complete the local-only onboarding and lands in the Entrance Hall with three Setup-Hint cards.
2. The user can add at least one provider, see "Test Connection" pass, and store the encrypted API key in IndexedDB.
3. The user can set Global Unlocker + Global About-Me + Default Mindspace.
4. The user can create at least two personas with different providers, models, and mindspaces.
5. The user can start a new chat from a persona's detail modal.
6. Reading Mode renders the stream with the persona's mindspace applied; tap-to-expand reveals timestamp + controls + background highlight.
7. The bottom affordance is visible at the sacred bottom; scrolling up reveals scroll-to-end and pauses auto-follow.
8. Tapping the affordance opens Interaction Mode; the cockpit slides up; the input is focused; dim-overlay activates.
9. Typing flips the mic icon to send; sending dispatches a real streamed completion to the chosen upstream; the persona message renders live; the cockpit collapses unless pinned. Tapping the chat stream while a non-pinned cockpit is open also collapses it (§ 2 Decision 16).
10. Pills (synthetic, from tool-call deltas) render at 40 % opacity in Reading and full when the containing message is expanded.
11. Switching to a different persona produces a chat with that persona's mindspace, font, and colour.
12. The Hamburger returns to the Entrance Hall; the Continue-Card slot now shows the most recent chat.
13. My History lists all chats in last-message order and search filters them.
14. Closing the tab and re-opening lands the user back in Reading Mode of the most recent chat.
15. All operations work in airplane mode *except* the actual upstream stream (which fails gracefully with a "stream broken" footer).
