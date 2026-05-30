// SPDX-License-Identifier: AGPL-3.0-only

import Dexie, { type Table } from 'dexie';
import { uuidv7 } from 'uuidv7';
import type { EncryptedBlob } from '../lib/secrets.js';

const DB_NAME = 'chatsundere_client_data';

// ===== Row types =====

export interface SettingsRow {
  id: 1;
  displayName: string;
  globalUnlockerPrompt: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  userTexture: MindspaceTexture;
  animationsEnabled: boolean;
  adultMode: 'nsfw' | 'sfw';
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

export type MindspaceTexture = 'cloudy' | 'aurora' | 'grain';

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
  tagline: string;
  colour: string;
  font: 'sans' | 'serif' | 'cursive';
  instructions: string;
  /** Canonical model id (Slice 2). null = not set → user must re-pick. */
  canonicalId: string | null;
  providerId: string;
  modelId: string;
  mindspaceId: string | null;
  aboutMeOverride: string | null;
  textureOverride: MindspaceTexture | null;
  temperature: number;
  adultPersona: boolean;
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
  draftInput: string; // NEW — Phase 3 cockpit autosave
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pill'; pillId: string }
  | { type: 'reasoning'; text: string };

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

    this.version(2)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill new SettingsRow.userFont — default 'serif' per Decision 28.
        const settings = await tx.table('settings').get(1);
        if (settings) {
          await tx.table('settings').update(1, { userFont: 'serif' });
        }
        // Backfill new PersonaRow fields — Decision 26.
        const personas = await tx.table('personas').toArray();
        for (const p of personas) {
          await tx.table('personas').update(p.id, {
            tagline: '',
            temperature: 0.85,
            adultPersona: false,
          });
        }
      });

    this.version(3)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill SettingsRow.userTexture from the default mindspace's texture,
        // falling back to 'cloudy' if the mindspace row is absent.
        const settings = await tx.table('settings').get(1);
        if (settings) {
          const defaultMs = await tx.table('mindspaces').get(settings.defaultMindspaceId);
          const seedTexture = defaultMs?.texture ?? 'cloudy';
          await tx.table('settings').update(1, { userTexture: seedTexture });
        }
        // Backfill PersonaRow.textureOverride — null means "inherit from user default".
        const personas = await tx.table('personas').toArray();
        for (const p of personas) {
          await tx.table('personas').update(p.id, { textureOverride: null });
        }
      });

    this.version(4)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill SettingsRow.displayName — default '' means "use the username".
        const settings = await tx.table('settings').get(1);
        if (settings && typeof settings.displayName !== 'string') {
          await tx.table('settings').update(1, { displayName: '' });
        }
      });

    this.version(5)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill SettingsRow.adultMode. Default is 'nsfw' per spec §2
        // Decision 2 — SFW is treated as the special case, not the default.
        // This setting is device-local and must be excluded from any future
        // sync mechanism.
        const settings = await tx.table('settings').get(1);
        if (settings && typeof settings.adultMode !== 'string') {
          await tx.table('settings').update(1, { adultMode: 'nsfw' });
        }
      });

    this.version(6)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // ChatRow.draftInput — Phase 3 §6.4 Cockpit-Input persistence.
        const chats = await tx.table('chats').toArray();
        for (const c of chats) {
          if (typeof c.draftInput !== 'string') {
            await tx.table('chats').update(c.id, { draftInput: '' });
          }
        }
      });

    // v7 — Phase 4 chain-of-thought display. Schema-structurally identical
    // to v6: `contentBlocks` is a non-indexed JSON column and accepts the
    // widened ContentBlock union (now including `{type:'reasoning',text}`)
    // without any index changes. The bump is a code-capability marker:
    // "this build knows about reasoning blocks". No upgrade callback needed.
    this.version(7).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });

    // Version 8 — Slice 2: personas gain a non-indexed `canonicalId`. Clean
    // break: rows from v7 have no canonicalId; the editor treats that as
    // "model not set" and prompts a re-pick. No upgrade callback needed.
    this.version(8).stores({
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

const BUILT_IN_MINDSPACES: ReadonlyArray<{ displayName: string; accent: string }> = [
  { displayName: 'Crimson', accent: '#b33a5e' },
  { displayName: 'Aurum', accent: '#c9a84c' },
  { displayName: 'Verdan', accent: '#6aa97a' },
  { displayName: 'Azuro', accent: '#4a7eb3' },
  { displayName: 'Indigaut', accent: '#5d4e9e' },
  { displayName: 'Violetta', accent: '#9a5bb8' },
  { displayName: 'Rosari', accent: '#c97a99' },
];

async function seedBuiltinsIfNeeded(db: ClientDataDb): Promise<void> {
  const existingSettings = await db.settings.get(1);
  const existingMindspaces = await db.mindspaces.toArray();
  const existingNames = new Set(existingMindspaces.map((m) => m.displayName));

  const missingBuiltins = BUILT_IN_MINDSPACES.filter((b) => !existingNames.has(b.displayName));
  const staleVerdanOrAzuro = existingMindspaces.filter(
    (m) =>
      (m.displayName === 'Verdan' && m.palette.accent !== '#6aa97a') ||
      (m.displayName === 'Azuro' && m.palette.accent !== '#4a7eb3'),
  );

  if (existingSettings && missingBuiltins.length === 0 && staleVerdanOrAzuro.length === 0) {
    return; // already at Phase-2 state — no-op
  }

  const now = Date.now();
  await db.transaction('rw', db.mindspaces, db.settings, async () => {
    // Add any missing built-ins
    if (missingBuiltins.length > 0) {
      await db.mindspaces.bulkAdd(
        missingBuiltins.map((b) => buildMindspace(uuidv7(), b.displayName, b.accent, now)),
      );
    }
    // Refresh stale palettes for Verdan / Azuro (preserving id + texture + builtIn flag)
    for (const stale of staleVerdanOrAzuro) {
      const finalised = BUILT_IN_MINDSPACES.find((b) => b.displayName === stale.displayName);
      if (!finalised) continue;
      const refreshed = buildMindspace(stale.id, stale.displayName, finalised.accent, now);
      await db.mindspaces.put({ ...refreshed, texture: stale.texture });
    }
    // Seed the settings singleton if it doesn't exist
    if (!existingSettings) {
      const aurum = await db.mindspaces.where('displayName').equals('Aurum').first();
      const aurumId = aurum?.id ?? (await db.mindspaces.toCollection().first())?.id ?? uuidv7();
      await db.settings.add({
        id: 1,
        displayName: '',
        globalUnlockerPrompt: '',
        globalAboutMe: '',
        defaultMindspaceId: aurumId,
        userTexture: 'cloudy',
        animationsEnabled: true,
        adultMode: 'nsfw',
        corsProxy: null,
        createdAt: now,
        updatedAt: now,
      });
    }
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
