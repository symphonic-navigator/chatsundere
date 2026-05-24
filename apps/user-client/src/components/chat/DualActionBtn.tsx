// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  hasText: boolean;
  isStreamLive: boolean;
  personaName: string;
  onSend: () => void;
}

export function DualActionBtn(p: Props): JSX.Element {
  const disabled = !p.hasText || p.isStreamLive;
  const title = p.isStreamLive
    ? `${p.personaName} antwortet noch…`
    : p.hasText
      ? 'Send'
      : 'Voice arrives with Block 4';
  return (
    <button
      type="button"
      className="dual-action-btn"
      data-dual="action"
      disabled={disabled}
      title={title}
      aria-label={p.hasText ? 'Send' : 'Microphone (disabled)'}
      onClick={p.hasText && !p.isStreamLive ? p.onSend : undefined}
    >
      {p.hasText ? (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M5 12l14-7-5 14-2-7-7-0z" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </button>
  );
}
