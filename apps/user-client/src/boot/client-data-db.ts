// SPDX-License-Identifier: AGPL-3.0-only

import Dexie, { type Table } from 'dexie';
import { uuidv7 } from 'uuidv7';
import type { EncryptedBlob } from '../lib/secrets.js';

const DB_NAME = 'chatsundere_client_data';

// ===== Row types =====

export interface SettingsRow {
  id: 1;
  globalUnlockerPrompt: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  animationsEnabled: boolean;
  corsProxy: { url: string; sharedKey: EncryptedBlob } | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderRow {
  id: string;
  templateId: string;
  displayName: string;
  baseUrl: string;
  apiKey: EncryptedBlob;
  routing: { kind: 'direct' } | { kind: 'cors-proxy' };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MindspacePalette {
  bg: string;
  surfaceBase: string;
  surfaceRaised: string;
  surfaceInput: string;
  accent: string;
  accentSubtle: string;
  accentBorder: string;
  accentBorderActive: string;
  accentGlow: string;
  text: {
    primary: string;
    secondary: string;
    muted: string;
    ghost: string;
  };
}

export type MindspaceTexture = 'cloudy';

export interface MindspaceRow {
  id: string;
  displayName: string;
  palette: MindspacePalette;
  texture: MindspaceTexture;
  builtIn: boolean;
  createdAt: number;
}

export interface PersonaRow {
  id: string;
  name: string;
  colour: string;
  font: 'sans' | 'serif' | 'cursive';
  instructions: string;
  providerId: string;
  modelId: string;
  mindspaceId: string | null;
  aboutMeOverride: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRow {
  id: string;
  personaId: string;
  title: string | null;
  resolvedMindspaceId: string;
  createdAt: number;
  lastMessageAt: number;
  bookmarkedMessageCount: number;
}

export type ContentBlock = { type: 'text'; text: string } | { type: 'pill'; pillId: string };

export interface MessageRow {
  id: string;
  chatId: string;
  role: 'user' | 'persona' | 'system';
  contentBlocks: ContentBlock[];
  createdAt: number;
  bookmarked: boolean;
  streamingState: 'complete' | 'incomplete';
}

export interface PillRow {
  id: string;
  messageId: string;
  kind: 'tool-call' | 'kb-injection' | 'image-result' | 'voice-expression';
  positionHint: 'inline' | 'above-text';
  status: 'pending' | 'completed' | 'failed';
  payload: unknown;
  createdAt: number;
}

// ===== Dexie subclass =====

class ClientDataDb extends Dexie {
  settings!: Table<SettingsRow, 1>;
  providers!: Table<ProviderRow, string>;
  mindspaces!: Table<MindspaceRow, string>;
  personas!: Table<PersonaRow, string>;
  chats!: Table<ChatRow, string>;
  messages!: Table<MessageRow, string>;
  pills!: Table<PillRow, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });
  }
}

let dbHandle: ClientDataDb | null = null;
let pending: Promise<ClientDataDb> | null = null;

/**
 * Open the user-client data DB and seed built-in mindspaces + settings
 * singleton on first launch. Idempotent — re-running with seeded state
 * is a no-op.
 */
export function openClientDataDb(): Promise<ClientDataDb> {
  if (dbHandle) return Promise.resolve(dbHandle);
  if (pending) return pending;
  pending = (async () => {
    const db = new ClientDataDb();
    await db.open();
    await seedBuiltinsIfNeeded(db);
    dbHandle = db;
    return db;
  })().finally(() => {
    // Clear the in-flight ref whether the promise resolved or rejected,
    // so a transient failure (quota, blocked, etc.) is recoverable on
    // a subsequent call instead of cementing the rejection.
    pending = null;
  });
  return pending;
}

export function getClientDataDb(): ClientDataDb {
  if (!dbHandle)
    throw new Error('client-data DB not opened — call openClientDataDb() during boot first');
  return dbHandle;
}

/**
 * Reset the in-process handle. Used by tests to force re-open against
 * fake-indexeddb between cases. `keepData: true` preserves the underlying
 * IndexedDB content (so we can prove seeding is idempotent across opens).
 */
export async function _resetClientDataDbForTests(opts: { keepData?: boolean } = {}): Promise<void> {
  if (dbHandle) {
    dbHandle.close();
    dbHandle = null;
  }
  pending = null;
  if (!opts.keepData) {
    await Dexie.delete(DB_NAME);
  }
}

// ===== Seeding =====

async function seedBuiltinsIfNeeded(db: ClientDataDb): Promise<void> {
  const existingSettings = await db.settings.get(1);
  if (existingSettings) return; // already seeded — no-op

  const now = Date.now();
  const aurumId = uuidv7();
  const azuroId = uuidv7();
  const verdanId = uuidv7();

  await db.transaction('rw', db.mindspaces, db.settings, async () => {
    await db.mindspaces.bulkAdd([
      buildMindspace(aurumId, 'Aurum', '#c9a84c', now),
      buildMindspace(azuroId, 'Azuro', '#7c9ede', now),
      buildMindspace(verdanId, 'Verdan', '#74c69d', now),
    ]);
    await db.settings.add({
      id: 1,
      globalUnlockerPrompt: '',
      globalAboutMe: '',
      defaultMindspaceId: aurumId,
      animationsEnabled: true,
      corsProxy: null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

function buildMindspace(
  id: string,
  displayName: string,
  accentHex: string,
  now: number,
): MindspaceRow {
  const accentRgb = hexToRgb(accentHex);
  const textBase = textRgbForAccent(accentHex);
  return {
    id,
    displayName,
    palette: {
      bg: '#0a0a0a',
      surfaceBase: 'rgba(255,255,255,0.025)',
      surfaceRaised: 'rgba(255,255,255,0.04)',
      surfaceInput: 'rgba(0,0,0,0.3)',
      accent: accentHex,
      accentSubtle: `rgba(${accentRgb},0.06)`,
      accentBorder: `rgba(${accentRgb},0.15)`,
      accentBorderActive: `rgba(${accentRgb},0.35)`,
      accentGlow: `rgba(${accentRgb},0.08)`,
      text: {
        primary: textBase.primary,
        secondary: textBase.secondary,
        muted: `rgba(${textBase.rgb},0.4)`,
        ghost: `rgba(${textBase.rgb},0.2)`,
      },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: now,
  };
}

function hexToRgb(hex: string): string {
  const v = hex.replace('#', '');
  const r = Number.parseInt(v.slice(0, 2), 16);
  const g = Number.parseInt(v.slice(2, 4), 16);
  const b = Number.parseInt(v.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

function textRgbForAccent(accentHex: string): { primary: string; secondary: string; rgb: string } {
  // Block-1 provisional: text is a desaturated tint of the accent.
  // Lyra will finalise per-mindspace text palettes; this keeps the
  // resolution engine demonstrable until then.
  const v = accentHex.replace('#', '');
  const r = Math.min(255, Number.parseInt(v.slice(0, 2), 16) + 60);
  const g = Math.min(255, Number.parseInt(v.slice(2, 4), 16) + 60);
  const b = Math.min(255, Number.parseInt(v.slice(4, 6), 16) + 60);
  return {
    primary: `rgb(${r},${g},${b})`,
    secondary: `rgb(${Math.max(0, r - 8)},${Math.max(0, g - 8)},${Math.max(0, b - 8)})`,
    rgb: `${r},${g},${b}`,
  };
}
