# calculate_js + Tool-Execution Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-side tool-execution round-trip loop and ship `calculate_js` as its first rider, so a model can call a sandboxed JavaScript tool, receive its result, and continue answering.

**Architecture:** A class-based tool registry in the user-client owns each tool's wire definition, system-prompt instruction, and executor. `calculate_js` runs in a fresh Web Worker (dangerous globals nulled, output capped, 10 s timeout) and returns both captured `console.*` output and the completion value of the final expression. The orchestration loop lives in the stream-manager: it injects tool definitions, detects tool-call pills, executes them via the registry, appends `assistant(tool_calls)` / `tool` messages to the in-flight wire history, and re-streams — up to five tool-executing rounds, then a forced tools-less answer. The single-pass `runStreamEngine` stays pure and gains `tools` / `toolExchange` / `toolsInstruction` inputs.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Dexie, Web Workers, Vitest (user-client), Bun test (llm-unified). Spec: `superpowers/specs/2026-06-02-calculate-js-tool-spine-design.md`.

**Conventions:** British English in all code/comments/strings. Every new file starts with `// SPDX-License-Identifier: AGPL-3.0-only` (user-client) or `// SPDX-License-Identifier: LGPL-3.0-only` (`packages/llm-unified`). `PillRow.status` values are `'pending' | 'completed' | 'failed'` — we map running→`pending`, ok→`completed`, error→`failed`. No Dexie migration (pill `payload` is `unknown`).

**Commands:**
- One Vitest file: `pnpm --filter @chatsundere/user-client exec vitest run <path-from-apps/user-client>`
- One Bun test file: `cd packages/llm-unified && bun test <path-from-packages/llm-unified>`
- Full typecheck (the CI gate): `pnpm typecheck`
- Full build: `pnpm build`

**Co-author tag for every commit:** `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`

---

## File Structure

**New — `apps/user-client/src/tools/`**
- `sandbox-exec.ts` — pure `executeCode(code, maxOutputBytes)`; importable in tests without spawning a Worker.
- `sandbox.worker.ts` — Worker entry: nulls globals on `self`, runs `executeCode`, posts the result.
- `sandbox-host.ts` — `runSandbox(code)`: spawns a fresh Worker, races a 10 s timeout, terminates.
- `types.ts` — `Tool`, `ToolResult` interfaces.
- `calculate-js.ts` — the `calculate_js` `Tool` + the pure `assembleOutput` helper.
- `registry.ts` — the registered-tools array + `toolDefs()` / `systemPromptSegment()` / `dispatch()`.
- `*.test.ts` — co-located tests for the pure units.

**Modified**
- `packages/llm-unified/src/index.ts` — re-export `ToolDef` and `WireToolCall` (Task 0).
- `packages/llm-unified/src/composition.ts` — add a Band-3 `tools` segment + `toolsInstruction` input.
- `apps/user-client/src/lib/stream-engine.ts` — `tools` / `toolExchange` / `toolsInstruction` inputs; extract `buildEngineWireMessages`; pass `tools` to `streamCompletion`; pills default to `pending`.
- `apps/user-client/src/lib/tool-loop.ts` — **new** pure `runToolLoop` orchestrator.
- `apps/user-client/src/state/stream-manager.store.ts` — bind the loop; live pill status mirroring.
- `apps/user-client/src/components/chat/ChatStream.tsx` — merge the live handle's `pillBuffer` into the pill map.
- `apps/user-client/src/components/chat/Pill.tsx` — tap-to-expand showing code + result/error; status visuals.
- Callers that build `BuildPromptInputs`: `apps/user-client/src/lib/title-generator.ts`, `apps/user-client/src/routes/app/chat-page.tsx` (gauge) — pass `toolsInstruction: ''`.

---

## Task 0: Re-export tool wire types from the llm-unified index

The package index (`packages/llm-unified/src/index.ts`) re-exports `WireMessage` and `StreamChunk` but **not** `ToolDef` (defined in `adapter-contract.ts`) or `WireToolCall` (in `types.ts`). The registry and the tool-loop import both from `@chatsundere/llm-unified`, so export them first.

**Files:**
- Modify: `packages/llm-unified/src/index.ts`

- [ ] **Step 1: Add the exports**

Add `WireToolCall` to the existing `type { … } from './types.js'` block:

```ts
  WireMessage,
  WireToolCall,
  StreamChunk,
```

Add a new export line after the `streamCompletion` export (or anywhere among the top-level exports):

```ts
export type { ToolDef } from './adapter-contract.js';
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/src/index.ts
git commit -m "Re-export ToolDef and WireToolCall from llm-unified index

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 1: Sandbox execution core (`executeCode`)

**Files:**
- Create: `apps/user-client/src/tools/sandbox-exec.ts`
- Test: `apps/user-client/src/tools/sandbox-exec.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/tools/sandbox-exec.test.ts
import { describe, expect, it } from 'vitest';
import { executeCode } from './sandbox-exec.js';

const CAP = 4096;

describe('executeCode', () => {
  it('returns the completion value of the final expression', () => {
    const r = executeCode('2 + 2', CAP);
    expect(r.value).toBe('4');
    expect(r.stdout).toBe('');
    expect(r.error).toBeNull();
  });

  it('returns the value of the last statement after declarations', () => {
    expect(executeCode('const x = 5; x * x', CAP).value).toBe('25');
  });

  it('captures console.* output and the value together', () => {
    const r = executeCode('console.log("r count", [..."strawberry"].filter(c => c === "r").length); 99', CAP);
    expect(r.stdout).toBe('r count 3');
    expect(r.value).toBe('99');
  });

  it('reports undefined value when the program has none', () => {
    const r = executeCode('console.log("hi")', CAP);
    expect(r.stdout).toBe('hi');
    expect(r.value).toBeUndefined();
  });

  it('shadows dangerous globals to undefined (no network in the sandbox)', () => {
    expect(executeCode('typeof fetch', CAP).value).toBe('"undefined"');
  });

  it('surfaces a thrown error as a Name: message string', () => {
    const r = executeCode('throw new RangeError("nope")', CAP);
    expect(r.error).toBe('RangeError: nope');
    expect(r.value).toBeUndefined();
  });

  it('caps console output and appends a truncation marker', () => {
    const r = executeCode('for (let i = 0; i < 100000; i++) console.log("x".repeat(50))', 200);
    expect(r.stdout.length).toBeLessThanOrEqual(200 + ' ... (output truncated)'.length);
    expect(r.stdout.endsWith(' ... (output truncated)')).toBe(true);
  });

  it('stringifies object values as JSON', () => {
    expect(executeCode('({ a: 1, b: [2, 3] })', CAP).value).toBe('{"a":1,"b":[2,3]}');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/tools/sandbox-exec.test.ts`
Expected: FAIL — cannot find module `./sandbox-exec.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/tools/sandbox-exec.ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Result of one sandboxed run. `stdout` is captured `console.*` output;
 *  `value` is the stringified completion value of the final statement (or
 *  `undefined` when there is none); `error` is `Name: message` on a throw. */
export interface SandboxRun {
  stdout: string;
  value: string | undefined;
  error: string | null;
}

/** Globals nulled inside the eval scope so user code cannot reach the network,
 *  storage, or schedule work. The Worker entry (sandbox.worker.ts) also nulls
 *  these on `self`; nulling them here as function-locals keeps `executeCode`
 *  self-contained and testable in Node/jsdom without polluting real globals. */
export const DANGEROUS_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'Worker', 'SharedWorker', 'EventSource', 'BroadcastChannel',
  'indexedDB', 'caches',
] as const;

function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') return JSON.stringify(value);
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Execute user-supplied JavaScript, capturing `console.*` output and the
 * completion value of the final statement.
 *
 * `new Function` gives a fresh function scope: the `var` nullers and the
 * `console` mock shadow the real globals function-locally (no global
 * pollution — safe to call directly in tests). A *direct* `eval(__code__)`
 * runs in that same scope, so user code sees the shadowed globals, and `eval`
 * returns the completion value of the program's final statement (`2 + 2` → 4).
 */
export function executeCode(code: string, maxOutputBytes: number): SandboxRun {
  const lines: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  const encoder = new TextEncoder();

  const captureLine = (...args: unknown[]): void => {
    if (truncated) return;
    const line = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
    const lineBytes = encoder.encode(`${line}\n`).length;
    if (totalBytes + lineBytes > maxOutputBytes) {
      truncated = true;
      const remaining = maxOutputBytes - totalBytes;
      if (remaining > 0) {
        lines.push(line.slice(0, remaining));
        totalBytes = maxOutputBytes;
      }
      return;
    }
    lines.push(line);
    totalBytes += lineBytes;
  };

  const consoleMock = {
    log: captureLine, error: captureLine, warn: captureLine,
    info: captureLine, debug: captureLine,
  };

  const nulledDeclarations = DANGEROUS_GLOBALS.map((n) => `var ${n} = undefined;`).join('\n');
  let value: unknown;
  let error: string | null = null;
  try {
    const body = `${nulledDeclarations}\nvar console = __console__;\nreturn eval(__code__);`;
    // biome-ignore lint/security/noGlobalEval: the whole point of this module is to execute user JS in a sandboxed scope.
    value = new Function('__console__', '__code__', body)(consoleMock, code);
  } catch (e) {
    value = undefined;
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  let stdout = lines.join('\n');
  if (truncated) stdout += ' ... (output truncated)';

  return { stdout, value: value === undefined ? undefined : safeStringify(value), error };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/tools/sandbox-exec.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/tools/sandbox-exec.ts apps/user-client/src/tools/sandbox-exec.test.ts
git commit -m "Add sandboxed JS execution core (executeCode)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Sandbox Worker entry + host (glue)

No unit test — Worker spawning is verified by typecheck and the manual verification in the spec (§11). The execution logic is already covered by Task 1.

**Files:**
- Create: `apps/user-client/src/tools/sandbox.worker.ts`
- Create: `apps/user-client/src/tools/sandbox-host.ts`

- [ ] **Step 1: Write the Worker entry**

```ts
// apps/user-client/src/tools/sandbox.worker.ts
// SPDX-License-Identifier: AGPL-3.0-only
import { DANGEROUS_GLOBALS, type SandboxRun, executeCode } from './sandbox-exec.js';

// Strip dangerous globals from the Worker scope before any user code runs.
// This is the real isolation boundary; executeCode's function-local shadowing
// is the defence-in-depth layer that also makes it testable.
for (const name of DANGEROUS_GLOBALS) {
  try {
    (self as unknown as Record<string, unknown>)[name] = undefined;
  } catch {
    // best-effort — a defineProperty-protected global must not crash bootstrap
  }
}

self.addEventListener('message', (event: MessageEvent<{ code: string; maxOutputBytes: number }>) => {
  const { code, maxOutputBytes } = event.data;
  const result: SandboxRun = executeCode(code, maxOutputBytes);
  (self as unknown as { postMessage: (data: SandboxRun) => void }).postMessage(result);
});
```

- [ ] **Step 2: Write the host**

```ts
// apps/user-client/src/tools/sandbox-host.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { SandboxRun } from './sandbox-exec.js';

/** Output cap handed to the sandbox (bytes of captured console output). */
export const SANDBOX_MAX_OUTPUT_BYTES = 4096;
/** Wall-clock cap for one run. 10 s leaves headroom for Worker spin-up on
 *  slower mobile devices (chatsune ran 60 s under server dispatch). */
export const SANDBOX_TIMEOUT_MS = 10_000;

/**
 * Run code in a fresh Web Worker and return its result. A new Worker per call
 * is the strongest state isolation; it is terminated unconditionally after the
 * reply or on timeout. An external `signal` abort also terminates it.
 */
export async function runSandbox(code: string, signal?: AbortSignal): Promise<SandboxRun> {
  const worker = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' });

  const result = await new Promise<SandboxRun>((resolve) => {
    let settled = false;
    const settle = (value: SandboxRun): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timeout = setTimeout(() => {
      worker.terminate();
      settle({ stdout: '', value: undefined, error: `Timed out after ${SANDBOX_TIMEOUT_MS}ms` });
    }, SANDBOX_TIMEOUT_MS);

    const onAbort = (): void => {
      clearTimeout(timeout);
      worker.terminate();
      settle({ stdout: '', value: undefined, error: 'Aborted' });
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    worker.addEventListener('message', (event: MessageEvent<SandboxRun>) => {
      clearTimeout(timeout);
      settle(event.data);
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      clearTimeout(timeout);
      settle({ stdout: '', value: undefined, error: `Sandbox crash: ${event.message || 'unknown error'}` });
    });

    worker.postMessage({ code, maxOutputBytes: SANDBOX_MAX_OUTPUT_BYTES });
  });

  worker.terminate();
  return result;
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/tools/sandbox.worker.ts apps/user-client/src/tools/sandbox-host.ts
git commit -m "Add Web Worker sandbox host for client-side JS execution

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Tool types + `calculate_js` tool

**Files:**
- Create: `apps/user-client/src/tools/types.ts`
- Create: `apps/user-client/src/tools/calculate-js.ts`
- Test: `apps/user-client/src/tools/calculate-js.test.ts`

- [ ] **Step 1: Write the tool types**

```ts
// apps/user-client/src/tools/types.ts
// SPDX-License-Identifier: AGPL-3.0-only

/** The outcome of executing a tool. `output` is handed to the model verbatim
 *  as the `tool` message content; `error` is set (and `ok` false) on failure. */
export interface ToolResult {
  ok: boolean;
  output: string;
  error: string | null;
}

/** A client-executed tool. The registry projects `parameters` into a wire
 *  `ToolDef`, joins every non-null `systemPromptInstruction` into the prompt's
 *  tools segment, and routes calls to `execute`. */
export interface Tool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
  /** Text injected into the system prompt's tools segment; `null` if trivial. */
  systemPromptInstruction: string | null;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/user-client/src/tools/calculate-js.test.ts
import { describe, expect, it } from 'vitest';
import { assembleOutput, calculateJs } from './calculate-js.js';

describe('assembleOutput', () => {
  it('combines console output and the final value on its own line', () => {
    expect(assembleOutput({ stdout: 'r count 3', value: '99', error: null })).toBe('r count 3\n99');
  });

  it('returns just the value when there is no console output', () => {
    expect(assembleOutput({ stdout: '', value: '4', error: null })).toBe('4');
  });

  it('returns just the console output when there is no value', () => {
    expect(assembleOutput({ stdout: 'hi', value: undefined, error: null })).toBe('hi');
  });

  it('returns an empty string when there is neither', () => {
    expect(assembleOutput({ stdout: '', value: undefined, error: null })).toBe('');
  });
});

describe('calculateJs definition', () => {
  it('is named calculate_js with a code parameter', () => {
    expect(calculateJs.name).toBe('calculate_js');
    expect((calculateJs.parameters as { required: string[] }).required).toContain('code');
  });

  it('carries a non-null system-prompt instruction', () => {
    expect(calculateJs.systemPromptInstruction).not.toBeNull();
    expect(calculateJs.systemPromptInstruction).toContain('calculate_js');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/tools/calculate-js.test.ts`
Expected: FAIL — cannot find module `./calculate-js.js`.

- [ ] **Step 4: Write the implementation**

```ts
// apps/user-client/src/tools/calculate-js.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { SandboxRun } from './sandbox-exec.js';
import { runSandbox } from './sandbox-host.js';
import type { Tool, ToolResult } from './types.js';

/** Build the model-facing output string from a sandbox run: console output,
 *  then the final value on its own line when both are present. */
export function assembleOutput(run: SandboxRun): string {
  const parts: string[] = [];
  if (run.stdout.length > 0) parts.push(run.stdout);
  if (run.value !== undefined) parts.push(run.value);
  return parts.join('\n');
}

const INSTRUCTION =
  'A `calculate_js` tool runs JavaScript and returns its output. Prefer it for any ' +
  'arithmetic, counting, or string manipulation rather than computing in your head — even ' +
  'simple sums. It eliminates slips such as miscounting the letters in a word.';

export const calculateJs: Tool = {
  name: 'calculate_js',
  description: 'Execute JavaScript and return its output. Use for arithmetic, counting, and string manipulation.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'JavaScript to execute. The value of the final expression is returned; console.* output is captured too.',
      },
    },
    required: ['code'],
  },
  systemPromptInstruction: INSTRUCTION,

  async execute(args, signal): Promise<ToolResult> {
    const code = typeof args.code === 'string' ? args.code : '';
    if (code.trim().length === 0) {
      return { ok: false, output: '', error: 'No code provided' };
    }
    const run = await runSandbox(code, signal);
    if (run.error !== null) {
      return { ok: false, output: assembleOutput(run), error: run.error };
    }
    return { ok: true, output: assembleOutput(run), error: null };
  },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/tools/calculate-js.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/tools/types.ts apps/user-client/src/tools/calculate-js.ts apps/user-client/src/tools/calculate-js.test.ts
git commit -m "Add calculate_js tool definition and output assembly

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: Tool registry

**Files:**
- Create: `apps/user-client/src/tools/registry.ts`
- Test: `apps/user-client/src/tools/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/tools/registry.test.ts
import { describe, expect, it } from 'vitest';
import { dispatch, systemPromptSegment, toolDefs } from './registry.js';

describe('tool registry', () => {
  it('projects registered tools into wire ToolDefs', () => {
    const defs = toolDefs();
    const calc = defs.find((d) => d.name === 'calculate_js');
    expect(calc).toBeDefined();
    expect(calc?.parameters).toHaveProperty('properties');
    // ToolDef carries only the wire-relevant fields.
    expect(Object.keys(calc ?? {}).sort()).toEqual(['description', 'name', 'parameters']);
  });

  it('joins non-null instructions into the system-prompt segment', () => {
    const seg = systemPromptSegment();
    expect(seg).not.toBeNull();
    expect(seg).toContain('calculate_js');
  });

  it('returns a structured error for an unknown tool name', async () => {
    const r = await dispatch('no_such_tool', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Unknown tool');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/tools/registry.test.ts`
Expected: FAIL — cannot find module `./registry.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/tools/registry.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolDef } from '@chatsundere/llm-unified';
import { calculateJs } from './calculate-js.js';
import type { Tool, ToolResult } from './types.js';

/** Every tool is always offered (omakase — no per-tool toggle). One entry today. */
const TOOLS: readonly Tool[] = [calculateJs];

const BY_NAME = new Map<string, Tool>(TOOLS.map((t) => [t.name, t]));

/** Wire tool definitions for the request. The manager passes these to
 *  `runStreamEngine` → `streamCompletion` only when the offering supports tools. */
export function toolDefs(): ToolDef[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Joined non-null `systemPromptInstruction`s for the prompt's Band-3 tools
 *  segment, or `null` when nothing to add. */
export function systemPromptSegment(): string | null {
  const lines = TOOLS.map((t) => t.systemPromptInstruction).filter((s): s is string => s !== null);
  return lines.length > 0 ? lines.join('\n\n') : null;
}

/** Execute a tool by name. An unknown name returns a structured error rather
 *  than throwing — a model can hallucinate a tool name. */
export function dispatch(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return Promise.resolve({ ok: false, output: '', error: `Unknown tool: ${name}` });
  }
  return tool.execute(args, signal);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/tools/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/tools/registry.ts apps/user-client/src/tools/registry.test.ts
git commit -m "Add always-on tool registry (toolDefs / instruction / dispatch)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Prompt-builder tools segment

**Files:**
- Modify: `packages/llm-unified/src/composition.ts`
- Test: `packages/llm-unified/src/composition.test.ts` (add cases)
- Modify (callers): `apps/user-client/src/lib/stream-engine.ts`, `apps/user-client/src/lib/title-generator.ts`, `apps/user-client/src/routes/app/chat-page.tsx`

> The instruction is injected as a **Band-3** segment, **chat-only** (title/memory jobs never expose tools).

- [ ] **Step 1: Write the failing test (Bun)**

Add to `packages/llm-unified/src/composition.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { buildPrompt, type BuildPromptInputs } from './composition.js';

const baseInputs: BuildPromptInputs = {
  tonalityEnabled: false,
  nsfwEnabled: false,
  globalInstructions: '',
  personaInstructions: 'You are a helpful companion.',
  aboutMe: '',
  projectInstructions: '',
  memoryContext: '',
  toolsInstruction: '',
};

describe('tools segment', () => {
  it('includes the tools instruction in a chat prompt when present', () => {
    const out = buildPrompt({ ...baseInputs, toolsInstruction: 'Use calculate_js for maths.' }, 'chat');
    expect(out).toContain('Use calculate_js for maths.');
  });

  it('omits the tools instruction for the title job (chat-only)', () => {
    const out = buildPrompt({ ...baseInputs, toolsInstruction: 'Use calculate_js for maths.' }, 'title');
    expect(out).not.toContain('calculate_js');
  });

  it('drops the segment when the instruction is empty', () => {
    const out = buildPrompt(baseInputs, 'chat');
    expect(out).toBe('You are a helpful companion.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/llm-unified && bun test src/composition.test.ts`
Expected: FAIL — `toolsInstruction` is not a property of `BuildPromptInputs` (type error) / segment missing.

- [ ] **Step 3: Edit `composition.ts`**

Add the field to `BuildPromptInputs` (after `memoryContext`):

```ts
  /** Reserved slot — no producer yet. */
  memoryContext: string;
  /** Band-3 tools segment — joined tool system-prompt instructions (chat only). */
  toolsInstruction: string;
```

Add `'tools'` to the `SegmentId` union:

```ts
type SegmentId = 'tonality' | 'nsfw' | 'global' | 'persona' | 'aboutMe' | 'project' | 'memories' | 'tools';
```

Add the segment to the `SEGMENTS` array (after the `memories` entry):

```ts
  { id: 'memories', band: 2, order: 2, jobs: CHAT_ONLY, resolve: (i) => i.memoryContext },
  { id: 'tools', band: 3, order: 0, jobs: CHAT_ONLY, resolve: (i) => i.toolsInstruction },
```

- [ ] **Step 4: Update the three callers so they typecheck**

In `apps/user-client/src/lib/stream-engine.ts`, the `buildPrompt` input object (currently ending `memoryContext: ''`) gains:

```ts
      projectInstructions: '',
      memoryContext: '',
      toolsInstruction: args.toolsInstruction ?? '',
```

(`args.toolsInstruction` is added to `StartStreamArgs` in Task 6; for this task add `toolsInstruction: ''` literally, then change to `args.toolsInstruction ?? ''` in Task 6.)

In `apps/user-client/src/lib/title-generator.ts` and `apps/user-client/src/routes/app/chat-page.tsx`, find every object literal passed to `buildPrompt(...)` and add `toolsInstruction: ''` alongside `memoryContext: ''`.

Locate them:

Run: `rg -n "memoryContext" apps/user-client/src/lib/title-generator.ts apps/user-client/src/routes/app/chat-page.tsx`

Add `toolsInstruction: ''` to each matched object literal.

- [ ] **Step 5: Run the tests + typecheck to verify they pass**

Run: `cd packages/llm-unified && bun test src/composition.test.ts`
Expected: PASS (existing cases + 3 new).

Run: `pnpm typecheck`
Expected: PASS (all callers supply `toolsInstruction`).

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/composition.ts packages/llm-unified/src/composition.test.ts apps/user-client/src/lib/stream-engine.ts apps/user-client/src/lib/title-generator.ts apps/user-client/src/routes/app/chat-page.tsx
git commit -m "Add Band-3 tools segment to the prompt builder

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: stream-engine — tools, toolExchange, toolsInstruction inputs

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts`
- Test: `apps/user-client/src/lib/stream-engine.test.ts`

> Extract a pure `buildEngineWireMessages` helper so the toolExchange-append behaviour is unit-testable without a network stream. Pills default to `pending` (the call was made; execution is the loop's job).

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/lib/stream-engine.test.ts
import { describe, expect, it } from 'vitest';
import type { WireMessage } from '@chatsundere/llm-unified';
import { buildEngineWireMessages } from './stream-engine.js';
import type { MessageRow } from '../boot/client-data-db.js';

const prior: MessageRow[] = [
  { id: 'm1', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'hi' }], createdAt: 1, bookmarked: false, streamingState: 'complete' },
  { id: 'm2', chatId: 'c1', role: 'persona', contentBlocks: [{ type: 'text', text: 'hello' }], createdAt: 2, bookmarked: false, streamingState: 'complete' },
];

describe('buildEngineWireMessages', () => {
  it('produces system + history + active user turn with no tool exchange', () => {
    const out = buildEngineWireMessages('SYS', prior, 'how many r in strawberry?', []);
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(out.at(-1)).toEqual({ role: 'user', content: 'how many r in strawberry?' });
  });

  it('appends the tool exchange after the active user turn', () => {
    const exchange: WireMessage[] = [
      { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'calculate_js', arguments: '{"code":"3"}' } }] },
      { role: 'tool', tool_call_id: 't1', content: '3' },
    ];
    const out = buildEngineWireMessages('SYS', prior, 'q', exchange);
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'tool']);
    expect(out.at(-1)).toEqual({ role: 'tool', tool_call_id: 't1', content: '3' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/stream-engine.test.ts`
Expected: FAIL — `buildEngineWireMessages` is not exported.

- [ ] **Step 3: Edit `stream-engine.ts`**

Add the new optional fields to `StartStreamArgs` (after `globalAboutMe`):

```ts
  globalAboutMe: string;
  /** Joined tool system-prompt instructions for the Band-3 tools segment. */
  toolsInstruction?: string;
  /** Canonical tool definitions to offer the model (empty = none). */
  tools?: import('@chatsundere/llm-unified').ToolDef[];
  /** Accumulated assistant(tool_calls) / tool messages from prior loop rounds,
   *  appended after the active user turn. */
  toolExchange?: WireMessage[];
  signal: AbortSignal;
```

Change the `buildPrompt` input `toolsInstruction: ''` (added in Task 5) to:

```ts
      toolsInstruction: args.toolsInstruction ?? '',
```

Replace the inline `wireMessages` construction with the extracted helper:

```ts
  const wireMessages = buildEngineWireMessages(
    systemPrompt,
    args.priorMessages,
    args.userMessageText,
    args.toolExchange ?? [],
  );
```

Add `tools` to the `streamCompletion(...)` call args (alongside `cacheKey`):

```ts
    cacheKey: args.chat.id,
    tools: args.tools,
    signal: args.signal,
```

Change the pill `status` from `'completed'` to `'pending'` (the loop sets the final status):

```ts
        positionHint: 'inline',
        status: 'pending',
        payload: {
```

Add the exported helper near `toWireMessage` (and ensure `toWireMessage` stays as-is):

```ts
/**
 * Assemble the wire message list for one engine pass: system prompt, replayed
 * history, the active user turn, then any accumulated tool exchange from prior
 * loop rounds. Extracted so the tool-exchange placement is unit-testable.
 */
export function buildEngineWireMessages(
  systemPrompt: string,
  priorMessages: MessageRow[],
  userMessageText: string,
  toolExchange: WireMessage[],
): WireMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...priorMessages.map(toWireMessage),
    { role: 'user', content: userMessageText },
    ...toolExchange,
  ];
}
```

- [ ] **Step 4: Run the test + typecheck to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/stream-engine.test.ts`
Expected: PASS (2 tests).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts apps/user-client/src/lib/stream-engine.test.ts
git commit -m "Thread tools, toolExchange, and tools instruction through stream-engine

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: The tool-execution loop (pure)

**Files:**
- Create: `apps/user-client/src/lib/tool-loop.ts`
- Test: `apps/user-client/src/lib/tool-loop.test.ts`

> This is the centrepiece: a pure orchestrator with `streamOnce` and `dispatch` injected, so it is fully unit-testable without network or Workers.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/src/lib/tool-loop.test.ts
import { describe, expect, it } from 'vitest';
import type { StreamEngineResult } from './stream-engine.js';
import { type ToolLoopDeps, runToolLoop } from './tool-loop.js';
import type { PillRow } from '../boot/client-data-db.js';

function toolCallPill(id: string, name: string, argumentsJson: string): PillRow {
  return {
    id, messageId: '', kind: 'tool-call', positionHint: 'inline', status: 'pending',
    payload: { name, argumentsJson, toolCallId: id }, createdAt: 0,
  };
}

function textResult(text: string): StreamEngineResult {
  return { finalContentBlocks: [{ type: 'text', text }], pillRows: [], finishReason: 'stop' };
}

describe('runToolLoop', () => {
  it('passes through a single round with no tool calls', async () => {
    const calls: number[] = [];
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 5,
      streamOnce: async () => { calls.push(1); return textResult('plain answer'); },
      dispatch: async () => ({ ok: true, output: '', error: null }),
    };
    const result = await runToolLoop(deps);
    expect(calls.length).toBe(1);
    expect(result.finalContentBlocks).toEqual([{ type: 'text', text: 'plain answer' }]);
  });

  it('executes a tool call, feeds the result back, and re-streams to an answer', async () => {
    const exchanges: number[] = [];
    let round = 0;
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 5,
      streamOnce: async (toolExchange, tools) => {
        exchanges.push(toolExchange.length);
        if (round++ === 0) {
          expect(tools.length).toBe(1); // tools offered on round 0
          return { finalContentBlocks: [{ type: 'pill', pillId: 'p1' }], pillRows: [toolCallPill('p1', 'calculate_js', '{"code":"2+2"}')], finishReason: 'tool_calls' };
        }
        return textResult('The answer is 4.');
      },
      dispatch: async (name, args) => {
        expect(name).toBe('calculate_js');
        expect(args).toEqual({ code: '2+2' });
        return { ok: true, output: '4', error: null };
      },
    };
    const result = await runToolLoop(deps);
    expect(exchanges).toEqual([0, 2]); // round 1 sees assistant(tool_calls) + tool result
    expect(result.finalContentBlocks).toEqual([{ type: 'pill', pillId: 'p1' }, { type: 'text', text: 'The answer is 4.' }]);
    const pill = result.pillRows[0];
    expect(pill?.status).toBe('completed');
    expect((pill?.payload as { result?: string }).result).toBe('4');
  });

  it('marks a failed tool call and still feeds the error back', async () => {
    let round = 0;
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 5,
      streamOnce: async () =>
        round++ === 0
          ? { finalContentBlocks: [{ type: 'pill', pillId: 'p1' }], pillRows: [toolCallPill('p1', 'calculate_js', 'not json')], finishReason: 'tool_calls' }
          : textResult('Recovered.'),
      dispatch: async () => ({ ok: false, output: 'ReferenceError: x', error: 'ReferenceError: x' }),
    };
    const result = await runToolLoop(deps);
    expect(result.pillRows[0]?.status).toBe('failed');
  });

  it('forces a tools-less final round after maxRounds tool rounds', async () => {
    const toolsSeen: number[] = [];
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 2,
      streamOnce: async (_exchange, tools) => {
        toolsSeen.push(tools.length);
        // Always wants to call again.
        return { finalContentBlocks: [{ type: 'pill', pillId: `p${toolsSeen.length}` }], pillRows: [toolCallPill(`p${toolsSeen.length}`, 'calculate_js', '{"code":"1"}')], finishReason: 'tool_calls' };
      },
      dispatch: async () => ({ ok: true, output: '1', error: null }),
    };
    await runToolLoop(deps);
    // rounds 0,1 offer the tool; round 2 (>= maxRounds) forces no tools.
    expect(toolsSeen).toEqual([1, 1, 0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/tool-loop.test.ts`
Expected: FAIL — cannot find module `./tool-loop.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/lib/tool-loop.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolDef, WireMessage, WireToolCall } from '@chatsundere/llm-unified';
import type { ContentBlock, PillRow } from '../boot/client-data-db.js';
import { flattenAnswerText } from './content-blocks.js';
import type { StreamEngineResult } from './stream-engine.js';
import type { ToolResult } from '../tools/types.js';

/** Default cap on tool-executing rounds before a tools-less answer is forced. */
export const MAX_TOOL_ROUNDS = 5;

export interface ToolLoopDeps {
  /** Run one engine pass with the given accumulated tool exchange and offered tools. */
  streamOnce: (toolExchange: WireMessage[], tools: ToolDef[]) => Promise<StreamEngineResult>;
  /** Execute a tool by name. */
  dispatch: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
  /** Tool definitions offered on tool-executing rounds. */
  toolDefs: ToolDef[];
  /** Max tool-executing rounds (rounds 0..maxRounds-1); defaults via the binding. */
  maxRounds: number;
  /** Optional callback fired when a pill's status/payload changes, for live UI. */
  onPillUpdate?: (pill: PillRow) => void;
  /** Optional abort signal forwarded to tool execution. */
  signal?: AbortSignal;
}

interface ToolCallPayload {
  name: string;
  argumentsJson: string;
  toolCallId: string;
  result?: string;
  error?: string;
}

function parseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Drive the model→tool→model round-trip. Each round streams one engine pass and
 * accumulates its content/pill blocks. If the model emitted tool-call pills, each
 * is executed (status pending→completed/failed), an `assistant(tool_calls)`
 * message plus one `tool` message per call is appended to the exchange, and the
 * loop re-streams. After `maxRounds` tool rounds, one final pass runs with no
 * tools so the model must answer.
 */
export async function runToolLoop(deps: ToolLoopDeps): Promise<StreamEngineResult> {
  const allBlocks: ContentBlock[] = [];
  const allPills: PillRow[] = [];
  const toolExchange: WireMessage[] = [];
  let finishReason: StreamEngineResult['finishReason'] = 'unknown';

  for (let round = 0; ; round++) {
    const forceAnswer = round >= deps.maxRounds;
    const result = await deps.streamOnce(toolExchange, forceAnswer ? [] : deps.toolDefs);

    allBlocks.push(...result.finalContentBlocks);
    allPills.push(...result.pillRows);
    finishReason = result.finishReason;

    const toolPills = result.pillRows.filter((p) => p.kind === 'tool-call');
    if (toolPills.length === 0 || forceAnswer) break;

    const toolCalls: WireToolCall[] = [];
    const toolMessages: WireMessage[] = [];
    for (const pill of toolPills) {
      const payload = pill.payload as ToolCallPayload;
      pill.status = 'pending';
      deps.onPillUpdate?.(pill);

      const r = await deps.dispatch(payload.name, parseArgs(payload.argumentsJson), deps.signal);
      const content = r.ok ? r.output : (r.error ?? r.output);
      pill.status = r.ok ? 'completed' : 'failed';
      pill.payload = { ...payload, result: r.ok ? r.output : undefined, error: r.ok ? undefined : (r.error ?? '') };
      deps.onPillUpdate?.(pill);

      toolCalls.push({ id: payload.toolCallId, type: 'function', function: { name: payload.name, arguments: payload.argumentsJson } });
      toolMessages.push({ role: 'tool', tool_call_id: payload.toolCallId, content });
    }

    // The assistant message that made the calls; content = any text it emitted
    // this round (usually empty for a pure tool-call turn).
    toolExchange.push({ role: 'assistant', content: flattenAnswerText(result.finalContentBlocks), tool_calls: toolCalls });
    toolExchange.push(...toolMessages);
  }

  return { finalContentBlocks: allBlocks, pillRows: allPills, finishReason };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/lib/tool-loop.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/tool-loop.ts apps/user-client/src/lib/tool-loop.test.ts
git commit -m "Add pure tool-execution loop (round-trip orchestrator)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: Bind the loop into the stream-manager

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`

> Glue task — the store is integration-heavy and untested in the repo; correctness rests on the pure Task 7 tests plus typecheck and manual verification. Replace the single `runStreamEngine` call inside `runIntoDraft` with a `runToolLoop` binding whose `streamOnce` calls `runStreamEngine` with the growing tool exchange + gated tools, and whose `dispatch` is the registry.

- [ ] **Step 1: Add imports**

At the top of `stream-manager.store.ts`:

```ts
import { type StartStreamArgs, runStreamEngine } from '../lib/stream-engine.js';
import { MAX_TOOL_ROUNDS, runToolLoop } from '../lib/tool-loop.js';
import { dispatch as dispatchTool, systemPromptSegment, toolDefs } from '../tools/registry.js';
```

- [ ] **Step 2: Replace the `runStreamEngine({...}).then(...)` call in `runIntoDraft`**

Currently `runIntoDraft` calls `runStreamEngine({ ...args, signal, onChunk })`. Replace **only the call expression** (the `runStreamEngine({...})` that the `.then(...)`/`.catch(...)` chain hangs off) with `runToolLoop({...})`, keeping the existing `.then`/`.catch` chain unchanged. Insert this just before the call:

```ts
  const toolsActive = args.offering.profile.toolCalls.supported;
  const activeToolDefs = toolsActive ? toolDefs() : [];
  const toolsInstruction = toolsActive ? (systemPromptSegment() ?? '') : '';

  const onChunk = (chunk: import('@chatsundere/llm-unified').StreamChunk): void => {
    if (chunk.type !== 'token' && chunk.type !== 'reasoning') return;
    set((s) => {
      const live = s.streams.get(args.chatId);
      if (!live) return s;
      const nextBuf = [...live.contentBuffer];
      appendStreamChunk(nextBuf, { kind: chunk.type === 'reasoning' ? 'reasoning' : 'text', text: chunk.text });
      const m = new Map(s.streams);
      m.set(args.chatId, { ...live, contentBuffer: nextBuf });
      return { streams: m };
    });
  };

  runToolLoop({
    toolDefs: activeToolDefs,
    maxRounds: MAX_TOOL_ROUNDS,
    dispatch: (name, toolArgs, signal) => dispatchTool(name, toolArgs, signal),
    signal: controller.signal,
    streamOnce: (toolExchange, tools) =>
      runStreamEngine({
        ...args,
        toolsInstruction,
        tools,
        toolExchange,
        signal: controller.signal,
        onChunk,
      }),
  })
```

Then delete the now-duplicated inline `onChunk` that was passed to the old `runStreamEngine` call (the `onChunk: (chunk) => {...}` object property), since `onChunk` is now a named const reused per round. The `.then(async (result) => {...})` and `.catch(...)` blocks stay exactly as they are — `result` is still a `StreamEngineResult`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS. (`args.offering.profile.toolCalls.supported` is valid — see `packages/llm-unified/src/catalogue/types.ts` `ModelProfile.toolCalls`.)

- [ ] **Step 4: Run the existing chat tests to confirm no regression**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/routes/app/chat-route.test.tsx`
Expected: PASS (or the same pre-existing baseline failures noted in STATUS — confirm none are newly introduced by this change).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts
git commit -m "Wire the tool-execution loop into the stream-manager

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 9: Live pill status mirroring

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx`

> So the pill appears (status `pending`) the moment a tool call is being executed and flips to `completed`/`failed` live, rather than popping in at finalise. The `StreamHandle.pillBuffer` slot already exists.

- [ ] **Step 1: Add an `onPillUpdate` to the `runToolLoop` binding in `runIntoDraft`**

Inside the `runToolLoop({...})` options object from Task 8, add:

```ts
    onPillUpdate: (pill) => {
      set((s) => {
        const live = s.streams.get(args.chatId);
        if (!live) return s;
        // Upsert the pill into the live pill buffer (status changes in place).
        const pillBuffer = live.pillBuffer.some((p) => p.id === pill.id)
          ? live.pillBuffer.map((p) => (p.id === pill.id ? { ...pill } : p))
          : [...live.pillBuffer, { ...pill }];
        // Ensure a pill block exists in the live content buffer so it renders.
        const hasBlock = live.contentBuffer.some((b) => b.type === 'pill' && b.pillId === pill.id);
        const contentBuffer = hasBlock
          ? live.contentBuffer
          : [...live.contentBuffer, { type: 'pill' as const, pillId: pill.id }];
        const m = new Map(s.streams);
        m.set(args.chatId, { ...live, pillBuffer, contentBuffer });
        return { streams: m };
      });
    },
```

- [ ] **Step 2: Merge the live pill buffer in `ChatStream.tsx`**

`ChatStream` builds `const pillMap = new Map(p.pills.map((x) => [x.id, x]));` (around line 92). Replace it so live draft pills are included:

```ts
  const pillMap = new Map(p.pills.map((x) => [x.id, x]));
  if (p.streamHandle) {
    for (const pill of p.streamHandle.pillBuffer) pillMap.set(pill.id, pill);
  }
```

- [ ] **Step 3: Verify typecheck + build**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm build`
Expected: PASS (the `sandbox.worker.ts` resolves as a Vite Worker chunk via `new URL(..., import.meta.url)`).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts apps/user-client/src/components/chat/ChatStream.tsx
git commit -m "Mirror live tool-pill status into the streaming draft

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 10: Pill — tap-to-expand with code + result/error

**Files:**
- Modify: `apps/user-client/src/components/chat/Pill.tsx`
- Test: `apps/user-client/src/components/chat/Pill.test.tsx`

> Mechanics + states only. The opulent styling pass is a separate cycle Chris drives.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/src/components/chat/Pill.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../boot/client-data-db.js';
import { Pill } from './Pill.js';

function calcPill(over: Partial<PillRow> = {}): PillRow {
  return {
    id: 'p1', messageId: 'm1', kind: 'tool-call', positionHint: 'inline', status: 'completed',
    payload: { name: 'calculate_js', argumentsJson: '{"code":"[...\\"strawberry\\"].filter(c=>c===\\"r\\").length"}', result: '3' },
    createdAt: 0, ...over,
  };
}

describe('Pill (tool-call)', () => {
  it('renders the tool name collapsed and the status attribute', () => {
    render(<Pill row={calcPill()} />);
    expect(screen.getByText('calculate_js')).toBeInTheDocument();
    expect(screen.queryByText(/strawberry/)).not.toBeInTheDocument();
  });

  it('expands on click to show the code and the result', () => {
    render(<Pill row={calcPill()} />);
    fireEvent.click(screen.getByText('calculate_js'));
    expect(screen.getByText(/strawberry/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows the error when the call failed', () => {
    render(<Pill row={calcPill({ status: 'failed', payload: { name: 'calculate_js', argumentsJson: '{"code":"x"}', error: 'ReferenceError: x is not defined' } })} />);
    fireEvent.click(screen.getByText('calculate_js'));
    expect(screen.getByText(/ReferenceError/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/chat/Pill.test.tsx`
Expected: FAIL — the pill has no expand behaviour / no code or result rendered.

- [ ] **Step 3: Edit `Pill.tsx`**

Replace the file body with (keeping the SPDX header and the existing `ICON` / `above-text` recursion):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PillRow } from '../../boot/client-data-db.js';

const ICON: Record<PillRow['kind'], string> = {
  'tool-call': '⚙',
  'kb-injection': '◆',
  'image-result': '▢',
  'voice-expression': '~',
};

interface PillPayloadShape {
  name?: string;
  kbName?: string;
  expression?: string;
  argumentsJson?: string;
  result?: string;
  error?: string;
}

function labelFor(row: PillRow): string {
  const p = row.payload as PillPayloadShape | undefined;
  if (row.kind === 'tool-call') return p?.name ?? 'tool';
  if (row.kind === 'kb-injection') return `KB${p?.kbName ? ` ${p.kbName}` : ''}`;
  if (row.kind === 'image-result') return 'image';
  return p?.expression ?? 'voice';
}

/** Pull the `code` argument out of the stored arguments JSON for display. */
function codeOf(p: PillPayloadShape | undefined): string | null {
  if (!p?.argumentsJson) return null;
  try {
    const parsed = JSON.parse(p.argumentsJson) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : p.argumentsJson;
  } catch {
    return p.argumentsJson;
  }
}

export function Pill({ row }: { row: PillRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  if (row.positionHint === 'above-text') {
    const inlineRow: PillRow = { ...row, positionHint: 'inline' };
    return (
      <div className="pill-above">
        <Pill row={inlineRow} />
      </div>
    );
  }

  const payload = row.payload as PillPayloadShape | undefined;
  const expandable = row.kind === 'tool-call' && (!!codeOf(payload) || !!payload?.result || !!payload?.error);
  const code = codeOf(payload);

  return (
    <span className="pill-wrap">
      <button
        type="button"
        className="pill"
        data-pill-kind={row.kind}
        data-pill-status={row.status}
        data-pill-expandable={expandable || undefined}
        aria-expanded={expandable ? expanded : undefined}
        onClick={expandable ? () => setExpanded((v) => !v) : undefined}
      >
        <span className="pill-icon">{ICON[row.kind]}</span>
        {labelFor(row)}
      </button>
      {expandable && expanded && (
        <span className="pill-detail">
          {code !== null && (
            <code className="pill-detail-code">{code}</code>
          )}
          {payload?.result !== undefined && (
            <code className="pill-detail-result">{payload.result}</code>
          )}
          {payload?.error && (
            <code className="pill-detail-error">{payload.error}</code>
          )}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/chat/Pill.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add minimal structural CSS**

In `apps/user-client/src/index.css`, add (a styling pass refines this later; this is just so the detail block renders legibly):

```css
.pill-wrap { display: inline-flex; flex-direction: column; gap: 0.25rem; }
.pill[data-pill-expandable] { cursor: pointer; }
.pill[data-pill-status='pending'] .pill-icon { opacity: 0.6; }
.pill[data-pill-status='failed'] { color: var(--colour-danger, #d66); }
.pill-detail { display: flex; flex-direction: column; gap: 0.25rem; }
.pill-detail-code,
.pill-detail-result,
.pill-detail-error { font-family: var(--font-mono, monospace); white-space: pre-wrap; font-size: 0.85em; }
```

- [ ] **Step 6: Verify typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/components/chat/Pill.tsx apps/user-client/src/components/chat/Pill.test.tsx apps/user-client/src/index.css
git commit -m "Make tool-call pills expandable to show code and result

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 11: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full typecheck (the CI gate)**

Run: `pnpm typecheck`
Expected: PASS — 13/13 packages (the established baseline).

- [ ] **Step 2: Run the full llm-unified test suite**

Run: `cd packages/llm-unified && bun test`
Expected: PASS — the established count plus the 3 new composition cases, 0 fail.

- [ ] **Step 3: Run the full user-client test suite**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: the new tests (`sandbox-exec`, `calculate-js`, `registry`, `stream-engine`, `tool-loop`, `Pill`) PASS; the only failures are the **pre-existing** `cockpit-draft` / `chat-page` / `chat-route` localStorage-jsdom baseline (8 fail) — confirm the count is unchanged versus master and that no new file regressed.

- [ ] **Step 4: Run the full build**

Run: `pnpm build`
Expected: PASS — `sandbox.worker.ts` emitted as its own Worker chunk.

- [ ] **Step 5: Record the security-sensitive surface**

Append a dated note to `obsidian/insights/security-deferrals.md`: the client-side JavaScript-eval sandbox executes model-generated code in a fresh Web Worker with network/storage globals nulled; pure compute only; revisit the boundary (origin-isolated iframe) only if a future tool needs DOM access. (Not a Larissa-gated change — no auth/sync/proxy/crypto.) Commit with `[skip ci]`.

- [ ] **Step 6: Manual verification (Chris, on device)**

Confirm the six steps in the spec (§11): the strawberry question returns 3 via a pill; tap to expand shows code + result; a multi-step chain resolves; a provoked sandbox error is fed back and recovered; a maths-free chat is unchanged; a reloaded past pill still expands.

---

## Self-Review notes (author)

- **Spec coverage:** §3 registry → Tasks 3,4; §4 calculate_js + sandbox → Tasks 1,2,3; §4.4 instruction → Task 3; §5 loop (`MAX_TOOL_ROUNDS=5`, global count, force-answer) → Task 7 + binding Task 8; §6 pill expand + status → Tasks 9,10; §7 persistence/replay boundary → Task 8 (`.then` persists `result.pillRows`; no cross-turn replay added); §8 error handling → Task 7 (failed pill, error fed back) + Task 10 (error display); §9 tests → Tasks 1,3,4,5,6,7,10; §10 security note → Task 11 Step 5; §11 manual verification → Task 11 Step 6.
- **Status mapping:** the spec's "running" maps to `PillRow.status === 'pending'` (the real union); ok→`completed`, error→`failed`. Used consistently in Tasks 6, 7, 9, 10.
- **Type consistency:** `runToolLoop` returns `StreamEngineResult` so the store's existing `.then(result => …)` is unchanged. `streamOnce(toolExchange, tools)` signature matches the binding in Task 8 and the engine inputs in Task 6. `assembleOutput` / `executeCode` / `SandboxRun` names are consistent across Tasks 1–3.
- **Gating:** tools are offered only when `offering.profile.toolCalls.supported` (Task 8) — a safety net, not a user toggle.
