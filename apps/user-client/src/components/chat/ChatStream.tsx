// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { MessageRow, PersonaRow, PillRow } from '../../boot/client-data-db.js';
import { listCheckpoints } from '../../compaction/repo.js';
import { useToggleBookmark } from '../../data/chats.js';
import { QK } from '../../data/queryKeys.js';
import { flattenAnswerText } from '../../lib/content-blocks.js';
import { outOfWindowCount } from '../../lib/context-window.js';
import { formatDateSepLabel } from '../../lib/date-separator-label.js';
import { estimateTokens } from '../../lib/token-estimator.js';
import { segmentMessage } from '../../lib/voice/segmentation.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';
import type { StreamHandle } from '../../state/stream-manager.store.js';
import { toastStore } from '../../state/toast.store.js';
import { CompactionMarker } from './CompactionMarker.js';
import { ContextMemoryMarker } from './ContextMemoryMarker.js';
import type { MonologueController } from './ReasoningPill.js';

/**
 * Load-bearing default — survives the brief window between component mount
 * and the global mindspace store being populated. Any consumer that reads
 * `mindspace.accent`, `mindspace.palette.text.*`, etc. before the store
 * hydrates lands on these neutral values rather than `undefined`.
 */
export const MINDSPACE_FALLBACK: ResolvedMindspace = {
  id: 'fallback',
  displayName: 'Fallback',
  palette: {
    bg: '#1a1a1a',
    surfaceBase: '#222222',
    surfaceRaised: '#2a2a2a',
    surfaceInput: '#1e1e1e',
    accent: '#888888',
    accentSubtle: 'rgba(136,136,136,0.06)',
    accentBorder: 'rgba(136,136,136,0.3)',
    accentBorderActive: 'rgba(136,136,136,0.6)',
    accentGlow: 'rgba(136,136,136,0.5)',
    text: {
      primary: '#e6e6e6',
      secondary: '#bdbdbd',
      muted: '#8a8a8a',
      ghost: '#5a5a5a',
    },
  },
  texture: 'grain',
  builtIn: true,
  createdAt: 0,
};
import { DateSeparator } from './DateSeparator.js';
import { MessageBlock } from './MessageBlock.js';
import { ScrollToEnd } from './ScrollToEnd.js';
import { StreamingCursor } from './StreamingCursor.js';

const FOLLOW_THRESHOLD_PX = 30;

export interface ChatStreamProps {
  chatId: string;
  messages: MessageRow[];
  pills: PillRow[];
  persona: PersonaRow | null;
  displayName: string;
  streamHandle: StreamHandle | null;
  /** Re-roll the last persona answer. Wired only to the last persona message. */
  onRegenerate?: () => void;
  /** Fork the chat at a given message. Wired to every message. */
  onBranch?: (messageId: string) => void;
  /** Disable branching across all messages (stream live for this chat). */
  branchDisabled?: boolean;
  /** Resolved context window (tokens) for the marker. Undefined = no marker. */
  contextBudget?: number;
  /** Estimated system-prompt tokens, reserved before fitting history. */
  systemTokens?: number;
  /** Start reading a persona message aloud. */
  onReadAloud?: (message: MessageRow) => void;
  /** Provider/voice-level disable reason (null when TTS is actionable). The
   *  per-message 'nothing' tone is derived here from segmentation. */
  voiceDisabledReason?: 'no-provider' | 'no-voice' | null;
  /** Active segmentation mode (read at play time; here only for the
   *  speakability probe that drives the per-message 'nothing' tooltip). */
  voiceMode?: 'paragraph' | 'sentence';
  /** The segment currently spoken aloud; threaded to MessageBlock for the
   *  voice glow. */
  currentSegmentId?: string | null;
  /** The id of the message being read. Segment ids repeat across messages
   *  (`<blockIndex>:<ordinal>` only), so the glow is routed to this message
   *  alone — every other message receives a null id and cannot light up. */
  currentMessageId?: string | null;
  /** Inner-monologue read controller, or null when unavailable. */
  monologue?: MonologueController | null;
}

/** Scroll container that sorts messages chronologically, inserts DateSeparators
 *  at day-boundaries, delegates rendering to MessageBlock, and attaches a
 *  StreamingCursor to the active draft. Tracks auto-follow via scroll position. */
export function ChatStream(p: ChatStreamProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const setAutoFollow = useCurrentChatStore((s) => s.setAutoFollow);
  const autoFollow = useCurrentChatStore((s) => s.autoFollowEnabled);
  const expandedId = useCurrentChatStore((s) => s.expandedMessageId);
  const toggleExpanded = useCurrentChatStore((s) => s.toggleExpanded);
  const isPinned = useCurrentChatStore((s) => s.isPinned);
  // The resolved mindspace lives in a global store that ChatPage binds for
  // the active chat's persona. We forward it to MessageBlock so reasoning
  // pills can pick up the persona-accented palette (today via CSS var,
  // tomorrow potentially via direct prop reads). Falls back to an empty
  // stub before resolution lands — in practice ChatPage's effect populates
  // it on first render after mindspaces load.
  const resolvedMindspace = useMindspaceStore((s) => s.resolved);
  const toggleBookmark = useToggleBookmark();

  // Load checkpoints so we can render a CompactionMarker before each boundary message.
  const checkpointsQuery = useQuery({
    queryKey: QK.compaction(p.chatId),
    queryFn: () => listCheckpoints(p.chatId),
  });
  // Index by tailStartMessageId for O(1) lookup in the render loop.
  const checkpointByTail = useMemo(() => {
    const map = new Map((checkpointsQuery.data ?? []).map((cp) => [cp.tailStartMessageId, cp]));
    return map;
  }, [checkpointsQuery.data]);

  const sorted = [...p.messages].sort((a, b) => a.createdAt - b.createdAt);
  const pillMap = new Map(p.pills.map((x) => [x.id, x]));
  if (p.streamHandle) {
    for (const pill of p.streamHandle.pillBuffer) pillMap.set(pill.id, pill);
  }

  const outCount =
    p.contextBudget != null
      ? outOfWindowCount(
          sorted.map((m) => estimateTokens(flattenAnswerText(m.contentBlocks))),
          p.systemTokens ?? 0,
          p.contextBudget,
        )
      : 0;

  // Scroll to bottom when new content arrives and auto-follow is active.
  // streamHandle ref changes on every token (the stream-manager replaces the
  // handle object per chunk for reactivity), so this effect re-runs on every
  // token append even though it only reads el.scrollHeight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: p.messages.length and p.streamHandle are intentional triggers
  useEffect(() => {
    if (!autoFollow) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [autoFollow, p.messages.length, p.streamHandle]);

  // ResizeObserver bridges layout shifts to scroll position. When the
  // cockpit opens, chat-stream's clientHeight shrinks while scrollHeight
  // stays put — without intervention the user drifts visually upward by
  // the cockpit's height. The useEffect above doesn't catch this because
  // none of its dependencies change on resize. The ref-mirror of
  // autoFollow keeps the callback free of stale closures across renders.
  const autoFollowRef = useRef(autoFollow);
  useEffect(() => {
    autoFollowRef.current = autoFollow;
  }, [autoFollow]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!autoFollowRef.current) return;
      // Wait one frame so the post-resize layout has settled before we
      // measure scrollHeight — otherwise we'd race against the browser
      // and land on a stale max.
      requestAnimationFrame(() => {
        const live = ref.current;
        if (live && autoFollowRef.current) live.scrollTop = live.scrollHeight;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    const nearBottom = distanceFromBottom <= FOLLOW_THRESHOLD_PX;
    if (nearBottom !== autoFollow) setAutoFollow(nearBottom);
  };

  // Per-message speakability for the Read control's 'nothing' tone. A persona
  // message with zero speakable segments is disabled with the calm fact tooltip
  // even when a provider + voice exist. Memoised so segmentation runs only when
  // the message set or the mode changes.
  const roleplay = p.persona?.roleplay ?? false;
  const speakable = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const m of p.messages) {
      if (m.role !== 'persona') continue;
      const segs = segmentMessage(m.contentBlocks, {
        mode: p.voiceMode ?? 'paragraph',
        roleplay,
      });
      map.set(m.id, segs.length > 0);
    }
    return map;
  }, [p.messages, p.voiceMode, roleplay]);

  const readReasonFor = (m: MessageRow): 'no-provider' | 'no-voice' | 'nothing' | null => {
    if (p.voiceDisabledReason) return p.voiceDisabledReason;
    return speakable.get(m.id) ? null : 'nothing';
  };

  // Index of the last persona message — the only one that gets an onRegenerate handler.
  const lastPersonaIdx = (() => {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i]?.role === 'persona') return i;
    }
    return -1;
  })();

  return (
    <div className="chat-stream" ref={ref} onScroll={onScroll}>
      {sorted.map((m, i) => {
        const prev = i > 0 ? sorted[i - 1] : null;
        const needSep = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
        const sep = needSep ? (
          <DateSeparator
            key={`sep-${m.id}`}
            label={formatDateSepLabel(new Date(m.createdAt), new Date())}
          />
        ) : null;

        const isDraft = p.streamHandle?.draftMessageId === m.id;
        const isLastPersona = i === lastPersonaIdx && m.role === 'persona';

        // While this message is the active draft, mirror the live token
        // buffer in place of the (still-empty) DB contentBlocks — that's
        // how the user actually sees streaming as it happens. Once the
        // stream completes the DB row is updated and TanStack-Query
        // invalidation pushes the final content back into `m`.
        const renderMessage: MessageRow =
          isDraft && p.streamHandle ? { ...m, contentBlocks: p.streamHandle.contentBuffer } : m;

        const boundaryCheckpoint = checkpointByTail.get(m.id);

        return (
          <div key={m.id}>
            {boundaryCheckpoint !== undefined ? (
              <CompactionMarker
                key={`cp-${boundaryCheckpoint.id}`}
                checkpoint={boundaryCheckpoint}
              />
            ) : null}
            {i === outCount && outCount > 0 ? <ContextMemoryMarker /> : null}
            {sep}
            <div data-msg-id={m.id}>
              <MessageBlock
                message={renderMessage}
                pills={pillMap}
                persona={p.persona}
                mindspace={resolvedMindspace ?? MINDSPACE_FALLBACK}
                displayName={p.displayName}
                expanded={expandedId === m.id}
                onToggleExpand={() => toggleExpanded(m.id)}
                onCopy={() => copyMessageText(m)}
                onBookmark={() => void toggleBookmark.mutateAsync(m.id)}
                onRegenerate={isLastPersona ? p.onRegenerate : undefined}
                onBranch={p.onBranch ? () => p.onBranch?.(m.id) : undefined}
                branchDisabled={p.branchDisabled}
                isStreamingDraft={isDraft}
                isPinned={isPinned}
                onReadAloud={
                  m.role === 'persona' && p.onReadAloud ? () => p.onReadAloud?.(m) : undefined
                }
                readDisabledReason={m.role === 'persona' ? readReasonFor(m) : undefined}
                // Route the glow id to the playing message ONLY — segment ids
                // are not unique across messages, so an ungated pass would light
                // up every message owning the same `<block>:<ordinal>` id.
                currentSegmentId={m.id === p.currentMessageId ? p.currentSegmentId : null}
                currentMessageId={p.currentMessageId}
                voiceMode={p.voiceMode}
                monologue={p.monologue ?? null}
              />
              {isDraft ? <StreamingCursor /> : null}
            </div>
          </div>
        );
      })}
      <ScrollToEnd visible={!autoFollow && sorted.length > 0} onTap={() => setAutoFollow(true)} />
    </div>
  );
}

/** Returns a string key that is identical for timestamps on the same calendar day. */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function copyMessageText(m: MessageRow): void {
  const text = flattenAnswerText(m.contentBlocks);
  navigator.clipboard.writeText(text).then(
    () => toastStore.show({ message: 'Copied to clipboard', tone: 'success', durationMs: 2000 }),
    () =>
      toastStore.show({
        message: 'Could not copy — your browser blocked clipboard access',
        tone: 'warn',
        durationMs: 3500,
      }),
  );
}
