// SPDX-License-Identifier: LGPL-3.0-only

export interface CompositionLayers {
  globalUnlocker: string;
  aboutMe: string;
  personaInstructions: string;
  projectInstructions: string;
  memoryContext: string;
}

const LAYER_ORDER: readonly (keyof CompositionLayers)[] = [
  'globalUnlocker',
  'aboutMe',
  'personaInstructions',
  'projectInstructions',
  'memoryContext',
];

/**
 * Compose the final system prompt from independently-editable layers.
 * Order (top → bottom) per UX-CONCEPT § "System Prompt Composition":
 * Global Unlocker → About-Me → Persona-Instructions → Project-Instructions
 * → Memory-Context. Whitespace-only layers are treated as empty and
 * skipped. The composed prompt becomes the `system` role content.
 */
export function composeSystemPrompt(layers: CompositionLayers): string {
  if (layers.personaInstructions.trim().length === 0) {
    throw new Error('composeSystemPrompt: personaInstructions must be non-empty');
  }
  const parts: string[] = [];
  for (const key of LAYER_ORDER) {
    const value = layers[key];
    if (value.trim().length > 0) parts.push(value.trim());
  }
  return parts.join('\n\n');
}
