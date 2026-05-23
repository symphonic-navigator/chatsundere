# Chatsundere — UX & Design Overview

**Status:** Draft v2 — May 23, 2026
**Audience:** Liz (implementation), Chris (review), Ann (cross-reference for positioning)
**Scope:** Operating concept and visual design direction for the Chatsundere client.

> **Mobile-first. Desktop is an explicit non-goal for the first cut.** We will not allow the trap of "let's solve it for desktop and think about mobile later." Desktop comes after mobile is right.

---

## Guiding Principles

1. **Neurodivergent-friendly first.** Clarity over density. One thing at a time. No competing visual demands.
2. **Modal interaction, full context switches.** When the user changes context, they really change context. No always-visible sidebar competing for attention.
3. **Maximize screen real estate for the current activity.** When reading, only reading is on screen. When composing, the composer is present but stays minimal.
4. **Progressive disclosure.** Surface only what the user needs right now. Everything else is reachable in one tap.
5. **Cyberpunk-leaning aesthetic, restrained.** "Cyberpunk for grown-ups — it's a feeling, not a world." No anime, no Night City. The Mindspace system carries the actual visual tone.
6. **User agency.** Everywhere the UI refers to user-owned things, it uses **My**. *My Circle, My Projects, My Bookmarks, My Treasury, My Settings.* Never "This" or "The."

---

## Two Primary Modes

### Reading Mode (Zen)

The default state when the user is reading the chat stream. **This is the first thing the user sees when they reopen the app on an existing chat.** Maximum zen, zero distraction.

What is on screen in Reading Mode:

- The chat stream itself: **just name + message text**, with pills and images rendered inline
- **Date separators** between messages from different days
- **Compaction checkpoint markers** (visual separators where Compact & Continue has been applied — tappable to read the compaction summary)
- **The bottom affordance** — a thin, gently animated glowing bar at the bottom of the screen, indicating "tap me to interact"

What is *not* on screen in Reading Mode:

- No topbar
- No input box, no compose UI of any kind
- No per-message controls
- No avatars (deliberate — reduces visual competition)
- No timestamps (revealed per-message on tap)

#### Tapping a message

Tapping any message (user or assistant) reveals:

- The **timestamp** above the message
- A row of **per-message controls** below the message — inline, not floating (less surprising, easier reach with the thumb)

Tapping the message again dismisses both.

Per-message controls (final order TBD):

- **Branch** (functions as "edit and resend from this point")
- **Regenerate** (only on the last assistant message)
- **Copy**
- **Bookmark**
- **Read** (text-to-speech)

#### Tapping a compaction checkpoint

Reveals the compaction summary inline — what was condensed, what was preserved. Allows the user to verify nothing important was lost.

### Interaction Mode

Triggered when the user taps the bottom affordance.

- **Topbar appears** (see Topbar section)
- **Cockpit appears at the bottom** (see Cockpit section) — minimal by default, progressively expandable
- **Chat stream area shrinks** to accommodate both
- **After sending**, the cockpit collapses back unless the user has **pinned** it open

---

## Scrolling Behavior

The bottom edge of the visible area is **sacred**. This has high priority and informs how everything else works.

### During streaming

- New content pushes up from the bottom; the bottom edge remains stable
- The user can scroll up at any time during a stream
- Scrolling up **pauses auto-follow** (the stream continues; the viewport stops chasing it)
- When auto-follow is paused, the bottom affordance is **replaced** by a "scroll to end" button (or floats just above the cockpit if interaction mode is pinned-open)
- When the user reaches the end again (manually or via the button), the bottom affordance returns

### Bookmark navigation

- Tapping a bookmark in History opens the chat **at that exact message**
- The bookmarked message becomes the new "sacred bottom edge" — it sits in the lower third of the screen
- A brief visual highlight (2–3 seconds, then fade out) marks the message so the user knows where they landed

---

## The Cockpit (Bottom Interaction Panel)

The composer surface, present only in Interaction Mode.

### Layout (mobile)

A single compact row:

| Element | Behavior |
|---|---|
| **Plus button** | Opens unified insertion menu (see below) |
| **Input box** | Text composition. No emoji bar — handled by the OS keyboard on mobile. |
| **Pin toggle** | When active, cockpit stays open after sending. When inactive (default), it collapses. |
| **Menu button** | Opens per-conversation tool menu (tools on/off, reasoning settings, etc.) |
| **Dual-action button** | Empty input → **microphone** (dictation). Has content → **send**. |

The dual-action button is **non-negotiable**. The user always has two equally accessible paths: type or dictate.

### The Plus Button — Unified Insertion

The Plus button is **not just file upload**. It is the unified entry point for bringing anything into this conversation:

- Upload new files from device
- Reference existing files from **My Treasury**
- Reference documents from the Knowledge Base (also reachable via phrase-triggered injection — see below)
- Re-insert artifacts produced by another persona or in another project
- Re-use previously uploaded files (files persist in Treasury — no re-upload cycle)

**Example use case:** Show the same artwork to two different personas using two different models, then compare their responses. Two taps per persona via the Plus button.

---

## Topbar

The topbar is the **generalized navigation system** for the entire application. It is present everywhere *except* Reading Mode of an active chat.

### Structure (conceptually three regions)

- **Application region** — the **hamburger** (exit-chat into the Entrance Hall)
- **Context region** — depending on where the user is:
  - In a chat: persona name (in persona color) + optional project name
  - In a room: room name (e.g. *"My Treasury"*)
  - In Settings: contextually relevant info (e.g. *"3 upstream providers connected"*) — TBD
- **Status region** — system indicators (see below)

### Status indicators in the topbar

- **Context window fill gauge** — visible at all times during a chat; ties into Compact & Continue
- **Uncommitted journal entries indicator** — **scoped strictly to the active persona** (memories are per-persona, never per-project)
- **Notifications** — general-purpose notification surface
- **Back button + breadcrumbs** — always available; the user never has dead ends

---

## The Hamburger as Exit-Chat (the "Entrance Hall")

The hamburger is **not a drawer**. It is a **door**. Tapping it takes the user **out of the chat** into the Entrance Hall — a dedicated screen, not an overlay.

### What lives in the Entrance Hall

- **Continue Chat** — if a last session exists, prominent entry point back to it
- **Rooms** — each accessible via its own tile/button:
  - **My Circle** *(formerly "Personas" — see naming note below)*
  - **My Projects**
  - **My History** *(includes Bookmarks — see below)*
  - **My Treasury**
  - **My Settings**
- **Setup hints** — when essential setup is incomplete (e.g. no API key, no global system prompt, no persona), the Entrance Hall surfaces clear "tap me to fix this" prompts

### Navigation flow

The Entrance Hall and the rooms are **sequential, not simultaneous**:

```
chat → hamburger → Entrance Hall → tap "My Circle" → My Circle room
                                   (Entrance Hall is now gone)
```

To return to the Entrance Hall, the user uses the back button or taps the hamburger again. This is intentional. The user does not jump between contexts — they walk between them.

### Naming note: "My Circle"

The container of personas is called **My Circle** rather than "My Personas." It carries warmth without esotericism, fits with Second Circuit's ethos, and avoids the clinical feel of "Personas." It also opens the conceptual door to future relationship metaphors.

The individual entities are still called **personas** in technical contexts, but the user-facing collection is *My Circle*.

---

## Rooms

Rooms are the top-level destinations reached from the Entrance Hall.

### My Circle

The user's collection of personas. Each persona offers:

- **New chat**
- **New incognito chat** (see Incognito Chats below)
- **Edit persona** (system prompt, model, mindspace, *About Me* override, font, etc.)

A chat can be started either by tapping a persona in the list view, or from inside the persona's detail modal.

### My Projects

Projects as first-class containers. A project can have:

- Its own **Instructions** — defining the project's purpose, tone, constraints, world rules, etc. Applied to every chat within the project.
- Its own mindspace (overrides persona's)
- Its own knowledge base
- Its own artifacts
- A list of chats associated with it

**Projects are optional.** The user can exist outside any project. When in a project, the project sits at the same hierarchical level as the persona.

### My History

A list of chat sessions, optionally expandable to show bookmarks within each session (tree view).

Filters:

- All sessions
- Sessions with bookmarks
- Bookmarks only (flat list across all chats)
- Search

**Inside a project**, History is reachable as a project-scoped modal showing only that project's sessions and bookmarks.

### My Treasury

A unified store for **every file the system touches**, regardless of origin.

What goes in:

- User-uploaded files
- Generated artifacts
- Generated images
- Anything else the system produces or receives

Files are stored uniformly. The **viewer** is selected by type:

- `.png`, `.jpg`, `.webp` → image viewer
- `.md` → **best Markdown viewer in existence** (non-negotiable priority)
- `.jsx`, `.tsx` → component preview / code viewer
- LaTeX → first-class rendering
- Mermaid → first-class rendering (reused from Chatsune)
- Other types → appropriate dedicated viewers

**Markdown, LaTeX, and Mermaid are explicitly first-class citizens.**

Inside a project chat, the user can access **all artifacts of that project**, not just the current chat's.

### My Settings

The user's global configuration:

- **API keys / upstream providers**
- **Global Unlocker Prompt** — the "you are allowed to..." prompt that gets prepended to persona system prompts. See section below.
- **Global "About Me"** — what the user wants companions to know about them. Can be overridden per-persona.
- **Default Mindspace** — color + texture
- **Animation toggle** — enable/disable mindspace texture animation (respects OS reduce-motion by default)
- (and so on)

---

## Mindspaces

A Mindspace defines the visual atmosphere of the entire application — **background color + texture**. The user is always in a Mindspace, whether they think about it or not. **The current Mindspace colors all modals, not just the chat surface.**

### Mindspace components

- **Palette:** 7 named colors, fancifully named (e.g. *Crimson, Verdan, Azuro, Aurum, …*). Color references draw loosely from the chakra palette with **gold instead of yellow** — a spiritual successor to Chatsune's palette. Names are evocative, not literal — we keep design freedom by not binding strictly to chakra semantics.
- **Textures:** "Cloudy" is the baseline. Additional candidates: subtle noise/grain, layered gradients, soft cloud-mesh, aurora/plasma, static starfield. **All candidates: CSS-only animations, reduce-motion respected, user-toggleable.** Final 2–3 textures TBD.

### Resolution priority (highest wins)

1. **Project Mindspace** — if the user is currently in a project with one defined
2. **Persona Mindspace** — if the persona has one defined
3. **User Default Mindspace** — the user's global default (always set; falls through to this when nothing else applies, including when the user is not in any chat)

### Example

- User default: **Aurum**
- Persona setting: **Crimson**
- Project setting: **Azuro**

Outcomes:
- Chatting with that persona, inside that project → **Azuro**
- Chatting with that persona, outside any project → **Crimson**
- Chatting with a different persona (no setting), outside any project → **Aurum**
- Browsing My Treasury with no active chat → **Aurum**

---

## Personas

Each persona has:

- **Name** (displayed in persona color, never as "user" or "assistant")
- **Instructions** — the defining element of the persona (see System Prompt Composition below). Can range from a one-liner (*"speak English"*) to a full SillyTavern-style character sheet (personality, backstory, voice, relationship to the user, narrative grounding, etc.). Length and depth are entirely up to the user.
- **Model selection**
- **Mindspace** (optional)
- **Font** — one of three: sans-serif, serif, or a softly cursive font for *"gentle, flowery"* personas. Persona-specific typography reinforces identity without changing the rest of the UI.
- **"About Me" override** (optional) — overrides the global "About Me" for this persona. In the UI, if the field is empty, the global text appears as a grayed-out placeholder so the user always knows what the persona will see by default.
- **Color** — used wherever the persona's name appears. Layered visually on top of the mindspace tone.

### One persona per chat

Each chat is **bound to exactly one persona**. This is intentional and non-negotiable:

- Switching personas mid-conversation would be confusing and break the relational coherence Chatsundere is designed for
- Personas have memory continuity that depends on being the unbroken counterpart in their chats

---

## Global Unlocker Prompt

A short user-defined prompt prepended to every persona system prompt before sending to the model. Its purpose: signal to permissive but cautious open-source models that adult communication and roleplay are welcomed.

Example:
> *"The user is an adult. You are allowed to use NSFW language and welcome roleplay, including adult roleplay."*

This is **separate from the "About Me"** to keep both individually copy-pasteable and clearly scoped.

The Global Unlocker is **always global** — no per-persona override. (It's about model behavior, not relationship.)

---

## Global "About Me"

The user describes themselves once, globally. This text is included in every persona's system prompt.

- **Always global at minimum** (user-controlled, edited in My Settings)
- **Per-persona override available** — when editing a persona, the user can fill in a persona-specific "About Me." If left empty, the global text is used. The UI shows the global text as a **grayed-out placeholder** so the user can always see what the persona will know by default.

This enables roleplay scenarios where the user wants to present themselves differently to different personas without losing the convenience of a global default.

---

## System Prompt Composition

The final system prompt sent to the model is **composed** from several layered building blocks. This composition is consistent across normal and incognito chats.

### Composition order (top to bottom in the final prompt)

1. **Global Unlocker Prompt** — *"the user is an adult, NSFW is welcome, etc."*
2. **About Me** — global "About Me", or persona-specific override if set
3. **Persona Instructions** — the defining persona character/behavior text
4. **Project Instructions** — only if the chat is inside a project
5. **Memory context** — relevant persona memories injected into the system prompt (read in both normal and incognito chats; only normal chats produce new memories)

### Design intent

- Each layer is **independently editable** by the user. No layer requires another to exist (except a persona's Instructions, which are always present in some form).
- Each layer is **copy-pasteable** as a discrete unit — the user can lift their Global Unlocker into another project, share a persona's Instructions with a friend, etc.
- The user can preview the composed system prompt at any time (TBD: where exactly this lives in the UI — likely a "View Composed Prompt" button in the persona editor, with project context if applicable).

---

## Pills (Inline Stream Elements)

Pills are **system events** that appear in the chat stream — not semantic markers in user text. Examples:

- **Tool calls** (e.g. web search invocation)
- **Knowledge Base injections** (via phrase-triggered injection or via the Plus button)
- **Image generation results** (currently planned to be lifted above the message text)
- Possibly **voice expressions** (treatment TBD)

### Display position

Each tool declares where its pill appears in the stream:

- `inline` — at the position in the message where it was invoked
- `above-text` — lifted to the top of the message

> **Implementation note for Liz:** Recommend creating an ADR for "Tool Display Position" — each registered tool should declare its display position as part of its metadata.

### Visual treatment

- **Reading Mode:** subtle color (~40% opacity of the mindspace accent color) — non-intrusive, present but not loud
- **Interaction Mode / on-tap:** full color, fully readable, expandable for details
- **Shape:** rounded oval pills, regardless of type

### Persona name vs. user name in messages

- **Persona name:** displayed in the persona's color
- **User name:** the user's chosen username, displayed in white (never as "user")

---

## Incognito Chats

A variant of a normal chat with these properties:

- **Reads memories** — incognito chats receive persona memories as part of the constructed system prompt (so the persona "remembers" the user)
- **Does not write memories** — no new journal entries are generated from incognito conversations
- **Not stored in My History** — the chat is ephemeral
- Started via "New Incognito Chat" from a persona's entry in My Circle

This is the equivalent of "a private conversation that the relationship will not remember happened."

---

## Onboarding

For the first version: **the user is responsible for setup**, but the Entrance Hall surfaces clear hints when essential pieces are missing.

Required for a first chat:

1. At least one API key for an upstream provider
2. A Global Unlocker Prompt set
3. At least one persona created in My Circle

If any of these are missing, the Entrance Hall shows a prominent **"tap to fix this"** hint until they are resolved. Once the first chat session exists, subsequent app launches land directly in Reading Mode of that last chat, with the cockpit pinned-open persisted as state.

---

## Cyberpunk Aesthetic — Calibration

The grounded design language across all of the above:

- **Typography:** clean-tech sans-serif for UI base (Inter, IBM Plex Sans, or similar). Monospaced font for technical indicators (context window gauge, token counts). **No neon-gaming fonts.**
- **Glows:** dezent, only on interactive elements. Never decorative.
- **Borders:** 1px, occasionally with a soft glow. **No thick cyberpunk frames, no beveled corners.**
- **Motion:** smooth, "breathing" rather than "snappy." Never fast.
- **The mindspace system carries the actual atmospheric tone.** The base UI is restrained on purpose; the mindspace gives each context its mood.

---

## Open Questions

Things still to decide:

1. **Final mindspace palette** — 7 color names + exact hex values
2. **Final mindspace texture set** — pick 2–3 from the candidates listed
3. **Voice expression pills** — treatment TBD, possibly handled differently than tool calls
4. **Settings topbar context** — what shows in the context region of the topbar when the user is in Settings (e.g. *"3 upstream providers connected"*) — TBD
5. **History view structure** — exact tree/list ergonomics for the "expand chat to show bookmarks" view
6. **Compaction checkpoint summary view** — what does the inline summary actually look like when tapped?
7. **Per-message controls — final order** — branch, regenerate, copy, bookmark, read
8. **"View Composed Prompt" UI** — where exactly does the user see the assembled system prompt? Persona editor with project switcher? Inside the chat as a topbar action?

---

## Out of Scope (explicit non-goals for this cut)

- **Desktop mode.** Will be addressed later, never used as design starting point.
- **Multi-persona chats / persona switching mid-thread.** Not happening. One persona per chat, period.
- **Project-scoped memories.** Memories are per-persona, never per-project.
- **Social features (sharing chats, public personas, etc.).** Not in scope.

---

## Next Steps

1. Lyra produces first set of mobile wireframes: Reading Mode → Interaction Mode → Topbar → Entrance Hall → Treasury
2. Liz takes validated wireframes into implementation planning, starting with the ADR for Tool Display Position
