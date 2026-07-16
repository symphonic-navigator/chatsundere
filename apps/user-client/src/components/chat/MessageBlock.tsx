// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ContentBlock, MessageRow, PersonaRow, PillRow } from '../../boot/client-data-db.js';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { useSaveCodeBlockArtefact, useSaveMessageArtefact } from '../../data/artefacts.js';
import { renameAttachment, useMessageAttachments } from '../../data/attachments.js';
import { QK } from '../../data/queryKeys.js';
import { useCreateSeedTemplate } from '../../data/seed-templates.js';
import { useAdultMode, useSettings } from '../../data/settings.js';
import { codeSnippetTitle, messageSnippetTitle } from '../../lib/artefact-titles.js';
import { groupAdjacent } from '../../lib/content-blocks.js';
import { useLiveEffectSource } from '../../lib/integrations/use-live-effect-source.js';
import { useReadAloudEffectSource } from '../../lib/integrations/use-readaloud-effect-source.js';
import { useHighlighter } from '../../lib/markdown/highlighter.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import { captureTemplate } from '../../lib/seed-template.js';
import { transformTealStream } from '../../lib/teal/teal-streaming.js';
import { splitStreamingContent } from '../../lib/voice/committed-prefix.js';
import {
  type SegmentationOpts,
  type SpeechSegment,
  segmentBlock,
} from '../../lib/voice/segmentation.js';
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';
import { toastStore } from '../../state/toast.store.js';
import { Lightbox } from '../lightbox/Lightbox.js';
import { attachmentToViewable } from '../lightbox/viewable-item.js';
import { AttachmentStrip } from './AttachmentStrip.js';
import { MessageControls } from './MessageControls.js';
import { Pill } from './Pill.js';
import { HiddenReasoningMarker, type MonologueController, ReasoningPill } from './ReasoningPill.js';
import { MarkdownContent, type VoiceGlow } from './markdown/MarkdownContent.js';
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
  /** Start reading this message aloud (persona messages only). */
  onReadAloud?: () => void;
  /** Why the Read control is disabled, or null when actionable. */
  readDisabledReason?: 'no-provider' | 'no-voice' | 'nothing' | null;
  /** The segment currently spoken aloud, or null. Drives the voice glow:
   *  the matching `[data-voice-seg]` (or, on count-mismatch, the segment's
   *  `[data-voice-para]`) element wears `voice-glow-active`. */
  currentSegmentId?: string | null;
  /** Voice segmentation mode for the glow anchoring (paragraph | sentence). */
  voiceMode?: 'paragraph' | 'sentence';
  /** The message currently driven by the voice machine, or null. When this
   *  equals a streaming draft's id, that draft renders progressively (committed
   *  prefix as markdown, open tail raw). */
  currentMessageId?: string | null;
  /** Inner-monologue read controller, or null when unavailable. */
  monologue?: MonologueController | null;
}

/** Renders a single chat message row with optional expanded controls. */
export function MessageBlock(p: MessageBlockProps): JSX.Element {
  const isUser = p.message.role === 'user';
  const roleClass = isUser ? 'from-user' : 'from-persona';

  // ---- Save-as-artefact mutations (called unconditionally — Rules of Hooks) ----
  const saveMessage = useSaveMessageArtefact(p.message.chatId);
  const saveCode = useSaveCodeBlockArtefact(p.message.chatId);
  const createSeedTemplate = useCreateSeedTemplate();
  const { mode: adultMode } = useAdultMode();

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

  // ---- Voice glow: per-block segments + active-state toggling ----
  // Persona messages only; user messages never speak. Memoised on the exact
  // segmentation inputs so a segment ADVANCE (currentSegmentId change) never
  // re-runs segmentation or re-parses the markdown — only the effect below
  // toggles a class. `segmentBlock` here is the SAME pure call the playback
  // hook fed to the machine, so the ids it produces match `currentSegmentId`.
  const isPersona = p.message.role === 'persona';
  const segOpts = useMemo<SegmentationOpts>(
    () => ({ mode: p.voiceMode ?? 'paragraph', roleplay: p.persona?.roleplay ?? false }),
    [p.voiceMode, p.persona?.roleplay],
  );

  // Progressive commit: when the voice machine is auto-reading THIS streaming
  // draft, split the buffer into its committed prefix (render as final markdown
  // with glow anchors) and the open tail (render raw). When not progressive,
  // fall back to the normal behaviour for both streaming and finalised messages.
  const progressive = p.isStreamingDraft === true && p.currentMessageId === p.message.id;
  const split = useMemo(
    () => (progressive ? splitStreamingContent(p.message.contentBlocks, false) : null),
    [progressive, p.message.contentBlocks],
  );
  // The glow memos must derive from the same committed view the machine uses,
  // so their block indices align with the segment ids the machine produces.
  const renderSourceBlocks = split ? split.committedBlocks : p.message.contentBlocks;

  const blockSegments = useMemo<Map<number, SpeechSegment[]>>(() => {
    const map = new Map<number, SpeechSegment[]>();
    if (!isPersona) return map;
    renderSourceBlocks.forEach((block, index) => {
      if (block.type !== 'text') return;
      const segs = segmentBlock(block.text, index, segOpts);
      if (segs.length > 0) map.set(index, segs);
    });
    return map;
  }, [isPersona, renderSourceBlocks, segOpts]);
  // Index `currentSegmentId` → its block- and paragraph-index, so the
  // paragraph-level fallback can find the right `[data-voice-para]` when no
  // span matches. The value is the block-qualified attribute string written by
  // `rehypeVoiceAnchor` — `"<blockIndex>:<paragraphIndex>"`.
  const segParaById = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const segs of blockSegments.values()) {
      for (const s of segs) map.set(s.segmentId, `${s.blockIndex}:${s.paragraphIndex}`);
    }
    return map;
  }, [blockSegments]);
  // Per content-block-index glow props, memoised so their references stay
  // STABLE across a segment-advance render (which changes only
  // `currentSegmentId`). A new reference here would defeat MarkdownContent's
  // memo and re-parse the markdown on every segment step — the one thing the
  // glow must not do. The active segment is intentionally not a dependency.
  const glowByBlockIndex = useMemo<Map<number, VoiceGlow>>(() => {
    const map = new Map<number, VoiceGlow>();
    for (const [blockIndex, segments] of blockSegments) {
      const block = renderSourceBlocks[blockIndex];
      const rawSource = block?.type === 'text' ? block.text : '';
      map.set(blockIndex, { segments, blockIndex, opts: segOpts, rawSource });
    }
    return map;
  }, [blockSegments, segOpts, renderSourceBlocks]);

  const textRef = useRef<HTMLDivElement>(null);
  const activeId = p.currentSegmentId ?? null;
  // The glow class lives OUTSIDE React's vdom — it is toggled imperatively on
  // DOM that ReactMarkdown owns. Any re-parse of the markdown subtree therefore
  // silently drops it. The one re-parse that does NOT also change `activeId` or
  // `segParaById` is the async shiki load: `MarkdownContent` re-renders on its
  // own `useHighlighter` resolving, rebuilding the DOM with the glow gone, while
  // this parent would otherwise not re-run. Subscribing to the same highlighter
  // here makes that resolution a dependency, so the glow is re-applied on the
  // freshly-built nodes. `useLayoutEffect` re-applies before paint — no blank
  // frame between the rebuild and the restored highlight.
  const highlighter = useHighlighter();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `highlighter` is a deliberate re-run trigger, not read in the body — its null→instance transition rebuilds the markdown DOM, and re-running here re-applies the dropped glow class
  useLayoutEffect(() => {
    const container = textRef.current;
    if (!container) return;
    // Clear any prior highlight before applying the new one.
    for (const el of container.querySelectorAll('.voice-glow-active')) {
      el.classList.remove('voice-glow-active');
    }
    if (activeId === null) return;
    const escaped = CSS.escape(activeId);
    // ALL elements carrying the id, not just the first: one spoken segment can
    // render as several sibling top-level elements when an intro/heading line is
    // glued to a list with no blank line between them. `paragraphRanges` (blank-
    // line splitting) treats that as ONE paragraph → ONE segment → ONE audio,
    // but ReactMarkdown emits <p> + <ul>, both tagged with the same seg id. The
    // glow must cover the whole segment, or it sticks on the first element while
    // the audio reads on through the rest (device finding 2026-06-13).
    const segs = container.querySelectorAll(`[data-voice-seg="${escaped}"]`);
    if (segs.length > 0) {
      for (const el of segs) el.classList.add('voice-glow-active');
      return;
    }
    // No span matched → paragraph-level fallback (count-mismatch degrade, or
    // paragraph-mode where the id sits on the <p> via data-voice-seg already).
    // `paraKey` is the block-qualified attribute value written by the plugin:
    // "<blockIndex>:<paragraphIndex>". Using a bare paragraph index would
    // mis-highlight the wrong block when multiple text blocks share the same
    // local paragraph-0 (the never-mis-highlight contract). querySelectorAll for
    // the same multi-sibling reason as above.
    const paraKey = segParaById.get(activeId);
    if (paraKey === undefined) return;
    for (const el of container.querySelectorAll(`[data-voice-para="${CSS.escape(paraKey)}"]`)) {
      el.classList.add('voice-glow-active');
    }
  }, [activeId, segParaById, highlighter]);

  const textContent = p.message.contentBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const canSaveMessage = personaId !== null && textContent.trim().length > 0;

  // ---- Screen effects (screen-effects spec 2026-06-29 §4.4) ----
  // Two trigger sources, never both for the same moment: the live stream fires
  // as the draft grows; read-aloud replays on a finalised message. A bare
  // re-render of a persisted message plays nothing.
  const screenEffectsEnabled = useSettings().data?.screenEffectsEnabled ?? true;
  useLiveEffectSource(p.isStreamingDraft === true ? textContent : null, screenEffectsEnabled);
  // Segment char-ranges from segmentBlock are block-local; globalise them into
  // textContent's coordinate space so a tag's index lines up with the spoken
  // segment that contains it.
  const effectSegments = useMemo(() => {
    const out: { segmentId: string; charRange: readonly [number, number] }[] = [];
    // The read-aloud source is disabled while streaming, so skip the offset work
    // on the per-chunk hot path — it is only consumed once the draft finalises.
    if (p.isStreamingDraft === true) return out;
    let offset = 0;
    renderSourceBlocks.forEach((block, index) => {
      if (block.type !== 'text') return;
      for (const s of blockSegments.get(index) ?? []) {
        out.push({
          segmentId: s.segmentId,
          charRange: [offset + s.charRange[0], offset + s.charRange[1]],
        });
      }
      offset += block.text.length;
    });
    return out;
  }, [renderSourceBlocks, blockSegments, p.isStreamingDraft]);
  useReadAloudEffectSource({
    messageId: p.message.id,
    rawText: textContent,
    segments: effectSegments,
    currentSegmentId: p.currentSegmentId ?? null,
    currentMessageId: p.currentMessageId ?? null,
    // The live source owns the streaming draft; read-aloud only replays finals.
    enabled: screenEffectsEnabled && p.isStreamingDraft !== true,
  });

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

  // Capture the conversation up to this persona message as a seed template.
  const handleSaveAsTemplate = async (): Promise<void> => {
    if (!p.persona) return;
    try {
      const all = await getClientDataDb()
        .messages.where('chatId')
        .equals(p.message.chatId)
        .sortBy('createdAt');
      const captured = captureTemplate({
        messages: all,
        uptoMessageId: p.message.id,
        sourceNsfw: p.persona.adultPersona,
      });
      const date = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date());
      await createSeedTemplate.mutateAsync({
        name: `${p.persona.name} — ${date}`,
        description: '',
        nsfw: captured.nsfw,
        greeting: captured.greeting,
        body: captured.body,
      });
      // If the new template would be hidden by the current filter, say so rather
      // than letting it seem to vanish (mirrors the §6 vanish-guard).
      if (captured.nsfw && adultMode === 'sfw') {
        toastStore.show({
          message: 'Saved to Treasury → Templates. It is hidden while adult mode is off.',
          tone: 'info',
          durationMs: 5000,
        });
      } else {
        toastStore.show({
          message: 'Saved to Treasury → Templates.',
          tone: 'success',
          durationMs: 3000,
        });
      }
    } catch {
      toastStore.show({ message: 'Could not save template', tone: 'warn', durationMs: 2500 });
    }
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
        {p.message.kind === 'seed' ? (
          // Positive primer marker (inline-marker aesthetic) — reads as an
          // intentional primer, not a failed turn.
          <span className="msg-primer-pill" title="From a seed template">
            Primer
          </span>
        ) : null}
      </div>
      {p.expanded ? (
        <div className="msg-timestamp">{formatTimestamp(p.message.createdAt)}</div>
      ) : null}
      <div
        ref={textRef}
        className="msg-text"
        style={p.persona ? { fontFamily: FONT_VAR[p.persona.font] } : undefined}
      >
        <ArtefactSaveContext.Provider value={saveCtx}>
          {renderBlocks(
            split ? split.committedBlocks : p.message.contentBlocks,
            p.pills,
            split ? false : p.isStreamingDraft === true,
            p.persona,
            p.mindspace,
            glowByBlockIndex,
            p.message.id,
            p.monologue ?? null,
          )}
          {split && split.tailText.length > 0 ? (
            <span className="msg-stream-text">
              {transformTealStream([split.tailText]).map((spans, i) =>
                spans.map((s, j) => (
                  <span
                    className={
                      s.classNames.length > 0
                        ? `stream-tok ${s.classNames.join(' ')}`
                        : 'stream-tok'
                    }
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-stable streaming tail
                    key={`tail-${i}-${j}`}
                  >
                    {s.text}
                  </span>
                )),
              )}
            </span>
          ) : null}
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
          onSaveAsTemplate={
            isPersona && canSaveMessage ? () => void handleSaveAsTemplate() : undefined
          }
          onReadAloud={p.onReadAloud}
          readDisabledReason={p.readDisabledReason}
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
  // Per content-block-index glow props (empty/absent for user messages,
  // non-text blocks, or blocks with nothing to say). References are stable
  // across segment-advance renders so MarkdownContent never re-parses.
  glowByBlockIndex: Map<number, VoiceGlow>,
  messageId: string,
  monologue: MonologueController | null,
): (JSX.Element | null)[] {
  // Partition into ordered runs of same-type blocks — one component per run.
  // Pills never coalesce (their `pillId` identity is load-bearing); text and
  // reasoning runs merge into a single span / pill respectively.
  const groups = groupAdjacent(blocks);

  // Map each group back to the content-block index of its FIRST block, so a
  // text group can look up its segments. Finalised persona messages coalesce
  // adjacent text blocks engine-side (stream-engine.appendText), so a text
  // group is a single block there — the glow's per-block segment ids line up.
  const groupFirstIndex: number[] = [];
  {
    let cursor = 0;
    for (const g of groups) {
      groupFirstIndex.push(cursor);
      cursor += g.blocks.length;
    }
  }

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
      // A single-block text group (the finalised case) can glow: its segments
      // were computed under the same content-block index. Multi-block text
      // groups only occur mid-stream (no glow then) — guard on length so the
      // ids never misalign with the joined text.
      const blockIndex = groupFirstIndex[idx];
      const glow =
        group.blocks.length === 1 && blockIndex !== undefined
          ? glowByBlockIndex.get(blockIndex)
          : undefined;
      // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across token appends (append-only)
      return <MarkdownContent key={`g-${idx}`} text={text} glow={glow} />;
    }
    if (group.type === 'reasoning') {
      const reasoningBlocks = group.blocks as {
        type: 'reasoning';
        text: string;
        hiddenTokens?: number;
      }[];
      const trace = reasoningBlocks.map((b) => b.text).join('');
      // A hidden-reasoning group carries the billed token count but no trace text
      // (the provider withheld it) — render the terminal marker, not an empty pill.
      const hiddenTokens = reasoningBlocks.find((b) => b.hiddenTokens !== undefined)?.hiddenTokens;
      if (trace === '' && hiddenTokens !== undefined) {
        // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across appends
        return <HiddenReasoningMarker key={`g-${idx}`} tokens={hiddenTokens} />;
      }
      return (
        <ReasoningPill
          // biome-ignore lint/suspicious/noArrayIndexKey: group ordering is stable across appends
          key={`g-${idx}`}
          text={trace}
          isLive={idx === lastReasoningIdx}
          isStreamingDraft={isStreamingDraft}
          mindspace={mindspace}
          font={reasoningFont}
          monologueId={`${messageId}:${idx}`}
          monologue={monologue}
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
