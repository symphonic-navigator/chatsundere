// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Bookmark, Brain, Gem, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { classifyFile } from '../../attachments/file-classify.js';
import { normaliseImageForLlm } from '../../attachments/image-normalise.js';
import type { AttachmentRow, PersonaRow } from '../../boot/client-data-db.js';
import {
  addAttachment,
  attachmentRemovalRoute,
  usePendingAttachments,
  usePendingDocumentContents,
  useRemoveAttachment,
  useRenameAttachment,
  useUpdateAttachmentText,
} from '../../data/attachments.js';
import { useChat, useUpdateChat } from '../../data/chats.js';
import { useFilteredLibraries } from '../../data/knowledge.js';
import { useCurrentBody, useUncommittedCount } from '../../data/memory.js';
import { usePersona } from '../../data/personas.js';
import { QK } from '../../data/queryKeys.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { computeEffectiveLibraries } from '../../knowledge/effective-libraries.js';
import type { ChatFontScale } from '../../lib/chat-font-scale.js';
import { type ReasoningState, reasoningChoiceOf } from '../../lib/reasoning-resolver.js';
import { useActiveSearchTiers } from '../../lib/use-active-search-tiers.js';
import { useDismissOnOutside } from '../../lib/use-dismiss-on-outside.js';
import type { Dictation } from '../../lib/voice/dictation/use-dictation.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import {
  DESKTOP_MEDIA_QUERY,
  useEffectiveChatMode,
  useIsDesktop,
} from '../../state/effective-chat-mode.js';
import { AutoSizeTextarea } from '../AutoSizeTextarea.js';
import { Lightbox } from '../lightbox/Lightbox.js';
import { attachmentToViewable } from '../lightbox/viewable-item.js';
import { AttachmentStrip } from './AttachmentStrip.js';
import { CockpitMenu } from './CockpitMenu.js';
import { DualActionBtn } from './DualActionBtn.js';
import { EditSendButton } from './EditSendButton.js';

interface Props {
  chatId: string;
  persona: PersonaRow;
  offering: Offering;
  draftValue: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  /**
   * Non-null when this chat's composer is editing an existing message (spec
   * 2026-07-18). Required — chat-page.tsx's Task 9 orchestration always
   * supplies these six props (null/false/[] when not editing), so a future
   * caller that forgets to wire one is a compile error, not a silent no-op.
   */
  editingMessageId: string | null;
  /** Whether Replace-in-place is available (derived: the edited message is still last). */
  canReplace: boolean;
  /** The edit view of attachments (originals − staged removals + additions). */
  editAttachments: AttachmentRow[];
  onReplace: () => void;
  onBranchEdit: () => void;
  onCancelEdit: () => void;
  onStop: () => void;
  isStreamLive: boolean;
  /** Open the Treasury attach picker (omitted → (+) opens the file dialog directly). */
  onAttachFromTreasury?: () => void;
  /** Open the knowledge document picker (omitted → no "Attach from knowledge" item). */
  onAttachFromLibrary?: () => void;
  /** Dictation surface — connected in chat-page via useDictation (spec 2026-06-12 §3). */
  dictation: Dictation;
  /** Voice-mode (auto-read-aloud) on/off — global setting. */
  autoReadAloud: boolean;
  onToggleAutoRead: (next: boolean) => void;
  /** Why read-aloud is unavailable, or null when a voice is configured. */
  voiceUnavailable: 'no-provider' | 'no-voice' | null;
  /** Enter live voice mode — disabled-with-reason when no voice provider is
   *  configured. Optional so this component stays self-contained; the chat page
   *  always supplies it through InteractionMode. */
  onEnterLiveVoice?: () => void;
}

/**
 * Ingest picked/pasted/dropped files into the chat's pending attachment set:
 * images are normalised (1024 px JPEG) before storage, text files are read as
 * their UTF-8 source. Rejected files (unsupported type or oversize) are reported
 * via `onReject` and skipped; the rest still go through.
 */
async function ingestFiles(
  chatId: string,
  files: FileList | File[],
  onReject: (msg: string) => void,
): Promise<void> {
  for (const file of Array.from(files)) {
    const c = classifyFile(file);
    if (!c.ok) {
      onReject(c.reason);
      continue;
    }
    if (c.kind === 'image') {
      const norm = await normaliseImageForLlm(file);
      await addAttachment({
        chatId,
        kind: 'image',
        fileName: file.name,
        mime: 'image/jpeg',
        blob: norm.blob,
        width: norm.width,
        height: norm.height,
      });
    } else {
      const text = await file.text();
      await addAttachment({
        chatId,
        kind: 'text',
        fileName: file.name,
        mime: file.type || 'text/plain',
        text,
      });
    }
  }
}

export function Cockpit(p: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [voiceNote, setVoiceNote] = useState(false);
  const navigate = useNavigate();
  const { isPinned } = useEffectiveChatMode();
  const isDesktop = useIsDesktop();
  const togglePin = useCurrentChatStore((s) => s.togglePin);
  const setInteractionMode = useCurrentChatStore((s) => s.setInteractionMode);
  const reasoning = useCurrentChatStore((s) => s.reasoning);
  const setReasoning = useCurrentChatStore((s) => s.setReasoning);
  const searchTiers = useActiveSearchTiers();
  const searchTierId = useCurrentChatStore((s) => s.webSearchTierId);
  const setSearchTierId = useCurrentChatStore((s) => s.setWebSearchTierId);
  const askExpert = useCurrentChatStore((s) => s.askExpert);
  const setAskExpert = useCurrentChatStore((s) => s.setAskExpert);
  const artefactExpertError = useCurrentChatStore((s) => s.artefactExpertError);
  const setArtefactExpertError = useCurrentChatStore((s) => s.setArtefactExpertError);
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  // Attachments: the pending set for this chat, plus the mutation hooks the
  // lightbox drives (rename / remove / edit-text), and the local UI state for
  // the hidden picker, the reject toast, the OS drag-over flag, and the open
  // lightbox index.
  const qc = useQueryClient();
  const { data: pending = [] } = usePendingAttachments(p.chatId);
  const { editingMessageId, canReplace, editAttachments, onReplace, onBranchEdit, onCancelEdit } =
    p;
  const editing = editingMessageId !== null;
  const shownAttachments = editing ? editAttachments : pending;
  const stageRemoval = useCurrentChatStore((s) => s.stageRemoval);
  const remove = useRemoveAttachment(p.chatId);
  const rename = useRenameAttachment(p.chatId);
  const editText = useUpdateAttachmentText(p.chatId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [reject, setReject] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const ingest = async (files: FileList | File[]): Promise<void> => {
    await ingestFiles(p.chatId, files, setReject);
    await qc.invalidateQueries({ queryKey: QK.attachmentsPending(p.chatId) });
  };

  // One object URL per shown image (the same set feeding the attachment strip:
  // editAttachments while editing, pending otherwise), rebuilt whenever that set
  // changes and revoked on the next change / unmount so the browser never leaks
  // blobs. Must track shownAttachments, not pending, so the strip's index space
  // and the lightbox's index space always agree — see the Lightbox items map below.
  const objectUrls = useMemo(
    () =>
      new Map(
        shownAttachments
          .filter((a) => a.kind === 'image' && a.blob)
          .map((a) => [a.id, URL.createObjectURL(a.blob as Blob)]),
      ),
    [shownAttachments],
  );
  useEffect(
    () => () => {
      for (const u of objectUrls.values()) URL.revokeObjectURL(u);
    },
    [objectUrls],
  );
  // Clear any stale inline note if voice becomes available mid-session.
  useEffect(() => {
    if (!p.voiceUnavailable) setVoiceNote(false);
  }, [p.voiceUnavailable]);
  // Focus the composer and scroll it into view whenever an edit begins — the
  // user tapped Edit on a message that may be off-screen or above the fold.
  // scrollIntoView is guarded for jsdom, which omits it (see scroll-to-message.ts).
  const editRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editingMessageId === null) return;
    editRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    editRef.current?.querySelector('textarea')?.focus();
  }, [editingMessageId]);
  // Close the menu when the user clicks anywhere outside the wrap, or presses
  // Escape. Without this the menu had no close path: the toggle button only
  // toggled by re-clicking the same icon, and clicks on chips left it open.
  const menuWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(menuOpen, menuWrapRef, () => setMenuOpen(false));

  const plusWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(sourceMenuOpen, plusWrapRef, () => setSourceMenuOpen(false));

  const updateChat = useUpdateChat();

  // Selecting a reasoning option also dismisses the menu — the user has made
  // their choice; keeping it open is busy-noise.
  //
  // The choice persists on the chat (spec: "for this chat"), so it survives a
  // trip through history rather than resetting to the model default on the next
  // mount. The store stays the runtime source; the row is the memory.
  const onReasoningChange = (r: ReasoningState): void => {
    setReasoning(r);
    setMenuOpen(false);
    updateChat.mutate({ id: p.chatId, patch: { reasoningChoice: reasoningChoiceOf(r) } });
  };

  const onAskExpertChange = (on: boolean): void => {
    setAskExpert(on);
    setMenuOpen(false);
  };

  const askExpertAvailable = settings.data?.expertModel != null;
  const artefactExpertAvailable = settings.data?.artefactExpertModel != null;

  // Send affordances (ADR/CLAUDE.md §4: 1024px is the single desktop boundary):
  //   - Desktop: plain Enter sends, Shift+Enter inserts a newline.
  //   - Everywhere (desktop + mobile): Ctrl/Cmd+Enter sends — the fast keyboard
  //     path Chris uses while testing the desktop build in the browser, and the
  //     only keyboard send on mobile (plain Enter there inserts a newline; the
  //     DualActionBtn is the touch send).
  // We never send while a stream is live or the draft is blank (mirrors the
  // button's enabled state).
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return;
    const ctrlEnter = e.ctrlKey || e.metaKey;
    const desktopPlainEnter =
      !ctrlEnter && !e.shiftKey && window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
    if (!ctrlEnter && !desktopPlainEnter) return;
    if (p.isStreamLive || p.draftValue.trim().length === 0) return;
    e.preventDefault();
    p.onSend(p.draftValue);
  };

  // Pin toggle. Un-pinning with an empty draft is a "let me just read" signal:
  // drop straight back to reading mode rather than leaving an empty cockpit
  // hovering. With text in the draft we keep the cockpit so nothing is lost.
  const onTogglePin = (): void => {
    const willUnpin = isPinned;
    togglePin();
    if (willUnpin && p.draftValue.trim().length === 0) {
      setInteractionMode(false);
    }
  };

  // Memory binding: track uncommitted journal entries and body version staleness so
  // the button can badge and highlight without opening the sheet.
  const { data: freshPersona } = usePersona(p.persona.id);
  const { data: uncommittedCount = 0 } = useUncommittedCount(p.persona.id);
  const { data: currentBody } = useCurrentBody(p.persona.id);
  const bodyVersion = currentBody?.version ?? 0;
  const lastViewed =
    freshPersona?.lastViewedMemoryBodyVersion ?? p.persona.lastViewedMemoryBodyVersion ?? 0;
  const memoryActive = bodyVersion > lastViewed;

  // Knowledge binding: the persona contributes a fixed library set; the chat
  // adds an ad-hoc set on top. The button shows a count of the effective
  // (existing + NSFW-allowed) libraries so the user can see at a glance whether
  // any knowledge is in play for the next send.
  const { data: allLibraries = [] } = useFilteredLibraries();
  const { data: chatData } = useChat(p.chatId || null);
  // Legacy / partial persona rows may omit libraryIds (Chunk B added the field);
  // default to an empty set so the cockpit never crashes on iteration.
  const personaLibraryIds = p.persona.libraryIds ?? [];
  const chatLibraryIds = chatData?.chat.libraryIds ?? [];
  const effectiveCount = computeEffectiveLibraries(
    personaLibraryIds,
    chatLibraryIds,
    allLibraries,
    p.persona.adultPersona,
  ).length;

  // Artefact expert opt-out (absent ⇒ on): unlike askExpert (transient,
  // per-turn), this is a persisted per-chat preference — a synced Class-2
  // chat patch, exactly like a title rename. `updateChat` is declared above,
  // beside the reasoning handler that shares it.
  const artefactExpertOn = chatData?.chat.useArtefactExpertModel !== false;
  const onArtefactExpertChange = (on: boolean): void => {
    void updateChat.mutateAsync({ id: p.chatId, patch: { useArtefactExpertModel: on } });
    setMenuOpen(false);
  };

  // Live content for copy-on-write document references (preview before send), plus a
  // provenance label sourced from the (already NSFW-filtered) library list.
  const { data: refContents } = usePendingDocumentContents(pending);
  const libraryNameById = useMemo(
    () => new Map(allLibraries.map((l) => [l.id, l.name])),
    [allLibraries],
  );
  // Same set as the strip/objectUrls above (see the note there) — otherwise the
  // strip's onOpen(i) index is looked up against the wrong array (editAttachments
  // fed the strip, pending fed the lightbox), so a click either opens an empty
  // lightbox (which self-closes, Lightbox.tsx) or the wrong image.
  const items = shownAttachments.map((row) => {
    const provenance = row.kbRef
      ? `${libraryNameById.get(row.kbRef.libraryId) ?? 'Library'} › ${row.fileName.replace(/\.md$/, '')}`
      : undefined;
    return attachmentToViewable(row, {
      pending: true,
      objectUrl: objectUrls.get(row.id),
      effectiveText: refContents?.get(row.id),
      provenance,
    });
  });

  const hasSourceMenu = !!p.onAttachFromTreasury || !!p.onAttachFromLibrary;

  return (
    <div
      className="cockpit"
      data-pinned={isPinned ? 'true' : 'false'}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length > 0) {
          e.preventDefault();
          void ingest(files);
        }
        // Plain-text paste falls through to the textarea (normal prompt text).
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault();
          setDragging(false);
          void ingest(e.dataTransfer.files);
        }
      }}
    >
      {/* Hidden picker input — opened by the (+) button. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.csv,.ts,.tsx,.js,.py,.svg,.mmd,.mermaid,.html,.css"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void ingest(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="cockpit-row-controls">
        <div ref={plusWrapRef} className="cockpit-menu-wrap">
          <button
            type="button"
            className="cockpit-icon-btn"
            data-control="plus"
            title="Add attachment"
            aria-label="Add attachment"
            aria-expanded={hasSourceMenu ? sourceMenuOpen : undefined}
            onClick={() => {
              if (hasSourceMenu) setSourceMenuOpen((v) => !v);
              else fileInputRef.current?.click();
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {sourceMenuOpen && hasSourceMenu ? (
            <div className="cockpit-menu" role="menu">
              <button
                type="button"
                className="cockpit-menu-item"
                role="menuitem"
                data-source="upload"
                onClick={() => {
                  setSourceMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <span aria-hidden>📎</span> Upload from device
              </button>
              {p.onAttachFromTreasury ? (
                <button
                  type="button"
                  className="cockpit-menu-item"
                  role="menuitem"
                  data-source="treasury"
                  onClick={() => {
                    setSourceMenuOpen(false);
                    p.onAttachFromTreasury?.();
                  }}
                >
                  <span aria-hidden>⬡</span> Attach from Treasury
                </button>
              ) : null}
              {p.onAttachFromLibrary ? (
                <button
                  type="button"
                  className="cockpit-menu-item"
                  role="menuitem"
                  data-source="library"
                  disabled={allLibraries.length === 0}
                  title={allLibraries.length === 0 ? 'Create a library first' : undefined}
                  onClick={() => {
                    setSourceMenuOpen(false);
                    p.onAttachFromLibrary?.();
                  }}
                >
                  <span aria-hidden>❖</span> Attach from knowledge
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div ref={menuWrapRef} className="cockpit-menu-wrap">
          <button
            type="button"
            className="cockpit-icon-btn"
            data-control="menu"
            aria-label="Open chat menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          {menuOpen ? (
            <CockpitMenu
              control={p.offering.profile.reasoning}
              reasoning={reasoning}
              onReasoningChange={onReasoningChange}
              searchTiers={searchTiers}
              searchTierId={searchTierId}
              onSearchTierChange={setSearchTierId}
              onClose={() => setMenuOpen(false)}
              askExpertAvailable={askExpertAvailable}
              askExpert={askExpert}
              onAskExpertChange={onAskExpertChange}
              artefactExpertAvailable={artefactExpertAvailable}
              artefactExpertOn={artefactExpertOn}
              onArtefactExpertChange={onArtefactExpertChange}
              chatFontScale={settings.data?.chatFontScale ?? 'standard'}
              onChatFontScaleChange={(scale: ChatFontScale) => {
                void updateSettings.mutateAsync({ chatFontScale: scale });
              }}
            />
          ) : null}
        </div>
        <button
          type="button"
          className="cockpit-icon-btn"
          data-control="live"
          onClick={() => p.onEnterLiveVoice?.()}
          disabled={p.voiceUnavailable !== null}
          data-disabled={p.voiceUnavailable ? 'true' : undefined}
          aria-disabled={p.voiceUnavailable ? true : undefined}
          title={
            p.voiceUnavailable
              ? 'No voice provider — set one in Settings → Voice'
              : 'Live voice mode'
          }
          aria-label="Live voice mode"
        >
          <span className="wave-icon" aria-hidden="true">
            ≈
          </span>
        </button>
        <button
          type="button"
          className={`cockpit-icon-btn${p.autoReadAloud ? ' active' : ''}`}
          data-control="autoread"
          data-disabled={p.voiceUnavailable ? 'true' : undefined}
          aria-pressed={p.autoReadAloud}
          aria-disabled={p.voiceUnavailable ? true : undefined}
          aria-label={
            p.voiceUnavailable
              ? 'Read replies aloud (no voice configured)'
              : p.autoReadAloud
                ? 'Stop reading replies aloud'
                : 'Read replies aloud'
          }
          onClick={() => {
            if (p.voiceUnavailable) {
              setVoiceNote((v) => !v);
              return;
            }
            setVoiceNote(false);
            p.onToggleAutoRead(!p.autoReadAloud);
          }}
        >
          <span className="cockpit-glyph" aria-hidden="true">
            {p.autoReadAloud ? '🔊' : '🔈'}
          </span>
        </button>
        <div className="cockpit-controls-spacer" />
        <button
          type="button"
          className="cockpit-icon-btn"
          data-control="toc"
          aria-label="Bookmarks and contents"
          disabled={!p.chatId}
          aria-disabled={!p.chatId || undefined}
          title={!p.chatId ? 'Send your first message to add to this chat.' : undefined}
          onClick={() => navigate(`/app/chat/${p.chatId}/bookmarks`)}
        >
          <Bookmark className="cockpit-glyph" size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cockpit-icon-btn"
          data-control="artefacts"
          aria-label="Artefacts"
          disabled={!p.chatId}
          aria-disabled={!p.chatId || undefined}
          title={!p.chatId ? 'Send your first message to add to this chat.' : undefined}
          onClick={() => navigate(`/app/chat/${p.chatId}/artefacts`)}
        >
          <Gem className="cockpit-glyph" size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`cockpit-icon-btn${uncommittedCount > 0 || memoryActive ? ' active' : ''}`}
          data-control="memory"
          aria-label="Chat memory"
          onClick={() => navigate(`/app/persona/${p.persona.id}/memory?chat=${p.chatId}`)}
        >
          <Brain className="cockpit-glyph" size={20} aria-hidden="true" />
          {uncommittedCount > 0 ? (
            <span className="cockpit-control-count" aria-hidden="true">
              {uncommittedCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className={`cockpit-icon-btn${effectiveCount > 0 ? ' active' : ''}`}
          data-control="knowledge"
          aria-label="Knowledge for this chat"
          disabled={!p.chatId}
          aria-disabled={!p.chatId || undefined}
          title={!p.chatId ? 'Send your first message to add to this chat.' : undefined}
          onClick={() => navigate(`/app/chat/${p.chatId}/knowledge`)}
        >
          <BookOpen className="cockpit-glyph" size={20} aria-hidden="true" />
          {effectiveCount > 0 ? (
            <span className="cockpit-control-count" aria-hidden="true">
              {effectiveCount}
            </span>
          ) : null}
        </button>
        {!isDesktop ? (
          <button
            type="button"
            className={`cockpit-icon-btn${isPinned ? ' active' : ''}`}
            data-control="pin"
            aria-label={isPinned ? 'Unpin cockpit' : 'Pin cockpit'}
            aria-pressed={isPinned}
            onClick={onTogglePin}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M12 2v10M8 14l4-4 4 4M6 22h12" />
            </svg>
          </button>
        ) : null}
      </div>
      {shownAttachments.length > 0 && <div className="cockpit-divider" />}
      <AttachmentStrip attachments={shownAttachments} onOpen={(i) => setLightboxIndex(i)} />
      {p.dictation.failed ? (
        <div className="cockpit-dictation-note" role="alert">
          {/* A refusal (deterministic 4xx) names the provider as the actor; Retry
              stays offered — a context-scored moderation verdict can flip (spec §6). */}
          <span>
            {p.dictation.failedKind === 'refusal'
              ? 'The voice provider declined to transcribe this recording.'
              : "Couldn't transcribe."}
          </span>
          <button type="button" onClick={p.dictation.retry}>
            Retry
          </button>
          <button type="button" onClick={p.dictation.discard}>
            Discard
          </button>
        </div>
      ) : p.dictation.captureError === 'permission' ? (
        <div className="cockpit-dictation-note" role="alert">
          Allow microphone access in your browser settings, then try again.
        </div>
      ) : p.dictation.captureError === 'device' ? (
        <div className="cockpit-dictation-note" role="alert">
          The microphone could not be started. Check it is connected and not in use, then tap the
          mic to try again.
        </div>
      ) : null}
      {artefactExpertError ? (
        <div className="cockpit-artefact-note" role="alert">
          <span>{artefactExpertError}</span>
          <button type="button" onClick={() => navigate('/app/settings/expert')}>
            Settings
          </button>
          <button type="button" onClick={() => setArtefactExpertError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {voiceNote && p.voiceUnavailable ? (
        <output className="cockpit-dictation-note">
          <span>
            {p.voiceUnavailable === 'no-provider'
              ? 'No voice yet — set up a voice provider to read replies aloud.'
              : 'No voice yet — give this companion a voice to read replies aloud.'}
          </span>
          <button type="button" onClick={() => navigate('/app/settings')}>
            Settings → Voice
          </button>
        </output>
      ) : null}
      {editing ? (
        <output className="cockpit-edit-banner">
          <span>
            {canReplace
              ? 'Editing your message'
              : 'Editing an earlier message — sending will start a new branch.'}
          </span>
        </output>
      ) : null}
      <div className="cockpit-row-input" data-editing={editing ? 'true' : undefined} ref={editRef}>
        <AutoSizeTextarea
          value={p.draftValue}
          onChange={p.onDraftChange}
          placeholder={
            p.dictation.uiState === 'capturing'
              ? 'Listening…'
              : p.dictation.uiState === 'transcribing'
                ? 'Transcribing…'
                : `Speak to ${p.persona.name}…`
          }
          maxRows={6}
          className="cockpit-input"
          autoFocus
          onKeyDown={onInputKeyDown}
        />
        {editing ? (
          // Editing stacks the cancel (X) above the send control so the send
          // position stays bottom-right in both modes; the input keeps room for
          // the two-button stack (see .cockpit-row-input[data-editing]).
          <div className="edit-action-stack">
            <button
              type="button"
              className="edit-cancel-btn"
              onClick={onCancelEdit}
              aria-label="Cancel editing"
              title="Cancel editing"
            >
              <X size={20} aria-hidden="true" />
            </button>
            <EditSendButton
              canReplace={canReplace}
              disabledReason={
                canReplace
                  ? null
                  : 'There are newer messages after this — editing here starts a branch.'
              }
              onReplace={onReplace}
              onBranch={onBranchEdit}
              busy={p.isStreamLive}
            />
          </div>
        ) : (
          <DualActionBtn
            hasText={p.draftValue.trim().length > 0}
            isStreamLive={p.isStreamLive}
            personaName={p.persona.name}
            onSend={() => p.onSend(p.draftValue)}
            onStop={p.onStop}
            dictation={p.dictation}
          />
        )}
      </div>
      {dragging && <div className="cockpit-drop-overlay">Drop files to attach</div>}
      {reject && (
        <div className="cockpit-reject" role="alert" onAnimationEnd={() => setReject(null)}>
          {reject}
        </div>
      )}
      {lightboxIndex !== null && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          getOriginRect={(id) =>
            document
              .querySelector<HTMLElement>(`[data-attachment-thumb="${CSS.escape(id)}"]`)
              ?.getBoundingClientRect() ?? null
          }
          onRename={(id, patch) => {
            if (patch.fileName) rename.mutate({ id, fileName: patch.fileName });
          }}
          onRemove={(id) => {
            // While editing, an ORIGINAL (bound to the edited message) stages
            // its removal — undo-able via Cancel — rather than deleting the
            // row outright; a PENDING addition made during this edit session
            // takes the ordinary delete path either way (spec §8).
            const attMessageId = shownAttachments.find((a) => a.id === id)?.messageId ?? null;
            if (attachmentRemovalRoute(attMessageId, editingMessageId) === 'stage') {
              stageRemoval(id);
            } else {
              remove.mutate(id);
            }
          }}
          onEditText={(id, text) => editText.mutate({ id, text })}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
