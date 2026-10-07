// SPDX-License-Identifier: AGPL-3.0-only

import {
  type ImageModelConfig,
  type TtiDescriptor,
  formatPriceCents,
  latencyFor,
  priceCentsFor,
} from '@chatsundere/llm-unified';
import type { VariantEntry } from './tti-picker-model.js';

interface RowOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** One labelled row of mutually exclusive option buttons (aria-pressed marks the pick). */
function OptionRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<RowOption>;
  value: string | null;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-24 shrink-0 text-[11px] uppercase tracking-widest text-paper-soft">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-disabled={o.disabled ? true : undefined}
          onClick={() => {
            if (!o.disabled) onChange(o.value);
          }}
          className={`rounded-md border px-2.5 py-1 text-xs ${
            o.value === value
              ? 'border-paper/40 bg-white/[0.08] text-paper'
              : 'border-white/5 bg-white/[0.02] text-paper-soft hover:bg-white/[0.04]'
          } ${o.disabled ? 'opacity-50' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  meta: TtiDescriptor;
  providerName: string;
  config: ImageModelConfig;
  /** Set when the saved offering's provider is unusable. */
  staleReason: string | null;
  variants: VariantEntry[];
  onSelectVariant: (ref: string) => void;
  onChange: (config: ImageModelConfig) => void;
}

/**
 * The one config view for every image model (spec §3.2): identity line, then
 * Variant / Aspect / Resolution / Quality rows — each only when it offers more
 * than one choice.
 */
export function ImageModelConfigView({
  meta,
  providerName,
  config,
  staleReason,
  variants,
  onSelectVariant,
  onChange,
}: Props): JSX.Element {
  const price = priceCentsFor(meta, config);
  const identity = staleReason
    ? `${meta.displayName} · ${providerName} — ${staleReason}`
    : `${meta.displayName} · ${providerName}${
        price === undefined ? '' : ` · ${formatPriceCents(price, meta.billing)} per image`
      }`;

  const selectedVariant = variants.find((v) => v.selected)?.ref ?? null;
  const resolutions = meta.resolutions ?? [];
  const qualities = meta.qualities ?? [];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-paper-soft">{identity}</p>
      {variants.length > 1 ? (
        <OptionRow
          label="Variant"
          options={variants.map((v) => ({
            value: v.ref,
            label: v.reason ? `${v.label} — ${v.reason}` : v.label,
            disabled: v.disabled,
          }))}
          value={selectedVariant}
          onChange={onSelectVariant}
        />
      ) : null}
      {meta.aspects.length > 1 ? (
        <OptionRow
          label="Aspect"
          options={meta.aspects.map((a) => ({ value: a, label: a }))}
          value={config.aspect}
          onChange={(aspect) => onChange({ ...config, aspect })}
        />
      ) : null}
      {resolutions.length > 1 ? (
        <OptionRow
          label="Resolution"
          options={resolutions.map((r) => {
            const cents = priceCentsFor(meta, { ...config, resolution: r.id });
            return {
              value: r.id,
              label:
                cents === undefined
                  ? r.label
                  : `${r.label} · ${formatPriceCents(cents, meta.billing)}`,
            };
          })}
          value={config.resolution}
          onChange={(resolution) => onChange({ ...config, resolution })}
        />
      ) : null}
      {qualities.length > 1 ? (
        <OptionRow
          label="Quality"
          options={qualities.map((q) => {
            const wait = latencyFor(meta, { ...config, quality: q.id });
            return { value: q.id, label: wait ? `${q.label} · ${wait}` : q.label };
          })}
          value={config.quality}
          onChange={(quality) => onChange({ ...config, quality })}
        />
      ) : null}
      <p className="text-[11px] text-paper-soft">
        Estimated price per image, billed by the provider.
      </p>
    </div>
  );
}
