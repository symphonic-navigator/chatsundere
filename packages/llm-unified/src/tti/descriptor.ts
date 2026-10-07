// SPDX-License-Identifier: LGPL-3.0-only

/** One selectable value in a config row. `id` is the wire value or table key. */
export interface TtiOption {
  id: string;
  label: string;
}

/**
 * The user's three choices for an image offering. Which model is meant lives
 * only in the slot's `ref`; `resolution` / `quality` are null exactly when the
 * offering has no such row.
 */
export interface ImageModelConfig {
  aspect: string;
  resolution: string | null;
  quality: string | null;
}

/** How an offering's `/images/generations` body is shaped (see build-payload.ts). */
export type TtiWire =
  | {
      kind: 'aspect-resolution';
      /** false = the model ignores resolution (Seedream 5.0 Pro), so none is sent. */
      sendResolution: boolean;
      /** Body field that carries `config.quality`, when the model has a quality row. */
      qualityParam?: 'quality' | 'thinking_level';
      /** xAI direct: the quality picks the upstream model instead of a body field. */
      modelByQuality?: Readonly<Record<string, string>>;
      /** Fixed extra body fields, e.g. `{ output_format: 'jpeg' }`. */
      extra?: Readonly<Record<string, string>>;
      /** xAI's CDN is closed to browsers, so xAI returns inline base64. */
      responseFormat: 'url' | 'b64_json';
    }
  | {
      kind: 'size-table';
      /** `${aspect}|${resolution ?? '-'}` → [width, height]; sent as `size: 'WxH'`. */
      sizes: Readonly<Record<string, readonly [number, number]>>;
      qualityParam?: 'quality';
      responseFormat: 'url';
    };

/**
 * Everything the app needs to know about one TTI offering: how the picker
 * groups it, which choices it offers, what they cost, and how its request is
 * built. A new image model is one of these — no new code.
 */
export interface TtiDescriptor {
  /** Picker button, e.g. 'Seedream'. */
  family: string;
  /** Variant-row label; null when the offering is its family's only member. */
  variant: string | null;
  /** Full human-readable name, e.g. 'Seedream 5.0 Flash'. */
  displayName: string;
  canDoNsfw: boolean;
  /** Hard cap for the generate_image tool's `count`. */
  maxCount: number;
  timeoutMs: number;
  aspects: readonly string[];
  /** null = no Resolution row. */
  resolutions: readonly TtiOption[] | null;
  /** null = no Quality row. */
  qualities: readonly TtiOption[] | null;
  /** Estimated US cents per image, keyed `${resolution ?? '-'}|${quality ?? '-'}`. */
  priceCents: Readonly<Record<string, number>>;
  /** Optional wait-time hints, keyed like `priceCents`. */
  latency?: Readonly<Record<string, string>>;
  /** Optional hint on the Variant button, e.g. '~10× slower'. */
  latencyHint?: string;
  /** 'usage' = billed by actual usage, so prices render with a leading '~'. */
  billing: 'fixed' | 'usage';
  /** The family's default pick when its button is tapped. At most one per family. */
  recommended?: boolean;
  defaults: ImageModelConfig;
  wire: TtiWire;
  /** xAI marks refused items per entry (`respect_moderation: false`). */
  perItemModeration: boolean;
}
