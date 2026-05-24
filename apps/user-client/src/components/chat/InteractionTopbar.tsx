// SPDX-License-Identifier: AGPL-3.0-only
import type { PersonaRow } from '../../boot/client-data-db.js';
import { contextUtilisation } from '../../lib/token-estimator.js';

interface Props {
  persona: PersonaRow;
  usedTokens: number;
  contextWindow: number;
  onExit: () => void;
}

export function InteractionTopbar(p: Props): JSX.Element {
  const pct = contextUtilisation(p.usedTokens, p.contextWindow);
  return (
    <div className="interaction-topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="hamburger-btn"
          aria-label="Exit to Entrance Hall"
          onClick={p.onExit}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            width="24"
            height="24"
            aria-hidden="true"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </div>
      <div className="topbar-center">
        <div className="context-label">Chat with</div>
        <div className="context-name" style={{ color: p.persona.colour }}>
          {p.persona.name}
        </div>
      </div>
      <div className="topbar-right">
        <div className="status-group">
          <div className="journal-indicator" title="Uncommitted journal entries">
            <span className="journal-dot" />
            <span>0</span>
          </div>
          <div className="context-gauge" title="Context window">
            <div className="context-gauge-bar">
              <div className="context-gauge-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="context-gauge-text">{pct}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}
