// SPDX-License-Identifier: AGPL-3.0-only

const FONT_VAR: Record<'sans' | 'serif' | 'cursive', string> = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-display)',
  cursive: 'var(--font-display)',
};

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
