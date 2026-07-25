# Artefact synthesis pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or equivalent) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship persona tools `list_artefacts` / `modify_artefact` / `inspect_artefact`, evolve `create_artefact` for html|markdown + content-axis unlockers, and a headless agent loop for the craft subagent — per design spec `superpowers/specs/2026-07-24-artefact-synthesis-pilot-design.md`.

**Architecture:** Two storeys — main persona tools vs craft subagent. Create stays one-shot streaming author; modify/inspect use an internal tool loop (list/read_current/read_other/replace_current) with execution ledger. No transcript frontload. Content-axis unlockers (tonality/NSFW/global) on all craft prompts. Chat-only scope; no Dexie migration.

**Tech Stack:** TypeScript strict, Vitest, React, existing tool/integration/stream patterns, `@chatsundere/llm-unified` identity prompts. No new deps.

**Worktree:** `/home/chris/workspace/chatsundere/.claude/worktrees/migrate-to-grok` (branch `migrate-to-grok`).

## Global Constraints

- **British English** everywhere in the repo (code, comments, commits, user-facing strings).
- **No `!` non-null assertions** (Biome `noNonNullAssertion`).
- **No Dexie bump.**
- **Not Larissa** (client-only). Laura pre-squash later if UX-facing (controller).
- **Subagents never merge, push, or switch branches.**
- Commit messages: free-form imperative; no Co-Authored-By required unless project habit for code.
- Verification from worktree root:
  - One test file: `pnpm --filter @chatsundere/user-client exec vitest run <path>`
  - Package tests: `pnpm --filter @chatsundere/llm-unified exec vitest run <path>`
  - Typecheck: `pnpm typecheck --force` (or filter packages touched)
  - Build gate before claiming done: `pnpm run build` for touched packages / full as needed

## File map

| File | Role |
|---|---|
| `packages/llm-unified/src/content-axis.ts` | `buildContentAxisPrompt` |
| `packages/llm-unified/src/index.ts` | export helper |
| `packages/llm-unified/src/content-axis.test.ts` | unit tests |
| `apps/user-client/src/lib/artefact-author.ts` | format-aware craft + unlockers |
| `apps/user-client/src/data/artefacts.ts` | `addGeneratedArtefact` format param |
| `apps/user-client/src/lib/agent-loop.ts` | headless tool loop + ledger |
| `apps/user-client/src/lib/artefact-craft-tools.ts` | internal list/read/replace tools |
| `apps/user-client/src/lib/artefact-craft-runner.ts` | spawn create/modify/inspect |
| `apps/user-client/src/integrations/artefact/artefact-integration.ts` | all four persona tools |
| `apps/user-client/src/integrations/types.ts` + `build-context.ts` | craft unlocker fields on context |
| `apps/user-client/src/tools/types.ts` | extend `ToolProgress.phase` |
| `apps/user-client/src/components/chat/ArtefactPill.tsx` | multi-tool + dynamic format badge |
| Tests under `apps/user-client/tests/…` mirroring modules |

---

### Task 1: Content-axis prompt helper (`packages/llm-unified`)

**Files:**
- Create: `packages/llm-unified/src/content-axis.ts`
- Create: `packages/llm-unified/src/content-axis.test.ts`
- Modify: `packages/llm-unified/src/index.ts` (export)

- [ ] **Step 1: Write failing tests**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { NSFW_PROMPT, TONALITY_PROMPT } from './identity/chatsundere-identity.js';
import { buildContentAxisPrompt } from './content-axis.js';

describe('buildContentAxisPrompt', () => {
  it('returns empty when all gates off and global empty', () => {
    expect(
      buildContentAxisPrompt({
        nsfwEnabled: false,
        tonalityEnabled: false,
        globalInstructions: '',
      }),
    ).toBe('');
  });

  it('joins tonality then nsfw then global when all present', () => {
    const out = buildContentAxisPrompt({
      nsfwEnabled: true,
      tonalityEnabled: true,
      globalInstructions: '  BE BOLD  ',
    });
    expect(out.startsWith(TONALITY_PROMPT)).toBe(true);
    expect(out).toContain(NSFW_PROMPT);
    expect(out.endsWith('BE BOLD')).toBe(true);
    expect(out).toBe(`${TONALITY_PROMPT}\n\n${NSFW_PROMPT}\n\nBE BOLD`);
  });

  it('omits whitespace-only global instructions', () => {
    const out = buildContentAxisPrompt({
      nsfwEnabled: true,
      tonalityEnabled: false,
      globalInstructions: '   \n',
    });
    expect(out).toBe(NSFW_PROMPT);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

`pnpm --filter @chatsundere/llm-unified exec vitest run src/content-axis.test.ts`

- [ ] **Step 3: Implement**

```ts
// packages/llm-unified/src/content-axis.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { NSFW_PROMPT, TONALITY_PROMPT } from './identity/chatsundere-identity.js';

/** Content-axis unlocker segments for craft/subagent system prompts (not full chat composition).
 *  Order mirrors Band-1: tonality → nsfw → global. Empty segments omitted. */
export function buildContentAxisPrompt(parts: {
  nsfwEnabled: boolean;
  tonalityEnabled: boolean;
  globalInstructions: string;
}): string {
  const segs: string[] = [];
  if (parts.tonalityEnabled) segs.push(TONALITY_PROMPT);
  if (parts.nsfwEnabled) segs.push(NSFW_PROMPT);
  const global = parts.globalInstructions.trim();
  if (global.length > 0) segs.push(global);
  return segs.join('\n\n');
}
```

Export from `index.ts` next to `NSFW_PROMPT` / `TONALITY_PROMPT`.

- [ ] **Step 4: Tests pass; commit**

`git commit -m "Add buildContentAxisPrompt for craft subagent unlockers"`

---

### Task 2: Create html|markdown + unlockers on author path

**Files:**
- Modify: `apps/user-client/src/lib/artefact-author.ts`
- Modify: `apps/user-client/src/data/artefacts.ts` (`AddGeneratedArtefactInput` + `addGeneratedArtefact`)
- Modify: `apps/user-client/src/integrations/artefact/artefact-integration.ts` (format param, unlockers, call author)
- Modify: `apps/user-client/src/integrations/types.ts` + `build-context.ts` (add `tonalityEnabled`, `globalInstructions`; `nsfwAllowed` already exists)
- Extend tests: `tests/unit/artefact-author.test.ts`, `artefact-integration.test.ts`, `data` if needed
- Wire stream-manager / send path that calls `buildIntegrationContext` to pass tonality + globalInstructions from persona/settings

- [ ] **Step 1: Failing tests**

1. `authorArtefact` system message includes NSFW when `contentAxis` contains it; craft rules differ for `format: 'markdown'` vs `html`.
2. `addGeneratedArtefact({ format: 'markdown', ... })` stores `format: 'markdown'`, `mime: 'text/markdown'`, `fileName` ends with `.md`.
3. `create_artefact` tool accepts `format: 'markdown'` and passes it through; invalid format → `ok: false`.

- [ ] **Step 2: Implement**

- `export type ArtefactCreateFormat = 'html' | 'markdown'`
- `authorCraftRules(format)`:
  - html: existing AUTHOR_SYSTEM_PROMPT text
  - markdown: single Markdown document only; clear structure; no HTML shell unless brief asks
- `authorArtefact` args: `format: ArtefactCreateFormat`, `contentAxisPrompt: string` — system = rules + (if axis non-empty) `\n\n` + axis
- `addGeneratedArtefact`: `format?: ArtefactCreateFormat` default `'html'`; set mime/ext accordingly
- Tool schema: optional `format` enum default html
- `IntegrationContext`: `tonalityEnabled: boolean`, `globalInstructions: string`
- `buildIntegrationContext`: accept persona tonality + settings globalInstructions
- Find all `buildIntegrationContext` call sites and pass the new fields (stream-manager / send-message)

- [ ] **Step 3: Tests pass; commit**

`git commit -m "Support markdown create_artefact and content-axis unlockers"`

---

### Task 3: Headless agent loop

**Files:**
- Create: `apps/user-client/src/lib/agent-loop.ts`
- Create: `apps/user-client/tests/lib/agent-loop.test.ts`

**Do not** modify chat `tool-loop.ts` behaviour; extract a clean core the craft runner will use.

- [ ] **Step 1: Failing tests** for:
  - One round tool call → dispatch → second round final text, no tools
  - Ledger records success/failure
  - `maxRounds` forces tools-free final pass
  - Abort mid-dispatch surfaces `stoppedByAbort`

- [ ] **Step 2: Implement** `runAgentLoop(deps)`:

```ts
export interface AgentLedgerEntry {
  op: string;
  targetId?: string;
  success: boolean;
  error?: string;
  resultingUpdatedAt?: number;
  at: number;
}

export interface AgentLoopResult {
  finalText: string;
  ledger: AgentLedgerEntry[];
  roundsUsed: number;
  roundLimitReached: boolean;
  stoppedByAbort: boolean;
}

export interface AgentLoopDeps {
  streamOnce: (
    exchange: WireMessage[],
    tools: ToolDef[],
  ) => Promise<{
    text: string;
    toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
  }>;
  dispatch: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult & { ledgerHint?: Partial<AgentLedgerEntry> }>;
  toolDefs: ToolDef[];
  maxRounds: number;
  signal?: AbortSignal;
  onProgress?: (p: { phase?: string; charCount?: number }) => void;
}
```

Loop: while rounds < maxRounds, stream with tools; if no tool calls, return text; else execute each, append assistant+tool messages, push ledger from dispatch. After maxRounds, stream once with `tools: []` and instruction that final text must honestly report partial work.

- [ ] **Step 3: Pass + commit**

`git commit -m "Add headless agent loop for craft subagents"`

---

### Task 4: Craft internal tools (list / read / replace)

**Files:**
- Create: `apps/user-client/src/lib/artefact-craft-tools.ts`
- Create: `apps/user-client/tests/lib/artefact-craft-tools.test.ts`
- May use `getClientDataDb`, `updateArtefactContent`, `renameArtefact`

- [ ] **Step 1: Failing tests** with mocked Dexie:
  - `list` returns only `kind: 'text'` for chatId, includes `isCurrent`, omits images
  - `read_current` returns full body
  - `read_other` exact title; ambiguous → error with candidates; none → error
  - `replace_current` success bumps content; stale `expectedUpdatedAt` fails; empty body fails; shrink <40% without `force` fails when prior ≥ 500; inspect mode has no replace tool

- [ ] **Step 2: Implement**

```ts
export function makeCraftTools(opts: {
  chatId: string;
  currentId: string;
  allowWrite: boolean;
}): Tool[]
```

Tools named: `list_artefacts`, `read_current_artefact`, `read_other_artefact`, `replace_current_artefact` (only if allowWrite).

Name resolution for other: case-fold trim; exact title/fileName/basename; else unique substring; else error.

Replace: load row; verify chatId + id === currentId + kind text; check updatedAt; apply shrink rule; `updateArtefactContent`; optional title via `renameArtefact`; return JSON with new updatedAt. Attach `ledgerHint` on ToolResult via meta for runner.

- [ ] **Step 3: Pass + commit**

`git commit -m "Add artefact craft subagent internal tools"`

---

### Task 5: Craft runner + persona tools modify/inspect/list

**Files:**
- Create: `apps/user-client/src/lib/artefact-craft-runner.ts`
- Modify: `artefact-integration.ts` — contribute 4 tools
- Modify: `ToolProgress` phases to allow `'reading' | 'writing' | 'explaining' | 'building' | 'starting' | 'done'` (extend union; keep existing ask_expert phases)
- Tests: integration + runner unit tests with mocked stream/dispatch
- Update `registry` tests expecting only `create_artefact` → now also list/modify/inspect

- [ ] **Step 1: Failing tests**
  - `list_artefacts` execute returns JSON index for chat
  - `modify_artefact` missing id / wrong chat → constructive error without calling model
  - `inspect_artefact` spawn has no replace in tool set (spy on makeCraftTools or runner)
  - modify success meta includes artefactId + updatedAt from ledger

- [ ] **Step 2: Implement runner**

`runModifyArtefact` / `runInspectArtefact`:
1. Resolve base + key (reuse artefact-expert resolution from create)
2. Build system = craft rules for bound format + content axis
3. User message = brief or question + current index line (id, title, format, updatedAt, charLength)
4. `makeCraftTools({ allowWrite })`
5. `runAgentLoop` with streamCompletion-based streamOnce (tool defs from craft tools); map progress phases
6. Build ToolResult from ledger: if any successful replace → ok with meta; inspect → ok with finalText as output

Persona tool `list_artefacts`: direct Dexie read (no subagent), same row shape as craft list without needing current.

`modify_artefact` / `inspect_artefact` params: `artefactId`, `brief`/`question` required.

maxRounds: modify 6, inspect 4.

- [ ] **Step 3: Pass + commit**

`git commit -m "Wire list modify and inspect artefact persona tools"`

---

### Task 6: ArtefactPill UX for modify/inspect + dynamic format badge

**Files:**
- Modify: `apps/user-client/src/components/chat/ArtefactPill.tsx`
- Modify: `apps/user-client/src/components/chat/Pill.tsx` if routing by tool name
- Modify: `tests/components/artefact-pill.test.tsx`

- [ ] **Step 1: Failing tests** for pending subtitles (`building` / `reading` / `writing` / `explaining`), format badge MD vs HTML from payload/meta/row, modify ready → `updated`, inspect ready → `explained`.

- [ ] **Step 2: Implement** — detect tool name from payload; badge from `format` or artefact row; phase-driven subtitle; keep tombstone behaviour.

- [ ] **Step 3: Pass + commit**

`git commit -m "Extend ArtefactPill for modify inspect and format badges"`

---

### Task 7: Gates + STATUS touch

- [ ] Run: `pnpm --filter @chatsundere/llm-unified exec vitest run src/content-axis.test.ts`
- [ ] Run: relevant user-client vitest files for artefact/agent-loop/craft
- [ ] Run: `pnpm --filter @chatsundere/user-client exec tsc --noEmit` or workspace `pnpm typecheck --force` for affected
- [ ] Run: `pnpm --filter @chatsundere/user-client run build` (or monorepo build if required)
- [ ] Biome clean on touched files
- [ ] Update `obsidian/STATUS-CLIENT-ONLY.md` Current: implementation landed on branch, pending Laura/device test
- [ ] Commit STATUS if changed: `Record artefact synthesis pilot implementation progress [skip ci]`

---

## Spec coverage checklist

| Spec area | Task |
|---|---|
| Content-axis unlockers | 1, 2 |
| create html\|markdown | 2 |
| Headless agent loop | 3 |
| Internal craft tools + concurrency/shrink | 4 |
| list/modify/inspect persona tools | 5 |
| No transcript; complete brief (prompt instructions) | 5 |
| Pill progress / format badge | 6 |
| No Dexie migration | all |
| Chat-only scope | 4, 5 |
| Expert resolution reuse | 5 |

## Out of plan (per spec)

- Laura spec-pass (controller summons before squash if required)
- Knowledge librarian
- Create formats beyond html/markdown
- Transcript escape hatch
