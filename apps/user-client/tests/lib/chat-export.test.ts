// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type {
  AttachmentRow,
  ContentBlock,
  MessageRow,
  PillRow,
} from '../../src/boot/client-data-db.js';
import {
  type ChatExportInput,
  chatExportFileName,
  chatToMarkdown,
  exportSlug,
} from '../../src/lib/chat-export.js';

// Local-time constructors keep every assertion independent of the runner's zone.
const at = (d: number, h: number, m: number): number => new Date(2026, 10, d, h, m).getTime();

let seq = 0;
function msg(
  role: MessageRow['role'],
  createdAt: number,
  blocks: ContentBlock[] | string,
  over: Partial<MessageRow> = {},
): MessageRow {
  seq += 1;
  return {
    id: `m${seq}`,
    chatId: 'c1',
    role,
    contentBlocks: typeof blocks === 'string' ? [{ type: 'text', text: blocks }] : blocks,
    createdAt,
    updatedAt: createdAt,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

function pill(id: string, kind: PillRow['kind'], payload: unknown): PillRow {
  return {
    id,
    messageId: 'x',
    kind,
    positionHint: 'inline',
    status: 'completed',
    payload,
    createdAt: 0,
  };
}

function attachment(
  messageId: string,
  fileName: string,
  kind: AttachmentRow['kind'],
  over: Partial<AttachmentRow> = {},
): AttachmentRow {
  return {
    id: `a-${fileName}`,
    chatId: 'c1',
    messageId,
    origin: 'upload',
    kind,
    fileName,
    mime: kind === 'image' ? 'image/jpeg' : 'text/plain',
    order: 0,
    state: 'active',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function input(over: Partial<ChatExportInput> = {}): ChatExportInput {
  return {
    chat: { title: 'Trip planning', createdAt: at(14, 18, 3) },
    personaName: 'Mira',
    userName: 'Chris',
    messages: [],
    pills: new Map(),
    attachments: new Map(),
    exportedAt: at(18, 21, 20),
    streamingMessageId: null,
    ...over,
  };
}

describe('chatToMarkdown', () => {
  it('writes front matter, title, day headings and name lines as in the spec', () => {
    const opener = msg('persona', at(14, 18, 3), 'Good evening! [laugh] How was the day?', {
      kind: 'opener',
    });
    const user = msg('user', at(14, 18, 5), 'Long.');
    const next = msg('persona', at(15, 9, 0), 'Morning.');
    const out = chatToMarkdown(
      input({
        messages: [opener, user, next],
        attachments: new Map([[user.id, [attachment(user.id, 'harbour.jpg', 'image')]]]),
      }),
    );
    expect(out).toBe(
      [
        '---',
        'title: Trip planning',
        'persona: Mira',
        'started: 2026-11-14 18:03',
        'exported: 2026-11-18 21:20',
        '---',
        '',
        '# Trip planning',
        '',
        '## Saturday, 14 November 2026',
        '',
        '**Mira** · 18:03',
        '',
        'Good evening! 😄 How was the day?',
        '',
        '**Chris** · 18:05',
        '',
        'Long.',
        '',
        '*[Image: harbour.jpg]*',
        '',
        '## Sunday, 15 November 2026',
        '',
        '**Mira** · 09:00',
        '',
        'Morning.',
        '',
      ].join('\n'),
    );
  });

  it('runs text through the Copy action: moods and sounds as emojis, wrapping tags lose their tags', () => {
    const m = msg(
      'persona',
      at(14, 18, 3),
      '[sarcastic] Oh <whisper>a secret</whisper> [clear-throat] fine',
    );
    const out = chatToMarkdown(input({ messages: [m] }));
    expect(out).toContain('\n🙃 Oh a secret fine\n');
    expect(out).not.toContain('[sarcastic]');
    expect(out).not.toContain('<whisper>');
  });

  it('leaves code blocks literal', () => {
    const m = msg('persona', at(14, 18, 3), 'Try:\n\n```\n[sad] <whisper>x</whisper>\n```');
    expect(chatToMarkdown(input({ messages: [m] }))).toContain(
      'Try:\n\n```\n[sad] <whisper>x</whisper>\n```',
    );
  });

  it('leaves reasoning out', () => {
    const m = msg('persona', at(14, 18, 3), [
      { type: 'reasoning', text: 'secret musings' },
      { type: 'text', text: 'The answer.' },
    ]);
    const out = chatToMarkdown(input({ messages: [m] }));
    expect(out).not.toContain('secret musings');
    expect(out).toContain('The answer.');
  });

  it('writes one italic line per tool call where it sat, and drops lore and voice pills', () => {
    const m = msg('persona', at(14, 18, 3), [
      { type: 'text', text: 'Let me look.' },
      { type: 'pill', pillId: 'p1' },
      { type: 'pill', pillId: 'p2' },
      { type: 'pill', pillId: 'p3' },
      { type: 'text', text: 'Found it.' },
    ]);
    const pills = new Map([
      [
        'p1',
        pill('p1', 'tool-call', { name: 'web_search', argumentsJson: '{"q":"x"}', result: 'r' }),
      ],
      ['p2', pill('p2', 'kb-injection', { entries: [] })],
      ['p3', pill('p3', 'voice-expression', { expression: 'sigh' })],
    ]);
    const out = chatToMarkdown(input({ messages: [m], pills }));
    expect(out).toContain('Let me look.\n\n*[Used tool: web_search]*\n\nFound it.');
    expect(out).not.toContain('{"q"');
    expect(out).not.toContain('Lore');
    expect(out).not.toContain('sigh');
  });

  it('names a tool by the display name its pill shows, the raw name otherwise', () => {
    const m = msg('persona', at(14, 18, 3), [
      { type: 'pill', pillId: 'p1' },
      { type: 'pill', pillId: 'p2' },
    ]);
    const pills = new Map([
      ['p1', pill('p1', 'tool-call', { name: 'write_memory_entry' })],
      ['p2', pill('p2', 'tool-call', { name: 'some_mcp_tool' })],
    ]);
    const out = chatToMarkdown(input({ messages: [m], pills }));
    expect(out).toContain('*[Used tool: Remembered]*\n\n*[Used tool: some_mcp_tool]*');
    expect(out).not.toContain('write_memory_entry');
  });

  it('marks generated images, one line each', () => {
    const m = msg('persona', at(14, 18, 3), [
      { type: 'pill', pillId: 'g1' },
      { type: 'text', text: 'Here you go.' },
    ]);
    const pills = new Map([
      ['g1', pill('g1', 'tool-call', { name: 'generate_image', artefactIds: ['i1', 'i2'] })],
    ]);
    expect(chatToMarkdown(input({ messages: [m], pills }))).toContain(
      '*[Generated image]*\n\n*[Generated image]*\n\nHere you go.',
    );
  });

  it('marks the audio and video an MCP tool returned, one line each', () => {
    const m = msg('persona', at(14, 18, 3), [{ type: 'pill', pillId: 'm1' }]);
    const media = [
      { key: 'gen:G1', kind: 'audio', mime: 'audio/mpeg', title: 'Audio 1', status: 'saved' },
      { key: 'gen:G2', kind: 'video', mime: 'video/mp4', title: 'Video 1', status: 'saving' },
    ];
    const pills = new Map([['m1', pill('m1', 'tool-call', { name: 'el_generate', media })]]);
    expect(chatToMarkdown(input({ messages: [m], pills }))).toContain(
      '*[Used tool: el_generate]*\n\n*[Audio: Audio 1]*\n\n*[Video: Video 1]*',
    );
  });

  it('lists image and file attachments by name, never their bytes, and skips deleted ones', () => {
    const m = msg('user', at(14, 18, 5), 'See these.');
    const rows = [
      attachment(m.id, 'harbour.jpg', 'image', { order: 0 }),
      attachment(m.id, 'notes.txt', 'text', { order: 1, text: 'secret file body' }),
      attachment(m.id, 'gone.jpg', 'image', { order: 2, state: 'deleted' }),
    ];
    const out = chatToMarkdown(input({ messages: [m], attachments: new Map([[m.id, rows]]) }));
    expect(out).toContain('See these.\n\n*[Image: harbour.jpg]*\n\n*[File: notes.txt]*');
    expect(out).not.toContain('secret file body');
    expect(out).not.toContain('gone.jpg');
  });

  it('includes seed turns and the seed greeting', () => {
    const g = msg('persona', at(14, 18, 3), 'Hello from the seed.', {
      kind: 'seed',
      seedRole: 'greeting',
    });
    const b = msg('user', at(14, 18, 4), 'Seed body turn.', { kind: 'seed', seedRole: 'body' });
    const out = chatToMarkdown(input({ messages: [g, b] }));
    expect(out).toContain('Hello from the seed.');
    expect(out).toContain('Seed body turn.');
  });

  it('marks an interrupted reply', () => {
    const m = msg('persona', at(14, 18, 3), 'I was saying', { streamingState: 'incomplete' });
    expect(chatToMarkdown(input({ messages: [m] }))).toContain(
      'I was saying\n\n*[Reply interrupted]*\n',
    );
  });

  it('leaves the reply in progress out and says so at the end', () => {
    const done = msg('user', at(14, 18, 3), 'Tell me a story.');
    const live = msg('persona', at(14, 18, 4), 'Once upon', { streamingState: 'incomplete' });
    const out = chatToMarkdown(input({ messages: [done, live], streamingMessageId: live.id }));
    expect(out).not.toContain('Once upon');
    expect(out).not.toContain('[Reply interrupted]');
    expect(out.endsWith('Tell me a story.\n\n*[Reply in progress, not included]*\n')).toBe(true);
  });

  it('names the user "You" when no display name is given', () => {
    const m = msg('user', at(14, 18, 3), 'Hi.');
    expect(chatToMarkdown(input({ messages: [m], userName: '' }))).toContain('**You** · 18:03');
  });

  it('titles an untitled chat after the persona', () => {
    const out = chatToMarkdown(input({ chat: { title: null, createdAt: at(14, 18, 3) } }));
    expect(out).toContain('title: Chat with Mira\n');
    expect(out).toContain('\n# Chat with Mira\n');
  });

  it('quotes front-matter values YAML would misread', () => {
    const out = chatToMarkdown(
      input({ chat: { title: 'Plans: "big" ones', createdAt: at(14, 18, 3) }, personaName: 'Yes' }),
    );
    expect(out).toContain('title: "Plans: \\"big\\" ones"\n');
    expect(out).toContain('persona: "Yes"\n');
  });

  for (const title of [
    '1e3',
    '0x1F',
    '1_000',
    '+1',
    '-1 day',
    '.5',
    '12 Angry Men',
    '2026-11-18',
  ]) {
    it(`quotes a title starting with a digit, sign or point: ${title}`, () => {
      const out = chatToMarkdown(input({ chat: { title, createdAt: at(14, 18, 3) } }));
      expect(out).toContain(`title: ${JSON.stringify(title)}\n`);
    });
  }

  it('leaves an ordinary title plain', () => {
    const out = chatToMarkdown(
      input({ chat: { title: 'Harbour walk', createdAt: at(14, 18, 3) } }),
    );
    expect(out).toContain('title: Harbour walk\n');
  });

  it('dates the start from the earliest message when it predates the chat row', () => {
    const m = msg('user', at(13, 7, 30), 'Branched from earlier.');
    expect(chatToMarkdown(input({ messages: [m] }))).toContain('started: 2026-11-13 07:30\n');
  });

  it('skips a complete message with nothing to show', () => {
    const m = msg('persona', at(14, 18, 3), [{ type: 'reasoning', text: 'only thinking' }]);
    expect(chatToMarkdown(input({ messages: [m] }))).not.toContain('**Mira**');
  });
});

describe('exportSlug', () => {
  it('folds diacritics and joins words with hyphens', () => {
    expect(exportSlug('Café über Nacht')).toBe('cafe-uber-nacht');
  });

  it('keeps letters of other scripts', () => {
    expect(exportSlug('東京 旅行')).toBe('東京-旅行');
  });

  it('falls back to "chat" when nothing is left', () => {
    expect(exportSlug('!!! ???')).toBe('chat');
    expect(exportSlug('')).toBe('chat');
  });
});

describe('chatExportFileName', () => {
  it('joins persona, title and start date', () => {
    expect(chatExportFileName('Mira', 'Trip planning', at(14, 18, 3))).toBe(
      'mira-trip-planning-2026-11-14.md',
    );
  });

  it('folds umlauts in persona and title', () => {
    expect(chatExportFileName('Zoë', 'Grüße aus Köln', at(14, 18, 3))).toBe(
      // ß has no decomposition, so it stays a letter rather than vanishing.
      'zoe-gruße-aus-koln-2026-11-14.md',
    );
  });

  it('uses the untitled form for a chat without a title', () => {
    expect(chatExportFileName('Mira', null, at(14, 18, 3))).toBe('mira-chat-2026-11-14.md');
    expect(chatExportFileName('Mira', '   ', at(14, 18, 3))).toBe('mira-chat-2026-11-14.md');
  });
});
