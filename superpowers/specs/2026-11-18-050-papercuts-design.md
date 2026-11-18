# 0.5.0 papercuts — design

**Date:** 2026-11-18 · **Target:** 0.5.0 on `master` · **Branch:** `feat/050-papercuts` · **Size:** eleven small items, one squash

## Why

0.5.0 is the last large release before the Eidolon integration (decided by Chris, 2026-11-18): after it only bug fixes and newly curated models follow, so whatever misleads or strands a user now stays with them for a long time. This unit collects the small faults that do: the "never misled, never stranded" findings of the 2026-11-18 mobile UX sweep (findings 2, 3, 4, 8, 9, 14), overdue rows of the ledger (`obsidian/insights/follow-ups-index.md`, `ux-deferrals.md`) and two privacy texts owed since before v0.4.0 (`security-deferrals.md`).

## Goals

- No control in the chat or the first run shows something false or leads to the wrong page.
- Every repair link touched here goes to the page that fixes the problem and brings the user back to where they started.
- No failed send, memory action or key test leaves the user without the reason and a way to fix it.
- The privacy notes say which providers see tool output.

## Non-goals

- **How the PageBar's Back works in general.** That is the "Back means one thing" unit, built by another session. This unit only makes links carry a `?return=` target and makes the pages they open honour it as their `back` prop.
- Anything Eidolon rebuilds: Projects, memory (beyond the one error path of item 9), knowledge editing, the tool loop.
- Touch-target sizes, the quick menu's position, the cockpit row's layout (the thumb pass and later design work).
- The parallel units' areas: the sense-of-time switch on the persona pages, chat export (its new quick-menu entry), the reduce-animations switch, search in History, voice wake lock and lock-screen controls.

## Anti-goals

- No new return convention. `?return=`, validated by `safeReturnPath` (`lib/safe-return.ts`), is the only one; `location.state.returnTo` on the voice page is retired.
- No hidden capability: an unavailable entry stays visible with its reason (CLAUDE.md §11).
- No behaviour change in what reaches any provider (item 11 is copy only).

## The return convention (applies to items 2, 3, 4, 5, 8, 9)

A link that leaves for a repair carries `?return=<pathname + search of where the user is>`. The page it opens reads `safeReturnPath(search.get('return'), <its current back>)` and passes the result as its `back`. A page that sends the user on again (Font & Voice → Settings → Voice) passes its own full URL, including its own `?return=`, so the chain unwinds one step at a time. Pages that gain this: Settings → Voice (replacing `location.state`), Settings → Expert, Settings → AI Providers (the list), the persona's Font & Voice page, My Circle, Account → Server linking. Settings → Images, the provider page, the persona hub, Memory, Knowledge and History already do it.

## A. Places where the app misleads or strands the user

### 1. The top bar's journal pill

`InteractionTopbar.tsx:159` renders a fixed `0` beside a pulsing dot titled "Uncommitted journal entries". The real count exists (`useUncommittedCount(personaId)`, used by the cockpit's Memory button, `Cockpit.tsx:282`).

**Proposal (open question Q1):** wire it to `useUncommittedCount`. At 0 the pill is not shown; above 0 it shows the count with the pulsing dot and is a button "N memories to review" that opens the persona's memory page with `?return=` the chat. Why not remove: in reading mode with the cockpit collapsed, the top bar is the only place a pending memory is visible.

### 2. The cockpit's voice note, routed by reason

`Cockpit.tsx:689`: the button "Settings → Voice" opens `/app/settings` for every reason. New targets, each with `?return=` the chat:

| `voiceUnavailable` | Button | Target |
|---|---|---|
| `no-provider` | Set up voice | `/app/settings/voice` |
| `no-voice` | Choose a voice | `/app/persona/<id>/font-voice` |
| `voices-unavailable` | Voice settings | `/app/settings/voice` (where the service is chosen) |

The Read note in `MessageControls.tsx` ("Set up a TTS provider in My Settings", "Choose a voice for this persona in its editor") gains the same link beside its text: the note already appears on tap, so the link is reachable on touch. `MessageControls` gets the persona id and the chat's return URL, or one `onFixRead(reason)` callback from the chat page; the builder picks whichever keeps the props smaller.

### 3. Side trips that come home

- **Setup card.** `entrance-hall.tsx:58`: "Connect a provider" goes to `/app/settings/providers?return=/app` instead of the Settings overview.
- **Next step after a key.** The AI Providers list shows a card at its top when at least one provider with a chat model is enabled and no companion exists yet: "Next: create your first companion ›" → `/app/persona/new`. It needs no state and disappears once a persona exists. Why here: saving a key returns the user to this list (`provider.tsx:88`, `back()` after a successful test), so this is where they land the moment they are ready. The provider picker passes the list's own URL as `?return=` to the provider page, so the list's `?return=/app` survives the round trip.
- **Repair links.** The artefact-expert error in the cockpit (`Cockpit.tsx:671`, `/app/settings/expert`) and "Provider missing" in My Circle (`circle.tsx:174`, `/app/settings/providers`) carry `?return=` (the chat, `/app/circle`). The add-provider picker's "Open server linking →" carries the providers list as `?return=`.
- **Voice page.** `routes/app/settings/voice.tsx` reads `?return=` instead of `location.state`; its one sender, the Font & Voice page's "change in My Settings → Voice" link (`font-voice.tsx:122`), switches to `?return=`.

### 4. The quick menu: My Circle and Voice settings

`ChatQuickMenu.tsx`: add **My Circle** (`/app/circle?return=<chat>`) to the first group, under Entrance Hall, and **Voice settings** (`/app/settings/voice?return=<chat>`) beside Image settings in the last group. Switching persona drops from four taps to three (menu → My Circle → Continue / New chat). The chat-export unit adds an entry to the same file; the merge is expected and small.

### 5. Which model answers

`CockpitMenu.tsx` gains a read-only first row: **Model** · `<offering displayName> · <provider displayName>`, with a link "change on the persona ›" to `/app/persona/<id>?return=<chat>` (the model picker lives on the persona hub, `hub.tsx:466`). Without a resolved offering it reads "No model chosen · choose on the persona ›". Why read-only: the model belongs to the persona, and a per-chat override is a feature, not a papercut.

### 6. Wording and guidance

| Where | Today | Change |
|---|---|---|
| `providers.tsx:78`, empty list | "Your Circle has no voice yet — add a provider to begin." | "No AI providers yet. Add one so your companions can answer." |
| `InteractionTopbar.tsx:148` | "(no project)" under the chat title | Nothing is rendered when the chat has no project (projects are not modelled yet; the prop stays for later). |
| `artefacts-page.tsx:94`, empty | "Artefacts you create appear here." | "Nothing here yet. Ask {persona} to make one, such as a document, a page or a small app, or keep any message with ◆ Save." (the builder checks that "◆ Save" is the label users see) |
| Entrance Hall | no `?` help | A `?` in the welcome header, as on every other main screen, with a new `content/help/entrance-hall.md`: what the eight tiles are, in one line each, naming Treasury and Integrations plainly. |
| `provider.tsx:270`, failed key test | "✗ 0 · Failed to fetch" | A client-side mapping of the probe result to a cause and a next step (below); the raw detail stays, smaller, underneath. |
| `AddProviderPicker.tsx:82` | the server-gate text under every gated provider | Gated providers move to the end of the list under one heading "Need a linked server" with the reason and the "Open server linking →" link once; each gated row keeps a short "Needs a linked server" tag, so its reason is still visible on the row. |

Key test mapping (in `provider.tsx`, no change to `packages/llm-unified`):

- status 0, provider routed direct: "Couldn't reach {provider}. Check your connection. If it works, {provider} may refuse requests from browsers; tell us, as it then needs a linked server's relay."
- status 0, routed through the relay: "Couldn't reach {provider} through your server's relay. Check your connection, or try again in a moment."
- 401, 403: "{provider} didn't accept this key. Check that it was copied in full and is still active."
- 429: "{provider} is busy or rate-limiting this key. Try again in a minute."
- anything else: "{provider} answered with an error ({status})."

## B. Faults from the ledger

### 7. A send that silently does nothing

Two failures in `resolvePersonaContext` (`data/send-message.ts:133`) reject `sendMessage.mutateAsync` from `void onSend(t)` (`chat-page.tsx:619`) with nothing on screen:

- `openSecret` throws WebCrypto `OperationError` when the provider key was sealed under an earlier master key (ledger, 2026-07-04).
- `mk` is null (`send-message.ts:136, 556`), see Q2.

**Fix:** `resolvePersonaContext` wraps its `openSecret` call and throws a typed `ProviderKeyLockedError { templateId, providerName }`; the missing-mk throw becomes a typed `MasterKeyUnavailableError`. `onSend`, regenerate and the opener catch both (any other error keeps today's path) and show a note in the cockpit's note slot, like the artefact-expert note:

- key: "Your saved key for {provider} can't be unlocked on this account. Enter it again to keep chatting." · **Re-enter key** → `/app/settings/providers/<templateId>?return=<chat>` · Dismiss
- master key: "Chatsundere needs your passphrase once more before it can use your keys." · **Unlock** → `/login?return=<chat>` · Dismiss

The draft is already kept on failure (`setDraft('')` runs only after success); a test pins that. Background chores keep their silent fallback. The error carries the template id and display name only, never key material or the ciphertext.

### 8. Four MCP sign-in findings (Laura, 2026-11-03)

- **S1, approval behind the overlay.** `McpSignInOverlay` renders nothing while `useMcpApprovalStore` holds a pending request and appears once the queue is empty, its target kept. Why hold rather than raise the approval: the approval is the question the user's tool call is waiting on; a sign-in can wait for it.
- **S4, resume a kept sign-in.** When the overlay opens for a server that has a pending sign-in on this device (`usePendingSignIns`, as the detail page uses at `server.tsx:299`), it opens `OAuthSignInFlow` with that `state`, straight on the waiting screen, instead of running a new check. This is the one item that may grow (the overlay has no discovery for a resumed flow); if it needs more than passing `state`, I drop it and say so in the report.
- **S7, "Needs a linked Chatsundere server".** The detail page shows a **Link a server** button beside the status, to `/app/account/server-linking?return=/app/integrations/<id>`.
- **S11, the draft survives Back.** The `sign-in` phase of `AddServer` (`server.tsx:119`) carries the last `ServerDraft`; `flow`'s `back` restores it, and `SignInSettings` takes it as its initial values.

### 9. Memory's `no-credentials` error

`persona-memory.tsx:32` says "Credentials unavailable — re-authenticate, then retry." with only Retry. `no-credentials` means the session has no master key (`memory/resolve-args.ts:66, 88`). New copy: "Chatsundere needs your passphrase once more before it can reach your AI provider." with **Unlock** → `/login?return=<this memory page, with its own query>`, beside Retry. Only this error path changes. The builder checks on the running client that `/login` with an active session shows the unlock form and returns to the target afterwards (`safeReturnTarget`, `login/index.tsx:44`); if it redirects instead, the button calls the same lock the app uses before navigating, and I note it in the report.

### 10. Trash auto-purge without a server

`purgeTrash` runs only at the start of a sync cycle (`sync/worker.ts:1250`), so local-only users never have expired trash removed. **Fix:** move it to `trash/purge.ts` as `purgeExpiredTrash()` (expired rows, then `sweepOrphanRevisions`), called by the sync cycle as today and by `activateSession` (`boot/activate-session.ts:34`) on every unlock, for everyone, replacing the bare `sweepOrphanRevisions` call there. Like today's sweep, it never delays or fails an unlock. For a linked user an unlock purge does what the first cycle would do a moment later; the rule (`purgeAt <= now`) is unchanged. The order-dependent purge tests in `tests/sync/worker.test.ts` (ledger, 2026-10-09) are made independent while touched.

## C. Two privacy texts (copy only)

### 11. Tool output and the background helper

Security deferrals Tool-replay L-3 (Low) and Summaries M-2 (Medium), both "before v0.4.0":

- `content/about/privacy.md` gains a section **Which provider sees what?**: your companion's provider sees the conversation; if you set a background helper, its provider sees what it works on (chat titles, memory, compaction of long conversations and summaries of long tool results, up to 48,000 characters of each, including output from integrations and Ask an expert); after you change a persona's model mid-chat, the new provider receives the earlier conversation, tool results included. Our server sees none of it.
- The helper copy on the persona hub (`hub.tsx:513`): "Runs chat titles, memory, compaction and summaries of long tool results. What it works on, tool output included, goes to its provider." plus a link "Privacy notes" to the About page.

Not in this unit: Summaries M-2's "consider a persona-bundle fallback when the helper's privacy class is weaker" is a behaviour change; it stays open and I name it in the report.

## Prompt-cache consistency

Review criterion from Chris (2026-11-18): losing the provider's prefix cache makes a chat roughly ten times more expensive, so no item may change or reorder what earlier turns sent.

- **Items 1–6, 9, 10, 11:** UI, copy, navigation and local housekeeping only. Nothing sent to a provider changes: not the system prompt, the wire messages, the tool definitions or their order.
- **Item 7 (locked key, missing master key):** the change sits in `resolvePersonaContext`, before any request is built. It only turns two throws that already abort the send into typed errors and shows a note. A send that succeeds today builds exactly the same request; a send that fails today still sends nothing. The re-entered key changes only the `Authorization` header, which is not part of the cached prefix.
- **Item 8 (MCP sign-in):** S1, S7 and S11 change only when and where screens show. S4 resumes an existing pending sign-in instead of starting a new one; either way the result is the same grant for the same server, so the tool list built for the next turn (names, definitions, order from `buildMcpToolNames`) is the one a fresh sign-in would give. Which tools a connected server offers is not touched.

## Audit gates

- **Larissa (CLAUDE.md §9.1):** no Larissa path is touched; everything is in `apps/user-client`. Items 7 (errors around `openSecret`) and 10 (deleting local rows at unlock) sit next to key handling and data deletion, so I summon a short Larissa read of those two diffs at pre-squash anyway. Item 8 changes only when screens show, not tokens or routes.
- **Laura:** spec-pass on this document, and a pre-squash pass on the built flows.

## Open questions for Chris

- **Q1, the journal pill (item 1):** wire it up and show it only above 0, or remove it? **Recommendation: wire it up**, because with the cockpit collapsed the top bar is the only place a pending memory is visible, and the count already exists.
- **Q2, a passkey unlock leaves no master key (found while reading, not in the brief):** `routes/login/index.tsx:259` calls `activateSession(session)` without `mk`, so after a cold start with passkey unlock `useSessionStore.mk` is null, and sends, memory actions and saving a key all stop with "master key unavailable". Do you see this on your phone? **Recommendation: if yes, a separate unit after this one**, because the fix belongs in the MK custody of `packages/crypto` (a Larissa path, ledger row "Raw MK in login-flow returns"), not in a papercut pass. Items 7 and 9 at least make it visible and give the way out (Unlock with the passphrase).

## Left to the builder

- Exact copy may be shortened, keeping its content and British English.
- Whether `MessageControls` gets ids or a callback (item 2).
- Test shape: unit tests for the probe-result mapping, the typed send errors and their notes, `purgeExpiredTrash` in `activateSession`, the quick-menu entries, the model row, the overlay holding behind an approval and the restored Add-server draft; route tests for every page that gains `?return=`.

## Manual verification (Chris, on device)

1. **Journal pill.** Open a chat whose persona has no unreviewed memories: the top bar right shows no pill, only the context gauge. Chat until the cockpit's Memory button shows a number: the top bar shows the same number. Tap it: the memory page opens; Back returns to the chat. *Pass:* the two numbers always match, and there is never a `0`.
2. **Voice note.** With no voice provider set up, turn on auto-read in a chat: the note under the cockpit says to set up a voice provider; its button opens Settings → Voice; Back returns to the chat. Then set up a provider, open a persona without a voice, turn on auto-read: the button opens that persona's Font & Voice page; Back returns to the chat. *Pass:* each button lands on the page that fixes it, Back goes home.
3. **Read note.** On a reply, tap Read while the persona has no voice: the note under the message has a link to Font & Voice. *Pass:* the link opens it, Back returns to the chat.
4. **First run.** On a fresh local account, tap "Connect a provider" on the setup card: AI Providers opens directly. Add a provider and save a working key: you land on AI Providers with "Next: create your first companion ›" at the top. Tap it: the new-companion form opens. *Pass:* no stop at the Settings overview; once a companion exists the card is gone.
5. **Repair links.** In My Circle, with a persona whose provider was removed, tap "Provider missing", then Back: you are in My Circle. In a chat with the artefact expert failing, tap the note's Settings, then Back: you are in the chat. *Pass:* both come home.
6. **Quick menu.** In a chat, open the quick menu (logo or ☰): "My Circle" is under Entrance Hall and "Voice settings" beside Image settings. Tap My Circle, pick another persona's Continue. *Pass:* three taps from chat to the other persona's chat; Voice settings opens the voice page and Back returns to the chat.
7. **Model row.** In a chat, open the cockpit's ⋯ menu: the first row names the model and provider. Tap "change on the persona ›": the persona page opens with the model picker; Back returns to the chat. *Pass:* the name matches the persona's model.
8. **Wording.** AI Providers with no providers: the empty text speaks of providers, not voice. A chat top bar: no "(no project)". A new chat's Artefacts page: the empty text says how to make one. The Entrance Hall has a `?` that opens help. The add-provider sheet on a local-only account: gated providers sit at the end under one heading with one server-linking link. *Pass:* each as described.
9. **Key test errors.** On the provider page, turn on airplane mode and tap Test & Save: the message says the provider couldn't be reached and to check the connection. Turn it off, enter a wrong key: the message says the key wasn't accepted. *Pass:* no bare "✗ 0 · Failed to fetch"; the raw detail is still readable below.
10. **Locked key.** (Needs a key sealed under an earlier account; Liz can prepare a test build or a dev-tools step if you have none.) Send a message: a note says the key can't be unlocked, with Re-enter key. Your typed message is still in the composer. Re-enter the key, come back via Back, send. *Pass:* never a silent nothing; the draft survives.
11. **MCP sign-in.** (a) While a tool approval is waiting, tap a pill's *Sign in again*: the approval stays on top; after you answer it, the sign-in overlay appears. (b) Start a sign-in from a pill, open the window, close the overlay, tap *Sign in again* again: the waiting screen returns, no new sign-in. (c) On a local-only account, open an OAuth server's detail page: "Link a server" is beside "Needs a linked Chatsundere server" and Back from server linking returns to the detail page. (d) Add server, choose name and prefix, continue to the sign-in confirmation, tap *Not now*: your name and prefix are still there. *Pass:* all four.
12. **Memory credentials.** (Reachable after a passkey unlock if Q2 is real.) On a persona's memory page, trigger "Consolidate now" without a master key: the error offers Unlock beside Retry; Unlock leads to the passphrase form and back to the memory page. *Pass:* after unlocking, Retry works.
13. **Trash purge.** On a local-only account, with a dev-tools step that backdates a trashed chat past 30 days (Liz provides it), lock and unlock: the chat is gone from Recently deleted. *Pass:* gone after the unlock, with no sync.
14. **Privacy.** Account → About → Privacy: the new section names the background helper and the model switch. The persona page's helper text names tool output and links to the notes. *Pass:* both read plainly.
