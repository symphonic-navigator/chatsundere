// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  type MessageRow,
  type PillRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { dismissConnectorPill } from '../../src/data/connector-pill.js';
import type { IntegrationContext } from '../../src/integrations/types.js';
import { flattenAnswerText } from '../../src/lib/content-blocks.js';
import { replayHistory } from '../../src/lib/tool-replay.js';
import {
  CONNECTOR_PROPOSED,
  type ConnectorToolContext,
} from '../../src/tools/add-mcp-connector.js';
import { resolveActiveTools, systemPromptSegment, toolDefs } from '../../src/tools/registry.js';

// Add-mcp-connector spec §7 and §9: dismissing the card changes nothing the provider caches.

const LINK = 'https://mcp.kumbu.example/mcp';

const ctx: IntegrationContext = {
  nsfwAllowed: false,
  tonalityEnabled: false,
  globalInstructions: '',
  location: null,
  webSearch: null,
  webFetch: null,
  useProxy: false,
  webSearchTierId: null,
  artefactExpert: null,
  getKey: async () => null,
  chatId: 'chat-1',
  personaId: 'per-1',
  personaOffering: { providerId: '', upstreamSlug: '' },
};

function message(over: Partial<MessageRow> & Pick<MessageRow, 'id' | 'role'>): MessageRow {
  return {
    chatId: 'chat-1',
    contentBlocks: [],
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

const USER = message({
  id: 'm-u',
  role: 'user',
  contentBlocks: [{ type: 'text', text: `Can you add this connector? ${LINK}` }],
});

const PERSONA = message({
  id: 'm-p',
  role: 'persona',
  createdAt: 1_760_000_000_001,
  contentBlocks: [
    { type: 'pill', pillId: 'p-conn' },
    { type: 'text', text: 'Tap the card to add it.' },
  ],
});

const PILL: PillRow = {
  id: 'p-conn',
  messageId: 'm-p',
  kind: 'tool-call',
  positionHint: 'inline',
  status: 'completed',
  payload: {
    name: 'add_mcp_connector',
    argumentsJson: JSON.stringify({ url: LINK }),
    toolCallId: 'provider-original-1',
    result: CONNECTOR_PROPOSED,
    connector: { url: LINK },
  },
  createdAt: 1_760_000_000_001,
};

/** What one send of the chat puts in front of the provider, read fresh from the store. */
async function sendPrefix(): Promise<{ history: string; tools: string; prompt: string | null }> {
  const db = getClientDataDb();
  const rows = (await db.messages.where('chatId').equals('chat-1').toArray()).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const pills = await db.pills
    .where('messageId')
    .anyOf(rows.map((r) => r.id))
    .toArray();
  const connector: ConnectorToolContext = {
    userTexts: () =>
      rows.filter((r) => r.role === 'user').map((r) => flattenAnswerText(r.contentBlocks)),
    servers: () => db.mcpServers.orderBy('createdAt').toArray(),
  };
  const tools = resolveActiveTools(ctx, null, null, null, null, null, connector);
  const history = replayHistory(rows, {
    pillsById: new Map(pills.map((p) => [p.id, p])),
    policy: {
      toolsSupported: true,
      orphanReplay: false,
      activeToolNames: new Set(tools.map((t) => t.name)),
    },
  });
  return {
    history: JSON.stringify(history),
    tools: JSON.stringify(toolDefs(tools)),
    prompt: systemPromptSegment(tools),
  };
}

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('connector card and the prompt cache', () => {
  it('keeps history, tool definitions and system prompt byte-identical across a dismissal', async () => {
    const db = await openClientDataDb();
    await db.messages.bulkAdd([USER, PERSONA]);
    await db.pills.add(PILL);

    const before = await sendPrefix();
    // The replay really carries the connector round, so the comparison is not vacuous.
    expect(before.history).toContain(CONNECTOR_PROPOSED.slice(0, 40));
    expect(before.history).toContain('add_mcp_connector');

    expect(await dismissConnectorPill('p-conn')).toBe(true);
    const reloaded = await db.pills.get('p-conn');
    expect((reloaded?.payload as Record<string, unknown>).connectorDismissedAt).toEqual(
      expect.any(Number),
    );

    const after = await sendPrefix();
    expect(after.history).toBe(before.history);
    expect(after.tools).toBe(before.tools);
    expect(after.prompt).toBe(before.prompt);
  });
});
