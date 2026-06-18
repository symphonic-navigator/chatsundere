# Client-only changelog — chapter index

The shipped-history archive for the client/standalone-mode side, split out of
`STATUS-CLIENT-ONLY.md` on 2026-06-18 when that file reached ~3 965 lines.

**Why this exists:** STATUS is the lean orientation surface (*read first, update
last*). Its narrative session-log and `Done` list had accreted into a 280 KB
wall. They live here now, one chapter per roadmap block (ADR 0031), so STATUS
stays small and you open only the chapter you need.

**Cut rule:** entries are filed by the **roadmap block of the feature**, not by
date — voice work is Block 4 wherever it landed. Curation is its own chapter
because it is an ongoing cross-cutting activity, not a finite block.

**Forward discipline:** the two most recent landings stay in STATUS under
`## Current`. At end-of-session the previous Current entry migrates into its
block chapter here (newest-first, under `## Session log`). That keeps STATUS
from re-bloating.

## Chapters

- [[early-phases|Early phases (Phase 1–4)]] — late-May standalone-mode foundation: backbone, settings, persona editor, chat backbone, CoT display, polish iterations.
- [[block-1-chat-core|Block 1 · Chat core]] — branching, bookmarks, rich rendering, credential bus, system-prompt builder, model-picker, persona settings, model instructions, chat polish.
- [[block-1-curation|Block 1 · Curation]] — provider/model onboardings (chutes, wafer, novita, GLM, DeepSeek, Kimi, Grok, Claude/Fable) + the `/curate` skill & catalogue tooling.
- [[block-2-tools-artefacts|Block 2 · Tools & artefacts]] — artefacts, lightbox, tool-execution spine, web interfacing, MCP client, `ask_expert`, substitute-vision.
- [[block-4-voice-tti|Block 4 · Voice & TTI]] — TTS, live voice, audio toolbar, spectrum, read-aloud, dictation/STT, voice-expression language, roleplay, TTI image generation.
- [[block-5-knowledge-base|Block 5 · Knowledge base]] — knowledgebase chunks A/B/C, lorebooks, embeddings engine & int4 codec.
- [[process-and-tooling|Process & tooling]] — Laura UX auditor, subagent improvements, roadmap lock, status-tracking split, early design specs & wireframes.

Block 3 (compact-and-continue) and Blocks 6–8 have no shipped client-only
history yet; their chapters are created when the first entry migrates here.
