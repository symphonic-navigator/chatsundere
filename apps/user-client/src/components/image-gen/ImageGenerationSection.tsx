// SPDX-License-Identifier: AGPL-3.0-only

import {
  type ImageModelConfig,
  defaultConfigFor,
  isImageModelConfig,
  listTtiOfferings,
} from '@chatsundere/llm-unified';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { useServerGate } from '../../lib/server-gate.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';
import { TtiModelSelect } from './TtiModelSelect.js';
import { ImageModelConfigView } from './config-views.js';

type ImageGenSlot = { ref: string; config: ImageModelConfig } | null;

/** Validate a stored slot; an invalid or stale config renders as unset. */
function validSlot(slot: ImageGenSlot | undefined): ImageGenSlot {
  if (!slot || !isImageModelConfig(slot.config)) return null;
  return slot;
}

function offeringFor(ref: string) {
  const idx = ref.indexOf(':');
  if (idx < 0) return undefined;
  const providerId = ref.slice(0, idx);
  const upstreamSlug = ref.slice(idx + 1);
  return listTtiOfferings().find(
    (o) => o.providerId === providerId && o.upstreamSlug === upstreamSlug,
  );
}

const disabledRowClass =
  'rounded-md border border-white/5 bg-white/[0.02] p-3 text-sm text-paper-soft';

/**
 * My Settings — image generation. Picks the global primary image model (and,
 * once one is curated, an NSFW-capable second slot) plus its per-model config.
 * Every change persists immediately — this section is not governed by the
 * SaveBar (spec 2026-06-09 §6).
 */
export function ImageGenerationSection(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const hasProxy = useServerGate('proxy').enabled;
  const usable = usableTemplateIds(rows, hasProxy);

  // Defensive: an older row may predate the v19 migration.
  const stored = settings?.imageGeneration ?? { primary: null, nsfw: null };
  const primary = validSlot(stored.primary);
  const nsfw = validSlot(stored.nsfw);

  const persist = (next: { primary: ImageGenSlot; nsfw: ImageGenSlot }) =>
    update.mutate({ imageGeneration: next });

  const nsfwOfferingExists = listTtiOfferings().some((o) => o.tti?.canDoNsfw === true);
  const primaryCanDoNsfw = primary ? offeringFor(primary.ref)?.tti?.canDoNsfw === true : false;

  return (
    <div>
      <p className="mb-3 text-[11px] text-paper-soft">
        The model your Circle paints with when a persona generates an image. One global choice for
        all personas — changes apply immediately.
      </p>

      <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
        Primary model
      </div>
      <TtiModelSelect
        usableTemplateIds={usable}
        selectedRef={primary?.ref ?? null}
        onSelect={(sel) =>
          persist({
            primary: { ref: sel.ref, config: defaultConfigFor(sel.groupId) },
            nsfw: stored.nsfw,
          })
        }
        onClear={() => persist({ primary: null, nsfw: stored.nsfw })}
      />
      {primary ? (
        <div className="mt-3">
          <ImageModelConfigView
            config={primary.config}
            onChange={(config) =>
              persist({ primary: { ref: primary.ref, config }, nsfw: stored.nsfw })
            }
          />
        </div>
      ) : null}

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
          NSFW model
        </div>
        {!nsfwOfferingExists ? (
          <p className={disabledRowClass}>
            No NSFW-capable image model exists yet — this slot lights up automatically when one is
            curated. Nothing for you to do.
          </p>
        ) : primaryCanDoNsfw ? (
          <p className={disabledRowClass}>Your primary model already supports NSFW.</p>
        ) : (
          <>
            {primary === null ? (
              <p className="mb-2 text-[11px] text-paper-soft">Pick a primary model first.</p>
            ) : null}
            <TtiModelSelect
              nsfwOnly
              disabled={primary === null}
              usableTemplateIds={usable}
              selectedRef={nsfw?.ref ?? null}
              onSelect={(sel) =>
                persist({
                  primary: stored.primary,
                  nsfw: { ref: sel.ref, config: defaultConfigFor(sel.groupId) },
                })
              }
              onClear={() => persist({ primary: stored.primary, nsfw: null })}
            />
            {nsfw && primary !== null ? (
              <div className="mt-3">
                <ImageModelConfigView
                  config={nsfw.config}
                  onChange={(config) =>
                    persist({ primary: stored.primary, nsfw: { ref: nsfw.ref, config } })
                  }
                />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
