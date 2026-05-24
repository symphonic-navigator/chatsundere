// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';
import type { MindspaceRow, MindspaceTexture } from '../boot/client-data-db.js';
import { MindspaceTexture as MindspaceTextureComponent } from './MindspaceTexture.js';

type Font = 'sans' | 'serif' | 'cursive';

interface Props {
  mindspaces: ReadonlyArray<MindspaceRow>;
  selectedMindspaceId: string | null;
  selectedTexture: MindspaceTexture;
  selectedFont: Font;
  previewName: string;
  /** When true, surfaces a "Use user default" chip that emits onMindspaceChange(null). */
  allowUserDefault?: boolean;
  onMindspaceChange: (id: string | null) => void;
  onTextureChange: (t: MindspaceTexture) => void;
  onFontChange: (f: Font) => void;
}

const TEXTURES: MindspaceTexture[] = ['cloudy', 'aurora', 'grain'];
const FONTS: Font[] = ['sans', 'serif', 'cursive'];

const FONT_CLASSES: Record<Font, string> = {
  sans: 'font-sans',
  serif: 'font-display',
  cursive: 'italic font-display',
};

/**
 * Reusable mindspace picker used in Settings (user defaults) and Persona Editor
 * (per-persona override). Shows a live preview card and three rows of choices:
 * colour swatches, texture chips, and font chips.
 */
export function MindspacePicker(props: Props): JSX.Element {
  const {
    mindspaces,
    selectedMindspaceId,
    selectedTexture,
    selectedFont,
    previewName,
    allowUserDefault = false,
    onMindspaceChange,
    onTextureChange,
    onFontChange,
  } = props;
  const selectedMs = mindspaces.find((m) => m.id === selectedMindspaceId) ?? mindspaces[0];
  const accent = selectedMs?.palette.accent;
  const surfaceRaised = selectedMs?.palette.surfaceRaised;

  return (
    <div className="rounded-lg border border-white/5 bg-black/20 p-3">
      {/* Preview card */}
      <div
        data-mindspace-preview
        className="relative mb-3 overflow-hidden rounded-md"
        style={{ background: selectedMs?.palette.bg ?? '#0a0a0a' }}
      >
        {selectedMs ? (
          <div className="pointer-events-none absolute inset-0">
            <MindspaceTextureComponent
              texture={selectedTexture}
              accent={selectedMs.palette.accent}
            />
          </div>
        ) : null}
        <div className="relative p-6 text-center" style={{ color: accent }}>
          <div className={`text-2xl ${FONT_CLASSES[selectedFont]}`} style={{ color: accent }}>
            {previewName}
          </div>
          <div className="mt-1 text-xs uppercase tracking-widest text-paper-soft">Your space</div>
        </div>
      </div>

      {/* Colour row */}
      <Row label="Color">
        {mindspaces.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-label={`Mindspace ${m.displayName}`}
            onClick={() => onMindspaceChange(m.id)}
            className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-black ${
              selectedMindspaceId === m.id ? 'ring-paper' : 'ring-transparent'
            }`}
            style={{ background: m.palette.accent }}
          />
        ))}
        {allowUserDefault ? (
          <button
            type="button"
            aria-label="Use user default"
            onClick={() => onMindspaceChange(null)}
            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${
              selectedMindspaceId === null
                ? 'border-paper text-paper'
                : 'border-paper-soft/40 text-paper-soft'
            }`}
          >
            Use user default
          </button>
        ) : null}
      </Row>

      {/* Texture row */}
      <Row label="Texture">
        {TEXTURES.map((t) => (
          <Chip
            key={t}
            active={selectedTexture === t}
            onClick={() => onTextureChange(t)}
            label={capitalise(t)}
          />
        ))}
      </Row>

      {/* Font row */}
      <Row label="Font">
        {FONTS.map((f) => (
          <Chip
            key={f}
            active={selectedFont === f}
            onClick={() => onFontChange(f)}
            label={capitalise(f)}
            className={FONT_CLASSES[f]}
          />
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-16 text-xs uppercase tracking-widest text-paper-soft">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  className = '',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${
        active ? 'border-paper text-paper' : 'border-paper-soft/40 text-paper-soft'
      } ${className}`}
    >
      {label}
    </button>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
