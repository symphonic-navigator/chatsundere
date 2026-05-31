# Chatsundere Roadmap

Living orientation doc for the path to beta. The *decision* and its
rationale are in [ADR 0031](decisions/0031-eight-block-roadmap-to-beta.md);
this file is the at-a-glance block list and gets edited as blocks move.

**Locked:** 2026-05-31.

---

## Shape

Eight blocks, four version gates. The first public release is a
**local-only alpha** — no account, no sync, no server. The encrypted
backend (the hard, audited crypto core already exists) is deliberately
deferred to Block 6.

| Block | Scope | Status | Gate |
|---|---|---|---|
| **1** | Chat core: LLM-management · persona-management · history · bookmarks · **memory** (chatsune port) · more models/upstreams | ~80% shipped; **memory** is the gap | |
| **2** | Tool core (web_search · web_fetch · calculate_js) · file/image upload + camera · artifacts | not started | **v0.1.0 — alpha, local-only** |
| **3** | Compact-and-continue · ChatGPT import | not started | |
| **4** | STT/TTS voice mode · TTI | not started | |
| **5** | Knowledge base (embeddings) · phrase-triggered injection (lorebooks) | not started | **v0.2.0 — alpha 2** |
| **6** | Backend: cross-device sync · full identity wiring · authenticated CORS proxy | crypto core built + audited; sync/proxy/wiring open | **v0.3.0 — alpha 3** |
| **7** | Homelab / sidecar Tier 1: user-to-self + shared (chatsune parity) | not started | |
| **8** | chatsune chat + knowledge-base import | not started | **v0.4.0 — beta** |

---

## Key constraints carried by the roadmap

- **v0.1.0 = chat experience, not trust architecture.** The zero-knowledge
  backend is not in the first alpha. Conscious framing for release notes.
- **"Mainstream provider" gate relaxed** (was CLAUDE.md §12) — v0.1.0 is
  gated on tool/upload/artifact scope. Freedom-/privacy-oriented providers
  are the identity, not a stopgap.
- **Memory: append-only journal = source of truth; memory body = derived,
  re-dreamable projection.** Decided in Block 1 so Block-6 sync is
  tractable. Open: may the user edit the body directly? (Block-1 brainstorm.)
- **Web tools need the transition proxy** (Chris's VPS). nano-gpt web search
  is the no-proxy omakase default; brave/kagi are proxy-gated,
  disabled-with-tooltip until configured.
- **Backend re-audit before v0.3.0** — the current Larissa pass is a
  snapshot of dormant code.

Design notes for the upcoming Block-1 (memory) and Block-2 (search)
brainstorms: [insights/2026-05-31-roadmap-lock-block1-block2-design-notes](insights/2026-05-31-roadmap-lock-block1-block2-design-notes.md).
