// SPDX-License-Identifier: AGPL-3.0-only
import { getProvider } from '@chatsundere/llm-unified';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OfferingResolution } from '../../lib/resolve-offering.js';
import { useAppUpdateStore } from '../../sw/app-update.store.js';
import { rememberReturnPath } from '../../sw/post-update-return.js';

type Phase = 'checking' | 'installing' | 'none';

// A failed worker install never fires onNeedRefresh, so the downloading row
// re-peeks on this cadence until it resolves to ready or none. A peek, not a
// check: reg.update() would restart a failing install and keep it 'installing'.
const INSTALL_RECHECK_MS = 10_000;

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

interface Props {
  resolution: Exclude<OfferingResolution, { kind: 'ok' }>;
  onSetUpProvider: (templateId: string) => void;
  onChooseModel: () => void;
}

function Slug({ id }: { id: string }): JSX.Element {
  return <code className="cockpit-unavailable-slug">{id}</code>;
}

/**
 * Stands in the cockpit's slot when the persona's model cannot be composed
 * against, naming the reason and offering exactly one next step
 * (spec 2026-09-26 §3.2).
 */
export function CockpitUnavailable({
  resolution,
  onSetUpProvider,
  onChooseModel,
}: Props): JSX.Element {
  const updateReady = useAppUpdateStore((s) => s.updateReady);
  const modelId = resolution.kind === 'model-unknown' ? resolution.modelId : '';
  // Only a non-empty unknown slug can be fixed by an update; everything else never checks.
  const canCheck = resolution.kind === 'model-unknown' && modelId !== '';
  const [phase, setPhase] = useState<Phase>(() =>
    canCheck && navigator.onLine ? 'checking' : 'none',
  );
  const online = useOnline();
  // Set after a user-started Check again finds nothing; cleared by the next state change.
  const [noNewer, setNoNewer] = useState(false);
  const cancelledRef = useRef(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const checkAgainRef = useRef<HTMLButtonElement>(null);

  const runCheck = (userStarted = false): void => {
    setPhase('checking');
    setNoNewer(false);
    void useAppUpdateStore
      .getState()
      .checkForUpdate()
      .then((result) => {
        // 'ready' needs no phase: markUpdateReady flips updateReady, which drives the row.
        if (cancelledRef.current || result === 'ready') return;
        setPhase(result);
        if (userStarted && result === 'none') setNoNewer(true);
      });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — the auto-check must fire once, not on every re-render
  useEffect(() => {
    cancelledRef.current = false;
    if (canCheck && !useAppUpdateStore.getState().updateReady && navigator.onLine) runCheck();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'installing' || updateReady) return;
    const id = window.setInterval(() => {
      const result = useAppUpdateStore.getState().peekForUpdate();
      if (result === 'none') setPhase('none');
    }, INSTALL_RECHECK_MS);
    return () => window.clearInterval(id);
  }, [phase, updateReady]);

  // Check again vanished while checking, dropping focus to the body; hand it back
  // so a keyboard user can simply try again.
  useEffect(() => {
    if (noNewer) checkAgainRef.current?.focus();
  }, [noNewer]);

  // Mount-only on purpose: a live row change (checking → update ready) must not
  // move focus. Harmless navigation buttons take focus; anything else (notably
  // Update now, which ends the session) leaves it on the region so a reflexive
  // Enter from a user who expected the composer does nothing.
  useEffect(() => {
    (primaryRef.current ?? regionRef.current)?.focus();
  }, []);

  let body: JSX.Element;
  if (resolution.kind === 'provider-unavailable') {
    const name = getProvider(resolution.templateId)?.displayName ?? resolution.templateId;
    body = (
      <>
        <p className="cockpit-unavailable-text">{name} isn't set up on this device.</p>
        <button
          ref={primaryRef}
          type="button"
          className="cockpit-unavailable-action"
          onClick={() => onSetUpProvider(resolution.templateId)}
        >
          Set up {name}
        </button>
      </>
    );
  } else if (modelId === '') {
    body = (
      <>
        <p className="cockpit-unavailable-text">This persona has no model selected.</p>
        <button
          ref={primaryRef}
          type="button"
          className="cockpit-unavailable-action"
          onClick={onChooseModel}
        >
          Choose a model
        </button>
      </>
    );
  } else if (updateReady) {
    body = (
      <>
        <p className="cockpit-unavailable-text">
          <Slug id={modelId} /> needs a newer version of Chatsundere.
        </p>
        <p className="cockpit-unavailable-subline">
          Chatsundere will restart; you'll unlock once and come straight back here.
        </p>
        <button
          type="button"
          className="cockpit-unavailable-action"
          onClick={() => {
            rememberReturnPath();
            useAppUpdateStore.getState().applyUpdate();
          }}
        >
          Update now
        </button>
      </>
    );
  } else if (phase === 'checking') {
    body = <p className="cockpit-unavailable-text">Checking for a newer version…</p>;
  } else if (phase === 'installing') {
    body = (
      <p className="cockpit-unavailable-text">A newer version of Chatsundere is downloading…</p>
    );
  } else {
    body = (
      <>
        <p className="cockpit-unavailable-text">
          <Slug id={modelId} /> isn't available in this version of Chatsundere.
        </p>
        <button
          ref={primaryRef}
          type="button"
          className="cockpit-unavailable-action"
          onClick={onChooseModel}
        >
          Choose another model
        </button>
        <button
          ref={checkAgainRef}
          type="button"
          className="cockpit-unavailable-secondary"
          disabled={!online}
          title={online ? undefined : "You're offline"}
          onClick={() => runCheck(true)}
        >
          Check again
        </button>
        {noNewer ? <p className="cockpit-unavailable-subline">No newer version yet.</p> : null}
      </>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: the live region holds block paragraphs and buttons; <output> only permits phrasing content
    <div ref={regionRef} role="status" tabIndex={-1} className="cockpit-unavailable">
      {body}
    </div>
  );
}
