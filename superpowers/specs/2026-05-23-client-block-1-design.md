# Client Block 1 — Chat Foundation — design spec

**Date:** 2026-05-23
**Status:** brainstorm complete, awaiting Chris review before plan
**Implements:** the "middle slice" of the client-only / standalone-mode work described in [`obsidian/STATUS-CLIENT-ONLY.md`](../../obsidian/STATUS-CLIENT-ONLY.md). Realises the chat-side of [`UX-CONCEPT.md`](../../UX-CONCEPT.md) (Reading + Interaction Mode, Cockpit, Topbar, Entrance Hall, Mindspaces, System-Prompt-Composition, three configured upstream providers) along with the persistence, crypto, and provider-integration backbone the client owns.
**Visual ground truth:** [`chatsundere-prototype.html`](../../chatsundere-prototype.html) (Lyra's interactive wireframe). Where it differs from `UX-CONCEPT.md` the wireframe wins, with two exceptions (§ 2 Decision 6).
**Reference (read-only):** `../chatsune/backend/modules/providers/_registry.py` for the Provider-Registry pattern we port to TypeScript.
**Lead:** Liz, with Chris in walk-through mode; Lyra produces the remaining wireframes (Settings, Circle, History) in parallel.
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
  displayName: string;                // user-overridable; template default
  baseUrl: string;                    // user-overridable; template default
  apiKey: EncryptedBlob;              // sealed with MasterKey
  routing: { kind: 'direct' }
         | { kind: 'cors-proxy' };    // 'cors-proxy' references Settings.corsProxy
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// mindspaces — palette + texture entries; user-default + persona-overrides
interface MindspaceRow {
  id: string;                         // UUIDv7
  displayName: string;                // 'Aurum', 'Azuro', 'Verdan', ...
  palette: MindspacePalette;          // see § 6.3
  texture: MindspaceTexture;          // 'cloudy' | 'aurora-plasma' | ... (Block 1: 'cloudy' only)
  builtIn: boolean;                   // true for the three Block-1 defaults
  createdAt: number;
}

// personas — one entity in My Circle
interface PersonaRow {
  id: string;                         // UUIDv7
  name: string;                       // displayed in persona colour
  colour: string;                     // hex; layered on top of mindspace
  font: 'sans' | 'serif' | 'cursive';
  instructions: string;               // the defining persona text
  providerId: string;                 // FK to providers
  modelId: string;                    // e.g. 'deepseek-v4-flash'
  mindspaceId: string | null;         // override; null = use user default
  aboutMeOverride: string | null;     // null = use global About-Me
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

## 5. Phase 2 — Settings + Circle

Gated on Lyra's wireframes for My Settings, My Circle, and Persona-Editor surfaces. The architecture below is committed; the visual treatment will be filled in when wireframes arrive.

### 5.1 My Settings

Sections (collapsible cards within the Settings room):

- **Identity** — username (display-only in Block 1), Global Unlocker Prompt (textarea), Global About-Me (textarea). Per UX-CONCEPT both can be copy-pasted as discrete units.
- **Providers** — list of configured `ProviderRow`s + "Add provider" button. Add flow: pick from the registry (cards listing the three built-ins), fill the `configFields` form, optionally edit `baseUrl`, pick routing (direct / via-cors-proxy), hit "Test Connection" → probe runs → green or red → "Save".
- **CORS Proxy** — single config slot at user level (`Settings.corsProxy`). Optional unless any provider has `corsHint: 'requires-proxy'` selected or routes via proxy. Form fields: proxy URL, shared key (encrypted at save). Validation rule: a `ProviderRow` cannot be saved with `routing.kind === 'cors-proxy'` while `Settings.corsProxy === null`; the Provider-Editor surfaces an inline link to the CORS-Proxy section if so.
- **Mindspace defaults** — picker showing built-in mindspaces (Aurum, Azuro, Verdan); selecting one sets `Settings.defaultMindspaceId`. Animation toggle below it.

Per-section "Save" pattern (no global submit); each save is an atomic Dexie transaction.

### 5.2 My Circle

Surface root shows the persona list:

- Cards per persona: name in persona colour, font preview, model badge (provider + model name), mindspace swatch.
- Tap a card → persona detail modal (per UX-CONCEPT § "My Circle"). Detail modal options: **New chat**, **Edit persona**. New Incognito Chat is omitted in Block 1 (incognito out of scope).
- "+ New persona" CTA.

Persona editor form fields (all from UX-CONCEPT § "Personas"):
- Name
- Colour (palette + custom hex)
- Font (sans / serif / cursive — radio)
- Instructions (textarea, no length limit; placeholder lists Chatsundere persona-spec examples)
- Model selection — two-step: pick provider (dropdown of enabled providers), then pick model (dropdown of `knownModels` + a "Custom model ID" text input)
- Mindspace override (dropdown of mindspaces + "Use user default")
- About-Me override (textarea; placeholder shows the global About-Me as ghosted text, per UX-CONCEPT § "Global 'About Me'")

### 5.3 Mindspace engine

The engine sets a fixed set of CSS custom properties at the document level. The values come from the resolved `MindspaceRow.palette` for the current context (chat / room / global).

```ts
export interface MindspacePalette {
  bg: string;                          // var(--bg-void)
  surfaceBase: string;                 // var(--surface-base)
  surfaceRaised: string;               // var(--surface-raised)
  surfaceInput: string;                // var(--surface-input)
  accent: string;                      // var(--gold) — Aurum
  accentSubtle: string;                // var(--gold-subtle)
  accentBorder: string;                // var(--gold-border)
  accentBorderActive: string;          // var(--gold-border-active)
  accentGlow: string;                  // var(--gold-glow)
  text: {
    primary: string;                   // var(--text-primary)
    secondary: string;                 // var(--text-secondary)
    muted: string;                     // var(--text-muted)
    ghost: string;                     // var(--text-ghost)
  };
}
```

**Resolution priority** (Block 1):
1. Active chat → persona's `mindspaceId` if set, else `Settings.defaultMindspaceId`
2. Inside a room (no active chat) → `Settings.defaultMindspaceId`
3. Project layer absent in Block 1; the priority engine accepts it but always sees `null`

**Texture rendering.** A single Block-1 texture (`cloudy`) is implemented as two radial-gradient ellipses with `float1`/`float2` keyframes, copied directly from the wireframe (`mindspace-aurum::before/after` + `@keyframes float1` / `float2`). The texture component reads palette colours and produces the gradient stops accordingly. Animation respects `prefers-reduced-motion` and `Settings.animationsEnabled`.

### 5.4 Entrance Hall skeleton

Lives at `apps/user-client/src/routes/entrance-hall.tsx`, replacing the current `app-shell.tsx` "Your space is ready" placeholder.

Layout per wireframe:
- Greeting `Welcome back` (label) + `<username>` (heading)
- Continue-Card (active chat) — hidden when no chats exist
- Rooms grid (2 columns):
  - **My Circle** — `<persona count>`
  - **My Projects** — disabled, "Coming later"
  - **My History** — `<session count>`
  - **My Treasury** — disabled, "Coming later"
  - **My Settings** — `<status snippet>`
- Setup-Hints panel — shown when essential pre-requisites missing (§ 2 Decision 15)

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

- **Provider endpoint verification.** Exact `baseUrl` + probe-path for nano-gpt (`https://nano-gpt.com/api/v1/...` ?), Novita (`https://api.novita.ai/v3/openai/...` ?), and Ollama Cloud (`https://ollama.com/v1/...` ?). Resolved during implementation by hitting the live endpoints; spec values are provisional.
- **Mindspace palette finalisation.** Final 7-mindspace palette + 2–3 texture set. Block 1 ships Aurum (locked) + Azuro + Verdan (provisional hex values to be replaced when Lyra finalises). Texture set ships only `cloudy` for Block 1.
- **Lyra's wireframes for Settings / Circle / History.** Phase 2 + History start when these arrive.
- **ADR "Tool Display Position".** Lands as part of Phase 3, captured in `obsidian/decisions/`.
- **Provider rate-limits / quotas.** All three providers have rate-limits the client does not yet handle gracefully. Block 1 surfaces upstream 429s as a "rate-limited" footer on the in-flight message; no client-side throttling.
- **Context-window-gauge accuracy.** Block 1 uses a 4-chars-per-token heuristic. A per-model tokeniser (tiktoken, etc.) is a follow-up.
- **CORS-proxy distribution to "selected users".** Out-of-Block-1: how Chris hands out the shared-secret. For now the proxy URL + key are user-entered in Settings.
- **First-launch flow inside local-only path.** The local-only onboarding path needs to land users at the Entrance Hall (not the current `app-shell.tsx`). Routing change is part of Phase 2 (Entrance Hall delivery).
- **Bookmark-list UI.** Data model is in (`MessageRow.bookmarked`, `ChatRow.bookmarkedMessageCount`); list rendering deferred per § 2 Decision 14.

---

## 12. Implementation sequencing

**Default order (Chris's pick at brainstorm):** 1 → 2 → 3 → 4.

- **Phase 1** starts immediately, runs while Lyra ships Settings + Circle wireframes.
- **Phase 2** starts when Settings + Circle wireframes arrive.
- **Phase 3** is wireframe-ready already (`chatsundere-prototype.html`); waits behind Phase 2 so the chat surface lands on a configurable backbone, not a hard-coded persona.
- **Phase 4** follows Phase 3 + the History wireframe.

**Alternative order** (if Phase 2 wireframes slip): 1 → 3 → 2 → 4. This brings chat-demo earlier but ships a chat without configurability surfaces; only chosen if Phase 2 wireframes are weeks out.

The Phase 1 implementation plan is the immediate next deliverable after this spec is approved. It splits Phase 1 into sequenced subagent-friendly chunks per CLAUDE.md § 13 "Subagent preferred" + global preference.

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
