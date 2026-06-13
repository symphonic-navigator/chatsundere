// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { classifyFile } from '../../attachments/file-classify.js';
import { normaliseImageForLlm } from '../../attachments/image-normalise.js';
import type { PersonaRow } from '../../boot/client-data-db.js';
import {
  addAttachment,
  usePendingAttachments,
  usePendingDocumentContents,
  useRemoveAttachment,
  useRenameAttachment,
  useUpdateAttachmentText,
} from '../../data/attachments.js';
import { useChat, useSetChatLibraries } from '../../data/chats.js';
import { useFilteredLibraries } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';
import { useSettings } from '../../data/settings.js';
import { computeEffectiveLibraries } from '../../knowledge/effective-libraries.js';
import type { ReasoningState } from '../../lib/reasoning-resolver.js';
import { useActiveSearchTiers } from '../../lib/use-active-search-tiers.js';
import { useDismissOnOutside } from '../../lib/use-dismiss-on-outside.js';
import type { Dictation } from '../../lib/voice/dictation/use-dictation.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';
import { AutoSizeTextarea } from '../AutoSizeTextarea.js';
import { Lightbox } from '../lightbox/Lightbox.js';
import { attachmentToViewable } from '../lightbox/viewable-item.js';
import { AttachmentStrip } from './AttachmentStrip.js';
import { CockpitMenu } from './CockpitMenu.js';
import { DualActionBtn } from './DualActionBtn.js';
import { KnowledgeSheet } from './KnowledgeSheet.js';

interface Props {
  chatId: string;
  persona: PersonaRow;
  offering: Offering;
  draftValue: string;
  onDraftChange: (v: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  isStreamLive: boolean;
  /** Open the per-chat ToC / bookmarks sheet (omitted → button hidden). */
  onOpenToc?: () => void;
  /** Open the per-chat artefact sheet (omitted → button hidden). */
  onOpenArtefacts?: () => void;
  /** Whether the chat has content worth navigating — gates the ToC/artefact
   *  buttons in the controls row (mirrors the reading-mode tool strip). */
  toolsAvailable?: boolean;
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
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [voiceNote, setVoiceNote] = useState(false);
  const navigate = useNavigate();
  const isPinned = useCurrentChatStore((s) => s.isPinned);
  const togglePin = useCurrentChatStore((s) => s.togglePin);
  const setInteractionMode = useCurrentChatStore((s) => s.setInteractionMode);
  const reasoning = useCurrentChatStore((s) => s.reasoning);
  const setReasoning = useCurrentChatStore((s) => s.setReasoning);
  const searchTiers = useActiveSearchTiers();
  const searchTierId = useCurrentChatStore((s) => s.webSearchTierId);
  const setSearchTierId = useCurrentChatStore((s) => s.setWebSearchTierId);
  const askExpert = useCurrentChatStore((s) => s.askExpert);
  const setAskExpert = useCurrentChatStore((s) => s.setAskExpert);
  const settings = useSettings();

  // Attachments: the pending set for this chat, plus the mutation hooks the
  // lightbox drives (rename / remove / edit-text), and the local UI state for
  // the hidden picker, the reject toast, the OS drag-over flag, and the open
  // lightbox index.
  const qc = useQueryClient();
  const { data: pending = [] } = usePendingAttachments(p.chatId);
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

  // One object URL per pending image, rebuilt whenever the pending set changes
  // and revoked on the next change / unmount so the browser never leaks blobs.
  const objectUrls = useMemo(
    () =>
      new Map(
        pending
          .filter((a) => a.kind === 'image' && a.blob)
          .map((a) => [a.id, URL.createObjectURL(a.blob as Blob)]),
      ),
    [pending],
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
  // Close the menu when the user clicks anywhere outside the wrap, or presses
  // Escape. Without this the menu had no close path: the toggle button only
  // toggled by re-clicking the same icon, and clicks on chips left it open.
  const menuWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(menuOpen, menuWrapRef, () => setMenuOpen(false));

  const plusWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(sourceMenuOpen, plusWrapRef, () => setSourceMenuOpen(false));

  // Selecting a reasoning option also dismisses the menu — the user has made
  // their choice; keeping it open is busy-noise.
  const onReasoningChange = (r: ReasoningState): void => {
    setReasoning(r);
    setMenuOpen(false);
  };

  const onAskExpertChange = (on: boolean): void => {
    setAskExpert(on);
    setMenuOpen(false);
  };

  const askExpertAvailable = settings.data?.expertModel != null;

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
      !ctrlEnter && !e.shiftKey && window.matchMedia('(min-width: 1024px)').matches;
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

  // Knowledge binding: the persona contributes a fixed library set; the chat
  // adds an ad-hoc set on top. The button shows a count of the effective
  // (existing + NSFW-allowed) libraries so the user can see at a glance whether
  // any knowledge is in play for the next send.
  const { data: allLibraries = [] } = useFilteredLibraries();
  const { data: chatData } = useChat(p.chatId || null);
  const setChatLibraries = useSetChatLibraries();
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

  const onToggleChatLibrary = (id: string): void => {
    if (!p.chatId) return;
    const next = chatLibraryIds.includes(id)
      ? chatLibraryIds.filter((l) => l !== id)
      : [...chatLibraryIds, id];
    setChatLibraries.mutate({ chatId: p.chatId, libraryIds: next });
  };

  // Live content for copy-on-write document references (preview before send), plus a
  // provenance label sourced from the (already NSFW-filtered) library list.
  const { data: refContents } = usePendingDocumentContents(pending);
  const libraryNameById = useMemo(
    () => new Map(allLibraries.map((l) => [l.id, l.name])),
    [allLibraries],
  );
  const items = pending.map((row) => {
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
            />
          ) : null}
        </div>
        <button
          type="button"
          className="cockpit-icon-btn"
          data-control="live"
          disabled
          title="Voice arrives with Block 4"
          aria-label="Live voice mode (coming with Block 4)"
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
        {p.toolsAvailable && p.onOpenToc && p.onOpenArtefacts ? (
          <>
            <button
              type="button"
              className="cockpit-icon-btn"
              data-control="toc"
              aria-label="Bookmarks and contents"
              onClick={p.onOpenToc}
            >
              <span className="cockpit-glyph" aria-hidden="true">
                ◈
              </span>
            </button>
            <button
              type="button"
              className="cockpit-icon-btn"
              data-control="artefacts"
              aria-label="Artefacts"
              onClick={p.onOpenArtefacts}
            >
              <span className="cockpit-glyph" aria-hidden="true">
                ⬡
              </span>
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={`cockpit-icon-btn${effectiveCount > 0 ? ' active' : ''}`}
          data-control="knowledge"
          aria-label="Knowledge for this chat"
          aria-expanded={knowledgeOpen}
          onClick={() => setKnowledgeOpen((v) => !v)}
        >
          <span className="cockpit-glyph" aria-hidden="true">
            ❖
          </span>
          {effectiveCount > 0 ? (
            <span className="cockpit-control-count" aria-hidden="true">
              {effectiveCount}
            </span>
          ) : null}
        </button>
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
      </div>
      {pending.length > 0 && <div className="cockpit-divider" />}
      <AttachmentStrip attachments={pending} onOpen={(i) => setLightboxIndex(i)} />
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
      <div className="cockpit-row-input">
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
        <DualActionBtn
          hasText={p.draftValue.trim().length > 0}
          isStreamLive={p.isStreamLive}
          personaName={p.persona.name}
          onSend={() => p.onSend(p.draftValue)}
          onStop={p.onStop}
          dictation={p.dictation}
        />
      </div>
      {dragging && <div className="cockpit-drop-overlay">Drop files to attach</div>}
      {reject && (
        <div className="cockpit-reject" role="alert" onAnimationEnd={() => setReject(null)}>
          {reject}
        </div>
      )}
      {knowledgeOpen && (
        <KnowledgeSheet
          personaLibraryIds={personaLibraryIds}
          chatLibraryIds={chatLibraryIds}
          onToggleChat={onToggleChatLibrary}
          adultPersona={p.persona.adultPersona}
          canBindChat={!!p.chatId}
          onClose={() => setKnowledgeOpen(false)}
        />
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
          onRemove={(id) => remove.mutate(id)}
          onEditText={(id, text) => editText.mutate({ id, text })}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
