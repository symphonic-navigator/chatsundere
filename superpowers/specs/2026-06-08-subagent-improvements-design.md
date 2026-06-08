# Subagent improvements — author default reasoning, expert web access, base unification

**Date:** 2026-06-08
**Author:** Liz (brainstormed with Chris)
**Status:** Design — approved, pending spec review
**Scope:** Client-only (`apps/user-client`, `packages/llm-unified`). One combined feature unit.

---

## 1. Context

Chatsundere has two model-driven subagents — short-lived, structurally-isolated
secondary model calls spawned from a tool:

- **The artefact author** (`lib/artefact-author.ts`, driven by
  `integrations/artefact/artefact-integration.ts`) — `create_artefact` hands a
  self-contained brief to a separate author call that returns one HTML file.
- **The expert uplink** (`tools/ask-expert.ts`, resolved in `data/send-message.ts`)
  — `ask_expert` forwards a single sanitised standalone question to a stronger
  user-chosen expert model and weaves the answer back in the companion's voice.

Both resolve to a streaming call over an identical base descriptor
(`AuthorBase` ≡ `ExpertBase`) and stream-accumulate a `[system, user]`
conversation. Three improvements are bundled here.

## 2. Goals

- **(a)** The artefact author runs at the **author model's chat-default reasoning**
  (e.g. `medium`/`on`) instead of the current hard `reasoning: { enabled: false }`.
- **(b)** The expert can use **`web_search` and `web_fetch`** during its turn,
  with its own settings-level backend selection (independent of chat web),
  a **search-depth** picker, and an **auto-default of exa + neural** when
  available. The expert's web activity is **visible in the ExpertPill**.
- **(c)** Unify what is genuinely shared between the two subagents (the base
  descriptor type, the web-tool builders) without forcing them into one shape.

## 3. Non-goals

- No generic `runSubagent` tool-loop engine. The author is a one-shot generator;
  the expert is a tool-loop agent. A shared loop engine is premature abstraction
  (CLAUDE.md §13) and is explicitly **not** built here.
- The artefact author does **not** gain web tools.
- No change to the chat web-interfacing behaviour, backend list, or its cockpit
  depth control. (b) adds an independent expert surface; chat web is untouched.

---

## 4. (a) Author default reasoning

### Change

`authorArtefact` (`lib/artefact-author.ts`) takes a `reasoning: ReasoningIntent`
argument (added to `AuthorArtefactArgs`) and emits it in `bodyExtras` instead of
the hard `{ enabled: false }`.

`defaultResolveBase` (`integrations/artefact/artefact-integration.ts`) already
resolves the persona `offering`. It derives the author's chat-default reasoning
from the offering's control, reusing the existing resolver:

```ts
const control = offering.profile.reasoning;
const state = initialReasoningState(control);
const reasoning =
  (resolveReasoningBodyExtras(control, state).reasoning as ReasoningIntent | undefined)
  ?? { enabled: false };
```

This yields exactly the intent the chat cockpit would start with for that model:
a reasoning model reasons at its default effort, a non-reasoning model stays off.
The resolved intent is threaded through `makeArtefactTool`'s `execute` into
`authorArtefact`.

### Output budget

When reasoning is enabled, reasoning tokens consume the output budget, risking a
truncated HTML file. The author's `max_tokens` becomes **conditional**:

- reasoning enabled → `max_tokens: 16384`
- reasoning disabled → `max_tokens: 8192` (unchanged)

`temperature: 0.4` is unchanged.

---

## 5. (b) Expert web access

### 5.1 Settings & Dexie migration (v17)

A new settings field, **independent** of the chat `webInterfacing` block:

```ts
expertWeb: {
  search: WebBackendSetting;     // OfferingRef | null | 'off'  (same union as chat)
  fetch: WebBackendSetting;
  searchTierId: string | null;   // chosen depth tier for the search backend
}
```

**Dexie migration to v17** (current head is v16, ask_expert). The migration
backfills `expertWeb` on every settings row. Fresh-open seed and verno
assertions bump 16 → 17.

**Default resolution (auto-on, exa + neural):** the migration/seed sets
`search`/`fetch` to `null` (meaning *auto*), and the live resolver (§5.2) maps
*auto* to **exa with the `neural` tier when resolvable** (nano-gpt key + a
configured CORS proxy), else the first-come web backend (the chat fallback
order), else nothing. `searchTierId` defaults to `null` → the resolved
offering's default tier, which for exa is overridden to `neural` by the auto rule.
An explicit `'off'` disables expert web entirely. This mirrors the chat
auto-default-Linkup pattern, with exa/neural as the expert's preferred default.

**Settings UI** — a new `AccordionCard` section "Expert web access" in My
Settings, modelled on `WebInterfacingSection`:

- a **search backend** picker (search-capable web offerings),
- a **search depth** picker bound to the chosen search backend's `searchTiers`
  (e.g. exa → Quick / Neural); disabled-with-tooltip when the backend has no
  tiers,
- a **fetch backend** picker,
- the same **proxy-gating notice** (disabled-over-hidden when no proxy is
  configured) and **zero-knowledge note** ("the expert's web queries leave your
  device") as the chat section.

The section is gated identically to the chat web section: visible, but with the
"needs a proxy" notice when no proxy exists.

### 5.2 Resolution on the send path

`resolveExpertWeb(settings, mk, corsProxyUrl, corsProxyKey)` in
`data/send-message.ts`, modelled on `resolveExpert`:

- reads `settings.expertWeb`; resolves the backend ref by **reusing the existing
  `resolveWebBackend` helper** (`lib/web-backends.ts`) that already implements the
  auto / first-come / `'off'` rule for chat, then applies the expert-specific
  **exa + neural override** on top of an *auto* result (don't reimplement the
  fallback ordering),
- resolves search/fetch offerings + adapters via the catalogue/registry
  (`getOffering`, `resolveWebAdapter`), honouring `requiresProxy`,
- decrypts the backing provider key(s) (the send path holds the MasterKey),
- resolves the search tier (`searchTierId` → tier → `params`),
- builds a `WebContext` (`nsfwAllowed` = the active persona's `adultPersona`;
  `location` = null as today; the call-time proxy fields),
- returns a resolved `ExpertWeb` block: the `WebContext`, the resolved
  search/fetch `WebInterfacingProvider`s, the chosen tier `params`, the backend
  provider ids (for `getKey` at call time), and display labels for the pill.

Returns `null` when expert web is off or unresolvable → the expert simply has no
web tools (the loop degrades to the current single-shot behaviour). Threaded
through `StartArgs`/the stream-manager into `createAskExpertTool` as an optional
`expertWeb` argument, exactly as `expertBase`/`expertReasoning` are today.

### 5.3 Shared web-tool builders — `buildWebTools`

The `web_search` / `web_fetch` `Tool` construction currently inlined in
`integrations/web/web-integration.ts` is extracted into a pure
`buildWebTools(input): Tool[]` where `input` carries: the resolved
search/fetch providers + offerings, a `WebContext`, the tier `params`, and a
`getKey(providerId)` callback. Both callers use it:

- the **chat** `WebInterfacing` integration (its `contributesTools` becomes a
  thin adapter that resolves refs → calls `buildWebTools`), and
- the **expert** (`resolveExpertWeb` → `buildWebTools`).

This is the genuine (c) reuse driven by (b). The extraction is behaviour-
preserving for chat; a regression test pins the chat tools unchanged.

### 5.4 Expert tool loop

`createAskExpertTool` gains an optional `expertWeb` parameter carrying the web
tools (from `buildWebTools`) and their wire `ToolDef`s. `execute` becomes a
bounded tool loop instead of a single stream:

1. `messages = [system(EXPERT_SYSTEM_PROMPT), user(question)]`.
2. Stream a completion with the web `toolDefs` attached (when `expertWeb` is
   present) and max reasoning.
3. If the model emits a `web_search` / `web_fetch` tool call: dispatch it via the
   matching `buildWebTools` tool, append `assistant(tool_call)` + `tool(result)`
   to `messages`, surface a progress phase (§5.5), and loop.
4. If the model produces a final answer (no tool call), return it.
5. **Round cap: 8.** On exceeding the cap, return the best answer so far, or a
   constructive error if none.

When `expertWeb` is absent, no tool defs are attached and the loop terminates
after the first stream — identical to today's behaviour.

The expert **reasoning stays at max** (`maxReasoningIntent`, unchanged). The
`EXPERT_SYSTEM_PROMPT` gains a short web nudge: it *may* use `web_search` /
`web_fetch` for current or external facts, keep it to a few focused searches,
then answer — mirroring the chat web nudge that settles eager models.

### 5.5 ExpertPill — visible web activity

`ToolProgress.phase` and `ExpertPayload.phase` extend to
`'reasoning' | 'answer' | 'searching' | 'fetching'`, plus an optional
`detail?: string` (the search query or fetched host).

- **Pending pill:** `searching` → `sucht im Web · "<query>"`;
  `fetching` → `liest Seite · <host>`; `reasoning`/`answer` unchanged.
- **Completed pill (expanded):** below question + answer, a compact list of the
  executed searches/fetches (query / host), so the user can see *what* left the
  device — consistent with the zero-knowledge ethos.

The pill payload accumulates a `webSteps: { kind, detail }[]` array over the
loop for the expanded view.

---

## 6. (c) Unification — explicit boundaries

**Unified:**

- `AuthorBase` and `ExpertBase` (byte-identical: `provider`, `providerConfig`,
  `apiKey`, `corsProxyUrl`, `corsProxyKey`, `target`) merge into one
  `SubagentBase` type in a shared module; both subagents import it.
- `buildWebTools` (§5.3) is shared between chat and expert.

**Deliberately not unified:** there is no shared tool-loop engine. The author is
a one-shot generator (stream → strip fences → return string); the expert is a
bounded tool-loop agent. After (b) they are *more* divergent, not less. Forcing
a common engine would add an abstraction with one real consumer. Recorded as a
decision so a future reader does not "fix" the apparent duplication.

---

## 7. Isolation invariant & egress

### Isolation

The expert's structural isolation is preserved but its load-bearing test is
reformulated. **Old:** the expert messages are exactly `[system, user]` with no
tools. **New invariant:** the first two messages are
`[system(EXPERT_SYSTEM_PROMPT), user(question)]`, and every later message is the
expert's *own* tool call or web tool result — **no** persona, history, about-me,
memory, or knowledge context ever enters the expert conversation. The expert
composes its web queries solely from the already-sanitised standalone question.

### Egress

The expert's web queries (and fetched URLs) are a **new outbound surface**,
leaving the device via the user's CORS proxy to the chosen web backend —
analogous to the existing chat web egress and the existing ask_expert egress.
Logged in `obsidian/insights/security-deferrals.md`. **Not a Larissa change**
(client-only; no `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`,
or `packages/crypto` code).

---

## 8. Testing

TDD per task. Key tests:

- **(a)** `defaultResolveBase` derives the author's chat-default reasoning from
  the offering control (reasoning model → enabled at default effort; non-reasoning
  → off); `authorArtefact` emits the intent and the conditional `max_tokens`.
- **buildWebTools extraction:** chat `web_search`/`web_fetch` tools unchanged
  (regression); the builder is pure over its input.
- **Expert loop:** a stubbed stream that emits a `web_search` call then an answer
  drives one dispatch + a final answer; the round cap (8) terminates a runaway
  stub; absent `expertWeb` ⇒ single-shot, unchanged.
- **Isolation:** the reformulated invariant test (no context beyond the system
  prompt, the question, and the expert's own tool traffic).
- **resolveExpertWeb:** auto → exa/neural when resolvable; first-come fallback;
  `'off'` ⇒ null; unresolvable ⇒ null.
- **Migration v17:** backfill on upgrade; fresh-open seed; verno assertions.
- **Pill:** the new phases render; the expanded completed pill lists web steps.

Full vitest (not just touched dirs) before squash (CLAUDE.md §10). Live web
suites are out of scope for CI (provider keys never enter CI); expert web is
device-verified.

---

## 9. Manual verification (device, Chris)

1. **(a)** With a reasoning-capable persona model, ask for an artefact → the
   author reasons (longer build, the file is complete, not truncated). With a
   non-reasoning model, the build is unchanged.
2. **(b) default:** with nano-gpt + a configured proxy and an expert model set,
   open My Settings → "Expert web access" shows **exa / Neural** as the auto
   default; the depth picker offers Quick/Neural.
3. **(b) loop:** in a chat with a small persona + the expert chip on, ask the
   expert a question needing current facts → the ExpertPill shows
   `sucht im Web · "…"` (possibly several), then `denkt → antwortet`; expand the
   finished pill → the standalone question, the executed searches, the expert
   answer; the companion replies in its own voice.
4. **(b) off:** set expert web to Off → the expert answers from its own
   knowledge, no web phases.
5. **(b) no proxy:** remove the proxy → the section shows the "needs a proxy"
   notice; the expert has no web tools.
6. **Isolation:** the expanded pill's question carries no personal/relational
   context from the chat.

---

## 10. Decisions

- **D1.** Author reasoning = the model's *chat-default* (not max, not off).
  Matches what the user sees the model do in chat. Max is reserved for the
  expert.
- **D2.** Expert web is **independent** of chat web (own settings field, own
  default), auto-on with **exa + neural** when resolvable.
- **D3.** Round cap **8** — generous enough for genuine multi-search synthesis
  (the "strong expert researches and assembles" use case), bounded against
  runaway.
- **D4.** Web activity is **visible** in the ExpertPill (transparency over a
  quieter UI), consistent with the zero-knowledge ethos.
- **D5.** No generic subagent loop engine (§6).
- **D6.** Conditional `max_tokens` (16384 with reasoning, 8192 without) so the
  author's HTML output is not truncated by reasoning tokens.
