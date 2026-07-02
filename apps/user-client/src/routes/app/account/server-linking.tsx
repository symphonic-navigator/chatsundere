// SPDX-License-Identifier: AGPL-3.0-only

import { getLinkedAccount } from '@chatsundere/crypto';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../../../boot/open-db.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { copy } from '../../../lib/copy.js';

const ROLE_LABELS: Record<'primary_admin' | 'admin' | 'user', string> = {
  primary_admin: copy.serverLinking.rolePrimaryAdmin,
  admin: copy.serverLinking.roleAdmin,
  user: copy.serverLinking.roleUser,
};

const LINKED_SINCE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Server linking sub-page (`/app/account/server-linking`). Reads the current
 * link status from the account-link store and renders one of three states:
 * a calm "Checking…" line while the boot-time read is still pending, the
 * local-only view with a "Link to server" call-to-action, or the linked view
 * with a success Badge and the server's operator, role, and linked-since.
 */
export function ServerLinkingPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('server-linking');
  const navigate = useNavigate();

  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const baseUrl = useAccountLinkStore((s) => s.baseUrl);
  const role = useAccountLinkStore((s) => s.role);
  const issuerLabel = useAccountLinkStore((s) => s.issuerLabel);

  // The store does not carry linked_at; read it once from the crypto IDB when
  // linked. A failed read simply omits the linked-since line — never fatal.
  const [linkedAt, setLinkedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (linkStatus !== 'linked') return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await getLinkedAccount(getDb());
        if (!cancelled && row) setLinkedAt(row.linked_at);
      } catch {
        // Non-fatal: the linked-since line is omitted if the read fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linkStatus]);

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Server linking' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="space-y-6 px-4 pb-8 pt-2">
        {linkStatus === 'unknown' && (
          <p className="text-[11px] text-paper-soft">{copy.serverLinking.checking}</p>
        )}

        {linkStatus === 'local-only' && (
          <>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-widest text-paper-soft">
                {copy.serverLinking.statusLabel}
              </p>
              <Badge tone="neutral">{copy.serverLinking.localOnlyTitle}</Badge>
            </div>

            <p className="text-[11px] text-paper-soft">{copy.serverLinking.localOnlyBody}</p>

            <Button
              tone="primary"
              onClick={() => navigate('/onboarding/invitation?return=/app/account/server-linking')}
            >
              {copy.serverLinking.linkCta}
            </Button>
          </>
        )}

        {linkStatus === 'linked' && baseUrl && (
          <>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-widest text-paper-soft">
                {copy.serverLinking.statusLabel}
              </p>
              <Badge tone="success">{`${copy.serverLinking.linkedToPrefix} ${baseUrl}`}</Badge>
            </div>

            <dl className="space-y-2 text-[11px]">
              {issuerLabel && (
                <div className="flex justify-between gap-4">
                  <dt className="text-paper-soft">{copy.serverLinking.operatorTerm}</dt>
                  <dd className="text-paper">{issuerLabel}</dd>
                </div>
              )}
              {role && (
                <div className="flex justify-between gap-4">
                  <dt className="text-paper-soft">{copy.serverLinking.roleTerm}</dt>
                  <dd className="text-paper">{ROLE_LABELS[role]}</dd>
                </div>
              )}
              {linkedAt && (
                <div className="flex justify-between gap-4">
                  <dt className="text-paper-soft">{copy.serverLinking.linkedSinceTerm}</dt>
                  <dd className="text-paper">{LINKED_SINCE_FORMAT.format(linkedAt)}</dd>
                </div>
              )}
            </dl>
          </>
        )}
      </div>
    </PageScaffold>
  );
}
