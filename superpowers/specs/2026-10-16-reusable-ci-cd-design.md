# Reusable CI/CD — Versioned Docker Images, Plug and Play

**Date:** 2026-10-16
**Status:** Proposal — awaiting Chris's review. No code changed yet.
**Scope:** `.github/workflows/*`, `version.txt`, `forcebuild.txt`, `.mise.toml`, `deploy/*`, CLAUDE.md §8 and §12.
**Audit gates:** Larissa (supply-chain and signing changes, phase 1 and 3). Laura not needed — no user-facing flow.

---

## 1. Goal

Two goals, in order:

1. **Make Chatsundere's build-and-release path safe and boring.** A red commit must never reach `:latest`; the version must have exactly one source of truth; releasing must not depend on remembering the order of three commits.
2. **Extract the result into something any project — ours or someone else's — can adopt in minutes:** "I have a Dockerfile, I want nicely versioned, signed images on GHCR." Plug and play, convention over configuration, with Chatsundere as the first consumer (dogfooding).

## 2. Current state (as of `v0.3.2`)

```
push master ──► ci.yml      lint · typecheck · build · tests (Postgres + Redis services)
             └► docker.yml  frontend + backend image → GHCR  (tags: master, sha-xxxxxxx)
             └► pages.yml   teaser site
push v1.2.3 ──► docker.yml  tags 1.2.3 / 1.2 / 1 / latest, cosign keyless signing
             └► pages.yml
                     │
                     ▼
           WUD on the host watches :latest by digest → pulls, recreates the container
```

### 2.1 What is good and must survive

| Property | Where |
|---|---|
| `latest` moves **only** on a `v*.*.*` tag push — a release is a conscious act, not a side effect of a merge. | `docker.yml` metadata `enable=` expression |
| A version contract: `VERSION`, `GIT_SHA`, `BUILT_AT` build args, baked into the bundle and written to `/VERSION` in both images. | both Dockerfiles |
| SemVer tag fan-out via `docker/metadata-action` (`X.Y.Z`, `X.Y`, `X`, `sha-…`, branch, PR). | `docker.yml` |
| Keyless cosign signing (OIDC, no long-lived key). | `docker.yml` |
| Layer-ordered multi-stage builds, GHA cache scoped per image. | Dockerfiles, `docker.yml` |
| Opt-in auto-update via WUD labels; no push access from CI to the server. | `deploy/compose.template.yml`, `infra/compose.wud.yml` |
| Deploy env wiring check runs first in CI. | `deploy/check-env-wiring.sh` |

### 2.2 Findings

Ordered by severity.

#### F1 — A red commit can be released to production · **high**

`ci.yml` and `docker.yml` are independent workflows. Tagging a commit whose tests fail still builds and pushes `:latest`; WUD rolls it out within two minutes. Nothing gates it.

#### F2 — `version.txt` has drifted and makes pre-release versions sort wrongly · **medium**

`version.txt` contains `0.2.0`; the newest tag is `v0.3.2`. Untagged builds are stamped `0.2.0-pre.<run>`, which SemVer orders *before* the currently released `0.3.2`. STATUS-BACKEND already carries a warning about this — the warning is a symptom of having two sources of truth for the version (the file and the tag).

#### F3 — The `[skip ci]` tag trap is guarded only by discipline · **medium**

CLAUDE.md §8 documents it: a tag pointing at a `[skip ci]` commit silently builds nothing. The current mitigation is a habit ("squash → tag → then STATUS"). A habit is not a control.

#### F4 — `forcebuild.txt` exists to trigger builds · **low**

Editing a file to kick CI produces commit noise and is exactly what `workflow_dispatch` is for.

#### F5 — Duplication and toolchain drift · **low**

- The two Docker jobs are ~100 lines of near-identical YAML each. Any fix must be made twice (and will eventually be made once).
- `.mise.toml` pins `node = "20"` and `bun = "latest"`; the images build on `node:22-alpine` and run on `oven/bun:1-alpine`. CI tests on a different Node than the one that builds the shipped bundle, and `bun = "latest"` makes CI non-reproducible.
- `pages.yml` also has no `paths-ignore` and rebuilds the teaser site on every push.

#### F6 — Supply-chain gaps · **medium** (given the "as trustworthy as Proton" bar)

- **Actions pinned by mutable tag** (`actions/checkout@v4`, `docker/build-push-action@v6`, `sigstore/cosign-installer@v3`, `jdx/mise-action@v2`, …). A compromised upstream tag runs with `packages: write` and `id-token: write`.
- **Signatures are never verified.** WUD does not check cosign signatures and `deploy/install.sh` does not either, so today the signature is decorative.
- **No SBOM, no build provenance.** `docker/build-push-action` produces both for free (`sbom: true`, `provenance: mode=max`).
- **Unpinned third-party images in the self-host template:** `prom/prometheus:latest`, `grafana/grafana:latest`, `getwud/wud` (no tag). This is the pattern we deliberately avoid for our own images.
- cosign signs once **per tag** (`xargs … cosign sign {}@${DIGEST}`); signing the digest once is sufficient and cleaner.

#### F7 — Minor

- amd64 only. The frontend image is architecture-independent (nginx + static files), so arm64 costs almost nothing there; self-hosters on a Pi or Hetzner ARM would benefit. Native `ubuntu-24.04-arm` runners avoid slow QEMU emulation.
- No GitHub Releases: tags exist, but nothing appears on the repository's Releases page, and there is no changelog.
- PR builds rebuild both images including the ~450 MB embedding-model layer. Cache makes this tolerable; worth keeping an eye on.

---

## 3. Proposal

Three phases. Phase 1 is local to Chatsundere and fixes the dangerous parts; phases 2 and 3 build the reusable kit.

### Phase 1 — Harden Chatsundere's pipeline (≈ one afternoon)

#### 1.1 Gate images on tests (fixes F1)

Turn `ci.yml` into a reusable workflow and call it from a single release workflow, so image jobs carry `needs: test`.

```yaml
# .github/workflows/ci.yml
on:
  workflow_call:
  pull_request:          # keep standalone PR runs
```

```yaml
# .github/workflows/release.yml (replaces docker.yml)
jobs:
  test:
    uses: ./.github/workflows/ci.yml
  images:
    needs: test
    # … matrix build, see 1.5
```

Merging `ci.yml` and `docker.yml` into one file is the simpler alternative; the `workflow_call` split keeps the test suite readable on its own and is what phase 2 needs anyway.

#### 1.2 Derive the version from Git, delete `version.txt` (fixes F2)

Single source of truth: the tag.

```bash
# needs actions/checkout with fetch-depth: 0 (or fetch-tags: true)
if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
  VERSION="${GITHUB_REF#refs/tags/v}"
else
  LAST=$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || echo v0.0.0)
  N=$(git rev-list --count "${LAST}..HEAD")
  IFS=. read -r MA MI PA <<<"${LAST#v}"
  VERSION="${MA}.${MI}.$((PA + 1))-dev.${N}.g${GITHUB_SHA::7}"
fi
```

Result between releases: `0.3.3-dev.7.gabc1234` — sorts after `0.3.2` and before `0.3.3`, as SemVer intends. No `+build` metadata, because Docker tags do not allow `+`.

Consequences:
- `version.txt` is removed. The two Dockerfiles keep their `ARG VERSION=0.0.0-dev` default for local builds.
- The only readers today are `docker.yml` (twice) and `pages.yml`; `pages.yml` switches to the same `version` step. Local dev builds keep falling back to `0.0.0-dev`.
- STATUS-BACKEND's ⚠️ note about the stale file goes away.

#### 1.3 Replace `[skip ci]` with path filters (fixes F3)

```yaml
on:
  push:
    branches: [master]
    paths-ignore:
      - '**/*.md'
      - 'obsidian/**'
      - 'superpowers/**'
      - 'docs/**'          # pages.yml keeps its own trigger for this
    tags: ['v*.*.*']
  pull_request:
    paths-ignore: [ …same list… ]
  workflow_dispatch:
```

GitHub's workflow-syntax documentation states that path filters are not evaluated for tag pushes, so a tag always builds regardless of which files its commit touched — the trap disappears structurally. Doc-only pushes to `master` still skip CI, so the cost saving of `[skip ci]` is kept.

**Verification before relying on it:** in a scratch repository (or a fork) with the same trigger block, commit a Markdown-only change, tag it `v0.0.1`, push the tag, and confirm the workflow runs. Doing this in Chatsundere itself would move `:latest`. Empirical truth over docs (CLAUDE.md §13).

Then CLAUDE.md §8 changes: the `[skip ci]` rule and the "never tag a `[skip ci]` commit" rule are both retired. Keeping `[skip ci]` in the commit vocabulary would reintroduce the trap, so the commit-message convention drops it too.

#### 1.4 `workflow_dispatch` instead of `forcebuild.txt` (fixes F4)

Add `workflow_dispatch:` to the release workflow (done in 1.3) and delete `forcebuild.txt`.

#### 1.5 One matrix job instead of two copies (fixes F5, part 1)

```yaml
images:
  needs: test
  strategy:
    fail-fast: false
    matrix:
      include:
        - name: frontend
          dockerfile: apps/user-client/Dockerfile
        - name: backend
          dockerfile: apps/backend/Dockerfile
  runs-on: ubuntu-latest
  # … one copy of: version, metadata, build-push, sign, attest, summary
  # image: ghcr.io/${{ github.repository }}-${{ matrix.name }}
  # cache scope: ${{ matrix.name }}
```

Image names stay exactly as they are (`chatsundere-frontend`, `chatsundere-backend`), so WUD and every deployed compose file keep working with no change.

#### 1.6 Align the toolchain (fixes F5, part 2)

- `.mise.toml`: pin `node = "22"` (matching `node:22-alpine`), and pin `bun` to the same minor as the runtime image (e.g. `bun = "1.2"` alongside `oven/bun:1.2-alpine`).
- Pin the base images in both Dockerfiles to at least a minor (`node:22.x-alpine`, `oven/bun:1.x-alpine`, `nginx:1.27-alpine` is already fine); Renovate (3.3) keeps them current.
- Add the same `paths-ignore` to `pages.yml`, inverted (it should run *only* when `docs/**` changes or on a tag).

#### 1.7 Signing, SBOM, provenance (fixes F6, part 1)

```yaml
- uses: docker/build-push-action@<sha>
  with:
    provenance: mode=max
    sbom: true
- name: Sign
  run: cosign sign --yes "${IMAGE}@${DIGEST}"     # once, by digest
```

Add to `deploy/install.sh` (and document in `deploy/README.md` for self-hosters):

```bash
cosign verify "$BACKEND_IMAGE" \
  --certificate-identity-regexp '^https://github.com/symphonic-navigator/chatsundere/\.github/workflows/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

`cosign` becomes an optional dependency of `install.sh`: verify when present, print a clear warning when absent. Larissa audits this step.

### Phase 2 — Extract a reusable workflow kit

A new **public** repository, working name `tidesson/ci-workflows` (GPLv3; see §5 on licence choice).

#### 2.1 Layout

```
ci-workflows/
├── .github/workflows/
│   ├── docker-image.yml      on: workflow_call — build, tag, push, sign, attest one or many images
│   ├── release.yml           on: workflow_call — compute next version, tag, GitHub Release
│   └── self-test.yml         builds examples/ on every push (dogfooding)
├── actions/
│   ├── version/action.yml    composite: Git-derived SemVer (the script from 1.2)
│   └── discover/action.yml   composite: find Dockerfiles → JSON matrix
├── examples/
│   ├── single-dockerfile/
│   └── monorepo/apps/{web,api}/Dockerfile
├── README.md                 the contract (§2.3) + quickstart
└── LICENSE
```

The kit versions itself with its own `release.yml` and publishes moving major tags (`v1`), so consumers write `@v1` and get fixes without breaking changes.

#### 2.2 Convention over configuration

The `discover` action makes zero-config the default:

| Repo shape | Discovered images |
|---|---|
| `./Dockerfile` | `ghcr.io/<owner>/<repo>` |
| `apps/<name>/Dockerfile`, `services/<name>/Dockerfile` | `ghcr.io/<owner>/<repo>-<name>` |
| `.github/images.yml` present | exactly what it lists (overrides discovery) |

`.github/images.yml`, only for special cases:

```yaml
images:
  frontend:
    dockerfile: apps/user-client/Dockerfile
    context: .
    platforms: [linux/amd64, linux/arm64]
  backend:
    dockerfile: apps/backend/Dockerfile
```

Chatsundere needs the explicit file: discovery would publish `apps/user-client/Dockerfile` as `chatsundere-user-client`, but the deployed name is `chatsundere-frontend`, and renaming it would break every running WUD-watched install.

#### 2.3 The contract (what every consumer gets)

**Build args** passed to every build:

| Arg | Example | Notes |
|---|---|---|
| `VERSION` | `1.4.2` / `1.4.3-dev.7.gabc1234` | Git-derived, see 1.2 |
| `GIT_SHA` | `abc1234` | short SHA |
| `BUILT_AT` | `2026-10-16T14:03:11Z` | UTC, ISO 8601 |

**Image tags:**

| Event | Tags |
|---|---|
| tag `v1.4.2` | `1.4.2`, `1.4`, `1`, `latest`, `sha-abc1234` |
| push to default branch | `edge`, `<branch>`, `sha-abc1234`, `1.4.3-dev.7.gabc1234` |
| pull request | built, **not** pushed |
| `workflow_dispatch` | as for the ref it runs on |

`edge` is new: a stable channel name for "newest default-branch build", useful for a staging host. `latest` keeps its current, release-only meaning.

**OCI labels:** `org.opencontainers.image.{version,revision,created,source,licenses,title}` — set by `metadata-action`.

**Supply chain:** keyless cosign signature on the digest, SLSA provenance, SPDX SBOM. README documents the matching `cosign verify` command.

**Recommended (not required) in the Dockerfile:** write `/VERSION` from the build args, as Chatsundere already does.

#### 2.4 What a consumer writes

Minimal project:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push: { branches: [main], tags: ['v*.*.*'] }
  pull_request:
  workflow_dispatch:

jobs:
  images:
    uses: tidesson/ci-workflows/.github/workflows/docker-image.yml@v1
    permissions: { contents: read, packages: write, id-token: write, attestations: write }
```

Chatsundere after migration:

```yaml
jobs:
  test:
    uses: ./.github/workflows/ci.yml
  images:
    needs: test
    uses: tidesson/ci-workflows/.github/workflows/docker-image.yml@v1
    permissions: { contents: read, packages: write, id-token: write, attestations: write }
```

(`.github/images.yml` supplies the two images.)

#### 2.5 Inputs of `docker-image.yml`

| Input | Default | Purpose |
|---|---|---|
| `registry` | `ghcr.io` | any OCI registry; non-GHCR needs `secrets: inherit` |
| `image-prefix` | `<owner>/<repo>` | base name |
| `platforms` | `linux/amd64` | per-image override in `images.yml` |
| `push-on-pr` | `false` | |
| `sign` | `true` | cosign keyless |
| `attest` | `true` | SBOM + provenance |
| `latest-on-tag-only` | `true` | the Chatsundere rule, as a default |

### Phase 3 — Release button, hardening, template

#### 3.1 Release by button (fixes F7, part 2; retires the ordering habit)

`release.yml`, `on: workflow_dispatch` with input `bump: patch | minor | major`:

1. Read the latest `v*` tag, compute the next version.
2. Require the CI check on the target commit to be green (`gh api` check-runs, or simply `needs: test` in the same run).
3. Create the annotated tag and a GitHub Release with `generate_release_notes: true`.
4. The tag push triggers the image build.

Tag pushes made with the default `GITHUB_TOKEN` do **not** trigger other workflows. So either the release workflow calls `docker-image.yml` directly after tagging (preferred — one run, one log), or it uses a GitHub App token. Calling directly is simpler and avoids a new secret.

A matching `scripts/release.sh patch|minor|major` for local use. No Conventional Commits required; our free-form imperative subjects stay. Release-note curation remains manual for now (CLAUDE.md §12), on top of the generated list.

#### 3.2 Pin actions by SHA (fixes F6, part 2)

Every `uses:` pinned to a full commit SHA with a trailing version comment:

```yaml
- uses: actions/checkout@<40-char-sha> # v4.2.2
```

Applies to Chatsundere and to the kit. Renovate (3.3) updates the SHA and the comment together.

#### 3.3 Renovate

One `renovate.json` covering GitHub Actions, Dockerfile base images, compose images, and `mise` tools. Grouped weekly PRs, auto-merge for digest-only updates once CI is green. Pins `prometheus`, `grafana`, `wud` in `deploy/compose.template.yml` to explicit versions and keeps them current.

#### 3.4 Multi-arch (fixes F7, part 1)

Frontend: `linux/amd64,linux/arm64` immediately (static files, near-zero cost). Backend: arm64 via native `ubuntu-24.04-arm` runners and a manifest-merge step, once someone actually asks — Bun on Alpine/arm64 needs a smoke test first.

#### 3.5 Template repository for other people

`tidesson/docker-app-template` — "Use this template" on GitHub gives:

- example `Dockerfile` honouring the contract (writes `/VERSION`)
- `.github/workflows/release.yml` (the 10-line consumer from 2.4)
- `renovate.json`, `.mise.toml`
- `compose.example.yml` with WUD labels and the `cosign verify` snippet
- README: "push a tag, get an image"

Optionally, if `symphonic-navigator` / Tidesson becomes a GitHub organisation: `<org>/.github/workflow-templates/` makes the release workflow appear directly under *Actions → New workflow* in every repo of the org.

---

## 4. Rollout order

| Step | Change | Risk | Gate |
|---|---|---|---|
| 1 | 1.1 test gate, 1.4 `workflow_dispatch`, 1.5 matrix | low — image names unchanged | CI green on a branch, then on master |
| 2 | 1.2 Git-derived version, delete `version.txt` | low — check all readers first | dev build shows `0.x.y-dev…` |
| 3 | 1.3 path filters, retire `[skip ci]` | medium — verify tag behaviour empirically first | test tag builds |
| 4 | 1.6 toolchain alignment | low | full CI green |
| 5 | 1.7 SBOM, provenance, sign-by-digest, `cosign verify` in installer | medium | **Larissa** |
| 6 | First real tag through the new pipeline (`v0.3.3`) | — | WUD picks it up; `/VERSION` correct; `cosign verify` passes |
| 7 | Phase 2: create kit, migrate Chatsundere to `@v1` | medium | identical tag set before/after (diff the GHCR tag lists) |
| 8 | Phase 3: release button, SHA pins, Renovate, template repo | low | **Larissa** for 3.2/3.3 |

Each step is one squashed commit (ADR 0003).

## 5. Decisions Chris needs to make

1. **Kit home and name.** `tidesson/ci-workflows` presumes a `tidesson` GitHub organisation; until it exists, `symphonic-navigator/ci-workflows`. Moving later is possible (GitHub redirects), but consumers would then reference the old path until updated.
2. **Kit licence.** GPLv3 fits the house rule. Worth knowing: a GPL workflow file that consumers merely *reference* via `uses:` does not impose anything on their code, so GPLv3 is no barrier to adoption. The example Dockerfile in the template repo could be MIT so people can copy it freely — Chris's call.
3. **`edge` channel.** Introduce it (useful for a staging host watching `:edge`), or keep only `latest` + `sha-*`?
4. **Retire `[skip ci]` entirely?** Recommended — keeping it alongside path filters reintroduces the trap.
5. **ADR.** This changes CLAUDE.md §8 (commit conventions, tag ordering) and settles §12 ("versioning automation: Chris has ideas in flight"). It warrants ADR 0038.

## 6. Out of scope

- Deployment orchestration beyond WUD (Kubernetes, Nomad, …).
- Registries other than GHCR in phase 1 (the kit supports them via inputs in phase 2).
- Changelog tooling beyond GitHub's generated notes.
- Moving WUD off the read-write Docker socket (tracked separately as a hardening item).

## 7. Manual verification

Steps Chris runs himself after phase 1 lands:

1. Push a doc-only commit to `master` → no CI, no image build runs.
2. Push a code commit to `master` → CI runs; images build **only after** tests pass; GHCR shows `sha-…` and `0.3.3-dev.N.g…` tags; `:latest` unchanged; WUD does nothing.
3. Break a test on a branch, tag it on a fork or test repo → no image is pushed.
4. Tag `v0.3.3` on a green commit → `0.3.3`, `0.3`, `0`, `latest` appear; WUD updates the alpha within ~2 minutes.
5. Open the app → About shows `0.3.3 (<sha>, <timestamp>)`; `curl https://<host>/VERSION` matches.
6. On the server: `cosign verify ghcr.io/symphonic-navigator/chatsundere-backend:0.3.3 …` (command from 1.7) succeeds; with a tampered identity regexp it fails.
7. `docker buildx imagetools inspect ghcr.io/symphonic-navigator/chatsundere-frontend:0.3.3 --format '{{json .SBOM}}'` returns an SBOM.
8. Actions tab → *Release* → *Run workflow* rebuilds without a commit (replaces `forcebuild.txt`).
