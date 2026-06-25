// SPDX-License-Identifier: AGPL-3.0-only
import type { SearchTier, WebTrait } from '@chatsundere/llm-unified';
import { useEffect, useRef, useState } from 'react';
import type { WebBackendOption } from '../lib/web-backend-options.js';
import { type WebBackendSetting, resolveWebBackend } from '../lib/web-backends.js';
import { PickerOverlay } from './ui/PickerOverlay.js';

export interface WebPickerValue {
  search: WebBackendSetting;
  fetch: WebBackendSetting;
  searchTierId: string | null; // expert mode only; pass-through in general mode
}
export interface WebPickerOverlayProps {
  open: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  title: string;
  mode: 'general' | 'expert';
  options: WebBackendOption[];
  searchTiers: SearchTier[];
  initial: WebPickerValue;
  onSave: (next: WebPickerValue) => void;
}

const TRAIT_LABEL: Record<WebTrait, string> = {
  recommended: 'Recommended',
  ai: 'AI',
  neural: 'Neural',
  privacy: 'Privacy',
};

const keyOf = (o: { providerId: string; upstreamSlug: string }): string =>
  `${o.providerId}::${o.upstreamSlug}`;

const displayName = (o: WebBackendOption): string =>
  o.label === o.providerName ? o.label : `${o.label} (${o.providerName})`;

function settingFromValue(v: string): WebBackendSetting {
  if (v === '') return 'off';
  const parts = v.split('::');
  const providerId = parts[0];
  const upstreamSlug = parts[1];
  return providerId && upstreamSlug ? { providerId, upstreamSlug } : 'off';
}

/** True when the stored setting is an explicit ref no longer present for this kind. */
function isStale(
  setting: WebBackendSetting,
  options: WebBackendOption[],
  kind: 'search' | 'fetch',
): boolean {
  if (setting === 'off' || setting === null) return false;
  const usable = options.filter((o) => (kind === 'search' ? o.canSearch : o.canFetch));
  return !usable.some(
    (o) => o.providerId === setting.providerId && o.upstreamSlug === setting.upstreamSlug,
  );
}

/**
 * Structural equality for WebBackendSetting. JSON.stringify was fine for
 * correctness but allocates two strings on every render; a direct field
 * comparison is both faster and more legible.
 */
function sameSetting(a: WebBackendSetting, b: WebBackendSetting): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return a.providerId === b.providerId && a.upstreamSlug === b.upstreamSlug;
  }
  return false;
}

function BackendField({
  id,
  label,
  kind,
  options,
  setting,
  onChange,
}: {
  id: string;
  label: string;
  /** 'search' or 'fetch' — named `kind` to avoid the ARIA-role lint. */
  kind: 'search' | 'fetch';
  options: WebBackendOption[];
  setting: WebBackendSetting;
  onChange: (s: WebBackendSetting) => void;
}): JSX.Element {
  const kindOptions = options.filter((o) => (kind === 'search' ? o.canSearch : o.canFetch));
  const effective = resolveWebBackend(setting, options, kind);
  const effectiveOption = effective
    ? kindOptions.find(
        (o) => o.providerId === effective.providerId && o.upstreamSlug === effective.upstreamSlug,
      )
    : undefined;
  const value = setting === 'off' || effective === null ? '' : keyOf(effective);
  const stale = isStale(setting, options, kind);

  return (
    <div className="web-field">
      <label htmlFor={id}>{label}</label>
      <div className="web-select-wrap">
        <select
          id={id}
          className="web-select"
          value={value}
          onChange={(e) => onChange(settingFromValue(e.target.value))}
        >
          {/* "Off" first-class: kept an explicit, labelled option (Laura SOFT-4) */}
          <option value="">Off</option>
          {kindOptions.map((o) => (
            <option key={keyOf(o)} value={keyOf(o)}>
              {displayName(o)}
            </option>
          ))}
        </select>
      </div>
      {stale ? (
        <p className="web-stale-note">
          Your chosen {kind} backend is unavailable — pick another or it stays off.
        </p>
      ) : effectiveOption && effectiveOption.traits.length > 0 ? (
        <span className="web-traits">
          {effectiveOption.traits.map((t) => (
            <span key={t} className="web-trait-pill">
              {TRAIT_LABEL[t]}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/** The web backends picker (spec §5): search + fetch (+ depth in expert mode),
 *  staged under one Save. */
export function WebPickerOverlay({
  open,
  onClose,
  triggerRef,
  title,
  mode,
  options,
  searchTiers,
  initial,
  onSave,
}: WebPickerOverlayProps): JSX.Element {
  const [draft, setDraft] = useState<WebPickerValue>(initial);
  const wasOpen = useRef(false);

  // Re-seed only on the closed→open transition, not on every identity change of
  // `initial` while the sheet is already open — prevents call-site re-renders from
  // clobbering a staged but unsaved edit.
  useEffect(() => {
    if (open && !wasOpen.current) setDraft(initial);
    wasOpen.current = open;
  }, [open, initial]);

  const dirty =
    !sameSetting(draft.search, initial.search) ||
    !sameSetting(draft.fetch, initial.fetch) ||
    draft.searchTierId !== initial.searchTierId;

  return (
    <PickerOverlay
      open={open}
      title={title}
      onClose={onClose}
      triggerRef={triggerRef}
      onSave={() => onSave(draft)}
      saveDisabled={!dirty}
      dirty={dirty}
    >
      <div className="expert-web p-4">
        <BackendField
          id="web-search-backend"
          label="Search backend"
          kind="search"
          options={options}
          setting={draft.search}
          onChange={(search) => setDraft((d) => ({ ...d, search }))}
        />
        {mode === 'expert'
          ? (() => {
              // defaultTierId is only needed when rendering the depth selector.
              const defaultTierId =
                searchTiers.find((t) => t.id === 'neural')?.id ?? searchTiers[0]?.id ?? '';
              return (
                <div className="web-field">
                  <label htmlFor="web-depth">Search depth</label>
                  <div className="web-select-wrap">
                    <select
                      id="web-depth"
                      className="web-select"
                      disabled={searchTiers.length === 0}
                      value={draft.searchTierId ?? defaultTierId}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, searchTierId: e.target.value || null }))
                      }
                    >
                      {searchTiers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })()
          : null}
        <BackendField
          id="web-fetch-backend"
          label="Fetch backend"
          kind="fetch"
          options={options}
          setting={draft.fetch}
          onChange={(fetch) => setDraft((d) => ({ ...d, fetch }))}
        />
      </div>
    </PickerOverlay>
  );
}
