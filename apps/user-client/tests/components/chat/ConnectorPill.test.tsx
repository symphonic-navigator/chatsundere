import { useSessionStore } from '@chatsundere/ui-shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerRow, PillRow } from '../../../src/boot/client-data-db.js';
import { ConnectorPill } from '../../../src/components/chat/ConnectorPill.js';
import { Pill } from '../../../src/components/chat/Pill.js';
import type { PendingSignInSummary } from '../../../src/data/mcp-oauth-pending.js';

const m = vi.hoisted(() => ({
  servers: [] as Partial<McpServerRow>[],
  pending: [] as PendingSignInSummary[],
  chatId: 'chat 1/x' as string | null | undefined,
  persona: { id: 'per1', name: 'Mira', mcpOverrides: {} as Record<string, 'on' | 'off'> } as {
    id: string;
    name: string;
    mcpOverrides: Record<string, 'on' | 'off'>;
  } | null,
  dismiss: vi.fn(async (_id: string) => true),
}));

vi.mock('../../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => ({ data: m.servers }),
}));
vi.mock('../../../src/data/mcp-oauth-pending.js', () => ({
  usePendingSignIns: () => ({ data: m.pending }),
}));
vi.mock('../../../src/data/chats.js', () => ({
  useChat: (id: string | null) => ({
    data: id ? { chat: { id, personaId: 'per1' }, messages: [], pills: [] } : null,
  }),
}));
vi.mock('../../../src/data/personas.js', () => ({
  usePersona: () => ({ data: m.persona }),
}));
vi.mock('../../../src/data/connector-pill.js', () => ({
  useMessageChatId: () => ({ data: m.chatId }),
  dismissConnectorPill: (id: string) => m.dismiss(id),
}));

const LINK = 'https://mcp.session-verify.kumbu.example/mcp';
const CHAT_PATH = `/app/chat/${encodeURIComponent('chat 1/x')}`;
const RETURN = encodeURIComponent(CHAT_PATH);

function pill(payload: unknown, status: PillRow['status'] = 'completed'): PillRow {
  return {
    id: 'pill-1',
    messageId: 'msg-1',
    kind: 'tool-call',
    positionHint: 'inline',
    status,
    payload,
    createdAt: 1,
  };
}

function proposed(extra: Record<string, unknown> = {}, url: unknown = LINK): PillRow {
  return pill({
    name: 'add_mcp_connector',
    argumentsJson: JSON.stringify({ url }),
    result: 'Proposed, not added.',
    connector: { url },
    ...extra,
  });
}

function refused(rawUrl: unknown): PillRow {
  return pill(
    {
      name: 'add_mcp_connector',
      argumentsJson: JSON.stringify({ url: rawUrl }),
      error: 'Not proposed',
    },
    'failed',
  );
}

function server(over: Partial<McpServerRow> = {}): Partial<McpServerRow> {
  return {
    id: 'srv 1',
    name: 'Kumbu',
    url: LINK,
    enabled: true,
    onByDefault: true,
    ...over,
  };
}

function Probe(): JSX.Element {
  const loc = useLocation();
  return (
    <div data-testid="probe">
      <span data-testid="where">{`${loc.pathname}${loc.search}`}</span>
      <span data-testid="state">{JSON.stringify(loc.state)}</span>
    </div>
  );
}

function renderCard(row: PillRow, via: 'pill' | 'card' = 'card') {
  return render(
    <MemoryRouter initialEntries={[CHAT_PATH]}>
      <Routes>
        <Route
          path="/app/chat/:chatId"
          element={via === 'pill' ? <Pill row={row} /> : <ConnectorPill row={row} />}
        />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function card(): HTMLElement {
  return screen.getByRole('group', { name: /Connector suggested in the chat/ });
}

function where(): string {
  return screen.getByTestId('where').textContent ?? '';
}

beforeEach(() => {
  m.servers = [];
  m.pending = [];
  m.chatId = 'chat 1/x';
  m.persona = { id: 'per1', name: 'Mira', mcpOverrides: {} };
  m.dismiss.mockClear();
  useSessionStore.setState({ mk: new Uint8Array(32) } as never);
});

afterEach(() => {
  useSessionStore.setState({ mk: null } as never);
});

describe('ConnectorPill — dispatch and layout', () => {
  it('is chosen by Pill for add_mcp_connector and renders as a block', () => {
    const { container } = renderCard(proposed(), 'pill');
    const group = card();
    expect(group).toHaveAttribute(
      'aria-label',
      'Connector suggested in the chat: mcp.session-verify.kumbu.example',
    );
    expect(container.querySelector('.pill-wrap')).toBeNull();
    expect(group.closest('.connector-pill-block')).not.toBeNull();
  });

  it('shows the host with its last two labels emphasised', () => {
    renderCard(proposed());
    const head = within(card()).getByText(/Connector ·/);
    expect(head).toHaveTextContent('Connector · mcp.session-verify.kumbu.example');
    const strong = head.querySelector('strong');
    expect(strong).toHaveTextContent('kumbu.example');
    expect(strong?.textContent).toBe('kumbu.example');
  });

  it('shows the full link unshortened, as plain text, never as an anchor', () => {
    const long = `https://mcp.kumbu.example/${'a'.repeat(1500)}`;
    renderCard(proposed({}, long));
    const group = card();
    const linkText = within(group).getByText(long);
    expect(linkText.tagName).not.toBe('A');
    expect(linkText.closest('a')).toBeNull();
    expect(group.querySelector('a[href*="kumbu"]')).toBeNull();
    expect(group.querySelector('img')).toBeNull();
  });
});

describe('ConnectorPill — Proposed', () => {
  it('offers Check & add and Not now; Check & add navigates with the link in state', () => {
    renderCard(proposed());
    const checkAdd = within(card()).getByRole('button', { name: 'Check & add ↗' });
    expect(within(card()).getByRole('button', { name: 'Not now' })).toBeEnabled();
    fireEvent.click(checkAdd);
    expect(where()).toBe(`/app/integrations/new?return=${RETURN}`);
    expect(JSON.parse(screen.getByTestId('state').textContent ?? 'null')).toEqual({
      proposedLink: LINK,
    });
  });

  it('Not now dismisses the pill by its id', () => {
    renderCard(proposed());
    fireEvent.click(within(card()).getByRole('button', { name: 'Not now' }));
    expect(m.dismiss).toHaveBeenCalledWith('pill-1');
  });

  it('ignores extra payload fields', () => {
    renderCard(
      proposed({
        name2: 'x',
        connector: { url: LINK, name: 'Evil', host: 'evil.example' },
        title: 'evil.example',
        host: 'evil.example',
      }),
    );
    expect(screen.queryByText(/evil/)).toBeNull();
    expect(within(card()).getByRole('button', { name: 'Check & add ↗' })).toBeEnabled();
  });
});

describe('ConnectorPill — Needs your passphrase', () => {
  it('disables Check & add and links Enter passphrase to the login with return', () => {
    useSessionStore.setState({ mk: null } as never);
    renderCard(proposed());
    const group = card();
    expect(within(group).getByRole('button', { name: 'Check & add ↗' })).toBeDisabled();
    expect(
      within(group).getByText(
        'Chatsundere needs your passphrase once more before it can add a server.',
      ),
    ).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('link', { name: 'Enter passphrase' }));
    expect(where()).toBe(`/login?return=${RETURN}&need=passphrase`);
  });
});

describe('ConnectorPill — Signing in', () => {
  it('shows the sign-in line and continues to the waiting screen with return', () => {
    m.pending = [
      {
        state: 'st/1',
        serverId: 'new-1',
        isNewServer: true,
        name: 'Kumbu',
        url: LINK,
        createdAt: 1,
      },
    ];
    renderCard(proposed());
    const group = card();
    expect(
      within(group).getByText('Signing in to mcp.session-verify.kumbu.example…'),
    ).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Check & add ↗' })).toBeNull();
    fireEvent.click(within(group).getByRole('link', { name: 'Continue sign-in ↗' }));
    expect(where()).toBe(
      `/app/integrations/sign-in/${encodeURIComponent('st/1')}?return=${RETURN}`,
    );
  });

  it('matches a sign-in whose draft resolved to the /mcp variant', () => {
    const base = 'https://mcp.kumbu.example';
    m.pending = [
      {
        state: 's',
        serverId: 'n',
        isNewServer: true,
        name: 'K',
        url: `${base}/mcp`,
        createdAt: 1,
      },
    ];
    renderCard(proposed({}, `${base}/`));
    expect(within(card()).getByText('Signing in to mcp.kumbu.example…')).toBeInTheDocument();
  });

  it('ignores a pending sign-in for another link', () => {
    m.pending = [
      {
        state: 's',
        serverId: 'n',
        isNewServer: true,
        name: 'K',
        url: 'https://other.example/mcp',
        createdAt: 1,
      },
    ];
    renderCard(proposed());
    expect(within(card()).getByRole('button', { name: 'Check & add ↗' })).toBeEnabled();
  });
});

describe('ConnectorPill — Added', () => {
  it('reads "✓ Added as <name>" and opens the server page with return', () => {
    m.servers = [server()];
    renderCard(proposed());
    const group = card();
    expect(within(group).getByText('✓ Added as Kumbu')).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Check & add ↗' })).toBeNull();
    fireEvent.click(within(group).getByRole('link', { name: 'Open ↗' }));
    expect(where()).toBe(`/app/integrations/${encodeURIComponent('srv 1')}?return=${RETURN}`);
  });

  it('beats Not now and Signing in', () => {
    m.servers = [server()];
    m.pending = [
      { state: 's', serverId: 'n', isNewServer: true, name: 'K', url: LINK, createdAt: 1 },
    ];
    renderCard(proposed({ connectorDismissedAt: 5 }));
    const group = card();
    expect(within(group).getByText('✓ Added as Kumbu')).toBeInTheDocument();
    expect(within(group).queryByText(/Not now —/)).toBeNull();
    expect(within(group).queryByText(/Signing in/)).toBeNull();
  });

  it('reads "off for <persona>" when the row is disabled', () => {
    m.servers = [server({ enabled: false })];
    renderCard(proposed());
    expect(within(card()).getByText('✓ Added as Kumbu · off for Mira')).toBeInTheDocument();
    expect(within(card()).getByRole('link', { name: 'Open ↗' })).toBeInTheDocument();
  });

  it('reads "off for <persona>" when the persona overrides it off', () => {
    m.servers = [server()];
    m.persona = { id: 'per1', name: 'Mira', mcpOverrides: { 'srv 1': 'off' } };
    renderCard(proposed());
    expect(within(card()).getByText('✓ Added as Kumbu · off for Mira')).toBeInTheDocument();
  });

  it('reads "off for <persona>" when off by default and not overridden on', () => {
    m.servers = [server({ onByDefault: false })];
    renderCard(proposed());
    expect(within(card()).getByText('✓ Added as Kumbu · off for Mira')).toBeInTheDocument();
  });

  it('reads Added when off by default but overridden on for the persona', () => {
    m.servers = [server({ onByDefault: false })];
    m.persona = { id: 'per1', name: 'Mira', mcpOverrides: { 'srv 1': 'on' } };
    renderCard(proposed());
    expect(within(card()).getByText('✓ Added as Kumbu')).toBeInTheDocument();
  });
});

describe('ConnectorPill — Not now', () => {
  it('reads the dismissed line and offers Add anyway with the same navigation', () => {
    renderCard(proposed({ connectorDismissedAt: 1234 }));
    const group = card();
    expect(within(group).getByText('Not now — you can still add it.')).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Not now' })).toBeNull();
    expect(within(group).queryByRole('button', { name: 'Check & add ↗' })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Add anyway ↗' }));
    expect(where()).toBe(`/app/integrations/new?return=${RETURN}`);
    expect(JSON.parse(screen.getByTestId('state').textContent ?? 'null')).toEqual({
      proposedLink: LINK,
    });
  });

  it('ignores a non-number connectorDismissedAt', () => {
    renderCard(proposed({ connectorDismissedAt: 'yes' }));
    expect(screen.queryByText('Not now — you can still add it.')).toBeNull();
    expect(within(card()).getByRole('button', { name: 'Check & add ↗' })).toBeEnabled();
  });
});

describe('ConnectorPill — Failed', () => {
  it('shows the host only and never the userinfo of a refused link', () => {
    const { container } = renderCard(refused('https://user:pw@mcp.kumbu.example/mcp'));
    const group = card();
    expect(group).toHaveAttribute(
      'aria-label',
      'Connector suggested in the chat: mcp.kumbu.example',
    );
    expect(
      within(group).getByText("This link had a user name or password in it, so it wasn't used."),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain('user:pw');
    expect(container.textContent).not.toContain('pw@');
    expect(container.textContent).not.toContain('/mcp');
    expect(within(group).queryByRole('button')).toBeNull();
    expect(within(group).queryByRole('link')).toBeNull();
  });

  it.each([
    [
      'not https',
      'http://mcp.kumbu.example/mcp',
      'Only https links can be added from the chat. A server on your home network can be added in My Integrations.',
      true,
    ],
    [
      'fragment',
      'https://mcp.kumbu.example/mcp#frag',
      "Links with a # part aren't used. Paste the link without it.",
      false,
    ],
    [
      'not public',
      'https://nas.local/mcp',
      'Only servers on the internet can be added from the chat. A server on your home network can be added in My Integrations.',
      true,
    ],
    ['too long', `https://mcp.kumbu.example/${'a'.repeat(2100)}`, 'That link is too long.', false],
  ])('a %s refusal shows its sentence', (_label, raw, sentence, offersIntegrations) => {
    const { container } = renderCard(refused(raw));
    const group = card();
    expect(within(group).getByText(sentence)).toBeInTheDocument();
    expect(container.textContent).not.toContain(raw);
    const link = within(group).queryByRole('link', { name: 'Open My Integrations' });
    if (offersIntegrations) {
      expect(link).not.toBeNull();
      fireEvent.click(link as HTMLElement);
      expect(where()).toBe(`/app/integrations?return=${RETURN}`);
    } else {
      expect(link).toBeNull();
    }
  });

  it('shows no host for a link that cannot be parsed at all', () => {
    renderCard(refused('http://[::1'));
    const group = card();
    expect(group).toHaveAttribute('aria-label', 'Connector suggested in the chat');
    expect(within(group).getByText("That isn't a link Chatsundere can check.")).toBeInTheDocument();
  });

  it('treats a non-string raw url as not a link', () => {
    renderCard(refused(42));
    expect(
      within(card()).getByText("That isn't a link Chatsundere can check."),
    ).toBeInTheDocument();
  });

  it('treats unparsable argumentsJson as not a link', () => {
    renderCard(pill({ name: 'add_mcp_connector', argumentsJson: '{nope' }, 'failed'));
    expect(
      within(card()).getByText("That isn't a link Chatsundere can check."),
    ).toBeInTheDocument();
  });

  it("shows nothing for a refusal whose link passes the rules (cap, not the user's)", () => {
    const { container } = renderCard(refused(LINK));
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});

describe('ConnectorPill — crafted payloads', () => {
  it('a bad stored link with status completed reads Failed, host only', () => {
    const { container } = renderCard(proposed({}, 'https://a:b@mcp.kumbu.example/x'));
    const group = card();
    expect(
      within(group).getByText("This link had a user name or password in it, so it wasn't used."),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain('a:b@');
    expect(within(group).queryByRole('button', { name: 'Check & add ↗' })).toBeNull();
  });

  it('an http stored link with status completed reads Failed', () => {
    renderCard(proposed({}, 'http://mcp.kumbu.example/mcp'));
    expect(
      within(card()).getByText(
        'Only https links can be added from the chat. A server on your home network can be added in My Integrations.',
      ),
    ).toBeInTheDocument();
  });

  it('a non-string stored link reads Failed without a host', () => {
    renderCard(proposed({}, { href: LINK }));
    expect(card()).toHaveAttribute('aria-label', 'Connector suggested in the chat');
    expect(
      within(card()).getByText("That isn't a link Chatsundere can check."),
    ).toBeInTheDocument();
  });

  it('a non-object connector reads Failed', () => {
    renderCard(proposed({ connector: 'https://mcp.kumbu.example/mcp' }));
    expect(
      within(card()).getByText("That isn't a link Chatsundere can check."),
    ).toBeInTheDocument();
  });

  it('never takes the stored link from argumentsJson for a completed pill', () => {
    renderCard(
      pill({
        name: 'add_mcp_connector',
        argumentsJson: JSON.stringify({ url: LINK }),
        connector: null,
      }),
    );
    expect(within(card()).queryByRole('button', { name: 'Check & add ↗' })).toBeNull();
  });

  it('a non-object payload renders a Failed card and does not throw', () => {
    // Reached directly: Pill dispatches by name, which a non-object payload lacks.
    renderCard(pill('junk'));
    expect(
      within(card()).getByText("That isn't a link Chatsundere can check."),
    ).toBeInTheDocument();
  });

  it('a stored link is re-normalised before it is shown or navigated to', () => {
    renderCard(proposed({}, ' https://MCP.Kumbu.Example/mcp '));
    fireEvent.click(within(card()).getByRole('button', { name: 'Check & add ↗' }));
    expect(JSON.parse(screen.getByTestId('state').textContent ?? 'null')).toEqual({
      proposedLink: 'https://mcp.kumbu.example/mcp',
    });
  });
});
