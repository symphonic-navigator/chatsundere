// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentBlock, MessageRow, PersonaRow, PillRow } from '../../boot/client-data-db.js';
import { useSaveCodeBlockArtefact, useSaveMessageArtefact } from '../../data/artefacts.js';
import { renameAttachment, useMessageAttachments } from '../../data/attachments.js';
import { QK } from '../../data/queryKeys.js';
import { codeSnippetTitle, messageSnippetTitle } from '../../lib/artefact-titles.js';
import { groupAdjacent } from '../../lib/content-blocks.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import { transformTealStream } from '../../lib/teal/teal-streaming.js';
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';
import { toastStore } from '../../state/toast.store.js';
import { Lightbox } from '../lightbox/Lightbox.js';
import { attachmentToViewable } from '../lightbox/viewable-item.js';
import { AttachmentStrip } from './AttachmentStrip.js';
import { MessageControls } from './MessageControls.js';
import { Pill } from './Pill.js';
import { ReasoningPill } from './ReasoningPill.js';
import { MarkdownContent } from './markdown/MarkdownContent.js';
import { ArtefactSaveContext } from './markdown/artefact-save-context.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MessageBlockProps {
  message: MessageRow;
  pills: Map<string, PillRow>;
  persona: PersonaRow | null;
  /** Active mindspace for this chat — propagated to ReasoningPill so its
   *  open-body can pick up the resolved accent in future iterations. */
  mindspace: ResolvedMindspace;
  displayName: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onCopy: () => void;
  onBookmark: () => void;
  onRegenerate?: () => void;
  /** Fork the chat at this message. */
  onBranch?: () => void;
  /** Disable branching (stream live for this chat). */
  branchDisabled?: boolean;
  /** True while this message is the active streaming draft. Marks the last
   *  reasoning group as live, and switches text rendering from Markdown to
   *  per-chunk fade-in spans (each arriving token mounts a fresh span and
   *  fades in). On finalisation the draft flips false and the same text
   *  re-renders once through MarkdownContent. */
  isStreamingDraft?: boolean;
  /** True when the cockpit is pinned. While pinned and the prompt input holds
   *  focus, the first click on a message only sheds that focus (back to
   *  reading mode) instead of also activating the message — the user must
   *  click again to expand it. Keeps control in the user's hands rather than
   *  snatching focus and selection away in a single gesture. */
  isPinned?: boolean;
}

/** Renders a single chat message row with optional expanded controls. */
export function MessageBlock(p: MessageBlockProps): JSX.Element {
  const isUser = p.message.role === 'user';
  const roleClass = isUser ? 'from-user' : 'from-persona';

  // ---- Save-as-artefact mutations (called unconditionally — Rules of Hooks) ----
  const saveMessage = useSaveMessageArtefact(p.message.chatId);
  const saveCode = useSaveCodeBlockArtefact(p.message.chatId);

  // ---- Sent attachments (user messages only) ----
  const qc = useQueryClient();
  const { data: attachments = [] } = useMessageAttachments(isUser ? p.message.id : '');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Build object URLs for image blobs; revoke on change to prevent memory leaks.
  const objectUrls = useMemo(
    () =>
      new Map(
        attachments
          .filter((a) => a.kind === 'image' && a.blob && a.state === 'active')
          .map((a) => [a.id, URL.createObjectURL(a.blob as Blob)]),
      ),
    [attachments],
  );
  useEffect(
    () => () => {
      for (const u of objectUrls.values()) URL.revokeObjectURL(u);
    },
    [objectUrls],
  );

  const activeAttachments = attachments.filter((a) => a.state === 'active');
  const lightboxItems = activeAttachments.map((row) =>
    attachmentToViewable(row, { pending: false, objectUrl: objectUrls.get(row.id) }),
  );

  // Rename on a sent attachment: use low-level op + manual invalidation so the strip refreshes.
  // (useRenameAttachment only invalidates the pending key, not the message key.)
  // Attachments have no title, so patch.title never arrives here — only patch.fileName is used.
  const handleRename = (id: string, patch: { title?: string; fileName?: string }): void => {
    if (!patch.fileName) return;
    void renameAttachment(id, patch.fileName).then(() =>
      qc.invalidateQueries({ queryKey: QK.attachmentsForMessage(p.message.id) }),
    );
  };
  const namePrefix = isUser ? '🪶' : '✨';
  const nameText = isUser ? p.displayName : (p.persona?.name ?? '');
  // Persona keeps its accent colour at full strength; the user's name is the
  // same accent but mixed further toward the muted paper tone — quieter than
  // the persona name, but still recognisably "this persona's chat". Both
  // names use the persona's font so the whole chat surface speaks in one
  // typographic voice (continuation of the iter-2 .msg-text decision).
  const personaColour = p.persona?.colour;
  const personaFont = p.persona ? FONT_VAR[p.persona.font] : undefined;
  const nameStyle: React.CSSProperties = isUser
    ? {
        fontFamily: personaFont,
        ...(personaColour
          ? { color: `color-mix(in srgb, ${personaColour} 38%, var(--color-paper-soft) 62%)` }
          : {}),
      }
    : { color: personaColour, fontFamily: personaFont };

  // When this message is freshly expanded, scroll its controls (rendered at
  // the bottom) into view. Without this, expanding a message near the
  // viewport edge leaves the new controls hidden behind the cockpit or
  // chat-stream boundary.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.expanded) return;
    // scrollIntoView is unimplemented in jsdom — guard so unit tests don't
    // explode. The real browser always has it.
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [p.expanded]);

  // "Shed focus first, activate second" while the cockpit is pinned. Focus
  // leaves the input on pointerdown (before the click fires), so we detect the
  // composing state here — while the cockpit input is still the active element
  // — and consume the resulting click in handleClick below.
  const swallowActivationRef = useRef(false);
  const onPointerDownCapture = (): void => {
    const active = document.activeElement;
    if (
      p.isPinned === true &&
      active instanceof HTMLElement &&
      active.classList.contains('cockpit-input')
    ) {
      active.blur();
      swallowActivationRef.current = true;
    } else {
      swallowActivationRef.current = false;
    }
  };
  const handleClick = (): void => {
    if (swallowActivationRef.current) {
      swallowActivationRef.current = false;
      return;
    }
    p.onToggleExpand();
  };

  const personaId = p.persona?.id ?? null;

  const textContent = p.message.contentBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const canSaveMessage = personaId !== null && textContent.trim().length > 0;

  const confirmSaved = (title: string): void => {
    toastStore.show({ message: `Saved «${title}»`, tone: 'success', durationMs: 2500 });
  };
  const warnFailed = (): void => {
    toastStore.show({ message: 'Could not save artefact', tone: 'warn', durationMs: 2500 });
  };

  const handleSaveMessage = (): void => {
    if (personaId === null || !canSaveMessage) return;
    const title = messageSnippetTitle(textContent);
    saveMessage.mutate(
      { personaId, title, content: textContent },
      { onSuccess: () => confirmSaved(title), onError: warnFailed },
    );
  };

  const saveCtx =
    personaId === null
      ? null
      : {
          chatId: p.message.chatId,
          personaId,
          saveCodeBlock: ({ content, lang }: { content: string; lang: string }) => {
            const title = codeSnippetTitle(content, lang);
            saveCode.mutate(
              { personaId, title, content, lang },
              { onSuccess: () => confirmSaved(title), onError: warnFailed },
            );
          },
        };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: message block is a touch-first tap target — keyboard nav handled at chat-list level
    <div
      ref={ref}
      className={`msg ${roleClass}${p.expanded ? ' expanded' : ''}`}
      data-msg-id={p.message.id}
      data-bookmarked={p.message.bookmarked || undefined}
      onPointerDownCapture={onPointerDownCapture}
      onClick={handleClick}
    >
      <div className="msg-name" style={nameStyle}>
        <span className="msg-name-prefix" aria-hidden="true">
          {namePrefix}
        </span>
        <span className="msg-name-text">{nameText}</span>
      </div>
      {p.expanded ? (
        <div className="msg-timestamp">{formatTimestamp(p.message.createdAt)}</div>
      ) : null}
      <div
        className="msg-text"
        style={p.persona ? { fontFamily: FONT_VAR[p.persona.font] } : undefined}
      >
        <ArtefactSaveContext.Provider value={saveCtx}>
          {renderBlocks(
            p.message.contentBlocks,
            p.pills,
            p.isStreamingDraft === true,
            p.persona,
            p.mindspace,
          )}
        </ArtefactSaveContext.Provider>
      </div>
      {isUser && activeAttachments.length > 0 && (
        <AttachmentStrip attachments={activeAttachments} onOpen={(i) => setLightboxIndex(i)} />
      )}
      {isUser && attachments.some((a) => a.state === 'deleted') && (
        <div className="msg-attach-deleted">image deleted</div>
      )}
      {isUser && lightboxIndex !== null && (
        <Lightbox
          items={lightboxItems}
          index={lightboxIndex}
          getOriginRect={(id) =>
            document
              .querySelector<HTMLElement>(`[data-attachment-thumb="${CSS.escape(id)}"]`)
              ?.getBoundingClientRect() ?? null
          }
          onRename={handleRename}
          onRemove={() => {}}
          onEditText={() => {}}
          onClose={() => setLightboxIndex(null)}
        />
      )}
      {p.expanded ? (
        <MessageControls
          message={p.message}
          onCopy={p.onCopy}
          onBookmark={p.onBookmark}
          onRegenerate={p.onRegenerate}
          onBranch={p.onBranch}
          branchDisabled={p.branchDisabled}
          onSave={handleSaveMessage}
          canSave={canSaveMessage}
        />
      ) : null}
    </div>
  );
}

function renderBlocks(
  blocks: ContentBlock[],
  pills: Map<string, PillRow>,
  isStreamingDraft: boolean,
  persona: PersonaRow | null,
  mindspace: ResolvedMindspace,
): (JSX.Element | null)[] {
  // Partition into ordered runs of same-type blocks — one component per run.
  // Pills never coalesce (their `pillId` identity is load-bearing); text and
  // reasoning runs merge into a single span / pill respectively.
  const groups = groupAdjacent(blocks);

  // Only the LAST reasoning group of a streaming-draft message wears the
  // live indicator. Finalised messages (and all earlier groups within a
  // live draft) animate-out.
  const lastReasoningIdx = isStreamingDraft
    ? groups.map((g) => g.type).lastIndexOf('reasoning')
    : -1;

  // Reasoning needs a font; the prop type allows persona=null (greeting /
  // empty chat surface), so fall back to 'serif' — the default user font.
  const reasoningFont: PersonaRow['font'] = persona?.font ?? 'serif';

  return groups.map((group, idx) => {
    if (group.type === 'text') {
      // While streaming, each upstream chunk is its own (un-coalesced) text
      // block — see stream-manager.appendStreamChunk. Chunks pass through
      // transformTealStream so TEAL inline tags become emoji/text and wrapping
      // tags carry CSS classes; per-chunk spans may split further where styling
      // changes. Raw text only (no Markdown re-parse per token); once the draft
      // finalises the blocks coalesce and re-render as Markdown.
      if (isStreamingDraft) {
        const chunkSpans = transformTealStream(
          group.blocks.map((b) => (b as { type: 'text'; text: string }).text),
        );
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across token appends (append-only)
          <span className="msg-stream-text" key={`g-${idx}`}>
            {chunkSpans.map((spans, i) =>
              spans.map((s, j) => (
                <span
                  className={
                    s.classNames.length > 0 ? `stream-tok ${s.classNames.join(' ')}` : 'stream-tok'
                  }
                  // biome-ignore lint/suspicious/noArrayIndexKey: transform output is append-stable (earlier chunks render identically), so existing spans keep their key and only fresh ones animate
                  key={`${i}-${j}`}
                >
                  {s.text}
                </span>
              )),
            )}
          </span>
        );
      }
      const text = group.blocks.map((b) => (b as { type: 'text'; text: string }).text).join('');
      // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across token appends (append-only)
      return <MarkdownContent key={`g-${idx}`} text={text} />;
    }
    if (group.type === 'reasoning') {
      const trace = group.blocks
        .map((b) => (b as { type: 'reasoning'; text: string }).text)
        .join('');
      return (
        <ReasoningPill
          // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across appends
          key={`g-${idx}`}
          text={trace}
          isLive={idx === lastReasoningIdx}
          isStreamingDraft={isStreamingDraft}
          mindspace={mindspace}
          font={reasoningFont}
        />
      );
    }
    // 'pill' — single-block group (pills never coalesce; one PillRow per group).
    const pillBlock = group.blocks[0] as { type: 'pill'; pillId: string };
    const pill = pills.get(pillBlock.pillId);
    return pill ? <Pill key={`p-${pillBlock.pillId}`} row={pill} /> : null;
  });
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} · ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
