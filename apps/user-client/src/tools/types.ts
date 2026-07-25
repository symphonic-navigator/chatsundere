// SPDX-License-Identifier: AGPL-3.0-only

/** Incremental progress a tool may report while executing (for live pills). */
export interface ToolProgress {
  charCount: number;
  /** Multi-phase tools report which phase the count belongs to.
   *  ask_expert: 'reasoning'/'answer' (+ 'searching'/'fetching' with web).
   *  artefact craft (modify/inspect): 'starting'/'reading'/'writing'/'explaining'/'building'/'done'.
   *  Optional — single-phase tools (create author) may omit it. */
  phase?:
    | 'reasoning'
    | 'answer'
    | 'searching'
    | 'fetching'
    | 'reading'
    | 'writing'
    | 'explaining'
    | 'building'
    | 'starting'
    | 'done';
  /** Optional human-readable detail for the phase (search query, fetched host). */
  detail?: string;
}

/** The outcome of executing a tool. `output` is handed to the model verbatim
 *  as the `tool` message content; `error` is set (and `ok` false) on failure. */
export interface ToolResult {
  ok: boolean;
  output: string;
  error: string | null;
  /** Optional structured data merged into the pill payload (e.g. an artefact id). */
  meta?: Record<string, unknown>;
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
  execute(
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onProgress?: (p: ToolProgress) => void,
  ): Promise<ToolResult>;
}
