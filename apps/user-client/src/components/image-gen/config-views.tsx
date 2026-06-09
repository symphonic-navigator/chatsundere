// SPDX-License-Identifier: AGPL-3.0-only

import type {
  ImageModelConfig,
  SeedreamConfig,
  XaiImagineConfig,
  ZImageConfig,
} from '@chatsundere/llm-unified';

interface OptionRowProps<T extends string> {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}

/** One labelled row of mutually exclusive option buttons (aria-pressed marks the pick). */
function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: OptionRowProps<T>): JSX.Element {
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
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-2.5 py-1 text-xs ${
            o.value === value
              ? 'border-paper/40 bg-white/[0.08] text-paper'
              : 'border-white/5 bg-white/[0.02] text-paper-soft hover:bg-white/[0.04]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const XAI_TIERS = [
  { value: 'normal', label: 'Normal' },
  { value: 'quality', label: 'Quality' },
] as const satisfies ReadonlyArray<{ value: XaiImagineConfig['tier']; label: string }>;

const XAI_RESOLUTIONS = [
  { value: '1k', label: '1k' },
  { value: '2k', label: '2k' },
] as const satisfies ReadonlyArray<{ value: XaiImagineConfig['resolution']; label: string }>;

const XAI_ASPECTS = (['1:1', '16:9', '9:16', '4:3', '3:4'] as const).map((a) => ({
  value: a,
  label: a,
}));

/** Grok Imagine: tier, resolution and aspect rows. */
export function XaiImagineConfigView({
  config,
  onChange,
}: {
  config: XaiImagineConfig;
  onChange: (c: XaiImagineConfig) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <OptionRow
        label="Tier"
        options={XAI_TIERS}
        value={config.tier}
        onChange={(tier) => onChange({ ...config, tier })}
      />
      <OptionRow
        label="Resolution"
        options={XAI_RESOLUTIONS}
        value={config.resolution}
        onChange={(resolution) => onChange({ ...config, resolution })}
      />
      <OptionRow
        label="Aspect"
        options={XAI_ASPECTS}
        value={config.aspect}
        onChange={(aspect) => onChange({ ...config, aspect })}
      />
    </div>
  );
}

const ZIMAGE_VARIANTS = [
  { value: 'turbo', label: 'Turbo' },
  { value: 'base', label: 'Base (~10× slower)' },
] as const satisfies ReadonlyArray<{ value: ZImageConfig['variant']; label: string }>;

const ZIMAGE_SIZES = (
  [
    '256x256',
    '512x512',
    '768x768',
    '1024x1024',
    '1280x720',
    '720x1280',
    '1536x1024',
    '1024x1536',
    '1536x1536',
  ] as const
).map((s) => ({ value: s, label: s.replace('x', ' × ') }));

/** Z-Image: variant and size rows. */
export function ZImageConfigView({
  config,
  onChange,
}: {
  config: ZImageConfig;
  onChange: (c: ZImageConfig) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <OptionRow
        label="Variant"
        options={ZIMAGE_VARIANTS}
        value={config.variant}
        onChange={(variant) => onChange({ ...config, variant })}
      />
      <OptionRow
        label="Size"
        options={ZIMAGE_SIZES}
        value={config.size}
        onChange={(size) => onChange({ ...config, size })}
      />
    </div>
  );
}

const SEEDREAM_ASPECTS = (['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const).map(
  (a) => ({ value: a, label: a }),
);

const SEEDREAM_QUALITIES = [
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
] as const satisfies ReadonlyArray<{ value: SeedreamConfig['quality']; label: string }>;

/** Seedream 4.5: aspect and quality rows. */
export function SeedreamConfigView({
  config,
  onChange,
}: {
  config: SeedreamConfig;
  onChange: (c: SeedreamConfig) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <OptionRow
        label="Aspect"
        options={SEEDREAM_ASPECTS}
        value={config.aspect}
        onChange={(aspect) => onChange({ ...config, aspect })}
      />
      <OptionRow
        label="Quality"
        options={SEEDREAM_QUALITIES}
        value={config.quality}
        onChange={(quality) => onChange({ ...config, quality })}
      />
    </div>
  );
}

/** Dispatch on the stored config's group — one view per image-model family. */
export function ImageModelConfigView({
  config,
  onChange,
}: {
  config: ImageModelConfig;
  onChange: (c: ImageModelConfig) => void;
}): JSX.Element {
  switch (config.groupId) {
    case 'xai-imagine':
      return <XaiImagineConfigView config={config} onChange={onChange} />;
    case 'zimage':
      return <ZImageConfigView config={config} onChange={onChange} />;
    case 'seedream':
      return <SeedreamConfigView config={config} onChange={onChange} />;
  }
}
