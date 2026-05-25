// SPDX-License-Identifier: AGPL-3.0-only

import { FONT_VAR } from '../../lib/persona-font.js';

interface PersonaGreetingProps {
  name: string;
  font: 'sans' | 'serif' | 'cursive';
  colour: string;
}

/** Displayed in the centre of the chat stream pane when there are no messages yet. */
export function PersonaGreeting(p: PersonaGreetingProps): JSX.Element {
  return (
    <div
      className="persona-greeting"
      style={{ color: p.colour, fontFamily: FONT_VAR[p.font], opacity: 0.4 }}
    >
      {p.name} is listening
    </div>
  );
}
