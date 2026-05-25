// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import type { MessageRow, PersonaRow, PillRow } from '../../boot/client-data-db.js';
import { flattenAnswerText } from '../../lib/content-blocks.js';
import { formatDateSepLabel } from '../../lib/date-separator-label.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';
import type { StreamHandle } from '../../state/stream-manager.store.js';

// Stub used only before the mindspace store has resolved (first paint, or
// in tests that don't seed the store). ReasoningPill reads its palette via
// the CSS var written by MindspaceLayer, not via these fields directly, so
// an empty shell is a safe fallback for the prop contract.
const MINDSPACE_FALLBACK = {} as ResolvedMindspace;
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
  // The resolved mindspace lives in a global store that ChatPage binds for
  // the active chat's persona. We forward it to MessageBlock so reasoning
  // pills can pick up the persona-accented palette (today via CSS var,
  // tomorrow potentially via direct prop reads). Falls back to an empty
  // stub before resolution lands — in practice ChatPage's effect populates
  // it on first render after mindspaces load.
  const resolvedMindspace = useMindspaceStore((s) => s.resolved);

  const sorted = [...p.messages].sort((a, b) => a.createdAt - b.createdAt);
  const pillMap = new Map(p.pills.map((x) => [x.id, x]));

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

        return (
          <div key={m.id}>
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
                onBookmark={() => {
                  // Stubbed — wired to useToggleBookmark in Task 27 (ChatPage assembly).
                }}
                onRegenerate={
                  isLastPersona
                    ? () => {
                        // Stubbed — wired to useRegenerate in Task 27 (ChatPage assembly).
                      }
                    : undefined
                }
                isStreamingDraft={isDraft}
              />
              {isDraft ? <StreamingCursor /> : null}
            </div>
          </div>
        );
      })}
      {!autoFollow && sorted.length > 0 ? <ScrollToEnd onTap={() => setAutoFollow(true)} /> : null}
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
  void navigator.clipboard.writeText(text);
}
