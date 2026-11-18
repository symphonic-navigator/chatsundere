// SPDX-License-Identifier: AGPL-3.0-only
import { type WireContentPart, formatSentStamp } from '@chatsundere/llm-unified';
import type { MessageRow, PersonaRow } from '../boot/client-data-db.js';

/** When a user turn was sent: the instant and the sender's UTC offset then. */
export interface SentAt {
  createdAt: number;
  utcOffsetMinutes: number;
}

/** Whether the persona's turns carry `<sent>` stamps. Unset follows roleplay:
 *  a roleplay character stays timeless until its owner says otherwise. */
export function resolveTimeAwareness(
  persona: Pick<PersonaRow, 'timeAwareness' | 'roleplay'>,
): boolean {
  return persona.timeAwareness ?? !persona.roleplay;
}

/** The device's UTC offset in minutes at `instant` (positive east of Greenwich). */
export function deviceOffsetMinutes(instant: number): number {
  // getTimezoneOffset is positive *west* of Greenwich; the stamp wants east.
  // `|| 0` folds the -0 of a UTC device into 0 so the value serialises as 0.
  return -new Date(instant).getTimezoneOffset() || 0;
}

/** A message's stored offset, else the device's offset for its own instant.
 *  The fallback only serves rows from before 0.5.0, which carry no offset. */
export function messageOffsetMinutes(
  m: Pick<MessageRow, 'createdAt' | 'utcOffsetMinutes'>,
): number {
  return m.utcOffsetMinutes ?? deviceOffsetMinutes(m.createdAt);
}

/** The send time of a message row, for its stamp. */
export function sentAtOf(m: Pick<MessageRow, 'createdAt' | 'utcOffsetMinutes'>): SentAt {
  return { createdAt: m.createdAt, utcOffsetMinutes: messageOffsetMinutes(m) };
}

/** Put a stamp in front of a user turn's wire content: on its own line for a
 *  string, as its own leading text part ahead of any attachment parts for an
 *  array, so a replayed multimodal turn is as byte-stable as a text one. */
export function prependStamp(
  content: string | WireContentPart[],
  stamp: string,
): string | WireContentPart[] {
  if (typeof content === 'string') return `${stamp}\n${content}`;
  return [{ type: 'text', text: stamp }, ...content];
}

/** Whether a stored row carries a `<sent>` stamp on the wire: only user turns
 *  do, and seed body turns are a simulated conversation with no send time. */
export function isStampedTurn(m: Pick<MessageRow, 'role' | 'kind'>): boolean {
  return m.role === 'user' && m.kind !== 'seed';
}

/** The `<sent>` stamp a stored row carries on the wire, or undefined for a row
 *  that carries none (see `isStampedTurn`). */
export function userTurnStamp(
  m: Pick<MessageRow, 'role' | 'kind' | 'createdAt' | 'utcOffsetMinutes'>,
): string | undefined {
  if (!isStampedTurn(m)) return undefined;
  const at = sentAtOf(m);
  return formatSentStamp(at.createdAt, at.utcOffsetMinutes);
}
