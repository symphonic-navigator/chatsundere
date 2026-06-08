// SPDX-License-Identifier: AGPL-3.0-only

/** Minimal server shape this section needs. */
interface ServerLite {
  id: string;
  name: string;
  onByDefault: boolean;
  enabled: boolean;
}

/** Per-persona tri-state MCP overrides: Default (falls back to the server's
 *  onByDefault), On (force-enable), or Off (force-disable). */
export function McpOverrideSection(props: {
  servers: ServerLite[];
  overrides: Record<string, 'on' | 'off'>;
  onChange: (next: Record<string, 'on' | 'off'>) => void;
}): JSX.Element {
  const enabled = props.servers.filter((s) => s.enabled);
  const set = (id: string, value: 'default' | 'on' | 'off') => {
    const next = { ...props.overrides };
    if (value === 'default') delete next[id];
    else next[id] = value;
    props.onChange(next);
  };
  if (enabled.length === 0) {
    return (
      <p className="text-[11px] text-paper-soft">
        No MCP servers configured. Add one in My Settings → MCP Servers.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {enabled.map((s) => {
        const current = props.overrides[s.id] ?? 'default';
        return (
          <div key={s.id} className="flex items-center justify-between gap-2">
            <span className="text-sm text-paper">{s.name}</span>
            <div className="flex gap-1">
              {(['default', 'on', 'off'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={current === v}
                  aria-label={`${s.name} ${v}`}
                  onClick={() => set(s.id, v)}
                  className={
                    current === v
                      ? 'rounded bg-white/10 px-2 py-1 text-xs text-paper'
                      : 'rounded px-2 py-1 text-xs text-paper-soft'
                  }
                >
                  {v === 'default'
                    ? `Default (${s.onByDefault ? 'on' : 'off'})`
                    : v === 'on'
                      ? 'On'
                      : 'Off'}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
