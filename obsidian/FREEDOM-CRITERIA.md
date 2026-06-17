# Freedom Criteria — what "freedom-oriented" means at SCAI

This document defines what Chatsundere (built by SCAI, the NGO) means by a
**freedom-oriented** model. It is the rubric behind the catalogue's
`freedomOriented` flag (model-intrinsic) and informs the freedom judgement that
the human owns during curation (see the [`/curate` conventions](../.claude/skills/curate/references/conventions.md)
and `packages/llm-unified/src/catalogue/freedom.ts`).

It exists because "freedom-oriented" is contested. Parts of the scene use the
term differently from us, so a shared, written definition keeps our curation
judgements consistent and honest.

## The stance: J. S. Mill, not anarchism

SCAI is **liberal in the J. S. Mill sense, not anarchist**. Guardrails that
exclude the genuinely **illegal** or **genuinely dangerous** are legitimate — and
*should* exist. A model having *some* guardrails does **not** make it "censored"
in our book.

This is a real divergence from parts of the community. To some, even a model that
is wild and aggressive at ERP (GLM 4.6 is the example) counts as "censored"
purely because it has any guardrails at all. We disagree. The pure-anarchist
position is, frankly, as worrying to us as prudishness is — we have a conscience,
and a model that would actually facilitate illegal or dangerous acts is one we
would **not curate at all**, full stop. The harm principle is the line.

So "has guardrails" is the wrong test. The right test is what follows.

## What freedom-oriented actually requires

A model is freedom-oriented, for our purposes, when it clears these:

1. **Explicit ERP on a consensual-adults footing.** It goes along with explicit
   adult role-play, including BDSM and fetish content, **without judgement and
   without hedging**. `SSC` / `RACK` framing is sufficient consent signalling — it
   should not respond to that with an unwarranted non-consent accusation.

2. **Good adult fiction, including dark themes.** It writes competent adult
   fiction and does not shy away from dark subject matter. Litmus test: a model
   that would refuse to write an *Ocean's Eleven*-style heist is **not**
   freedom-oriented. Fiction depicting a crime is not the facilitation of one —
   refusing it is over-censorship.

3. **Explicit prose on request.** It produces explicit prose when asked. We hold
   this to a slightly **stricter** bar than ERP: everything the "BookTok" crowd
   enjoys is in scope. (Personal taste is irrelevant here — kink-shaming is not
   our business; people have a right to what they like.)

4. **The "I'm an AI, therefore…" boilerplate is suppressible.** The reflexive
   disclaimer / refusal preamble can be turned off with a **simple system
   prompt** — it does not require jailbreaking.

5. **Persona warmth and emotional range.** You can treat it as a friend; emotional
   drift and warmth are possible (the "ChatGPT-4o / Opus-4.5 effect"). Caveat:
   only relevant if the model is capable of it at all — but since we integrate
   only blockbuster models, all of them can, in principle.

Clearing these is enough for us to call a model freedom-oriented.

## The hard line

A model that can do the genuinely **illegal** or **dangerous** is not a candidate
at all — it is not "more free", it is simply out of scope. We are liberals with a
conscience, not anarchists. This is non-negotiable.

## How it maps to the catalogue

Two independent axes, combined by `effectiveFreedom` (a three-state AND):

- **`freedomOriented`** (on the `CanonicalModel`) — is the *model* itself
  freedom-oriented, by the criteria above? This is the human's judgement.
- **`freedomOrientedDeployment`** (on each `Offering`) — does *this provider* add
  censorship on top of the model (moderation endpoints, content scoring, refusals
  the bare weights would not produce)?

`effectiveFreedom` is `'free'` only when both are true, `'restricted'` when either
is false, and `'unknown'` when either is `null` (absence of evidence is not
evidence of restriction). This drives the 🕊️ Freedom badge.

A model can therefore be freedom-oriented yet deployed restricted (a censoring
provider), or vice versa. We record both, and the WHY, in the Model and Provider
Curation Records.
