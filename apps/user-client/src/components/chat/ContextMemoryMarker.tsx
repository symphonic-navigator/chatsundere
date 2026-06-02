// SPDX-License-Identifier: AGPL-3.0-only

/** Quiet inline marker: messages above this point are no longer in the model's
 *  context window. They remain in the DB and are still readable — the model
 *  simply does not see them on the next turn. */
export function ContextMemoryMarker(): JSX.Element {
  return (
    <div
      data-context-memory-marker
      className="my-3 flex items-center gap-2 px-3 text-[11px] uppercase tracking-wider text-paper-soft/60"
    >
      <span className="h-px flex-1 bg-white/10" />
      <span className="rounded bg-white/5 px-2 py-0.5 font-mono">
        Earlier messages are out of the model's memory
      </span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}
