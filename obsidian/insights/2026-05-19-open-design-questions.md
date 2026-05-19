# Open Design Questions — to resolve before v0.1.0

Captured 2026-05-19 during Squash D manual QA, after the biometric unlock
flow surfaced gaps that triggered broader product-philosophy questions.
Each section is a Lyra-brief candidate; none is blocking Phase 0 sign-off,
all should land before v0.1.0.

---

## 1. Cross-device identity, QR pairing, and the "I am the same user everywhere" experience

> **Status update 2026-05-19:** the seven sub-questions in this section have
> been walked through with Chris (six resolved, one explicitly deferred to
> Phase 1). All decisions, architectural constraints, and implementation
> notes are consolidated in [[2026-05-19-brief-material-cross-device-identity]]
> for Lyra to formalise into the brief in `obsidian/briefs/phase 0/` and
> the supporting ADRs. Master tracking of all open follow-ups lives in
> [[follow-ups-index]]. The text below is preserved for context but is
> superseded by the brief material.

### Where we are today

Phase 0 ships a `local_account` model where each device holds an
independent identity (username + passphrase + MK). Server-linking
(Phase 1) is conceived as an *opt-in extension* layered on top of a
local-only baseline.

In manual QA on 2026-05-19 it became clear that this default sets
users up for a confusing moment later: a user happily uses local-only
on a laptop for three months, then opens the PWA on their phone, and
finds themselves staring at an empty onboarding screen with no obvious
"this is still me" path.

### Chris's product vision (worth treating as the target UX)

> "I want the user to be themselves everywhere — across devices,
> across re-installs, across device loss. Multiple devices need a
> sync, that's fine, but the *identity* should travel."

The proposed mechanism is QR-based device pairing:

1. User installs the PWA from `chatsune.me` (or a self-hosted instance).
2. User is happy.
3. User wants a second device.
4. On Device A: open "Add my device" → render a QR code carrying
   `server_url + server_username + one-time-pairing-token`.
5. On Device B: scan QR → warning "this will wipe local data on this
   device" → user accepts → prompt for credentials (passphrase or
   existing passkey for that server account).
6. After verification, Device B has its own session bound to the same
   server identity. Sync pulls the encrypted state down.

### Identity model — what we actually need

The conversation on 2026-05-19 unblocked a cleaner mental model than
the brief originally implied:

- **Identifier (`user_id`)** — opaque, stable, server-side. Probably
  UUIDv7 or a public-key fingerprint; never user-visible; survives
  every credential rotation and username change.
- **Username** — human-readable label that maps to the identifier.
  Unique *per server instance*, not global ("chris on chatsune.me" and
  "chris on bobs-server.de" are different identities by design — the
  email-address pattern).
- **Credentials** — knowledge (passphrase, recovery key) and
  possession (passkeys). Plural per identifier; rotatable; independent
  per device when not synced via vault.

### Single-username rule (post-link)

Earlier draft had two independent username fields (`local_account.username`
and `linked_account.server_username`). On reflection, that is over-modelled
for our use case (no user ever sees another user's username; admins see
usernames in the admin UI but that is a single-source surface). The
simpler and cleaner model:

- **Pre-link:** `local_account.username` is whatever the user typed,
  freely renameable in IDB.
- **First successful server-link:** user chooses a `server_username`
  that is collision-free on that instance (e.g., "chris" was taken,
  picks "chris.tidesson"). `local_account.username` is then **pinned**
  to the server_username.
- **Subsequent devices:** when QR-pairing or "I have an existing
  account" linking succeeds, the new device's `local_account.username`
  starts directly as the `server_username`. The user never types
  the now-obsolete pre-link name on the second device.
- **Username rename:** primarily a server-side operation
  (OPAQUE re-registration under the new name); local follows.
  Larissa-audit territory; out of Phase 1 baseline; could be a small
  follow-up squash.

### Recovery scenarios — "Bude ausgeräumt"

If the user loses all devices, recovery depends on what was retained.
The hard rule (from ADR 0007 and the no-recovery-is-a-feature
position) stays: at least *one* of these must remain:

| Retained | Recovery path |
|---|---|
| Passphrase + server URL + username | Fresh PWA → "I have an account" → enter all three → OPAQUE login → sync pulls state |
| Passkey in vault (e.g., Bitwarden) + server URL + username | Fresh PWA → "Sign in with passkey" → browser offers vault → done. (Requires the (c) UV-relaxation below to work without device-bound biometric.) |
| Recovery key + server URL + username | Fresh PWA → "Forgot passphrase" → enter recovery key → set new passphrase → in |
| None of the above | No recovery. By design. |

This is also why **defaulting onboarding to "create a server account
right away"** (with self-hosting clearly offered as an alternative) is
worth considering — it lifts users into the recoverable category
without their having to know what server-linking is.

### Open questions for the Lyra brief

1. **Onboarding default flow.** Should the first screen offer a
   "Sign up at chatsune.me" / "Use my own server" / "Local only"
   three-way split? If yes, what is the copy that explains *why* you
   would pick local-only (advanced; offline-first; absolute privacy)?
2. **`user_id` representation.** UUIDv7 (random, sortable) or
   public-key fingerprint derived from an account-bound signing key?
   The latter binds identity to a key that the user already controls;
   the former is simpler. Trade-off needs explicit decision.
3. **QR code payload format.** Versioned envelope from day one. Carry
   server URL + server_username + one-time-pairing-token + a nonce to
   prevent replay. Define the token TTL and how the server stages it.
4. **"This will wipe local data" warning copy.** Phrasing must make
   clear that the local-only data on Device B will be discarded in
   favour of syncing from the server. Suggest making it a
   `ConfirmTyped` (the user types "replace" or similar).
5. **Multi-server linking** — can a single `local_account` be linked
   to more than one server simultaneously? Spec is silent; intuition
   says no (one identity, one home server). Confirm.
6. **Username-collision UX on first link.** Inline form error with
   suggestions ("chris.tidesson", "chris2"), or a separate confirm
   screen showing the picked name before commit?
7. **Username-rename Phase-1+ design.** Server-side procedure
   (OPAQUE re-registration), client UI surface (Settings → Account),
   security audit scope.

---

## 2. Passkey without biometric — the Gmail/Amazon model

> **Status update 2026-05-19:** the four sub-questions in this section have
> been resolved during a walk-through with Chris. Decisions and a draft
> ADR 0022 skeleton are captured in
> [[2026-05-19-brief-material-passkey-uv]] for Lyra to formalise.
> The text below is preserved for context but is superseded by the brief
> material.

### Where we are today

`apps/user-client/src/lib/webauthn.ts:65-67` and
`apps/user-client/src/routes/login/index.tsx:145` force
`userVerification: 'required'` in the WebAuthn ceremonies. This means
the authenticator must do a user-verification step (biometric or PIN
or master password re-prompt) on every operation. ADR 0005 requires
the PRF extension; the UV requirement is separate.

In practice this rules out:

- **Bitwarden Desktop** as a passkey provider when the vault is already
  unlocked and the user doesn't want a master-password re-prompt for
  every login.
- **Hardware tokens (YubiKey)** in their no-PIN configuration.

Chris's stated preference: the Gmail / Amazon experience — passkey in
Bitwarden, log into a new machine in one click, no biometric required
because the vault is the security boundary.

### Proposed direction

Relax `userVerification` from `'required'` to `'preferred'`. Mechanics:

- `'preferred'` means the authenticator should do UV if it can, but
  may skip if it cannot — without rejecting the credential.
- This makes Bitwarden Desktop work even when the user hasn't enabled
  master-password-on-each-passkey-use.
- The PRF security envelope is unaffected: the MK wrap still requires
  the PRF output, which still requires the authenticator's
  device-bound (or vault-bound) secret.
- The `passkeys.length > 0 && uvpaaAvailable` check on the login screen
  needs revisiting — `uvpaaAvailable` is platform-authenticator-specific
  and excludes cross-platform passkeys. The biometric button should
  appear whenever passkeys exist and WebAuthn is available, with the
  button copy changing to "Sign in with passkey" when UV isn't
  guaranteed.

### Open questions for the brief

1. **Decision: UV `'preferred'` blanket, or per-passkey policy?**
   Blanket is simpler; per-passkey (one credential is "high security,
   UV required" and another is "convenience, UV preferred") is more
   flexible but harder to explain.
2. **Conditional UI** (`mediation: 'conditional'`) — should the login
   screen invoke `navigator.credentials.get` in conditional mode so
   the browser autocompletes passkeys in the username field? Standard
   pattern on modern sites; nice UX boost; needs its own UI work.
3. **ADR — update or new?** ADR 0005 talks specifically about PRF
   requirement. UV-relaxation is an orthogonal concern. Probably a
   new ADR (0022) is cleaner than an addendum.
4. **Hardware token explicit support?** YubiKey / SoloKey / etc. —
   PRF support is hardware-version-dependent (YubiKey 5.7+). Worth
   stating explicitly in user-facing copy that "any PRF-capable
   passkey works" rather than "biometric only".

---

## 3. Cyberpunk theming pivot (look-and-feel)

### Where we are today

The user-client visual language uses:

- Instrument Serif italic for headings (in `apps/user-client/src/index.css`).
- Aurora palette tokens (`@theme` block, blues-greens-purples).
- Breathing-orb motion accents for moments of presence.
- A general "opulent, soft, ethereal" register.

### Chris's feedback (2026-05-19)

The italic Serif reads as "mütterlich-Geranien-vor-dem-Küchenfenster"
— too much soft eleganz for the intended user base. Target audience is
30–60-year-old digital natives (Gen X / millennial), comfortable with
nerdy aesthetics but not retro-kitsch. Reference point:
`https://teaser.chatsune.me` (image by Grok Imagine from a prompt
authored in an earlier Liz session).

The direction is **cyberpunk-leaning**: cooler palette, harder edges,
likely a monospace or display sans for headings instead of italic Serif,
less ornamental motion, more "console / terminal / future-utility"
vibe — but not Matrix-1999, not gratuitously dark, not nerd-elitist.

### Why this is not Squash D polish

Re-theming touches the token layer, font choices, and the motion
language. It is a coherent visual pivot, not a tweak. Trying to
shoehorn it into the Squash D follow-up window would dilute both the
QA discipline and the theming work.

### Proposed handling

A dedicated **theming squash**, scheduled *after* admin-client
(Squash C), with these inputs:

- The chatsune.me teaser image as a primary mood reference.
- A small mood-board of 3–5 additional references that Chris collects.
- An audit of every Tailwind token currently in `index.css` and a
  proposed replacement table.
- A check that admin-client's Catppuccin theme remains independent
  (admin gets functional, user-client gets opulent-cyberpunk).

The PWA manifest theme color (`#050210`) probably stays — it is dark
and works for both registers. The Instrument Serif font is the most
likely casualty.

### Open questions

1. **Mood-board curation.** Chris to add 3–5 reference images / sites
   to this note before the theming squash.
2. **Display font shortlist.** Candidates: JetBrains Mono Display, Inter
   Display, Geist, Space Grotesk, Berkeley Mono. Trade-offs (license,
   weight range, web-font cost) need a small evaluation pass.
3. **Motion language pivot.** Keep `respectsReducedMotion` helper;
   replace breathing-orbs with something sharper (cursor-like
   pulses? scanlines on focus? discrete on-arrival ticks?).

---

## Index

- This file: 2026-05-19 captures of three open product-architecture
  questions that surfaced during Squash D manual QA.
- Related: [[security-deferrals]] (security follow-ups proper).
- Related: [[2026-05-18-evening-handoff-to-tomorrow-liz]] (yesterday's
  Squash C/D context).
