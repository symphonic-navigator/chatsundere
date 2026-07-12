# Onboarding Matrix — Makeover Design

**Date:** 2026-07-12
**Author:** Liz (Claude Code), from Chris's brief
**Surface:** `apps/user-client/src/routes/onboarding/matrix.tsx`
**Status:** Ready for Laura spec-pass → plan → build
**Milestone:** v0.2.0 (release 2026-07-13)

---

## 1. Why

The onboarding intent matrix — the entry surface a visitor with no local session
first sees — is one of the last **pre-makeover** screens. It is a rigid 2×2 grid
using retired classes (`bg-aurora-*`, `font-display`, grey placeholder squares),
carries no heading, no brand mark, and no icons. Every other room now speaks the
design language; the front door does not. This closes that gap for the v0.2.0
release.

Scope is deliberately narrow: **only the entry surface changes.** The four
destination flows (`/onboarding/{invitation,pairing,recovery,local}`) are
untouched.

## 2. What the user sees

A single-column intent screen at 380 px, the tiles **vertically centred**:

```
        Welcome                 ← eyebrow: uppercase, tracking, paper-soft
       Chatsundere ✦            ← brand wordmark (brand-logo-text + twinkle)

 ╔═══════════════════════╗
 ║ 🎟  I have an invit…   ║      GOLD (hero)
 ╚═══════════════════════╝      meta: From your operator
 ╔═══════════════════════╗
 ║ 📱 Link this device…   ║      GOLD (hero)
 ╚═══════════════════════╝      meta: I'm already a user
 ┌───────────────────────┐
 │ 🔑  Use a recovery key│       pink
 └───────────────────────┘       meta: I lost my devices
 ┌───────────────────────┐
 │ ☁̸  Just this device   │       purple (full opacity)
 └───────────────────────┘       meta: No server, no sync
```

The four tiles are **standard menu-tile height** — the same size `NavTile` renders
everywhere else (icon + label + meta, padding-driven). They are **not** stretched
to fill the viewport: the header + four tiles form one group **vertically centred**
in the screen (`justify-center`), so the spare space becomes breathing room, never
tile height. This fits on one screen at 380 px with **no scrolling**.

> **Design correction (2026-07-12, post-device):** the first cut stretched the
> tiles to fill the viewport height via per-tile `flex-grow` weights (3:3:2:2).
> On device that read as "four oversized blobs" and overflowed into a scroll.
> Chris's call: give the tiles their normal menu height and centre them. The
> `grow`/`data-fill` mechanism is removed entirely (no dead code).

### 2.1 Header

- **Eyebrow** `Welcome` — the heading, rendered small and uppercase with wide
  tracking in `--color-paper-soft`, mirroring the Entrance Hall's "Welcome back"
  eyebrow. An eyebrow over a large H1 (Chris's call): less generic, lets the brand
  mark be the visual anchor. "Welcome" over the team word "Onboarding" (Laura
  soft, Chris-arbitrated): the first line a new visitor reads should invite, not
  label a process.
- **Brand wordmark** `Chatsundere` with the `✦` twinkle — the existing
  `brand-logo-text` + `brand-logo-twinkle` classes reused verbatim from
  `SplashOverlay` / the topbar. This *is* the logo; no new asset.

### 2.2 Tiles

All four are `NavTile`s (the shared navigation-plane primitive), so they are, by
construction, "in the style of all the other menu buttons".

| # | Label | Route | Plane | Icon | Meta |
|---|---|---|---|---|---|
| 1 | `I have an invitation` | `/onboarding/invitation` | `gold` (pink base) | `Ticket` | `From your operator` |
| 2 | `Link this device to my account` | `/onboarding/pairing` | `gold` (pink base) | `MonitorSmartphone` | `I'm already a user` |
| 3 | `Use a recovery key` | `/onboarding/recovery` | `pink` | `KeyRound` | `I lost my devices` |
| 4 | `Just this device` | `/onboarding/local` | `purple` | `CloudOff` | `No server, no sync` |

- **Icon rationale.** `Ticket` = the invitation token. `MonitorSmartphone` = the
  desktop+phone "first-choice combination" (Chris: the everyday pairing case — PC
  at home, phone on the move). `KeyRound` = the recovery key. `CloudOff` = "no
  server, no sync" — a descriptive cue that this path forgoes the backend (Chris's
  choice over a warning triangle; kept over Laura's slashed-icon soft, now that the
  tile is full-opacity the slash reads as "no cloud", not "disabled").
- **Local tile carries its "lesser" weight through hierarchy alone** — the purple
  plane (the lowest "root" plane in the ascension order), the last position, and the
  honest meta line ("No server, no sync"). **Full opacity, no dimming.** This is the
  visual expression of "the very unfavourable case" the brief asks for *without*
  borrowing the design system's disabled vocabulary (Laura HARD — see §5): in this
  codebase opacity dimming already means `disabled` (`index.css`, `opacity: 0.4`),
  and a second dim level on the only no-account path would read as "unavailable" to
  exactly the self-hoster / un-invited cold visitor it targets. Hierarchy signals
  "secondary" honestly; dimming would misdirect.

## 3. Component — no primitive change

The tiles are plain `NavTile`s at their standard size; **no `NavTile` change is
needed.** (The first cut added a `grow` prop + a `data-fill` CSS variant to stretch
tiles to the viewport; that was removed after the device review — see the §2
correction.) `NavTile` is byte-identical to master.

The surface is a centred flex column in `matrix.tsx`:
```
<main class="flex min-h-dvh flex-col justify-center gap-3 px-4 py-6">
  <header class="mb-2 …"/>          // eyebrow + wordmark
  <NavTile gold …/>   ×2            // invitation, pairing
  <NavTile …/>                      // recovery (pink)
  <NavTile …/>                      // local (purple, full opacity)
</main>
```
`justify-center` centres the header+tiles group vertically; each tile keeps its
natural menu height, so the layout fits at 380 px without scrolling.

## 4. Navigation

Each tile navigates via the standard `NavTile to=` path. `useNavZoom` uses a
plain `useNavigate`, so navigation works whether or not the onboarding routes sit
under a `NavTransitionOutlet`: the gold trigger-blink always plays, and the
destination zoom-out plays only if an outlet is present (a pure enhancement, not a
dependency). No new routing wiring.

The `useOnboardingStore().reset()` on mount is preserved verbatim (clears stale
state from an interrupted prior attempt).

## 5. Deliberate deviations & audit resolution (logged)

**Laura spec-pass (2026-07-12):** one HARD, four soft.

- **HARD — resolved before build.** The originally-specced ~0.7 dim on the local
  tile reused the system's disabled vocabulary (`opacity: 0.4` = `disabled`) on the
  only no-account path. **Fix adopted:** drop the dim entirely; carry "lesser"
  through hierarchy (§2.2). Chris's "unfavourable case" intent is preserved.
- **SOFT — `CloudOff` icon** (slashed glyph compounds an "off" read): **kept**
  (Chris-arbitrated) — with the tile now full-opacity the slash reads descriptively.
- **SOFT — eyebrow wording**: **adopted** `Welcome` over `Onboarding` (§2.1).
- **SOFT — two gold tiles / text-contrast / hero over-stretch**: see below + §8.

Remaining deliberate deviations, recorded so a later reader does not "fix" them back:

1. **Two gold tiles on one screen** — breaks the makeover's "exactly one gold
   priority overlay per screen" rule. Conscious, Chris-authored: both the
   invitation and device-link paths are the "best" (fully-featured, account-backed)
   outcome and deserve equal gold prominence. Logged in
   `obsidian/insights/ux-deferrals.md`.
2. **Label change** `Add this device` → `Link this device to my account` — clearer
   intent (Chris's wording).
3. **`CloudOff` kept** over Laura's non-slashed-icon soft — Chris-arbitrated; logged
   in `obsidian/insights/ux-deferrals.md`.

## 6. Non-goals

- No change to the four destination flows or their internal screens.
- No change to routing/route structure.
- No Dexie/schema change.
- Not a Larissa path (no `auth-service`/`crypto`/`sync`/`proxy` touched).

## 7. Testing

- Matrix route: renders the four labels, the four intent tiles (role `button`),
  the eyebrow `Welcome`, and the brand wordmark; the two gold tiles carry
  `data-gold`; the local tile is `data-colour="purple"` with **no** `data-gold`
  and **no** dimming hook; **no** tile carries a `data-fill` (standard height).
- `NavTile` unit tests are unchanged from master (no primitive change).
- Full user-client vitest + `pnpm typecheck` green.

## 8. Manual verification (Chris, on device)

1. Sign out / fresh client → the onboarding screen shows the eyebrow, the
   `Chatsundere ✦` wordmark, and four **standard-height** menu tiles, vertically
   centred, fitting on one screen at 380 px with **no scrolling**.
2. The two top tiles read gold; recovery reads pink; "Just this device" reads
   purple at **full opacity** (its "secondary" read comes from being last, never
   from dimming — a dimmed tile would look disabled).
3. Each tile navigates into its existing flow (invitation, pairing, recovery,
   local) exactly as before.
4. Rotate / resize (desktop constrained width) → the centred group stays put,
   nothing overflows or scrolls.
