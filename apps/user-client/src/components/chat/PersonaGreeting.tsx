// SPDX-License-Identifier: AGPL-3.0-only

import { Link } from 'react-router-dom';
import { FONT_VAR } from '../../lib/persona-font.js';

interface PersonaGreetingProps {
  name: string;
  font: 'sans' | 'serif' | 'cursive';
  colour: string;
  /** Constructive opener-failure notice (spec §6.4); rendered beneath the idle line. */
  notice?: string;
  onRetry?: () => void;
  /** Why the greeting can't be composed, when it is a key or passphrase problem. */
  cause?: string;
  /** The way out for `cause`; shown in place of Retry, which could not succeed. */
  action?: { label: string; to: string };
}

/** Displayed in the centre of the chat stream pane when there are no messages yet. */
export function PersonaGreeting(p: PersonaGreetingProps): JSX.Element {
  return (
    <div className="persona-greeting-wrap">
      <div
        className="persona-greeting"
        style={{ color: p.colour, fontFamily: FONT_VAR[p.font], opacity: 0.4 }}
      >
        {p.name} is listening
      </div>
      {p.notice ? (
        <div className="persona-greeting-notice">
          <span>{p.notice}</span>
          {p.cause ? <span>{p.cause}</span> : null}
          {p.action ? (
            <Link to={p.action.to} className="persona-greeting-retry">
              {p.action.label}
            </Link>
          ) : p.onRetry ? (
            <button type="button" className="persona-greeting-retry" onClick={p.onRetry}>
              ↻ Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
