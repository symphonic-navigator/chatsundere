# Search inside chats — design spec

**Date:** 2026-11-18
**Release:** 0.5.0 (unit "search inside chats")
**Branch:** `feat/050-chat-search`
**Scope:** `apps/user-client` only. No server, no sync, no schema change. Larissa paths (§9.1) are **not** touched.
**Status:** Approved by Chris, 2026-11-18. Laura spec-pass and the coordinator's review worked in (§13). Questions decided in §12.

---

## 1. Problem

My History searches chat **titles** only (`routes/app/history.tsx`, `HistorySearchBar`, placeholder "Search chats by title…"). People remember what was *said*, not what a chat was called, and auto-generated titles are a poor memory aid. Someone looking for "the recipe Mira gave me with the smoked paprika" has no way to find it short of opening chats one by one.

On the same page, two smaller defects from the 2026-11-18 mobile UX analysis (item 12, "History loses your place"):

- The Chats / Bookmarks tab is component state, not in the address. Tap a bookmark, read, come back: you are on Chats again. Treasury keeps its state in the URL; History should too.
- The window scroll position is lost on return (BrowserRouter, no scroll restoration). With a search inside messages this becomes the main loop: search → tap a hit → read → back → next hit. Losing the list there would make the feature feel broken.

## 2. Goal

Type a phrase in History's one search field and get, below the matching chat titles, the **messages** that contain it — as snippets, grouped by the chat they belong to, with the persona shown. Tap a snippet to land on that message in its chat (the existing `?focus=` jump with its highlight pulse). Come back and find the page exactly as you left it.

## 3. Non-goals

- No index, no embeddings, no server, no sync. A read-only scan over the local Dexie `messages` table.
- No search over memory, knowledge, artefacts, Projects, compaction summaries, or tool payloads. Projects, memory and knowledge are what Eidolon rebuilds; Treasury has its own search.
- No highlighting of the term inside the chat view after the jump. The existing pulse marks the message; that is enough for now.
- No search syntax (quotes, operators, regex).
- No sizing changes to the tabs, the field or the persona filter — the touch-target unit owns those.

### 3.1 Prompt-cache consistency

This unit changes nothing that is sent to a provider: no system prompt, wire message, tool definition or ordering is touched, and the scan is read-only. Opening a chat from a result uses the existing `?focus=` jump, which only scrolls and pulses the message (`chat-page.tsx`: `setInteractionMode(false)`, `setAutoFollow(false)`, `scrollToMessage`) and then drops the parameter; it writes no message, chat field or compaction state, so the next turn's wire prefix is byte-identical to what it would have been when opening the chat from the list. The new URL parameters (`tab`, `q`) live on `/app/history` only and never reach the chat route.

---

## 4. Where it lives: one field, two sections

The Chats tab keeps its one search field. Its placeholder becomes **"Search titles and messages…"**. With a query of at least two characters, the list below the sticky header becomes two sections:

```
┌───────────────────────────────────┐  380 px
│ ‹  My History                  ?  │
│ [ Chats ][ Bookmarks ]            │
│ [ paprika                    ✕ ]  │
│ [ ● All personas            ▾ ]   │
│ 2 OF 48 CHATS                     │
├───────────────────────────────────┤
│ CHAT TITLES · 2                   │
│  ▢ Smoked paprika stew   Mira  ⋯ │
│  ▢ Paprika & patience    Kai   ⋯ │
│                                   │
│ IN MESSAGES · 7   searching 12/48 │
│  ◉ Kitchen chaos            (Mira)│
│   MIRA · 3 Nov                    │
│   …then a teaspoon of smoked      │
│   [paprika], not the sweet one…   │
│   YOU · 3 Nov                     │
│   …did you mean [paprika] or…     │
│   + 2 more in this chat           │
│  ◉ Sunday plans              (Kai)│
│   …                               │
└───────────────────────────────────┘
```

- **Chat titles** — exactly today's title filter and `HistoryRow`s (rename, delete, ⋯ menu unchanged). Whenever the messages section is shown (a query of two or more characters — not only while the scan runs, so the list never grows under you when it finishes), more than **five** title matches show as the first five plus a "Show all *n* chats" button that expands in place. With zero title matches the section is left out. With no query the page is unchanged: the full chat list, no section headers.
- **In messages** — the message hits (§7), streamed in as the scan proceeds.
- **The sticky count line** (`historyCountLabel`) is hidden while the messages section is shown; the two section headers carry the numbers. (The sketch above still shows it; it goes.) With no query or a one-letter query it stays as today.

Why one field and not a third tab or a "titles / messages" switch: the person does not know (and should not have to decide) whether the thing they remember is in a title or in a message. One field, everything it finds, titles first because they are instant and the cheapest win. A third tab would hide the more useful half behind a choice; a switch is configuration (omakase over options). See Q1.

A one-character query filters titles as today and shows a quiet hint where the messages section would be: *"Type one more letter to search inside messages."* One letter would match almost every message and spend seconds producing noise.

### 4.1 The Bookmarks tab

The Bookmarks tab keeps its own behaviour, with one widening: a bookmark matches when its **label or its message text** matches (both are already in memory from `useBookmarks`, so no scan). Placeholder becomes **"Search bookmarks…"**. Rationale: the default label is a 40-character snippet of the first line; a bookmark whose label you renamed to "Paprika!" or whose matching sentence is in paragraph three should still be findable. When a bookmark matches only through its message text, its row shows a one-line snippet with the words highlighted under the label (the hit snippet of §7.1, clamped to one line), so it is clear why it is there. See Q4.

### 4.2 The persona filter

The existing persona dropdown narrows both sections. With a persona selected, only that persona's chats are scanned — faster, and what "narrow to this companion" means.

---

## 5. What is searched

The scan reads `messages` rows, chat by chat. A message is a candidate when:

| Content | Searched? | Why |
|---|---|---|
| User text (`role: 'user'`, `text` blocks) | **Yes** | The point. |
| Persona text (`role: 'persona'`, `text` blocks) | **Yes** | The point. |
| Openers, seed greeting and seed body turns | **Yes** | They are shown in the chat as messages; the user saw them. |
| Incomplete (`streamingState: 'incomplete'`) messages | **Yes** | Shown in the chat with their partial text. |
| Messages before a compaction checkpoint | **Yes** | The rows stay in `messages` and the chat still shows them above the divider. |
| Compaction summaries (`compactionCheckpoints`) | No | Not shown as messages; the model's paraphrase would yield hits that are not in the chat. |
| Reasoning blocks | No | Collapsed by default, private to the model, and it paraphrases the user's own words — duplicate noise on nearly every hit. See Q3. |
| Pills (tool calls, KB injections, image results, voice expressions) | No | Payloads are machine data, not what was said. |
| Attachments (file names, text attachment bodies) | No | Not message text; can be large. Possible later. |
| `role: 'system'` rows | No | Not dialogue. |
| Bookmark labels | No (Chats tab) | Bookmarks tab covers them (§4.1). |

Text is matched as **the chat displays it**: `displayPlainText(flattenAnswerText(blocks))` — TEAL tags rendered away, Markdown syntax stripped — so `**smoked** paprika` matches "smoked paprika" and a snippet never shows raw markup or TEAL tags. Because that rendering is not free, the scan first rejects cheaply on the raw `text` blocks (§8.2) and renders only candidates.

### 5.1 Matching

- **Case- and accent-insensitive.** Both sides are folded: NFD, combining marks removed, lower-cased. "Müller", "muller" and "MULLER" match each other; "café" matches "cafe".
- **All words, any order, within one message.** The query is split on whitespace; a message matches when it contains every word as a substring (so "papri" finds "paprika"). People remember fragments, not exact sentences. See Q2.
- No minimum word length beyond the two-character query minimum; each word is a plain substring.

---

## 6. Visibility: nothing adult mode hides may leak

History gates by persona: a chat is visible only when its persona is in `useFilteredPersonas()` (SFW mode drops `adultPersona` personas). Search applies **the same gate before reading**:

1. The scan's work list is built from the already-gated chat list (`gatedChats`, then the persona filter). A chat whose persona is hidden is **never read** from `messages` — not read-and-dropped, not read at all.
2. A chat whose persona row is missing is skipped (History already skips such rows).
3. When the visible persona set changes mid-scan (adult mode flips), the running scan is aborted, its results are discarded, and a new scan starts over the new set. `nsfwPanic()` navigates away anyway; the abort is the belt to its braces.
4. Results live in component state and in the single in-memory return cache (§10), which is keyed by the visible persona set and cleared when it changes. Nothing is written to IndexedDB, `localStorage` or the TanStack Query cache; `sessionStorage` holds only the content-free generation token (§10).
5. **The query text is never in the URL or in a storage key.** It lives in `location.state` of the History entry, tagged with the generation token, and is discarded on arrival after an adult-mode flip, a lock or a sign-out (§10). The address bar shows at most `?tab=` and `?personaId=`.

Tests assert (1) structurally: a gated chat's id is never passed to the `messages` read.

---

## 7. The result list

### 7.1 Shape

Hits are grouped by chat, like `BookmarksList`:

- **Group header:** persona avatar (28 px), the chat's display title in the persona's colour, truncated. The header is not a link — the hits are (one tap target per thing, see Laura §13).
- **Hit row** (a `cs-row` button): a small monospace role marker — `YOU` or the persona's name in caps — and the message date (`3 Nov`, or `3 Nov 2025` outside the current year), then the snippet on up to three lines.
- **Snippet:** a window of about 120 characters placed to contain the most query words (falling back to the first match), so a hit visibly matches the whole query, with context either side, cut on word boundaries (grapheme-safe, as `lib/toc.ts` does), `…` where cut. Every query word is wrapped in `<mark>` (accent colour, subtle background — the inline-marker aesthetic). Newlines in the snippet become spaces.
- **Per chat:** at most three hits, in chat order (oldest first, as Bookmarks). If a chat has more, a "+ *n* more in this chat" button expands that group in place.
- **Order of groups:** most recently active chat first — the scan order (§8.1), so groups never reorder as results stream in; new groups only append.
- **Live against the chat list:** at render time, groups whose chat is no longer in `gatedChats` are dropped, and the group title is taken from the live chat row. Deleting a chat from the titles section above (or through sync) removes its hits at once, and a rename shows straight away. Without this a tapped hit of a deleted chat would hit `chat-page.tsx`'s deleted-chat guard and land on a reset History.

Tap a hit → `navigate('/app/chat/<chatId>?focus=<messageId>')` — the bookmark jump, unchanged: `chat-page.tsx` disables auto-follow, scrolls the message to the centre and plays `msg-focus-pulse`. The chat loads all its messages (`useChat`), so any message is in the DOM.

### 7.2 Contract (kept simple for a later source)

The list renders a plain, source-agnostic shape:

```ts
interface SearchHitGroup {
  key: string;                 // e.g. the chat id
  title: string;
  personaId: string | null;    // for avatar + colour
  hits: SearchHit[];
  totalHits: number;           // drives "+ n more"
}

interface SearchHit {
  key: string;                 // e.g. the message id
  roleLabel: string;           // 'You' | persona name
  date: number;                // ms
  snippet: { text: string; marks: [start: number, end: number][] };
  href: string;                // where a tap goes
}
```

The message scan produces these; the list knows nothing about Dexie. A later source (Eidolon's project search) could produce the same shape. Nothing is built for that now — no registry, no plug-in point.

### 7.3 States of the "In messages" section

| State | What shows |
|---|---|
| Query empty | Section absent; page as today. |
| Query 1 character | Hint: *"Type one more letter to search inside messages."* |
| Debouncing / scan started, no hit yet | Header "IN MESSAGES" + progress pill *"searching 12 / 48 chats"*. No spinner wall, no skeletons. |
| Scanning with hits | Header "IN MESSAGES · 7" + progress pill; groups append. |
| Done with hits | Header "IN MESSAGES · 7"; pill gone. |
| Done, no message hits, some title hits | *"No messages contain "paprika"."* |
| Done, nothing anywhere | One empty state for the whole page (replacing today's "No chats match your search."): *"Nothing in your history matches "paprika"."* + **Clear search**; with a persona filter active also **Search all personas** (clears only the persona filter). |
| Cap reached (§8.3) | Header "IN MESSAGES · 300+"; under the last group: *"Showing the first 300 matches. Add a word to narrow it down."* |

The message count lives in its section header and the title count in its own (the sticky count line is hidden meanwhile, §4), so no number has to mean two things.

### 7.4 A hit whose message is gone

If the focused message no longer exists when the chat opens (deleted in the chat, or through sync, while a cached result was held), `scrollToMessage` fails. Today the chat then sits wherever auto-follow-off leaves it, silently. The jump effect in `chat-page.tsx` gains a fallback: on a failed focus (after its existing one-frame retry), re-enable auto-follow so the chat lands at the latest message, and show the existing toast primitive with *"That message is no longer here."* This also fixes the same silent case for bookmarks. It is a few lines in the jump effect and touches nothing else in the chat page.

---

## 8. Large histories

### 8.1 Measurement

Measured on 2026-11-18 in the session container's headless Chromium with Dexie 4.4.2, synthetic rows shaped like ours: user turns ~200 characters, persona turns ~1.7 kB of text plus a ~1 kB reasoning block. The scan lower-cased every `text` block and tested `includes`.

| Messages | Full scan, one `each()` | Paged by 500, yielding | Per chat via `[chatId+createdAt]`, yielding |
|---|---|---|---|
| 20 000 (200 chats × 100) | ~600 ms | ~480 ms | ~490 ms |
| 100 000 (1 000 chats × 100) | ~3.0 s | ~2.4 s | ~2.5–2.7 s |

The cost is reading and structured-cloning the rows out of IndexedDB, not the string test; a miss costs as much as a hit. A mid-range phone is plausibly 3–5× slower: **20 000 messages ≈ 1.5–2.5 s, 100 000 ≈ 7–12 s.** 20 000 is a heavy user today; 100 000 is a long-term one. **Large non-text blocks cost too.** Reasoning blocks are part of the row, so they are read and cloned although they are not searched. Re-run with a ~10 kB reasoning block on every persona turn (long thinking models): 20 000 messages ≈ 1.05 s, 100 000 ≈ 5.0 s — about twice the cost, so a phone might take 15–25 s for 100 000 such messages. Pills and attachments are separate tables (`pills`, `attachments`); a message row holds only `{ type: 'pill', pillId }`, so they add nothing. This is why the streamed, newest-first order and the cap matter more than raw speed: the first screen of hits comes from the first chats either way.

A blocking "wait for everything" search is therefore wrong at the top end, and an index is not justified (it would be a schema change, a write cost on every message, and sync interplay) while a streamed scan stays usable.

### 8.2 Strategy

- **Per chat, newest chat first.** The work list is the gated, persona-filtered chats in `lastMessageAt` descending order (the order History already shows). For each, read `messages.where('[chatId+createdAt]')` for that chat. Measured as cheap as a flat scan, and it gives what matters: the chats you most likely mean come first, groups arrive in final order, and gated chats are never read (§6).
- **Yield between chats** (`setTimeout(0)`/`scheduler.yield` where present) so typing, scrolling and taps stay responsive. Results are flushed to React at most every ~100 ms, not per chat.
- **Cheap reject first.** For each message, fold the raw `text` blocks and test every query word; only on a pass render `displayPlainText` and match again for the real snippet. Almost all messages are rejected on the cheap path.
- **Debounce 250 ms** after the last keystroke, **abort** the running scan (an `AbortSignal` checked between chats) on any new query, persona filter change, visible-set change or unmount.
- Main thread, no Web Worker: a worker would need its own Dexie connection and a copy of the TEAL/Markdown rendering; yielding is enough at the measured cost. Revisit only if device testing shows jank.

### 8.3 Cap

The scan stops after **300 message hits** and shows the cap note (§7.3). Hits folded under "+ *n* more in this chat" count towards the 300 — the cap is on work, not on rows shown. 300 hits is far past what anyone reads on a phone; the note tells them how to get a better list. Chats not yet reached are simply not shown — the newest-first order makes that the right end to drop.

---

## 9. 380 px

- Snippets wrap on up to three lines (`line-clamp-3`) — no horizontal scroll, no truncation of the highlighted word off-screen, because the snippet window is centred on the first match.
- Role marker and date share one line in 11 px monospace, above the snippet.
- Group headers truncate the title; the avatar is fixed width.
- The progress pill sits right-aligned in the section header and fits "searching 999 / 999 chats" at 380 px.
- Rows reuse `cs-row`; tap targets keep whatever size the touch-target unit gives `cs-row` (not changed here).
- Desktop: the same layout, no `lg`-specific changes.

---

## 10. Keeping your place: tab in the address, query and scroll in navigation state

**The query text never goes into the URL or a storage key.** A query string is sent to the hosting server whenever the document is requested (a reload, a cold start on that URL, a service-worker miss) and lands in its access log — plaintext about private chats on the server, against CLAUDE.md §3 rule 1. In a browser tab it also enters the browser's history and address-bar suggestions, where it outlives an adult-mode flip, a lock and a sign-out. `replace` prevents neither. (Coordinator's finding, 2026-11-18, rated hard.)

- **Tab in the URL:** `?tab=bookmarks` (absent ⇒ Chats), written with `replace` like the persona filter. It carries no content. `?personaId=` stays as today.
- **Query and scroll in `history.state`:** History keeps `{ q, scrollY, gen }` in React Router's `location.state`, written with `replace` (the query debounced with the search, the scroll offset on leave). `history.state` survives Back and a reload of that entry, is never sent to the server and never shown in the address bar or the browser's history suggestions.
- **Invalidation by generation:** `gen` is a random token, the only thing History keeps in `sessionStorage` (under a fixed key, no content), regenerated on lock, sign-out and adult-mode flip. On mount, a `location.state` whose `gen` is not the current one is discarded and the entry's state is replaced with an empty one at once. The app cannot rewrite the state of other entries deeper in the tab's back stack; after a flip, lock or sign-out such an entry still holds the old text inside the browser's in-tab memory, but the app never shows it (it is discarded on arrival) and it never leaves the device. If the lock or sign-out flow already reloads the document or clears the tab, that is stronger still; the plan checks which.
- **Inbound `?q=`:** old links (and any bookmark of an old History URL) may still carry `?q=`. History reads it once, moves it into `location.state`, and strips it from the address with `replace` in the same tick.
- **Return cache (one entry, memory only), partial results included:** the last message search — finished, capped *or still running* — is kept in a module-level variable keyed by (query, persona filter, visible persona ids), together with a **resume point** (the index of the next chat to scan). On large histories the usual case is tapping a hit before the scan is done, so a cache of finished searches only would miss exactly when it is needed. On return with the same key, the cached groups render at once, scroll is restored against them, and the scan continues from the resume point. A new query, a filter change, an adult-mode flip, a lock or sign-out drops it. It is a snapshot, not kept live against message edits (deletions and renames of chats *are* reflected, §7.1); stale-by-one-visit is acceptable for a read-only list. See Q6.
- **Scroll restoration, local to History:** restored from `location.state.scrollY` once the list has rendered (title list from the Query cache, message list from the return cache). Back lands in place, and so does the quick menu's return (§10.1), which navigates with the held state. An ordinary visit from the Entrance Hall or a quick menu without a held search has no state and starts at the top. If the content is shorter than the offset, the browser clamps — acceptable.

### 10.1 Getting back without a Back button

The search → hit → back → next hit loop must not depend on a system Back: the chat page has no page bar, an installed iOS PWA has no browser Back button, and whether its edge swipe navigates back has to be checked on the device. Today the only in-app way from a chat to History is the quick menu's **History** entry (`ChatQuickMenu.tsx`), which opens a *new* visit (`?personaId=<this persona>&return=…`): query, tab and place gone, persona filter forced.

Change, with no new chrome in the chat: History remembers, in memory, the **last History location it was left from** — path with `?tab`/`?personaId` plus its `location.state` — when it was left *to a chat via a hit or a bookmark* (cleared on lock, sign-out and adult-mode flip). When the chat that was opened that way shows the quick menu, its History entry goes back to that location — `navigate(-1)` when the previous history entry is that location, else `navigate(path, { state })`. In any other chat, or after the user has moved on to another chat, the entry behaves as today. Both paths restore the query, tab, results and scroll.

The logic lives in a new `lib/history-return.ts` (`historyReturnTarget()`), self-contained, so the later "Back means one thing" unit can call or replace it.

The diff in `ChatQuickMenu.tsx`, which the parallel papercut unit owns, is a single line (Q7, cleared by the coordinator). The alternative, a visible "‹ Results" chip in the chat, is Q8.

### 10.2 The hub's link

The persona hub's Recent chats filter (`RecentChatsAccordion.tsx`) now sends its query to a History that also searches messages. On its no-match state (`No chats match "x"`), the link reads **"Search messages in History →"** instead of "All in History →", so it says what the other side will do. With matches, the link text stays.

The link passes `q` today in the URL (`/app/history?personaId=…&q=…&return=…`). Since that text now drives a message search, it moves to navigation state: the link becomes `<Link to="/app/history?personaId=…&return=…" state={{ q, gen }}>`. The `?q=` read in History stays only as the inbound fallback above.

---

## 11. Implementation sketch

New, all under `apps/user-client/src`:

- `lib/search/fold.ts` — fold (NFD, strip marks, lower) with an index map back to the original string, so marks land on the displayed text.
- `lib/search/message-snippet.ts` — match all words, build the snippet window and mark ranges.
- `lib/search/scan-messages.ts` — the per-chat streamed scan: `scanMessages({ chats, query, signal, onProgress, onHits, cap })`. Pure Dexie read, no React.
- `components/history/useMessageSearch.ts` — debounce, abort, flush batching, return cache.
- `components/history/SearchHitList.tsx` — renders `SearchHitGroup[]` (§7.2).
- `components/history/useHistoryNavState.ts` — `q`/`scrollY` in `location.state`, the generation check, the inbound `?q=` strip, scroll restoration.
- `lib/history-return.ts` — `historyReturnTarget()` and the generation token (regenerated on lock, sign-out, adult-mode flip).

Changed: `routes/app/history.tsx` (sections, URL state, empty state), `components/history/HistorySearchBar.tsx` (placeholder default), `components/history/BookmarksList.tsx` (text-match snippet), `components/chat/ChatQuickMenu.tsx` (one line, §10.1), `routes/app/chat/chat-page.tsx` (focus fallback in the jump effect only, §7.4), `components/persona-hub/RecentChatsAccordion.tsx` (link label, `q` into state), `content/help/history.md` (the "Finding a conversation" paragraph), a few lines in `src/index.css` for `mark` styling in hits (small and local, the file is shared with other 0.5.0 units).

**Size, honestly:** medium-large for one unit. About 7 new and 8 changed source files; roughly 900–1 100 lines of code and 700–900 lines of tests. The scan with its hook and the `history.tsx` rework are about half; the navigation state and return path, the return cache, the bookmark text match and the focus fallback are the rest. No part is speculative, and each answers a Laura or coordinator finding; if Chris wants it smaller, the bookmark text match (Q4) and the hub label (§10.2) are the cleanest cuts.

Tests (Vitest, `fake-indexeddb`): folding and snippets (accents, emoji graphemes, mark offsets after folding, TEAL and Markdown stripped); scan order, cap, abort, and that a gated chat's id is never queried; route tests for `tab` in the URL and `q` only in `location.state` (never in `location.search` after mount, inbound `?q=` stripped, stale `gen` discarded), the one-character hint, the empty states, and the Bookmarks label-or-text match.

---

## 12. Questions — decided by Chris, 2026-11-18

**Decided by Chris, 2026-11-18:** every question as recommended below — Q1 one field with two sections; Q2 all words in any order; Q3 reasoning left out; Q4 the Bookmarks tab also matches message text; Q5 title matches collapsed to five; Q6 the one-entry return cache with partial results and a resume point; Q7 cleared by the coordinator; Q8 the quick-menu route, no chip in the chat. Nothing is cut: Q4 and the hub label (§10.2) stay in.

**Q1 — One field, two sections?** Recommendation: **yes**, as in §4 (titles first, then "In messages"). *Reason:* nobody knows in advance whether what they remember is a title or a sentence; a third tab or a switch makes them guess first. Alternative: a third "Messages" tab — cleaner list, but the better half of search is one tap further and the field would mean different things per tab.

**Q2 — "All words, any order" or "exact phrase"?** Recommendation: **all words, any order, within one message**. *Reason:* people remember fragments ("paprika stew Mira"), rarely the exact sentence; an exact-phrase match would miss most of what they mean. The cost is some looser hits on long messages, which the newest-first order and the snippet make easy to skim past.

**Q3 — Leave reasoning out?** Recommendation: **leave it out**. *Reason:* it is collapsed in the chat, so a hit would land you on a message where the word isn't visible; and reasoning restates the user's words, so nearly every query would hit twice. If you want it, it could come later as an explicit "also search reasoning" — but that is a toggle, and we avoid those.

**Q4 — Bookmarks tab: match the message text too, not only the label?** Recommendation: **yes**. *Reason:* the data is already loaded, it costs nothing, and a renamed bookmark is otherwise unfindable by what it says.

**Q5 — Collapse title matches to five while message search is active?** Recommendation: **yes**, with "Show all *n* chats". *Reason:* at 380 px a dozen title rows push every message hit off the first screen; five rows plus the start of the messages section fit. Short title lists (the usual case) are unaffected.

**Q6 — The one-entry return cache, with partial results and a resume point.** Recommendation: **keep it**. *Reason:* search → hit → back → next hit is the main loop; re-scanning 2–12 s on every return and losing the scroll position would make the feature feel broken, and on a large history you usually tap before the scan is done. It lives in memory only and is dropped on any query, filter or adult-mode change, lock and sign-out. The price is a snippet that can be one visit stale.

**Q7 — Who changes the quick menu's History entry?** *Cleared by the coordinator (2026-11-18):* this unit makes it, as `historyReturnTarget()` in a new `lib/history-return.ts` and a single line in `ChatQuickMenu.tsx`; the papercut session has been told to expect it. Kept self-contained for the later "Back means one thing" unit.

**Q8 — A visible "‹ Results" chip in the chat instead?** Recommendation: **no**, the quick-menu route of §10.1. *Reason:* it leaves the chat surface untouched (the chat is the centre; chrome there is expensive), and the quick menu is where "History" already lives. A chip would be more discoverable; if Chris prefers it, it is a small addition on top, not a replacement.

---

## 13. Laura spec-pass

Laura audited the first draft on 2026-11-18: **2 hard defects, 7 soft notes**, design judged sound; she agrees with Q1–Q5 as recommended and asked to widen Q6. All findings are worked in:

| Finding | Severity | Where it went |
|---|---|---|
| The way back from a hit relies on a system Back that an installed iOS PWA may not have; the quick menu's History opens a reset visit | **Hard** | §10.1 (quick menu returns to the held History URL), §10 (scroll keyed on the search string), Q7/Q8, steps 6–7 |
| Deleting a chat leaves its hits on screen; tapping one lands on a reset History via the deleted-chat guard | **Hard** | §7.1 (groups filtered against the live chat list, live titles), step 12 |
| Tapping before the scan finishes keeps nothing for the return | Soft (her most important) | §10 (partial results + resume point), Q6, step 8 |
| The sticky count line contradicts the section counts | Soft | §4 (hidden while the messages section is shown; empty titles section left out) |
| "IN MESSAGES · 300" reads as a full count | Soft | §7.3 (`300+`), §8.3 (folded hits count) |
| A bookmark matched on its text gives no hint why | Soft | §4.1 (one-line snippet) |
| "Collapse while running" is ambiguous | Soft | §4 (stable while the section is shown) |
| The snippet may highlight only one query word | Soft | §7.1 (window with the most query words) |
| A hit to a vanished message opens the chat in silence | Soft | §7.4 (fallback to latest + toast) |
| The hub's link doesn't say the other side searches more | Soft | §10.2 |

Pre-squash pass follows after the build.

**Coordinator review (2026-11-18), also worked in:** the query text no longer goes into the URL or a storage key (hard: zero-knowledge and adult mode) — §6 point 5, §10, §10.2, steps 24–26; the cost of large non-text blocks measured (§8.1); the unit's size stated (§11); Q7 cleared.

---

## 14. Manual verification

Run on the phone (380 px class) with a real, long history — once in the browser and once as the installed PWA — and once on desktop. A pass is the stated outcome with no console error.

1. **Field and placeholder.** Open My History. *Pass:* Chats tab shows "Search titles and messages…"; Bookmarks tab shows "Search bookmarks…".
2. **One letter.** Type one letter. *Pass:* titles filter as before, the count line stays; under the titles the hint "Type one more letter to search inside messages."
3. **Find a remembered sentence.** Type two or three words you remember from a persona reply in an older chat, in a different order and without accents or capitals. *Pass:* the sticky count line disappears; "In messages" appears with a "searching n / m chats" pill; hits stream in newest chat first; groups never reorder; the snippets show all your words highlighted where they fit, and no `**` or TEAL tags.
4. **Typing stays fluid.** While a scan runs over the full history, keep typing and scroll the list. *Pass:* no stutter in the field; the old scan stops and the new one starts (the pill restarts).
5. **Jump.** Tap a hit. *Pass:* the chat opens at that message, centred, with the highlight pulse; it does not snap to the bottom.
6. **Return by system Back.** Press the phone's Back (or the browser's). *Pass:* History shows the same query, tab, results and scroll position, with no new "searching" pill if the scan had finished; the address bar shows no query text. Tap the next hit; Back again; same.
7. **Return by quick menu (installed PWA).** In the installed PWA, tap a hit, then open the chat's quick menu and choose History. *Pass:* the same History state as step 6. Then open a *different* chat from the Entrance Hall and choose History in its quick menu. *Pass:* History opens as today, filtered to that chat's persona, at the top. Note whether the iOS edge swipe goes back at all.
8. **Return before the scan is done.** On the full history, tap a hit while the pill still shows. Return. *Pass:* the results so far show at once, at your scroll position, and the pill continues from where it stopped rather than from zero.
9. **More in this chat.** In a chat with more than three hits, tap "+ n more in this chat". *Pass:* the group expands in place; groups above it don't move.
10. **Persona filter.** Pick one persona. *Pass:* both sections show only that persona's chats; the scan is visibly faster.
11. **Adult mode (critical).** With adult mode on, search a word that appears in an adult persona's chat; note the hit. Switch adult mode off, return to History, search the same word. *Pass:* no hit from that chat, no group header, no title, no count that includes it — on the Bookmarks tab likewise; the quick menu's History does not lead back to the old results. Flip adult mode during a running scan. *Pass:* the results vanish and the scan restarts, or the app navigates away as it does today.
12. **Delete from the results.** Search a word that is in a chat's title and in its messages. Delete that chat from the titles section's ⋯ menu. *Pass:* its group in "In messages" disappears at once, the counts drop. Rename another matching chat. *Pass:* its group title changes at once.
13. **Vanished message.** Search, return, then open a hit's chat directly and delete that message; go back to History and tap the same (cached) hit. *Pass:* the chat opens at the latest message with "That message is no longer here."
14. **Nothing found.** Search a nonsense word. *Pass:* "Nothing in your history matches "…"" with Clear search; with a persona selected also "Search all personas", which clears only the persona filter and re-runs.
15. **Titles but no messages / messages but no titles.** Search a word only in a chat title. *Pass:* the title section shows the chat; the messages section says "No messages contain "…"." Search a word only in messages. *Pass:* no titles section at all; message hits only.
16. **Many titles.** Search a word in many titles. *Pass:* five title rows and "Show all n chats", then the messages section on the first screen at 380 px; when the scan finishes the titles stay at five.
17. **Cap.** Search a very common word ("the"). *Pass:* the scan stops; the header reads "IN MESSAGES · 300+", with "Showing the first 300 matches. Add a word to narrow it down." under the last group.
18. **Bookmarks tab.** Rename a bookmark to something unrelated, then search a word from the bookmarked message's body on the Bookmarks tab. *Pass:* the bookmark is found, with a one-line highlighted snippet under its label. Tap it, return. *Pass:* Bookmarks tab, query kept.
19. **Tab kept.** Switch to Bookmarks with no query, open any bookmark, return. *Pass:* Bookmarks tab, not Chats.
20. **Fresh visit.** Leave History via the menu (not Back) to another page, then enter it again from the Entrance Hall. *Pass:* top of the page; no stale results flash.
21. **Hub link.** On a persona's hub, filter Recent chats by a word that is in no title but in a message. *Pass:* the link reads "Search messages in History →" and opens History with that persona, the query and the message hits.
22. **380 px.** At 380 px wide, with a long query. *Pass:* no horizontal scroll; snippets wrap to at most three lines; the progress pill fits on the section header line.
23. **Timing on the phone.** With your real history, note roughly how many chats you have, the time to the first hits and to the pill disappearing. *Pass:* first hits within about a second; record the totals in the PR.
24. **No query in the address.** Search "paprika" on History, in a browser tab. *Pass:* the address bar shows `/app/history` with at most `?tab=` and `?personaId=`, never the word; the browser's history and address-bar suggestions don't offer it. Reload. *Pass:* the query and results are back.
25. **Gone after flip, lock, sign-out.** Search a word, open a hit, return. Flip adult mode (on → off). Return to History by Back. *Pass:* empty field, no results. Repeat with a lock and unlock, and with a sign-out and sign-in. *Pass:* the same each time. In the browser's devtools, check `history.state` on the History entry and Application → Storage. *Pass:* no query text anywhere; `sessionStorage` holds only the opaque generation token.
26. **Old link with `?q=`.** Open `/app/history?q=paprika` by hand. *Pass:* the search runs, and the address loses `?q=` at once.
