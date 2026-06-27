// SPDX-License-Identifier: AGPL-3.0-only
import type { MindspaceRow, PersonaRow } from '../boot/client-data-db.js';

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
