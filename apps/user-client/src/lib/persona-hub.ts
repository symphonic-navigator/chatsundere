// SPDX-License-Identifier: AGPL-3.0-only
import { getCanonical, isUnsuitableAsBackgroundWorker } from '@chatsundere/llm-unified';
import type { MindspaceRow, PersonaRow } from '../boot/client-data-db.js';
import { hasBackgroundHelper } from '../data/resolve-background-offering.js';

/** A persona that cannot yet chat: missing instructions or a complete model choice. */
export function isPersonaIncomplete(p: PersonaRow): boolean {
  return missingRequirement(p) !== null;
}

/** The first unmet requirement, model before instructions, or null when complete. */
export function missingRequirement(p: PersonaRow): 'model' | 'instructions' | null {
  if (!p.canonicalId || !p.providerId || !p.modelId) return 'model';
  if (!p.instructions.trim()) return 'instructions';
  return null;
}

export function instructionsMeta(p: PersonaRow): string {
  if (!p.instructions.trim()) return 'Needs setup';
  const voice = p.chatsundereTonality ? 'Chatsundere voice' : 'Plain voice';
  return p.adultPersona ? `${voice} · Adult` : voice;
}

export function roleplayMeta(p: PersonaRow): string {
  if (!p.roleplay) return 'Off';
  const person = p.narration === 'third' ? 'Third person' : 'First person';
  return p.greetingEnabled ? `${person} · Greeting` : person;
}

export function modelBehaviourMeta(p: PersonaRow): string {
  const temp = `Temp ${p.temperature.toFixed(2)}`;
  return p.askExpertDefault ? `${temp} · Expert` : temp;
}

export function integrationsMeta(p: PersonaRow): string {
  const n = Object.keys(p.mcpOverrides ?? {}).length;
  return n > 0 ? `${n} override${n === 1 ? '' : 's'}` : 'Default tools';
}

export function knowledgeMeta(p: PersonaRow): string {
  const n = (p.libraryIds ?? []).length;
  return n > 0 ? `${n} ${n === 1 ? 'library' : 'libraries'}` : 'No libraries';
}

export function memoryMeta(p: PersonaRow): string {
  return (p.useMemory ?? true) ? 'Remembering' : 'Off';
}

export function fontVoiceMeta(p: PersonaRow): string {
  const font = p.font.charAt(0).toUpperCase() + p.font.slice(1);
  return p.voice ? `${font} · Voice` : font;
}

export function mindspaceMeta(p: PersonaRow, mindspaces: MindspaceRow[]): string {
  if (!p.mindspaceId) return 'User default';
  return mindspaces.find((m) => m.id === p.mindspaceId)?.displayName ?? 'User default';
}

// ── Background helper (title/memory/compaction chores) ──────────────────────

/** Whether the persona's own (main) model is flagged as a think-then-stop model
 *  that breaks unattended background chores. */
export function mainModelUnsuitableAsWorker(p: PersonaRow): boolean {
  const canonical = p.canonicalId ? getCanonical(p.canonicalId) : undefined;
  return canonical ? isUnsuitableAsBackgroundWorker(canonical) : false;
}

/** Show the flagged-main-model warning on the persona hub: the main model is a
 *  think-then-stop model AND no background helper has been picked yet. Clears the
 *  moment a helper is set — a resolvable nudge, not a nag. */
export function showBackgroundHelperWarning(p: PersonaRow): boolean {
  return mainModelUnsuitableAsWorker(p) && !hasBackgroundHelper(p);
}

/**
 * The greeting-helper toggle's disabled state + reason (Roleplay sub-page).
 * Resolved in precedence order so the reason always names the true FIRST blocker
 * (Laura SOFT-3): roleplay off → greeting off → no helper set. `reason` is
 * undefined only when the toggle is enabled.
 */
export function greetingHelperGate(p: PersonaRow): { disabled: boolean; reason?: string } {
  if (!p.roleplay) return { disabled: true, reason: 'Enable Roleplay to set a greeting' };
  if (!p.greetingEnabled) return { disabled: true, reason: 'Turn the greeting on first' };
  if (!hasBackgroundHelper(p))
    return {
      disabled: true,
      reason: "Set a background helper on the persona's main screen first",
    };
  return { disabled: false };
}
