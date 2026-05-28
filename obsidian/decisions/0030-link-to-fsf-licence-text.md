# ADR 0030: Link to the FSF-hosted AGPL-3.0 text

## Status

Accepted (2026-05-28, alpha-prep follow-up).

## Context

The user-client's About surface in My Account needs to expose the
project licence in a discoverable way to users running the alpha. The
straightforward option is to bundle the full AGPL-3.0 text into the
SPA — Vite can import it as a raw string from `LICENSE-AGPLv3` at the
repo root.

The AGPL-3.0 text is ~32 kB. Bundling it means every user pays the
download cost on every release, even though almost no user actually
opens the licence body. The text is also fully public and stably
hosted by the Free Software Foundation at a URL that has been
unchanged for over a decade.

The AGPL-3.0 itself does not require the licence text to be rendered
inline in an interactive UI. The relevant compliance hooks are:

- **Section 0 + 5d — "Appropriate Legal Notices."** The UI must
  prominently display a copyright notice, a no-warranty disclaimer,
  and a hint that users may convey the work under the licence.
- **Section 4 — "Conveying Verbatim Copies."** Source distribution
  must include the licence text. Chatsundere ships
  `LICENSE-AGPLv3` at the repo root, which satisfies this for forks
  and source consumers.
- **Section 13 — Remote network interaction.** A user interacting
  with a deployed instance must be offered access to the
  corresponding source.

A link to the FSF-hosted text plus a "Source code" link in the About
footer covers all three hooks without bundling the licence into the
binary surface.

## Decision

Link to `https://www.gnu.org/licenses/agpl-3.0.html` from the About
licence footer in the user-client. Do not bundle the AGPL-3.0 text
into the SPA bundle.

The bundled `LICENSE-AGPLv3` at the repo root remains the canonical
artefact for Section-4 source-distribution compliance and for forks.

## Consequences

- ~32 kB less in the SPA bundle on every release.
- A user reading the licence depends on FSF availability at read
  time. Acceptable: the FSF URL has been stable since at least
  2007; offline users can still find `LICENSE-AGPLv3` in the source
  tree (and the source link in the About footer takes them to the
  repo where the file lives).
- If the FSF ever moves the URL, only the `licenceHref` constant in
  `apps/user-client/src/lib/copy.ts` changes. No code change.
- Same pattern works unchanged for any future LGPL / MIT links if
  we later expose the licences of `packages/crypto`,
  `packages/llm-unified`, or `packages/shared-types` in the About
  surface.
