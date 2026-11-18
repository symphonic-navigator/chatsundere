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

A link that leaves for a repair carries `?return=<pathname + search of where the user is>`. The page it opens reads `safeReturnPath(search.get('return'), <its current back>)` and passes the result as its `back`. **Rule: every in-app link from a page that has received a `?return=` passes that page's full URL (`pathname + search`) as its own `?return=`**, so the chain unwinds one step at a time. Pages that gain this: Settings → Voice (replacing `location.state`), Settings → Expert, Settings → AI Providers (the list, its rows and its picker), the persona's Font & Voice page (its link to Settings → Voice passes `pathname + search`, not `location.pathname` as at `font-voice.tsx:124` today), My Circle (its row tap, "Go to persona" and "Provider missing", `circle.tsx:128, 144, 174`), Account → Server linking (its link into the invitation wizard, `server-linking.tsx:151`, passes the full URL instead of the hard-coded bare path). Settings → Images, the provider page, the persona hub, Memory, Knowledge and History already honour `?return=`. Route tests walk two levels deep and back (chat → Font & Voice → Settings → Voice → Back → Back; chat → quick menu → My Circle → Provider missing → Back → Back).

## A. Places where the app misleads or strands the user

### 1. The top bar's journal pill

`InteractionTopbar.tsx:159` renders a fixed `0` beside a pulsing dot titled "Uncommitted journal entries". The real count exists (`useUncommittedCount(personaId)`, used by the cockpit's Memory button, `Cockpit.tsx:282`).

**Proposal (open question Q1): remove the pill.** `InteractionTopbar` renders only inside `InteractionMode` (`InteractionMode.tsx:189`), beside the cockpit (`:227`); in reading mode the top bar is the brand strip of `root.tsx:187-223`, with no status group, and on desktop the mode is always interaction (`effective-chat-mode.ts:45`). So the pill and the cockpit's badged Memory button (`Cockpit.tsx:595`) are always on screen together: wiring it up would make two ways to the same thing side by side. Showing pending memories in reading mode is a design question for later, not a papercut. If Chris keeps the pill instead, it shows only above 0 and opens exactly the cockpit's URL (`/app/persona/<id>/memory?chat=<chatId>`, or the quick menu's `?return=` form for an unsent chat, `ChatQuickMenu.tsx:128-132`), so "Learn from this chat" stays available.

### 2. The cockpit's voice note, routed by reason

`Cockpit.tsx:689`: the button "Settings → Voice" opens `/app/settings` for every reason. New targets, each with `?return=` the chat:

| `voiceUnavailable` | Button | Target |
|---|---|---|
| `no-provider` | Set up voice | `/app/settings/voice` |
| `no-voice` | Choose a voice | `/app/persona/<id>/font-voice` |
| `voices-unavailable` | Try again (re-runs `onRecheckVoice`, as a tap already does, `Cockpit.tsx:545-548`), plus a text link "Voice settings" | `/app/settings/voice` |

Why "Try again" first for `voices-unavailable`: the voice list failed to load, which is usually temporary, and Settings rarely fixes it.

The same reasons appear in four more places, all brought in line, with one wording ("voice provider", never "TTS provider"):

- The Read note in `MessageControls.tsx` ("Set up a TTS provider in My Settings", "Choose a voice for this persona in its editor") gains the same link beside its text: the note already appears on tap, so the link is reachable on touch. `MessageControls` gets one `onFixRead(reason)` callback from the chat page, or the ids it needs; the builder picks whichever keeps the props smaller.
- The Live voice button's tooltip says "No voice provider — set one in Settings → Voice" for every reason (`Cockpit.tsx:516-517`), wrong for `no-voice`: it is routed by reason in the same words as the note.
- The audio toolbar's note (`VoiceTransport.tsx:39-43`, visible in reading mode) gains the same repair link.
- `ReasoningPill.tsx:63` gets the same wording; it has no room for a link, which is fine, as the note beside it carries one.

### 3. Side trips that come home

- **Setup card.** `entrance-hall.tsx:58`: "Connect a provider" goes to `/app/settings/providers?return=/app` instead of the Settings overview.
- **Next step after a key.** The AI Providers list shows a card at its top when at least one provider with a chat model is *usable* (`usableTemplateIds`, so a relay-only provider behind an offline server does not count), no companion exists yet, and no first sync is pending (`!useFirstSyncPending()`, so a newly linked device whose providers sync in before its personas is not invited to make a duplicate, the misdirection pre-test analysis #9 fixed on the Entrance Hall): "Next: create your first companion ›" → `/app/persona/new`. It needs no state and disappears once a persona exists. Why here: saving a key returns the user to this list (`provider.tsx:88`, `back()` after a successful test), so this is where they land the moment they are ready. The provider picker and the list's rows pass the list's own URL as `?return=` to the provider page, so the list's `?return=/app` survives the round trip.
- **Repair links.** The artefact-expert error in the cockpit (`Cockpit.tsx:671`, `/app/settings/expert`) and "Provider missing" in My Circle (`circle.tsx:174`, `/app/settings/providers`) carry `?return=` (the chat, `/app/circle`). The add-provider picker's "Open server linking →" carries the providers list as `?return=`.
- **Voice page.** `routes/app/settings/voice.tsx` reads `?return=` instead of `location.state`; its one sender, the Font & Voice page's "change in My Settings → Voice" link (`font-voice.tsx:122`), switches to `?return=`.

### 4. The quick menu: My Circle and Voice settings

`ChatQuickMenu.tsx`: add **My Circle** (`/app/circle?return=<chat>`) to the first group, under Entrance Hall, and **Voice settings** (`/app/settings/voice?return=<chat>`) beside Image settings in the last group. Switching persona drops from four taps to three (menu → My Circle → Continue / New chat). The chat-export unit adds an entry to the same file; the merge is expected and small.

### 5. Which model answers

`CockpitMenu.tsx` gains a read-only first row: **Model** · `<offering displayName> · <provider displayName>`, with a link "change on the persona ›" to `/app/persona/<id>?return=<chat>#model`. The model picker lives on the persona hub (`hub.tsx:466`), below the fold at 380 px, so the hub scrolls the picker into view on `#model`; the link's value is landing on the model, as the avatar already opens the hub. There is no "no model" branch: the cockpit renders only when an offering resolved (`InteractionMode.tsx:207`). Why read-only: the model belongs to the persona, and a per-chat override is a feature, not a papercut.

Not changed here, noted for the report's ledger rows: `CockpitMenu` hides Ask expert and Artefact expert when they are unavailable (`CockpitMenu.tsx:65, 75`) instead of disabling them.

### 6. Wording and guidance

| Where | Today | Change |
|---|---|---|
| `providers.tsx:78`, empty list | "Your Circle has no voice yet — add a provider to begin." | "No AI providers yet. Add one so your companions can answer." |
| `InteractionTopbar.tsx:148` | "(no project)" under the chat title | Nothing is rendered when the chat has no project (projects are not modelled yet; the prop stays for later). |
| `artefacts-page.tsx:94`, empty | "Artefacts you create appear here." | "Nothing here yet. Ask {persona} for a document, a page or a small app, or keep a reply with ◆ Save." ("◆ Save" is the label on persona messages, `MessageControls.tsx:152`; the wording does not promise that every model can make one) |
| Entrance Hall | no `?` help | A `?` in the welcome header, as on every other main screen, with a new `content/help/entrance-hall.md`: what the eight tiles are, in one line each, naming Treasury and Integrations plainly. |
| `provider.tsx:270`, failed key test | "✗ 0 · Failed to fetch" | A client-side mapping of the probe result to a cause and a next step (below); the raw detail stays, smaller, underneath. |
| `AddProviderPicker.tsx:82` | the server-gate text under every gated provider | Gated providers move to the end of the list under one heading, with the reason and its action once; each gated row keeps a short tag, so its reason stays visible on the row. Heading, tag and action follow `proxyGate.reason`: local-only → "Need a linked server" + "Open server linking →" (with `?return=`); offline → "Your server can't be reached right now", no link; feature-missing → "Your server has no relay", no link; any other reason → today's `proxyGate.tooltip`, no link. |

Key test mapping (in `provider.tsx`, no change to `packages/llm-unified`):

- status 0, provider routed direct: "Couldn't reach {provider}. Check your connection. If it works, {provider} may not accept requests from a browser."
- status 0, routed through the relay: "Couldn't reach {provider} through your server's relay. Check your connection, or try again in a moment."
- 401, 403: "{provider} didn't accept this key. Check that it was copied in full and is still active."
- 429: "{provider} is busy or rate-limiting this key. Try again in a minute."
- anything else: "{provider} answered with an error ({status})."
- the `catch` (`provider.tsx:145`) with an `OperationError` (Test & Save without pasting, reusing a key sealed under an earlier master key): "The saved key can't be opened any more. Paste it again."
- no master key in the session (`provider.tsx:99`, "No master key in session — re-login required"): the passphrase sentence of item 7 with its **Enter passphrase** link.

When the provider page is opened from item 7's **Re-enter key**, the key field is focused.

## B. Faults from the ledger

### 7. A send that silently does nothing

Two failures in `resolvePersonaContext` (`data/send-message.ts:133`) reject `sendMessage.mutateAsync` from `void onSend(t)` (`chat-page.tsx:619`) with nothing on screen:

- `openSecret` throws WebCrypto `OperationError` when the provider key was sealed under an earlier master key (ledger, 2026-07-04).
- `mk` is null (`send-message.ts:136, 556`), see Q2.

**Fix:** `resolvePersonaContext` wraps its `openSecret` call and throws a typed `ProviderKeyLockedError { templateId, providerName }`; the missing-mk throws become a typed `MasterKeyUnavailableError`. Both errors carry the template id and display name only, never key material or ciphertext. Any other error keeps today's path. Background chores keep their silent fallback.

The two sentences, used everywhere in this unit (items 6, 7, 9):

- key: "Your saved key for {provider} can't be opened any more. Enter it again to keep chatting." · **Re-enter key** → `/app/settings/providers/<templateId>?return=<here>`
- master key: "Chatsundere needs your passphrase once more before it can use your keys." · **Enter passphrase** → `/login?return=<here>&need=passphrase` ("Unlock" would surprise: the app looks unlocked)

**Where the note shows.** The cockpit exists only in interaction mode (`chat-page.tsx:1180`), but regenerate (on every reply, `MessageControls.tsx:107`) and the opener (`chat-page.tsx:381-391`) also run in reading mode. So:

- **send** (`onSend`, `chat-page.tsx:619`): the cockpit's note slot, beside the artefact-expert note, with Dismiss. The draft is already kept (`setDraft('')` runs only after success); a test pins that.
- **opener**: the existing in-stream notice ("{name} couldn't compose the greeting" + Retry, `chat-page.tsx:859-869`) gets the typed cause and the action in place of Retry.
- **regenerate**: a notice in the stream under the affected reply, in both modes, with the action and Dismiss.

**Interrupted-reply Retry** (`StreamInterruptedFooter`, `chat-page.tsx:959-1007`) deletes the incomplete reply and the user's prior message (a synced delete) before it sends again, so a typed failure there would lose the user's text on every device. It resolves the persona context (key and master key) **before** the deletes; on a typed failure nothing is deleted and the in-stream notice shows the action.

**First send of a new chat.** `useSendMessage` creates the chat row before `resolvePersonaContext` runs (`send-message.ts:559-592`), so each failed first send would leave an empty chat. The context is resolved before the row is created.

**The login page for `need=passphrase`.** `/login` today has no way back and, when passkeys exist, offers the passkey first (`login/index.tsx:277-350`), whose unlock leaves no master key (Q2): following "needs your passphrase" there would loop. With `need=passphrase` the page:

- shows the passkey button **disabled**, not hidden, with "This needs your passphrase";
- focuses the passphrase field;
- while a session is already active, shows **Not now**, back to the validated `return` target (`safeReturnTarget`, `login/index.tsx:44`).

The builder checks on the running client that `/login` with an active session shows this form and returns to the target after the passphrase. Without `need`, the login page is unchanged.

### 8. Four MCP sign-in findings (Laura, 2026-11-03)

- **S1, approval behind the overlay.** While `useMcpApprovalStore` holds a pending request, `McpSignInOverlay` stays **mounted but hidden** (and inert), its target and its flow state kept; it shows again once the queue is empty. Unmounting would discard the waiting screen and start a new `checkServer`, that is a new sign-in. Why hold rather than raise the approval: the approval is a full-screen modal (`McpApprovalPrompt.tsx:39`) that a running tool call waits on; a sign-in can wait for it.
- **S4, resume a kept sign-in.** When the overlay opens for a server that has a pending sign-in on this device (`usePendingSignIns`, as the detail page uses at `server.tsx:299`), it opens `OAuthSignInFlow` with that `state`, straight on the waiting screen, instead of running a new check. This is the one item that may grow (the overlay has no discovery for a resumed flow); if it needs more than passing `state`, I drop it, say so in the report and propose its `ux-deferrals.md` row (the original defect stays).
- **S7, "Needs a linked Chatsundere server".** The detail page shows a **Link a server** button beside the status, to `/app/account/server-linking?return=/app/integrations/<id>`, only for the local-only reason; a linked user whose server is offline sees the reason without the button. Server linking passes its full URL into the invitation wizard (return convention), so after linking, Back leads to the detail page.
- **S11, the draft survives Back.** The `sign-in` phase of `AddServer` (`server.tsx:119`) carries the last `ServerDraft`; `flow`'s `back` restores it, and `SignInSettings` takes it as its initial values.

### 9. Memory's `no-credentials` error

`persona-memory.tsx:32` says "Credentials unavailable — re-authenticate, then retry." with only Retry. `no-credentials` means the session has no master key (`memory/resolve-args.ts:66, 88`). New copy: item 7's passphrase sentence with **Enter passphrase** → `/login?return=<this memory page, with its own query>&need=passphrase`, beside Retry. After the round trip the page has remounted, so the user starts the action again ("Consolidate now", "Learn from this chat"); the copy promises nothing more.

One more path on the same surface: a provider key that can't be opened (`openSecret` in `resolvePersonaBundle`, `memory/resolve-args.ts:36`) is classified as `failed` today ("Try again"), which can never succeed. It throws item 7's `ProviderKeyLockedError`; a new code `key-locked` shows item 7's key sentence with **Re-enter key** → the provider page with `?return=` this memory page. `classifyMemoryActionError` switches from `includes('master key')` to `instanceof` for both typed errors. Nothing else in memory changes.

### 10. Trash auto-purge without a server

`purgeTrash` runs only at the start of a sync cycle (`sync/worker.ts:1250`), so local-only users never have expired trash removed. **Fix:** move it to `trash/purge.ts` as `purgeExpiredTrash()` (expired rows, then `sweepOrphanRevisions`), called by the sync cycle as today and by `activateSession` (`boot/activate-session.ts:34`) on every unlock, for everyone, replacing the bare `sweepOrphanRevisions` call there. Like today's sweep, it never delays or fails an unlock. For a linked user an unlock purge does what the first cycle would do a moment later; the rule (`purgeAt <= now`) is unchanged. The order-dependent purge tests in `tests/sync/worker.test.ts` (ledger, 2026-10-09) are made independent while touched.

## C. Two privacy texts (copy only)

### 11. Tool output and the background helper

Security deferrals Tool-replay L-3 (Low) and Summaries M-2 (Medium), both "before v0.4.0":

- `content/about/privacy.md` gains a section **Which provider sees what?**: your companion's provider sees the conversation; if you set a background helper, its provider sees what it works on (chat titles, memory, compaction of long conversations and summaries of long tool results, up to 48,000 characters of each, including output from integrations and Ask an expert); after you change a persona's model mid-chat, the new provider receives the earlier conversation, tool results included. Our server sees none of it.
- The helper copy on the persona hub (`hub.tsx:513`): "Runs chat titles, memory, compaction and summaries of long tool results. What it works on, tool output included, goes to its provider." plus a link "Privacy notes" that opens the privacy text (`PRIVACY_MD`) in the hub's own help overlay: one tap, no navigation (the About page would cost two taps and its Back leads to Account). The existing "Censored and think-only models can't be helpers." stays; it explains why the picker is filtered.

Not in this unit: Summaries M-2's "consider a persona-bundle fallback when the helper's privacy class is weaker" is a behaviour change; it stays open and I name it in the report.

## Prompt-cache consistency

Review criterion from Chris (2026-11-18): losing the provider's prefix cache makes a chat roughly ten times more expensive, so no item may change or reorder what earlier turns sent.

- **Items 1–6, 9, 10, 11:** UI, copy, navigation and local housekeeping only. Nothing sent to a provider changes: not the system prompt, the wire messages, the tool definitions or their order. (Item 9's typed error sits in memory's argument resolution, before any request.)
- **Item 7 (locked key, missing master key):** the change sits in `resolvePersonaContext`, before any request is built. It turns two throws that already abort the send into typed errors and shows a note. Resolving the context earlier (before a new chat's row is created, before an interrupted reply's Retry deletes) moves only *when* local reads happen; the context resolved is the same, and the messages read for the wire are still read afterwards, as today. A send that succeeds today builds exactly the same request; a send that fails today still sends nothing. A re-entered key changes only the `Authorization` header, which is not part of the cached prefix.
- **Item 8 (MCP sign-in):** S1, S7 and S11 change only when and where screens show. S4 resumes an existing pending sign-in instead of starting a new one; either way the result is the same grant for the same server, so the tool list built for the next turn (names, definitions, order from `buildMcpToolNames`) is the one a fresh sign-in would give. Which tools a connected server offers is not touched.

## Audit gates

- **Larissa (CLAUDE.md §9.1):** no Larissa path is touched; everything is in `apps/user-client`. Items 7 (errors around `openSecret`, the login page's `need=passphrase` mode and its Not now), 9 (same) and 10 (deleting local rows at unlock) sit next to key handling, unlocking and data deletion, so I summon a short Larissa read of those diffs at pre-squash anyway. Item 8 changes only when screens show, not tokens or routes.
- **Laura:** spec-pass done 2026-11-18 (6 hard, 14 soft, all worked in; her verdicts on Q1 and Q2 are below). A pre-squash pass on the built flows follows.

## Open questions for Chris

- **Q1, the journal pill (item 1):** remove it, or wire it up and show it only above 0? **Recommendation: remove it** (Laura agrees), because the pill only exists while the cockpit is open, right beside the cockpit's Memory button that already shows the real count and opens the same page.
- **Q2, a passkey unlock leaves no master key (found while reading, not in the brief; Laura's code reading agrees):** `routes/login/index.tsx:259` calls `activateSession(session)` without `mk`, and `activateSession` keeps the existing raw-MK slice when `mk` is omitted, which after a cold start is null. So after a passkey unlock, sends, memory actions and saving a key all stop with "master key unavailable". Do you see this on your phone? **Recommendation: if yes, fix it in a separate, Larissa-gated unit right after this one**, because the fix belongs in the MK custody of `packages/crypto` (ledger row "Raw MK in login-flow returns"), not in a papercut pass. With this unit alone, 0.5.0 would ask passkey users for their passphrase once after each cold start (items 7 and 9 make it visible and give the way out); for a release meant to leave nothing half-done, shipping that needs your sign-off.

## Left to the builder

- Exact copy may be shortened, keeping its content and British English.
- Whether `MessageControls` gets ids or a callback (item 2).
- Test shape: unit tests for the probe-result mapping, the typed send errors and their notes, `purgeExpiredTrash` in `activateSession`, the quick-menu entries, the model row, the overlay holding behind an approval and the restored Add-server draft; route tests for every page that gains `?return=`.

## Manual verification (Chris, on device)

Liz provides dev-tools steps where a state is hard to reach by hand (marked *dev step*): a provider key sealed under another master key, a session without a master key, a failing artefact expert, a trashed chat backdated past 30 days.

1. **Journal pill** (if Q1 is decided as recommended). Open a chat in interaction mode: the top bar's right side shows only the context gauge, no journal pill. The cockpit's Memory button shows the number of memories to review. *Pass:* there is never a `0` with a pulsing dot.
2. **Voice note.** With no voice provider set up, tap auto-read in a chat: the note under the cockpit says to set up a voice provider; its button opens Settings → Voice; Back returns to the chat. Set up a provider, open a persona without a voice, tap auto-read: the button opens that persona's Font & Voice page; Back returns to the chat. Hover or long-press Live voice in both states: its reason matches the note. *Pass:* each button lands on the page that fixes it, Back goes home.
3. **Two-level chain.** From the chat of a persona without a voice, tap the note's button (Font & Voice), then "change in My Settings → Voice", then Back, then Back. *Pass:* Font & Voice, then the chat.
4. **Read note.** On a reply, tap Read while the persona has no voice: the note under the message has a link to Font & Voice. *Pass:* the link opens it, Back returns to the chat. In reading mode, the audio toolbar's note carries the same link.
5. **First run.** On a fresh local account, tap "Connect a provider" on the setup card: AI Providers opens directly. Add a provider and save a working key: you land on AI Providers with "Next: create your first companion ›" at the top. Tap it: the new-companion form opens. *Pass:* no stop at the Settings overview; once a companion exists the card is gone; Back from AI Providers leads to the Entrance Hall.
6. **Repair links.** Open the quick menu in a chat, tap My Circle, then on a persona whose provider was removed tap "Provider missing", then Back, then Back: My Circle, then the chat. In a chat with the artefact expert failing (*dev step*), tap the note's Settings, then Back: the chat. *Pass:* both come home.
7. **Quick menu.** In a chat, open the quick menu (logo or ☰): "My Circle" is under Entrance Hall and "Voice settings" beside Image settings. Tap My Circle, then another persona's Continue. *Pass:* three taps from chat to the other persona's chat; Voice settings opens the voice page and Back returns to the chat.
8. **Model row.** In a chat, open the cockpit's ⋯ menu: the first row names the model and provider. Tap "change on the persona ›": the persona page opens scrolled to the model picker; Back returns to the chat. *Pass:* the name matches the persona's model.
9. **Wording.** AI Providers with no providers: the empty text speaks of providers, not voice. A chat's top bar: no "(no project)". A chat with messages but no artefacts: its Artefacts page says how to get one. The Entrance Hall has a `?` that opens help. *Pass:* each as described.
10. **Gated providers.** On a local-only account, open + Add provider: gated providers sit at the end under "Need a linked server", with one server-linking link. On a linked account with the server stopped: the heading says the server can't be reached, with no server-linking link. *Pass:* the heading names the real cause.
11. **Key test errors.** On the provider page, turn on airplane mode and tap Test & Save: the message says the provider couldn't be reached and to check the connection. Turn it off, enter a wrong key: the message says the key wasn't accepted. *Pass:* no bare "✗ 0 · Failed to fetch"; the raw detail is still readable below.
12. **Locked key on send** (*dev step*: a key sealed under another master key). Type a message and send: a note in the cockpit says the key can't be opened, with Re-enter key; your message is still in the composer. Tap Re-enter key: the provider page opens with the key field focused. Tap Test & Save without pasting: it says to paste the key again. Paste it and save: you are back in the chat. Send. *Pass:* never a silent nothing; the draft survives; no empty chat is left in History from the failed first send of a new chat.
13. **Locked key in reading mode.** Same state, in reading mode, tap Regenerate on a reply: a notice under that reply shows the cause and Re-enter key, without opening the cockpit. *Pass:* visible in reading mode.
14. **Interrupted reply.** Same state, on a reply that was interrupted, tap Retry: the notice appears and your earlier message is still there. *Pass:* nothing is deleted.
15. **Passphrase needed** (after a passkey cold start, if Q2 is real; otherwise *dev step*). Send a message: the note says Chatsundere needs your passphrase, with Enter passphrase. Tap it: the passkey button is greyed with "This needs your passphrase", the passphrase field has focus, and Not now is offered. Tap Not now: you are back in the chat. Tap Enter passphrase again, enter it: you are back in the chat and sending works. *Pass:* no loop, a way back.
16. **Memory errors.** On a persona's memory page, in the same no-master-key state, tap Consolidate now: the error offers Enter passphrase beside Retry; after the passphrase you are back on the memory page and Consolidate now works. With a locked provider key (*dev step*): the error offers Re-enter key, not Try again. *Pass:* both errors have a way out.
17. **MCP sign-in.** (a) With the sign-in overlay open on its waiting screen, trigger a tool call that needs approval: the approval appears on top; after you answer it, the sign-in waiting screen comes back unchanged. If no tool can be triggered while the overlay is open, this case is covered by unit test only. (b) Start a sign-in from a pill, open the window, close the overlay, tap *Sign in again*: the waiting screen returns, no new sign-in. (c) On a local-only account, open an OAuth server's detail page: "Link a server" is beside "Needs a linked Chatsundere server"; Back from server linking returns to the detail page. (d) Add server, choose name and prefix, continue to the sign-in confirmation, tap *Not now*: your name and prefix are still there. *Pass:* all four.
18. **Trash purge** (*dev step*: backdate a trashed chat past 30 days). On a local-only account, lock and unlock: the chat is gone from Recently deleted. *Pass:* gone after the unlock, with no sync.
19. **Privacy.** Account → About → Privacy: the new section names the background helper and the model switch. On a persona page, the helper text names tool output; its "Privacy notes" opens the privacy text over the page in one tap, and closing it leaves you on the persona page. *Pass:* both read plainly.
