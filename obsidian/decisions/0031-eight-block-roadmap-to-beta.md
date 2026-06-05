# ADR 0031: Eight-block roadmap to beta, with local-only alpha first

## Status

Accepted (2026-05-31, roadmap-lock brainstorm with Chris).

## Context

By 2026-05-31 the client-only side of Chatsundere is substantially built:
full local chat, chain-of-thought display, history, persona/mindspace
system, adult-mode, and a complete curation catalogue with many models
live-verified across five providers (chutes, novita, nano-gpt, wafer,
tensorix). The backend is built and Larissa-approved on the auth side
(OPAQUE, passkey/PRF, step-up, cross-device-identity endpoints) but the
client-side onboarding overhaul that would wire it up has not landed, so
the backend is effectively dormant.

We needed an agreed sequence from here to a public beta. Two questions
shaped it:

1. **What does v0.1.0 mean?** The original gate in CLAUDE.md §12 was
   "2-3 *mainstream* upstream providers with a few popular models."
   Curation has since delivered many models — but over
   freedom-/privacy-oriented niche providers, not OpenAI/Anthropic/Google.
2. **When do we build the encrypted backend (sync, full identity, proxy)?**
   It is the largest and hardest block. The OPAQUE/zero-knowledge *crypto
   core* is the part Chris is least comfortable with — but it is also the
   part already built and audited.

## Decision

We lock an eight-block roadmap with four version gates. The first public
release (**v0.1.0**) is a deliberately **local-only alpha**: no account, no
sync, no server. Chatsundere must be an excellent experience in pure-local
mode (this is already the STATUS-CLIENT-ONLY operating philosophy). The
already-built auth/identity backend stays dormant until Block 6.

| Block | Scope | Gate |
|---|---|---|
| 1 | Chat core: LLM-management, persona-management, history, bookmarks, **memory** (chatsune port), more models/upstreams. ~80% already shipped; memory is the notable gap. | |
| 2 | Tool core (web_search, web_fetch, calculate_js), file/image upload + camera, artifacts. | **→ v0.1.0 (alpha, local-only)** |
| 3 | Compact-and-continue; ChatGPT import. (Both already done in chatsune.) | |
| 4 | STT/TTS voice mode; TTI. (Much portable from chatsune.) | |
| 5 | Knowledge base with embeddings; phrase-triggered injection (SillyTavern-lorebook style). Embeddings research (wasm?) lives here. | **→ v0.2.0 (alpha 2)** |
| 6 | Backend: cross-device sync, full login/identity wiring, authenticated CORS proxy. Largest block. | **→ v0.3.0 (alpha 3)** |
| 7 | Homelab / sidecar Tier 1: user-to-self and shared (chatsune parity). Baalnet protocol comes after. | |
| 8 | chatsune chat + knowledge-base import. | **→ v0.4.0 (beta)** |

### Sub-decisions captured here

- **The "mainstream provider" gate (CLAUDE.md §12) is relaxed.** v0.1.0 is
  gated on tool/upload/artifact scope, not on onboarding a
  mainstream (OpenAI/Anthropic/Google) provider. This is consistent with
  the anti-censorship positioning: freedom-/privacy-oriented providers are
  a deliberate identity, not a stopgap.
- **The backend stays dormant until Block 6 by choice**, to give Chris room
  and learning time for the largest block. The crypto core (the hardest
  part) is already built and audited, so Block 6 is mostly encrypted-sync,
  conflict resolution, proxy, and wiring — not novel cryptography.
- **Memory data model is decided in Block 1 with Block-6 sync in mind**
  (see Consequences) even though sync is far off.

## Consequences

- **v0.1.0 sells the chat experience, not the trust architecture.** The
  zero-knowledge backend (the Proton-level differentiator) is not in the
  first alpha at all. Accepted for an alpha; must be a conscious framing in
  release notes.
- **The Larissa audit of the dormant backend is a snapshot.** Before public
  release with the backend active (v0.3.0), the full security audit must be
  re-run; the auth code may need refreshing after months unused.
- **Web tools have a latent dependency on the proxy.** A pure-browser client
  cannot call most search/fetch endpoints directly (CORS). Resolved by a
  simplified transition proxy Chris will deploy on his VPS; CORS-friendly
  providers (nano-gpt web search) work without it and are the omakase
  default, while proxy-gated providers (brave, kagi) appear
  disabled-with-tooltip until the proxy is configured.
- **Memory must use an append-only journal as the source of truth, with the
  memory body as a derived, re-dreamable projection.** This costs nothing
  extra in Block 1 (local-only, no sync) but makes Block-6 memory-sync
  tractable: divergent memory bodies from parallel offline dreaming are
  discarded and re-dreamed after a conflict-free journal set-union, rather
  than merged. Open question for the Block-1 memory brainstorm: whether the
  user may edit the memory body directly (which would reintroduce a true
  merge conflict) or whether all corrections flow through the journal.
- **The long alpha-2 phase (v0.2.0 → v0.3.0) is deliberate runway** to fold
  in user feedback from the field while the backend is built. chatsune is
  live and loved, which makes this runway productive rather than idle.
- CLAUDE.md §12 is updated to point here; this ADR is the authoritative
  record and `obsidian/ROADMAP.md` is the living orientation doc.
