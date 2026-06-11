// SPDX-License-Identifier: AGPL-3.0-only

import { FONT_VAR } from '../../lib/persona-font.js';

interface PersonaGreetingProps {
  name: string;
  font: 'sans' | 'serif' | 'cursive';
  colour: string;
  /** Constructive opener-failure notice (spec §6.4); rendered beneath the idle line. */
  notice?: string;
  onRetry?: () => void;
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
          {p.onRetry ? (
            <button type="button" className="persona-greeting-retry" onClick={p.onRetry}>
              ↻ Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
