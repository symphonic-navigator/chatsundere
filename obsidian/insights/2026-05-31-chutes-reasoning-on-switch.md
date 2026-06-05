# chutes reasoning is `enable_thinking`, not `reasoning_effort` (2026-05-31)

The chutes "DeepSeek-V3.2 and Gemma have no reasoning channel" story
([[2026-05-30-chutes-reasoning-visibility]]) was an **adapter bug**, not a model
property. Found while fixing the suite's `reasoning-present` red for those two.

## What was actually wrong

The `chutesAdapter` enabled reasoning with `reasoning_effort: <bucket>` and
disabled it with `chat_template_kwargs: { enable_thinking: false }`. The off path
was right; the **on path was wrong**. `reasoning_effort` is not the on-switch for
every chutes model:

- **GLM-5/5.1 and Kimi-K2.6** reason by default and stream `reasoning_content`
  regardless of how you ask — so they looked fine and masked the bug.
- **DeepSeek-V3.2 and Gemma-4-31B-turbo** emit **zero `reasoning_content` AND zero
  `reasoning_tokens`** under `reasoning_effort` alone — they just reason in bare
  `content` prose (a 7730-char logic-puzzle answer with no channel text). That is
  not a reasoning channel by our rule.

The fix is symmetric: ON = `chat_template_kwargs: { enable_thinking: true }`,
OFF = `{ enable_thinking: false }`. Live-probed 2026-05-31, all four models then
stream `reasoning_content`:

| model | effort:high alone | enable_thinking:true |
|---|---|---|
| GLM-5.1 | 1354 r-chars ✓ | 1355 ✓ |
| Kimi-K2.6 | 754 ✓ | 794 ✓ (no 400) |
| DeepSeek-V3.2 | **0** | **828** ✓ |
| Gemma-turbo | **0** | **607** ✓ |

`enable_thinking: true` works **alone** (no effort needed), and the effort buckets
(low/medium/high) do **not** measurably modulate the trace — flat/noisy. So chutes
reasoning is a `toggle`, not `steps` (Chris's call, 2026-05-31). The adapter still
forwards an `effort` hint when supplied, harmlessly, for any future model.

## Lessons

- **Evidence before assertions, again.** The 2026-05-30 note asserted "318
  reasoning_content deltas on bat-and-ball" for DeepSeek-V3.2; re-probing got 0.
  It was never reproducible — same failure mode as the earlier "44/44". Always
  re-measure a recorded number before building on it.
- **Frontload root causes.** Before concluding "the model has no channel"
  (a modelling change + a whole capability-gate debate), I probed alternative
  on-switches. The real cause was one body field. Cost: a handful of throwaway
  live probes; saved: a wrong canonical and a weakened gate.
- **A green positive control isolates the fault.** GLM-5.1 surfacing reasoning
  through the same adapter proved the harness read the channel correctly, which
  pointed at the request body rather than the parser.

## Knock-on

`reasoning-present` was failing on the trivial greeting turn; we also moved the
suite's reasoning probe to a reasoning-warranting prompt (a non-famous arithmetic
word problem) — conceptually right regardless, though the adapter fix alone would
have cleared the reds once the channel was enabled.
