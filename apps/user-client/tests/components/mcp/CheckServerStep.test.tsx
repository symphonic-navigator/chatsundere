// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkServerMock } = vi.hoisted(() => ({ checkServerMock: vi.fn() }));

vi.mock('@chatsundere/ui-shared', () => ({
  useAccountLinkStore: (selector: (s: { linkStatus: string }) => unknown) =>
    selector({ linkStatus: 'linked' }),
}));
vi.mock('../../../src/mcp/oauth/check-server.js', () => ({
  checkServer: (...a: unknown[]) => checkServerMock(...a),
}));

import { CheckServerStep } from '../../../src/components/mcp/CheckServerStep.js';
import { MCP_REDIRECT_CHECK } from '../../../src/mcp/redirect-copy.js';

function renderStep(): void {
  render(
    <MemoryRouter>
      <CheckServerStep hasProxy={true} onResult={vi.fn()} onManual={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('CheckServerStep on a redirecting link', () => {
  beforeEach(() => checkServerMock.mockReset());

  it('shows the redirect sentence, never "Couldn\'t reach", with Try again and the field editable', async () => {
    checkServerMock.mockResolvedValue({
      kind: 'unreachable',
      directOnly: false,
      error: MCP_REDIRECT_CHECK,
      cause: 'redirect',
    });
    renderStep();
    const user = userEvent.setup();
    const field = screen.getByLabelText('Server link');
    await user.type(field, 'https://moved.example/mcp');
    await user.click(screen.getByRole('button', { name: 'Check server' }));

    expect(await screen.findByText(MCP_REDIRECT_CHECK)).toBeTruthy();
    expect(screen.queryByText(/Couldn't reach/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect((field as HTMLInputElement).readOnly).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(checkServerMock).toHaveBeenCalledTimes(2);
  });
});

const SUGGESTED =
  'Suggested in the chat. Check that kumbu.example is the server you want — it will receive what your companion sends to its tools.';

// Every pending check is settled before its test ends, passing or failing: a vi.fn
// result left pending keeps the Vitest worker from finishing the file.
const unsettled: Array<() => void> = [];
afterEach(() => {
  for (const settle of unsettled.splice(0)) settle();
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  unsettled.push(() =>
    resolve({ kind: 'unreachable', directOnly: false, error: '', cause: 'other' } as T),
  );
  return { promise, resolve };
}

describe('CheckServerStep with a link from the chat', () => {
  beforeEach(() => checkServerMock.mockReset());

  it('checks the initial link once on mount when autoCheck is set', async () => {
    const pending = deferred<unknown>();
    checkServerMock.mockReturnValue(pending.promise);
    render(
      <MemoryRouter>
        <CheckServerStep
          hasProxy={true}
          initialLink="https://kumbu.example/mcp"
          autoCheck
          onResult={vi.fn()}
          onManual={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Checking kumbu.example…' })).toBeTruthy();
    expect(checkServerMock).toHaveBeenCalledTimes(1);
    expect(checkServerMock).toHaveBeenCalledWith('https://kumbu.example/mcp', {
      hasProxy: true,
      allowDirect: false,
    });
    expect((screen.getByLabelText('Server link') as HTMLInputElement).readOnly).toBe(true);
    pending.resolve({ kind: 'unreachable', directOnly: false, error: 'Nope.', cause: 'other' });
    expect(await screen.findByText('Nope.')).toBeTruthy();
    expect(checkServerMock).toHaveBeenCalledTimes(1);
  });

  it('does not check on mount without autoCheck', () => {
    render(
      <MemoryRouter>
        <CheckServerStep
          hasProxy={true}
          initialLink="https://kumbu.example/mcp"
          onResult={vi.fn()}
          onManual={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(checkServerMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check server' })).toBeTruthy();
  });

  it('makes the field read-only and names the host while a manual check runs', async () => {
    const pending = deferred<unknown>();
    checkServerMock.mockReturnValue(pending.promise);
    renderStep();
    const user = userEvent.setup();
    const field = screen.getByLabelText('Server link') as HTMLInputElement;
    await user.type(field, 'https://wiki.example/mcp');
    await user.click(screen.getByRole('button', { name: 'Check server' }));
    expect(screen.getByRole('button', { name: 'Checking wiki.example…' })).toBeTruthy();
    expect(field.readOnly).toBe(true);
    pending.resolve({ kind: 'unreachable', directOnly: false, error: 'x', cause: 'other' });
    expect(await screen.findByRole('button', { name: 'Check server' })).toBeTruthy();
    expect(field.readOnly).toBe(false);
  });

  it('names the host of a link typed without a scheme', async () => {
    const pending = deferred<unknown>();
    checkServerMock.mockReturnValue(pending.promise);
    renderStep();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Server link'), 'wiki.example/mcp');
    await user.click(screen.getByRole('button', { name: 'Check server' }));
    expect(screen.getByRole('button', { name: 'Checking wiki.example…' })).toBeTruthy();
    pending.resolve({ kind: 'unreachable', directOnly: false, error: 'x', cause: 'other' });
    expect(await screen.findByRole('button', { name: 'Check server' })).toBeTruthy();
  });

  it('shows the suggestion line above the field, and drops it once the link is edited', async () => {
    checkServerMock.mockResolvedValue({
      kind: 'unreachable',
      directOnly: false,
      error: 'Nope.',
      cause: 'other',
    });
    const onLinkEdited = vi.fn();
    render(
      <MemoryRouter>
        <CheckServerStep
          hasProxy={true}
          initialLink="https://kumbu.example/mcp"
          autoCheck
          suggestedHost="kumbu.example"
          onLinkEdited={onLinkEdited}
          onResult={vi.fn()}
          onManual={vi.fn()}
        />
      </MemoryRouter>,
    );
    const line = screen.getByText(SUGGESTED);
    const field = screen.getByLabelText('Server link');
    // The line sits above the field.
    expect(line.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findByText('Nope.')).toBeTruthy();
    const user = userEvent.setup();
    await user.type(field, 'x');
    expect(onLinkEdited).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SUGGESTED)).toBeNull();
  });
});
