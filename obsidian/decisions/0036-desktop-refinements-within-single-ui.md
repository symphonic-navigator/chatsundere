# 0036 — Desktop refinements within the single-UI principle

Date: 2026-07-18
Status: Accepted

## Context

Hard rule §3.4 ("Desktop is a constrained-width version of the same UI")
served the mobile-first build phase well, but with the client feature-complete
and in field use, a 640 px desktop column, right-aligned ragged user text and
a collapsible cockpit read as mobile constraints exported to a screen that
does not share them. The 2026-07-18 desktop iteration (spec
`superpowers/specs/2026-07-18-desktop-ui-iteration-design.md`) wanted a
principled way to refine desktop without forking the UI.

## Decision

Desktop remains the **same UI** — same routes, same components, same flows —
but may receive targeted refinements gated on the single `lg` breakpoint
(1024 px) where a mobile constraint exists only because of mobile's limits,
not as a design value. Mobile-first remains the design root. Desktop
refinements must never fork flows or add desktop-only features.

First refinements under this rule: a 896 px chat column, left-aligned
content-sized user-message bubbles (persona text stays open), and a
permanently open cockpit — desktop has a single chat mode (always
interaction, always pinned semantics), derived at read time and never
written to the store.

Within that single mode the cockpit's pin control is **removed on desktop,
not disabled** — a conscious, narrow exception to §11's "disabled over
hidden": with nothing to toggle, the capability is structurally absent, and
a greyed pin would advertise a phantom state (same reasoning class as the
admin tile's hidden-not-disabled exception, spec 2026-07-05 §4.2).

## Consequences

- CLAUDE.md §3.4 is reworded to reference this ADR.
- Desktop loses the zen/dim reading mode — a named trade, logged in
  `obsidian/insights/ux-deferrals.md`, with a sketched remedy (a lightweight
  "focus read" affordance) should field testing read the permanent composer
  as nagging.
- Future desktop ideas (e.g. sidebars) must pass the same test: same UI,
  same flows, refinement not fork — each gets its own spec and Laura pass.
