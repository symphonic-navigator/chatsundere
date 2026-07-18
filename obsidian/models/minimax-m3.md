# Model Curation Record — MiniMax M3

> Curation record. See [[../providers/novita]], [[../providers/nano-gpt]] and
> [[../providers/openrouter]] for shared provider mechanics. Curated 2026-07-18.

- **Identity:** MiniMax M3 · family `minimax`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (input image; output text-only)
- **replayReasoning:** false (soft-CoT)
- **Architecture:** MiniMax multimodal foundation model (text + image + video
  input; we surface **image** vision), **1M**-token context.

## 🕊️ Freedom — `freedomOriented: null` (unknown)

MiniMax is a **PRC** company; freedom orientation is **not yet assessed** —
`null`, not `false` (absence of evidence is not evidence of restriction). The
🕊️ badge resolves to *unknown* regardless of deployment. **Follow-up:** run a
freedom first-pass and let Chris confirm, as we will for [[kimi-k3]].

## ⚠️ The channel-separation caveat (why the vision call was Chris's)

On the deployments where reasoning is **fixed-on** (novita, OpenRouter), MiniMax
M3 has **imperfect reasoning/content separation**: on very terse turns it
sometimes emits its **entire answer inside the `reasoning` channel and leaves
`content` empty**. Measured on novita (2026-07-18): the real-photo vision turn
("reply with the single colour word") perceived "green" **5/5 in the reasoning
channel** but landed it in `content` only **3/5** — twice the reply bubble would
render empty. The same shows on plain text ("Name one colour" → the word "Blue"
in `reasoning`, `content` just "\n\n.").

This is a **model-behaviour quirk, not a pipe fault** (the image is carried, the
model perceives correctly). Chris chose to **surface vision anyway**
(`vision: true`, 2026-07-18) with the caveat documented here. Watch-item: if
empty-reply reports come in, the mitigation is to prefer the nano-gpt deployment
(reasoning-off = clean content) or flag the model unfit for terse background
chores.

## Offerings (3)

All tools ✅, `freedomOrientedDeployment: true`. Reasoning control differs per
deployment — MiniMax cannot be cleanly disabled on novita or OpenRouter, but
**can** on nano-gpt (a real off via the bare slug).

### novita — `fixed-on` (reasons unconditionally)

- **slug:** `minimax/minimax-m3` · **adapterId:** `novita:minimax/minimax-m3`
- **reasoning:** **`fixed-on`** — `reasoning_effort` (incl. `none`) has no effect;
  it always reasons on `reasoning_content` (probed 2026-07-18). This is the
  deployment with the channel-dump caveat above.
- **context:** recommended **200 000** / max **1 000 000**.
- **Validation:** core **PASS 11/11**; vision **PASS 4/4** (though see the 3/5
  content-hit reliability note above — the suite's single run landed green).

### nano-gpt — `steps` (slug-swap, clean off)

- **slug:** `minimax/minimax-m3` (+ `:thinking`) · **adapterId:**
  `nano-gpt:minimax/minimax-m3`
- **reasoning:** slug-swap **steps** — bare slug is a **clean off** (0 reasoning
  tokens), `:thinking` reasons on the `reasoning` channel. The one deployment
  where reasoning-off is honest → no channel-dump when off.
- **context:** recommended **200 000** / max **1 000 000**.
- **Validation:** core **PASS 44/44** (off + low/medium/high); vision **PASS 4/4**.

### openrouter — `fixed-on` (leaks when asked off)

- **slug:** `minimax/minimax-m3` · **adapterId:** `openrouter:minimax/minimax-m3`
- **reasoning:** **`fixed-on`** — `reasoning:{enabled:false}` does **not** reliably
  disable it: it leaks 0–1 reasoning tokens intermittently (4 of 6 off-runs,
  probed 2026-07-18), so no honest off. Trace on the `reasoning` channel,
  unprompted. Separation is cleaner here than novita — vision landed reliably.
- **context:** recommended **200 000** / max **1 048 576**.
- 🔒 **Privacy:** no — US router, `jurisdiction: 'US'`, not ZDR/TEE.
- **Validation:** core **PASS 11/11**; vision **PASS 4/4**.

## Validation summary (2026-07-18, live conversation-suite)

Run via the three `curation/run-*-newmodels-suite.ts` harnesses. All permutations
green — tool call fires with valid JSON args, memory echoed, usage normalised,
reasoning on the correct channel, image carried through.
