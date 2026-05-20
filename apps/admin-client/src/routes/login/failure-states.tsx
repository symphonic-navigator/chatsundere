// SPDX-License-Identifier: AGPL-3.0-only
import { copy } from '../../copy.js';

interface FailureProps {
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}

function Failure({ title, body, cta, onCta }: FailureProps) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-medium">{title}</h1>
        <p className="text-[var(--color-subtext-0)]">{body}</p>
        <button
          type="button"
          onClick={onCta}
          className="rounded-md bg-[var(--color-mauve)] px-4 py-2 text-[var(--color-base)]"
        >
          {cta}
        </button>
      </div>
    </main>
  );
}

export function NoAccountFailure() {
  const c = copy.login.failures.noAccount;
  return (
    <Failure
      title={c.title}
      body={c.body}
      cta={c.cta}
      onCta={() => {
        window.location.href = '/';
      }}
    />
  );
}

export function NoLinkFailure() {
  const c = copy.login.failures.noLink;
  return (
    <Failure
      title={c.title}
      body={c.body}
      cta={c.cta}
      onCta={() => {
        window.location.href = '/';
      }}
    />
  );
}

export function OfflineFailure({ onRetry }: { onRetry: () => void }) {
  const c = copy.login.failures.offline;
  return <Failure title={c.title} body={c.body} cta={c.cta} onCta={onRetry} />;
}

export function NotAdminFailure() {
  const c = copy.login.failures.notAdmin;
  return (
    <Failure
      title={c.title}
      body={c.body}
      cta={c.cta}
      onCta={() => {
        window.location.href = '/';
      }}
    />
  );
}
