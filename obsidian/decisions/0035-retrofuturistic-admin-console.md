# 0035 — Retrofuturistic admin console

**Date:** 2026-07-05
**Status:** Accepted

## Context

The admin-client shipped in Squash C (2026-05-20) as a functional wireframe:
Catppuccin tokens with both a Latte (light) and a Mocha (dark) block, plain
tables, no visual identity of its own. It worked, but it read as scaffolding.
With the console now wired to the live auth-service (mock layer deleted,
audit/users endpoints enriched, change-role / transfer-primary / invitation
fields landed), Chris asked for the console to earn a deliberate look rather
than stay a wireframe.

CLAUDE.md §11 previously said only "Admin styling: Catppuccin — functional,
not opulent." That is true as far as it goes but under-specifies the look and
leaves the light/dark question open. The user-client's north-star rules
(mobile-first at 380 px, opulent styling) are deliberately *not* the right fit
for an operator tool used mostly at a desk: the admin surface wants density,
legibility, and a functional-first character, not breathing orbs and serif
opulence.

The design direction settled on with Chris is **cassette-futurism**: panels
with bezels, status LEDs, numbered section labels — the visual language of
1970s–80s control hardware — with a small, budgeted dose of CRT and synthwave
flavour so the tool has character without the flavour fighting legibility.

## Decision

Style the admin-client as a **Catppuccin-Mocha retrofuturistic control panel**,
dark-only, functional first, flavour budgeted.

Concretely:

- **Base language: cassette-futurism.** Bezelled panels (`Panel`), numbered
  section labels (`SectionLabel`, `01 · …`), status LEDs (`StatusLed`), console
  chips (`ConsoleChip`), stat tiles (`StatTile`) with an accent top-border. A
  small component kit in `apps/admin-client/src/components/console.tsx` is the
  single source of these primitives; screens compose them rather than
  hand-rolling panel chrome.
- **CRT accents in exactly three places**, not sprinkled: the audit-feed (and
  dashboard recent-activity) panel header carries scanlines plus a
  `> tail --live ▎` prompt; stat-tile numbers get a soft glow; LEDs glow. The
  glow budget is a hard styling rule — LEDs, stat values, and the audit prompt
  only; nothing else in the app may add text-shadow glows.
- **Synthwave dose on the login screen only.** A gradient horizon, neon grid,
  gradient wordmark and glow — the one screen that can afford theatre because
  it carries no operator workload.
- **Dark-only Mocha.** The Latte (light) token block is removed entirely;
  `color-scheme: dark` is pinned. This is a deliberate simplification, not an
  oversight — an operator console does not need a light mode, and carrying one
  doubles the styling surface for no user.
- **Bundled fonts** (Fontsource, no network at runtime): Space Grotesk for
  sans, JetBrains Mono for the monospace data/console voice.
- **Desktop-optimised with a 380 px usability floor.** Wide tables scroll
  horizontally inside their own container rather than reflowing; the console is
  built for a desk but stays usable narrow. This is a **conscious deviation**
  from the user-client's mobile-first rule (CLAUDE.md §11), justified by the
  different audience and workload of the operator surface.

## Consequences

- CLAUDE.md §11 is revised: the "Admin styling" line now names the
  Mocha-retrofuturistic control panel and points here.
- The Latte block is gone; any future need for a light admin theme is a new
  decision, not a regression.
- The glow budget becomes a reviewable styling rule: a PR that adds a
  text-shadow glow outside LEDs / stat values / the audit prompt is off-spec.
- The console component kit is now the canonical place for panel/tile/chip/LED
  chrome; new admin screens compose it rather than restyling from scratch.
- The admin surface deviates from the user-client's mobile-first north star by
  design; the two surfaces are no longer expected to share a styling posture,
  only the Catppuccin palette family.
- Audit and manual verification of the live-wiring unit (Larissa on the Unit 1
  diff; Chris's device pass on the styled screens) remain owed — this ADR
  records the design decision, not sign-off on the built result.
