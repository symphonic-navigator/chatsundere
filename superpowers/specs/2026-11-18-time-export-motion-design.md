# A sense of time, chat export, reduce animations — design

**Date:** 2026-11-18 · **Target:** 0.5.0 on `master` · **Branch:** `feat/050-time-export-motion` · **Size:** three small, independent units (one spec, three separate parts)

All three units live in `apps/user-client`; Part A also touches `packages/llm-unified`. None touches a Larissa path (§9.1). Each part has its own goals, design, open questions and manual verification, so each can be approved, built and tested on its own. Laura's spec-pass (2026-11-18: no hard defects, 13 soft notes) is worked in; the notes are cited as `S-…` where they changed the design.

---

## Prompt-cache consistency

Losing the provider's prefix cache makes a chat roughly ten times more expensive, so every unit states what it changes on the wire.

| Unit | Changes what is sent to the provider? |
|---|---|
| **A. A sense of time** | **Yes.** One static system segment and a stamp on every user turn. The core of the design; see below. |
| **B. Chat export** | No. It reads stored rows and writes a file; nothing is sent. |
| **C. Reduce animations** | No. It changes CSS and JS motion only; nothing is sent. |

### Part A in detail

**What is added.** With the persona's switch on: one static `time` segment at the end of the system prompt (its text never changes), and a stamp in front of every user turn on the wire, rendered from fields the message row already stores or stores once at send (`createdAt`, and the new `utcOffsetMinutes`, A2). Nothing is added to persona replies, tool calls, tool results or tool definitions, and no order changes.

**Why the bytes of every earlier turn stay identical.** A stamp is a pure function of two stored, synced, never-rewritten fields. The render is pinned (A1): fixed English names, fixed digits, the stored offset applied with UTC arithmetic, no `Intl`, no browser locale, no device time zone for any message sent from 0.5.0 on. So:

| Situation | Earlier turns byte-identical? |
|---|---|
| Next turn in the same chat | Yes. The newest turn of turn N is an ordinary earlier turn in turn N+1, with the same stamp. |
| After a reload | Yes. Same rows, same render. |
| On a second device | Yes. `createdAt` and `utcOffsetMinutes` sync inside the sealed message record; the second device renders the same bytes even in another time zone. |
| Regenerate | Yes. The user turn is untouched (`regenerate` clears only the persona reply), so it keeps its stamp. |
| Edit (replace in place, last user turn) | Every turn before the edited one is identical. The edited turn keeps its `createdAt` and offset, so its stamp is identical too; only its text changes, as today. |
| Branch | Yes. Both branch paths (`useBranchChat` in `data/chats.ts` and the edit-branch in `data/message-edit.ts`) already copy `createdAt` from an explicit field list; both must also copy `utcOffsetMinutes` and `seedRole` (A8), so the plan names them. The branch's prefix is then byte-identical to the source chat's. |
| Mixed versions (a 0.4.x device in the account) | Yes, except for a branch made on 0.4.x (event 5). Checked in the 0.4.x code: an in-place edit is a Dexie `update` that merges and keeps unknown fields; regenerate only rewrites the persona row; sealing (`stripForSeal`) spreads the whole message row and strips named device-local fields only; applying a pulled row puts the whole sealed record. So the offset survives every 0.4.x path that rewrites an existing row. |
| Compaction | The tail turns keep their stamps. The summary sits in the system prompt as today; compaction moves the prefix exactly as it does without this feature. |
| Tool loop | The user turn's stamp is rendered once per turn and is the same in every round; assistant tool calls and tool results carry nothing new. |
| Attachment replay | The stamp is its own leading text part, in front of the attachment parts, rendered from the same fields, so replayed multimodal turns are as stable as text turns. |

**Events that legitimately break the prefix, and what they cost.** Each costs one write of the prompt from the first changed byte, once; the next turn reads from cache again.

1. **The first turn after updating to 0.5.0**, per existing chat with time on: the system segment and stamps on every user turn appear. One full prompt write per chat, once.
2. **Switching "Knows the date and time" on or off mid-chat**, or switching roleplay while the time switch is unset (the default follows roleplay): stamps and segment appear or vanish. One full prompt write.
3. **A time-zone change, for messages sent before 0.5.0 only.** They have no stored offset and render with the device's offset for their own instant, so a device in another zone, or after travel, renders them differently: one full prompt write on that device, once per zone. Messages sent from 0.5.0 on are immune.
4. **A branch made on a 0.4.x device.** Its two branch paths copy an explicit field list without `utcOffsetMinutes`, so the branched user turns fall back to the device-offset render of event 3. Cost: in that branch only, one full prompt write per device whose zone differs from the source; the source chat is untouched. Nothing heals the copied rows (history is never rewritten); once every device runs 0.5.0, new branches carry the offset.
5. **What breaks the prefix today still does:** truncation to the context window, a new compaction checkpoint, editing a turn, the persona's instructions or other system segments changing.

**The test.** A unit test builds the wire messages for turn N, appends a persona reply and a new user turn, builds turn N+1, and asserts that every message of turn N's wire is byte-identical (serialised JSON) to the same position in turn N+1's. It repeats this with the runtime time zone and the browser language changed between the two builds (both must make no difference for messages with an offset), after a simulated regenerate, and for a branched copy. A second test pins the render of a handful of fixed instants, including a DST boundary and a negative offset, to exact strings.

**"Now" is the send time, by design.** After a regenerate or an in-place edit hours later, the newest stamp still shows the original send time, so the model's "now" is that moment, not the moment of the request. That is the price of byte-stable history and the intended behaviour: do not "fix" it by re-stamping.

---

# Part A — A sense of time

## Why

The system prompt carries no date and no time (`packages/llm-unified/src/composition.ts` has no such segment), and the wire history carries no timestamps. A companion does not know it is Wednesday evening, that the user is up at three in the morning, or that they were away for three days. It also answers "what's the date?" wrongly, from its training cut-off.

## Goals

- The model knows the user's local date and time on every turn, and sees the whole timeline of the conversation, so it notices gaps by itself.
- Provider prompt caches keep working (see *Prompt-cache consistency*).
- On by default; off by default for role-play personas; one switch per persona, with its price stated beside it. With the switch off, no stamps and no segment at all.
- Where a persona has an opener and time is on, the opener knows the date, the time and how long the user was away.

## Non-goals

- No timestamps in title generation, memory extraction, tool summaries, the compaction summariser's input, ask-expert or the artefact author (memory is rebuilt by Eidolon). This is a test, not only a rule: with time on, the inputs each of these jobs builds (whether through `buildEngineWireMessages` or a sibling) are asserted to contain no `<sent`.
- No user-facing time-zone setting: the device's time zone at the moment of sending is the user's time zone.
- Nothing is shown in the chat and nothing is written into a message's text.

## Design

### A1. The stamp

**Decided by Chris, because it avoids prompt-cache trashing:** the time does not go into the system prompt. Every user message carries its own timestamp on the wire, derived from its stored data, never stored in its text and never shown in the chat. The newest message's stamp is "now"; the model reads gaps from the timeline, so there is no separate gap calculation in the chat job.

Format (Q-A1):

```
<sent>Wed 18 Nov 2026, 21:14</sent>
```

- Weekday and month as fixed three-letter English names from a constant table, day without a leading zero, four-digit year, 24-hour `HH:MM`. No seconds, no offset in the text (the model needs local time, not the zone).
- **Render rule:** `local = createdAt + utcOffsetMinutes × 60 000`, then UTC getters on `local`. No `Intl`, no `toLocale…`, so no browser language or ICU version can change a byte.
- **Placement:** a string turn becomes `stamp + "\n" + text`; a multimodal turn gets the stamp as its own leading text part, before the attachment parts.
- **Measured cost:** 18 tokens per user turn with `o200k_base` and `cl100k_base` (measured with `gpt-tokenizer` on 2026-11-18; Anthropic's tokenizer is not public and is expected to be close). A chat with 100 user turns in its window carries about 1,800 tokens of stamps. The bracket form `[Wed 18 Nov 2026, 21:14]` measures 14 (see Q-A1).
- **Which turns:** every `role: 'user'` row that reaches the wire, the active turn included. Seed body turns (`kind: 'seed'`) are simulated conversation and carry no stamp; openers and seed greetings never reach the wire. Imported chats carry the `createdAt` the importer stored.

### A2. The stored offset

New optional `MessageRow.utcOffsetMinutes?: number`, written once when a user message is created (`-new Date(createdAt).getTimezoneOffset()`), never changed, synced with the message (the messages collection syncs new fields by default; the server only sees the sealed envelope). Absent on messages from before 0.5.0: those render with the device's offset for their own instant (`-new Date(createdAt).getTimezoneOffset()`), deterministic on a given device and zone.

*Weighed:* rendering every message in the device's current zone needs no new field, but every time-zone change (travel, a second device elsewhere) re-renders the whole history once, and a stamp would claim a past message was written at a time it was not, at that place. Storing the offset costs one small optional field and makes the stamp both stable everywhere and truthful ("you wrote at 23:40, your time then"). **Recommended: store the offset** (Q-A2).

### A3. One static system segment

A new Band-3 segment `time` (chat job, after `tools`), present only when time is on, whose text never changes:

> Each user message starts with a `<sent>` tag holding the user's local date and time when they sent it. The app adds it; the user did not type it and does not see it. Use it to know the date, the time of day and how long it has been between messages. Never write a `<sent>` tag or a timestamp line yourself, and mention the time only when it matters.

Being static, it costs nothing in cache terms beyond event 1 and 2 above.

### A4. The opener (greeting job)

The opener has no user turn yet and is a single call with no cache chain, so here the time may go into the prompt. When the resolved switch is on, the `time` segment for the `greeting` job reads, for example:

> It is Saturday, 21 November 2026, 09:02 in the user's local time. They last talked with you 2 days ago.

The second sentence uses `persona.lastInteractionAt` (whole hours under a day, days under two weeks, then weeks, then months) and is left out when the persona has never been spoken to or it was under an hour ago.

**In practice** (S-A1): only roleplay personas have openers today (`roleplay && greetingEnabled`), and roleplay personas default to time off. So the dated opener appears for a roleplay persona whose owner turned time on, and for any future opener path. With time off, the opener prompt carries no date.

### A5. The switch

- New persona field `timeAwareness?: boolean`, synced with the persona. Absent ⇒ `!persona.roleplay`, so the default follows the roleplay switch until the user sets it; no migration.
- **Where** (Q-A4, Laura agrees): persona › **Model behaviour**, a switch **"Knows the date and time"**. Beneath it, as visible text, never a tooltip (S-C2):
  - always: *"Each of your messages carries its local date and time, so your companion knows the time of day and how long you were away. Your AI provider sees these times too."* (S-A3)
  - for a roleplay persona with the field unset: *"Off for roleplay characters, so a fantasy world stays timeless."*
- **Roleplay page** (S-A2): while the field is unset and roleplay is on, a visible line under the Roleplay switch: *"Roleplay characters don't know the date and time. Change it under Model behaviour."* with *Model behaviour* as a link.
- **Hub tile meta** (S-A5): the Model behaviour tile appends `· Timeless` when time is off, nothing when on (the deviation is what is worth showing). Fits at 380 px: `Temp 0.85 · Expert · Timeless`.

### A6. Where the code goes

- `packages/llm-unified`: a pure `formatSentStamp(createdAt, utcOffsetMinutes)` and `formatAwayGap(ms)` with tests; the `time` segment in `composition.ts`, driven by a new `BuildPromptInputs.time?: { mode: 'chat' } | { mode: 'greeting'; now: number; utcOffsetMinutes: number; lastInteractionAt?: number }` (absent ⇒ empty segment). No browser globals in the library.
- `apps/user-client`: `start` stores `utcOffsetMinutes` on the new user row; `buildEngineWireMessages` stamps user rows (prior and active) when the resolved switch is on, so the engine gets the active turn's `createdAt` and offset alongside its content; the greeting call passes its inputs; `estimateReplayTokens`, the overflow failsafe in `start` and the chat page's gauge count the stamp and segment, so meter and wire agree; both branch paths copy the offset; the Model behaviour and Roleplay pages and `modelBehaviourMeta` get the switch, line and token.

### A8. Branches keep `seedRole` (fault fix, folded in by Chris)

Both branch paths copy `kind` but not `seedRole` (found while checking A2; present before 0.5.0). A branched seed greeting then has `kind: 'seed'` without `seedRole: 'greeting'`, so `isContextMessage` puts it on the wire as a persona turn and `resolveOpenerContext` no longer echoes it, and branched seed body turns lose the guard that keeps them out of message editing. Fix: both paths copy `seedRole`. Test-first: a test branches a seeded chat and asserts the branched greeting is wire-excluded and echoed exactly as in the source chat; it must fail before the fix. If it does not fail, the fault is not real and the fix is dropped, said so in the report. The stamp rule (A1) keys on `kind === 'seed'`, so it does not depend on `seedRole`.

### A7. Imitation

Models sometimes copy a format they see in context into their replies. Three defences, cheapest first:

1. The stamp only ever appears on user turns; the model's own past turns never carry one, so the conversation shows it the opposite of the pattern.
2. A tag (`<sent>…</sent>`) reads as markup, which models are trained to treat as metadata, where a bracketed line reads like a chat log they continue.
3. The static segment forbids writing one.

**Probe:** this session has no provider keys, so the plan carries a curation probe Chris runs with his keys via `/curate` (never in CI, CLAUDE.md §10): a 20-turn standard conversation on four curated offerings (one Anthropic model, one DeepSeek or GLM via nano-gpt, Grok, Mistral), counting replies that contain `<sent` or start with a date-like line. Pass: no echo. If a model echoes, a one-line strip of a leading `<sent>…</sent>` from the streamed reply is the fallback, decided then.

## Questions, decided by Chris on 2026-11-18

- **Q-A1. The `<sent>…</sent>` tag (18 tokens) over brackets (14 tokens)?** *Recommended: the tag.* Four tokens per turn buy a format models are less likely to continue as a chat log, and the probe settles it either way before the squash. **Decided by Chris, 2026-11-18: as recommended.**
- **Q-A2. Store the time-zone offset with each message?** *Recommended: yes* (A2): stable bytes on every device and after travel, and a stamp that tells the truth about the time it was for the user when they wrote. **Decided by Chris, 2026-11-18: as recommended.**
- **Q-A3. The opener's "they last talked with you 2 days ago" sentence?** *Recommended: keep it.* The opener has no timeline to read, so this is the only way it can say "welcome back". **Decided by Chris, 2026-11-18: as recommended.**
- **Q-A4. Switch on Model behaviour, with the cross-reference on the Roleplay page?** *Recommended: yes* (Laura agrees). Most personas are not roleplay characters, and their owners would never look under "Roleplay". **Decided by Chris, 2026-11-18: as recommended.**

## Audit gates

Laura spec-pass done. No Larissa path: the client sync layer carries one more field inside the sealed message record; no service, no crypto. The provider already sees each request's arrival time; the new disclosure is the user's local time and the times of past messages, and the switch's helper says so.

## Manual verification (Chris, on device)

1. **Default on.** Open a non-roleplay persona › Model behaviour. Pass: "Knows the date and time" is on, with the AI-provider line readable beneath it on the phone; the hub tile shows no `Timeless`.
2. **The model knows.** In a chat with that persona, ask "What day and time is it for me?". Pass: the reply names today's weekday and date and roughly the current local time.
3. **The stamp is invisible.** Look at your own message and Copy it. Pass: no `<sent>` tag anywhere in the app or the clipboard, and the reply does not contain one.
4. **The gap.** Reply in a chat whose last message is more than a day old and ask "how long was I gone?". Pass: the companion knows roughly how long.
5. **Roleplay default.** Open a roleplay persona › Model behaviour. Pass: the switch is off, the "timeless" line shows, the tile reads `· Timeless`; on its Roleplay page the cross-reference line shows and its link opens Model behaviour. In a new chat ask "What time is it for me right now?". Pass: the reply does not name the current local time.
6. **Switch on.** Turn it on for that roleplay persona, start a new chat, ask again. Pass: the current time. Turn it off, start another new chat, ask. Pass: it does not name today's date or time.
7. **The opener.** On a roleplay persona with greeting on, turn time on, then start a new chat a day or more after you last spoke to it. Pass: the greeting fits the time of day and, plausibly, the time away. Turn time off and start another chat. Pass: the opener mentions neither the date nor the time away.
8. **Cache (an Anthropic offering, model debug report).** Send three turns in a row in a long chat. Pass: from the second turn on, each turn shows a large cache read and only a small cache write.
9. **Second device.** Open the same chat on a second device and send a turn. Pass: the debug report shows a large cache read there too.

---

# Part B — Export a chat as Markdown

## Why

There is no export of a single chat, only the whole-data transfer. "Your data is yours" should be one tap away: a chat leaves the app as a readable file whenever the user wants it.

## Goals

- **Export chat** in the chat's quick menu produces a `.md` file of what the chat shows.
- On phones the share sheet opens with the file (save it, mail it, put it in a notes app); elsewhere the file downloads.

## Non-goals

- No export of several chats at once (that is the transfer), no import of the file, no PDF or HTML.
- No embedded images, no zip bundle.

## Design

### B1. Entry point

A new group in `ChatQuickMenu` between the persona group and *Image settings*, holding one entry **Export chat** (Laura: placement fine). States, each with its reason as the visible secondary line the menu already uses:

- lazy or empty chat: disabled, *"Nothing to export yet"*;
- rows still loading (B3): disabled, *"Preparing…"*, for the moment it takes;
- a reply streaming: enabled, note *"The reply in progress is left out"* (S-B1).

### B2. The file

```markdown
---
title: Trip planning
persona: Mira
started: 2026-11-14 18:03
exported: 2026-11-18 21:20
---

# Trip planning

## Saturday, 14 November 2026

**Mira** · 18:03

Good evening! 🌙 How was the day?

**Chris** · 18:05

Long. *[Image: harbour.jpg]*
...
```

- **Front matter** (Q-B1): title, persona, start and export time, local time.
- **Day headings** like the chat's own day separators; each message is `**Name** · HH:MM` and its body. The user's name is `settings.displayName`, else *You*.
- **Text:** `displayPlainText(flattenAnswerText(...))`, the same function as the message Copy action: TEAL sounds and moods become emojis, wrapping tags lose their tags, silent tags vanish, code stays literal.
- **Reasoning:** left out (Q-B2).
- **Tool pills:** one italic line per tool call where it sat, *`[Used tool: web_search]`*, with the tool's display name where one exists. No arguments, no results. Knowledge-base injection and voice-expression pills are left out.
- **Attachments and images:** a line per attachment, *`[Image: harbour.jpg]`* or *`[File: notes.txt]`*; generated images *`[Generated image]`*. No bytes (Q-B3).
- **Opener, seed greeting and seed turns:** included, since the chat shows them.
- **Interrupted replies:** included, followed by *`[Reply interrupted]`*. A reply streaming at export time is left out and the file ends with *`[Reply in progress, not included]`* (S-B1).
- **Untitled chat:** title *"Chat with {persona}"*.

### B3. Delivering it

- **Ready before the tap** (S-B3): the rows (messages, pills, attachment metadata) load when the quick menu opens, so the tap builds the `File` and calls `navigator.share` synchronously within the user gesture; iOS refuses `share()` after an awaited load.
- **File name** (S-B5): `{persona}-{title}-{started YYYY-MM-DD}.md`; untitled, `{persona}-chat-{date}.md`. Both parts through a Unicode-aware slug that folds diacritics ("Café über Nacht" → `cafe-uber-nacht`), `chat` when a part ends up empty.
- **Phones:** if the pointer is coarse and `navigator.canShare({ files: [file] })` holds (tried as `text/markdown`, then `text/plain`), `navigator.share({ files: [file], title })`. A cancelled share (`AbortError`) is silent; any other failure falls back to the download.
- **Elsewhere:** `triggerDownload` from `lib/download.ts`, then the toast *"Chat exported"*.
- **Failure:** if loading or building fails, the toast *"Couldn't export this chat"*, never silence.
- The builder is a pure `chatToMarkdown(...)` in `lib/chat-export.ts` with tests.

## Questions, decided by Chris on 2026-11-18

- **Q-B1. Front matter in the file?** *Recommended: yes.* Kumbu² and Obsidian read it, and it costs four lines for everyone else. **Decided by Chris, 2026-11-18: as recommended.**
- **Q-B2. Leave reasoning out?** *Recommended: yes.* The file is the conversation as read; reasoning is often longer than the reply and would bury it. A collapsed `<details>` per reply is the natural later addition. **Decided by Chris, 2026-11-18: as recommended.**
- **Q-B3. Attachments as names only?** *Recommended: yes.* Base64 images make a file of megabytes no notes app shows well; a zip with the images is a different, larger feature. **Decided by Chris, 2026-11-18: as recommended.**
- **Q-B4. Share sheet on Android too?** (S-B2) *Recommended: yes, verified by step 3 below.* Some Android builds offer no "save to files" target in the share sheet. If Chris's device shows that, the fallback is: on Android, download first and offer *Share* as the toast's action. **Decided by Chris, 2026-11-18: as recommended.**

## Audit gates

Laura spec-pass done. No Larissa path. The file is plaintext leaving the vault by the user's own act, like the transfer export. Nothing is sent to a provider.

## Manual verification (Chris, on device)

1. **Disabled when empty.** With a persona **without** a greeting, open a new, unsent chat and the quick menu. Pass: *Export chat* is greyed out with "Nothing to export yet" readable beneath it.
2. **iPhone.** In a chat with images, a tool call and TEAL moods, open the quick menu › *Export chat*. Pass: the share sheet opens with a `.md` file named after persona, title and start date; "Save to Files" works.
3. **Android.** The same on an Android phone. Pass: the share sheet opens and offers a way to save the file to device storage (if not: Q-B4's fallback).
4. **Content.** Open the saved file in Obsidian or a text editor. Pass: front matter, title, day headings, names and times; moods as emojis; `[Image: …]` and `[Used tool: …]` lines; no reasoning; no TEAL brackets.
5. **Cancel.** Open the share sheet again and cancel. Pass: nothing happens, no error toast.
6. **While streaming.** Start a long reply and open the quick menu. Pass: the note "The reply in progress is left out" shows; the exported file ends with `[Reply in progress, not included]`.
7. **Desktop.** Export the same chat on the desktop. Pass: the file downloads and "Chat exported" appears.
8. **Names.** Export a chat titled with umlauts, and an untitled one. Pass: readable file names, the untitled one `{persona}-chat-{date}.md`.

---

# Part C — Reduce animations

## Why

`SettingsRow.animationsEnabled` exists (device-local, never synced: `sync/strip.ts`), but only the spectrum analyser reads it and no screen sets it. Someone who finds the breathing orbs, the mindspace drift or the screen effects distracting, or whose phone runs hot, has no switch unless they turn on reduced motion for the whole device. Ledger item "Surface a global 'Reduce animations' toggle" (Laura SOFT-2, 2026-06-14).

## Goals

- A **Reduce animations** switch in Settings, bound to `animationsEnabled`, per device.
- When on, the app behaves exactly as under the system's `prefers-reduced-motion: reduce`: every component that honours the system setting honours the switch, with no second list to keep in step.
- The system setting is the starting value: with reduced motion on in the system, the switch shows on.

## Non-goals

- No "force animations on although my system says reduce". The system's choice is an accessibility setting, and the existing CSS follows it directly.
- The screen-effects switch stays separate: under reduced motion, screen effects play their existing gentle profile, as they do under the system setting.

## Design

### C1. The switch

- **Where** (Q-C1, Laura agrees with a condition): My Settings › **You**, directly under *Mindspace*. Label **"Reduce animations"**, helper as visible text (S-C4): *"Stills the drifting background, the breathing orbs and other motion on this device. Screen effects play gently."*
- **Findable** (Laura's condition): the You tile's meta becomes *"how the AI sees you · motion"*, and the `settings-you` help gains a paragraph on the switch.
- **System on:** the switch shows on and is disabled, with a visible note, not a tooltip (S-C2): *"Your device asks for reduced motion, so this stays on. Change it in your system settings."*
- **System off:** the switch shows `!animationsEnabled` and writes it. The user's own choice survives the system setting going on and off again.
- **Live** (S-C3): the page subscribes to the media query's `change` event, so returning from system settings updates the switch without a reload.
- **Cross-reference** (S-C4): under *Show screen effects* in `VoiceSection.tsx`, one line: *"They play gently while Reduce animations is on (My Settings › You)."*
- Existing rows hold `animationsEnabled: true` (seeded, never changed by any UI), so nobody's behaviour changes until they flip it.

### C2. One signal: a root attribute

- A hook in the app root sets `document.documentElement.dataset.motion = 'reduced'` when `animationsEnabled` is false, and removes it otherwise.
- To avoid one animated splash before Dexie loads, the flag is mirrored to `localStorage` (`chatsundere.reduceMotion`, a non-sensitive per-device preference, no token or user data) and applied at the top of `main.tsx`, before first paint, in a try/catch.
- **CSS:** a small Vite plugin (`enforce: 'pre'`, `src/index.css` only) does two rewrites at build time:
  - every rule inside `@media (prefers-reduced-motion: reduce) { … }` is mirrored, right after that block, as the same rule under `:where(:root[data-motion='reduced'])` (`:where` keeps the original's specificity, the position keeps its source order);
  - every selector rule inside `@media (prefers-reduced-motion: no-preference) { … }` is narrowed in place to `:where(:root:not([data-motion='reduced']))`, so motion switched on only when the system allows it (the live-voice pulse and dots) stays off under the switch.

  `@keyframes` cannot be selector-scoped. A reduce block that redefines keyframes (today `wizard-step-in` and `badge-pulse`) is listed by the plugin at build time, and each gets an equivalent selector rule (`animation: none` or the static end state) inside the same reduce block, so the mirror covers it. `index.css` changes only by those few lines, which keeps clear of the parallel sessions, and any reduced-motion block added later is covered automatically. A unit test runs the transform on the real `index.css` and checks every reduce rule has its twin.
- **Fails loudly.** The plugin is the one piece of machinery in this package, so it never skips silently: a reduced-motion block it cannot mirror (a nested at-rule, a keyframes redefinition without its selector twin, a syntax it does not parse) fails the build with the file and line. A unit test feeds it each of those cases and expects the error, besides the test on the real `index.css`.
- **Dev, build and tests.** The plugin's `transform` hook runs the same way under `vite` (dev) and `vite build`. Vitest does not process CSS by default (component tests see no stylesheet either way), so the CSS behaviour is covered by the plugin's own unit tests calling the transform directly, and the JS checks by their tests with the root attribute set.
- **JS:** the existing checks (`motion.respectsReducedMotion()` in `packages/ui-shared`, `prefersReducedMotion()` in the screen-effects store, the Lightbox, the splash, the spectrum analyser's media query) answer true when either the media query matches or the root attribute is set. `BreathingOrb` and `NavTile` read through a small `useReducedMotion()` hook so a flip takes effect without a reload.

## Questions, decided by Chris on 2026-11-18

- **Q-C1. The switch under My Settings › You, beside Mindspace, with the tile meta "how the AI sees you · motion"?** *Recommended: yes.* There is no Appearance page, and a tile for one switch is heavier than it is worth. A later *Display* page holding this and screen effects stays the right home if one is ever made. **Decided by Chris, 2026-11-18: as recommended.**
- **Q-C2. Mirror the system behaviour exactly, rather than a stronger "everything off"?** *Recommended: yes* (Laura agrees). The reduced-motion blocks were written per component with care; functional motion such as the streaming cursor and the compacting pulse stays honest. One proven behaviour, two ways in. **Decided by Chris, 2026-11-18: as recommended.**

## Audit gates

Laura spec-pass done. No Larissa path. `localStorage` holds a motion preference only, never a token (CLAUDE.md §14). Nothing is sent to a provider.

## Manual verification (Chris, on device)

1. **Default.** With reduced motion off in the system, open My Settings. Pass: the You tile reads "how the AI sees you · motion"; on the page *Reduce animations* is off and the background drifts, the orbs breathe.
2. **On.** Turn it on. Pass: without a reload, the mindspace stops drifting and the orbs stand still; ask for a celebration and the screen effect plays its gentle version.
3. **Persists, per device.** Reload the app. Pass: still on, and no animated splash flashes before it applies. On a second device signed in to the same account the switch is unaffected.
4. **System wins, live.** Leave the app, turn reduced motion on in the system (iOS: Accessibility › Motion; Android: Remove animations), return without reloading. Pass: the switch shows on, greyed out, and the "your device asks" note is readable on the phone.
5. **Your choice survives.** With the switch on, turn the system setting on and then off again. Pass: the switch is enabled again and still on.
6. **Voice.** With the switch on and the system setting off, start live voice. Pass: the spectrum analyser rests and the button pulse and transcribing dots stay still.
7. **Off.** Turn the switch off. Pass: everything moves again.

---

## Left to the builder

- JSDoc and test layout; the Vite plugin's file location.

## Notes for STATUS and the ledger (for the coordinator)

- Part C closes the ledger item "Surface a global 'Reduce animations' toggle" (Laura SOFT-2, 2026-06-14).
- Laura's soft notes not taken verbatim: none dropped; S-B2 is open as Q-B4.
