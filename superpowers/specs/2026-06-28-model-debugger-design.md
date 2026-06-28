# Model Debugger — Design Spec

**Date:** 2026-06-28
**Author:** Liz (with Chris)
**Status:** Approved-pending-review
**Side:** Client-only (standalone mode). Not a Larissa path; **is** a Laura path.

---

## 1. Problem

Some users report "the stream keeps breaking" mid-chat. The symptom does not
reproduce for Chris (Austria, Linux/Android, every browser). A concrete case: a
user in the USA on an iPhone/Safari cannot stream `claude-sonnet-4.6` via
nano-gpt, while the identical model streams fine for Chris. Without diagnostic
data from the affected device we cannot tell the failure modes apart, and the
affected user is non-technical — we cannot expect her to extract Safari console
logs herself.

We need to put a **self-service diagnostic tool** in the user's hands that
reproduces the real failure and produces a copyable, screenshot-friendly report
she can send to Chris.

### Candidate root causes the tool must help discriminate

Ranked by current suspicion for the "breaks on US iPhone/Safari, works on
Austria Linux/Android" shape:

1. **Safari/iOS `fetch`-streaming quirks** — `ReadableStream` buffering, known
   iOS-version-specific bugs in long-lived streamed responses.
2. **`Content-Encoding` buffering** — a `gzip`/`br` encoded `text/event-stream`
   gets buffered until complete, so the stream appears to "hang" then dump
   (a classic SSE killer; device-/proxy-dependent).
3. **CORS proxy geo-behaviour** — a US edge, a connection reset, or a timeout
   after N seconds on the long-lived connection.
4. **Provider geo/rate behaviour** — nano-gpt rate-limiting or geo-handling the
   US request differently.
5. **Carrier/firewall** severing long-lived connections.

A report that captures environment, transport, response headers, and a chunk
timeline lets a remote reader separate these by eye.

## 2. Goals

- A **"Test models"** affordance on the per-provider settings page that runs a
  real streaming test inference against a user-chosen model and renders a rich,
  copyable, screenshot-friendly diagnostic report.
- A **"Show diagnostics"** affordance in the in-chat failure footer that surfaces
  the same kind of report for a stream that **just broke in real use**.
- One shared diagnostic-capture mechanism and one shared report format behind
  both surfaces.
- The report must **never** contain the provider API key (or the CORS-proxy
  key), in any form.

## 3. Non-goals (YAGNI)

- Multi-model sweep ("test all models on this provider"). One model per run.
- Free-text / arbitrary model-id entry. Pick from the provider's curated
  offerings only.
- "Share as file" / Web Share / download. Copy + screenshot cover it.
- **Durable** persistence of chat-failure diagnostics across a full page reload.
  Chat diagnostics are held **in-memory** for the session (see §8). A later
  Dexie-backed variant is explicitly deferred.
- Wiring diagnostics into the *successful* chat path. Capture is armed only for
  the test inference and for the chat **failure** case.

## 4. Decisions (settled in brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Test path | **Real streaming path** (`streamCompletion`), not one-shot — only the streaming path reproduces a streaming break. |
| D2 | Log depth | **Rich** — environment + transport + response headers + chunk timeline + outcome. API key never. |
| D3 | Presentation | **Zoom overlay** (`PickerOverlay`) opened from a button at the bottom of the provider page. |
| D4 | Export | **Copy button** + **screenshot-friendly** rendering. No file share. |
| D5 | Chat failure footer | **Yes, now, in-memory** — third button in `StreamInterruptedFooter`, report held in the stream-manager store, no Dexie change. |
| D6 | Precondition gating (Laura HARD) | The provider-page trigger is **disabled-with-reason** when no usable key is saved, or, for proxy-required providers, no CORS proxy is configured. Enabled only when a run could reach the transport. |
| D7 | Reload-loss mitigation (Laura SOFT) | Keep in-memory (no Dexie). When a report exists, the footer **signals it is perishable** ("Copy this before reloading"), turning a silent loss into a prompt to act. |
| D8 | Chat-report private text (Laura SOFT) | The chat-failure report **includes** the partial reply text but **clearly labelled** ("Partial reply your device received — included so we can spot corruption"). Corruption stays visible; the user consciously sees what she is sending. |

**Copy labels** (Chris arbitrates design; defaults set here): provider-page button
**"Test a model"** (singular — one model per run, not a sweep); run control
**"Run streaming test"** / **"Stop"**; copy control **"Copy report"** → **"Copied ✓"**;
footer link **"Show diagnostics"**. A **warm top line** opens the rendered report:
*"Thanks for this — copy it and paste it into your reply to us; it tells us exactly
what your device saw."* A **"what next" line** sits under the copy button:
*"Paste this into your reply to us."* (channel-agnostic, per Chris).

## 5. Architecture

Three new units + two small library extensions. The expensive parts (capture
mechanism + report builder + rendered report block) are **shared** by both
surfaces.

```
packages/llm-unified/src/
  stream-completion.ts   (+ optional `onDiagnostics` sink param)
  transport.ts           (reports resolved-request + response to the sink)

apps/user-client/src/
  lib/model-debug.ts            NEW — capture orchestration + report build (pure, testable)
  components/ModelDebugReport.tsx   NEW — renders a DiagnosticReport block + "Copy log"
  components/ModelDebugOverlay.tsx  NEW — PickerOverlay: model pick → run/stop → report
  components/chat/StreamInterruptedFooter.tsx   (+ optional third "Show diagnostics" button)
  routes/app/settings/provider.tsx  (+ "Test models" button → ModelDebugOverlay)
  routes/app/chat/chat-page.tsx     (+ wire footer's onShowDiagnostics from the store)
  state/stream-manager.store.ts     (+ arm the sink on the chat stream; hold last failure report)
```

### Unit responsibilities

- **`onDiagnostics` sink (llm-unified):** a small, optional callback the caller
  passes into `streamCompletion`. The transport layer fires two lifecycle
  events through it; everything else (per-chunk timing, environment, formatting)
  is the caller's job. Keeping capture in the library is what guarantees the
  test and the chat run **bit-identical** code — the whole point of D1.
- **`model-debug.ts`:** owns the `DiagnosticReport` type, the environment
  snapshot, the timeline accumulation, and the `formatReport()` → plain-text
  serialiser. No React. Unit-tested against a fake `streamCompletion`.
- **`ModelDebugReport.tsx`:** presentational — renders a `DiagnosticReport` as a
  sectioned monospace block (no truncation, screenshot-clean) with a
  "Copy log" button (`navigator.clipboard.writeText(formatReport(report))`,
  "Copied ✓" confirmation).
- **`ModelDebugOverlay.tsx`:** the provider-page surface. Provider-scoped model
  picker → "Run streaming test" / "Stop" → live status → `ModelDebugReport`.
- **`StreamInterruptedFooter`:** gains an optional `onShowDiagnostics?: () => void`.
  When present, renders a third button; when absent, the footer is byte-identical
  to today.

## 6. The diagnostic sink (library contract)

`streamCompletion` accepts an optional sink:

```ts
export interface StreamDiagnosticsSink {
  /** Fired once the outbound request is fully resolved, before/at send. */
  onRequest(info: {
    method: string;
    url: string;                       // proxy URL or direct upstream URL, as actually used
    headers: Record<string, string>;   // REDACTED — see §9
  }): void;
  /** Fired once response headers are available, before body streaming. */
  onResponse(info: {
    status: number;
    statusText: string;
    headers: Record<string, string>;   // allowlisted subset — see §9
  }): void;
}
```

- The parameter is **optional**; absent → today's behaviour, zero overhead.
- `transport.ts` is the only place that knows the resolved URL and the response
  object, so it owns firing both events. Redaction happens **at the source**
  in transport before the strings ever leave the library (§9).
- Per-chunk timing is **not** a sink event — the caller already iterates the
  `AsyncIterable<StreamChunk>` and timestamps each chunk itself. This keeps the
  sink minimal and the timing owned by the caller.

## 7. The test inference (provider-page surface)

- **Fixed prompt:** `Count slowly from 1 to 10. Put each number on its own line.`
  Chosen to force **multiple chunks** so time-to-first-token and inter-chunk
  gaps are meaningful — a one-word "OK" reply would arrive in a single chunk and
  hide a stall.
- **Deterministic body:** no persona settings, no temperature override; minimal
  `bodyExtras`. The point is the transport, not the generation.
- **Provider-scoped model picker:** lists `getProvider(templateId)?.offerings`
  for the page's provider. One model per run; re-run by changing the model.
- **Stall watchdog:** if no chunk arrives for **5 s** while streaming, append a
  `STALL` line to the timeline; the connection continues until timeout or Stop.
- **Timeout:** **60 s** hard cap. A large **Stop** button cancels via
  `AbortController` (a first token that never arrives is itself diagnostic).
- **Reused resolution:** provider definition/config, decrypted key, and CORS
  proxy URL/key are resolved exactly as the existing "Test & Save" /chat paths
  do in `provider.tsx` — no parallel re-implementation.
- **Precondition gating (D6, Laura HARD):** the **"Test a model"** button is
  rendered **disabled-with-reason** until a run could actually reach the
  transport. The provider page is reachable in the unconfigured state
  (`provider.tsx:33,36` — `existing` may be undefined, `apiKey` starts `''`).
  Reasons: no saved/usable key → *"Save a key first"*; proxy-required provider
  with no CORS proxy configured → reuse the existing `provider.tsx:59` string
  (*"Set a CORS proxy first"*). Without this, a user taps Test → picks a model →
  hits a 401/CORS error that reads as a **model** failure — the tool built to
  diagnose a real break would manufacture a fake one, indistinguishable to a
  non-technical user. Disabled-over-hidden applies here (the user can act on the
  reason), unlike the footer case (§8).

## 8. The chat-failure surface (in-memory)

The chat stream (`runIntoDraft` in `stream-manager.store.ts`) arms the same
sink and accumulates a timeline into the live `StreamHandle`.

- **Tool-loop note:** a single send can issue **several** `streamCompletion`
  calls (tool round-trips). The accumulator resets its per-request segment at
  the start of each request and retains the **segment that was active when the
  failure landed** — that is the request the report describes. The environment
  snapshot and outcome are captured in the existing `.catch` handler
  (`stream-manager.store.ts:986`).
- **Holding the report:** on failure, the built `DiagnosticReport` is stored in
  the stream-manager store, keyed by `chatId` (and the draft message id). It is
  **in-memory only** — it survives navigating away and back within the session,
  and is lost on a full reload. This fully covers the real incident flow: the
  footer appears the instant the stream breaks, the user taps "Show diagnostics"
  → copy → send to Chris, all same-session.
- **Perishable nudge (D7, Laura SOFT):** the target user (§1, US iPhone/Safari)
  will instinctively force-reload a hung page, destroying the in-memory report —
  the very evidence Chris needs. We keep in-memory (no Dexie) but make the loss a
  prompt to act: **when a report exists**, the footer shows a quiet perishable
  cue (*"Copy this before reloading"*) near the diagnostics link. This converts a
  silent loss into an honest, actionable signal without a migration.
- **Footer intent hierarchy (Laura SOFT):** the footer's primary intent at the
  moment of failure is recovery. Order and prominence: **Retry** (primary) →
  **Discard** → **Show diagnostics** (least prominent — a quiet text link, not a
  peer button), so the altruistic "help us debug" action never competes with the
  user getting her answer back.
- **Footer button gating:** `StreamInterruptedFooter` is also shown for
  *aborted* or *post-reload* incomplete messages, where **no report exists**.
  The third button is therefore rendered **only when the store holds a report
  for that message** (`chat-page.tsx:692` passes `onShowDiagnostics` only then).
  Whether the no-report case shows a disabled button (UX principle:
  disabled-over-hidden) or nothing is a **Laura spec-pass call** — the leaning is
  *hidden*, because for a reloaded/aborted message the capability genuinely does
  not exist (there is nothing that could be shown), so a disabled control would
  be noise rather than an honest "unavailable here". Laura arbitrates.
- Tapping the button opens the same `ModelDebugReport` inside a reading-style
  overlay.

## 9. Security — redaction (load-bearing)

Hard Rule #1 (zero-knowledge) plus simple good sense: a copyable log must never
carry a secret.

- **Request headers** passed to `onRequest` are filtered in `transport.ts` by a
  **denylist of secret-bearing header names** (`authorization`, `x-api-key`,
  `api-key`, and the CORS-proxy auth header), case-insensitive. Denied headers
  are dropped entirely (not masked-with-prefix — no partial key leakage).
- **Response headers** passed to `onResponse` are an **allowlist**:
  `content-type`, `content-encoding`, `transfer-encoding`, `cache-control`,
  `server`, `via`, `cf-ray`, `x-request-id`, `retry-after`, `date`. Anything
  not on the list is dropped.
- The **decrypted API key string** never enters `model-debug.ts` and never
  reaches any report field. A dedicated unit test asserts that a known key
  value does not appear anywhere in `formatReport(report)`.
- This is **not** a Larissa-listed path (no `apps/auth|sync|proxy-service`, no
  `packages/crypto`). The key here is the user's **own** provider key, not the
  master key or passphrase. The redaction logic is nonetheless security-relevant
  and is called out for explicit attention in code review.

## 10. The report

`DiagnosticReport` is a structured object; `formatReport()` serialises it to the
plain text used by both the rendered block and the copy button.

```
=== Chatsundere Model Test ===
Provider:  nano-gpt (cors-proxy → cors-proxy.tidesson.net)
Model:     anthropic/claude-sonnet-4.6
When:      2026-06-28T14:03Z

[Environment]
UA: Mozilla/5.0 (iPhone; CPU iPhone OS 17_4…) Safari…
Platform: iPhone · iOS 17.4 · crossOriginIsolated: false · online: true · TZ: America/New_York

[Transport]
Route: cors-proxy   Target host: api.nano-gpt.com

[Response]
HTTP 200 OK · content-type: text/event-stream · content-encoding: gzip ⚠

[Timeline]
+0ms      request sent
+812ms    response headers
+2104ms   first token  ("1")
+2240ms   chunk 2  (gap 136ms)
…
+9300ms   ⚠ STALL — no chunk for 7000ms
+16300ms  ✗ ERROR  TypeError: Load failed   (chunks: 6, text so far: "1\n2\n3\n…")

[Outcome] FAILED after 16.3s — stream stalled then errored
```

The rendered block opens with a **warm top line** so it reads as the user
*helping*, not as catastrophe at the worst moment (Laura SOFT, empowerment tenet):
*"Thanks for this — copy it and paste it into your reply to us; it tells us
exactly what your device saw."*

Environment fields: `navigator.userAgent`, a parsed platform/OS/browser line,
`crossOriginIsolated`, `navigator.onLine`, `Intl.DateTimeFormat().resolvedOptions().timeZone`.

**Returned model text (D8):**
- **Test path:** the prompt is fixed and trivial, so the returned text is included
  plainly — it reveals refusals/garbage/partials.
- **Chat-failure path:** the partial reply is a slice of the user's **real**
  conversation. It is **included but clearly labelled** — a dedicated section
  headed *"Partial reply your device received — included so we can spot
  corruption"* — so encoding corruption (mojibake etc.) stays diagnosable while
  the user consciously sees what is on her clipboard. This honours the
  zero-knowledge trust identity by making the content explicit rather than buried
  in a timeline line.

## 11. Error handling

- **Immediate failure** (401 / CORS / DNS / network): the stream rejects before
  any token; the report shows the response status (if any) and the error
  type/message — no timeline drama.
- **Stream-then-stall:** the watchdog line plus inter-chunk gaps make it visible.
- **Precondition not met (D6):** before any of the above, the **"Test a model"**
  trigger is disabled-with-reason when no usable key / no required proxy exists
  (§7) — so a precondition failure never masquerades as a model/transport failure.
- **No model chosen:** the "Run streaming test" button is disabled with a reason
  (Don't-make-me-think).
- **Clipboard unavailable:** the rendered block is the fallback — it is already
  screenshot-clean, and "Copy report" degrades to a "select-all" hint. A "what
  next" line under the button (*"Paste this into your reply to us."*) closes the
  loop so the copied report has an obvious destination.

## 12. Testing

- **Unit (`model-debug.ts`):** report build against a fake `streamCompletion`
  for three shapes — clean success, immediate error, stall-then-error; the
  **redaction test** (a planted key value is absent from `formatReport`); the
  environment snapshot is captured.
- **Component (RTL):**
  - `ModelDebugOverlay` — pick a model → run → report renders → copy invoked.
  - `StreamInterruptedFooter` — third button appears only when
    `onShowDiagnostics` is provided; absent otherwise (byte-identical legacy).
- Full user-client vitest stays green at the current baseline; `pnpm typecheck
  --force` and the production build pass.

## 13. Audit gates

- **Larissa:** not required (no auth/sync/proxy-service, no `packages/crypto`).
  The redaction in `transport.ts` is flagged for code-review attention (§9).
- **Laura:** required — two new user-reachable affordances. **Spec-pass: done**
  (2026-06-28) — 1 HARD (precondition gating, now D6/§7) + softs folded
  (D7 perishable nudge, D8 labelled private text, footer intent hierarchy, warm
  top line, "what next" line, "Copy report" label). She ruled **with** me on the
  footer hidden-vs-disabled question (§8): hidden for the aborted/reloaded case,
  conditioned on the settings-side trigger staying the always-visible home.
  **Pre-squash** on the built flow still pending.

## 14. Manual verification (Chris, on device)

0. On a provider with **no key saved** (or proxy-required with no proxy), the
   **Test a model** button is disabled with the right reason; saving a key (and
   proxy) enables it.
1. Settings → AI Providers → a provider → **Test a model** → pick a model →
   **Run streaming test** → a report with a populated timeline + warm top line
   renders; **Copy report** copies; the "what next" line is present.
2. **Copy log** copies the plain-text report; pasting it elsewhere shows no
   `Authorization`/key string anywhere.
3. The report block is legible as a screenshot at 380 px (no truncation).
4. Force a failure (e.g. a wrong key, or a model known to break) → the report
   shows the failure shape (status / error / stall).
5. In a real chat, interrupt/break a stream → the interrupted footer shows a
   quiet **Show diagnostics** link (less prominent than Retry/Discard) plus the
   **"Copy this before reloading"** perishable cue → opens the report (with the
   labelled partial-reply section) → copy works. Navigate away and back within the
   session → still available. Full reload → gone (expected).
6. An aborted (Stop) or post-reload incomplete message shows **no** diagnostics
   button (per the §8 leaning, subject to Laura).

## 15. Deferred / future

- Durable (Dexie-backed) chat-failure diagnostics surviving reload — a later
  unit with a v31 migration, only if real use shows it is needed.
- Arming the sink on the *successful* chat path to capture pre-emptive
  diagnostics — the design leaves this open; not built now.
- Free-text model-id testing and a multi-model sweep — only if curation gaps
  make them necessary.
