# TEAL v2 — field observations

Collection point for tag observations from real use, feeding the next TEAL
vocabulary revision (v1 = the xAI snapshot of 2026-06-11; the closed
vocabulary deliberately leaves unknown tags literal, which is what makes this
log possible). Chris collects; entries land here as they surface. A larger
revision round is planned — do not patch the vocabulary piecemeal.

## 2026-06-12 — first xAI TTS device test (Chris)

1. **`[sing-song]` … `[/sing-song]` emitted by GLM-5.1.** The tag itself IS in
   v1 — as a *wrapping* tag, so `<sing-song>…</sing-song>` is the correct
   form. The Band-1 prompt segment even states "Never write a wrapping tag's
   name in square brackets" (`packages/llm-unified/src/teal/teal.ts:157`), so
   this is model-side format drift, not a vocabulary gap. The closed
   vocabulary correctly left it literal. Open question for v2: whether weaker
   models drift often enough to justify a square-bracket-to-wrapping
   normalisation pass (display and/or TTS input) rather than prompt-only
   discipline.
2. **`[smile]` emitted and audibly honoured by xAI TTS** — but it is not in
   the v1 vocabulary (16 inline tags, no `smile`), so display left it literal
   and no render-map row exists. Strong v2 candidate: empirically supported
   upstream. Likely shape: inline tag + render-map row (e.g. 🙂), and the
   passthrough path already delivers it to xAI unchanged once it is in the
   vocabulary.

More will surface — Chris is gathering for a dedicated TEAL round.
