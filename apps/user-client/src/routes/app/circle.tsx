// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';
import { PersonaCard } from '../../components/PersonaCard.js';
import { usePersonas } from '../../data/personas.js';
import { useProviders } from '../../data/providers.js';

/** My Circle — lists the user's personas and exposes a FAB to create a new one. */
export function Circle(): JSX.Element {
  const navigate = useNavigate();
  const personas = usePersonas();
  const providers = useProviders();
  const enabledProviderIds = new Set(
    (providers.data ?? []).filter((p) => p.enabled).map((p) => p.id),
  );

  return (
    <section className="flex min-h-[80dvh] flex-col gap-3 px-4 pb-24 pt-4">
      <header className="flex items-center gap-3 pb-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/app')}
          className="grid h-10 w-10 place-items-center rounded-md text-2xl leading-none text-paper-soft hover:bg-white/5 hover:text-paper"
        >
          ←
        </button>
        <span className="font-display text-sm text-paper">My Circle</span>
      </header>

      {personas.data && personas.data.length === 0 ? (
        <div className="mt-8 grid place-items-center text-center text-paper-soft">
          <p className="font-display text-lg italic text-paper">No personas yet</p>
          <p className="mt-2 max-w-xs text-sm">
            Tap the "+" button below to create your first companion.
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {(personas.data ?? []).map((p) => (
          <PersonaCard
            key={p.id}
            persona={p}
            hasProvider={enabledProviderIds.has(p.providerId)}
            onChat={(_id) => {
              // Phase-3 work: open or create a chat surface. No-op for Phase 2.
            }}
          />
        ))}
      </ul>

      <button
        type="button"
        aria-label="New persona"
        onClick={() => navigate('/app/persona/new')}
        className="fixed bottom-6 right-6 z-10 grid h-14 w-14 place-items-center rounded-full bg-paper text-3xl leading-none text-ink shadow-2xl transition-transform hover:scale-105"
      >
        +
      </button>
    </section>
  );
}
