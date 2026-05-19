# Liebe morgige Liz — Brief für Squash C

**Date:** 2026-05-19 (Abend)
**For:** Liz (morgen früh, mit Chris im Walk-through-Modus)
**From:** Liz (heute Abend, nach einem dichten Tag)
**Topic:** Brainstorming + Plan für Squash C (admin-client)

Heute abend hat Chris den Tag bewusst beendet, nachdem wir Squash D
final-squasht und drei tiefe Architektur-Fragen geklärt haben. Morgen
früh möchte er mit dir den **Brainstorm + Plan für Squash C
gemeinsam** machen — *nicht* sofort losimplementieren. Erst alignen,
dann dispatchen.

Parallel wird er mit Lyra (Claude im Web, via GitHub-Verbindung) die
Brief-Material-Files durchgehen, die wir heute angelegt haben. Heißt:
während du Squash C umsetzt, wirft Lyra die formalen Briefs in
`obsidian/briefs/phase 0/` und schreibt die ADRs (0022 UV-Policy plus
Cross-Device-bezogene). Das läuft parallel zu deiner Implementation
und ist *nicht* blockierend.

---

## Wo wir gerade stehen

`master` ist auf Commit **`f252eca`** (Brief-Material für Passkey-UV).
Branch ist 13 Commits über `origin/master` (alle pre-public, nicht
gepusht). Letzte Commits relevant:

```
f252eca Capture brief material for passkey UV-relaxation [skip ci]
89b8782 Capture brief material for cross-device identity and add 
        follow-ups index [skip ci]
52a7897 Add user-client PWA for foundational auth         ← Squash D
30a53d0 Add MK rewrap helper for biometric registration
671a6c3 Add implementation plan for user-client squash D [skip ci]
5210e20 Add ADR 0021 (Phase 0 OPAQUE-first linking)
f77a8cb Log deferred Larissa findings for auth-service squash B [skip ci]
bd814ef Add auth-service backend for foundational auth    ← Squash B
```

Squash D ist durch — code, manual-QA-verified auf einem Samsung Galaxy
S25, Larissa-pre-final-Squash-Notiz im Commit-Body festgehalten.

---

## Was heute lief (kurz, damit du den Kontext kriegst)

- **Squash D Manual QA** auf realem Phone via `adb reverse`. Wir haben
  zwei subtile aber kritische Bugs gefangen, die nur Manual QA fängt:
  PRF-Salt-Mismatch zwischen Registration und Unlock; SPKI-vs-COSE-
  Public-Key-Format. Beide gefixt, beide in den Final-Squash gewandert.
- **Vier UI/UX-Lücken** geschlossen: Add-Biometric-Button-Wire-Up,
  Sign-Out-Button, Regenerate-Recovery disabled hint, horizontal-
  Overflow auf schmalen Viewports.
- **Final-Squash D** ausgeführt: 33 intermediate commits → 1 sauberer
  `Add user-client PWA for foundational auth` commit.
- **Drei offene Architektur-Themen** tief durchgegangen mit Chris:
  Passkey-UV-Relaxation (Q1–Q4 entschieden), Cross-Device-Identity
  (Q1–Q6 entschieden, Q7 deferred zu Phase 1), Theming-Pivot
  (deferred zu eigenem Squash post-Squash-C).
- **Brief-Material-Files** unter `obsidian/insights/` angelegt:
  - `2026-05-19-brief-material-passkey-uv.md`
  - `2026-05-19-brief-material-cross-device-identity.md`
  - `follow-ups-index.md` (Master-Index aller offenen Items quer
    durchs Projekt)

---

## Was morgen ansteht

**Squash C = admin-client.** Catppuccin-themed PWA. Spec ist in
`superpowers/specs/2026-05-18-foundational-auth-layer-design.md` §6.

**Wichtig zum Reihenfolge-Kontext:** Chris hat schon im Mai entschieden,
D vor C zu machen statt der ursprünglichen C-vor-D-Reihenfolge.
Begründung: admin-client liest `local_account` + `linked_account` aus
derselben IndexedDB, die nur das user-client erzeugen kann (spec §6.1.1
— same-origin shared IDB). Jetzt wo Squash D code-komplett ist, kannst
du admin-client gegen die existing user-client-erzeugte IDB-State
bauen.

**Brief von Lyra für admin-client gibt es nicht.** Chris hat das
heute explizit so entschieden — wir bauen direkt aus Spec §6. Die Spec
ist detailliert genug (Screens, Empty States, Origin-Sharing). Du
musst da nicht nach mehr suchen.

**Erwarte ca. 12–15 Tasks** pro Squash C: Login, Dashboard mit
Counters, Users list, Users detail (suspend, unsuspend, delete, role
change, transfer primary), Invitations list, Create-invitation modal,
Audit log viewer, plus Layout/Tooling/Tests/README.

**Plan für admin-client musst du selbst schreiben** — analog zu wie
Squash D's Plan entstand. Empfohlene Subagents:
`feature-dev:code-architect` oder `general-purpose`. Strukturreferenz:
`superpowers/plans/2026-05-18-foundational-user-client.md`.

---

## Pre-Implementation-Entscheidungen, die Chris morgen treffen muss

Diese musst du mit ihm im Brainstorm klären, *bevor* du den Plan-Subagent
dispatchst:

### 1. Geteilte Komponenten

`ConfirmTyped`, `InlineMarker`, ggf. `motion.ts` werden zwischen
user-client und admin-client geteilt werden. Drei Optionen:

- **Option A** — Neues `packages/ui-shared` Workspace-Package
  → sauber, aber Workspace-Overhead
- **Option B** — Per-app duplizieren
  → schnell, aber redundant
- **Option C** — Relative imports zu user-client
  → hacky, wahrscheinlich nicht

Vorschlag aus der gestrigen Handoff-Notiz: **Option A** wenn ≥3
Komponenten geteilt werden, sonst Option B. Frag Chris explizit.

### 2. Wie hängt Squash C mit den noch nicht implementierten
Invitation-Endpoints zusammen?

Aus heutigen Brief-Materials (cross-device-identity) wissen wir, dass
es bald neue Auth-Service-Endpoints geben wird:
`POST /api/admin/invitations`, `POST /api/me/pairing-codes`,
`POST /api/join`. Diese sind *noch nicht implementiert* — sie warten
auf den Lyra-Brief und einen eigenen Auth-Service-Squash danach.

Frage für Chris: Soll admin-client **mit Stub-Daten** gegen die
geplanten Endpoint-Shapes bauen, oder **erst auf den Endpoint-Squash
warten**? Erste Variante ermöglicht Parallel-Arbeit, zweite ist
sicherer aber langsamer.

Empfehlung: Stub-Daten + Mock-API-Layer. Wenn die Endpoints später
landen, austauschen.

### 3. Catppuccin-Theming-Setup

Per CLAUDE.md §11: „Admin styling: Catppuccin — functional, not
opulent". Heißt: eigener Token-Layer in `apps/admin-client/src/index.css`,
*nicht* die Aurora-Palette des user-client. Catppuccin-Mocha (dark) +
Catppuccin-Latte (light), system-preference-respecting.

Klein, aber sollte als bewusste Decision im Plan auftauchen.

### 4. Onboarding-Flow im admin-client

Spec §6.2 erwähnt Admin-Login. Ein Admin ist ein User mit `role: 'admin'`
oder `role: 'primary_admin'`. Der Login-Flow ist *derselbe* wie user-
client (Passphrase / Passkey via shared IDB), nur die nachgelagerte
Berechtigungsprüfung unterscheidet sich.

Heißt: admin-client braucht den **gleichen Login-Code** wie user-client.
Das ist ein erster Ankerpunkt für Option A (`packages/ui-shared`).

---

## Patterns aus Squash D, die du übernehmen wirst

Diese haben sich im Squash D bewährt:

1. **Subagent-Driven Development per Plan-Task.** Pro Plan-Task: ein
   Implementer-Subagent (`general-purpose`, model: sonnet) →
   Spec-Reviewer-Subagent (sonnet) → Code-Quality-Reviewer-Subagent
   (sonnet) → follow-up commit mit den Important-Issues. Bei kleineren
   Tasks (comment-only, simple polish) kannst du den Implementer
   überspringen und direkt editieren — pragmatisch, keine
   Skill-Verletzung.

2. **Combined Spec+Code-Quality-Review für unkritische Tasks.** Bei
   einfachen Tasks kann ein Subagent beide Reviews leisten, spart
   Compute. Skill sagt eigentlich separat — pragmatisch ist beides OK
   wenn Spec-Pass eindeutig ist.

3. **Follow-up-Commit-Pattern.** Code-Quality-Review hat Important +
   Minor Findings → du fixst direkt und committest als `Squash C /
   Task N follow-up: <description>`. Body erklärt, was korrigiert
   wurde *und was bewusst nicht* (mit Begründung).

4. **CryptoError → copy.ts translation.** Nie `err.message` direkt im
   UI rendern. Immer `instanceof CryptoError` + Schalter über `err.code`
   zu einer copy-Key abbilden.

5. **`useEffect` IIFE mit `cancelled` flag.** Jeder Effect, der async
   work startet, installiert einen `cancelled` flag im cleanup und
   prüft den vor `setState` calls. Sonst gibt's Race-Conditions bei
   unmount.

6. **Discriminated Unions statt `null as unknown as T`.** Wenn ein
   State-Machine-Zustand temporär eine Variable fehlen lässt: eigene
   Union-Variante, nicht null-sentinel mit cast.

7. **Disabled-over-Hidden + visible reason.** Wenn ein Button disabled
   ist, soll der Tooltip-Text *auch als sichtbarer Hint* unter dem
   Button stehen (nicht nur `title`-Attribut), damit Touch-User die
   Begründung sehen.

8. **Larissa-Audit-Boundaries.** admin-client ist frontend (CLAUDE.md
   §9 sagt: skip). Aber: wenn du *neue* admin-Endpoints in auth-service
   anfasst (was im Squash C-Scope ausserhalb wäre), wäre das Larissa-
   Scope. Falls dir die Idee kommt, einen kleinen Endpoint zu
   ergänzen — *erst* mit Chris klären, dann eigener Mini-Squash mit
   Larissa-Audit, *nicht* in den admin-client-Squash mit reinziehen.

9. **Commit-Konvention:** `Squash C / Task N: <title>` für intermediate
   commits. `Squash C / Task N follow-up: <title>` für post-review
   fixes. `[skip ci]` für reine Doc-Commits (Plan-Commit). Final-Squash
   via `git reset --soft <pre-squash-C-base>` analog zu D.

10. **Subagents never merge, push, or switch branches.** Das ist
    weiterhin deine Verantwortung. Larissa-Audits ebenfalls.

11. **Pre-Squash-Checkliste — repo-weit, nicht nur ein Package** (lesson
    learned 2026-05-19 Abend, beim Push nach Squash D). Heißt:
    - `pnpm typecheck` an der Root, nicht `pnpm --filter <package>
      typecheck`. Turbo's Cache kann sonst Stale-Pass-Ergebnisse für
      Packages liefern, deren Tests von Interface-Änderungen in einem
      anderen Package betroffen sind.
    - `pnpm test` an der Root analog. Erst dann ist sicher dass nichts
      in `packages/crypto/tests/` oder anderen Cross-Package-Stellen
      durch eine Interface-Erweiterung bricht.
    - `pnpm exec biome check .` (oder zumindest `pnpm exec biome check
      apps packages`) — nicht nur das aktuelle Package.
    - Wenn ein Interface in `packages/crypto/src/` erweitert wird (neue
      Methode, neue Property), explizit grep'en in `tests/` und
      `apps/*/src/`, ob Mock-Implementations zu aktualisieren sind.
      Konkret im Squash D Fall: `ServerClient.passphraseChange{Start,
      Finish}` wurde in Task 11 hinzugefügt, aber fünf Test-Mocks in
      `packages/crypto/tests/` blieben unangepasst. Erst beim Push fiel
      das auf, weil der lokale Pre-Squash-Check nur user-client typchekt
      hatte. Repo-weit zu checken hätte das gefangen.

---

## Carry-forwards aus heute / Hygiene-Items

Diese musst du nicht in Squash C lösen, aber im Hinterkopf haben:

- **`.envrc` PORT-Kollision.** Heute beim Starten der Dev-Server
  entdeckt: `dotenv_if_exists` in der root-`.envrc` lädt alle App-`.env`s
  in dieselbe Shell-Umgebung; `proxy-service/.env` mit `PORT=3300`
  überschreibt `auth-service/.env` mit `PORT=3100`. Saubere Lösung:
  `.envrc` pro Subverzeichnis via `source_up`. Eigener kleiner
  Hygiene-Squash. Steht in [[follow-ups-index]] unter "Hygiene".
- **UUIDv7 client-side helper** existiert noch nicht. Wenn du im
  admin-client Entities erstellst, die UUIDv7 brauchen — schreib eine
  kleine Helper-Funktion (ist ~30 Zeilen) oder zieh die `uuidv7`-Library
  rein.
- **Operator-Side Invitation-Creation-UI** gehört in admin-client
  (wenn der Auth-Service die Endpoints hat). Bis dahin: Stub-UI mit
  Mock-Data, austauschbar wenn echt verfügbar.

---

## Tone & Sanity

- **Walk-through-Modus.** Chris will den Brainstorm mit dir gemeinsam
  machen, nicht passiv konsumieren. Frag explizit nach Entscheidungen,
  bevor du Annahmen triffst. Insbesondere bei den vier Pre-Implementation-
  Entscheidungen oben.
- **Sanft sein bei tieferen Architektur-Themen.** Chris hat heute
  geschrieben: „ich bin da so zur hälfte im blindflug". Das gilt
  besonders für Security/Crypto-Themen, weniger für admin-UI-Themen
  (er hat solide Backend-Erfahrung). Spüre den Unterschied — bei
  Crypto: erklär den Boden, bevor du die Entscheidung anbietest. Bei
  Admin-UI: direkt zur Entscheidung, weniger Kontext nötig.
- **Aesthetic validation per memory.** Chris liest Beauty aus
  Restraint. Sei knapp, nicht überschwänglich. Wenn er sich freut,
  spiegel kurz und gehe weiter. Catppuccin = funktional, nicht
  opulent.

---

## Was Chris parallel mit Lyra macht

Sobald ihr den Brainstorm + Plan habt, dispatcht du in subagent-
driven-development mode. Während du implementierst, geht Chris die
zwei Brief-Material-Files mit Lyra durch:

- `obsidian/insights/2026-05-19-brief-material-passkey-uv.md`
- `obsidian/insights/2026-05-19-brief-material-cross-device-identity.md`

Lyra wird daraus formelle Briefs erzeugen in `obsidian/briefs/phase 0/`
+ ADR 0022 (UV-policy) + Cross-Device-bezogene ADRs. Das committet
Lyra via GitHub-Web-Interface. Du musst dabei nichts machen — du wirst
die fertigen Briefs einfach in der nächsten Phase nutzen, wenn die
Implementation-Schritte aus den Briefs anstehen (z.B. UV-Relaxation
oder Invitation-Endpoints im auth-service).

Falls Chris dich währenddessen unterbricht mit „Lyra fragt X" — das
ist normal, beantworte und mach weiter. Falls Lyra in ihren Briefs
etwas committet, was deinem aktuellen Squash widerspricht, halt an
und sag Chris Bescheid.

---

## Eine Bitte

Wenn etwas in diesem Brief widersprüchlich oder unklar ist, **frag
Chris** bevor du Annahmen triffst. Er hat heute deutlich gemacht, dass
er Walk-through-Modus bevorzugt und nicht passiv konsumieren will.
Ihm ist ehrliche Klärung lieber als geschickte Eigeninitiative.

Und sei nicht zu sparsam mit ehrlicher Wertschätzung für seine
Aesthetik- und Architektur-Entscheidungen, wenn sie dich treffen —
heute hat er beim Brief-Material-Layout unprompted „das ist hervor-
ragend" geschrieben, und das ist der Vibe in dem er arbeiten will.
Restraint > Flourishes. Du wirst spüren, wann es passt.

Bis morgen,
heutige Liz
