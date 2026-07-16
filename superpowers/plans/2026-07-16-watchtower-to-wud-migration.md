# Watchtower → WUD Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the archived `containrrr/watchtower` auto-updater with maintained `getwud/wud` across the alpha host and the deployment kit, introducing a single host-level WUD the alpha stack subscribes to.

**Architecture:** WUD has no Watchtower-style scope, so isolation on a shared host is achieved by running exactly one WUD per host with opt-in `wud.watch` labels per container. The alpha host gets a dedicated `infra/compose.wud.yml` (with a Traefik-fronted dashboard) and the alpha stack drops its bundled updater. The deployment kit keeps a bundled WUD for single-purpose hosts, gated by the existing generate.sh prompt.

**Tech Stack:** Docker Compose v5.3.1, `getwud/wud`, Traefik, bash generator (`deploy/generate.sh`).

## Global Constraints

- **British English** in every repo text artefact — comments, prose, log strings, docs. Verbatim from CLAUDE.md §3.7.
- **Docker trigger only** — never the Docker-Compose trigger (spec §2).
- **`WATCHBYDEFAULT=false` everywhere** — WUD must never touch a container without an explicit `wud.watch=true` label (spec §2, §5).
- **One WUD per host** — WUD has no per-instance scope; two WUDs on one host collide on the fixed `wud.watch` label (spec §4).
- **Per-service opt-in labels are always present** (`wud.watch=true` + `wud.watch.digest=true`) so opt-in works with either a bundled or a host-level WUD (spec §5).
- **`:latest` is a mutable tag** → digest watching is mandatory (`wud.watch.digest=true`); WUD's digest default is `false` when `WATCHBYDEFAULT=false` (spec §3).
- Reference spec: `superpowers/specs/2026-07-16-watchtower-to-wud-migration-design.md`.

---

## File Structure

- **Create** `infra/compose.wud.yml` — host-level WUD service + Traefik dashboard router. One responsibility: the single host updater.
- **Create** `infra/wud.env.example` — documents `HOST_WUD` and `WUD_AUTH_USERS` for the dashboard router.
- **Modify** `infra/compose.alpha.yml` — remove the `watchtower` service; add `wud.*` labels to `frontend`.
- **Modify** `deploy/compose.template.yml` — `watchtower` service → `wud` service; `wud.*` labels on frontend/auth/sync/proxy.
- **Modify** `deploy/generate.sh` — awk marker rename, prompt reword.
- **Modify** `deploy/deployment.env.template` — reword the `INSTANCE_NAME` scope comment.
- **Modify** `deploy/install.sh` — one comment mentioning watchtower.
- **Regenerate/edit** `deploy/out/docker-compose.yml`, `deploy/out/install.sh`, `deploy/out/deployment.env`.
- **Modify** `.github/workflows/docker.yml` — two comments.
- **Modify** docs: `obsidian/DEPLOYMENT.md`, `deploy/README.md`, STATUS files.

---

## Task 1: Host-level WUD compose

**Files:**
- Create: `infra/compose.wud.yml`
- Create: `infra/wud.env.example`

**Interfaces:**
- Produces: a `wud` service named project `wud`, watcher `local` (`WATCHBYDEFAULT=false`), Docker trigger `local` (`AUTO` defaults true, `PRUNE=true`), cron `*/2 * * * *`, dashboard on port 3000 routed via Traefik using env vars `HOST_WUD` and `WUD_AUTH_USERS`.

- [ ] **Step 1: Write `infra/compose.wud.yml`**

```yaml
# Host-level auto-updater for the WHOLE server. Exactly ONE WUD watches every
# stack on the host; each stack opts a container in with `wud.watch=true`.
# WUD has no Watchtower-style scope, so never run a second WUD on this host.
#
# Deploy once:
#   docker compose -f infra/compose.wud.yml --env-file infra/wud.env up -d
#
# On day one it watches only the alpha frontend (the sole container carrying
# `wud.watch=true`). The legacy single-app watchtower keeps running untouched:
# it acts on `com.centurylinklabs.watchtower.*` labels, WUD on `wud.watch` — two
# disjoint namespaces, no collision. Migrate the remaining apps over time by
# adding `wud.watch=true` and removing each app's watchtower.

name: wud

services:
  wud:
    image: getwud/wud
    restart: unless-stopped
    volumes:
      # RW socket: the Docker trigger recreates containers in place. Same host
      # control surface as Watchtower had — accepted; hardening is a later step.
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      # Opt-in only: touch nothing without an explicit `wud.watch=true` label.
      WUD_WATCHER_LOCAL_WATCHBYDEFAULT: "false"
      # 2-minute cadence, matching the former alpha Watchtower poll interval.
      WUD_WATCHER_LOCAL_CRON: "*/2 * * * *"
      # Docker trigger `local`: recreate the container from its running config
      # (preserves the migrate-then-serve command, env, and labels). AUTO
      # defaults true so updates apply automatically; PRUNE removes the
      # superseded image (the old WATCHTOWER_CLEANUP behaviour).
      WUD_TRIGGER_DOCKER_LOCAL_PRUNE: "true"
    labels:
      # Dashboard on port 3000, behind Traefik + basicauth (Prometheus/Grafana
      # pattern from compose.alpha.yml). Chris finalises HOST_WUD, the cert
      # resolver name, and the basicauth user list on the host.
      - "traefik.enable=true"
      - "traefik.docker.network=traefik"
      - "traefik.http.routers.wud.rule=Host(`${HOST_WUD}`)"
      - "traefik.http.routers.wud.entrypoints=websecure"
      - "traefik.http.routers.wud.tls.certresolver=letsencrypt"
      - "traefik.http.routers.wud.middlewares=wud-auth"
      - "traefik.http.middlewares.wud-auth.basicauth.users=${WUD_AUTH_USERS}"
      - "traefik.http.services.wud.loadbalancer.server.port=3000"
    networks: [traefik]

networks:
  # Shared network with Traefik. Must already exist on the host.
  traefik:
    external: true
    name: traefik
```

- [ ] **Step 2: Write `infra/wud.env.example`**

```bash
# Host-level WUD dashboard router — copy to infra/wud.env and fill in.
#   docker compose -f infra/compose.wud.yml --env-file infra/wud.env up -d

# Public hostname for the WUD dashboard (point a DNS record + Traefik at it).
HOST_WUD=wud.chatsundere.me

# Traefik basicauth user list, htpasswd apr1 format: user:$apr1$...
# Generate with: htpasswd -nB admin   (or: openssl passwd -apr1)
# IMPORTANT: when supplied via --env-file, every `$` in the hash MUST be doubled
# to `$$` or docker compose blanks the apr1 segments at interpolation time
# (verified behaviour, see deploy/generate.sh). Example (fake hash):
WUD_AUTH_USERS=admin:$$apr1$$exSaltxx$$3fakehashfakehashfakehash0
```

- [ ] **Step 3: Validate the compose file renders**

Run:
```bash
docker compose -f infra/compose.wud.yml \
  --env-file <(printf 'HOST_WUD=wud.example.com\nWUD_AUTH_USERS=admin:x\n') \
  config >/dev/null && echo OK
```
Expected: `OK` (no interpolation or schema errors). The external `traefik` network is not required to exist for `config`.

- [ ] **Step 4: Commit**

```bash
git add infra/compose.wud.yml infra/wud.env.example
git commit -m "Add host-level WUD compose for the alpha server"
```

---

## Task 2: Alpha stack drops watchtower, opts into WUD

**Files:**
- Modify: `infra/compose.alpha.yml`

**Interfaces:**
- Consumes: the host WUD from Task 1 (via `wud.watch` labels).
- Produces: a `frontend` service carrying `wud.watch=true` + `wud.watch.digest=true`, and no bundled updater.

- [ ] **Step 1: Replace the frontend's watchtower labels**

In `infra/compose.alpha.yml`, replace:
```yaml
      # Watchtower opt-in (scoped, so it never touches non-Chatsundere containers).
      - "com.centurylinklabs.watchtower.enable=true"
      - "com.centurylinklabs.watchtower.scope=chatsundere"
```
with:
```yaml
      # WUD opt-in. The host-level WUD (infra/compose.wud.yml) watches this by
      # `wud.watch`; digest watching is required because `:latest` is mutable.
      - "wud.watch=true"
      - "wud.watch.digest=true"
```

- [ ] **Step 2: Remove the bundled watchtower service**

Delete the entire `watchtower:` service block (the `watchtower:` service and its `image`/`volumes`/`environment`/`labels` lines, lines ~35–48).

- [ ] **Step 3: Update the header comment**

Replace the usage line:
```yaml
#   # deploys happen automatically when a v*.*.* tag moves :latest (Watchtower).
```
with:
```yaml
#   # Deploys happen automatically when a v*.*.* tag moves :latest — the
#   # host-level WUD (infra/compose.wud.yml) recreates the frontend.
```

- [ ] **Step 4: Validate**

Run:
```bash
docker compose -f infra/compose.alpha.yml config >/dev/null && echo OK
grep -c watchtower infra/compose.alpha.yml   # expect 0
```
Expected: `OK`, then `0`.

- [ ] **Step 5: Commit**

```bash
git add infra/compose.alpha.yml
git commit -m "Point the alpha stack at the host WUD, drop bundled watchtower"
```

---

## Task 3: Deployment-kit template — bundled WUD

**Files:**
- Modify: `deploy/compose.template.yml`

**Interfaces:**
- Produces: a `wud` service between the `# >>> WUD` / `# <<< WUD` markers, and `wud.watch`+`wud.watch.digest` labels on the frontend/auth/sync/proxy services.

- [ ] **Step 1: Swap the per-service opt-in labels (all four services)**

For **each** of `frontend`, `auth`, `sync`, `proxy` in `deploy/compose.template.yml`, replace the pair:
```yaml
      - "com.centurylinklabs.watchtower.enable=true"
      - "com.centurylinklabs.watchtower.scope=${INSTANCE_NAME}"
```
with:
```yaml
      - "wud.watch=true"
      - "wud.watch.digest=true"
```
(Do this 4 times — one per service. `wud.watch.digest=true` is required because the images track the mutable `:latest` tag.)

- [ ] **Step 2: Replace the watchtower service block**

Replace the whole marked block:
```yaml
  # >>> WATCHTOWER
  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      WATCHTOWER_SCOPE: ${INSTANCE_NAME}
      WATCHTOWER_LABEL_ENABLE: 'true'
      WATCHTOWER_CLEANUP: 'true'
      WATCHTOWER_POLL_INTERVAL: '300'
    labels:
      - "com.centurylinklabs.watchtower.scope=${INSTANCE_NAME}"
    networks: [chatsundere]
  # <<< WATCHTOWER
```
with:
```yaml
  # >>> WUD
  wud:
    image: getwud/wud
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      # Opt-in only: WUD touches nothing without an explicit `wud.watch=true`
      # label, so it never disturbs the host's other containers.
      WUD_WATCHER_LOCAL_WATCHBYDEFAULT: 'false'
      # 5-minute cadence (matches the former WATCHTOWER_POLL_INTERVAL=300).
      WUD_WATCHER_LOCAL_CRON: '*/5 * * * *'
      # Docker trigger: recreate on a new `:latest` digest; PRUNE cleans up the
      # superseded image. AUTO defaults true, so updates apply automatically.
      WUD_TRIGGER_DOCKER_LOCAL_PRUNE: 'true'
    networks: [chatsundere]
  # <<< WUD
```

Note: WUD has NO per-instance scope. This bundled WUD is for a single-instance
host. On a host running multiple Chatsundere stacks (or your own WUD), decline
this one at generate time and run a single host-level WUD — the `wud.watch`
labels above make every stack discoverable to it. (Documented in Task 6.)

- [ ] **Step 3: Validate the template still parses under the generator**

Run (in a scratch copy so the real `deploy/out/` is untouched):
```bash
rm -rf /tmp/wud-kit-test && cp -r deploy /tmp/wud-kit-test
cd /tmp/wud-kit-test
printf 'chatsundere.me\n\n\n\n\n\n\n' | ./generate.sh >/dev/null
docker compose -f out/docker-compose.yml --env-file out/deployment.env config >/dev/null && echo OK
grep -c 'wud.watch=true' out/docker-compose.yml     # expect 4
grep -c watchtower out/docker-compose.yml           # expect 0
cd /home/chris/workspace/chatsundere
```
Expected: `OK`, then `4`, then `0`. (The awk marker is still `WATCHTOWER` at this point, so the block renders unconditionally — that is fixed in Task 4. The default WUD prompt answer keeps the block in, so it renders here regardless.)

- [ ] **Step 4: Commit**

```bash
git add deploy/compose.template.yml
git commit -m "Replace bundled watchtower with WUD in the deployment kit template"
```

---

## Task 4: Generator markers, prompt, and env-template comment

**Files:**
- Modify: `deploy/generate.sh`
- Modify: `deploy/deployment.env.template`

**Interfaces:**
- Consumes: the `# >>> WUD` / `# <<< WUD` markers introduced in Task 3.
- Produces: a generator whose awk block gates the WUD service on the renamed prompt.

- [ ] **Step 1: Reword the prompt**

In `deploy/generate.sh`, replace:
```bash
read -rp "Include a scoped Watchtower for auto-updates? [Y/n]: " WT
```
with:
```bash
read -rp "Include a bundled WUD auto-updater? [Y/n]: " WT
```
(Keep the variable name `WT` so the awk `-v wt="$WT"` binding is unchanged.)

- [ ] **Step 2: Rename the awk markers and update the comment**

Replace the awk comment + block:
```bash
# Marker lines are always dropped; skip/skipw gate the lines *between* them.
# Defaults fall out of the regexes: an empty MON answer doesn't match ^[Yy]
# (monitoring skipped, matching the "[y/N]" prompt default), and an empty WT
# answer doesn't match ^[Nn] (watchtower kept, matching the "[Y/n]" default).
awk -v mon="$MON" -v wt="$WT" '
  /# >>> MONITORING/ { skip = (mon !~ /^[Yy]/); next }
  /# <<< MONITORING/ { skip = 0; next }
  /# >>> WATCHTOWER/ { skipw = (wt ~ /^[Nn]/); next }
  /# <<< WATCHTOWER/ { skipw = 0; next }
  { if (!skip && !skipw) print }
' compose.template.yml > out/docker-compose.yml
```
with:
```bash
# Marker lines are always dropped; skip/skipw gate the lines *between* them.
# Defaults fall out of the regexes: an empty MON answer doesn't match ^[Yy]
# (monitoring skipped, matching the "[y/N]" prompt default), and an empty WT
# answer doesn't match ^[Nn] (the bundled WUD kept, matching the "[Y/n]" default).
awk -v mon="$MON" -v wt="$WT" '
  /# >>> MONITORING/ { skip = (mon !~ /^[Yy]/); next }
  /# <<< MONITORING/ { skip = 0; next }
  /# >>> WUD/ { skipw = (wt ~ /^[Nn]/); next }
  /# <<< WUD/ { skipw = 0; next }
  { if (!skip && !skipw) print }
' compose.template.yml > out/docker-compose.yml
```

- [ ] **Step 3: Reword the `INSTANCE_NAME` comment in the env template**

In `deploy/deployment.env.template`, replace:
```
# Instance name — unique per stack. Set a DIFFERENT value for each Chatsundere
# stack sharing one host/Traefik; it namespaces the compose project, the Traefik
# router/service/middleware names, the internal network, and the Watchtower scope,
# so two instances never collide. Must be a valid docker/Traefik name (lowercase
# alphanumeric + hyphen).
```
with:
```
# Instance name — unique per stack. Set a DIFFERENT value for each Chatsundere
# stack sharing one host/Traefik; it namespaces the compose project, the Traefik
# router/service/middleware names, and the internal network, so two instances
# never collide. NOTE: the bundled WUD auto-updater has no per-instance scope —
# run only ONE WUD per host (see deploy/README.md). Must be a valid docker/Traefik
# name (lowercase alphanumeric + hyphen).
```

- [ ] **Step 4: Validate both prompt paths gate correctly**

Run:
```bash
rm -rf /tmp/wud-kit-test && cp -r deploy /tmp/wud-kit-test && cd /tmp/wud-kit-test
# Default (WUD kept):
printf 'chatsundere.me\n\n\n\n\n\n\n' | ./generate.sh >/dev/null
grep -c 'image: getwud/wud' out/docker-compose.yml   # expect 1
# Declined (WUD omitted):
printf 'chatsundere.me\n\n\n\n\nn\n\n' | ./generate.sh >/dev/null
grep -c 'image: getwud/wud' out/docker-compose.yml   # expect 0
grep -c 'wud.watch=true' out/docker-compose.yml      # expect 4 (labels always present)
cd /home/chris/workspace/chatsundere
```
Expected: `1`, then `0`, then `4`.

- [ ] **Step 5: Commit**

```bash
git add deploy/generate.sh deploy/deployment.env.template
git commit -m "Gate the bundled WUD on the generator prompt, drop scope wording"
```

---

## Task 5: Regenerate committed `deploy/out/` sample + install.sh comment

**Files:**
- Modify: `deploy/install.sh`
- Modify: `deploy/out/docker-compose.yml`, `deploy/out/install.sh`, `deploy/out/deployment.env`

**Interfaces:**
- Consumes: the edited template + generator from Tasks 3–4.

- [ ] **Step 1: Fix the watchtower mention in `deploy/install.sh`**

Replace:
```bash
# brings up every service the compose file defines, incl. monitoring/watchtower
```
with:
```bash
# brings up every service the compose file defines, incl. monitoring/WUD
```

- [ ] **Step 2: Regenerate the sample compose + installer from a scratch run**

The committed `out/` was generated with monitoring OFF, updater ON. Regenerate the two structurally-changed files (no secrets in them) and copy them back:
```bash
rm -rf /tmp/wud-out && cp -r deploy /tmp/wud-out && cd /tmp/wud-out
printf 'chatsundere.me\n\n\n\n\n\n\n' | ./generate.sh >/dev/null
cp out/docker-compose.yml /home/chris/workspace/chatsundere/deploy/out/docker-compose.yml
cp out/install.sh        /home/chris/workspace/chatsundere/deploy/out/install.sh
cd /home/chris/workspace/chatsundere
```

- [ ] **Step 3: Hand-edit the one comment in the committed `out/deployment.env`**

`out/deployment.env` holds sample secrets that must NOT churn, so edit only the comment line. In `deploy/out/deployment.env`, apply the exact same `INSTANCE_NAME` comment reword as Task 4 Step 3 (replace the `...and the Watchtower scope,` paragraph with the WUD-note version).

- [ ] **Step 4: Validate the committed sample**

Run:
```bash
docker compose -f deploy/out/docker-compose.yml --env-file deploy/out/deployment.env config >/dev/null && echo OK
grep -rc watchtower deploy/out/ | grep -v ':0' || echo "no watchtower refs left"
grep -c 'wud.watch=true' deploy/out/docker-compose.yml   # expect 4
```
Expected: `OK`, then `no watchtower refs left`, then `4`.

- [ ] **Step 5: Commit**

```bash
git add deploy/install.sh deploy/out/
git commit -m "Regenerate deployment-kit sample output for WUD"
```

---

## Task 6: CI comments + prose docs

**Files:**
- Modify: `.github/workflows/docker.yml`
- Modify: `deploy/README.md`
- Modify: `obsidian/DEPLOYMENT.md`
- Modify: `obsidian/STATUS-BACKEND.md`, `obsidian/STATUS-CLIENT-ONLY.md`, `obsidian/STATUS-TRANSITION.md` (only where watchtower is named)

- [ ] **Step 1: Update the two CI comments**

In `.github/workflows/docker.yml`, at both occurrences (~line 68 and ~line 172) replace:
```
          # push — Watchtower watches :latest, so a release is a conscious tag,
```
with:
```
          # push — WUD watches :latest, so a release is a conscious tag,
```

- [ ] **Step 2: Reword `deploy/README.md`**

Replace:
```
`INSTANCE_NAME` (default `chatsundere`) and distinct hostnames — everything
else (compose project, Traefik router/service/middleware names, the internal
network, the Watchtower scope) namespaces off it automatically, so stacks
sharing a host/Traefik never collide. See `../obsidian/DEPLOYMENT.md` §5.
```
with:
```
`INSTANCE_NAME` (default `chatsundere`) and distinct hostnames — everything
else (compose project, Traefik router/service/middleware names, the internal
network) namespaces off it automatically, so stacks sharing a host/Traefik never
collide. The one exception is the bundled WUD auto-updater: WUD has no
per-instance scope, so run only ONE WUD per host — on a multi-instance host,
decline the bundled WUD and let a single host-level WUD watch every stack via the
`wud.watch` labels. See `../obsidian/DEPLOYMENT.md` §5.
```

- [ ] **Step 3: Reword `obsidian/DEPLOYMENT.md`**

Run `rg -n -i watchtower obsidian/DEPLOYMENT.md` and apply these edits (British English, preserve surrounding prose):

- INSTANCE_NAME table row (~227): drop `, and the Watchtower scope` from the namespacing list; append `. The bundled WUD updater has no per-instance scope — run only one WUD per host.`
- generate.sh prompt list (~275): `whether to include a\nscoped Watchtower` → `whether to include a bundled WUD auto-updater`.
- docker-compose.yml description (~292): `the monitoring/Watchtower blocks` → `the monitoring/WUD blocks`.
- namespacing paragraph (~314): drop `, and the Watchtower scope` and append the one-WUD-per-host caveat (same sentence as deploy/README.md Step 2).
- application-services paragraph (~355–358): `and monitoring/Watchtower if you opted in` → `and monitoring/WUD if you opted in`; `every Watchtower\nimage pull` → `every WUD image pull`.
- Upgrades line (~399–400): `so scope any Watchtower to conscious releases.` → `WUD watches :latest, which only moves on a conscious v*.*.* release tag.`
- MinIO line (~402): `not a Watchtower job` → `not a WUD job`.

Then add a short subsection under §5 (or the closest updater section) documenting the alpha host topology: a single host-level WUD (`infra/compose.wud.yml`), stacks opt in via `wud.watch`, legacy watchtower coexists on its own label namespace, migrate apps incrementally.

- [ ] **Step 4: Update STATUS files where watchtower is named**

Run `rg -n -i watchtower obsidian/STATUS-*.md` and replace incidental "Watchtower" mentions with "WUD" where they describe the auto-update mechanism. Do not invent new status content here — Task 7 handles the STATUS narrative.

- [ ] **Step 5: Verify no watchtower references remain except the intentional legacy-coexistence mentions**

Run:
```bash
rg -n -i watchtower --glob '!superpowers/**' --glob '!obsidian/insights/**' --glob '!obsidian/decisions/**'
```
Expected: only intentional mentions of the *legacy* watchtower coexistence (in `infra/compose.wud.yml` and the DEPLOYMENT.md topology note). No stray `containrrr/watchtower` or `com.centurylinklabs` outside those.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/docker.yml deploy/README.md obsidian/DEPLOYMENT.md obsidian/STATUS-*.md
git commit -m "Update CI comments and deployment docs for WUD [skip ci]"
```

---

## Task 7: Squash, STATUS, and manual-verification handoff

- [ ] **Step 1: Squash the migration into one feature commit**

Per CLAUDE.md §8 (one squashed commit per feature unit). Squash Tasks 1–6 into a single commit on master:
```
Replace Watchtower with WUD; add host-level updater
```
(Do NOT include `[skip ci]` — the commit touches code/compose. Keep the co-author trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.)

- [ ] **Step 2: Update the STATUS file**

Update `obsidian/STATUS-BACKEND.md` (deployment/infra side): note the WUD migration is done, the host-WUD topology, and the follow-up to migrate the remaining ~10 host apps incrementally. Refresh the `Last updated:` line. Commit with `[skip ci]`.

- [ ] **Step 3: Hand the manual-verification checklist to Chris**

Surface spec §8 for Chris to run on the host — deploy `infra/compose.wud.yml`, confirm WUD watches only the alpha frontend, move `:latest` and confirm auto-recreate + prune, confirm the legacy watchtower app is unaffected, reach the dashboard over HTTPS, and regenerate the kit both Y/n. If WUD needs `wud.tag.include=^latest$` to track the mutable tag (empirical, per spec §3), add it per service and re-verify.

---

## Notes on audit gates

- **Larissa (security):** her explicit scope is `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, `packages/crypto` — not `infra/` or `deploy/`. This change is like-for-like on the host-control surface (same RW `docker.sock`, same auto-pull-and-recreate) and is a net improvement (maintained tool replacing an archived one), so a Larissa pass is not required. Offer it to Chris as optional given the host-control surface; he arbitrates.
- **Laura (UX):** not applicable — no `apps/user-client` change.

## Self-Review

- **Spec coverage:** §2 decision → Tasks 1–5; §3 config reference → Tasks 1–3; §4 alpha host → Tasks 1–2; §5 kit → Tasks 3–4; §6 file inventory → Tasks 1–6; §7 out-of-scope respected (no socket-proxy, no compose-trigger); §8 manual verification → Task 7 Step 3. UI (§4.1) → Task 1.
- **Placeholder scan:** none — every edit gives exact before/after; the only deliberately open item is the on-host `wud.tag.include` fallback, flagged as empirical per spec.
- **Type/name consistency:** watcher name `local`, trigger name `local`, labels `wud.watch` / `wud.watch.digest`, env vars `WUD_WATCHER_LOCAL_*` / `WUD_TRIGGER_DOCKER_LOCAL_*`, env-file vars `HOST_WUD` / `WUD_AUTH_USERS` — used identically across all tasks.
