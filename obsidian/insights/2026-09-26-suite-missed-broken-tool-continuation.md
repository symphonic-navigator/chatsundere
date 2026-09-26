# The conversation-suite missed a broken tool round trip

*2026-09-26 · Liz · found while analysing Gemma 4 on vLLM for Citizen Compute (Project Hecate)*

## What happened

A curation-style walk of `huihui-ai/Huihui-gemma-4-26B-A4B-it-abliterated` on a
self-hosted vLLM node produced a core-suite result of 15/15 green in both
reasoning permutations. The tool round trip was nonetheless broken: after the
`generate_image` result the model answered with ReAct-style JSON
(`{"action": "generate_image", "action_input": …}`) instead of prose, 18 times out
of 18.

## Why the suite could not see it

- `runner.ts` appends the synthesised tool result to the history, and the next
  scenario turn immediately adds the memory system message and a new user
  question. **No turn ever requested the model's reply to the tool result.**
- The one place that could have noticed — the memory turn — asserted the token
  `cat`, which the calico-cat image request had already put into the
  conversation. A model could echo "cat" without the system message arriving.

## Root cause in that case (for the record)

A chat-template defect, not the weights: the derivative repository shipped an
outdated template that cannot render OpenAI `role: "tool"` messages, and
Google's current template omits the empty thought channel the model emits
before a tool call. Evidence and the patch live in Citizen Compute:
`dcra-poc/docs/curation/2026-09-26-gemma-4-26b-a4b-abliterated-vllm.md`.

## What changed here

- New core-scenario turn `tool-result-continuation` (`send: []`,
  `requiresToolResult`), checked by `continuation-not-tool-shaped`,
  `text-present`, `no-http-error`, `no-stream-error` and `usage-present`.
- The runner skips a `requiresToolResult` turn when no tool result precedes it
  and records one failing `tool-result-available` result.
- Memory fact changed to "plays the bassoon"; `memory-echoed:bassoon`.
- `/curate` playbook: a tool-continuation probe item, and a template step for
  self-hosted offerings.

## Lesson

A check that only asserts a status code on a follow-up turn validates that the
bytes flowed, not that the round trip worked. "Validate the pipe" includes the
pipe's *output shape*: a tool call that comes back as text is a pipe failure.
Existing green records predate the turn — see the follow-up in
[[follow-ups-index]].
