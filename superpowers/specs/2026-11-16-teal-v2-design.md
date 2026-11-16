# TEAL v2 — Emotions, Companion Tones and New Sounds

**Date:** 2026-11-16
**Status:** Draft, pending Chris's approval
**Target:** 0.4.0 (`master`)
**Part of:** the 0.4.0 ElevenLabs track, step 2 of 3 (step 1:
[`2026-11-15-elevenlabs-direct-design`](2026-11-15-elevenlabs-direct-design.md))
**Builds on:** [`2026-06-11-teal-voice-expression-language-design`](2026-06-11-teal-voice-expression-language-design.md)
(TEAL v1). Everything there holds unless this spec changes it.
**Memory:** Kumbu² `/SWE/Chatsundere/Memory/teal.md`.

---

## 1. Purpose and the why

ElevenLabs v4 performs **emotions and attitudes** (`[sarcastic]`, `[nervous]`, `[playful]`)
and further human sounds. TEAL v1 cannot express them, because v1 is a snapshot of xAI's
vocabulary, which knows sounds and prosody but no feelings. TEAL v2 adds them to our own
language, so personas can carry mood in what they say.

Chris: much of Chatsundere's magic comes from really letting emotions in, emojis included.
v2 therefore also renders emotions as emojis in the chat, for every user, whichever voice
service they use.

## 2. Decisions

| # | Decision | Decided by, because |
|---|---|---|
| D1 | v2 adds **A** emotions and attitudes, **A+** companion tones and **B** new sounds. | Chris, 2026-11-16. |
| D2 | **C** accents and **D** sound effects are parked for "someday". D is not automatically part of a TEAL v3: if it ever comes, it first gets its own thought on how it fits the product. | Chris: accents belong to the persona or voice, not to a message; sound effects are not a voice. |
| D3 | **An emotion holds until the next emotion or the end of the paragraph.** | Chris. It matches ElevenLabs, where a tag carries across the line, and the voice pipeline, which synthesises per paragraph. |
| D4 | **Emotions render as emojis** in the chat, like v1 sounds. | Chris: letting emotions in is part of the magic. |
| D5 | **Dosage:** emotions may appear more often than sounds, but the model behaves naturally and does not play the drama queen. | Chris. |
| D6 | **Each TTS offering declares its TEAL level** (`'none' \| 'v1' \| 'v2'`). Synthesis strips every tag above that level. No translator heuristics. | Chris (approach 1, §5). It is pure data, and v1's own rule D2 ("extension is curation, never heuristics") rules out approximating `[sad]` with `<soft>`. |
| D7 | **The prompt always teaches v2**, whichever voice service is active. It says explicitly that emotions **complement** sounds and prosody and do not replace them. | Chris and Liz: the emojis are magic for every user. The explicit line protects Grok users from hearing fewer laughs and whispers than today, if models were to spend their markup on emotions instead. |

## 3. Goals, non-goals, anti-goals

**Goals**
- Personas emit emotion tags, companion tones and the new sounds where they fit.
- ElevenLabs performs them.
- Grok and Mistral never read them aloud and lose nothing they have today.
- The chat shows each emotion as an emoji, and no raw tag ever flashes.

**Non-goals**
- Accents (C) and sound effects (D).
- Per-backend translators.
- Changing which persona or voice a user picked.

**Anti-goals** — this fails even if it technically works when:
- a Grok user hears fewer v1 sounds than before v2 (D7; checked in curation, §8);
- a raw `[sarcastic]` or a half-typed `[ner` shows in the chat or is spoken by any service;
- personas turn theatrical, with an emotion on every sentence (D5).

## 4. The vocabulary (v2)

`TEAL_VERSION` becomes `2`. The vocabulary stays **closed**: unknown bracket content stays
literal, exactly as in v1. Tag names are English, lower case and hyphenated.

### 4.1 Emotions and attitudes (A) and companion tones (A+): a new category, "mood"

A **mood tag** is an inline tag in square brackets that sets the tone of the following text,
until the next mood tag or the end of the paragraph (D3). Like v1 inline tags, it may carry
qualifier words (`[slightly nervous]`), and its core word decides what it is.

| Family | Mood tags |
|---|---|
| High energy | `excited`, `playful`, `amazed`, `proud`, `startled` |
| Heated | `annoyed`, `angry`, `sarcastic`, `bitter` |
| Tense | `nervous`, `anxious`, `scared`, `hesitant`, `confused` |
| Low energy | `tired`, `bored`, `sad`, `let-down` |
| Calm and warm | `curious`, `thoughtful`, `content`, `peaceful`, `mischievous` |
| Companion tones (A+) | `affectionate`, `teasing`, `flirtatious`, `seductive`, `shy`, `pouting` |

**A+ is provisional.** These tones are not in ElevenLabs' published list and work only through
free phrasing. Curation (§8) checks each one with a harmless listening sample. A tone that
does not perform audibly is removed from the vocabulary before the branch is merged.

### 4.2 New sounds (B): additions to the v1 inline sounds

`clear-throat`, `gulp`, `yawn`, `sniffle`, `groan`, `scoff`.

### 4.3 Resolving a bracket

1. Exact match against all inline tags (sounds and moods).
2. Otherwise the first whitespace-separated token that is a **sound** core word. A sound wins
   over a mood in a mixed bracket (`[playful giggle]` is the giggle), because a sound is a
   concrete event and the display needs exactly one action.
3. Otherwise, a mood only when the bracket holds **at most two tokens and the mood core word is
   the last one** (`[slightly nervous]`, `[very sad]`). This is narrower than v1's sound
   fallback because mood words are common English: `[content removed]`, `[tired of this]` and
   `[sad but true]` stay literal. A bare `[shy]` is accepted as a mood (my call: rare in prose,
   and harmless if it happens).
4. Otherwise the bracket stays literal.

Each tag carries its **level**: v1 sounds and wrapping tags are level 1; moods and the new
sounds are level 2.

## 5. Approaches considered

1. **A TEAL level per TTS offering (chosen, D6).** `TtsOfferingMeta.teal` becomes
   `'none' | 'v1' | 'v2'`, and synthesis strips every known tag whose level is above the
   offering's.
   - Assignments: ElevenLabs `v2`; Grok (xAI direct and nano-gpt) `v1`; Mistral `none`.
   - Trade-off: Grok loses the emotion signal entirely and keeps inferring tone from the words,
     as it does today.
2. **A translator per backend** mapping v2 onto v1 approximations (`[sad]` → `<soft>`).
   - Trade-off: Grok gets a hint, but it relies on heuristics that v1 excluded by design, and
     the approximations would often sound wrong (a sad whisper is not sadness).
   - Rejected.

What Grok misses compared with ElevenLabs, recorded so nobody rediscovers it: sarcasm and irony,
companion tones on neutral wording, mood changes mid-paragraph, and the new sounds.

## 6. Design — `packages/llm-unified`

### 6.1 Vocabulary module (`teal/teal.ts`)

- New exports:
  - `TEAL_MOOD_TAGS` (§4.1) and `TealMoodTag`;
  - `TEAL_INLINE_TAGS` extended by the B sounds (§4.2);
  - `export type TealLevel = 0 | 1 | 2`;
  - `tealLevelOf(tag): 1 | 2`.
- `matchTealInline(content)` resolves as in §4.3 and returns
  `{ kind: 'sound' | 'mood'; tag; level } | null`. The builder may keep the old string-returning
  signature as a thin wrapper if that saves churn in the client; their call.
- `stripTeal(text, maxLevel: TealLevel = 0)` removes every known tag above `maxLevel`
  (`0` removes all, as today), with the same whitespace tidying as now.
- Descriptions for the prompt: one short line per new tag, as in v1.

### 6.2 Offerings and synthesis

- `TtsOfferingMeta.teal: 'none' | 'v1' | 'v2'` (and the Valibot schema picklist).
- Migrate the existing values:
  - `strip` → `none` (Mistral);
  - `passthrough` → `v1` (xAI, nano-gpt Grok);
  - ElevenLabs → `v2`.
- `synthesiseSpeech` calls `stripTeal(text, { none: 0, v1: 1, v2: 2 }[teal])`.
- The voice cache key gains no new input: the stored text is canonical, and the level is a
  function of the offering, which the key already contains.
- **v1 wrapping tags on ElevenLabs** are already curated (step 1, `obsidian/models/eleven-v4.md`):
  none is read aloud, `<whisper>` performs, `<slow>`/`<fast>` are ignored. Level `v2` therefore
  passes them through unchanged, and no fourth level is needed.
- The speakability gate in `segmentation.ts` keeps calling `stripTeal(spokenText)` at level 0, so
  a segment holding only a mood tag is never emitted. A mixed bracket at level 1
  (`[playful giggle]`) goes to Grok verbatim, qualifier included, which v1 already allows.

### 6.2a Mood scope in sentence mode (my call)

`voiceMode: 'sentence'` splits a paragraph into several segments, each synthesised on its own, so
a mood set in sentence 1 would not reach sentence 2 on ElevenLabs. To keep D3 true in both
modes, segmentation **carries the active mood forward**: a later segment of the same paragraph
that does not open with its own mood tag gets the paragraph's active mood tag prepended to its
`spokenText`. The display text and glow anchors are unchanged, because only the spoken text
carries the prefix. For offerings below level 2 the prefix is stripped like any mood. The cache
key follows the spoken text as today. Why my call: it is the only reading of D3 that holds in
both voice modes, and it costs one pass in segmentation.

### 6.3 Prompt segment

`TEAL_EXPRESSION_PROMPT` gains a **Mood** section after the inline tags. It covers the
following; exact prose is the builder's, and tests stay structural:

- the syntax and the scope rule: a mood tag sets the tone until the next mood tag or the end
  of the paragraph, and a new paragraph starts neutral;
- the list of mood tags with one-line descriptions;
- **dosage:** at most one mood per paragraph as a rule, and often none, because tone usually
  follows from the words; use one where the words alone would be misread (irony, sarcasm,
  tenderness on neutral wording) or where the mood shifts; behave naturally and do not
  dramatise;
- **complement, not replace:** moods add to sounds and wrapping tags and do not use up their
  place, so a laugh is still a `[laugh]`;
- the rule that a mood tag stands alone in its brackets, apart from qualifier words, and is
  never combined with a sound in one bracket on purpose.

The v1 strict rules (only listed tags, English names, no markup around tags) extend to moods.

## 7. Design — `apps/user-client`

### 7.1 Render map

- `teal-render-map.ts` gains a `MOOD_RENDER` table: one emoji per mood tag, and one row per new
  sound.
- **Draft rows**, for Chris to curate (the point of the data file):

| Mood | Emoji | Mood | Emoji | Mood | Emoji |
|---|---|---|---|---|---|
| excited | 🤩 | nervous | 😬 | curious | 🤔 |
| playful | 😜 | anxious | 😰 | thoughtful | 💭 |
| amazed | 😮 | scared | 😨 | content | 😌 |
| proud | 😎 | hesitant | 🫤 | peaceful | 🕊️ |
| startled | 😳 | confused | 😕 | mischievous | 😈 |
| annoyed | 😤 | tired | 😪 | affectionate | 🥰 |
| angry | 😠 | bored | 😑 | teasing | 😏 |
| sarcastic | 🙃 | sad | 😔 | flirtatious | 😘 |
| bitter | 😣 | let-down | 😞 | seductive | 💋 |
| | | | | shy | 🙈 |
| | | | | pouting | 😗 |

- **New sounds:**
  - `clear-throat` is silent;
  - `gulp` 😅, `yawn` 🥱, `sniffle` 🤧, `groan` 😩, `scoff` 🙄.

- **No emoji serves both a mood and a sound** unless Chris accepts the overlap on purpose. A
  Vitest test lists the shared emojis, so any overlap stays a conscious choice (Laura). The drafts
  above avoid every overlap with v1 (tired is 😪 because yawn is 🥱; bitter is 😣 because tsk
  is 😒). The emojis Laura flagged as reading wrong were replaced: proud, hesitant, pouting,
  sniffle, gulp.
- **Screen readers hear the meaning, not the emoji's name** (my call, Laura). Every TEAL emoji
  renders as `<span role="img" aria-label="{core word}">`, so VoiceOver says "sarcastic" rather
  than "upside-down face". This applies to v1 sounds too.

### 7.2 Behaviour

- A mood renders as its emoji **at the tag's position**, like a v1 inline sound. Nothing in the
  text is styled across the mood's scope: the scope is a voice matter, not a display one.
- The streaming rules of v1 hold: a half-typed `[ner` at the stream tip is suppressed.
- Code blocks, inline code and links stay immune, unknown brackets stay literal, and qualifier
  fallback works as in §4.3.
- Plain-text surfaces call `stripTeal(text)` with its default `0`, so they strip moods too.

## 8. Curation and verification of the voices

Via `/curate`, recorded in `obsidian/models/eleven-v4.md` and a TEAL v2 note there:

1. **ElevenLabs listening samples.** One sample per mood family, and every A+ tone and B sound
   on its own. All sentences are harmless (no moderation canaries; Chris's rule from step 1).
   The MP3s go to Chris. An A+ tone he does not hear is removed (§4.1).
2. **Grok and Mistral stay clean.** Probe one v2-tagged text on each. Scribe round trip: no tag
   is spoken.
3. **Tag mix with the conversation suite** (D7 guard). Run the suite before and after the
   prompt change on one Grok model and one other model. Compare the count of v1 sound and
   wrapping tags per reply. A clear drop is a finding to fix in the prompt before merge.

## 9. Testing

- **llm-unified (bun test):**
  - vocabulary lists and levels;
  - §4.3 resolution, including sound-wins-over-mood and qualifier fallback;
  - `stripTeal` at levels 0, 1 and 2 (a v2 tag survives only at 2, a v1 tag at 1 and 2);
  - `synthesiseSpeech` sends the right text per offering level;
  - the prompt contains the mood section and the complement rule (structural markers only);
  - the schema accepts the three levels.
- **user-client (Vitest):**
  - mood emojis render;
  - the new sound rows render;
  - a mixed bracket renders the sound;
  - the stream tip suppresses a half-typed mood;
  - a code block keeps `[sad]` literal;
  - an unknown `[melancholic]` stays literal;
  - plain-text strip removes moods.

## 10. Manual verification (Chris, on device)

1. **Emojis in the chat.** Ask a persona for a short teasing exchange, then a sad one. Pass:
   mood emojis appear where the mood begins, and no raw tag is visible, also while it streams.
2. **Not a drama queen.** Chat normally for ten messages. Pass: most paragraphs carry no mood;
   moods appear where tone would otherwise be ambiguous.
3. **ElevenLabs performs it.** With Eleven v4, have a sarcastic line and a shy line read aloud.
   Pass: you hear the sarcasm and the shyness, and no tag is spoken.
4. **Grok stays clean and as lively as before.** Switch to Grok TTS and read the same replies
   aloud. Pass: no tag is spoken, and laughs and whispers still come through as before.
5. **Paragraph scope.** Ask for a two-paragraph reply that starts angry. Pass (ElevenLabs): the
   second paragraph starts neutral unless it carries its own mood.
6. **Moods are distinguishable at 380 px.** On your phone, read a reply that carries one mood from
   each family. Pass: you can tell the moods apart. Tell Liz which rows to merge or change.
7. **No raw tag anywhere.** Reload the chat, open reading mode, bookmark a mood-tagged message and
   look at its preview. Pass: no `[sarcastic]` or similar appears anywhere.
8. **Screen reader.** With VoiceOver or TalkBack, read a message with 🙃. Pass: it is read as
   "sarcastic".
9. **Code stays literal.** Ask for a code sample containing `[sad]`. Pass: it stays literal in
   the code block.

## 11. Left to the builder

- Whether `matchTealInline` keeps a compatibility wrapper (§6.1).
- The exact prompt prose, within §6.3.
- How the render map types the mood table, as long as editing a row stays the whole change.
