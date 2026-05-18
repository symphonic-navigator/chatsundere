# Project Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Chatsundere monorepo skeleton (workspace tooling, dev infrastructure with persistent volumes, empty-but-running stubs for every Phase 0–2 service and package, docs, CI, dev-setup script) so a fresh clone runs green on `pnpm install / lint / typecheck / build / test`, `docker compose up -d`, and `pnpm dev`.

**Architecture:** pnpm 9 + Turborepo monorepo. Bun runtime for backend services (`auth-service`, `sync-service`, `proxy-service`) on ports 3100/3200/3300 with `/healthz /readyz /metrics` only. Vite + React 18 + Tailwind v4 for `user-client` (port 3000) and `admin-client` (port 3010), each rendering a single `<h1>`. Three packages: `shared-types` (MIT), `crypto` (LGPL-3.0, all stubs throwing `CryptoError('internal', 'Stub')`), `llm-unified` (LGPL-3.0, empty). PostgreSQL 16 + Redis 7 + Prometheus + Grafana in Docker Compose with bind-mount volumes under `infra/data/`. Strict TypeScript everywhere.

**Tech Stack:** TypeScript 5.x, Bun (latest), Node 20, pnpm 9, Turborepo 2.x, Hono, Pino, prom-client, Valibot, React 18, Vite, Tailwind v4, Biome, lefthook, mise, Docker Compose v2.

**Spec:** [`superpowers/specs/2026-05-18-project-structure-design.md`](../specs/2026-05-18-project-structure-design.md)

**Commit strategy:** Each task ends with its own commit on `master` (pre-public phase, working directly on master per CLAUDE.md §8). The final task (Task 18) squashes all task commits into a single "Set up monorepo and tooling" commit per ADR 0003. Per-task commits are doc-and-config-only or wire-up-only — none of them ship real service logic — so each task commit gets the `[skip ci]` tag during the build phase. The final squashed commit is real feature work and does NOT get `[skip ci]` (it should run CI).

---

## Task 1: Repository Foundation Files

**Files:**
- Create: `.editorconfig`
- Create: `.mise.toml`
- Create: `.envrc`
- Create: `LICENSE-AGPLv3`
- Create: `LICENSE-LGPLv3`
- Create: `LICENSE-MIT`
- Modify: `.gitignore` (extend with new entries)

- [ ] **Step 1: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 2: Create `.mise.toml`**

```toml
[tools]
bun = "latest"
node = "20"
pnpm = "9"
```

- [ ] **Step 3: Create `.envrc`**

```bash
dotenv_if_exists apps/auth-service/.env
dotenv_if_exists apps/sync-service/.env
dotenv_if_exists apps/proxy-service/.env
dotenv_if_exists apps/user-client/.env
dotenv_if_exists apps/admin-client/.env
PATH_add node_modules/.bin
```

- [ ] **Step 4: Extend `.gitignore`**

Append the following block to the existing `.gitignore`:

```
# Chatsundere — added by project-structure unit

# Docker bind-mount target (local dev data, never committed)
infra/data/

# Per-service env files (.env at root is already gitignored)
apps/*/.env
packages/*/.env

# Production compose file (only the .example is committed)
infra/compose.prod.yml
```

- [ ] **Step 5: Download and write the three licence files**

Fetch the official texts from `https://www.gnu.org/licenses/agpl-3.0.txt`, `https://www.gnu.org/licenses/lgpl-3.0.txt`, and the MIT licence template, and write them to `LICENSE-AGPLv3`, `LICENSE-LGPLv3`, `LICENSE-MIT` respectively. The MIT licence template should be parameterised:

```
MIT Licence

Copyright (c) 2026 Chris and Chatsundere contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Note British spelling: "Licence" (noun) in the header.

- [ ] **Step 6: Verify all files exist**

Run: `ls -la .editorconfig .envrc .mise.toml LICENSE-AGPLv3 LICENSE-LGPLv3 LICENSE-MIT && grep -c "infra/data" .gitignore`
Expected: all six files listed, `grep` returns `1`.

- [ ] **Step 7: Commit**

```bash
git add .editorconfig .envrc .mise.toml LICENSE-AGPLv3 LICENSE-LGPLv3 LICENSE-MIT .gitignore
git commit -m "Add foundation files (licences, mise, direnv, editorconfig) [skip ci]"
```

---

## Task 2: Workspace Root Files

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `turbo.json`
- Create: `lefthook.yml`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "chatsundere",
  "version": "0.0.0",
  "private": true,
  "description": "End-to-end encrypted, local-first AI companion platform.",
  "license": "AGPL-3.0-only",
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "biome check .",
    "format": "biome format --write .",
    "prepare": "lefthook install"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "lefthook": "^1.10.0",
    "turbo": "^2.3.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignore": ["dist", "node_modules", "infra/postgres/init", "infra/data", "docs"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "jsxQuoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  }
}
```

- [ ] **Step 5: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json", "package.json"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json", "package.json"],
      "outputs": []
    },
    "lint": {
      "inputs": ["src/**", "biome.json"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["build"],
      "inputs": ["src/**", "tests/**", "package.json"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 6: Create `lefthook.yml`**

```yaml
pre-commit:
  parallel: true
  commands:
    biome:
      glob: '*.{ts,tsx,js,jsx,json,jsonc}'
      run: pnpm exec biome check --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}

pre-push:
  commands:
    typecheck:
      run: pnpm typecheck
```

- [ ] **Step 7: Install dependencies**

Run: `pnpm install`
Expected: `pnpm` resolves and installs Biome, lefthook, Turbo, TypeScript. `prepare` script runs and installs lefthook git hooks. The output ends with no errors.

- [ ] **Step 8: Verify lefthook installed**

Run: `cat .git/hooks/pre-commit | head -5`
Expected: file exists and references `lefthook`.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json biome.json turbo.json lefthook.yml
git commit -m "Add workspace root configs (pnpm, turbo, tsconfig, biome, lefthook) [skip ci]"
```

---

## Task 3: Package — shared-types

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/index.ts`
- Create: `packages/shared-types/src/auth.ts`
- Create: `packages/shared-types/README.md`
- Create: `packages/shared-types/LICENSE`

- [ ] **Step 1: Create `packages/shared-types/package.json`**

```json
{
  "name": "@chatsundere/shared-types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "echo 'no tests yet for shared-types'"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/shared-types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared-types/src/auth.ts`**

```typescript
// SPDX-License-Identifier: MIT

/**
 * The set of user roles in Chatsundere. Exactly one user has the
 * `primary_admin` role at any given time (enforced by a partial unique
 * index in the auth-service database).
 */
export type UserRole = 'primary_admin' | 'admin' | 'user';

/**
 * The categories of authentication method a user may register. A single
 * user may have multiple methods; each one independently wraps the same
 * Master Key client-side.
 */
export type AuthMethodType = 'opaque' | 'passkey' | 'recovery_key';

/**
 * A one-time invitation token, issued by an admin, that binds a
 * pre-assigned username and role to a future registration event.
 */
export interface Invitation {
  id: string;
  username: string;
  role: UserRole;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedByUserId: string | null;
  revokedAt: string | null;
}

/**
 * Standard JWT claims issued by the auth-service for cross-service
 * authentication. The access token is short-lived (~15 min); refresh
 * tokens are opaque strings stored server-side.
 */
export interface JWTClaims {
  sub: string;
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
  iss: 'chatsundere-auth';
  aud: 'chatsundere-services' | string[];
}

/**
 * Uniform error envelope returned by every Chatsundere service.
 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}
```

- [ ] **Step 4: Create `packages/shared-types/src/index.ts`**

```typescript
// SPDX-License-Identifier: MIT

export type {
  UserRole,
  AuthMethodType,
  Invitation,
  JWTClaims,
  ErrorEnvelope,
} from './auth.js';
```

- [ ] **Step 5: Create `packages/shared-types/README.md`**

```markdown
# @chatsundere/shared-types

Wire-format TypeScript types shared between Chatsundere services and clients.

Pure type declarations — no runtime code. Safe to depend on from any side of
the wire (server, client, CLI, tests).

## Licence

MIT — see `LICENSE`.
```

- [ ] **Step 6: Create `packages/shared-types/LICENSE`**

```
This package is licensed under the MIT Licence.

See `../../LICENSE-MIT` at the repository root for the full text.
```

- [ ] **Step 7: Build and verify**

Run: `pnpm --filter @chatsundere/shared-types build`
Expected: tsc emits `dist/index.js`, `dist/index.d.ts`, `dist/auth.js`, `dist/auth.d.ts` with no errors.

Run: `pnpm --filter @chatsundere/shared-types typecheck`
Expected: completes silently.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-types
git commit -m "Add @chatsundere/shared-types package skeleton [skip ci]"
```

---

## Task 4: Package — crypto stubs

**Files:**
- Create: `packages/crypto/package.json`
- Create: `packages/crypto/tsconfig.json`
- Create: `packages/crypto/src/types.ts`
- Create: `packages/crypto/src/errors.ts`
- Create: `packages/crypto/src/stubs.ts`
- Create: `packages/crypto/src/index.ts`
- Create: `packages/crypto/SECURITY.md`
- Create: `packages/crypto/README.md`
- Create: `packages/crypto/LICENSE`

- [ ] **Step 1: Create `packages/crypto/package.json`**

```json
{
  "name": "@chatsundere/crypto",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "LGPL-3.0-only",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "SECURITY.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "echo 'no tests yet for crypto stubs'"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/crypto/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2023", "DOM"]
  },
  "include": ["src/**/*"]
}
```

(`DOM` lib is needed because the real crypto module will use WebCrypto's `SubtleCrypto` in browsers; the stubs do not, but the type surface should already permit it.)

- [ ] **Step 3: Create `packages/crypto/src/types.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * The current algorithm version. Bump when wrap or KDF parameters change
 * in an incompatible way; bumping requires a migration plan.
 */
export const ALGO_VERSION = 'v1';
export const WRAP_ALGO = 'AES-256-GCM';
export const HKDF_HASH = 'SHA-256';

declare const masterKeyBrand: unique symbol;
declare const amkBrand: unique symbol;
declare const dekBrand: unique symbol;
declare const recoveryKeyBrand: unique symbol;

/**
 * A 32-byte symmetric master key that protects every per-user secret.
 * Never persisted to disk, never sent to the server.
 */
export type MasterKey = Uint8Array & { readonly [masterKeyBrand]: 'MasterKey' };

/**
 * Auth-Method Key — derived from a specific auth method's secret and used
 * only to wrap/unwrap the MasterKey.
 */
export type AMK = Uint8Array & { readonly [amkBrand]: 'AMK' };

/**
 * Data Encryption Key — derived from the MasterKey for a specific
 * encryption context (e.g., 'vault/conversations').
 */
export type DEK = Uint8Array & { readonly [dekBrand]: 'DEK' };

/**
 * A 32-byte random key shown to the user once at registration. The user
 * stores it themselves; losing it loses access to data (no server-side
 * recovery exists by design).
 */
export type RecoveryKey = Uint8Array & { readonly [recoveryKeyBrand]: 'RecoveryKey' };

/**
 * A symmetrically-encrypted blob produced by wrapping a key with another key.
 */
export interface WrappedKey {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  algo: string;
}
```

- [ ] **Step 4: Create `packages/crypto/src/errors.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

export type CryptoErrorCode =
  | 'wrong_passphrase'
  | 'wrong_recovery_key'
  | 'passkey_not_available'
  | 'prf_not_supported'
  | 'corrupted_data'
  | 'expired_state'
  | 'invalid_recovery_key_format'
  | 'internal';

/**
 * The only error class exposed by @chatsundere/crypto. Carries a stable
 * machine-readable code; the human-readable message must never contain
 * cryptographic material.
 */
export class CryptoError extends Error {
  constructor(
    public readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}
```

- [ ] **Step 5: Create `packages/crypto/src/stubs.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from './errors.js';
import type { AMK, MasterKey, RecoveryKey, WrappedKey } from './types.js';

const NOT_IMPLEMENTED = 'Stub — implement in the crypto unit';

function stub(): never {
  throw new CryptoError('internal', NOT_IMPLEMENTED);
}

export async function generateMasterKey(): Promise<MasterKey> {
  return stub();
}

export async function generateRecoveryKey(): Promise<RecoveryKey> {
  return stub();
}

export function recoveryKeyToBase32(_key: RecoveryKey): string {
  return stub();
}

export function recoveryKeyFromBase32(_s: string): RecoveryKey {
  return stub();
}

export async function deriveAmkFromOpaqueExportKey(_exportKey: Uint8Array): Promise<AMK> {
  return stub();
}

export async function deriveAmkFromPrfOutput(_prfOutput: Uint8Array): Promise<AMK> {
  return stub();
}

export async function deriveAmkFromRecoveryKey(_rk: RecoveryKey): Promise<AMK> {
  return stub();
}

export async function wrapMasterKey(_mk: MasterKey, _amk: AMK): Promise<WrappedKey> {
  return stub();
}

export async function unwrapMasterKey(_wrapped: WrappedKey, _amk: AMK): Promise<MasterKey> {
  return stub();
}

export async function deriveMkProofValue(_mk: MasterKey): Promise<Uint8Array> {
  return stub();
}
```

- [ ] **Step 6: Create `packages/crypto/src/index.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

export { ALGO_VERSION, HKDF_HASH, WRAP_ALGO } from './types.js';
export type { AMK, DEK, MasterKey, RecoveryKey, WrappedKey } from './types.js';
export { CryptoError } from './errors.js';
export type { CryptoErrorCode } from './errors.js';
export {
  deriveAmkFromOpaqueExportKey,
  deriveAmkFromPrfOutput,
  deriveAmkFromRecoveryKey,
  deriveMkProofValue,
  generateMasterKey,
  generateRecoveryKey,
  recoveryKeyFromBase32,
  recoveryKeyToBase32,
  unwrapMasterKey,
  wrapMasterKey,
} from './stubs.js';
```

- [ ] **Step 7: Create `packages/crypto/SECURITY.md`**

```markdown
# Security — @chatsundere/crypto

> _This file is a skeleton. TBD — fill before merging the real crypto implementation in the crypto unit._

## Threat model

To be defined when the implementation lands. The library's purpose is to make
plaintext keys, passphrases, and recovery keys *inexpressible* on the server
side; the threat model section will document the trust boundary, the attacker
capabilities considered, and the explicitly-out-of-scope attacks.

## Key zeroing

JavaScript cannot guarantee buffer zeroing. The library will overwrite known
buffers on session close, but readers should understand this is best-effort.

## Reporting issues

Email Chris until a public disclosure process exists.
```

- [ ] **Step 8: Create `packages/crypto/README.md`**

```markdown
# @chatsundere/crypto

Client-side cryptographic foundation for Chatsundere: key derivation, master
key wrapping, OPAQUE client wrappers, WebAuthn PRF handling, recovery-key
encoding, and the MasterKeySession abstraction.

**This is Phase 0 — every export is a stub that throws `CryptoError('internal',
'Stub — implement in the crypto unit')`.** Real implementation lands in the
follow-on crypto unit (see `superpowers/specs/`).

## Licence

LGPL-3.0-only — see `LICENSE` and the repository root `LICENSE-LGPLv3`.
```

- [ ] **Step 9: Create `packages/crypto/LICENSE`**

```
This package is licensed under the GNU Lesser General Public Licence v3.0.

See `../../LICENSE-LGPLv3` at the repository root for the full text.
```

- [ ] **Step 10: Build and verify**

Run: `pnpm --filter @chatsundere/crypto build`
Expected: emits `dist/index.js`, `dist/index.d.ts`, plus `types`, `errors`, `stubs` artefacts. No errors.

Run: `node -e "import('@chatsundere/crypto').then(m => m.generateMasterKey()).catch(e => { console.log(e.name + ':' + e.code); process.exit(0); })"` from within `packages/crypto/`.
Expected: prints `CryptoError:internal`.

- [ ] **Step 11: Commit**

```bash
git add packages/crypto
git commit -m "Add @chatsundere/crypto stub package [skip ci]"
```

---

## Task 5: Package — llm-unified (empty)

**Files:**
- Create: `packages/llm-unified/package.json`
- Create: `packages/llm-unified/tsconfig.json`
- Create: `packages/llm-unified/src/index.ts`
- Create: `packages/llm-unified/README.md`
- Create: `packages/llm-unified/LICENSE`

- [ ] **Step 1: Create `packages/llm-unified/package.json`**

```json
{
  "name": "@chatsundere/llm-unified",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "LGPL-3.0-only",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "echo 'no tests yet for llm-unified'"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/llm-unified/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/llm-unified/src/index.ts`**

```typescript
// SPDX-License-Identifier: LGPL-3.0-only

// Provider adapters land in Phase 2+. This file exists so the workspace
// layout matches the brief from day one.
export {};
```

- [ ] **Step 4: Create `packages/llm-unified/README.md`**

```markdown
# @chatsundere/llm-unified

Provider adapters for upstream LLM services (Phase 2+). This package is
deliberately empty for now — it exists so the workspace layout matches the
phase-0 brief.

## Licence

LGPL-3.0-only — see `LICENSE` and the repository root `LICENSE-LGPLv3`.
```

- [ ] **Step 5: Create `packages/llm-unified/LICENSE`**

```
This package is licensed under the GNU Lesser General Public Licence v3.0.

See `../../LICENSE-LGPLv3` at the repository root for the full text.
```

- [ ] **Step 6: Build and verify**

Run: `pnpm --filter @chatsundere/llm-unified build`
Expected: emits `dist/index.js` (with an empty `export {}`) and `dist/index.d.ts`. No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-unified
git commit -m "Add @chatsundere/llm-unified placeholder package [skip ci]"
```

---

## Task 6: Backend Service — auth-service (TDD)

**Files:**
- Create: `apps/auth-service/package.json`
- Create: `apps/auth-service/tsconfig.json`
- Create: `apps/auth-service/.env.example`
- Create: `apps/auth-service/src/env.ts`
- Create: `apps/auth-service/src/logger.ts`
- Create: `apps/auth-service/src/metrics.ts`
- Create: `apps/auth-service/src/routes/health.ts`
- Create: `apps/auth-service/src/server.ts`
- Create: `apps/auth-service/src/index.ts`
- Create: `apps/auth-service/tests/health.test.ts`
- Create: `apps/auth-service/README.md`
- Create: `apps/auth-service/LICENSE`

- [ ] **Step 1: Create `apps/auth-service/package.json`**

```json
{
  "name": "@chatsundere/auth-service",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "build": "bun build src/index.ts --target=bun --outdir=dist",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "prom-client": "^15.1.0",
    "valibot": "^0.42.0"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `apps/auth-service/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["bun"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `apps/auth-service/.env.example`**

```
# Auth-service environment

NODE_ENV=development
PORT=3100
LOG_LEVEL=debug

# Postgres
DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db

# Redis
REDIS_URL=redis://localhost:6379/0

# JWT signing
JWT_ISSUER=chatsundere-auth
JWT_AUDIENCE=chatsundere-services
# JWT_PRIVATE_KEY_PEM=  (Ed25519 PEM; generated in auth-service unit)

# CORS — comma-separated origins
# CORS_ORIGINS=http://localhost:3000,http://localhost:3010
```

- [ ] **Step 4: Install dependencies into the workspace**

Run: `pnpm install`
Expected: dependencies resolve and link into `node_modules`. lefthook reinstalls (idempotent).

- [ ] **Step 5: Write the failing test — `apps/auth-service/tests/health.test.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { createServer } from '../src/server.js';

describe('auth-service health endpoints', () => {
  test('GET /healthz returns 200 ok', async () => {
    const app = createServer();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET /readyz returns 200 when env is valid', async () => {
    const app = createServer();
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; deps: Record<string, string> };
    expect(body.status).toBe('ok');
    expect(body.deps).toBeDefined();
  });

  test('GET /metrics returns Prometheus exposition', async () => {
    const app = createServer();
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('# TYPE');
  });
});
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `pnpm --filter @chatsundere/auth-service test`
Expected: FAIL with "Cannot find module '../src/server.js'" or equivalent.

- [ ] **Step 7: Create `apps/auth-service/src/env.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '3100'),
  LOG_LEVEL: v.optional(
    v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    'info',
  ),
  DATABASE_URL: v.string(),
  REDIS_URL: v.string(),
  JWT_ISSUER: v.optional(v.string(), 'chatsundere-auth'),
  JWT_AUDIENCE: v.optional(v.string(), 'chatsundere-services'),
});

export type Env = v.InferOutput<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return v.parse(EnvSchema, source);
}
```

- [ ] **Step 8: Create `apps/auth-service/src/logger.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import pino from 'pino';

export function createLogger(level: string, isDev: boolean) {
  return pino({
    level,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  });
}
```

- [ ] **Step 9: Create `apps/auth-service/src/metrics.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { collectDefaultMetrics, register } from 'prom-client';

let initialised = false;

export function initialiseMetrics(): void {
  if (initialised) return;
  collectDefaultMetrics({ register, prefix: 'auth_' });
  initialised = true;
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return { body: await register.metrics(), contentType: register.contentType };
}
```

- [ ] **Step 10: Create `apps/auth-service/src/routes/health.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { renderMetrics } from '../metrics.js';

export function registerHealthRoutes(app: Hono): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', async (c) => {
    // Phase 0: env presence is the only signal. Real DB and Redis pings
    // arrive with the auth-service implementation unit.
    const deps: Record<string, 'ok' | 'unknown'> = {
      database: 'unknown',
      redis: 'unknown',
    };
    return c.json({ status: 'ok', deps });
  });

  app.get('/metrics', async (c) => {
    const { body, contentType } = await renderMetrics();
    c.header('content-type', contentType);
    return c.body(body);
  });
}
```

- [ ] **Step 11: Create `apps/auth-service/src/server.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { initialiseMetrics } from './metrics.js';
import { registerHealthRoutes } from './routes/health.js';

export function createServer(): Hono {
  initialiseMetrics();
  const app = new Hono();
  registerHealthRoutes(app);
  return app;
}
```

- [ ] **Step 12: Create `apps/auth-service/src/index.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const app = createServer();

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

logger.info({ port: server.port }, 'auth-service listening');
```

- [ ] **Step 13: Run tests and confirm they pass**

Run: `pnpm --filter @chatsundere/auth-service test`
Expected: 3 tests pass. Output ends with `0 fail`.

Set required env for the test run: the test uses `createServer()` directly, which does not read env. `loadEnv()` is only called from `index.ts`. So tests pass without `DATABASE_URL` etc. ✓

- [ ] **Step 14: Smoke-test the binary**

Run from `apps/auth-service/`:

```bash
DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db \
REDIS_URL=redis://localhost:6379/0 \
PORT=3100 \
bun src/index.ts &
sleep 1
curl -s http://localhost:3100/healthz
curl -s http://localhost:3100/readyz
curl -s http://localhost:3100/metrics | head -5
kill %1
```

Expected: `{"status":"ok"}`, `{"status":"ok","deps":{...}}`, then Prometheus `# HELP` / `# TYPE` lines.

- [ ] **Step 15: Create `apps/auth-service/README.md`**

```markdown
# @chatsundere/auth-service

Authentication service for Chatsundere. Phase 0 is a skeleton exposing only
`/healthz`, `/readyz`, and `/metrics` on port 3100. Real OPAQUE registration,
WebAuthn passkey support, JWT issuance, recovery, and admin endpoints arrive
in the auth-service implementation unit.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/auth-service dev
```

## Endpoints (Phase 0)

- `GET /healthz` — liveness, always 200.
- `GET /readyz` — readiness; placeholder until real probes land.
- `GET /metrics` — Prometheus exposition (default Node metrics with `auth_` prefix).

## Licence

AGPL-3.0-only — see `LICENSE` and the repository root `LICENSE-AGPLv3`.
```

- [ ] **Step 16: Create `apps/auth-service/LICENSE`**

```
This service is licensed under the GNU Affero General Public Licence v3.0.

See `../../LICENSE-AGPLv3` at the repository root for the full text.
```

- [ ] **Step 17: Commit**

```bash
git add apps/auth-service pnpm-lock.yaml
git commit -m "Add auth-service stub with health/ready/metrics endpoints [skip ci]"
```

---

## Task 7: Backend Service — sync-service

**Note:** This task creates files identical in structure to Task 6, with the
following explicit differences:

- Package name `@chatsundere/sync-service`
- Default port `3200`
- `.env.example` references `sync_db` instead of `auth_db` and adds commented Phase-1 placeholders
- `metrics.ts` uses prefix `sync_` instead of `auth_`
- All source files repeat the Task 6 content verbatim with these substitutions

**Files:**
- Create: `apps/sync-service/package.json`
- Create: `apps/sync-service/tsconfig.json`
- Create: `apps/sync-service/.env.example`
- Create: `apps/sync-service/src/env.ts`
- Create: `apps/sync-service/src/logger.ts` (identical to auth-service)
- Create: `apps/sync-service/src/metrics.ts`
- Create: `apps/sync-service/src/routes/health.ts` (identical to auth-service)
- Create: `apps/sync-service/src/server.ts` (identical to auth-service)
- Create: `apps/sync-service/src/index.ts` (identical to auth-service except service name in log line)
- Create: `apps/sync-service/tests/health.test.ts` (identical to auth-service)
- Create: `apps/sync-service/README.md`
- Create: `apps/sync-service/LICENSE`

- [ ] **Step 1: Create `apps/sync-service/package.json`**

```json
{
  "name": "@chatsundere/sync-service",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "build": "bun build src/index.ts --target=bun --outdir=dist",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "prom-client": "^15.1.0",
    "valibot": "^0.42.0"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `apps/sync-service/tsconfig.json`** (identical to Task 6 Step 2)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["bun"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `apps/sync-service/.env.example`**

```
# Sync-service environment

NODE_ENV=development
PORT=3200
LOG_LEVEL=debug

# Postgres
DATABASE_URL=postgres://chatsundere:dev@localhost:5432/sync_db

# Redis
REDIS_URL=redis://localhost:6379/1

# JWT verification (the auth-service's public key, fetched from JWKS in Phase 1)
JWT_ISSUER=chatsundere-auth
JWT_AUDIENCE=chatsundere-services
AUTH_JWKS_URL=http://localhost:3100/v1/jwks

# Phase 1 — encrypted vault storage backend (S3-compatible, commented for Phase 0)
# S3_ENDPOINT=
# S3_REGION=
# S3_BUCKET=
# S3_ACCESS_KEY_ID=
# S3_SECRET_ACCESS_KEY=
```

- [ ] **Step 4: Create `apps/sync-service/src/env.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '3200'),
  LOG_LEVEL: v.optional(
    v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    'info',
  ),
  DATABASE_URL: v.string(),
  REDIS_URL: v.string(),
  JWT_ISSUER: v.optional(v.string(), 'chatsundere-auth'),
  JWT_AUDIENCE: v.optional(v.string(), 'chatsundere-services'),
  AUTH_JWKS_URL: v.string(),
});

export type Env = v.InferOutput<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return v.parse(EnvSchema, source);
}
```

- [ ] **Step 5: Create `apps/sync-service/src/logger.ts`** (identical content)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import pino from 'pino';

export function createLogger(level: string, isDev: boolean) {
  return pino({
    level,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  });
}
```

- [ ] **Step 6: Create `apps/sync-service/src/metrics.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { collectDefaultMetrics, register } from 'prom-client';

let initialised = false;

export function initialiseMetrics(): void {
  if (initialised) return;
  collectDefaultMetrics({ register, prefix: 'sync_' });
  initialised = true;
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return { body: await register.metrics(), contentType: register.contentType };
}
```

- [ ] **Step 7: Create `apps/sync-service/src/routes/health.ts`** (identical content to Task 6 Step 10)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { renderMetrics } from '../metrics.js';

export function registerHealthRoutes(app: Hono): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', async (c) => {
    const deps: Record<string, 'ok' | 'unknown'> = {
      database: 'unknown',
      redis: 'unknown',
    };
    return c.json({ status: 'ok', deps });
  });

  app.get('/metrics', async (c) => {
    const { body, contentType } = await renderMetrics();
    c.header('content-type', contentType);
    return c.body(body);
  });
}
```

- [ ] **Step 8: Create `apps/sync-service/src/server.ts`** (identical to Task 6 Step 11)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { initialiseMetrics } from './metrics.js';
import { registerHealthRoutes } from './routes/health.js';

export function createServer(): Hono {
  initialiseMetrics();
  const app = new Hono();
  registerHealthRoutes(app);
  return app;
}
```

- [ ] **Step 9: Create `apps/sync-service/src/index.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const app = createServer();

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

logger.info({ port: server.port }, 'sync-service listening');
```

- [ ] **Step 10: Create `apps/sync-service/tests/health.test.ts`** (identical to Task 6 Step 5)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { createServer } from '../src/server.js';

describe('sync-service health endpoints', () => {
  test('GET /healthz returns 200 ok', async () => {
    const app = createServer();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET /readyz returns 200 when env is valid', async () => {
    const app = createServer();
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; deps: Record<string, string> };
    expect(body.status).toBe('ok');
    expect(body.deps).toBeDefined();
  });

  test('GET /metrics returns Prometheus exposition', async () => {
    const app = createServer();
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('# TYPE');
  });
});
```

- [ ] **Step 11: Create `apps/sync-service/README.md`**

```markdown
# @chatsundere/sync-service

Encrypted-vault sync backend. Phase 0 is a skeleton exposing only `/healthz`,
`/readyz`, and `/metrics` on port 3200. The real implementation (encrypted
blob storage, conflict-free updates) lands in Phase 1.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/sync-service dev
```

## Licence

AGPL-3.0-only — see `LICENSE`.
```

- [ ] **Step 12: Create `apps/sync-service/LICENSE`**

```
This service is licensed under the GNU Affero General Public Licence v3.0.

See `../../LICENSE-AGPLv3` at the repository root for the full text.
```

- [ ] **Step 13: Install, test, and commit**

Run: `pnpm install`
Then: `pnpm --filter @chatsundere/sync-service test`
Expected: 3 tests pass.

```bash
git add apps/sync-service pnpm-lock.yaml
git commit -m "Add sync-service stub with health/ready/metrics endpoints [skip ci]"
```

---

## Task 8: Backend Service — proxy-service

**Note:** Same structure as Tasks 6 and 7 with these differences:

- Package name `@chatsundere/proxy-service`
- Default port `3300`
- `.env.example` adds commented Phase-2 provider API-key placeholders
- `metrics.ts` uses prefix `proxy_`

**Files:** same five `src/` files, same `tests/health.test.ts`, plus package.json, tsconfig.json, .env.example, README.md, LICENSE.

- [ ] **Step 1: Create `apps/proxy-service/package.json`** (identical to Task 7 Step 1 with name `@chatsundere/proxy-service`)

```json
{
  "name": "@chatsundere/proxy-service",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "build": "bun build src/index.ts --target=bun --outdir=dist",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "prom-client": "^15.1.0",
    "valibot": "^0.42.0"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `apps/proxy-service/tsconfig.json`** (identical to Task 6 Step 2)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["bun"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `apps/proxy-service/.env.example`**

```
# Proxy-service environment

NODE_ENV=development
PORT=3300
LOG_LEVEL=debug

# Postgres — proxy_db is created lazily when proxy-service ships its real schema
DATABASE_URL=postgres://chatsundere:dev@localhost:5432/proxy_db

# Redis
REDIS_URL=redis://localhost:6379/2

# JWT verification
JWT_ISSUER=chatsundere-auth
JWT_AUDIENCE=chatsundere-services
AUTH_JWKS_URL=http://localhost:3100/v1/jwks

# Phase 2+ — upstream provider API keys (commented; injected per-deployment)
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
# OPENROUTER_API_KEY=
# XAI_API_KEY=
# MISTRAL_API_KEY=
```

- [ ] **Step 4: Create `apps/proxy-service/src/env.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const EnvSchema = v.object({
  NODE_ENV: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
  PORT: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '3300'),
  LOG_LEVEL: v.optional(
    v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    'info',
  ),
  DATABASE_URL: v.string(),
  REDIS_URL: v.string(),
  JWT_ISSUER: v.optional(v.string(), 'chatsundere-auth'),
  JWT_AUDIENCE: v.optional(v.string(), 'chatsundere-services'),
  AUTH_JWKS_URL: v.string(),
});

export type Env = v.InferOutput<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return v.parse(EnvSchema, source);
}
```

- [ ] **Step 5: Create `apps/proxy-service/src/logger.ts`** (verbatim copy of Task 6 Step 8)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import pino from 'pino';

export function createLogger(level: string, isDev: boolean) {
  return pino({
    level,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  });
}
```

- [ ] **Step 6: Create `apps/proxy-service/src/metrics.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { collectDefaultMetrics, register } from 'prom-client';

let initialised = false;

export function initialiseMetrics(): void {
  if (initialised) return;
  collectDefaultMetrics({ register, prefix: 'proxy_' });
  initialised = true;
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return { body: await register.metrics(), contentType: register.contentType };
}
```

- [ ] **Step 7: Create `apps/proxy-service/src/routes/health.ts`** (verbatim copy of Task 6 Step 10)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { renderMetrics } from '../metrics.js';

export function registerHealthRoutes(app: Hono): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', async (c) => {
    const deps: Record<string, 'ok' | 'unknown'> = {
      database: 'unknown',
      redis: 'unknown',
    };
    return c.json({ status: 'ok', deps });
  });

  app.get('/metrics', async (c) => {
    const { body, contentType } = await renderMetrics();
    c.header('content-type', contentType);
    return c.body(body);
  });
}
```

- [ ] **Step 8: Create `apps/proxy-service/src/server.ts`** (verbatim copy of Task 6 Step 11)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { Hono } from 'hono';
import { initialiseMetrics } from './metrics.js';
import { registerHealthRoutes } from './routes/health.js';

export function createServer(): Hono {
  initialiseMetrics();
  const app = new Hono();
  registerHealthRoutes(app);
  return app;
}
```

- [ ] **Step 9: Create `apps/proxy-service/src/index.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const app = createServer();

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

logger.info({ port: server.port }, 'proxy-service listening');
```

- [ ] **Step 10: Create `apps/proxy-service/tests/health.test.ts`** (identical to Task 6 Step 5 with the describe block renamed)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { createServer } from '../src/server.js';

describe('proxy-service health endpoints', () => {
  test('GET /healthz returns 200 ok', async () => {
    const app = createServer();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET /readyz returns 200 when env is valid', async () => {
    const app = createServer();
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; deps: Record<string, string> };
    expect(body.status).toBe('ok');
    expect(body.deps).toBeDefined();
  });

  test('GET /metrics returns Prometheus exposition', async () => {
    const app = createServer();
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('# TYPE');
  });
});
```

- [ ] **Step 11: Create `apps/proxy-service/README.md`**

```markdown
# @chatsundere/proxy-service

Authenticated CORS proxy that forwards user requests to upstream LLM
providers. Phase 0 is a skeleton with `/healthz`, `/readyz`, `/metrics`
on port 3300. The real implementation arrives in Phase 2 alongside
`@chatsundere/llm-unified`.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/proxy-service dev
```

## Licence

AGPL-3.0-only — see `LICENSE`.
```

- [ ] **Step 12: Create `apps/proxy-service/LICENSE`**

```
This service is licensed under the GNU Affero General Public Licence v3.0.

See `../../LICENSE-AGPLv3` at the repository root for the full text.
```

- [ ] **Step 13: Install, test, and commit**

Run: `pnpm install`
Then: `pnpm --filter @chatsundere/proxy-service test`
Expected: 3 tests pass.

```bash
git add apps/proxy-service pnpm-lock.yaml
git commit -m "Add proxy-service stub with health/ready/metrics endpoints [skip ci]"
```

---

## Task 9: Frontend — user-client

**Files:**
- Create: `apps/user-client/package.json`
- Create: `apps/user-client/tsconfig.json`
- Create: `apps/user-client/tsconfig.node.json`
- Create: `apps/user-client/vite.config.ts`
- Create: `apps/user-client/tailwind.config.ts`
- Create: `apps/user-client/index.html`
- Create: `apps/user-client/public/favicon.svg`
- Create: `apps/user-client/.env.example`
- Create: `apps/user-client/src/main.tsx`
- Create: `apps/user-client/src/App.tsx`
- Create: `apps/user-client/src/index.css`
- Create: `apps/user-client/src/env.ts`
- Create: `apps/user-client/README.md`
- Create: `apps/user-client/LICENSE`

- [ ] **Step 1: Create `apps/user-client/package.json`**

```json
{
  "name": "@chatsundere/user-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "echo 'no tests yet for user-client'"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "valibot": "^0.42.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/user-client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src/**/*"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `apps/user-client/tsconfig.node.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"],
    "noEmit": true,
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `apps/user-client/vite.config.ts`**

```typescript
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    strictPort: true,
  },
});
```

- [ ] **Step 5: Create `apps/user-client/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

// Tailwind v4 is zero-config; this file is a placeholder so future theme
// extensions (custom tokens, breakpoints, fonts) have a clear home.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
};

export default config;
```

- [ ] **Step 6: Create `apps/user-client/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#050210" />
    <title>Chatsundere</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="preload"
      as="style"
      href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
    />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `apps/user-client/public/favicon.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#050210" />
  <text x="50" y="72" font-family="serif" font-size="64" text-anchor="middle" fill="#ffd56b">C</text>
</svg>
```

- [ ] **Step 8: Create `apps/user-client/.env.example`**

```
# user-client environment (Vite — only VITE_* vars are exposed to client code)

VITE_AUTH_URL=http://localhost:3100
VITE_SYNC_URL=http://localhost:3200
VITE_PROXY_URL=http://localhost:3300
```

- [ ] **Step 9: Create `apps/user-client/src/env.ts`**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const EnvSchema = v.object({
  VITE_AUTH_URL: v.pipe(v.string(), v.url()),
  VITE_SYNC_URL: v.pipe(v.string(), v.url()),
  VITE_PROXY_URL: v.pipe(v.string(), v.url()),
});

export const env = v.parse(EnvSchema, import.meta.env);
```

- [ ] **Step 10: Create `apps/user-client/src/index.css`**

```css
@import 'tailwindcss';

:root {
  font-family: 'Instrument Serif', Georgia, serif;
}

body {
  background: #050210;
  color: #e8e6f5;
}
```

- [ ] **Step 11: Create `apps/user-client/src/App.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

export function App() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <h1 className="font-serif text-4xl italic tracking-tight md:text-6xl">Chatsundere</h1>
    </main>
  );
}
```

- [ ] **Step 12: Create `apps/user-client/src/main.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 13: Create `apps/user-client/README.md`**

```markdown
# @chatsundere/user-client

Mobile-first PWA client for Chatsundere. Phase 0 is a single `<h1>`; routing,
auth flows, conversation UI, and crypto wiring arrive in later units.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/user-client dev
```

Opens on `http://localhost:3000`.

## Licence

AGPL-3.0-only — see `LICENSE`.
```

- [ ] **Step 14: Create `apps/user-client/LICENSE`**

```
This client is licensed under the GNU Affero General Public Licence v3.0.

See `../../LICENSE-AGPLv3` at the repository root for the full text.
```

- [ ] **Step 15: Install, build, and smoke-test**

Run: `pnpm install`

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: no errors.

Run: `pnpm --filter @chatsundere/user-client build`
Expected: Vite emits `dist/index.html` and an asset bundle without errors.

Smoke test:
```bash
VITE_AUTH_URL=http://localhost:3100 \
VITE_SYNC_URL=http://localhost:3200 \
VITE_PROXY_URL=http://localhost:3300 \
pnpm --filter @chatsundere/user-client dev &
sleep 3
curl -s http://localhost:3000 | grep -o 'Chatsundere'
kill %1
```
Expected: prints `Chatsundere` (matched in the index.html title or React-rendered fallback).

- [ ] **Step 16: Commit**

```bash
git add apps/user-client pnpm-lock.yaml
git commit -m "Add user-client Vite + React + Tailwind stub [skip ci]"
```

---

## Task 10: Frontend — admin-client

**Note:** Same shape as user-client (Task 9) with these differences:
- Package name `@chatsundere/admin-client`
- Vite port `3010`
- `index.html` does NOT preload Instrument Serif; uses sans-serif system stack
- `index.css` sets a Catppuccin Mocha base background (#1e1e2e text #cdd6f4)
- `App.tsx` uses `font-sans`

**Files:** parallel to Task 9.

- [ ] **Step 1: Create `apps/admin-client/package.json`**

```json
{
  "name": "@chatsundere/admin-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "echo 'no tests yet for admin-client'"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "valibot": "^0.42.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/admin-client/tsconfig.json`** (identical to Task 9 Step 2)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src/**/*"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `apps/admin-client/tsconfig.node.json`** (identical to Task 9 Step 3)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"],
    "noEmit": true,
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `apps/admin-client/vite.config.ts`**

```typescript
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3010,
    strictPort: true,
  },
});
```

- [ ] **Step 5: Create `apps/admin-client/tailwind.config.ts`** (identical to Task 9 Step 5)

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
};

export default config;
```

- [ ] **Step 6: Create `apps/admin-client/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#1e1e2e" />
    <title>Chatsundere · Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `apps/admin-client/public/favicon.svg`** (identical to Task 9 Step 7)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#050210" />
  <text x="50" y="72" font-family="serif" font-size="64" text-anchor="middle" fill="#ffd56b">C</text>
</svg>
```

- [ ] **Step 8: Create `apps/admin-client/.env.example`** (identical to Task 9 Step 8)

```
# admin-client environment (Vite — only VITE_* vars are exposed to client code)

VITE_AUTH_URL=http://localhost:3100
VITE_SYNC_URL=http://localhost:3200
VITE_PROXY_URL=http://localhost:3300
```

- [ ] **Step 9: Create `apps/admin-client/src/env.ts`** (identical to Task 9 Step 9)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

const EnvSchema = v.object({
  VITE_AUTH_URL: v.pipe(v.string(), v.url()),
  VITE_SYNC_URL: v.pipe(v.string(), v.url()),
  VITE_PROXY_URL: v.pipe(v.string(), v.url()),
});

export const env = v.parse(EnvSchema, import.meta.env);
```

- [ ] **Step 10: Create `apps/admin-client/src/index.css`**

```css
@import 'tailwindcss';

:root {
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

body {
  /* Catppuccin Mocha — base + text */
  background: #1e1e2e;
  color: #cdd6f4;
}
```

- [ ] **Step 11: Create `apps/admin-client/src/App.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

export function App() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <h1 className="font-sans text-3xl font-medium tracking-tight md:text-5xl">
        Chatsundere · Admin
      </h1>
    </main>
  );
}
```

- [ ] **Step 12: Create `apps/admin-client/src/main.tsx`** (identical structure)

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 13: Create `apps/admin-client/README.md`**

```markdown
# @chatsundere/admin-client

Admin UI for Chatsundere. Phase 0 is a single `<h1>`. User management,
invitation creation, suspensions, primary-admin transfer arrive in the
admin-client wiring unit.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/admin-client dev
```

Opens on `http://localhost:3010`.

## Licence

AGPL-3.0-only — see `LICENSE`.
```

- [ ] **Step 14: Create `apps/admin-client/LICENSE`**

```
This client is licensed under the GNU Affero General Public Licence v3.0.

See `../../LICENSE-AGPLv3` at the repository root for the full text.
```

- [ ] **Step 15: Install, typecheck, build, smoke-test**

Run: `pnpm install`
Run: `pnpm --filter @chatsundere/admin-client typecheck` — no errors expected.
Run: `pnpm --filter @chatsundere/admin-client build` — Vite emits dist artefacts.

```bash
VITE_AUTH_URL=http://localhost:3100 \
VITE_SYNC_URL=http://localhost:3200 \
VITE_PROXY_URL=http://localhost:3300 \
pnpm --filter @chatsundere/admin-client dev &
sleep 3
curl -s http://localhost:3010 | grep -o 'Chatsundere'
kill %1
```
Expected: prints `Chatsundere` once.

- [ ] **Step 16: Commit**

```bash
git add apps/admin-client pnpm-lock.yaml
git commit -m "Add admin-client Vite + React + Tailwind stub [skip ci]"
```

---

## Task 11: Infrastructure — Compose Dev + Postgres Init

**Files:**
- Create: `infra/compose.dev.yml`
- Create: `infra/postgres/init/01-create-databases.sh`

- [ ] **Step 1: Create `infra/compose.dev.yml`**

```yaml
name: chatsundere-dev

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: chatsundere
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: auth_db
    ports:
      - '5432:5432'
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'chatsundere', '-d', 'auth_db']
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      - chatsundere-dev

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ['redis-server', '--appendonly', 'yes']
    ports:
      - '6379:6379'
    volumes:
      - ./data/redis:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      - chatsundere-dev

  prometheus:
    image: prom/prometheus:latest
    restart: unless-stopped
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
    ports:
      - '9090:9090'
    volumes:
      - ./data/prometheus:/prometheus
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:9090/-/healthy']
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - chatsundere-dev

  grafana:
    image: grafana/grafana:latest
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_USERS_ALLOW_SIGN_UP: 'false'
    ports:
      - '3001:3000'
    volumes:
      - ./data/grafana:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
    depends_on:
      prometheus:
        condition: service_healthy
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/api/health || exit 1']
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - chatsundere-dev

networks:
  chatsundere-dev:
    driver: bridge
```

- [ ] **Step 2: Create `infra/postgres/init/01-create-databases.sh`**

```bash
#!/usr/bin/env bash
# Runs on first container start (when /var/lib/postgresql/data is empty).
#
# Creates the per-service databases owned by the `chatsundere` user.
# auth_db is the only one we need in Phase 0; sync_db and proxy_db are
# added here when their services come online.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    -- auth_db already exists (created via POSTGRES_DB env), but ensuring is cheap.
    SELECT 'CREATE DATABASE auth_db OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec

    -- Phase 1: uncomment when sync-service ships its real schema.
    -- CREATE DATABASE sync_db OWNER chatsundere;

    -- Phase 2: uncomment when proxy-service ships its real schema.
    -- CREATE DATABASE proxy_db OWNER chatsundere;
EOSQL
```

Mark executable: `chmod +x infra/postgres/init/01-create-databases.sh`

- [ ] **Step 3: Validate compose syntax**

Run: `docker compose -f infra/compose.dev.yml config --quiet`
Expected: no output (successful validation).

- [ ] **Step 4: Commit (without starting yet — Prometheus config arrives next)**

```bash
git add infra/compose.dev.yml infra/postgres/init/01-create-databases.sh
git commit -m "Add dev compose stack (Postgres, Redis, Prometheus, Grafana) [skip ci]"
```

---

## Task 12: Infrastructure — Prometheus + Grafana Provisioning

**Files:**
- Create: `infra/prometheus/prometheus.yml`
- Create: `infra/grafana/provisioning/datasources/prometheus.yml`

- [ ] **Step 1: Create `infra/prometheus/prometheus.yml`**

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'auth-service'
    metrics_path: /metrics
    static_configs:
      - targets: ['host.docker.internal:3100']

  - job_name: 'sync-service'
    metrics_path: /metrics
    static_configs:
      - targets: ['host.docker.internal:3200']

  - job_name: 'proxy-service'
    metrics_path: /metrics
    static_configs:
      - targets: ['host.docker.internal:3300']
```

- [ ] **Step 2: Create `infra/grafana/provisioning/datasources/prometheus.yml`**

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
```

- [ ] **Step 3: Start the stack and confirm health**

Run:
```bash
cd infra
mkdir -p data
docker compose -f compose.dev.yml up -d
sleep 15
docker compose -f compose.dev.yml ps
cd ..
```
Expected: all four containers `healthy` (postgres, redis, prometheus, grafana).

- [ ] **Step 4: Verify each service**

Run:
```bash
curl -s http://localhost:9090/-/healthy
echo
curl -s http://localhost:3001/api/health
echo
docker exec -i $(docker compose -f infra/compose.dev.yml ps -q postgres) pg_isready -U chatsundere -d auth_db
docker exec -i $(docker compose -f infra/compose.dev.yml ps -q redis) redis-cli ping
```
Expected:
- `Prometheus Server is Healthy.`
- `{"database":"ok","version":"...","commit":"..."}` from Grafana
- `/var/run/postgresql:5432 - accepting connections`
- `PONG`

- [ ] **Step 5: Verify Prometheus discovered scrape targets**

Run: `curl -s http://localhost:9090/api/v1/targets | grep -o '"job":"[^"]*"' | sort -u`
Expected: includes `"job":"prometheus"`, `"job":"auth-service"`, `"job":"sync-service"`, `"job":"proxy-service"`.

- [ ] **Step 6: Verify Grafana datasource provisioned**

Run: `curl -s -u admin:admin http://localhost:3001/api/datasources | grep -o '"name":"[^"]*"'`
Expected: `"name":"Prometheus"`.

- [ ] **Step 7: Tear down before committing**

Run: `docker compose -f infra/compose.dev.yml down`

- [ ] **Step 8: Commit**

```bash
git add infra/prometheus infra/grafana
git commit -m "Add Prometheus scrape config and Grafana datasource provisioning [skip ci]"
```

---

## Task 13: Infrastructure — Production Compose Example

**Files:**
- Create: `infra/compose.prod.yml.example`

- [ ] **Step 1: Create `infra/compose.prod.yml.example`**

```yaml
# Production Chatsundere stack — example.
#
# Copy this file to `compose.prod.yml` and fill in the environment variables
# below. Do NOT commit `compose.prod.yml`.
#
# Deployment target: a single Hetzner VPS running Docker + Traefik.
# All public ingress goes through Traefik; only Traefik exposes ports 80/443
# on the host. Postgres and Redis are not published to the host at all.
#
# Required environment variables (export before `docker compose up -d`):
#
#   POSTGRES_USER, POSTGRES_PASSWORD
#   GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD
#   TRAEFIK_HOST_PROMETHEUS  (e.g. prometheus.chatsundere.app)
#   TRAEFIK_HOST_GRAFANA     (e.g. grafana.chatsundere.app)
#   TRAEFIK_AUTH_USERS       (htpasswd-format, e.g. user:$apr1$...)

name: chatsundere-prod

services:
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: auth_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', '${POSTGRES_USER}', '-d', 'auth_db']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - chatsundere

  redis:
    image: redis:7-alpine
    restart: always
    command: ['redis-server', '--appendonly', 'yes']
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - chatsundere

  prometheus:
    image: prom/prometheus:latest
    restart: always
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    volumes:
      - prometheus_data:/prometheus
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    labels:
      traefik.enable: 'true'
      traefik.http.routers.prometheus.rule: Host(`${TRAEFIK_HOST_PROMETHEUS}`)
      traefik.http.routers.prometheus.entrypoints: websecure
      traefik.http.routers.prometheus.tls.certresolver: letsencrypt
      traefik.http.routers.prometheus.middlewares: prometheus-auth
      traefik.http.middlewares.prometheus-auth.basicauth.users: ${TRAEFIK_AUTH_USERS}
      traefik.http.services.prometheus.loadbalancer.server.port: '9090'
    networks:
      - chatsundere
      - traefik

  grafana:
    image: grafana/grafana:latest
    restart: always
    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}
      GF_USERS_ALLOW_SIGN_UP: 'false'
      GF_SERVER_ROOT_URL: https://${TRAEFIK_HOST_GRAFANA}
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
    depends_on:
      prometheus:
        condition: service_healthy
    labels:
      traefik.enable: 'true'
      traefik.http.routers.grafana.rule: Host(`${TRAEFIK_HOST_GRAFANA}`)
      traefik.http.routers.grafana.entrypoints: websecure
      traefik.http.routers.grafana.tls.certresolver: letsencrypt
      traefik.http.services.grafana.loadbalancer.server.port: '3000'
    networks:
      - chatsundere
      - traefik

volumes:
  postgres_data:
  redis_data:
  prometheus_data:
  grafana_data:

networks:
  chatsundere:
    driver: bridge
  traefik:
    external: true
```

- [ ] **Step 2: Validate (with a fake env file) that the syntax is acceptable**

Run:
```bash
POSTGRES_USER=u POSTGRES_PASSWORD=p \
GRAFANA_ADMIN_USER=admin GRAFANA_ADMIN_PASSWORD=pw \
TRAEFIK_HOST_PROMETHEUS=p.example TRAEFIK_HOST_GRAFANA=g.example \
TRAEFIK_AUTH_USERS='user:$apr1$xxx' \
docker compose -f infra/compose.prod.yml.example config --quiet
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add infra/compose.prod.yml.example
git commit -m "Add production compose example with Traefik labels [skip ci]"
```

---

## Task 14: scripts/setup-dev.sh

**Files:**
- Create: `scripts/setup-dev.sh`

- [ ] **Step 1: Create `scripts/setup-dev.sh`**

```bash
#!/usr/bin/env bash
# Local dev environment bootstrap for Chatsundere.
#
# Idempotent: re-run safely. Existing .env files are left alone.
# To reset: delete the relevant .env files and re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

apps=(auth-service sync-service proxy-service user-client admin-client)

for app in "${apps[@]}"; do
  example="apps/${app}/.env.example"
  env_file="apps/${app}/.env"
  if [[ ! -f "$example" ]]; then
    echo "✗ ${example} not found — is this the project root?" >&2
    exit 1
  fi
  if [[ -f "$env_file" ]]; then
    echo "✓ ${env_file} exists — leaving it alone."
  else
    cp "$example" "$env_file"
    echo "✓ Created ${env_file}"
  fi
done

mkdir -p infra/data
echo "✓ Ensured infra/data/ exists (Docker creates per-service subdirs)"

echo ""
echo "=== Dev setup complete ==="
echo ""
echo "Next steps:"
echo "  1. direnv allow                                # if direnv is installed"
echo "  2. docker compose -f infra/compose.dev.yml up -d"
echo "  3. pnpm install                                # if not already done"
echo "  4. pnpm dev                                    # starts all services + clients"
```

Mark executable: `chmod +x scripts/setup-dev.sh`

- [ ] **Step 2: Verify shell syntax**

Run: `bash -n scripts/setup-dev.sh`
Expected: no output.

- [ ] **Step 3: Run it twice to confirm idempotency**

Run: `./scripts/setup-dev.sh`
Expected: five `✓ Created apps/.../.env` lines, then `✓ Ensured infra/data/ exists`, then setup-complete block.

Run: `./scripts/setup-dev.sh`
Expected: five `✓ exists — leaving it alone` lines (idempotent), then the rest as before.

- [ ] **Step 4: Verify .env files are gitignored**

Run: `git status --short apps/*/.env`
Expected: empty (no files listed — they are ignored).

- [ ] **Step 5: Commit**

```bash
git add scripts/setup-dev.sh
git commit -m "Add idempotent setup-dev.sh bootstrap script [skip ci]"
```

---

## Task 15: Markdown Documentation in obsidian/

**Files:**
- Create: `obsidian/ARCHITECTURE.md`
- Create: `obsidian/ONBOARDING.md`

- [ ] **Step 1: Create `obsidian/ARCHITECTURE.md`**

```markdown
# Chatsundere Architecture

> _Skeleton. Each section is filled when the service or subsystem it describes lands._

## Overview & Mission

_To be filled when the first end-to-end flow exists. Anchor: zero-knowledge AI companion, OPAQUE + WebAuthn-PRF authentication, local-first vault, self-hostable backend._

## Services & Boundaries

_To be filled with the deployment diagram, port map, and JWT trust topology once `auth-service` ships._

## Crypto Model

_To be filled with the AMK/MK/DEK derivation graph and the wrap chain once `packages/crypto` ships. See `obsidian/briefs/phase 0/crypto.md` for the design intent._

## Data Flow

_To be filled per service: registration, login, recovery, vault sync, proxy request._

## Threat Model

_To be filled. Anchors: zero-knowledge backend, untrusted-server assumption, recovery-key irrecoverability by design._

## Deployment Topology

_To be filled. Anchors: Hetzner VPS, Docker Compose, Traefik, Let's Encrypt._
```

- [ ] **Step 2: Create `obsidian/ONBOARDING.md`**

```markdown
# Chatsundere — Onboarding

Welcome. This is for anyone (human or Claude instance) joining Chatsundere work for the first time.

## Read first

1. `CLAUDE.md` (repository root) — operating rules.
2. `obsidian/briefs/` — Lyra's design briefs (start with `phase 0/project-setup.md`).
3. `obsidian/decisions/` — Architectural Decision Records.

## Prerequisites

- `git`
- `mise` (installs the exact bun / node / pnpm versions pinned in `.mise.toml`)
- `docker` with Compose v2
- `direnv` (optional but recommended)

## Setup

```bash
git clone <repository-url> chatsundere
cd chatsundere
mise install
pnpm install
./scripts/setup-dev.sh
direnv allow                          # optional, if direnv is installed
docker compose -f infra/compose.dev.yml up -d
pnpm dev
```

After `pnpm dev`:

- `http://localhost:3000` — user-client
- `http://localhost:3010` — admin-client
- `http://localhost:3100` — auth-service (`/healthz`, `/readyz`, `/metrics`)
- `http://localhost:3200` — sync-service
- `http://localhost:3300` — proxy-service
- `http://localhost:9090` — Prometheus
- `http://localhost:3001` — Grafana (admin/admin on first login)

## Workflow

- One squashed commit per feature unit (see [ADR 0003](decisions/0003-squash-per-feature.md)).
- Doc-only commits end with `[skip ci]` (see CLAUDE.md §8).
- Security-touching changes are audited by Larissa before squash (see CLAUDE.md §9).
- British English in every artefact committed to the repository (CLAUDE.md §7).

## Asking for help

When uncertain, raise the tension with Chris (the arbiter) rather than guessing. See CLAUDE.md §1.
```

- [ ] **Step 3: Commit**

```bash
git add obsidian/ARCHITECTURE.md obsidian/ONBOARDING.md
git commit -m "Add ARCHITECTURE and ONBOARDING skeletons in obsidian/ [skip ci]"
```

---

## Task 16: README.md Expansion

**Files:**
- Modify: `README.md` (currently 89 bytes — replace entirely)

- [ ] **Step 1: Rewrite `README.md`**

```markdown
# Chatsundere

> Chat + Tsundere towards regulation & censorship, Deredere towards the user.

End-to-end-encrypted, local-first AI companion platform. The backend stores
ciphertext only; it never sees user data, passphrases, or master keys. Users
join via QR-encoded one-time invitations. Anyone can self-host the backend
and build their own client against the same APIs.

**Status:** private development. The first public release is v0.1.0 — see
the ADRs under [`obsidian/decisions/`](obsidian/decisions/) for the trail.

## Quick start

Full instructions: [`obsidian/ONBOARDING.md`](obsidian/ONBOARDING.md).

```bash
git clone <this-repository> chatsundere
cd chatsundere
mise install
pnpm install
./scripts/setup-dev.sh
docker compose -f infra/compose.dev.yml up -d
pnpm dev
```

## Layout

| Directory | Contents |
|---|---|
| `apps/user-client` | PWA, mobile-first (port 3000) |
| `apps/admin-client` | Admin UI (port 3010) |
| `apps/auth-service` | OPAQUE + Passkey + JWT (port 3100) |
| `apps/sync-service` | Encrypted vault (Phase 1, port 3200) |
| `apps/proxy-service` | Authenticated LLM proxy (Phase 2, port 3300) |
| `packages/crypto` | Client-side crypto primitives |
| `packages/shared-types` | Wire-format TypeScript types |
| `packages/llm-unified` | Provider adapters (Phase 2+) |
| `infra/` | Docker Compose, Prometheus, Grafana provisioning |
| `docs/` | Public teaser site for chatsune.me (HTML, no Markdown rendering) |
| `obsidian/` | Vault — briefs, ADRs, insights, architecture and onboarding docs |
| `scripts/` | Bootstrap and helper scripts |
| `superpowers/` | Specs and implementation plans |

## Environment variables

Every service has its own `.env.example`. After `scripts/setup-dev.sh` runs, you have working `.env` files for development. The variables:

### `apps/auth-service`

| Variable | Purpose | Example |
|---|---|---|
| `NODE_ENV` | `development` / `production` / `test` | `development` |
| `PORT` | HTTP listening port | `3100` |
| `LOG_LEVEL` | pino level | `debug` |
| `DATABASE_URL` | Postgres connection string for `auth_db` | `postgres://chatsundere:dev@localhost:5432/auth_db` |
| `REDIS_URL` | Redis connection (DB 0) | `redis://localhost:6379/0` |
| `JWT_ISSUER` | `iss` claim issued in access tokens | `chatsundere-auth` |
| `JWT_AUDIENCE` | `aud` claim issued in access tokens | `chatsundere-services` |
| `JWT_PRIVATE_KEY_PEM` | Ed25519 signing key (generated in auth-service unit) | _(commented)_ |
| `CORS_ORIGINS` | Comma-separated allowed origins | _(commented)_ |

### `apps/sync-service`

| Variable | Purpose | Example |
|---|---|---|
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | as above | `3200` |
| `DATABASE_URL` | `sync_db` (created when sync-service ships its schema) | `postgres://chatsundere:dev@localhost:5432/sync_db` |
| `REDIS_URL` | Redis (DB 1) | `redis://localhost:6379/1` |
| `JWT_ISSUER`, `JWT_AUDIENCE` | match auth-service | `chatsundere-auth`, `chatsundere-services` |
| `AUTH_JWKS_URL` | Where to fetch the auth-service public JWKS | `http://localhost:3100/v1/jwks` |
| `S3_*` | Vault blob storage (Phase 1) | _(commented)_ |

### `apps/proxy-service`

| Variable | Purpose | Example |
|---|---|---|
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | as above | `3300` |
| `DATABASE_URL` | `proxy_db` (Phase 2) | `postgres://chatsundere:dev@localhost:5432/proxy_db` |
| `REDIS_URL` | Redis (DB 2) | `redis://localhost:6379/2` |
| `JWT_ISSUER`, `JWT_AUDIENCE` | match auth-service | as above |
| `AUTH_JWKS_URL` | as above | `http://localhost:3100/v1/jwks` |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, … | Upstream LLM provider keys (Phase 2+) | _(commented)_ |

### `apps/user-client` and `apps/admin-client`

| Variable | Purpose | Example |
|---|---|---|
| `VITE_AUTH_URL` | Auth-service base URL | `http://localhost:3100` |
| `VITE_SYNC_URL` | Sync-service base URL | `http://localhost:3200` |
| `VITE_PROXY_URL` | Proxy-service base URL | `http://localhost:3300` |

## Licensing

| Path | Licence | Why |
|---|---|---|
| `apps/*` | AGPL-3.0-only | Server software stays copyleft, including network use |
| `packages/crypto` | LGPL-3.0-only | Reusable in other projects, improvements come back |
| `packages/llm-unified` | LGPL-3.0-only | Same as crypto |
| `packages/shared-types` | MIT | Pure types, trivially reusable |
| `docs/` | _(see chatsune.me site)_ | Marketing site |

See [ADR 0002](obsidian/decisions/0002-agplv3-for-apps.md) for the AGPL choice.

## Further reading

- [Lyra's design briefs](obsidian/briefs/)
- [ADRs](obsidian/decisions/)
- [Project journal](obsidian/insights/)
- [Architecture](obsidian/ARCHITECTURE.md) _(skeleton, filled as services land)_
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Expand README with quick-start, layout, env-vars, and licensing [skip ci]"
```

---

## Task 17: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up mise (bun, node, pnpm)
        uses: jdx/mise-action@v2

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Build
        run: pnpm build

      - name: Test
        run: pnpm test
```

- [ ] **Step 2: Validate workflow syntax (if `actionlint` is available)**

Run: `actionlint .github/workflows/ci.yml 2>&1 || echo 'actionlint not installed, skipping'`
Expected: no errors (or the skip message).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add GitHub Actions CI workflow (lint, typecheck, build, test) [skip ci]"
```

---

## Task 18: Final Verification and Squash

**Goal:** Run the full Manual Verification section from the spec, then squash all Task-1-to-17 commits into a single feature commit per ADR 0003.

- [ ] **Step 1: Determine the squash base**

Run: `git log --oneline -20`

Identify the SHA of the commit *before* Task 1 (this will be `2c11b77 Add chatsune.me teaser site [skip ci]` after the brainstorming commits). Save it: `BASE_SHA=2c11b77` (replace with the actual hash from the log).

- [ ] **Step 2: Full pnpm pipeline**

Run, in order:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Expected: every command exits 0. Test output shows 9 passing tests (3 per backend service × 3 services).

- [ ] **Step 3: setup-dev.sh idempotency check**

Run: `./scripts/setup-dev.sh`
Expected: five `✓ … exists — leaving it alone` lines (they were created during earlier steps).

- [ ] **Step 4: Docker compose health**

Run:
```bash
docker compose -f infra/compose.dev.yml up -d
sleep 20
docker compose -f infra/compose.dev.yml ps
```
Expected: all four services show `healthy`.

- [ ] **Step 5: Run all services and clients in parallel**

Run in a separate terminal: `pnpm dev`
Wait ~10 seconds for everything to start.

- [ ] **Step 6: Manual verification matrix**

In yet another terminal:

```bash
# Backends
for port in 3100 3200 3300; do
  echo "=== port $port ==="
  curl -s "http://localhost:$port/healthz"; echo
  curl -s "http://localhost:$port/readyz"; echo
  curl -s "http://localhost:$port/metrics" | head -3; echo
done

# Frontends
curl -s http://localhost:3000 | grep -c 'Chatsundere'   # expect 1
curl -s http://localhost:3010 | grep -c 'Chatsundere'   # expect 1

# Observability
curl -s http://localhost:9090/-/healthy                 # expect "Prometheus Server is Healthy"
curl -s http://localhost:9090/api/v1/targets | grep -c '"job":"auth-service"'  # expect 1
curl -s -u admin:admin http://localhost:3001/api/datasources | grep -c '"name":"Prometheus"'  # expect 1
```
Expected: every check produces the indicated result.

- [ ] **Step 7: Browser-level visual verification (Chris does this himself)**

Open in a browser:
- `http://localhost:3000` — user-client. Expect Instrument Serif italic `Chatsundere` heading on a dark background.
- `http://localhost:3010` — admin-client. Expect sans-serif `Chatsundere · Admin` heading on Catppuccin Mocha background.
- `http://localhost:3001` — Grafana login (admin/admin). After password change, the Data Sources page lists `Prometheus` as provisioned and default.

- [ ] **Step 8: [skip ci] sanity check (optional but informative)**

If the remote is configured and we are tracking master, the `[skip ci]` tag on the task commits would have prevented the GH Actions runs. Since we have not pushed yet (and the workflow file is brand-new), no CI run has happened. The squashed final commit (next step) does NOT carry `[skip ci]` — it should trigger CI on push.

- [ ] **Step 9: Tear everything down**

Run: `docker compose -f infra/compose.dev.yml down`
Run: kill the `pnpm dev` process group (Ctrl-C in its terminal).

- [ ] **Step 10: Larissa security gate**

Run a quick self-check against CLAUDE.md §9: did any file in `apps/auth-service`, `apps/sync-service`, `apps/proxy-service`, or `packages/crypto` ship real security logic?

Answer: NO. All four destinations contain stub-only code (health endpoints, throw-on-call crypto stubs, type declarations). Larissa is **not** required for this unit. Document the judgement call in `obsidian/insights/security-deferrals.md` if it does not already exist — see Step 11.

- [ ] **Step 11: Record the Larissa-skip rationale (if file doesn't exist, create it)**

Append (or create) `obsidian/insights/security-deferrals.md` with:

```markdown
## 2026-05-18 — Larissa skipped for monorepo setup unit

The "Set up monorepo and tooling" unit touches `apps/auth-service/**`,
`apps/sync-service/**`, `apps/proxy-service/**`, and `packages/crypto/**`,
all of which are in Larissa's audit scope per CLAUDE.md §9.

However: every source file in those paths is one of:
- a Hono application exposing only `/healthz`, `/readyz`, and `/metrics`
- a Valibot env schema with no secrets
- a `prom-client` default-metrics initialiser
- a pino logger
- a stub function throwing `CryptoError('internal', 'Stub')`

No OPAQUE, no WebAuthn, no JWT issuance, no DB queries, no real crypto.
The Larissa audit is deferred to the next units that ship real auth
logic (`Add auth-service`) and real crypto (`Add crypto package`),
where it is genuinely necessary.

Decided by Liz; flagged here for the record.
```

- [ ] **Step 12: Stage the deferrals note (if changed)**

Run: `git status --short obsidian/insights/security-deferrals.md`
If it appears, stage and commit: `git add obsidian/insights/security-deferrals.md && git commit -m "Record Larissa-skip rationale for monorepo unit [skip ci]"`.

- [ ] **Step 13: Squash all task commits into the feature commit**

Run, replacing `BASE_SHA` with the SHA captured in Step 1:

```bash
git reset --soft $BASE_SHA
git status --short        # sanity: every file added/modified by Tasks 1-17 should appear as staged
git commit -m "$(cat <<'EOF'
Set up monorepo and tooling

Phase 0 foundation: workspace tooling (pnpm + Turborepo + Bun + Biome +
lefthook + mise), dev infrastructure (Postgres, Redis, Prometheus,
Grafana with persistent bind-mount volumes under infra/data/), and
empty-but-running stubs for every Phase 0–2 service and package:

- apps/auth-service, apps/sync-service, apps/proxy-service — Hono
  servers exposing /healthz, /readyz, /metrics (ports 3100, 3200, 3300).
- apps/user-client, apps/admin-client — Vite + React + Tailwind v4
  rendering a single <h1> each (ports 3000 and 3010).
- packages/shared-types — MIT-licensed wire types.
- packages/crypto — LGPL-licensed stubs that throw CryptoError on
  every call; SECURITY.md skeleton in place.
- packages/llm-unified — placeholder for Phase 2+.
- infra/compose.dev.yml + bind mounts, postgres init script for
  auth_db, Prometheus scrape config for the three backends,
  Grafana datasource provisioning.
- infra/compose.prod.yml.example with Traefik labels and named
  volumes.
- scripts/setup-dev.sh: idempotent .env bootstrap.
- obsidian/ARCHITECTURE.md and obsidian/ONBOARDING.md skeletons.
- Root README rewritten with quick-start, layout, full env-var
  reference, and licensing card.
- .github/workflows/ci.yml runs lint, typecheck, build, test on
  every push and PR.

Test coverage: 9 health-endpoint tests pass via `bun test` across
the three backend stubs.

Reference: superpowers/specs/2026-05-18-project-structure-design.md
Larissa audit: skipped — see obsidian/insights/security-deferrals.md
for the rationale (no real security logic in this unit).

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 14: Verify the squashed commit and the final state**

Run:
```bash
git log --oneline -5
git diff --stat HEAD~1 HEAD | tail -20
```
Expected: the previous commit is `2c11b77 Add chatsune.me teaser site [skip ci]`; the new HEAD is `Set up monorepo and tooling`; the diff stat shows ~50+ files and several thousand lines added.

- [ ] **Step 15: Final verification of working tree**

Run: `git status --short`
Expected: empty (everything committed, nothing pending).

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm build && pnpm test`
Expected: all green.

- [ ] **Step 16: Hand back to Chris for the browser-level Manual Verification matrix (spec §12)**

The squashed commit is now ready. Chris runs the Manual Verification matrix from the spec himself before the unit is considered "shipped".
