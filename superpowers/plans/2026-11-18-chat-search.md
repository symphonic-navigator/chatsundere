# Search inside chats — implementation plan

**Spec:** [`superpowers/specs/2026-11-18-chat-search-design.md`](../specs/2026-11-18-chat-search-design.md) (approved by Chris, 2026-11-18)
**Branch:** `feat/050-chat-search`
**Scope:** `apps/user-client` only. Larissa paths not touched.
**Execution:** subagent-driven, tasks in order; each task ends green on its own tests and `pnpm --filter user-client typecheck`. Subagents never commit, push, merge or switch branches — Liz commits after review.

All paths below are relative to `apps/user-client/`. Every new file carries `// SPDX-License-Identifier: AGPL-3.0-only`; every exported function a one-line JSDoc; British English throughout.

## Facts the plan relies on

- `messages` index `[chatId+createdAt]` (`src/boot/client-data-db.ts`); `MessageRow.contentBlocks` holds `text` / `pill` / `reasoning` blocks; pills and attachments are separate tables.
- Displayed text: `displayPlainText(flattenAnswerText(blocks))` (`src/lib/teal/display-plain-text.ts`, `src/lib/content-blocks.ts`). Grapheme-safe cutting as in `src/lib/toc.ts`.
- Gating: `useFilteredPersonas()` (`src/data/personas.ts`); `useAdultMode()` / `useUpdateSettings()` (`src/data/settings.ts`).
- Jump: `navigate('/app/chat/<id>?focus=<msgId>')`; handled in `src/routes/app/chat/chat-page.tsx` (`jumpToMessage` ≈ l.136, focus effect ≈ l.826); `scrollToMessage` returns `false` when the element is missing.
- Toasts: `toastStore.show({ message, tone, durationMs })` (`src/state/toast.store.ts`).
- Sign-out: `useSessionStore` in `@chatsundere/ui-shared` (`closeAndForget`), full wipe `src/lib/wipe-device.ts`, decouple `src/lib/decouple-device.ts`. **The client has no separate "lock"**; the spec's "lock" maps to sign-out / wipe / decouple here (spec note added in Task 6).
- Tests: Vitest + jsdom + `fake-indexeddb/auto` (`tests/setup.ts`); History route test `tests/unit/history-route.test.tsx` with a `seed()` helper (SFW persona "Sage", adult persona "Lyra").

---

## Task 1 — Folding, matching and snippets (pure)

New `src/lib/search/fold.ts`:
- `foldWithMap(s: string): { folded: string; map: number[] }` — NFD, drop `\p{M}`, `toLowerCase()`; `map[i]` = index in the original string of folded char `i` (plus a final sentinel = `s.length`).
- `fold(s)` — folded string only (fast path for the cheap reject).
- `queryWords(q: string): string[]` — fold, split on `\s+`, drop empties, de-duplicate.

New `src/lib/search/message-snippet.ts`:
- `rawCandidate(blocks: ContentBlock[], words: string[]): boolean` — fold the joined `text` blocks (reasoning and pills ignored), true when every word occurs.
- `matchMessage(displayText: string, words: string[]): Snippet | null` — every word must occur in the folded display text, else null. Window of ~120 chars placed to contain the most distinct query words (slide over the sorted match positions; tie → earliest), widened to word boundaries, grapheme-safe; `…` at cut ends; newlines → spaces; `marks` = every occurrence of every word inside the window, mapped back to original offsets, merged where overlapping, relative to the returned `text`.
- `type Snippet = { text: string; marks: [number, number][] }`.

Tests `tests/lib/search/fold.test.ts`, `tests/lib/search/message-snippet.test.ts`: "Müller"/"muller"/"MULLER"; "café"→"cafe" mark offsets on the accented original; emoji/ZWJ not split at cuts; all-words-any-order; a missing word → null; window prefers the region holding both words in a long text; markdown/TEAL never appears (feed via `displayPlainText`); reasoning-only match → `rawCandidate` false.

## Task 2 — The streamed scan (no React)

New `src/lib/search/scan-messages.ts`:

```ts
export interface ScanChat { id: string; personaId: string; title: string }
export interface MessageHit { chatId: string; messageId: string; role: 'user' | 'persona'; createdAt: number; snippet: Snippet }
export interface ScanProgress { scannedChats: number; totalChats: number; hits: number; capped: boolean; done: boolean; nextIndex: number }
export async function scanMessages(args: {
  chats: readonly ScanChat[];       // already gated + persona-filtered, newest first
  query: string;
  startIndex?: number;              // resume point
  cap?: number;                     // default 300 (exported const MESSAGE_HIT_CAP)
  initialHits?: number;             // hits already held when resuming
  signal: AbortSignal;
  onHits: (hits: MessageHit[]) => void;   // batched, ≤ every ~100 ms and at the end
  onProgress: (p: ScanProgress) => void;
}): Promise<void>
```

- For each chat from `startIndex`: `db.messages.where('[chatId+createdAt]').between([id, Dexie.minKey], [id, Dexie.maxKey]).toArray()`; skip `role === 'system'`; `rawCandidate` → `matchMessage(displayPlainText(flattenAnswerText(blocks)))`; collect in chat order.
- Check `signal.aborted` before every chat read and after it; return silently when aborted (no callbacks after abort).
- Yield between chats (`await new Promise(r => setTimeout(r, 0))`; use `scheduler.yield` when present).
- Stop at the cap (`capped: true`); hits beyond the cap in the current chat are dropped.
- Only ids from `args.chats` are ever queried — the gate is the caller's list.

Tests `tests/lib/search/scan-messages.test.ts` (seed `openClientDataDb()` directly): order follows the input list; hits within a chat in `createdAt` order; system rows and reasoning-only matches skipped; cap stops and flags; abort mid-scan stops further `onHits`; `startIndex` resumes; **structural gate test**: spy on `db.messages.where` (or wrap the table) and assert no chat id outside `args.chats` is ever passed — seed an adult chat containing the word and leave it out of `chats`.

## Task 3 — Navigation state, generation, return target, return cache

New `src/lib/history-return.ts` (self-contained, module state, no React):
- Generation: `currentHistoryGen(): string` (read from `sessionStorage['cs-history-gen']`, created with `crypto.randomUUID()` on first use; try/catch → in-memory fallback), `rotateHistoryGen(): void` (new token; also clears the return cache and the return target).
- Return target: `rememberHistoryReturn(loc: { pathname: string; search: string; state: HistoryNavState }, chatId: string)`, `historyReturnTarget(chatId: string): { to: string; state: HistoryNavState } | null` — only for the chat that was opened from History and only while the stored gen is current. Exported so the later "Back means one thing" unit can call or replace it.
- Return cache: `getSearchCache(key)`, `setSearchCache(entry)`, `clearSearchCache()` — one entry `{ key, groups: MessageHit[] , progress: ScanProgress }`; key = `JSON.stringify([query, personaFilter, sortedVisiblePersonaIds, gen])`.
- `type HistoryNavState = { q?: string; scrollY?: number; gen: string }`.

Rotation wiring (small, local):
- `src/data/settings.ts` `useUpdateSettings`: on success, when the patch carries `adultMode` and it differs from the previous value, call `rotateHistoryGen()`.
- Sign-out / wipe / decouple: subscribe once at module load of `history-return.ts` to `useSessionStore` (session → null ⇒ rotate); call `rotateHistoryGen()` in `wipeDevice` and `decoupleDevice` (one line each). If `useSessionStore.subscribe` is not available in tests, guard it.

New `src/components/history/useHistoryNavState.ts`:
- Reads `location.state` as `HistoryNavState`; if `gen !== currentHistoryGen()`, discard and `navigate(location, { replace: true, state: { gen } })`.
- Inbound `?q=`: read once, move into state, strip `q` from the search params with `replace` in the same effect.
- Exposes `{ q, setQ (debounced 250 ms write with replace), scrollY, saveScroll() }`; `saveScroll` writes `window.scrollY` into the current entry's state (replace) — called on leaving (hit/bookmark/row tap, and in an unmount effect as a fallback via `window.history.replaceState` merge, because the router location has already changed on unmount).
- Never writes `q` into `location.search`.

Tests `tests/lib/history-return.test.ts`, `tests/components/history/use-history-nav-state.test.tsx`: gen rotation clears cache and target; stale gen state discarded; `?q=` stripped and moved into state; `q` never appears in `location.search`; `historyReturnTarget` null for another chat and after rotation; sessionStorage holds only the token (assert no stored value contains the query).

## Task 4 — Search hook and hit list

New `src/components/history/useMessageSearch.ts`:
- Input: `{ query, chats: ScanChat[] (gated, filtered, newest first), personaFilter, visiblePersonaIds }`.
- Query < 2 chars ⇒ `{ status: 'idle' }`. Else debounce 250 ms, then: cache hit with equal key ⇒ render cached hits at once and, unless done/capped, resume from `progress.nextIndex`; otherwise new `AbortController` and `scanMessages`. Abort on any input change and on unmount; on unmount (or on every flush) store the current partial result + progress in the return cache.
- Output: `{ status: 'idle' | 'short' | 'scanning' | 'done', hits: MessageHit[], progress, capped }`.

New `src/components/history/SearchHitList.tsx` rendering the spec's §7.2 contract (`SearchHitGroup[]`, `SearchHit`), plus a pure `toHitGroups(hits, liveChatsById, personaById)` in `src/lib/search/hit-groups.ts`:
- Drops groups whose chat is not in `liveChatsById` (deleted / gated); title from the live chat (`displayTitle`); `roleLabel` 'You' or persona name; `href` `/app/chat/<chatId>?focus=<messageId>`.
- Group header (avatar 28 px + title in persona colour, not a link), max three hits, "+ n more in this chat" expands in place (local state per group).
- Hit row: `cs-row` button; 11 px monospace `YOU`/`MIRA` + date (`3 Nov`, year added outside the current year, `Intl.DateTimeFormat('en-GB')`); snippet `line-clamp-3` with `<mark className="cs-search-mark">`.
- `onOpen(hit)` callback (History saves scroll and remembers the return target before navigating).

Tests `tests/components/history/search-hit-list.test.tsx`, `tests/lib/search/hit-groups.test.ts`: deleted chat's group dropped, rename reflected; three-then-more; marks rendered; role labels; `useMessageSearch` with fake timers: debounce, abort on change, short status, cache resume.

## Task 5 — History page, bookmarks, help, CSS

`src/routes/app/history.tsx`:
- `tab` from `?tab=` (absent ⇒ chats), written with `replace`; `q` from `useHistoryNavState`.
- Query ≥ 2 chars on Chats: hide the sticky count line; "CHAT TITLES · n" section (left out at 0; first five + "Show all n chats" in place); "IN MESSAGES · n" / "· 300+" header with right-aligned progress pill `searching 12 / 48 chats`; one-letter hint; the states table of spec §7.3, including the whole-page empty state with **Clear search** and (persona filter set) **Search all personas**.
- No query: page unchanged.
- Placeholders: "Search titles and messages…" (Chats), "Search bookmarks…" (Bookmarks); `HistorySearchBar` default placeholder updated.
- Every navigation away from a hit, a bookmark or a chat row: `saveScroll()`, `rememberHistoryReturn(...)` (hits and bookmarks only), then navigate. Restore scroll from state once the list has rendered (title list ready, and either no message search or cached hits rendered) — one-shot.
- Bookmarks: match label **or** folded message text with all words; when matched by text only, pass a one-line snippet (`matchMessage`) to `BookmarksList` (new optional prop on each bookmark, rendered under the label with `line-clamp-1` and marks).

`src/content/help/history.md`: rewrite "Finding a conversation" (titles and messages, all words any order, persona filter narrows, results newest chat first). `src/index.css`: `.cs-search-mark` (accent text, subtle background, no padding jump) and the progress pill if no existing pill class fits — a few lines, appended in one block with a comment header.

Tests: extend `tests/unit/history-route.test.tsx`: message hit appears and links to `?focus=`; adult chat never appears in SFW mode (hits, headers, counts); `?tab=bookmarks` honoured and written; `q` never in `location.search`; one-letter hint; empty state buttons; five-title collapse; bookmark text match with snippet.

## Task 6 — Return path, focus fallback, hub link, spec note

- `src/components/chat/ChatQuickMenu.tsx`: the History entry's `run` becomes one line calling a helper from `lib/history-return.ts`, e.g. `run: () => goHistory(navigate, p.activeChatId, fallbackHref)` where `goHistory` uses `historyReturnTarget(chatId)`: `navigate(-1)` when `window.history.state?.usr` of the previous entry can't be inspected — so use: if the target exists, `navigate(target.to, { state: target.state })`; else the existing href. (Keep the diff in `ChatQuickMenu.tsx` to the single `run:` line; adapt if the menu's `go` helper must wrap it.)
- `src/routes/app/chat/chat-page.tsx`, focus effect only: after the existing retry, if `scrollToMessage` still fails, re-enable auto-follow and `toastStore.show({ message: 'That message is no longer here.', tone: 'info', durationMs: 4000 })`. Make `jumpToMessage` report failure via a callback or return a promise; touch nothing else.
- `src/components/persona-hub/RecentChatsAccordion.tsx`: `q` moves from the href into `<Link state={{ q, gen: currentHistoryGen() }}>`; on the no-match state the link reads "Search messages in History →".
- Spec: one-line note in §10 that the client has no separate lock, so the rotation runs on sign-out, wipe and decouple (and adult-mode flip).

Tests: quick-menu History goes to the remembered location for the chat opened from History and to the default href otherwise; focus fallback shows the toast (extend the existing chat-page focus test if present, else a focused test of the extracted helper); hub link carries no `q` in its href, has the state, and shows the new label on no match.

---

## Gates (Liz, after Task 6)

`pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm exec biome check .` — all at the repo root. Then Laura's pre-squash pass on the diff against the spec. Then merge `master`, ensure the last commit is not `[skip ci]`, mark PR #56 ready, report to the coordinator.
