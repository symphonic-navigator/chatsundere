// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtefactRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { renameArtefact, updateArtefactContent } from '../data/artefacts.js';
import type { Tool, ToolResult } from '../tools/types.js';

export interface MakeCraftToolsOpts {
  chatId: string;
  /** Artefact id bound as the write / primary-read target for this craft run. */
  currentId: string;
  /** When false (inspect), `replace_current_artefact` is omitted from the set. */
  allowWrite: boolean;
}

/** Compact list row returned by craft `list_artefacts` (no body). */
interface CraftListEntry {
  id: string;
  title: string;
  fileName: string;
  format: string;
  origin: string;
  charLength: number;
  updatedAt: number;
  isCurrent: boolean;
}

/** Full-body payload for craft read tools. */
interface CraftReadPayload {
  id: string;
  title: string;
  fileName: string;
  format: string;
  mime: string;
  origin: string;
  updatedAt: number;
  charLength: number;
  content: string;
}

function normaliseName(s: string): string {
  return s.trim().toLowerCase();
}

/** File name without its last extension (e.g. `notes.md` → `notes`). */
function basenameNoExt(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) return fileName;
  return fileName.slice(0, lastDot);
}

function fail(error: string): ToolResult {
  return { ok: false, output: '', error };
}

function okJson(payload: unknown, meta?: Record<string, unknown>): ToolResult {
  return {
    ok: true,
    output: JSON.stringify(payload),
    error: null,
    ...(meta ? { meta } : {}),
  };
}

function toReadPayload(row: ArtefactRow): CraftReadPayload {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    format: row.format,
    mime: row.mime,
    origin: row.origin,
    updatedAt: row.updatedAt,
    charLength: row.content.length,
    content: row.content,
  };
}

async function loadTextArtefactsForChat(chatId: string): Promise<ArtefactRow[]> {
  const rows = await getClientDataDb().artefacts.where('chatId').equals(chatId).toArray();
  return rows
    .filter((r) => r.kind === 'text')
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * Internal tools for the artefact craft subagent (modify / inspect).
 * Bound to a chat and a current artefact; not exposed as persona chat tools.
 */
export function makeCraftTools(opts: MakeCraftToolsOpts): Tool[] {
  const { chatId, currentId, allowWrite } = opts;

  const listTool: Tool = {
    name: 'list_artefacts',
    description:
      'List text artefacts in this chat (titles and metadata only, no bodies). ' +
      'Use to orient before reading other artefacts by name.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    systemPromptInstruction: null,
    async execute(): Promise<ToolResult> {
      const rows = await loadTextArtefactsForChat(chatId);
      const artefacts: CraftListEntry[] = rows.map((r) => ({
        id: r.id,
        title: r.title,
        fileName: r.fileName,
        format: r.format,
        origin: r.origin,
        charLength: r.content.length,
        updatedAt: r.updatedAt,
        isCurrent: r.id === currentId,
      }));
      return okJson({ artefacts, total: artefacts.length });
    },
  };

  const readCurrentTool: Tool = {
    name: 'read_current_artefact',
    description:
      'Read the full body and metadata of the artefact bound as the current target ' +
      'of this craft run. Call before replace_current_artefact so you have a fresh ' +
      'expectedUpdatedAt.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    systemPromptInstruction: null,
    async execute(): Promise<ToolResult> {
      const row = await getClientDataDb().artefacts.get(currentId);
      if (!row || row.chatId !== chatId || row.kind !== 'text') {
        return fail(
          'Current artefact is missing, not in this chat, or is not a text artefact. ' +
            'Call list_artefacts to re-orient.',
        );
      }
      return okJson(toReadPayload(row), { op: 'read_current', targetId: row.id });
    },
  };

  const readOtherTool: Tool = {
    name: 'read_other_artefact',
    description:
      'Read another text artefact in this chat by title or file name (not the current ' +
      'target). Use for inspiration or cross-reference; you cannot replace other artefacts.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Title, file name, or unique substring thereof.',
        },
      },
      required: ['name'],
    },
    systemPromptInstruction: null,
    async execute(args): Promise<ToolResult> {
      const rawName = typeof args.name === 'string' ? args.name : '';
      const needle = normaliseName(rawName);
      if (!needle) {
        return fail('name is required. Pass a title or file name from list_artefacts.');
      }

      const candidates = (await loadTextArtefactsForChat(chatId)).filter((r) => r.id !== currentId);

      const exact = candidates.filter((r) => {
        const t = normaliseName(r.title);
        const f = normaliseName(r.fileName);
        const base = normaliseName(basenameNoExt(r.fileName));
        return t === needle || f === needle || base === needle;
      });

      let hits = exact;
      if (hits.length === 0) {
        hits = candidates.filter((r) => {
          const t = r.title.toLowerCase();
          const f = r.fileName.toLowerCase();
          return t.includes(needle) || f.includes(needle);
        });
      }

      if (hits.length === 0) {
        return fail(
          `No text artefact matched "${rawName.trim()}". Call list_artefacts and try an exact title or file name.`,
        );
      }
      if (hits.length > 1) {
        const listed = hits
          .slice(0, 5)
          .map((r) => `"${r.title}" (${r.id})`)
          .join(', ');
        return fail(
          `Ambiguous name "${rawName.trim()}" matched ${hits.length} artefacts: ${listed}. Use a more specific title or file name.`,
        );
      }

      const row = hits[0];
      if (!row) {
        return fail(
          `No text artefact matched "${rawName.trim()}". Call list_artefacts and try an exact title or file name.`,
        );
      }
      return okJson(toReadPayload(row), { op: 'read_other', targetId: row.id });
    },
  };

  const tools: Tool[] = [listTool, readCurrentTool, readOtherTool];

  if (allowWrite) {
    const replaceTool: Tool = {
      name: 'replace_current_artefact',
      description:
        'Replace the full body of the current artefact. Pass expectedUpdatedAt from the ' +
        'last read_current_artefact. Optional title renames the display title only. ' +
        'Set force:true only when intentionally shrinking the body below 40% of the prior length.',
      parameters: {
        type: 'object',
        properties: {
          expectedUpdatedAt: {
            type: 'number',
            description: 'updatedAt from the last successful read of the current artefact.',
          },
          content: {
            type: 'string',
            description: 'Full new body; must be non-empty after trim.',
          },
          title: {
            type: 'string',
            description: 'Optional new display title; fileName is left unchanged.',
          },
          force: {
            type: 'boolean',
            description:
              'Required true when the new body is under 40% of the prior length and prior was ≥ 500 chars.',
          },
        },
        required: ['expectedUpdatedAt', 'content'],
      },
      systemPromptInstruction: null,
      async execute(args): Promise<ToolResult> {
        const expectedUpdatedAt =
          typeof args.expectedUpdatedAt === 'number' ? args.expectedUpdatedAt : Number.NaN;
        if (!Number.isFinite(expectedUpdatedAt)) {
          return fail('expectedUpdatedAt must be a number from the last read_current_artefact.');
        }

        const content = typeof args.content === 'string' ? args.content : '';
        if (content.trim().length === 0) {
          return fail('content must be non-empty after trim. Refusing empty replace.');
        }

        const force = args.force === true;
        const titleRaw = typeof args.title === 'string' ? args.title.trim() : '';

        const row = await getClientDataDb().artefacts.get(currentId);
        if (!row || row.chatId !== chatId || row.kind !== 'text' || row.id !== currentId) {
          return fail(
            'Current artefact is missing, not in this chat, or is not a text artefact. Cannot replace.',
          );
        }

        if (row.updatedAt !== expectedUpdatedAt) {
          return fail(
            `Conflict: artefact was updated elsewhere (current updatedAt=${row.updatedAt}, ` +
              `expected=${expectedUpdatedAt}). Call read_current_artefact and retry with the fresh token.`,
          );
        }

        const priorLen = row.content.length;
        const newLen = content.length;
        if (priorLen >= 500 && newLen < 0.4 * priorLen && !force) {
          return fail(
            `Refusing large shrink: new body is ${newLen} chars (${Math.round((newLen / priorLen) * 100)}% of prior ${priorLen}). Re-call replace_current_artefact with force:true if this reduction is intentional.`,
          );
        }

        await updateArtefactContent(row.id, content);
        if (titleRaw.length > 0) {
          await renameArtefact(row.id, { title: titleRaw });
        }

        const after = await getClientDataDb().artefacts.get(row.id);
        if (!after) {
          return fail('Artefact disappeared after write. Unexpected state.');
        }

        return okJson(
          {
            ok: true,
            id: after.id,
            updatedAt: after.updatedAt,
            title: after.title,
            charLength: after.content.length,
          },
          {
            op: 'replace_current',
            targetId: after.id,
            resultingUpdatedAt: after.updatedAt,
          },
        );
      },
    };
    tools.push(replaceTool);
  }

  return tools;
}
