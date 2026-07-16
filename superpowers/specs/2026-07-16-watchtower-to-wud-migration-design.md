# Watchtower → WUD Migration — Design

- **Date:** 2026-07-16
- **Author:** Liz (with Chris)
- **Status:** Approved (design), pending implementation plan
- **Supersedes:** the Watchtower auto-update mechanism established in the deployment kit
  ([2026-07-07-deployment-kit-design.md](2026-07-07-deployment-kit-design.md)) and the
  alpha stack (`infra/compose.alpha.yml`).

## 1. Context & Problem

Chatsundere relies on an auto-updater so that a `v*.*.*` tag moving the `:latest`
image triggers a live redeploy. Two sites use `containrrr/watchtower`:

- `infra/compose.alpha.yml` — Chris's reference instance (app.chatsundere.me).
- `deploy/compose.template.yml` — the deployment kit self-hosters generate.

`containrrr/watchtower` was **archived on 2025-12-17**. Both maintainers stepped
away; newer Docker releases break it. It is a dead dependency on a security-relevant
path (host-level container control), which is unacceptable for a project holding a
"Proton bar".

## 2. Decision

Migrate both sites to **WUD (What's Up Docker, `getwud/wud`)** — actively maintained,
richer, and the current community successor.

Two sub-decisions, both settled with Chris:

- **Docker trigger, not Docker-Compose trigger.** WUD's Docker trigger recreates the
  container in place from a clone of its running config, which preserves our
  migrate-then-serve `command:`, env, and labels — exactly Watchtower's semantics
  (pull the new `:latest` digest → recreate). The Compose trigger is "cleaner" (it
  rewrites the compose file and re-runs compose) but needs the compose file plus a
  docker binary mounted into WUD and has version-inconsistent behaviour across
  releases (getwud/wud issues #546, #598, #1005). Not worth it.
- **One WUD per host, not one per stack** (see §4). WUD has **no native scope**
  (verified against the watcher docs): its only container-selection mechanism is the
  `wud.watch` label plus `WATCHBYDEFAULT`. A watcher always reads the whole socket, so
  two WUD instances on one host both act on every `wud.watch=true` container — they
  cannot be isolated the way Watchtower's `WATCHTOWER_SCOPE` isolated them.

## 3. WUD Configuration Reference

Watchtower → WUD mapping (the behaviour we preserve):

| Watchtower (old) | WUD (new) |
|---|---|
| `containrrr/watchtower` (archived) | `getwud/wud` (maintained) |
| `WATCHTOWER_LABEL_ENABLE=true` + opt-in label | `WUD_WATCHER_LOCAL_WATCHBYDEFAULT=false` + `wud.watch=true` per service |
| `WATCHTOWER_CLEANUP=true` | `WUD_TRIGGER_DOCKER_LOCAL_PRUNE=true` |
| `WATCHTOWER_POLL_INTERVAL=<n>` | `WUD_WATCHER_LOCAL_CRON=<cron>` |
| auto-recreate on new `:latest` | Docker trigger with `AUTO=true` (WUD default) |
| digest comparison on `:latest` | `wud.watch.digest=true` per service (required: `:latest` is a mutable tag; WUD's digest default is `false` when `WATCHBYDEFAULT=false`) |
| `WATCHTOWER_SCOPE=${INSTANCE_NAME}` | *(no equivalent — see topology in §4)* |

Per-service opt-in labels (replace the two `com.centurylinklabs.watchtower.*` labels):

```yaml
- "wud.watch=true"
- "wud.watch.digest=true"
```

> **Verification note (empirical, per project discipline):** the exact digest-tracking
> behaviour on a mutable `:latest` tag — and whether an accompanying `wud.tag.include`
> is needed to pin it — is confirmed against a live WUD during implementation, not
> assumed from docs. If pinning is required, add `wud.tag.include=^latest$` per service.

## 4. Design — Alpha Host

Chris's host runs ~10 unrelated apps and one legacy `containrrr/watchtower` (serving a
single app, still functional). The long-term goal is to migrate everything to WUD
incrementally, never a big bang.

1. **New `infra/compose.wud.yml`** — a single host-level WUD, deliberately separate from
   the app stack (it is host infrastructure serving many stacks, not part of
   Chatsundere). Configuration:
   - `WUD_WATCHER_LOCAL_WATCHBYDEFAULT=false` — touches nothing without an explicit
     `wud.watch=true` label. On day one that is only the alpha frontend.
   - Docker trigger, `AUTO=true` (default), `WUD_TRIGGER_DOCKER_LOCAL_PRUNE=true`.
   - `WUD_WATCHER_LOCAL_CRON="*/2 * * * *"` — preserves the alpha 2-minute cadence.
   - `/var/run/docker.sock` mounted RW (required for the Docker trigger to recreate
     containers). Same posture as Watchtower — accepted; socket hardening is out of
     scope (§7).
   - **WUD dashboard exposed via Traefik**, behind a basicauth middleware, following the
     Prometheus/Grafana pattern already in `compose.alpha.yml` (port 3000, `websecure`,
     the host's cert resolver). The design provides the ready router/middleware label
     block and the WUD joins the external `traefik` network; **Chris owns the final
     wiring** — hostname (`HOST_WUD`), cert resolver name, and the basicauth user list
     are his to set on the host.

2. **`infra/compose.alpha.yml`** — remove the bundled `watchtower` service. The frontend
   service carries `wud.watch=true` + `wud.watch.digest=true` and becomes the first WUD
   citizen. It no longer runs its own updater.

3. **Legacy watchtower coexistence.** The existing single-app watchtower keeps running
   untouched: it acts on its own `com.centurylinklabs.watchtower.*` labels, the host WUD
   acts only on `wud.watch` labels — two disjoint namespaces, **zero collision**. As
   Chris migrates each remaining app, he adds `wud.watch=true` to it and removes that
   app's watchtower; the host WUD picks it up automatically. This is the incremental
   path to "everything on WUD".

## 5. Design — Deployment Kit

The kit targets clean single-purpose hosts, so it keeps a **bundled WUD** inside the
generated compose:

- `deploy/compose.template.yml` — replace the `watchtower` service with a `wud` service
  (`WUD_WATCHER_LOCAL_WATCHBYDEFAULT=false`, Docker trigger, `PRUNE=true`, cron matching
  the old 5-minute poll). Per-service `wud.watch` + `wud.watch.digest` labels on
  frontend/auth/sync/proxy. `WATCHBYDEFAULT=false` guarantees it never touches a
  self-hoster's other containers.
- `deploy/generate.sh` — rename the awk section markers `# >>> WATCHTOWER` /
  `# <<< WATCHTOWER` to `# >>> WUD` / `# <<< WUD`, and reword the interactive prompt
  ("Include a scoped Watchtower…" → "Include a bundled WUD auto-updater? [Y/n]"). The
  awk gating logic is otherwise unchanged.
- `deploy/deployment.env.template` — drop the "and the Watchtower scope" clause from the
  `INSTANCE_NAME` comment (WUD has no scope; `INSTANCE_NAME` still namespaces the compose
  project, Traefik names, and the network).

Because per-service `wud.watch` labels are always present, a self-hoster who declines the
bundled WUD (or already runs their own host WUD) still gets working opt-in.

## 6. File Change Inventory

- `infra/compose.wud.yml` — **new** (host-level WUD, incl. the Traefik router +
  basicauth label block and membership of the external `traefik` network for the UI).
- `infra/compose.alpha.yml` — remove watchtower service; add `wud.*` labels to frontend.
- `deploy/compose.template.yml` — watchtower service → wud service; `wud.*` labels on the
  four services.
- `deploy/generate.sh` — marker rename, prompt reword, comment.
- `deploy/deployment.env.template` — reword `INSTANCE_NAME` comment.
- `.github/workflows/docker.yml` — two comments (lines ~68, ~172): "Watchtower watches
  :latest" → "WUD watches :latest".
- `deploy/out/*` — regenerate `docker-compose.yml`, `install.sh`, `deployment.env` from
  the updated template/generator.
- Docs: `obsidian/DEPLOYMENT.md`, `deploy/README.md`, and the STATUS files —
  replace Watchtower references, document the host-WUD topology and the incremental
  migration path.

## 7. Out of Scope

- **Socket hardening** (docker-socket-proxy). WUD still needs RW socket for the Docker
  trigger; restricting it is a separate, later decision. Recorded, not done here.
- **Docker-Compose trigger.** Rejected in §2.
- **Migrating the remaining ~10 host apps** to WUD. That is Chris's incremental
  follow-up; this design only makes the alpha stack the first citizen and establishes
  the host WUD they will all subscribe to.

## 8. Manual Verification (Chris runs on the host)

1. Deploy `infra/compose.wud.yml`; confirm the WUD container is healthy and its log shows
   the `local` watcher registered with `WATCHBYDEFAULT=false`.
2. Confirm WUD's dashboard/log lists **only** the alpha frontend as watched — none of the
   ~10 other apps, and not the legacy-watchtower app.
3. Move `:latest` (push a throwaway frontend image or re-tag) and confirm WUD detects the
   new digest within the cron window and recreates the frontend automatically, old image
   pruned.
4. Confirm the legacy watchtower's app still updates on its own — no interference either
   direction.
5. Reach the WUD dashboard over HTTPS at `HOST_WUD`, confirm basicauth challenges and the
   dashboard renders.
6. Regenerate the kit (`deploy/generate.sh`), answer the WUD prompt both Y and n, and
   confirm the emitted `out/docker-compose.yml` contains (Y) the wud service + labels, or
   (n) only the labels.
