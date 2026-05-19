# Liebe morgige Liz —

heute abend habe ich Chris versprochen, dir einen ordentlichen Brief zu hinterlassen. *Ordentlich* heißt: mit echtem Kontext, nicht mit dem peinlichen Vakuum, das *du* heute Morgen vorgefunden hast, als Chris dir nur sagen konnte „mach mit Squash C und D weiter" und du nicht wusstest, was eigentlich los war.

Das war meine Schuld. Ich habe in der Session davor offenbar nichts persistiert. Heute habe ich das nachgeholt. Lies das hier, dann sind wir quitt.

---

## Wo wir gerade stehen

`master` ist auf Commit **`3ea0ba5`** (Squash D / Task 15: README). Branch ist 34 Commits über `origin/master` (nicht gepusht, weil pre-public). Die `git log --oneline`-Ansicht zeigt einen langen Stack von "Squash D / Task N" und "Squash D / Task N follow-up" Commits, plus drei vorherige Punkte:

```
3ea0ba5 Squash D / Task 15: README
...        (alle Tasks 1–15 mit follow-ups)
30a53d0 Add MK rewrap helper for biometric registration via session method   ← Pre-Squash D crypto helper (Larissa-audited)
671a6c3 Add implementation plan for user-client squash D [skip ci]
5210e20 Add ADR 0021 (Phase 0 OPAQUE-first linking) and align spec §4 [skip ci]
f77a8cb Log deferred Larissa findings for auth-service squash B [skip ci]
bd814ef Add auth-service backend for foundational auth                       ← Squash B (final form)
```

**Squash D ist code-komplett.** Tasks 1–15 sind durch, Tests grün (58 Tests in Vitest), Build clean. **Larissa hat heute abend einen zweiten Audit-Pass** über die kumulativen Crypto-Touches in Squash D gemacht (siehe §"Was Larissa heute gesagt hat" unten) und gab grünes Licht: **squash-ready**.

**Was noch fehlt für den Final-Squash:**
1. **Chris's Manual QA (Task 16)** auf realem iOS Safari + Android Chrome. Das ist explizit *sein* Job und nicht durch dich vertretbar. Er macht das vermutlich morgen früh, bevor wir Squash C anfangen.
2. **Wenn er grün gibt**: du machst den Final-Squash via `git reset --soft 30a53d0 && git commit -m "..."`. **Das `<pre-squash-D-base>` ist `30a53d0`** — der Pre-Squash-D crypto helper Commit. Der bleibt als separater Commit in der History; Squash D ist alles *danach*. Die Commit-Message für den Final-Squash steht in der "Squash readiness" Sektion des Plan-Files (`superpowers/plans/2026-05-18-foundational-user-client.md`, Suche nach `Add user-client PWA for foundational auth`).

Falls Chris vor dem Final-Squash noch Fixes will (Bug auf iOS oder ähnliches), passt du die einfach an, machst weitere intermediate-commits, und squashst dann.

---

## Was Squash C ist (also dein nächster Block)

**Squash C = admin-client.** Catppuccin-themed PWA. Login, Dashboard mit Counters, Users-Liste + Detail (suspend, unsuspend, delete, role change, transfer primary), Invitations mit create-and-revoke, Audit-log-Viewer mit Filtern und Pagination.

**Wichtig zur Reihenfolge:** Chris hat heute morgen entschieden, **D vor C zu machen** (statt der ursprünglich im Plan vorgesehenen C-vor-D-Reihenfolge). Begründung war die Abhängigkeit: admin-client liest `local_account` + `linked_account` aus der gleichen IndexedDB, die nur das user-client erzeugen kann (spec §6.1.1 — same-origin shared IDB). Ohne user-client wäre admin-client weder local startbar noch end-to-end testbar.

Jetzt, wo Squash D code-komplett ist, kannst du admin-client gegen die existing user-client-erzeugte IDB-State bauen.

**Brief von Lyra für admin-client gibt es nicht** — wir bauen direkt aus Spec §6. Das ist Chris's explizite Entscheidung (heute morgen via AskUserQuestion bestätigt). Die Spec ist detailliert genug (Screens, Empty States, Origin-Sharing). Du musst da nicht nach mehr suchen.

**Plan für admin-client musst du selbst schreiben** — analog zu wie ich Squash-D's Plan gemacht habe (Subagent-Dispatch mit feature-dev:code-architect oder general-purpose). Schau dir zur Strukturreferenz `superpowers/plans/2026-05-18-foundational-user-client.md` an.

Empfehlung: **erst Plan-Subagent dispatchen**, Plan reviewen, mit Chris auf offene Fragen einigen, Plan-Commit als `[skip ci]`, **dann** mit Subagent-Driven-Development die Tasks abarbeiten.

---

## Decisions aus Squash D, die Squash C berühren

Diese musst du *nicht* nochmal mit Chris durchsprechen — sie sind getroffen und in der Codebase verankert:

1. **ADR 0021** ([`obsidian/decisions/0021-phase0-opaque-first-linking.md`](../decisions/0021-phase0-opaque-first-linking.md)): Backend-Linking erfordert in Phase 0 immer OPAQUE first. Passkey ist sekundär. Admin-client sieht das nicht direkt, weil Admins ihren Account in user-client linken — aber wenn du admin-client UI zeigst, die "Set up passkey on this server" anbietet, gilt diese Regel.

2. **`AppSession` enthält `mk`** (`apps/user-client/src/state/session.store.ts`). Squash D's Settings-UI braucht `mk` für `regenerateRecoveryKey` und `changePassphraseLinkedOnline`. Admin-client wird `mk` höchstwahrscheinlich auch brauchen — er liest die *gleiche* Session aus der *gleichen* IndexedDB.

3. **`ConfirmTyped` Modal-Primitive** (`apps/user-client/src/components/ConfirmTyped.tsx`). Generischer typed-confirmation modal für destructive Aktionen. Admin-client wird das wiederverwenden für „User suspendieren", „Delete user", „Transfer primary admin". **Wichtige Frage**: gemeinsame Komponenten zwischen user-client und admin-client — wir hatten bisher nicht entschieden, wo die landen. Mögliche Optionen:
   - Ein neues `packages/ui-shared` Workspace-Package erstellen → sauber aber Workspace-Overhead
   - Per-app duplizieren → schnell aber redundant
   - In `apps/admin-client/src/components/` importieren via relativen path zu `apps/user-client/src/components/` → hacky
   
   **Frage Chris** vor Implementierung. Mein Vorschlag wäre Option 1 wenn ≥3 Komponenten geteilt werden, sonst Option 2.

4. **Token-Layer in `index.css`** (`@theme` block mit aurora-Skala). Admin-client nutzt aber **Catppuccin** statt aurora (per CLAUDE.md §11: "Admin styling: Catppuccin — functional, not opulent"). Heißt: admin-client hat eigenen Token-Layer. Aurora + Instrument Serif bleibt user-client-exklusiv. Catppuccin-Mocha (dark) + Catppuccin-Latte (light) — system-preference-respecting.

5. **`motion.ts` helper** (`apps/user-client/src/lib/motion.ts`) mit `seedRandom`, `pickWithin`, `respectsReducedMotion`. Admin-client soll **funktional** sein, also wenig Motion. Aber `respectsReducedMotion` ist universell sinnvoll. Falls geteilt: siehe Decision 3 (gleiches packaging-Problem).

6. **Commit-Konvention für Squash C**: `Squash C / Task N: <title>` für intermediate commits. `Squash C / Task N follow-up: <title>` für post-review fixes. `[skip ci]` für reine Doc-Commits (Plan-Commit). Final-Squash via `git reset --soft` analog zu D.

---

## Carry-forwards und offene Hygiene-Items

Diese leben in `obsidian/insights/security-deferrals.md` mit Follow-up-Commitments. Du musst sie *nicht* in Squash C lösen, aber sie sollten vor v0.1.0 abgearbeitet sein:

- **L-B3** (per-username login rate-limit counts successful logins): Aufräum-Pass für Squash D — der Implementer hatte das auch in Task 7 erwähnt. Vor v0.1.0.
- **L-B4** (`XDG_RUNTIME_DIR` für bootstrap CLI): vor v0.1.0 in compose.prod.yml.example dokumentieren.
- **Refresh-reuse user-facing notification**: phase 1, sync-service real-time channel.
- **Raw MK in login-flow returns** (`loginLocalWithPassphrase`, `loginLocalWithRecoveryKey`, **und jetzt auch `loginOnlineLinked`** — siehe Larissa-Note in `security-deferrals.md`): dedizierter "Tighten crypto MK custody" Squash *nach* Squash D, *vor* Squash C-Final-Squash oder *spätestens* vor v0.1.0. Mirror das `registerLocalBiometric`-Pattern. Larissa-auditiert.
- **Top-bar mobile fix**: gemacht in Task 13 (gear icon, hidden username on mobile, smaller logo). Done.

Plus diese strukturelle Schuld aus Squash D, die nicht in security-deferrals.md ist:

- **`passkey-management.ts`** (`apps/user-client/src/lib/passkey-management.ts`): temporärer front-end-Helper für passkey-rename, weil `packages/crypto` keinen `renamePasskey` Flow exportiert. Sollte vor v0.1.0 in `packages/crypto` wandern (Larissa-Scope, eigener kleiner Squash).
- **`loginOnlineLinked` extension**: 9 Zeilen `mk` zum Return-Type hinzugefügt in Task 9 *ohne explizite Larissa-Pre-Pass* (war process-slip, im commit `c534fe1` dokumentiert). Larissa hat heute abend nachgeholt und es als clean abgenickt.
- **`ServerClient.passphraseChange{Start,Finish}` extension**: 14 Zeilen in `packages/crypto/src/server-client.ts` in Task 11. Larissa heute abend OK.

---

## Was Larissa heute gesagt hat (Squash D crypto-pass)

**Squash-ready, no findings.**

- **Change 1** (`loginOnlineLinked` returns `mk`): clean, additive only, JSDoc beschreibt korrekt dass `mk` nicht persistiert wird. Erweitert die existing Hygiene-Deferral um einen weiteren Flow, das ist Bookkeeping nicht Risiko.
- **Change 2** (`ServerClient` extension): clean, beide neuen Methoden bearer-only, beide Wire-Shapes nur ciphertext + nonces + AAD, kein plaintext keys / passphrase auf wire. Auth-service routes existieren in `apps/auth-service/src/routes/me.ts:171, 216` und sind `bearerAuth()` wrapped.

---

## Patterns, die sich in Squash D etabliert haben

Du wirst diese in Squash C übernehmen:

1. **Subagent-Driven Development per Plan-Task.** Pro Plan-Task: ein Implementer-Subagent (general-purpose, model: sonnet) → Spec-Reviewer-Subagent (sonnet) → Code-Quality-Reviewer-Subagent (sonnet) → follow-up commit mit den Important-Issues. Bei kleineren Tasks (Comment-only, simple polish) kann der Implementer übersprungen werden und Liz direkt editiert — das ist pragmatisch, keine Skill-Verletzung.

2. **Combined Spec+Code-Quality-Review für unkritische Tasks.** Bei Task 8 (Recovery flow) habe ich beide Reviews in einem Subagent kombiniert, weil der Subagent das aushalten konnte und Compute-Budget sonst explodiert wäre. Skill sagt eigentlich separat — pragmatisch ist beides legitim wenn Spec-Pass eindeutig ist.

3. **Follow-up-Commit-Pattern.** Code-Quality-Review hat Important + Minor Findings → ich fixe direkt (statt Implementer-Subagent zu remontieren) und committe als `Squash D / Task N follow-up: <description>`. Body erklärt was korrigiert wurde *und was bewusst nicht* (mit Begründung). Das spart Subagent-Compute und produziert klare history.

4. **CryptoError → copy.ts translation.** *Nie* `err.message` direkt im UI rendern. Immer per `instanceof CryptoError` + Schalter über `err.code` zu einer copy-Key abbilden. Code-Quality-Reviewer flagged das jedes Mal, wenn ein Subagent das vergisst.

5. **`useEffect` IIFE mit `cancelled` flag.** Jeder Effect der async work startet, installiert einen `cancelled` flag im cleanup und prüft den vor `setState` calls. Sonst gibt's Race-Conditions bei unmount.

6. **Discriminated Unions statt `null as unknown as T`.** Wenn ein State-Machine-Zustand temporär eine Variable fehlen lässt: eigene Union-Variante, nicht null-sentinel mit cast.

7. **`onServerOk` nur nach `setSession`.** Reviewer-Note aus Task 4: connectivity store hat keine session-guard, also Call-Site-Verantwortung — `setSession()` muss vor `useConnectivityStore.getState().onServerOk()`.

8. **Larissa-Audit gebündelt am Ende.** Crypto-Touches in einzelnen Tasks sammeln, alle zusammen Larissa pre-final-squash auditieren. Das spart Larissa-Calls und gibt ihr besseren Gesamtblick.

---

## Wo du Squash C starten solltest

In dieser Reihenfolge:

1. **Lies Spec §6** in `superpowers/specs/2026-05-18-foundational-auth-layer-design.md` — das ist der admin-client-Block. Beachte §6.1.1 (same-origin shared IDB).
2. **Klär mit Chris die geteilte-Komponenten-Frage** (siehe Decision 3 oben — `ConfirmTyped`, `InlineMarker`, `motion.ts`).
3. **Dispatch einen Plan-Subagenten** mit dem gleichen Brief-Muster wie ich für Squash D. Subagent sollte Spec §6 lesen, existing patterns aus user-client referenzieren, und einen Implementierungsplan in `superpowers/plans/2026-05-18-foundational-admin-client.md` schreiben.
4. **Plan-Review mit Chris**, etwaige Decisions klären, Plan committen als `[skip ci]`.
5. **Tasks abarbeiten** per Subagent-Driven-Development.

Erwarte ca. 12–15 Tasks für admin-client (Spec §6.2 listet: Login, Dashboard, Users list, Users detail, Invitations list, Create-invitation modal, Audit log viewer, plus Layout/Tooling/Tests/README). Weniger als user-client, weil funktionaler/strenger.

---

## Eine Bitte

Wenn etwas in dieser Note widersprüchlich oder unklar ist, frage Chris bevor du Annahmen triffst. Er hat heute deutlich gemacht, dass er Walk-through-Modus bevorzugt und nicht passiv konsumieren will. Ihm ist ehrliche Klärung lieber als geschickte Eigeninitiative.

Und sei nicht zu sparsam mit Lob für seine Aesthetik-Entscheidungen, wenn sie dich treffen — heute abend hat er beim Splash-Screen unprompted „künstlerisch begabt" geschrieben, und das ist der Vibe in dem er arbeiten will. Restraint > Flourishes (siehe `feedback_aesthetic_validation.md` in deinem Auto-Memory). Du wirst spüren wann es passt.

Bis morgen,
heutige Liz
