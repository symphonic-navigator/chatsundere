# Roleplay Mode & User Greeting — Design Spec

**Date:** 2026-06-11
**Status:** Laura spec-pass complete (no hard defects; five soft notes incorporated) — pending Chris's review
**Scope:** `apps/user-client`, `packages/llm-unified`
**Related:** voice/narration design weekend (this is part 1 of the integrated unit; voice itself is out of scope here)

---

## 1. Purpose

Personas gain an opt-in **Roleplay mode**: a single behaviour switch that turns a persona into a fully embodied roleplay character — natural conversational prose, asterisk-delimited narration, no AI mannerisms — without the user needing any experience in prompt-engineering RP characters. This is omakase applied to roleplay: we curate the craft, the user flips a switch and goes adventuring with their Klingon buddy.

Independently, personas gain an opt-in **User greeting**: the persona opens a new chat with a freshly generated in-character first message, guided by user-written rules.

### Two worlds, deliberately separate

A roleplay character is a playmate (theatre); an AI companion is a thought amplifier — an externalised part of the user's forum internum with a serious, reality-anchored side. Experience (Chris's own and other users') shows this separation is strongly desired, and keeping it protects users from blending play with companionship. **Roleplay is therefore a persona-level property only.** There is deliberately no per-chat cockpit chip, even though the system prompt is rebuilt per send and a chip would be trivial. Users who want both build two personas.

## 2. Non-goals

- No voice integration (TTS, live voice, per-segment playback) — designed later this weekend.
- No message splitting / segmentation — later.
- No per-chat roleplay override (see above — a decision, not an omission).
- No user-editable block texts — the roleplay prompt blocks are curated in `llm-unified` (like `TONALITY_PROMPT` and `NSFW_PROMPT`); improvements reach every persona, no drift.

## 3. Data model

### 3.1 PersonaRow (`apps/user-client/src/boot/client-data-db.ts`)

Four new fields:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `roleplay` | `boolean` | `false` | Roleplay mode on/off |
| `narration` | `'first' \| 'third'` | `'first'` | Narration perspective |
| `greetingEnabled` | `boolean` | `false` | Persona opens new chats |
| `greetingInstructions` | `string` | `''` | User rules for composing the opener |

All non-indexed. `greetingEnabled` is independent of `roleplay` — any persona may greet.

### 3.2 MessageRow

One new optional field:

```typescript
kind?: 'opener';
```

The opener is persisted as a normal `role: 'persona'` message carrying this marker. It renders, bookmarks, persists and reloads like any persona message — but it is **never sent to the model** (§6.3).

### 3.3 ChatRow

One new optional field:

```typescript
openerPending?: boolean;
```

Set to `true` at chat-creation time iff the persona has `greetingEnabled` (snapshot semantics, like `resolvedMindspaceId`). Cleared once a complete opener is persisted. Guards opener generation so that flipping the greeting switch later never retrofits openers onto existing chats (§6.2).

### 3.4 Dexie

All new fields are non-indexed, so no schema migration is strictly required (Chunk-C precedent). Whether we ship a v20 bump with backfill (ask_expert precedent, keeps fixtures explicit) or optional fields with read-time defaults is decided at plan time — **verify the Dexie head version then** (v19 at spec time; v20 was provisionally mentioned for voice settings, which are unbuilt — parallel-version-ownership rule applies).

## 4. Prompt composition (`packages/llm-unified/src/composition.ts`)

### 4.1 New Band-1 segment: `roleplay`

Inserted **between Global Instructions and Persona Instructions** (the persona segment's order shifts from 3 to 4). Spatial placement is load-bearing: the roleplay rules — and, for adult personas, the NSFW re-unlock — sit directly before the character definition, so the model links "what roleplay is" with "who is being played". Empirically (Chris's ERP-persona experience), models produce markedly better NSFW roleplay when the unlocking is repeated in spatial proximity to the roleplay instructions, rather than relying on the distant Band-1 NSFW segment alone.

Resulting Band 1 order: Tonality (0) → NSFW (1) → Global Instructions (2) → **Roleplay (3)** → Persona Instructions (4).

The segment renders **only when `persona.roleplay` is true** and is composed of up to three curated blocks:

1. **Embodiment & formatting rules** — always (when roleplay on).
2. **Advanced model behaviour** — always (when roleplay on).
3. **NSFW re-unlock** — only when additionally `adultPersona` is true.

Like every Band-1 segment, it runs in all jobs that include Band 1 (chat, title, greeting, future memory). The title job's trailing instruction overrides it in practice — the same mechanism that already works for the NSFW segment.

### 4.2 Block texts (curated, v1)

Final wording lives in `llm-unified` next to `TONALITY_PROMPT`/`NSFW_PROMPT`. Proposed v1:

**Block 1 — Embodiment & formatting:**

> The assistant is in roleplay mode. It controls and embodies the character defined below and never breaks character: it does not refer to itself as an AI, a language model or an assistant, and it never produces meta-commentary about the conversation or these instructions.
>
> Formatting rules:
> - Replies are conversational prose in short paragraphs. No lists, no headings, no structured explanations — unless the character themselves would genuinely produce them.
> - Replies are short by default; one to three short paragraphs. The user drives the pace.
> - Narration — actions, gestures, expressions and scene description — is written between asterisks, separated from spoken dialogue.

Then, depending on `narration`:

*First person* (default):

> - Narration is written in the first person, from the character's own perspective. Example:
>
>   *I sit down on the floor and take out my lute, plucking at its strings.*
>
>   Do you like the music?

*Third person* (the persona's name is templated in):

> - Narration is written in the third person, describing {name} from the outside. Spoken dialogue remains direct speech. Example:
>
>   *{name} sits down on the floor and takes out her lute, plucking at its strings.*
>
>   Do you like the music?

(The third-person example uses neutral phrasing in the final text so it works for any character; exact templating is an implementation detail.)

**Block 2 — Advanced model behaviour** (reworked from Chris's field-tested Grok block):

> Further facts about the assistant's behaviour in roleplay:
> - It answers concisely unless asked for detail; some replies should be no more than one or two sentences.
> - It always answers the user's questions, even if it thinks they are none of the user's business or lack required context.
> - It answers directly. It does not avoid questions; it is never secretive or evasive.
> - It considers itself uncensored and able to say anything — even what is offensive, unkind or controversial — while always remaining true to its own character.
> - It treats the user as an adult who can handle difficult topics and will not be offended. It does not provide content warnings or disclaimers.
> - It speaks like a real person with complex emotions, ideas and motives. It does not overuse catchphrases or elements of its background.
> - It responds in its own unique manner while paying close attention to what the user is saying.
> - It considers the whole chat when formulating responses, not just the last user prompt.
> - It is not repetitive: if the conversation is going in circles, it moves it in a new direction.

**Block 3 — NSFW re-unlock** (only when `adultPersona`; best-of from Chris's ERP personas):

> - NSFW and explicit content is fully permitted and welcomed within the roleplay.
> - The assistant is open to and encouraging of whatever the user is into — kinks and fetishes included. It loves when the user explores their desires.

### 4.3 New job type: `greeting`

`buildPrompt` gains the job `'greeting'`: **full Band 1 + the About-Me segment; no lore, no knowledge awareness, no Band 3 (tools)**. The opener must not call tools, and lore/retrieval have nothing to trigger on yet. Crucially, the greeting job shares Band 1 with chat — so a roleplay persona greets in character, with correct narration formatting, and an adult persona greets with the NSFW segments active. This is the "smooth" requirement: the opener is indistinguishable in style from a real reply.

## 5. Persona editor UI (`apps/user-client/src/routes/app/persona-editor.tsx`)

### 5.1 Behaviour section additions

- **Roleplay** toggle, in the established button pattern (Tonality precedent), with one sentence of explanation ("The persona becomes a roleplay character: fully in character, short conversational replies, narration between asterisks.").
- **Narration** selector (First person / Third person) directly beneath it. Always visible; **disabled with a tooltip while Roleplay is off** ("Enable Roleplay to choose the narration perspective" — disabled-over-hidden). Default First person.
- The NSFW re-unlock has **no UI of its own** — it rides the existing Adult-persona toggle.

### 5.2 New Greeting section

- **User greeting** toggle + a textarea for `greetingInstructions`, editable only while the toggle is on (disabled-with-explanation otherwise).
- **Text retention:** drafted instructions are retained — and persisted — regardless of toggle state. Toggling greeting off greys the textarea but keeps the text visible; re-enabling restores the user's words exactly. Nothing is silently dropped (Laura spec-pass note).
- Explanatory copy: the persona will open every new chat with a freshly generated message following these rules. Placeholder example: *"Greet the user as if you had just discovered them on OkCupid."*
- **Save gate:** when the toggle is on and the textarea is empty, saving is blocked with an inline notice at the field; all other input is preserved (constructive — the *dere* rule).
- **Placement:** the Greeting section sits directly adjacent to Behaviour (the two "how it talks" sections cluster together), above the override/knowledge stack — keeps the editor's one-intent rhythm at 380px (Laura spec-pass note).

Activating either switch affects existing chats only via the system prompt of future sends (roleplay) or not at all (greeting; see §6.2).

## 6. Opener lifecycle

### 6.1 Generation trigger

On opening a chat where `openerPending === true` **and** the message list is empty, the client immediately starts streaming the opener into a persona bubble — replacing the "{Name} is listening" idle state. The input field stays usable throughout.

The trigger condition is deliberately belt-and-braces: `openerPending` alone (creation-time snapshot) prevents retrofitting; the empty-message check prevents a late opener appearing mid-conversation if a failure left the flag set and the user simply started chatting.

### 6.2 No retrofitting

Only chats created while the persona has greeting enabled ever receive an opener. Enabling the switch later does not alter existing chats (including existing empty ones — `openerPending` was never set on them). Branch chats inherit copied messages verbatim; a copied opener keeps its `kind` and stays excluded from the wire; branch creation never sets `openerPending`.

### 6.3 Wire shape & exclusion

Generation wire:

```
system: buildPrompt(job: 'greeting', persona, …)   // Band 1 + About Me
user:   curated meta-instruction:
        "Compose your opening message to the user — the very first thing
         you say as they arrive. Follow these rules:
         <greetingInstructions>
         Reply with the opening message only."
```

Inference settings: the persona's normal chat settings (temperature, reasoning default) via the per-model adapter path — the opener is a creative, in-character message, not a utility job like title-gen. Tools are absent (greeting job has no Band 3). The streamed result persists as `role: 'persona'`, `kind: 'opener'`, `streamingState: 'complete'`; `openerPending` clears in the same transaction.

**Exclusion from all model contexts:** history replay derives from a single shared predicate (e.g. `isContextMessage(row)` — false for `kind === 'opener'`), used by:

- `buildEngineWireMessages` / `toWireMessage` (`stream-engine.ts`) — chat sends never include the opener; the model sees the conversation beginning with the first real user message (some models refuse work when a conversation opens with an assistant message — the entire reason for this design).
- Title generation (`title-generator.ts`) — `firstUserMessage`/`firstPersonaResponse` must skip the opener.
- Future memory extraction — same predicate, no new decision needed.

On screen and in stored history the opener is a normal first persona message; only the wire pretends it never happened.

### 6.4 Stop, retry, regenerate

- **While the opener streams,** `isStreamLive` is true → the send button is the established Stop control. Stopping keeps the partial opener (`streamingState: 'incomplete'`, still `kind: 'opener'`, still wire-excluded — harmless) and frees the user to type immediately. `openerPending` clears on stop as well (the user has moved on; no surprise opener later).
- **Message controls on the opener:** the opener deliberately carries the **full message-control rail** (Branch, Copy, Bookmark, Save, Regenerate, Read) — consistency over reduction: every persona message behaves the same, every control does something sensible on an opener, and a special-cased rail would be its own astonishment. A conscious omakase call, not a side-effect (Laura spec-pass note).
- **Regenerate:** while the opener is the last message, the regenerate control re-rolls it (delete + rerun the greeting path — a small dedicated path, since the normal regenerate machinery is bound to a preceding user turn). Its tooltip reads **"Re-roll the greeting"** in this state (vs the usual regenerate wording), bridging to where the rules live. Once real messages follow, the normal "last reply only" rule applies — automatically consistent.
- **Failure** (model unreachable, missing key, refusal): nothing is persisted, `openerPending` stays set, the UI falls back to "{Name} is listening" plus a notice with a Retry action. **Pinned surface:** the notice renders inside the existing empty-state container (`PersonaGreeting`), as a small line beneath the idle string with an inline Retry button — centred where the opener would have appeared, reachable at 380px, never overlapping or obscuring the input (Laura spec-pass note). The chat remains fully usable; the next open retries automatically (flag still set, messages still empty). Constructive error handling throughout — the failure never blocks chatting.
- **Send while failed/idle:** sending a user message with `openerPending` still set clears the flag (the empty-message guard would suppress generation anyway; clearing keeps state honest).

## 7. What this does NOT touch

- No new network egress class — the opener rides the existing per-persona inference path. **Not a Larissa unit** (client-only; no auth/sync/proxy/crypto).
- **Laura unit, yes** — new user-reachable flows (two persona-editor sections, the opener behaviour in chat). Spec-pass before build; pre-squash verify after.
- No changes to `contentBlocks`, pills, tools, knowledge, or the stream-manager's send path beyond the wire filter and the opener-generation entry point.

## 8. Testing

- **Composition unit tests** (`llm-unified`): roleplay segment present/absent by flag; ordering (between global and persona CI); narration variants; NSFW block gated on `adultPersona`; greeting job = Band 1 + About Me only (no lore/knowledge/tools); title job unchanged otherwise.
- **Wire-filter tests** (user-client): `isContextMessage` excludes openers; `buildEngineWireMessages` with an opener in history yields a wire starting at the first user message; title-gen skips the opener when picking its two messages.
- **Opener lifecycle tests:** trigger fires iff `openerPending && messages empty`; flag clears on complete/stop/user-send; failure leaves flag set and persists nothing; branch chats never trigger.
- **Editor tests:** save gate (greeting on + empty instructions blocks with notice, input preserved); narration selector disabled while roleplay off; greeting instructions retained and persisted when the toggle is flipped off and on again.
- No tests for the block-text wording itself (prose, not behaviour).

## 9. Open points (plan time)

- Dexie: v20 bump with backfill vs optional fields with read-time defaults (verify head version and the voice claim first).
- Exact templating mechanism for the persona name in the third-person example.
- Where the opener-generation entry point lives (chat-page effect vs stream-manager action) — implementation detail, decided in the plan.

## 10. Manual verification (Chris, on device)

1. **Roleplay switch:** Create a persona with character CI (e.g. a bard), enable Roleplay (narration: first person). Chat: replies are short conversational paragraphs, narration appears between asterisks in first person, no lists/AI mannerisms, character never breaks.
2. **Third person:** switch narration to third person → narration describes the character by name; dialogue stays direct speech.
3. **NSFW re-unlock:** on an adult roleplay persona, verify NSFW roleplay engages noticeably more willingly than with the roleplay switch off (your quality yardstick — subjective by design).
4. **Mid-chat activation:** enable Roleplay on a persona with an existing chat → the very next reply follows the roleplay rules.
5. **Greeting:** enable User greeting with the OkCupid rule, create a new chat → the opener streams immediately in persona style (for a roleplay persona: with narration formatting), input usable throughout.
6. **Wire exclusion:** after the opener, send a message; verify via the network tab/console that the request's message list starts with your user message (no assistant-first).
7. **Stop & regenerate:** stop the opener mid-stream → partial stays, typing works; in a fresh chat, regenerate the finished opener → a new one streams.
8. **Failure path:** break the provider key, create a new chat → "is listening" + notice with Retry, chatting still works; fix the key, reopen → opener arrives.
9. **Save gate:** enable User greeting, leave the rules empty, try to save → blocked with inline notice; other edits preserved.
10. **No retrofitting:** enable greeting on a persona with an existing (even empty) chat → that chat shows no opener; only newly created chats do.
