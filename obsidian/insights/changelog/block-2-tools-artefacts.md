# Changelog — Block 2 · Tools & artefacts

> Archived from `STATUS-CLIENT-ONLY.md` on 2026-06-18 (STATUS reorg).
> Reverse-chronological. Chapter index: [[README]].


## Session log

**Earlier 2026-06-10 (evening) — Parallel tool-call pills fixed**
(client-only bugfix on master, **NOT pushed**). Device-found during Chris's
Fable 5 test: a three-tool parallel turn (calculate_js + generate_image +
web_search) executed **all three** tools (console-proven: all requests fired,
results woven into the answer) but rendered **only the first pill**. Probe
chain: live SSE probe first (the wire is clean — one delta, three complete
tool calls with distinct index/ids; adapter, engine, tool-loop and persistence
all correct), then down the render path. Root cause: `groupAdjacent`
(content-blocks.ts) grouped **adjacent pill blocks** into one group while the
renderer (MessageBlock) draws only `group.blocks[0]` per pill group — its
"pills never coalesce" comment described `coalesceAdjacent` (which has the
pill exception), not `groupAdjacent` (which didn't). A pure tool-call turn
has no text between pills → pills 2+3 swallowed. Latent since Phase 4; first
surfaced by the first real parallel-tool turn (also covered the latent
vision-pill + lore-pill adjacency). Fix: pills never group — one group per
pill block. TDD: red component test reproduced the swallow exactly, green
after; +2 tests (groupAdjacent identity + MessageBlock three-pill render;
note generate_image renders as ImagePill labelled "Painted · <model>").
Note for the books: the model's in-chat "confession" that it had only
confabulated the calls was itself confabulated — trust probes, not the
model's self-reports. Gates: `pnpm typecheck --force` **14/14**; user-client
vitest **1267 pass / 8 fail** (unchanged baseline trio); `pnpm run build`
**9/9**; biome clean. Not a Larissa/Laura path (render bugfix, no flow
change). **Device re-test:** repeat the three-tool prompt → three pills
(calculate, Painted-ImagePill, web_search) live AND after reload —
**DEVICE-CONFIRMED by Chris 2026-06-10** ("ja, funktioniert!"). Follow-up on
his ask: every dispatched tool call now logs one `[tool-call]` console.info
line (name · args size · first 100 chars) at the tool-loop choke point
(`f3e016e`). **Next:** unchanged — the design-language session.
**Earlier 2026-06-08 (substitute-vision) — **Substitute-vision as a live in-stream pill**
(squashed onto master `a7c05d0`, **NOT pushed**; **DEVICE-CONFIRMED by Chris 2026-06-08**
— "ich mag es sehr, so wie es jetzt ist! großartig!"). A UX
redesign of the substitute-vision flow (active model can't see images → a substitute
vision model describes them), brainstormed end-to-end with Chris, built
**subagent-driven** in an isolated worktree (4 TDD tasks + a label-polish fix, Task-4
spec review + a final **opus** holistic review = no critical/important). **The
problem (device-found):** the describe ran *before* the stream handle existed, so the
only progress signal was a cockpit footer hint, and the empty persona draft briefly
read as "stream interrupted" — plus a duplicate-send window. Two interim band-aids
landed (`isSending` guard, footer suppression, a `describingChats` flag + cockpit
"Describing image…" hint), now **superseded/removed** by this redesign. **What it
does:** the persona response goes **live immediately** (the stream handle is created
**before** the describe → `isStreamLive` covers the whole window, which alone
suppresses the footer and blocks a duplicate send). Each **uncached** substitute image
emits a **`describe_image` pill** (a `tool-call`-kind pill → new **`VisionPill`**,
modelled on `ExpertPill`): pending **"Reading image · *file*"** with a live bar →
completed **"Read image · *file*"**, expandable to the description **+ "via *model*"**
(friendly name, not the raw ref) → failed **"Couldn't read image"** (image degrades to
a text placeholder, the answer still streams). Pills sit **above** the lore pill (the
image is part of the input), one **per image**, emitted via new
`resolveAttachmentParts` **`onDescribeStart`/`onDescribeEnd`** callbacks; the LLM
tokens stream once the describe completes (they depend on the description in the wire).
`resolveUserContent` moved from `start` into `runIntoDraft` (gated `!reusedDraft` —
**regenerate does not re-describe**); vision pills **persist** with the message (both
finalise paths) and survive reload. **No Dexie change** (a `tool-call` pill, no new
kind). **Not a Larissa change** (client-only; no new egress — the describe already
existed). Verification (on master after squash): full-tree capture verified (18=18
files, empty `branch..master` diff) + `pnpm typecheck --force` **14/14**; user-client
vitest **1210 pass / 8 fail** (the unchanged `cockpit-draft`/`chat-page`/`chat-route`
localStorage-jsdom baseline; new vision-pill/resolve-attachment-parts/stream-manager
tests green); `pnpm run build` **9/9**; biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-08-substitute-vision-live-pill-design]],
[[../../../superpowers/plans/2026-06-08-substitute-vision-live-pill]]. **Device test:** active
model without vision + an image substitute set; upload an image, send → the response
appears immediately with a **"Reading image"** pill (live bar), **no** "interrupted",
**no** cockpit bottom hint, **no** duplicate on a second click; the pill flips to "Read
image" + the answer streams; expand → description + **via *friendly model name***; two
images → two pills; reopen the chat → pills persist; a describe failure → "Couldn't read
image" + the answer still streams; regenerate → no new describe. **Next:** Chris
device-tests → pushes the master backlog himself (Liz must NOT push).
**Earlier 2026-06-08 — MCP client landed** (squashed onto master
`6e766fa`, relocated to the My Integrations room `4fe76f8`, **NOT pushed**;
**DEVICE-CONFIRMED by Chris 2026-06-08** — quotewise (18 tools, via the user's CORS
proxy) end-to-end: the model called `quotes_about` with self-chosen args
(`about:"courage", limit:15, language:"de"`), the **approval modal showed the args**,
Approve → quote returned → companion answered. The reported "tools not called in
'frag nach'" was **diagnosed as model nondeterminism, not a bug** — `autoRun` gates
only `execute`, never tool *offering* (proven by `[mcp-offer]` instrumentation: server
active, 18 tools built, identical to trusted); with a clear trigger prompt the model
calls the tool and the approval flow works. Temporary debug instrumentation was added
to the working tree during diagnosis and **fully reverted** (tree clean)). Brainstormed
end-to-end with Chris, built **subagent-driven** in an
isolated worktree (11 TDD tasks, per-task spec+quality review + a final **opus**
holistic review + a **Larissa** security round = **READY TO SQUASH**, no
critical/high). Connects the browser to **external HTTPS MCP servers** and exposes
their **tools** to companions (tools-only scope; resources/prompts/OAuth/stdio
deferred). **What landed:** (1) a browser MCP **JSON-RPC transport over Streamable
HTTP** (`mcp/mcp-client.ts`, ported from chatsune — initialise → notifications/initialized
→ tools/list/tools/call, JSON **and** SSE replies, `Mcp-Session-Id` lifecycle, 404
re-init). (2) A per-server **connection test** (`mcp/mcp-connectivity.ts`): tries
**direct first, proxy fallback** (when a CORS proxy is configured) across **bare +
`/mcp`** URL variants, stores the resolved routing/endpoint, re-runnable when a
provider changes its CORS. (3) MCP tools wired as a **fourth context-tools category**
in `resolveActiveTools` (the knowledge/expert precedent — *not* the `Integration`
array, since MCP servers carry no `ServiceKind`); **stable per-server tool-name
prefix**, sanitised + collision-safe (`mcp/tool-naming.ts`). (4) Gating: a server
**`onByDefault`** flag + a **per-persona tri-state override** (`PersonaRow.mcpOverrides`,
unset → default) — new on-by-default servers are instantly available everywhere; no
cockpit chip (Chris's call). (5) **Approval gate** — non-`autoRun` servers surface a
chat **modal** (server · tool · args → Approve / Deny / "always allow") that pauses
`execute` until the user decides; deny aborts **before** any key decrypt or network
(test-pinned). (6) Per-server **auth** (Bearer or custom header), MasterKey-sealed
(slot `mcp/<id>/api-key`), opened only at call time. (7) UI: an **MCP Servers**
section (`McpServersSection` + `McpServerSheet` with the Test button) in a **new
`/app/integrations` room** (the previously "Coming soon" My Integrations
entrance-hall tile is now live — `4fe76f8`), plus a **per-persona override** section
in the persona editor. **Dexie v18** (`mcpServers`
table + `mcpOverrides`; v17 was the parallel expertWeb feature — renumbered to avoid
the collision). **Not a §9-gated path** (client-only; no auth/sync/proxy/crypto), but
the new **outbound egress** + credential handling + approval gate got a Larissa round
anyway — egress + the M1 (malicious-server prompt-injection, gate-mitigated) acceptance
logged in [[insights/security-deferrals]]. Merged onto the lore/duplicate-send master
cleanly (auto-merge, no conflicts in the two shared files `stream-manager`/`chat-page`).
Verification (on master after squash): `pnpm typecheck` **0 errors**; user-client
vitest **1204 pass / 8 fail** (the unchanged `cockpit-draft`/`chat-page`/`chat-route`
localStorage-jsdom baseline, verified identical on master); `pnpm run build` **9/9**;
biome clean on the staged tree (note: a **pre-existing** `index.css` biome-format issue
exists on master from the parallel picker work — **not** from MCP, untouched here).
Spec/plan: [[../../../superpowers/specs/2026-06-08-mcp-client-design]],
[[../../../superpowers/plans/2026-06-08-mcp-client]]. **Device test (spec §14):** add a
stateless public HTTPS MCP server (no proxy → resolves `direct`, tools appear); a
proxy-only server (its host must be in the `cors-proxy.tidesson.net` **allowlist**; if
session-based, the proxy must forward + **expose** the `mcp-session-id` header —
`Access-Control-Expose-Headers` — the test surfaces both gaps distinctly); a `/mcp`-suffix
discovery; two servers with a same-named tool (both wire names unique); the
default + per-persona override matrix; the approval modal (deny → companion explains;
approve → runs; "always allow" → skips next time); prefix edit + tool-hide; a
custom-header server; and a **multi-turn** loop (the companion answers from the tool
result in its own voice). **Next:** Chris device-tests → **Liz pushes the master
backlog on his word** (Liz must NOT push). MCP is the first external-tool surface;
remaining roadmap items unchanged (memory/Block-1 port still the notable gap).
**Earlier 2026-06-08 — `ask_expert` expert-uplink tool shipped**
(squashed on `master` `6d91bd5`, **DEVICE-CONFIRMED by Chris 2026-06-08** —
**Gemma 4 → Opus 4.8** on a Lie-groups question: the forwarded prompt was a clean
standalone technical query (no personal context — isolation held in the wild) and
Gemma answered in its own buddy-friendly voice (knowledge from the expert, warmth
from the companion — the design goal, proven live). **NOT pushed** — Liz pushes on
his word). Client-only, **inserted experimental** feature,
brainstormed end-to-end with Chris, built **subagent-driven** in an isolated
worktree (14 TDD tasks, per-task spec+quality review + a final **opus** holistic
review = READY TO SQUASH, no critical/important; all **7 cross-cutting invariants
test-confirmed**). Small/local conversation models get an **uplink**: an
`ask_expert` tool forwards a single **structurally-isolated** question (the expert
sees *exactly* `[system(EXPERT_PROMPT), user(question)]` — **no** history / persona
/ about-me; isolation enforced in code + pinned by a load-bearing test, not by
trusting the weak model to filter) to a user-chosen global expert model, streamed
at **maximum reasoning** with a live thinking/answering pill (`ExpertPill`), then
woven back in the companion's voice — Chris's *"best of both worlds"* for the
privacy-first stance. **Three control layers:** global model
(`SettingsRow.expertModel`, My Settings, default none → tool absent) → persona
default (`PersonaRow.askExpertDefault`, **ships off** — opt-in uplink) → per-chat
cockpit runtime chip (mirrors the reasoning toggle; **runtime-off keeps the tool in
the wire defs** for cache-prefix stability and returns a constructive error). Neutral
non-censoring expert prompt (anti-paternalistic). **Dexie v16** (`expertModel`,
`askExpertDefault`; the v16 migration backfills both + 37 persona fixtures updated).
**Not a Larissa change** (client-only; no auth/sync/proxy/crypto; new **outbound
egress** — the sanitised question — logged in [[insights/security-deferrals]]).
Verification (on master after squash): `pnpm typecheck` **14/14**; `pnpm run build`
**9/9**; user-client vitest **1104 pass / 8 fail** (the unchanged
`cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline, identical on
master); biome clean. Full-tree capture verified (squash tree == branch-tip) +
typecheck on master before merge. Spec/plan:
[[../../../superpowers/specs/2026-06-08-ask-expert-tool-design]],
[[../../../superpowers/plans/2026-06-08-ask-expert-tool]]. **Device test (spec §15):**
(1) no global expert model → persona Behaviour toggle + cockpit "Ask expert" chip
**disabled-with-tooltip**; (2) pick a strong model in My Settings → toggles enable;
(3) small-model persona, chip **on** → ask a hard maths/physics question → an
"Asked expert · *model*" pill appears, shows **live** "thinking → answering" chars,
expand the finished pill → clean technical question + expert answer, companion
replies in its own voice; (4) chip **off** mid-chat → model answers itself (no retry
loop); (5) regenerate keeps the tool. No setup needed (no `packages/*` change → HMR,
no model provisioning — just pick a catalogue model). **Deferred (logged, both
Minor, spec-compliant):** the settings picker lists registered-not-resolvable
offerings (toggles can show "on" while the tool is silently not offered — identical
to the substitute-vision picker precedent); the failed pill shows only the error,
not the question. **⚠ Merge note for the parallel Chunk-C work:** this claimed
**Dexie v16** — Chunk C (lorebooks) must renumber to v17 if it also bumps the schema
([[../../../superpowers/specs/2026-06-08-ask-expert-tool-design]] §13 lists every conflict
point: Dexie verno, `resolveActiveTools` signature, `stream-manager`, `send-message`,
`persona-editor`, `settings`, `current-chat.store`, `CockpitMenu`, `chat-page`).
**Next:** Chris device-tests → Liz pushes the master backlog on his word.
**Earlier 2026-06-08 — B2 device-testing in progress; one lightbox bug
found & fixed.** During Chris's device test of B2, an **HTML artefact attached as an
attachment went blank when navigating ‹/› away and back** in the lightbox. Root
cause: the per-item edit-buffer reset ran in a `useEffect` (one render late), so the
sandbox iframe mounted with the *previous* item's draft and relied on a flaky
`srcDoc`-update reload. Fixed by resetting the buffer **synchronously during render,
keyed on `item.id`** (`Lightbox.tsx`); regression test `lightbox-item-switch.test.tsx`.
**Device-confirmed smooth by Chris** (commit `bdd6110`). Also a **WATCH** entry logged
in [[insights/follow-ups-index]] for a *not-yet-reproducible* intermittent "Remove
leaves the counter stuck on a mixed pending set" report — probe-first plan on
recurrence. **master now carries 5 unpushed commits** (4× B2
`392750f`/`33ed425`/`88f5c7d`/`2136cdd` + the fix `bdd6110`); **still NOT pushed** —
Liz pushes the stack on Chris's word once the full B2 device test is through.

**Knowledgebase Chunk B2 (Attach document) landed** (squashed on master `88f5c7d`).
Block-5 feature (v0.2.0), client-only.
Brainstormed end-to-end with Chris (visual companion for the picker layout), built
**subagent-driven** in an isolated worktree (12 TDD tasks, per-task spec+quality
review + a final **opus** holistic review = **READY TO SQUASH**, no
critical/important). Attach a knowledge-library document's **full** content to a
message as a first-class attachment — the deliberate counterpart to retrieval's
snippets (Chris: *"über den Tellerrand rausschauen"* + *"ich will das ganze
Dokument da jetzt drinnen haben"*). **Equivalent to file upload** (one attachment
model, not two): same lightbox, rename, edit, in-stream rendering. **What landed:**
(1) **Copy-on-write** — a library attachment is a normal `kind:'text'`,
`origin:'library'` `AttachmentRow` carrying `kbRef:{libraryId,documentId}` and **no
copied `text`**; the invariant is **`text===undefined` ⇒ live reference**
(content read live), **`text` set ⇒ materialised**. Rename sets only `fileName`
(stays a reference); editing content materialises. (2) **Snapshot-on-send**
(`snapshotPendingDocumentReferences`) freezes the live content into the row **inside
the send transaction, before the bind**, so the existing wire path
(`resolveAttachmentParts` reads `a.text ?? ''`) is unchanged and the sent message is
**decoupled** from later source edits/deletes (WYSIWYG — Chris chose snapshot-on-send
over a persistent reference). (3) **Defensive materialisation**: deleting the source
document/library freezes any pending reference first. (4) **DocumentPicker** — a new
accordion-tree bottom-sheet (libraries expand in place — Chris dislikes drill-down,
see [[feedback_inline_over_hidden_navigation]]; **not** the ND-calm choice but his
call), **multi-select** across **all** libraries, **NSFW-gated** (`useFilteredLibraries`),
offered as a **third `(+)` source** "Attach from knowledge" (disabled-with-tooltip
when no libraries). **Embedding status is irrelevant** — any document is attachable
(attach uses raw content, not vectors). (5) **Lightbox** previews the **live**
content for an unmaterialised reference (`usePendingDocumentContents` → `effectiveText`)
and shows a **provenance** line (library › doc); `editSource` is gated until the live
content has loaded (closes a data-loss footgun the opus review found). **Adult-mode
default is `nsfw`** (a surprise a real test run surfaced — the picker NSFW test forces
SFW explicitly). **Not a Larissa change** (client-only; no auth/sync/proxy/crypto;
**no new network egress** — the content rides the existing outbound text-attachment
wire path). **Squash hygiene:** full-tree capture verified (`git diff master..branch`
empty, 18=18 files) + typecheck on master before worktree cleanup
([[feedback_verify_worktree_squash_captured_full_tree]]). Verification (on master
after squash): `pnpm typecheck` **14/14**; user-client vitest **1060 pass / 8 fail**
(the unchanged `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline,
**verified byte-identical to master + failing identically on master**); `pnpm run
build` **9/9**; biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-07-knowledgebase-chunk-b2-attach-document-design]],
[[../../../superpowers/plans/2026-06-07-knowledgebase-chunk-b2-attach-document]].
**Deferred (logged, all Minor):** invalidate the reference-preview query on source
edit (preview-only staleness), wrap `deleteLibraryCascade` in one transaction,
`aria-haspopup` on the cockpit menu triggers ([[insights/follow-ups-index]]).
**Device test (spec §10):** with a SFW library (several docs) + an adult library,
`(+)` → Attach from knowledge → the accordion lists all (adult hidden in a SFW chat) →
expand two, multi-select across both, attach → they appear like uploads → tap one →
lightbox shows the **live** Markdown + provenance → rename one, edit another (add a
note) → send → they render under the user message, the reply reflects the full
content → then edit/delete the source documents in My Knowledge: the sent message is
unchanged → attach a doc then delete its source library while still pending: the
attachment survives → with **no** libraries the menu item is disabled with the
tooltip. **Next:** Chris device-tests → Liz pushes the master backlog on his word;
then *Chunk C* (Lorebooks / phrase-triggered injection, reuse the `TagEditor` UX) per
[[ROADMAP]].
**Earlier 2026-06-06 — Save as artefact (artefact Chunk 4) landed
(squashed on master `7c907e5`, device-confirmed by Chris; being pushed).**
Block-2 feature, brainstormed end-to-end with Chris, built **subagent-driven**
(9 TDD tasks, per-task spec/quality review + a final **opus** holistic review =
READY TO SQUASH, no critical/important). Lift existing conversation content into
a first-class artefact, one-tap: a `◆ Save` control in `MessageControls`
(disabled-over-hidden with a tooltip when a message has no text) saves the
**concatenated visible text blocks** (reasoning/pills excluded) as a `markdown`
artefact; a **Save** button beside Copy on every fenced code block / Mermaid
diagram saves it with format/extension derived from the fence language. **What
landed:** (1) pure `fenceToArtefactMeta` (`lib/fence-to-artefact.ts`) — inverse
of the lightbox's `LANG_BY_EXT` — `html`→renderable HTML, `svg`→svg,
`mermaid`→mermaid, `markdown`/`md`→a first-class markdown artefact (so the
Treasury type filter and the lightbox `detectFormat` renderer agree), else
`code` (extension = a known alias or the token itself). (2)
`addSavedMessageArtefact`/`addSavedCodeBlockArtefact` + thin hooks
(`data/artefacts.ts`) mirroring `addGeneratedArtefact` — **no Dexie migration**
(v13 already carries the origins/formats). (3) An **`ArtefactSaveContext`**
provided by `MessageBlock` around its markdown carries chat/persona + the
code-block save callback to `CodeBlock`/`MermaidBlock`; **null outside a chat
message** (e.g. the lightbox doc preview) so no spurious Save button appears
there, and **no Save button mid-stream** (the streaming-draft path renders raw
spans, not Markdown). Copy's positioning moved into a shared `CodeBlockActions`
toolbar (Copy was used only there). (4) One-tap saves immediately + a `success`
toast; rename/tag later in the lightbox/Treasury. **Not a Larissa change**
(client-only; no new exec/network surface — a saved `html` block reuses the same
hard-sandboxed `HtmlPreview` as the Kern; logged in
[[insights/security-deferrals]]). The **opus holistic review found no
critical/important** cross-cutting issues (verified render-path coverage, the
Treasury↔lightbox round-trip, NSFW provenance, the unchanged SVG injection); one
minor follow-up logged (fence languages outside `detectFormat`'s `LANG_BY_EXT`
render un-highlighted in the lightbox — pre-existing, [[insights/follow-ups-index]]).
Verification: `pnpm typecheck` clean; `pnpm run build` **9/9**; user-client
vitest **997/997** (fully green); biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-06-save-as-artefact-design]],
[[../../../superpowers/plans/2026-06-06-save-as-artefact]]. **Device-confirmed by
Chris (2026-06-06) — "works wonderfully".** **Next:** Chunk 5 (iteration —
`edit_artefact(id, instruction)`, reuses the Kern author-subagent machinery) or
Block-1 memory (chatsune port) per [[ROADMAP]].
**Earlier 2026-06-06 — Artefacts as attachments (artefact Chunk 3)
landed (squashed on master `f43b33e`, NOT pushed; awaiting Chris's device
test).** Block-2 feature, brainstormed end-to-end with Chris (visual companion
for the entry-point + picker layout), built **subagent-driven** (7 TDD tasks,
per-task review + a final **opus** holistic review). Attach an existing artefact
to a chat message by copying a **snapshot** into the existing `attachments` flow
(re-use = copy, not reference; lifecycle decoupled — deleting the artefact later
never breaks a sent message). **What landed:** (1) `addArtefactSnapshot` +
`useAddArtefactSnapshots` (`data/attachments.ts`) map an `ArtefactRow` → a pending
`kind:'text'`, `origin:'upload'` attachment (content/fileName/mime only — no
title/tags); **no Dexie migration**, no provenance link. The existing send/wire
path carries it as a code-fenced text part and the lightbox previews it via the
extension-bearing `fileName` (so an HTML artefact renders in the sandbox, md as a
doc). **Text-only** (HTML/md/code/svg/mermaid are all `kind:'text'`; the future
TTI `kind:'image'` blob branch is a trivial later add). (2) The cockpit **`(+)`
button becomes a two-item source menu** (*Upload from device* / *Attach from
Treasury*) — only when an `onAttachFromTreasury` handler is wired (back-compat:
falls back to the direct file dialog otherwise). (3) A slim **`ArtefactPicker`**
bottom-sheet (`components/artefact/`): type tabs + fuzzy name search +
selection-only one-line rows + a sticky "Attach (N)"; **no persona/tag filter**
(search is the main entry, Duplo over Lego); **no in-picker preview** (inspect in
the Treasury). Selections resolve against the NSFW-gated `visibleRows` so they
**persist across tab/search changes** (the full selection is snapshotted, not
just the visible subset). **NSFW gating mirrors the Treasury** via
`useFilteredPersonas` — an adult persona's artefacts never reach the picker in
SFW mode. (4) Extracted **`useDismissOnOutside`** (`lib/`), shared by the new
`(+)` menu and the existing chat `(⋯)` menu. (5) The picker renders at chat-page
level and `.artefact-picker-root` is **exempted from `InteractionMode`'s
unpinned outside-tap close** (mirrors the other sheet overlays). **Not a Larissa
change** (client-only; no new exec/network surface — snapshots reuse the existing
hard-sandboxed lightbox viewers and the existing outbound wire path; logged in
[[insights/security-deferrals]]). The **opus holistic review caught one
cross-cutting bug** the per-task reviews missed — the picker root wasn't exempt
from the cockpit outside-tap close, so the first tap collapsed the cockpit
(fired in the primary chat-mode/unpinned case; tests missed it because the picker
was tested standalone) — fixed + regression-tested before squash; one Critical
in the picker-quality review (selection resolved against `filtered` → silent
no-op after a tab switch) was fixed mid-task. Verification: `pnpm run build`
**9/9**; `pnpm typecheck` clean; user-client vitest **972/972** (fully green);
biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-06-artefacts-as-attachments-design]],
[[../../../superpowers/plans/2026-06-06-artefacts-as-attachments]]. **Next:** Chris
device-tests the spec §12 checklist (incl. the cross-persona scenario: make an
artefact with persona A, attach it in a chat with persona B); then Chunk 4
(save-message / save-code-block as artefact) or Block-1 memory per [[ROADMAP]].
**Earlier 2026-06-06 — Treasury (artefact chunk 2) landed (squashed on
master `92100de`, NOT pushed; awaiting Chris's device test).** Block-2 feature,
brainstormed end-to-end with Chris (with the visual companion for the 380px filter
layout), built **subagent-driven** (10 TDD tasks, implementer + two-stage review
per task — spec then quality — + a final **opus** holistic review). A global
`/app/treasury` view over all chat-owned artefacts: **filter layout C** — segmented
type tabs (`All/Apps/Docs/Code/Img`) + a ⚙ filter sheet (persona via the reused
`PersonaFilterDropdown`, tags via a shared `TagEditor` in pick-mode, favourites,
disabled project row) + compact fuzzy name search + removable active-filter chips;
**two-line rows** (`TreasuryRow`, decision #20); the lightbox cycles over the
**filtered** set. **Tags are editable in both** the lightbox (single artefact —
reachable from a chat pill *or* the treasury) and the Treasury (bulk). **Multi-select
= a visible "Select" header button** → floating action bar (🏷 bulk Tag + 🗑 Delete
with an inline confirm) — **no long-press** (Chris's call). New global queries +
bulk/cross-chat mutations in `data/artefacts.ts` (no Dexie migration — the v13 table
already carries `tags`/`favourite`/`personaId`); **chat deletion now invalidates
artefact queries** (was a latent staleness bug, surfaced by the global view); the
**Entrance-Hall tile is live** (count meta). **`read_artefact` deferred** (Chunk 3 is
the real feed-back path). **Not a Larissa change** (client-only; previews reuse the
existing hard-sandboxed `HtmlPreview` — no new exec/network surface; logged in
[[insights/security-deferrals]]). The holistic review caught + fixed a **privacy leak**
(an NSFW persona's artefacts *and their tags* must not surface in the SFW view) and a
spec-§6 gap (persona filter must auto-reset when its persona hides) before squash.
Verification: `pnpm typecheck` **14/14**; `pnpm run build` **9/9**; user-client vitest
**959/959** (fully green); biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-06-treasury-design]],
[[../../../superpowers/plans/2026-06-06-treasury]]. **Device-fix round (master `382afa0` →
`ebd3d49`, NOT pushed; root-caused via the debugging skill; both device-confirmed
by Chris):** (1) **lightbox open no longer pops.** Root cause was paint timing — the
open FLIP ran in `useEffect`, which fires *after* the first paint, so the surface
painted full-size for a frame (the pop) before the from-transform was applied and the
transition had no painted start. (Close was fine — it animates away from the
already-painted open state.) Fix: run the open FLIP in **`useLayoutEffect`** (from-
transform lands before first paint) with a **forced reflow** to commit it as the
transition's start value; plus a fallback origin (off-screen-bottom, mirror of the
close fallback) so open animates even when the origin row is gone by mount time
(e.g. the sidebar closes on open). (2) **two-tap-to-open in the sidebar** fixed — the
sheet overlays (`.artefact-sheet-root`/`.toc-sheet-root`/`.branch-sheet-root`) are now
exempt from `InteractionMode`'s unpinned outside-tap handler (they render at chat-page
level, so the first tap was swallowed + collapsed the cockpit instead of reaching the
row) — same class as the earlier `.lightbox-root` exemption (with a regression test).
Verified: typecheck 14/14, vitest **960/960**, biome clean. **Next:** Chunk 3
(artefacts as attachments) or Block-1 memory per [[ROADMAP]].
**Earlier 2026-06-06 — Lightbox viewer landed, device-tested by Chris &
merged to master (`8b35592`, NOT pushed).** Built in an isolated worktree
(`worktree-lightbox-viewer`, squashed to `00c1396`) while Chris device-tested chat on
master, then fast-forward-merged + worktree cleaned up; **three device-feedback fixes
folded in on top** (detailed at the end of this entry — all confirmed by Chris).
Block-2 viewer feature, brainstormed end-to-end with Chris, built **subagent-driven**
(11 plan tasks, per-task review + a final **opus** holistic review = READY TO
SQUASH, no critical/important). **Viewer only — artefact *generation* is a deliberate
separate next scope Chris wants to do cleanly afterwards.** **What landed:** (1) a
pure `detectFormat(fileName, mime)` (`lightbox/format-detect.ts`) so a text item's
**preview format** is derived from its extension/MIME (not from `kind`); the body
dispatches to one small preview each. (2) Five standalone viewers (`lightbox/previews/`):
**MarkdownDoc** (reuses the chat `MarkdownContent` GFM/KaTeX/Mermaid/Shiki pipeline in
a generous **Aurora** `.lightbox-doc` document container — lilac, *not* chatsune's
gold; chat path untouched), **CodePreview** (whole-file shiki, no collapse),
**HtmlPreview** (hard-sandboxed iframe: `allow-scripts` with **no** `allow-same-origin`
→ null origin, no MK/IndexedDB access; strict CSP `default-src 'none'` blocks all
external network → no IP-leak; Escape→postMessage bridge), **SvgPreview** (base64
data-uri `<img>`, no script exec), **MermaidPreview** (whole file via the lazy
`MermaidBlock`). (3) "How it works" chrome: a custom **Aurora format-override
dropdown** (`FormatPicker`, modelled on `PersonaFilterDropdown` — no native
`<select>`), **Copy**, **Download**; `ViewableItem` now carries `mime`, `Caps` gains
`copy`, copy/download enabled for text items of any origin. (4) **Symmetric
close-zoom** (Part b): the lightbox takes `getOriginRect(id)` (caller resolves via
`[data-attachment-thumb]`) instead of a static rect; open FLIP unchanged, on close it
**re-measures** the current item's thumb → zooms back, or **downward off-screen + fade**
when scrolled away/detached; 220ms, reduced-motion-aware, no double-close/stale-closure.
(5) Uploads now accept **`.svg`/`.mmd`/`.mermaid`** as text so the SVG/Mermaid viewers
have a source. **JSX/SPA preview deliberately deferred** to the artefact-generation
work (no third-party CDN — chatsune loaded React+Babel from unpkg, rejected on
zero-knowledge grounds); recorded in [[insights/follow-ups-index]] (Active —
Implementation) and [[insights/security-deferrals]]. **Not a Larissa change**
(client-only; the new iframe-exec/render surface is logged in security-deferrals).
Verification (on the branch): `pnpm typecheck` **14/14**; `pnpm run build` **9/9**;
user-client vitest **900/900** (fully green — the old localStorage-jsdom baseline did
not manifest); biome clean. Spec/plan:
[[../../../superpowers/specs/2026-06-06-lightbox-viewer-design]],
[[../../../superpowers/plans/2026-06-06-lightbox-viewer]].
**Device-feedback round (squashed on master, NOT pushed; all confirmed by Chris):**
(a) `f508684` — **clicks inside the lightbox no longer collapse the cockpit.** The
lightbox is portalled to `<body>`, so a pointerdown in it counted as "outside"
`InteractionMode`'s container; the unpinned outside-tap handler collapsed interaction
mode (unmounting the Cockpit + the lightbox it renders), so *any* in-lightbox click
closed it. Fixed by exempting `.lightbox-root` from the outside-tap handler (mirrors
the existing `.brand-logo` exemption). Pre-existing since the lightbox was portalled to
body; surfaced by the new text/source viewer. (b) `37a2c3a` — **source-editing UX:**
the Preview/Source toggle is now pinned (only the content scrolls, via a
`.lightbox-scroll` region); the source editor fills the whole content area; editing is
explicit — the draft + last-saved baseline were lifted into the Lightbox and the
blur-auto-save removed, with a **Save** button (top-right) + **Undo**, both
disabled-until-dirty; closing/navigating while dirty opens an inline **Save / Discard /
Cancel** confirm bar. (c) `8b35592` — the **toolbar wraps** (`.lightbox-actions`,
`flex-wrap`) so on mobile-first 380px widths no action (Save / ×) is clipped.
Verification after the round: `pnpm typecheck` **14/14**, `pnpm run build` **9/9**,
user-client vitest **906/906**, biome clean. **Next: the artefact-generation session**
— Chris's favourite feature; JSX/SPA preview belongs there (locally-bundled transpiler,
never a third-party CDN — see [[insights/follow-ups-index]] / [[insights/security-deferrals]]).
**Earlier 2026-06-05 — Unified lightbox & user attachments landed
(squashed on master `987c885`, device-tested by Chris — two device fixes folded
in; being pushed).**
Block-2 feature, brainstormed end-to-end with Chris (visual companion for the
cockpit/lightbox layout), built **subagent-driven** (18 plan tasks, serial
implementers + per-task review + a final **opus** holistic review = ready-to-merge).
The deferred image-attachment subsystem is now real. **What landed:** (1) a new
`attachments` Dexie table (**v12**) — first-class rows joined to a user message by
`messageId` (null while pending, local to the chat); `state:'deleted'` reserved for
future generated-content. (2) A **single unified lightbox** (`components/lightbox/`)
fed `ViewableItem[]` + index + a `caps` descriptor — chrome by `origin`, body by
`kind`, **Preview/Source** (editable, pending-only) for text/markdown, loop
navigation, **FLIP zoom**; the seam the future artefact feature plugs into.
(3) **Upload** via the (now-live) `(+)` picker, clipboard paste, and OS file drop
(desktop; deliberately distinct from in-app drag-and-drop per §11). (4) **Client-side
image normalisation** (1024px JPEG, alpha→white, GIF first-frame, EXIF applied;
chatsune's rules ported to the browser since we have no backend) — store-and-send the
normalised copy only (WYSIWYG). (5) Cockpit thumbnail strip
(controls→divider→strip→input; **no ×**, removal via the lightbox — Chris's
anti-misclick choice) and sent-attachment strips under the user message.
(6) **Multimodal wire injection** (image_url / substitute-description / placeholder;
filename always carried). (7) **Global substitute vision model** (My Settings, real
picker) — chatsune's mechanism ported client-side, used only when the active model
can't see images; description cached on the attachment row. **Not a Larissa change**
(client-only + an `llm-unified` one-shot; outbound surface logged in
[[insights/security-deferrals]]). **Deferred by design:** prior-turn attachment
replay (spec §9 — a vision model "forgets" an attached image after its turn; clean
extension point), and the generated-content producers (artefact / image-gen). One
review finding fixed pre-finish: a corrupt substitute key could block any send → now
degrades to "no substitute". Verification (on master after the squash): `pnpm
typecheck` **14/14**; `pnpm run build` **9/9**; user-client vitest **871/871**;
llm-unified `bun test` **276/0**; biome clean. **Device-test fixes (folded into the
squash):** (1) the cockpit strip now clears on send — `useSendMessage` invalidates
the `attachmentsPending` query once attachments bind to the message; (2) the lightbox
was confined to the cockpit because `.cockpit`'s `backdrop-filter` establishes a
containing block for `position: fixed` — now **portalled to `<body>`** so it covers
the whole viewport (escapes the backdrop-filter and any stream transform). Both
device-confirmed by Chris. Spec/plan:
[[../../../superpowers/specs/2026-06-05-unified-lightbox-and-attachments-design]],
[[../../../superpowers/plans/2026-06-05-unified-lightbox-and-attachments]]. **Next:** Liz
pushes the master backlog (Chris green-lit). Then memory (the long-weekend item) per
[[ROADMAP]].
**Earlier 2026-06-03 (evening) — Ollama Cloud is now a web backend
(search + fetch), and the web-backend default is first-come with fallback.** On
master, NOT yet pushed (the earlier round below was pushed). Two pieces, spec +
plan in `superpowers/{specs,plans}/2026-06-03-ollama-web-and-first-come-default*`:
**(A) Ollama web** — a new `ollama-web` adapter (`web-adapters/ollama-web.ts`,
mirrors nano-gpt-web) hitting `ollama.com/api/web_search` + `/api/web_fetch`
(Bearer, same `ollama-cloud` key as LLM), routed through the CORS proxy. Two
catalogue offerings: `web-ollama-search` (traits `ai`, tiers standard 5 / quick 3
/ deep 10) and `web-ollama-fetch`. Live-verified **4/4** via
`run-ollama-web-suite.ts` (5/3/10 hits prove the `max_results` mapping; fetch 940
chars). **(B) First-come default** — usable providers are now ordered by
`createdAt`, so the first-configured web provider is the default per role; and
`resolveWebBackend` falls back to the next-best when an explicit pick's
key/provider is deleted, instead of going dark. No active key-event mechanism —
the live per-message resolution handles it; the stored pick reactivates if its key
returns. Record: [[providers/ollama-cloud]] (Web interfacing section). **Next:**
squash into 2 feature units + doc, then Chris device-tests the §6 steps (ollama-
first vs nano-gpt-first defaults, delete-active-key fallback, a real search+fetch
in chat); Liz pushes on Chris's word.
**Earlier 2026-06-03 (afternoon) — Web interfacing device-tested + hardened;
ollama-cloud onboarded for web search (pushed).** A long feedback round after the
landing. **(1) Web-settings UI** (`d07fb89`, `9445623`): the raw section is now an
`AccordionCard` like the others; the search picker lists only search backends
(Linkup default/Exa/Brave) and fetch only nano-gpt, with friendly "Engine
(provider)" names and a concrete pre-selected default (no abstract "Default"
entry); a styling pass (dark custom-chevron selects, marker-pill traits, ZK note).
**(2) ollama-cloud onboarded for web search** — a deep, four-layer debug
(Chris's instinct to check chatsune was the key). The generic adapter path was
incomplete: it never sent `tools` (`a4bc53d`) nor `stream_options`/usage
(`a39579c`) — both fixed for *any* generic OpenAI-compatible provider. The real
fix is a **native ollama `/api/chat` (NDJSON) adapter** (`d9af9a6`): ollama's
OpenAI-compat `/v1` shim makes reasoning-native models **re-call the tool instead
of answering** after a tool result; the native endpoint answers (chatsune's path).
The adapter framework gained two general hooks — **`WireRequest.path` +
`ModelAdapter.responseFraming` (`'sse' | 'ndjson'`)** + `parseWithAdapterNdjson` —
so any non-OpenAI provider can now plug in. ollama-cloud = `glm-5.1` +
`deepseek-v4-pro` (both fixed-on, verified catalogue; dead slugs + non-reasoning
gemma dropped). **(3) web_search prompt nudge** (`3d66435`): glm-5.1 searched
endlessly (its nature); a restrictive description + "search on request, two or
three are plenty, then answer" (chatsune pattern + Chris's idea) makes it settle —
**model-wide** improvement. Live-verified end-to-end through the real client path:
glm answers in round 1, deepseek by round 4. **Lesson (worth keeping):** the
conversation-suite validates the *pipe* (a tool *fires*), NOT the *loop* (the
model *answers* after the tool result) — that gap let both the `/v1` re-search and
glm's churn pass green; verify multi-turn tool-loop behaviour on device, or extend
the suite with a post-tool-answer assertion (noted in
[[providers/ollama-cloud]]). Records: [[providers/ollama-cloud]],
[[feedback_verify_tool_loop_answers_not_just_fires]]. **Next:** Liz pushes the
master backlog (now 10 ahead) when Chris says; then memory (the long-weekend item).
**Earlier 2026-06-03 — Web interfacing live via nano-gpt (squashed on
master `1bf5462`, NOT pushed; awaiting Chris's device test — his VPS CORS proxy
is up + already tested, so it should work immediately).** The dormant spine is
now wired end-to-end: a nano-gpt **search** adapter (`/api/web` — Linkup/Exa/
Brave) + **fetch** adapter (`/scrape-urls`), both reusing the `buildRequest`
transport primitive; **three curated `web` search offerings** (Linkup default,
Exa, Brave; Kagi deferred — empirically the *priciest*, not the cheapest) + a
scrape fetch offering. `WebOfferingMeta` gained `traits`/`requiresProxy`/
`searchTiers` (dropping `qualityClass`; `ai-friendly` folded into an `ai` trait).
**CORS is the load-bearing finding:** the web endpoints send no CORS headers
(chat does), so web search/fetch **must route through the user's CORS proxy**
(the `requires-proxy` rail) — modelled as data on the offering, decoupled from
nano-gpt's chat `corsHint: inofficial`. The web tools are **gated on a configured
proxy**: without one, the settings section shows a "needs a proxy" notice
(disabled-over-hidden) and no tool is offered. **Auto-default Linkup** (unset →
recommended; explicit Off available) so web-search *availability* isn't gatekept
to power users; **search depth** is a per-message cockpit control (Exa Quick/
Neural, Linkup Standard/Deep) curated per offering, user-set, cheapest-default.
Proxy + selected tier are threaded through the shared send path; settings carry
trait badges + a **zero-knowledge note** ("queries leave your device"). Built
subagent-driven (14 TDD tasks, serial + per-task spec/quality review + a final
**opus** holistic review that caught a real Critical — the UI advertised an
auto-on web search that silently no-opped without a proxy; fixed before squash).
**Live conversation-suite** (`run-web-suite.ts`, direct-routing in Bun) **6/6**:
every curated tier verified live (Exa `numResults:8` + `neural` honoured). **Not
a Larissa change** (llm-unified + user-client; no auth/sync/proxy/crypto); the
realised outbound surface logged in [[insights/security-deferrals]]. Verification
(on master after the squash): `pnpm typecheck` **13/13**; llm-unified `bun test`
**260/0**; user-client vitest **802 pass / 8 fail** (the unchanged `cockpit-draft`/
`chat-page`/`chat-route` localStorage-jsdom baseline); build **9/9**. Spec/plan:
[[../../../superpowers/specs/2026-06-03-web-interfacing-nano-gpt-adapter-design]],
[[../../../superpowers/plans/2026-06-03-web-interfacing-nano-gpt-adapter]]. **Note:** the
first squash captured only Tasks 1–7 (a stale worktree branch-ref via `git -C`);
recovered by squashing the dangling branch-tip tree, re-verified on master before
commit. **Next:** Chris device-tests web search/fetch end-to-end (proxy is up) →
Liz pushes the master backlog; then memory (the long-weekend item).
**Earlier 2026-06-02 — Web-interfacing integration spine
landed (merged to master via PR #1 `7fd4692`, NOT pushed; Chris to device-test
+ integrate).** Implemented from the Liz/Lyra
spec end-to-end, strict TDD per task. The dormant *integration spine* — a
first-class `Integration` abstraction (the counterpart to `Tool`) — with web
interfacing (`web_search` + `web_fetch`) as its first case, wired and gated but
provider-less; the only work left to go live is the nano-gpt web adapter +
curating the `web` offerings. **What landed:** (1) **llm-unified** type
contracts (`WebContext`/`WebLocation`/`WebSearchResult`/`WebFetchResult`/
`WebQualityClass`/`WebOfferingMeta`/`WebInterfacingProvider`), an optional
`Offering.web` metadata block, and a `web-adapter-registry` (empty today →
nothing resolves → dormant). (2) **user-client** `Integration`/
`IntegrationContext`/`OfferingRef` types; the `WebInterfacing` integration
(`integrations/web/`) owning both tools, contributing each only when a selected
`web` offering's `canSearch`/`canFetch` **and** a resolved adapter agree; an
`INTEGRATIONS` array. (3) The **tool registry** evolved from a static list to
`resolveActiveTools(ctx)` = static (`calculate_js`) + active-integration tools;
`toolDefs`/`systemPromptSegment`/`dispatch` are now pure over an explicit
`Tool[]`. (4) **Dexie v11**: `SettingsRow.webInterfacing = { search, fetch }`,
migration backfill + seed default `{ null, null }` (existing fresh-open verno
assertions bumped 10→11). (5) `buildIntegrationContext(persona, web, mk)` per
send (NSFW from `adultPersona`; location deferred → null; credential-bus
`getKey`, MasterKey-gated, call-time only); the **stream-manager** builds it and
threads the ctx-bound active tools into the existing tool-loop seam (loop logic
unchanged); `send-message` threads `webInterfacing` from settings into
`start`/`regenerate`. (6) A functional **unstyled** `WebInterfacingSection` in
My Settings (two independent pickers, disabled-over-hidden *within*), gated
**hidden-until-unlocked** on the `web` modality — invisible today because no
`web` offering is curated. **Dormant + zero-regression:** at zero `web`
offerings the model is offered only `calculate_js`, exactly as before. **Not a
Larissa change** (client-only, no auth/sync/proxy/crypto); the *planned*
outbound surface for the future adapter is recorded in
[[insights/security-deferrals]]. **Deferred by design:** the nano-gpt adapter
(next), the `WebLocation` *source* (shape threaded, flows `null`), the opulent
styling pass. **One design fix during verification:** the default integration
now references the live catalogue/registry resolvers *lazily* (arrow-wrapped) so
unrelated tests that partially mock `@chatsundere/llm-unified` and merely import
the integration chain don't trip on missing exports at module load.
Verification: `pnpm typecheck` **13/13**; llm-unified `bun test` **248 pass / 1
fail** (the pre-existing `canonical-registry` double-registration ordering flake
— passes in isolation, identical on master); `pnpm run build` **9/9**;
user-client vitest **764 pass / 0 fail** (fully green — the previously-noted
`cockpit`/`chat` jsdom flakes did not manifest in a clean-container build).
Spec/plan:
[[../../../superpowers/specs/2026-06-02-web-interfacing-integration-spine-design]],
[[../../../superpowers/plans/2026-06-02-web-interfacing-integration-spine]]. **Next:**
the **nano-gpt web adapter** — write it, register it in the
`web-adapter-registry`, curate the `web` offerings (brave/exa/linkup, each its
own offering); the section then auto-appears and web search/fetch go live. Then
memory (the long-weekend item).
**Earlier 2026-06-02 — Tool-execution spine +
`calculate_js` landed (squashed on master `ec3515f`, NOT pushed; awaiting
Chris's device test).** Brainstormed end-to-end with Chris, built
subagent-driven in an isolated worktree (12 tasks, serial implementers +
per-task review + a final **opus** holistic review = READY TO SQUASH). The
first of the planned "three tools"; `web_search`/`web_fetch` are a separate,
larger nano-gpt **integration** axis (0..n keyed by the user's API keys),
deliberately out of scope here. **What landed:** the missing *head and tail*
of tool support — the wire layer was already tool-ready, but tool defs were
never sent and a streamed tool-call became an inert `completed` pill that was
never executed. Now: (1) an **always-on class-based tool registry**
(`apps/user-client/src/tools/`) — each `Tool` carries its wire `ToolDef`, an
optional `systemPromptInstruction: string | null`, and an `execute`; helpers
`toolDefs()` / `systemPromptSegment()` / `dispatch()`. **No tool toggle**
(omakase + curation — any model that misbehaves with reasoning+tools is a
curation exclusion, not a feature). (2) **`calculate_js`** runs in a **fresh
Web Worker per call** (dangerous globals nulled on `self` + function-locally,
**4 KB** output cap, **10 s** timeout, terminated on success/timeout/abort);
the contract returns captured `console.*` **plus the completion value of the
final expression** (direct `eval` inside a `new Function` scope — kills
chatsune's empty-output trap). (3) The **tool-execution loop**
(`lib/tool-loop.ts`, pure + injected deps): inject defs → detect tool-call
pills → `dispatch` → append `assistant(tool_calls)` + `tool` messages →
re-stream; **capped at `MAX_TOOL_ROUNDS = 5` tool rounds** (counted globally
across all future tools — Chris's Gardasee example), then a forced tools-less
answer. (4) `stream-engine` gained `tools`/`toolExchange`/`toolsInstruction`
(pills now default `pending`); `stream-manager` binds the loop (gated on
`offering.profile.toolCalls.supported`) and **mirrors live pill status**
(`pending→completed/failed`) into the streaming draft via `onPillUpdate` +
`ChatStream` pill-buffer merge. (5) **Band-3 tools segment** in the prompt
builder (chat-only) — finally a producer for the reserved slot. (6) **Pill is
tap-to-expand** showing the executed code + result/error. **Persistence
boundary (deliberate):** the result is persisted in the pill payload, but
cross-turn replay of the tool exchange to the model stays **deferred** (like
chatsune) — the final answer text carries the result. **Not a Larissa change**
(no auth/sync/proxy/crypto); the JS-eval sandbox is logged in
[[insights/security-deferrals]]. **Process note worth keeping:** the full
vitest run (Task 11) caught a regression the per-task reviewers missed — they
ran typecheck + the touched test dir, not the full suite. The store now reads
`args.offering.profile`, which broke `stream-manager-store.test.ts`: its stub
used a **stale `model` key** (pre-catalogue-migration) instead of `offering`,
masked for ages by an `as never` cast because the store never read the
offering directly. Reinforces [[feedback_per_task_review_runs_full_suite]] —
per-task verification must run the **full** vitest. Verification: `pnpm
typecheck` **13/13**; llm-unified `bun test` **251/0**; user-client vitest
**738 pass / 8 fail** (the unchanged pre-existing `cockpit-draft`/`chat-page`/
`chat-route` localStorage-jsdom baseline, confirmed identical on master);
build **9/9** (`sandbox.worker.ts` emitted as its own chunk). Spec/plan:
[[../../../superpowers/specs/2026-06-02-calculate-js-tool-spine-design]],
[[../../../superpowers/plans/2026-06-02-calculate-js-tool-spine]]. **Next:** Chris
device-tests the 6 manual steps (spec §11 — the strawberry question returns 3
via an expandable pill; a provoked sandbox error recovers; a maths-free chat
is unchanged); then `web_search`/`web_fetch` as the larger nano-gpt
integration, and memory (the long-weekend item).
