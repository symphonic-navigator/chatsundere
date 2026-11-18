// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { McpServerRow, PillRow } from '../../boot/client-data-db.js';
import { dismissConnectorPill } from '../../data/connector-pill.js';
import {
  PENDING_SIGN_IN_LIFETIME_MS,
  type PendingSignInSummary,
  usePendingSignIns,
} from '../../data/mcp-oauth-pending.js';
import { useMcpServers } from '../../data/mcp-servers.js';
import { usePersona } from '../../data/personas.js';
import { passphraseLoginPath } from '../../data/send-errors.js';
import { findServerForLink } from '../../mcp/find-server-for-link.js';
import { waitingScreenPath } from '../../mcp/oauth/sign-in-session.js';
import { isOnForPersona } from '../../mcp/resolve-active.js';
import { CONNECTOR_CAP, CONNECTOR_NOT_USERS } from '../../tools/add-mcp-connector.js';
import {
  type ConnectorLinkRefusal,
  HAS_SCHEME,
  emphasisSplit,
  normaliseConnectorLink,
} from '../../tools/connector-link.js';
import { Button } from '../ui/index.js';

const FAILED_SENTENCE: Readonly<Record<ConnectorLinkRefusal, string>> = {
  invalid: "That isn't a link Chatsundere can check.",
  'not-https':
    'Only https links can be added from the chat. A server on your home network can be added in My Integrations.',
  userinfo: "This link had a user name or password in it, so it wasn't used.",
  fragment: "Links with a # part aren't used. Paste the link without it.",
  'not-public':
    'Only servers on the internet can be added from the chat. A server on your home network can be added in My Integrations.',
  'too-long': 'That link is too long.',
};

const LINK_CLASS = 'cs-btn connector-pill-btn';

type Derived =
  | { kind: 'hidden' }
  | { kind: 'failed'; host: string | null; reason: ConnectorLinkRefusal }
  | { kind: 'link'; url: string; host: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** The host of a refused link, never more of it; null when it does not parse at all. */
function hostOf(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const host = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

function rawArgumentUrl(argumentsJson: unknown): string | null {
  if (typeof argumentsJson !== 'string') return null;
  try {
    const url = record(JSON.parse(argumentsJson))?.url;
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

/**
 * What the pill says, trusting nothing in it but the link string (spec §6.4): a refusal
 * is judged from the model's raw link, a success from the stored link, re-validated.
 */
function derive(payload: Record<string, unknown> | null, status: PillRow['status']): Derived {
  if (status === 'pending') return { kind: 'hidden' };
  if (status === 'failed') {
    // A capped call, or one for a link the user never wrote, never had a card, whatever its
    // link was (§2.4): judged before the link, so an injected link's host is never shown.
    if (payload?.error === CONNECTOR_CAP || payload?.error === CONNECTOR_NOT_USERS) {
      return { kind: 'hidden' };
    }
    const raw = rawArgumentUrl(payload?.argumentsJson);
    if (raw === null) return { kind: 'failed', host: null, reason: 'invalid' };
    const link = normaliseConnectorLink(raw);
    // A valid link was refused for the cap or for not being the user's: no card (§2.4).
    if (link.ok) return { kind: 'hidden' };
    return {
      kind: 'failed',
      host: link.reason === 'invalid' ? null : hostOf(raw),
      reason: link.reason,
    };
  }
  const stored = record(payload?.connector)?.url;
  if (typeof stored !== 'string') return { kind: 'failed', host: null, reason: 'invalid' };
  const link = normaliseConnectorLink(stored);
  if (!link.ok) {
    return {
      kind: 'failed',
      host: link.reason === 'invalid' ? null : hostOf(stored),
      reason: link.reason,
    };
  }
  return { kind: 'link', url: link.url, host: link.host };
}

function signInFor(
  pending: readonly PendingSignInSummary[] | undefined,
  link: string,
  now: number,
): PendingSignInSummary | undefined {
  // `findServerForLink` reads only the URL; the draft's link is what the check resolved.
  return (pending ?? []).find(
    (p) =>
      p.isNewServer &&
      // Counted here too: a cached list can outlive the sign-ins in it.
      now - p.createdAt < PENDING_SIGN_IN_LIFETIME_MS &&
      typeof p.url === 'string' &&
      findServerForLink([{ url: p.url } as McpServerRow], link) !== undefined,
  );
}

function Headline({ host }: { host: string | null }): JSX.Element {
  if (host === null) {
    return (
      <span className="connector-pill-head">
        <span aria-hidden>⧉ </span>Connector
      </span>
    );
  }
  const { lead, tail } = emphasisSplit(host);
  return (
    <span className="connector-pill-head">
      <span aria-hidden>⧉ </span>Connector · {lead}
      <strong>{tail}</strong>
    </span>
  );
}

/**
 * The card of an add_mcp_connector tool call (add-mcp-connector spec §4). Its chat and
 * persona come from where the message is rendered, never from the payload.
 */
export function ConnectorPill({
  row,
  chatId,
  personaId,
}: {
  row: PillRow;
  chatId?: string | null;
  personaId?: string | null;
}): JSX.Element | null {
  const navigate = useNavigate();
  const mk = useSessionStore((s) => s.mk);
  const { data: servers } = useMcpServers();
  const { data: pending } = usePendingSignIns();
  const { data: persona } = usePersona(personaId ?? null);
  const lineId = useId();

  const payload = record(row.payload);
  const derived = derive(payload, row.status);
  if (derived.kind === 'hidden') return null;

  const chatPath = chatId ? `/app/chat/${encodeURIComponent(chatId)}` : null;
  const back = chatPath ? `?return=${encodeURIComponent(chatPath)}` : '';
  const host = derived.host;
  const label =
    host === null ? 'Connector suggested in the chat' : `Connector suggested in the chat: ${host}`;

  let body: JSX.Element;
  if (derived.kind === 'failed') {
    const offersIntegrations = derived.reason === 'not-https' || derived.reason === 'not-public';
    body = (
      <>
        {offersIntegrations ? (
          <span className="connector-pill-actions">
            <Link to={`/app/integrations${back}`} className={LINK_CLASS}>
              Open My Integrations
            </Link>
          </span>
        ) : null}
        <span className="connector-pill-line">{FAILED_SENTENCE[derived.reason]}</span>
      </>
    );
  } else {
    const url = derived.url;
    const propose = () =>
      navigate(`/app/integrations/new${back}`, { state: { proposedLink: url } });
    const match = findServerForLink(servers ?? [], url);
    // Until the rows have loaded, an existing server looks new: no way in that could add it twice.
    const hold = chatPath === null || servers === undefined;
    const dismissedAt = payload?.connectorDismissedAt;
    const dismissed = typeof dismissedAt === 'number' && Number.isFinite(dismissedAt);
    const signIn = mk ? signInFor(pending, url, Date.now()) : undefined;
    let actions: JSX.Element;
    let line: string | null = null;
    if (match) {
      line = isOnForPersona(match, persona?.mcpOverrides ?? {})
        ? `✓ Added as ${match.name}`
        : `✓ Added as ${match.name} · off for ${persona?.name ?? 'this persona'}`;
      actions = (
        <Link
          to={`/app/integrations/${encodeURIComponent(match.id)}${back}`}
          className={LINK_CLASS}
        >
          Open ↗
        </Link>
      );
    } else if (!mk) {
      line = 'Chatsundere needs your passphrase once more before it can add a server.';
      actions = (
        <>
          <Button tone="primary" className="connector-pill-btn" disabled aria-describedby={lineId}>
            Check & add ↗
          </Button>
          <Link to={passphraseLoginPath(chatPath ?? '/app')} className={LINK_CLASS}>
            Enter passphrase
          </Link>
          {dismissed ? null : (
            <Button
              className="connector-pill-btn"
              onClick={() => void dismissConnectorPill(row.id)}
            >
              Not now
            </Button>
          )}
        </>
      );
    } else if (signIn) {
      line = `Signing in to ${derived.host}…`;
      actions = (
        <Link to={`${waitingScreenPath(signIn.state)}${back}`} className={LINK_CLASS}>
          Continue sign-in ↗
        </Link>
      );
    } else if (dismissed) {
      line = 'Not now — you can still add it.';
      actions = (
        <Button className="connector-pill-btn" onClick={propose} disabled={hold}>
          Add anyway ↗
        </Button>
      );
    } else {
      actions = (
        <>
          <Button tone="primary" className="connector-pill-btn" onClick={propose} disabled={hold}>
            Check & add ↗
          </Button>
          <Button className="connector-pill-btn" onClick={() => void dismissConnectorPill(row.id)}>
            Not now
          </Button>
        </>
      );
    }
    body = (
      <>
        <span className="connector-pill-link">{url}</span>
        <span className="connector-pill-actions">{actions}</span>
        {line ? (
          <span id={lineId} className="connector-pill-line">
            {line}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <div className="connector-pill-block">
      <fieldset
        aria-label={label}
        className="connector-pill"
        data-state={derived.kind === 'failed' ? 'failed' : undefined}
      >
        <Headline host={host} />
        {body}
      </fieldset>
    </div>
  );
}
