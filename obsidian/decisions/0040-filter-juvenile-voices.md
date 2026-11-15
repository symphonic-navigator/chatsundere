# ADR 0040: Juvenile voices are filtered out, openly

## Status

Accepted (2026-11-15), decided by Chris. Spec: [`superpowers/specs/2026-11-15-elevenlabs-direct-design.md`](../../superpowers/specs/2026-11-15-elevenlabs-direct-design.md) §6.5, §7.1, §8.

## Context

With ElevenLabs (0.4.0), users pick voices from their own ElevenLabs account: predefined voices, voices they cloned, and voices they took from ElevenLabs' public library. That library holds child and teen voices ("Animated Kid Character", "Soft Spoken Teen", "Innocent Kid Narrator").

ElevenLabs has **no child label**. Its `age` label knows only `young`, `middle_aged` and `old`, and `young` covers adults too (8 of the predefined voices are labelled `young`). A filter on labels alone cannot work.

Chatsundere is anti-censorship by identity. Chris, on this one point: here we are the ones who censor, but openly and very narrowly. The stance holds in both directions: hard against harm, as free as possible as long as nobody comes to harm (John Stuart Mill's harm principle).

## Decision

1. **Juvenile voices are always filtered out**, inside `packages/llm-unified`, before a voice list reaches any consumer. Every caller sees the filtered list.
2. **The filter matches terms as whole words, case-insensitively and Unicode-aware**, on a voice's name, description and ElevenLabs' `descriptive` label. The terms are a data list (`JUVENILE_VOICE_TERMS` in `tts/juvenile-filter.ts`):
   - English: kid, kids, kiddo, child, children, childlike, childish, teen, teens, teenage, teenager, boy, schoolboy, schoolgirl, little girl, young girl, toddler, baby, minor.
   - German: kinderstimme, kindlich, jugendlich, teenie, schüler, schülerin, schulmädchen, mädchenstimme.
3. **Deliberately not listed:**
   - `girl`, because adult voices often call themselves that;
   - `young`, because ElevenLabs uses it for adults;
   - the German `kind`, because it collides with the English "kind".
4. **`baby` is listed**, decided by Chris: "baby" as a pet name for a woman normalises exactly what must not be normalised.
5. **Synthesis is guarded too.** A stored or imported voice ID that the filtered list does not contain is refused before any cached audio is replayed. If the ElevenLabs list cannot be loaded, nothing is read aloud: the rule wins over availability.
6. **The filter is stated openly.** The voice picker shows "N voices hidden by our juvenile-voice rule" whenever it hid at least one. The line cannot be dismissed, and it never names the hidden voices.

## Consequences

- **False positives are accepted.** An adult narrator described as a "children's storyteller" is hidden. Hard and narrow beats clever.
- **The list grows by curation only, never by heuristics.** A new term needs a reason and lands as a data row.
- **The rule applies to every future voice provider whose voice list carries names or descriptions.**
- **It secures the reference deployment and sets a clear sign.** Chatsundere cannot control what others do with the software. But under the AGPLv3, a deployer who removes the filter and offers the modified app to users has to publish that source. They then have to answer publicly why they make such a thing possible.
