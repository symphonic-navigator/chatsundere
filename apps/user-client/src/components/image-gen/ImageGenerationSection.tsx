// SPDX-License-Identifier: AGPL-3.0-only

import {
  type ImageModelConfig,
  type ImageSlot,
  carryOverConfig,
  getProvider,
  getTtiDescriptor,
  isValidConfigFor,
  listTtiOfferings,
  upgradeImageSlot,
} from '@chatsundere/llm-unified';
import type { StoredImageSlot } from '../../boot/client-data-db.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { useServerGate } from '../../lib/server-gate.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';
import { TtiModelSelect } from './TtiModelSelect.js';
import { ImageModelConfigView } from './config-views.js';
import {
  type PickerFamily,
  buildPickerFamilies,
  familyTapTarget,
  variantEntries,
} from './tti-picker-model.js';

type Slot = ImageSlot | null;

const disabledRowClass =
  'rounded-md border border-white/5 bg-white/[0.02] p-3 text-sm text-paper-soft';

function providerName(id: string): string {
  return getProvider(id)?.displayName ?? id;
}

/** Select `ref` in a slot: remembered config if it still fits, else carry-over. */
function selectRef(prev: Slot, ref: string): Slot {
  const meta = getTtiDescriptor(ref);
  if (!meta) return prev;
  const remembered = prev?.lastConfigByRef?.[ref];
  const config: ImageModelConfig =
    remembered && isValidConfigFor(meta, remembered)
      ? remembered
      : prev
        ? carryOverConfig(prev.config, meta)
        : meta.defaults;
  return withConfig(prev, ref, config);
}

/** Store `config` as the slot's current config and remember it for `ref`. */
function withConfig(prev: Slot, ref: string, config: ImageModelConfig): ImageSlot {
  return { ref, config, lastConfigByRef: { ...(prev?.lastConfigByRef ?? {}), [ref]: config } };
}

/**
 * My Settings — image generation. Picks the global primary image model (and,
 * once one is curated, an NSFW-capable second slot) plus its config. Every
 * change persists immediately — not governed by the SaveBar (spec 2026-06-09
 * §6). Family-first picker per spec 2026-10-07 §3.
 */
export function ImageGenerationSection(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const hasProxy = useServerGate('proxy').enabled;
  const usable = usableTemplateIds(rows, hasProxy);

  const reasonFor = (id: string): string => {
    const name = providerName(id);
    const configured = rows.some((r) => r.templateId === id && r.enabled && r.apiKey !== null);
    return configured && getProvider(id)?.corsHint === 'requires-proxy' && !hasProxy
      ? `${name} needs the relay server`
      : `${name} is not set up — add it under Upstream Providers above`;
  };

  // Defensive: an older row may predate the v19 migration.
  const stored = settings?.imageGeneration ?? { primary: null, nsfw: null };
  const primary = upgradeImageSlot(stored.primary, getTtiDescriptor);
  const nsfw = upgradeImageSlot(stored.nsfw, getTtiDescriptor);

  const persist = (next: { primary: Slot | StoredImageSlot; nsfw: Slot | StoredImageSlot }) =>
    update.mutate({ imageGeneration: next });

  const offerings = listTtiOfferings();
  const nsfwOfferingExists = offerings.some((o) => o.tti?.canDoNsfw === true);
  const primaryCanDoNsfw = primary ? getTtiDescriptor(primary.ref)?.canDoNsfw === true : false;

  const renderSlot = (
    which: 'primary' | 'nsfw',
    slot: Slot,
    save: (next: Slot) => void,
    opts: { nsfwOnly: boolean; disabled: boolean },
  ): JSX.Element => {
    const families = buildPickerFamilies({
      offerings,
      usableTemplateIds: usable,
      providerName,
      reasonFor,
      nsfwOnly: opts.nsfwOnly,
      savedRef: slot?.ref ?? null,
    });
    const meta = slot ? getTtiDescriptor(slot.ref) : undefined;
    const family: PickerFamily | undefined = families.find((f) => f.selected);
    const saved = family?.offerings.find((o) => o.ref === slot?.ref);

    return (
      <div data-testid={`image-slot-${which}`}>
        <TtiModelSelect
          families={families}
          noUsableProvider={!families.some((f) => f.usable)}
          hasSelection={slot !== null}
          disabled={opts.disabled}
          onTapFamily={(f) => {
            const target = familyTapTarget(f, slot?.ref ?? null);
            if (target) save(selectRef(slot, target));
          }}
          onClear={() => save(null)}
        />
        {slot && meta && family ? (
          <div className="mt-3">
            <ImageModelConfigView
              meta={meta}
              providerName={providerName(slot.ref.slice(0, slot.ref.indexOf(':')))}
              config={slot.config}
              staleReason={saved && !saved.usable ? saved.reason : null}
              variants={variantEntries(family, slot.ref)}
              onSelectVariant={(ref) => save(selectRef(slot, ref))}
              onChange={(config) => save(withConfig(slot, slot.ref, config))}
            />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      <p className="mb-3 text-[11px] text-paper-soft">
        The model your Circle paints with when a persona generates an image. One global choice for
        all personas — changes apply immediately.
      </p>

      <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
        Primary model
      </div>
      {renderSlot('primary', primary, (next) => persist({ primary: next, nsfw: stored.nsfw }), {
        nsfwOnly: false,
        disabled: false,
      })}

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
            {renderSlot('nsfw', nsfw, (next) => persist({ primary: stored.primary, nsfw: next }), {
              nsfwOnly: true,
              disabled: primary === null,
            })}
          </>
        )}
      </div>
    </div>
  );
}
