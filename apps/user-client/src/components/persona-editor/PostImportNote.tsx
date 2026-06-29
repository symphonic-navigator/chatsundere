// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shown once at the top of the persona editor when arriving from a
 * Chatsundere persona pack import. Renders only the clauses that apply:
 * - model clause when the pack's model could not be auto-bound locally
 * - bindings clause always when live bindings (libraries, MCP) were dropped
 * Returns null when there is nothing to say.
 */
export function PostImportNote({
  modelBound,
  droppedBindings,
}: {
  modelBound: boolean;
  droppedBindings: boolean;
}): JSX.Element | null {
  if (modelBound && !droppedBindings) return null;

  return (
    <div
      role="note"
      className="mb-3 rounded-md border border-paper-soft/20 bg-white/[0.02] p-3 text-[11px] text-paper-soft"
    >
      {!modelBound ? <p>Pick a model to start chatting.</p> : null}
      {droppedBindings ? (
        <p className={!modelBound ? 'mt-1' : undefined}>
          Library links and MCP settings are device-specific and don't transfer — re-add them in
          this persona's settings.
        </p>
      ) : null}
    </div>
  );
}
