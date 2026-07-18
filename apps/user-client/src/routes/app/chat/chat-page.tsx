// SPDX-License-Identifier: AGPL-3.0-only
import { buildPrompt, getOffering, resolveModelInstructions } from '@chatsundere/llm-unified';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PersonaRow, SeedTemplateRow } from '../../../boot/client-data-db.js';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { markCompactionToastShown } from '../../../compaction/repo.js';
import { isCompactable, shouldShowToast } from '../../../compaction/trigger.js';
import { ModelDebugReport } from '../../../components/ModelDebugReport.js';
import { SyncTombstoneBreadcrumb } from '../../../components/SyncTombstoneBreadcrumb.js';
import { ArtefactPicker } from '../../../components/artefact/ArtefactPicker.js';
import { BottomAffordance } from '../../../components/chat/BottomAffordance.js';
import { BranchSheet } from '../../../components/chat/BranchSheet.js';
import { ChatStream } from '../../../components/chat/ChatStream.js';
import { CompactConfirmCard } from '../../../components/chat/CompactConfirmCard.js';
import { CompactingOverlay } from '../../../components/chat/CompactingOverlay.js';
import { DimOverlay } from '../../../components/chat/DimOverlay.js';
import { InteractionMode } from '../../../components/chat/InteractionMode.js';
import { LiveVoiceBar } from '../../../components/chat/LiveVoiceBar.js';
import { PersonaGreeting } from '../../../components/chat/PersonaGreeting.js';
import { SeedTemplatePicker } from '../../../components/chat/SeedTemplatePicker.js';
import { StreamInterruptedFooter } from '../../../components/chat/StreamInterruptedFooter.js';
import { VoiceTransport } from '../../../components/chat/VoiceTransport.js';
import { DocumentPicker } from '../../../components/knowledge/DocumentPicker.js';
import { Lightbox } from '../../../components/lightbox/Lightbox.js';
import { artefactToViewable } from '../../../components/lightbox/viewable-item.js';
import { McpApprovalPrompt } from '../../../components/mcp/McpApprovalPrompt.js';
import { PickerOverlay } from '../../../components/ui/PickerOverlay.js';
import { SpectrumAnalyser } from '../../../components/voice/SpectrumAnalyser.js';
import {
  useChatArtefacts,
  useDeleteArtefact,
  useRenameArtefact,
  useSetArtefactTags,
  useUpdateArtefactContent,
} from '../../../data/artefacts.js';
import { clearPendingAttachments, useEditAttachments } from '../../../data/attachments.js';
import { useBranchChat, useChat, useCreateChat, useUpdateChat } from '../../../data/chats.js';
import {
  canReplaceInPlace,
  useEditAndBranch,
  useEditAndReplace,
} from '../../../data/message-edit.js';
import { useMindspaces } from '../../../data/mindspaces.js';
import { QK } from '../../../data/queryKeys.js';
import { useFilteredSeedTemplates } from '../../../data/seed-templates.js';
import { useRegenerate, useSendMessage, useStartOpener } from '../../../data/send-message.js';
import { useDisplayName, useSettings, useUpdateSettings } from '../../../data/settings.js';
import { chatFontScaleValue } from '../../../lib/chat-font-scale.js';
import { clearLazyDraft, loadLazyDraft, saveLazyDraft } from '../../../lib/cockpit-draft.js';
import { isContextMessage } from '../../../lib/content-blocks.js';
import { resolveContextWindow } from '../../../lib/context-window.js';
import { initialReasoningState } from '../../../lib/reasoning-resolver.js';
import { scrollToMessage } from '../../../lib/scroll-to-message.js';
import { materialiseSeed } from '../../../lib/seed-materialise.js';
import { contextUtilisation, estimateTokens } from '../../../lib/token-estimator.js';
import { collectTags } from '../../../lib/treasury-filter.js';
import { useDictation } from '../../../lib/voice/dictation/use-dictation.js';
import { REDEMPTION_MS_DEFAULT } from '../../../lib/voice/dictation/vad-presets.js';
import { useLiveVoice } from '../../../lib/voice/live/use-live-voice.js';
import { useMonologuePlayback } from '../../../lib/voice/use-monologue-playback.js';
import { useVoicePlayback } from '../../../lib/voice/use-voice-playback.js';
import { useCurrentChatStore } from '../../../state/current-chat.store.js';
import { useEffectiveChatMode, useIsDesktop } from '../../../state/effective-chat-mode.js';
import { useMindspaceStore } from '../../../state/mindspace.store.js';
import { useStreamManagerStore } from '../../../state/stream-manager.store.js';
import { toastStore } from '../../../state/toast.store.js';
import { mutateSynced } from '../../../sync/enqueue.js';
import { useClass2Gate } from '../../../sync/gate.js';
import { buildEditOrchestration, resolveSendAction } from './use-edit-orchestration.js';

const DRAFT_DEBOUNCE_MS = 250;

export function ChatPage(): JSX.Element {
  const { chatId } = useParams<{ chatId?: string }>();
  const [search, setSearchParams] = useSearchParams();
  const personaIdFromQuery = search.get('personaId');
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const isLazy = !chatId;
  const activeChatId = chatId ?? null;

  const chatQuery = useChat(activeChatId);
  const sendMessage = useSendMessage();
  const regenerate = useRegenerate();
  const updateChat = useUpdateChat();
  const branchChat = useBranchChat();
  const createChat = useCreateChat();
  const startOpener = useStartOpener();
  const class2Gate = useClass2Gate();
  const editAndReplace = useEditAndReplace();
  const editAndBranch = useEditAndBranch();

  const setChatId = useCurrentChatStore((s) => s.setChatId);
  const setLazy = useCurrentChatStore((s) => s.setLazy);
  const setInteractionMode = useCurrentChatStore((s) => s.setInteractionMode);
  const togglePin = useCurrentChatStore((s) => s.togglePin);
  // Effective mode: desktop forces interaction+pinned at read time (spec
  // 2026-07-18 §5.2). Store setters below still write the mobile truth.
  const { isInteractionMode, isPinned } = useEffectiveChatMode();
  const isDesktop = useIsDesktop();
  const inputFocused = useCurrentChatStore((s) => s.inputFocused);
  const setChatPersonaIsAdult = useCurrentChatStore((s) => s.setChatPersonaIsAdult);
  const setChatHeader = useCurrentChatStore((s) => s.setChatHeader);
  const setAutoFollow = useCurrentChatStore((s) => s.setAutoFollow);
  const setReasoning = useCurrentChatStore((s) => s.setReasoning);
  const reasoning = useCurrentChatStore((s) => s.reasoning);
  const setAskExpert = useCurrentChatStore((s) => s.setAskExpert);
  const setArtefactExpertError = useCurrentChatStore((s) => s.setArtefactExpertError);
  const isLiveVoice = useCurrentChatStore((s) => s.isLiveVoice);
  const setLiveVoice = useCurrentChatStore((s) => s.setLiveVoice);
  const editStagedRemovals = useCurrentChatStore((s) => s.editStagedRemovals);
  const resetEditSession = useCurrentChatStore((s) => s.resetEditSession);

  const openArtefactId = useCurrentChatStore((s) => s.openArtefactId);
  const openArtefact = useCurrentChatStore((s) => s.openArtefact);
  const closeArtefact = useCurrentChatStore((s) => s.closeArtefact);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [seedPickerOpen, setSeedPickerOpen] = useState(false);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [branchPointId, setBranchPointId] = useState<string | null>(null);
  const [showCompactConfirm, setShowCompactConfirm] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);

  const jumpToMessage = (messageId: string): void => {
    setInteractionMode(false);
    // Disable auto-follow first, otherwise ChatStream's scroll-to-bottom
    // effect (and its ResizeObserver) snaps to the latest message and
    // overrides our jump — landing the user at the end of the chat.
    setAutoFollow(false);
    requestAnimationFrame(() => {
      // one retry — the message row may mount a frame later
      if (!scrollToMessage(messageId)) {
        requestAnimationFrame(() => scrollToMessage(messageId));
      }
    });
  };

  // Sync store with route. Mount auto-opens Interaction Mode in lazy mode + pins cockpit.
  // On every chat-mode entry — including back from the persona-editor — we
  // also force autoFollow back on so ChatStream's scroll-to-bottom effect
  // lands the user at the latest message. Without this the cross-session
  // autoFollow flag (false if the user had scrolled up before leaving) would
  // persist and they'd land mid-history on return.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally one-shot per chatId/personaId — store setters are stable Zustand references that do not need to be in the dep array
  useEffect(() => {
    if (isLazy && personaIdFromQuery) {
      setLazy(personaIdFromQuery);
      // Desktop derives interaction+pinned (spec §5.3 exception): writing them
      // here would leak desktop state into mobile after a resize below 1024 px.
      if (!isDesktop) {
        setInteractionMode(true);
        // Pin on mount — idempotent guard avoids double-toggle on strict-mode re-renders.
        if (!useCurrentChatStore.getState().isPinned) togglePin();
      }
    } else if (chatId) {
      setChatId(chatId);
      setAutoFollow(true);
    }
  }, [chatId, personaIdFromQuery]);

  // Guard: if the route specifies a chatId but the query has resolved to "no
  // chat", the row was deleted from another surface. Navigate back to History
  // so the user isn't stranded on a blank page.
  useEffect(() => {
    if (!isLazy && chatId && chatQuery.isFetched && !chatQuery.data?.chat) {
      navigate('/app/history', { replace: true });
    }
  }, [isLazy, chatId, chatQuery.isFetched, chatQuery.data?.chat, navigate]);

  // Clear the current-chat store when ChatPage unmounts. Without this, the
  // chatId persists across navigation to /app/history etc., and nsfwPanic
  // sees a stale "active chat" — incorrectly navigating the user away from
  // wherever they are. The store should reflect the actual chat-view state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setChatId is a stable Zustand reference
  useEffect(() => {
    return () => {
      setChatId(null);
    };
  }, []);

  // Resolve persona for lazy mode.
  const lazyPersonaQuery = useQuery({
    queryKey: ['persona', personaIdFromQuery],
    enabled: isLazy && !!personaIdFromQuery,
    queryFn: async () => {
      if (!personaIdFromQuery) return null;
      return (await getClientDataDb().personas.get(personaIdFromQuery)) ?? null;
    },
  });

  // Resolve persona for chat-mode via chat's personaId.
  const chatPersonaQuery = useQuery({
    queryKey: ['persona', chatQuery.data?.chat?.personaId],
    enabled: !isLazy && !!chatQuery.data?.chat?.personaId,
    queryFn: async () => {
      const pid = chatQuery.data?.chat?.personaId;
      if (!pid) return null;
      return (await getClientDataDb().personas.get(pid)) ?? null;
    },
  });

  const effectivePersona: PersonaRow | null = isLazy
    ? (lazyPersonaQuery.data ?? null)
    : (chatPersonaQuery.data ?? null);

  // Eager opener-chat creation. On the lazy route, when the persona has a
  // greeting, we create the ChatRow immediately (openerPending) and redirect
  // to the real chat route — so the opener can stream the moment the page
  // opens, rather than waiting for the first user send. Personas WITHOUT a
  // greeting keep the deferred lazy-creation behaviour (created on first send).
  // The ref guards against StrictMode's double-mount creating two chats.
  const eagerCreateFiredRef = useRef(false);
  useEffect(() => {
    if (!isLazy || !personaIdFromQuery || !effectivePersona) return;
    if (!(effectivePersona.roleplay && effectivePersona.greetingEnabled)) return;
    if (eagerCreateFiredRef.current) return;
    eagerCreateFiredRef.current = true;
    void createChat
      .mutateAsync({
        personaId: personaIdFromQuery,
        openerPending: true,
        draftInput: loadLazyDraft(personaIdFromQuery),
      })
      .then((newId) => {
        clearLazyDraft(personaIdFromQuery);
        navigate(`/app/chat/${newId}`, { replace: true });
      });
  }, [isLazy, personaIdFromQuery, effectivePersona, createChat, navigate]);

  // Publish whether this chat's persona is adult so the brand-bar
  // AdultModeToggle can hide itself for SFW personas (a calmer chat screen).
  // `null` while the persona is still resolving / on unmount → toggle shows.
  useEffect(() => {
    setChatPersonaIsAdult(effectivePersona ? effectivePersona.adultPersona : null);
    return () => setChatPersonaIsAdult(null);
  }, [effectivePersona, setChatPersonaIsAdult]);

  // Publish the active chat's persona + title so the brand bar can render the
  // persona avatar and chat title in read-only form. `null` on unmount or when
  // the persona / chat id are still resolving.
  useEffect(() => {
    if (effectivePersona && activeChatId) {
      setChatHeader({
        personaId: effectivePersona.id,
        name: effectivePersona.name,
        colour: effectivePersona.colour,
        title: chatQuery.data?.chat?.title ?? '',
      });
    } else {
      setChatHeader(null);
    }
    return () => setChatHeader(null);
  }, [effectivePersona, activeChatId, chatQuery.data?.chat?.title, setChatHeader]);

  // Resolve Offering via provider lookup keyed to the effective persona.
  const modelQuery = useQuery({
    // Key on provider + model too, not just the persona id — otherwise
    // changing a persona's model mid-chat (same id) does not change the key,
    // so the offering (and the reasoning UI derived from it) stays stale until
    // a remount. See reasoning-UI-not-updating bug.
    queryKey: [
      'offering-for-persona',
      effectivePersona?.id,
      effectivePersona?.providerId,
      effectivePersona?.modelId,
    ],
    enabled: !!effectivePersona,
    queryFn: async () => {
      if (!effectivePersona) return null;
      const provider = await getClientDataDb().providers.get(effectivePersona.providerId);
      if (!provider) return null;
      const slug = effectivePersona.modelId;
      return slug ? (getOffering(provider.templateId, slug) ?? null) : null;
    },
  });
  const offering = modelQuery.data ?? null;

  // Initialise reasoning state once the offering resolves.
  useEffect(() => {
    if (offering) setReasoning(initialReasoningState(offering.profile.reasoning));
  }, [offering, setReasoning]);

  // Initialise the ask-expert runtime toggle from the persona's default.
  useEffect(() => {
    if (effectivePersona) setAskExpert(effectivePersona.askExpertDefault);
  }, [effectivePersona, setAskExpert]);

  // Clear the artefact-expert failure note on chat switch — it belongs to the
  // chat where the failure happened (mirrors the per-chat askExpert reset).
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeChatId is the intentional trigger — setArtefactExpertError is a stable Zustand reference
  useEffect(() => {
    setArtefactExpertError(null);
  }, [activeChatId, setArtefactExpertError]);

  // Settings (for displayName and token estimate).
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await getClientDataDb().settings.get(1)) ?? null,
  });
  const displayName = useDisplayName();

  // Bind the global mindspace store to this chat's persona. Without this,
  // chat surfaces would show whatever mindspace was last set (e.g. the
  // user-default from Circle/Entrance Hall, or the previously-edited
  // persona's mindspace from the editor). Mirrors PersonaEditor's effect.
  const mindspaces = useMindspaces();
  const setMindspaceStore = useMindspaceStore((s) => s.update);
  useEffect(() => {
    if (!effectivePersona || !mindspaces.data || !settingsQuery.data) return;
    setMindspaceStore({
      persona: {
        mindspaceId: effectivePersona.mindspaceId,
        textureOverride: effectivePersona.textureOverride,
      },
      defaultMindspaceId: settingsQuery.data.defaultMindspaceId,
      defaultTexture: settingsQuery.data.userTexture,
      mindspaces: mindspaces.data,
    });
  }, [effectivePersona, settingsQuery.data, mindspaces.data, setMindspaceStore]);

  // Draft persistence — chat-mode reads ChatRow.draftInput; lazy mode reads localStorage.
  const dbDraft = chatQuery.data?.chat?.draftInput ?? '';
  const [draft, setDraft] = useState<string>(() =>
    isLazy && personaIdFromQuery ? loadLazyDraft(personaIdFromQuery) : '',
  );

  // Reconcile chat-mode draft once the chat loads.
  useEffect(() => {
    if (!isLazy) setDraft(dbDraft);
  }, [isLazy, dbDraft]);

  // Debounced save — lazy mode → localStorage; chat-mode → DB.
  // The lazy-mode callback guards against firing after eager creation has already
  // called clearLazyDraft (eagerCreateFiredRef is true by that point), closing
  // the narrow window between clearLazyDraft and React's effect cleanup.
  useEffect(() => {
    if (isLazy) {
      if (!personaIdFromQuery) return;
      const t = setTimeout(() => {
        if (eagerCreateFiredRef.current) return;
        saveLazyDraft(personaIdFromQuery, draft);
      }, DRAFT_DEBOUNCE_MS);
      return () => clearTimeout(t);
    }
    if (activeChatId && draft !== dbDraft) {
      const t = setTimeout(() => {
        void updateChat.mutateAsync({ id: activeChatId, patch: { draftInput: draft } });
      }, DRAFT_DEBOUNCE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [draft, isLazy, personaIdFromQuery, activeChatId, dbDraft, updateChat]);

  // Stream handle for the active chat.
  const streamHandle = useStreamManagerStore((s) =>
    activeChatId ? (s.streams.get(activeChatId) ?? null) : null,
  );
  const compactNow = useStreamManagerStore((s) => s.compactNow);
  const compactingState = useStreamManagerStore((s) => s.compactingState);
  const isStreamLive = !!streamHandle;
  const diagnosticsReport = useStreamManagerStore((s) =>
    activeChatId ? (s.diagnostics.get(activeChatId) ?? null) : null,
  );
  const [diagOpen, setDiagOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeChatId is the intentional trigger — closing a stale diagnostics overlay when the chat changes
  useEffect(() => {
    setDiagOpen(false);
  }, [activeChatId]);

  // Clear stale opener error state when the active chat changes. Without this,
  // navigating from chat A (where the opener failed) to chat B would carry over
  // chat A's isError, briefly showing a failure notice for the new chat.
  const { reset: resetStartOpener } = startOpener;
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeChatId is the intentional trigger — resetStartOpener is a stable reference included for correctness
  useEffect(() => {
    resetStartOpener();
  }, [activeChatId, resetStartOpener]);

  // Opener trigger. On a real chat whose opener is still pending and which has
  // no messages and no live stream, fire the opener exactly once per mount
  // (keyed on chat id). The store keeps openerPending set on failure, so the
  // automatic retry happens on the NEXT open — never by looping within a mount.
  const openerFiredForChatRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLazy || !activeChatId) return;
    if (!chatQuery.data?.chat?.openerPending) return;
    if ((chatQuery.data?.messages?.length ?? 0) > 0) return;
    if (streamHandle) return;
    if (openerFiredForChatRef.current === activeChatId) return;
    openerFiredForChatRef.current = activeChatId;
    void startOpener.mutateAsync({ chatId: activeChatId, reasoning }).catch(() => {
      // Rejection is expected on initial-generation failure — the notice +
      // Retry below surface it; openerPending stays set for the next open.
    });
  }, [
    isLazy,
    activeChatId,
    chatQuery.data?.chat?.openerPending,
    chatQuery.data?.messages?.length,
    streamHandle,
    startOpener,
    reasoning,
  ]);

  // Token estimate for the context gauge and the out-of-window marker.
  const { usedTokens, systemTokens } = useMemo(() => {
    if (!offering || !effectivePersona || !settingsQuery.data)
      return { usedTokens: 0, systemTokens: 0 };
    // Guard against personas with empty instructions — buildPrompt throws on empty.
    if (!effectivePersona.instructions.trim()) return { usedTokens: 0, systemTokens: 0 };
    const sys = buildPrompt(
      {
        tonalityEnabled: effectivePersona.chatsundereTonality,
        nsfwEnabled: effectivePersona.adultPersona,
        roleplayEnabled: effectivePersona.roleplay,
        narration: effectivePersona.narration,
        personaName: effectivePersona.name,
        globalInstructions: settingsQuery.data.globalInstructions,
        aboutMe: effectivePersona.aboutMeOverride?.trim()
          ? effectivePersona.aboutMeOverride
          : settingsQuery.data.globalAboutMe,
        personaInstructions: effectivePersona.instructions,
        projectInstructions: '',
        memoryContext: '',
        toolsInstruction: '',
        modelInstructions: resolveModelInstructions(offering),
        // Mirror the real send so the context gauge counts the same prompt.
        screenEffectsEnabled: settingsQuery.data.screenEffectsEnabled ?? true,
      },
      'chat',
    );
    // Openers never reach the wire (isContextMessage), so they don't count here.
    const msgTexts = (chatQuery.data?.messages ?? []).filter(isContextMessage).map((m) =>
      m.contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    );
    return { usedTokens: estimateTokens([sys, ...msgTexts]), systemTokens: estimateTokens(sys) };
  }, [offering, effectivePersona, settingsQuery.data, chatQuery.data?.messages]);

  const contextBudget = useMemo(
    () =>
      offering && effectivePersona ? resolveContextWindow(effectivePersona, offering) : undefined,
    [offering, effectivePersona],
  );

  // Compaction precondition: message count + token floor both met.
  const messageCount = (chatQuery.data?.messages ?? []).filter(isContextMessage).length;
  const compactable = isCompactable(messageCount, usedTokens);

  // 80 % actionable toast — once per chat, never during live voice.
  // Uses chatQuery.data?.chat directly (not the `chat` alias below) because
  // this effect is placed before that alias is declared.
  const activeChat = chatQuery.data?.chat ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: qc and setShowCompactConfirm are stable references; activeChat covers compactionToastShown
  useEffect(() => {
    if (!activeChatId || !activeChat || !contextBudget || isLiveVoice) return;
    const fillPct = contextUtilisation(usedTokens, contextBudget);
    if (!shouldShowToast(fillPct, activeChat.compactionToastShown ?? false, compactable)) return;
    void markCompactionToastShown(activeChatId);
    void qc.invalidateQueries({ queryKey: QK.chat(activeChatId) });
    toastStore.show({
      message: 'This conversation is getting long. Compact it to keep it sharp?',
      tone: 'info',
      durationMs: 9000,
      action: { label: 'Compact', onClick: () => setShowCompactConfirm(true) },
    });
  }, [usedTokens, activeChat, contextBudget, activeChatId, compactable, isLiveVoice]);

  // Reading-mode Enter hotkey: a bare Enter (no modifiers) opens the cockpit
  // and re-anchors to the latest message — symmetrical to Enter-to-send once
  // you're composing. Ignored while already in interaction mode, while any
  // other field/editable is focused (chat-title rename, etc.), and when there
  // is no persona to compose to. The cockpit's autoFocus lands the caret.
  useEffect(() => {
    if (isInteractionMode || !effectivePersona) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setAutoFollow(true);
      setInteractionMode(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isInteractionMode, effectivePersona, setAutoFollow, setInteractionMode]);

  const onRegenerate = (): void => {
    if (!activeChatId) return;
    void regenerate.mutateAsync({ chatId: activeChatId, reasoning });
  };

  const onConfirmCompact = async (): Promise<void> => {
    if (!activeChatId) return;
    setIsCompacting(true);
    try {
      await compactNow(activeChatId);
      await qc.invalidateQueries({ queryKey: QK.chat(activeChatId) });
      await qc.invalidateQueries({ queryKey: QK.compaction(activeChatId) });
      setShowCompactConfirm(false);
      toastStore.show({ message: 'Conversation compacted.', tone: 'success', durationMs: 5000 });
    } catch {
      toastStore.show({
        message: "Couldn't compact just now — please try again.",
        tone: 'warn',
        durationMs: 7000,
      });
    } finally {
      setIsCompacting(false);
    }
  };

  const onConfirmBranch = async (title: string): Promise<void> => {
    if (!activeChatId || !branchPointId) return;
    const newChatId = await branchChat.mutateAsync({
      sourceChatId: activeChatId,
      branchPointMessageId: branchPointId,
      title,
    });
    setBranchPointId(null);
    navigate(`/app/chat/${newChatId}`);
  };

  const onRenameChat = (next: string | null): void => {
    if (!chatId) return;
    void updateChat.mutateAsync({ id: chatId, patch: { title: next } });
  };

  const onExitToEntranceHall = (): void => {
    setInteractionMode(false);
    navigate('/app');
  };

  const onOpenPersonaEditor = (): void => {
    if (!effectivePersona) return;
    const returnUrl = `${location.pathname}${location.search}`;
    navigate(`/app/persona/${effectivePersona.id}?return=${encodeURIComponent(returnUrl)}`);
  };

  const chat = chatQuery.data?.chat ?? null;
  const messages = chatQuery.data?.messages ?? [];
  const pills = chatQuery.data?.pills ?? [];
  const hasMessages = messages.length > 0;

  // ---- Mild message editing (spec 2026-07-18) ----
  // The edit target lives on the ChatRow (device-local, never synced); whether
  // Replace-in-place is offered is re-derived live from the current message
  // list every render, so a cross-device continuation correctly downgrades an
  // in-progress edit to branch-only (spec §6). editAttachments composes the
  // surviving originals with this chat's pending additions.
  const editingMessageId = chat?.editingMessageId ?? null;
  const canReplace = editingMessageId ? canReplaceInPlace(messages, editingMessageId) : false;
  const { data: editAttachments = [] } = useEditAttachments(
    activeChatId ?? '',
    editingMessageId,
    editStagedRemovals,
  );
  const editOrchestration = buildEditOrchestration({
    activeChatId,
    personaId: effectivePersona?.id ?? null,
    editingMessageId,
    draft,
    reasoning,
    editStagedRemovals,
    setDraft,
    resetEditSession,
    clearPendingAttachments,
    updateChat,
    editAndReplace,
    editAndBranch,
    navigate,
  });
  const enterEdit = editOrchestration.enterEdit;
  const cancelEdit = editOrchestration.cancelEdit;
  const onReplace = editOrchestration.onReplace;
  const onBranchEdit = editOrchestration.onBranchEdit;

  // Single send chokepoint (Laura HARD fix, spec 2026-07-18): every send
  // trigger — desktop Enter/Ctrl+Enter (via Cockpit's onInputKeyDown), the
  // touch DualActionBtn, dictation finishing, and live-voice finishing — all
  // funnel through this one `onSend`. While an edit is in progress it must
  // commit the same action the EditSendButton primary would (Replace when
  // still reachable, else Branch) rather than appending a new message while
  // `editingMessageId` stays set. Routing the decision through one function
  // guarantees the keyboard and voice paths cannot drift out of sync again.
  const onSend = async (text: string): Promise<void> => {
    const action = resolveSendAction(editingMessageId, canReplace);
    if (action === 'replace') {
      await onReplace();
      return;
    }
    if (action === 'branch') {
      await onBranchEdit();
      return;
    }
    if (!effectivePersona) return;
    const newChatId = await sendMessage.mutateAsync({
      chatId: activeChatId,
      personaId: effectivePersona.id,
      text,
      reasoning,
    });
    setDraft('');
    if (isLazy && personaIdFromQuery) clearLazyDraft(personaIdFromQuery);
    if (isLazy && newChatId && newChatId !== activeChatId) {
      navigate(`/app/chat/${newChatId}`, { replace: true });
    }
  };

  // ---- Context pre-seeding (seed templates) ----
  // A real user message is one the person actually sent (seed body turns carry a
  // seedRole and do not count). Once one exists, the seed block locks.
  const seedTemplatesQuery = useFilteredSeedTemplates();
  const hasSeed = messages.some((m) => m.kind === 'seed');
  const hasRealUserMessage = messages.some((m) => m.role === 'user' && !m.seedRole);
  const seedTemplatesAvailable = (seedTemplatesQuery.data ?? []).length > 0;
  // Whether the persona owns an auto-opener — used to keep the opener and a seed
  // greeting mutually exclusive (they are both wire-excluded "openings").
  const personaHasOpener = !!effectivePersona?.roleplay && !!effectivePersona?.greetingEnabled;

  /** Apply a template into this chat: ensure a chat exists, replace any prior
   *  seed block, materialise the template's rows, and — when the template carries
   *  its own greeting — take over the persona's opening (delete any auto-opener
   *  already streamed and inhibit a future one). */
  const applyTemplate = async (template: SeedTemplateRow): Promise<void> => {
    if (!effectivePersona) return;
    setSeedPickerOpen(false);
    const db = getClientDataDb();
    let targetChatId = activeChatId;
    if (!targetChatId) {
      targetChatId = await createChat.mutateAsync({
        personaId: effectivePersona.id,
        draftInput: isLazy && personaIdFromQuery ? loadLazyDraft(personaIdFromQuery) : '',
      });
      if (isLazy && personaIdFromQuery) clearLazyDraft(personaIdFromQuery);
    }
    const hasGreeting = (template.greeting ?? '').trim().length > 0;
    // Replace semantics: drop existing seed rows; a greeting template also takes
    // over the opening, so drop any auto-opener message too (they would otherwise
    // both show as greetings).
    const stale = await db.messages
      .where('chatId')
      .equals(targetChatId)
      .filter((m) => m.kind === 'seed' || (hasGreeting && m.kind === 'opener'))
      .primaryKeys();
    if (stale.length > 0) await db.messages.bulkDelete(stale);
    await db.messages.bulkAdd(materialiseSeed(template, targetChatId));
    // A template greeting stands in for the persona opener — inhibit it.
    if (hasGreeting) {
      await updateChat.mutateAsync({ id: targetChatId, patch: { openerPending: false } });
    }
    await qc.invalidateQueries({ queryKey: QK.chat(targetChatId) });
    await qc.invalidateQueries({ queryKey: QK.chats });
    if (targetChatId !== activeChatId) {
      navigate(`/app/chat/${targetChatId}`, { replace: true });
    }
  };

  /** Remove the whole seed block while no real message exists yet, restoring the
   *  persona's natural opener when applying had suppressed it. */
  const removeSeed = async (): Promise<void> => {
    if (!activeChatId || hasRealUserMessage) return;
    const db = getClientDataDb();
    const seedKeys = await db.messages
      .where('chatId')
      .equals(activeChatId)
      .filter((m) => m.kind === 'seed')
      .primaryKeys();
    if (seedKeys.length > 0) await db.messages.bulkDelete(seedKeys);
    // Re-arm the opener for a greeting persona — the auto-opener effect re-fires
    // once the chat is empty again (it no-ops if an opener already exists).
    if (personaHasOpener) {
      await updateChat.mutateAsync({ id: activeChatId, patch: { openerPending: true } });
    }
    await qc.invalidateQueries({ queryKey: QK.chat(activeChatId) });
  };

  // Voice playback. Owns one machine actor + AudioSink for this chat view; the
  // persistent transport (rendered below) governs an in-flight read-aloud
  // independently of message expansion, scrolling, and Reading↔Interaction mode.
  // forceStreamingRead = isLiveVoice: in live voice every reply is read aloud as
  // it streams (the persona's floor), independent of the auto-read toggle.
  const voice = useVoicePlayback(activeChatId ?? '', effectivePersona, messages, isLiveVoice);

  const monologue = useMonologuePlayback(effectivePersona, () => voice.stop());
  const monologueActive = monologue.activeId !== null;
  const monologueController = useMemo(
    () => ({
      read: (id: string, trace: string) => void monologue.read(id, trace),
      activeId: monologue.activeId,
      disabledReason: monologue.disabledReason,
      suppressedReason: isLiveVoice ? ('live-voice' as const) : null,
    }),
    [monologue.read, monologue.activeId, monologue.disabledReason, isLiveVoice],
  );

  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const autoReadAloud = settings.data?.autoReadAloud ?? false;
  const onToggleAutoRead = useCallback(
    (next: boolean) => void updateSettings.mutateAsync({ autoReadAloud: next }),
    [updateSettings],
  );
  const voiceUnavailable = voice.disabledReason;
  // "Leave" is the one holistic voice-surface exit: stop this playback and, if
  // auto-read is armed, turn it off too. This is what makes the toolbar the
  // single context-correct escape — and what retires the old Stop-vs-toggle hint.
  const onExitVoice = useCallback(() => {
    voice.stop();
    if (autoReadAloud) void onToggleAutoRead(false);
  }, [voice, autoReadAloud, onToggleAutoRead]);

  const liveVoice = useLiveVoice({
    onSend: (t) => void onSend(t),
    voice,
    // Barge / floor-reclaim aborts the in-flight reply for this chat (the
    // partial is preserved); a no-op once generation has finished.
    abortReply: () => {
      void useStreamManagerStore.getState().abortPreserve(activeChatId ?? '');
    },
    // The persona-floor bridge reads this to tell "awaiting first audio" apart
    // from "the reply finished with nothing speakable".
    replyStreaming: isStreamLive,
    sensitivity: settings.data?.dictationSensitivity ?? 'medium',
    redemptionMs: settings.data?.dictationRedemptionMs ?? REDEMPTION_MS_DEFAULT,
  });

  const onEnterLiveVoice = useCallback(() => {
    setLiveVoice(true);
    liveVoice.enter();
  }, [setLiveVoice, liveVoice]);

  const onExitLiveVoice = useCallback(() => {
    liveVoice.exit();
    setLiveVoice(false);
  }, [setLiveVoice, liveVoice]);

  // While live + pinned, a focused composer must not also feed the mic.
  useEffect(() => {
    if (isLiveVoice && isPinned && inputFocused) liveVoice.hold();
  }, [isLiveVoice, isPinned, inputFocused, liveVoice]);

  // Stop any in-flight inner-monologue when live voice starts — two audio paths must not overlap.
  useEffect(() => {
    if (isLiveVoice) monologue.stop();
  }, [isLiveVoice, monologue.stop]);

  // Symmetric to the monologue's onStart (which stops read-aloud): when read-aloud
  // becomes active, stop any in-flight inner monologue — one voice at a time.
  useEffect(() => {
    if (voice.currentMessageId !== null) monologue.stop();
  }, [voice.currentMessageId, monologue.stop]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot teardown per chat id
  useEffect(() => {
    return () => {
      if (useCurrentChatStore.getState().isLiveVoice) {
        liveVoice.exit();
        setLiveVoice(false);
      }
    };
  }, [activeChatId]);

  // Dictation. Transcripts always append at the END of the current draft
  // (spec §3.3); the functional setter means a late-arriving transcript never
  // clobbers concurrent typing, and the append flows through the same `draft`
  // state — and thus the same debounced persistence effect — as a typed change.
  const dictation = useDictation({
    onTranscript: (text) =>
      setDraft((d) => (d.trim().length > 0 ? `${d.trimEnd()} ${text}` : text)),
    onSend: (text) => void onSend(text),
    isStreamLive,
    stopPlayback: voice.stop,
    // Interaction Mode can collapse without unmounting this page (outside tap
    // while unpinned, ToC jump) — dictation must not keep a hot mic behind a
    // vanished cockpit, so the hook LEAVEs whenever this flips false.
    active: isInteractionMode,
  });
  const resumeParagraphLabel =
    voice.resumeOffer !== null ? `¶${voice.resumeOffer.paragraphIndex + 1}` : null;

  // Artefact hooks — keyed to the active chat (non-null when chat-mode).
  const { data: chatArtefacts = [] } = useChatArtefacts(activeChatId ?? '');
  const renameArtefact = useRenameArtefact(activeChatId ?? '');
  const editArtefactContent = useUpdateArtefactContent(activeChatId ?? '');
  const removeArtefact = useDeleteArtefact(activeChatId ?? '');
  const setArtefactTags = useSetArtefactTags();
  const artefactItems = chatArtefacts.map(artefactToViewable);
  const artefactIndex = openArtefactId
    ? artefactItems.findIndex((item) => item.id === openArtefactId)
    : -1;

  const focusId = search.get('focus');
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot per focusId once messages are present
  useEffect(() => {
    if (!focusId || messages.length === 0) return;
    jumpToMessage(focusId);
    const next = new URLSearchParams(search);
    next.delete('focus');
    setSearchParams(next, { replace: true });
  }, [focusId, messages.length]);

  return (
    <div
      className="chat-page"
      data-mode={isInteractionMode ? 'interaction' : 'reading'}
      style={
        {
          '--chat-font-scale': chatFontScaleValue(settings.data?.chatFontScale),
        } as React.CSSProperties
      }
    >
      <SpectrumAnalyser
        transportState={monologueActive ? monologue.transportState : voice.transportState}
        getAnalyser={monologueActive ? monologue.getAnalyser : voice.getAnalyser}
        isAudible={monologueActive ? monologue.isAudible : voice.getIsAudible}
        personaThinking={isLiveVoice && liveVoice.floor === 'personaThinking'}
      />
      <SyncTombstoneBreadcrumb />
      {!hasMessages && !isStreamLive && effectivePersona ? (
        <PersonaGreeting
          name={effectivePersona.name}
          font={effectivePersona.font}
          colour={effectivePersona.colour}
          notice={
            startOpener.isError
              ? `${effectivePersona.name} couldn't compose the greeting`
              : undefined
          }
          onRetry={
            startOpener.isError && activeChatId
              ? () => {
                  void startOpener.mutateAsync({ chatId: activeChatId, reasoning }).catch(() => {});
                }
              : undefined
          }
        />
      ) : activeChatId ? (
        <ChatStream
          chatId={activeChatId}
          messages={messages}
          pills={pills}
          persona={effectivePersona}
          displayName={displayName}
          streamHandle={streamHandle}
          contextBudget={contextBudget}
          systemTokens={systemTokens}
          onRegenerate={onRegenerate}
          onBranch={(messageId) => {
            branchChat.reset();
            setBranchPointId(messageId);
          }}
          branchDisabled={isStreamLive}
          onEdit={(m) => {
            // Editing must always surface the composer — otherwise pressing Edit
            // from reading mode sets the target but leaves the cockpit closed.
            setInteractionMode(true);
            void enterEdit(m);
          }}
          onReadAloud={(message) => void voice.playMessage(message)}
          voiceDisabledReason={voice.disabledReason}
          voiceMode={settingsQuery.data?.voiceMode ?? 'paragraph'}
          currentSegmentId={voice.currentSegmentId}
          currentMessageId={voice.currentMessageId}
          monologue={monologueController}
        />
      ) : null}

      {/* Seed-template affordance — a quiet control near the composer, outside
          the primary type-here path. Available only before the first real
          message; once the chat has begun the remove control LOCKS with a
          reason (rather than vanishing) so the transition is visible. The locked
          branch is keyed on a real message (not on persona-still-resolving), so
          an empty seeded chat never briefly reads as "locked". */}
      {hasSeed && hasRealUserMessage ? (
        <div className="mx-auto mt-1 flex w-full max-w-prose items-center gap-2 px-4 text-[11px] text-paper-soft">
          <button
            type="button"
            disabled
            aria-disabled
            className="cursor-not-allowed rounded-md border border-white/5 px-2.5 py-1 opacity-50"
          >
            Remove primer
          </button>
          <span>Locked — the conversation has begun.</span>
        </div>
      ) : effectivePersona && !hasRealUserMessage ? (
        <div className="mx-auto mt-1 flex w-full max-w-prose flex-wrap items-center gap-2 px-4 text-[11px] text-paper-soft">
          {!hasSeed && seedTemplatesAvailable ? (
            <button
              type="button"
              onClick={() => setSeedPickerOpen(true)}
              className="rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1 text-paper-soft transition-colors hover:border-paper-soft/50 hover:text-paper"
            >
              Seed from template
            </button>
          ) : null}
          {hasSeed ? (
            <button
              type="button"
              onClick={() => void removeSeed()}
              className="rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1 text-paper-soft transition-colors hover:border-paper-soft/50 hover:text-paper"
            >
              Remove primer
            </button>
          ) : null}
        </div>
      ) : null}

      {(() => {
        const last = messages[messages.length - 1];
        if (!last || last.streamingState !== 'incomplete') return null;
        // The streamingState schema is binary: 'incomplete' covers both
        // *active streaming* and *interrupted-needs-recovery*. The footer
        // is for the recovery case only — suppress it while a stream is
        // actually live for this chat.
        if (isStreamLive) return null;
        return (
          <StreamInterruptedFooter
            disabled={isStreamLive}
            retryDisabled={class2Gate.disabled}
            retryDisabledReason={class2Gate.tooltip ?? undefined}
            failureKind={last.failureKind}
            onShowDiagnostics={diagnosticsReport ? () => setDiagOpen(true) : undefined}
            onRetry={async () => {
              // activeChatId is non-null whenever messages exist (chat-mode only).
              if (!activeChatId) return;
              const db = getClientDataDb();
              const allMsgs = await db.messages
                .where('chatId')
                .equals(activeChatId)
                .sortBy('createdAt');
              const incomplete = allMsgs.find((m) => m.id === last.id);
              const priorUser = [...allMsgs]
                .reverse()
                .find(
                  (m) =>
                    m.role === 'user' &&
                    m.createdAt < (incomplete?.createdAt ?? Number.POSITIVE_INFINITY),
                );
              if (!priorUser) {
                // No user turn to replay — this is an opener-only chat whose
                // greeting was stopped/interrupted. Re-roll the greeting in
                // place; useRegenerate's opener branch reuses the existing row
                // (so do NOT delete it first).
                await regenerate.mutateAsync({ chatId: activeChatId, reasoning });
                return;
              }
              if (incomplete) await db.messages.delete(incomplete.id);
              if (effectivePersona) {
                const text = priorUser.contentBlocks
                  .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                  .map((b) => b.text)
                  .join('');
                // Delete the prior user-message too so useSendMessage's insert
                // doesn't duplicate it. It is a completed (synced) message, so this
                // is a Class-2 delete — a tombstone follows on other devices.
                await mutateSynced({
                  collection: 'messages',
                  key: priorUser.id,
                  op: 'delete',
                  tables: ['messages'],
                  write: async (tx) => {
                    await tx.table('messages').delete(priorUser.id);
                  },
                });
                await qc.invalidateQueries({ queryKey: ['chats', activeChatId] });
                await sendMessage.mutateAsync({
                  chatId: activeChatId,
                  personaId: effectivePersona.id,
                  text,
                  reasoning,
                });
              } else {
                await qc.invalidateQueries({ queryKey: ['chats', activeChatId] });
              }
            }}
            onDiscard={async () => {
              await getClientDataDb().messages.delete(last.id);
              await qc.invalidateQueries({ queryKey: ['chats', activeChatId] });
            }}
          />
        );
      })()}

      {/*
        BottomAffordance is the "open the cockpit" cue — always visible in
        reading mode so the user can re-engage regardless of scroll
        position. Decoupling it from autoFollowEnabled also avoids a
        ResizeObserver race: when the affordance unmounted on scroll-up,
        chat-stream's clientHeight grew, the RO fired, and a stale
        autoFollowRef occasionally snapped the scroll back to the bottom.
        ScrollToEnd (rendered inside ChatStream) handles the "back to
        latest" intent separately.

        Shown whenever the cockpit is closed — including an empty chat with no
        messages (History "continue" on an unused chat, or a lazy chat whose
        cockpit was unpinned and dismissed). Gating this on hasMessages stranded
        those states: no messages means no keyboard Enter hotkey path on touch,
        so the affordance is the only way back into the composer.
      */}
      {!isInteractionMode ? (
        <BottomAffordance
          onTap={() => {
            // Tap on the affordance both opens the cockpit and re-anchors
            // to the latest message — "you reply from the bottom".
            setAutoFollow(true);
            setInteractionMode(true);
          }}
        />
      ) : null}

      {/*
        The audio toolbar. A space-reserving flex-child of .chat-page (order
        998), so .chat-stream gives up height for it instead of being
        overlapped, and it stacks above the cockpit in interaction mode. Visible
        whenever a voice session is active (playing, auto-read armed, or a resume
        offer); renders nothing otherwise. The space and cockpit-independence are
        the foundation for the cockpitless live-voice mode (Spec 3).
      */}
      {isLiveVoice ? (
        <LiveVoiceBar
          floor={liveVoice.floor}
          fill={liveVoice.fill}
          level={liveVoice.level}
          onHold={liveVoice.hold}
          onResume={liveVoice.resume}
          onSkip={voice.skip}
          onExit={onExitLiveVoice}
          onPressStart={liveVoice.pressStart}
          onPressEnd={liveVoice.pressEnd}
          onTap={liveVoice.tap}
        />
      ) : monologueActive ? (
        <VoiceTransport
          mode="monologue"
          state={monologue.transportState}
          resumeOffer={null}
          providerSkips={0}
          autoReadOn={false}
          voiceUnavailable={null}
          onPause={monologue.pause}
          onResume={monologue.resume}
          onSkip={() => undefined}
          onRetry={() => undefined}
          onResumePlayback={() => undefined}
          onStartOver={() => undefined}
          onDismiss={monologue.stop}
          onExitVoice={monologue.stop}
        />
      ) : (
        <VoiceTransport
          state={voice.transportState}
          resumeOffer={resumeParagraphLabel ? { paragraphLabel: resumeParagraphLabel } : null}
          providerSkips={voice.providerSkips}
          autoReadOn={autoReadAloud}
          voiceUnavailable={voiceUnavailable}
          onPause={voice.pause}
          onResume={voice.resumeAudio}
          onSkip={voice.skip}
          onRetry={voice.retry}
          onResumePlayback={voice.resume}
          onStartOver={voice.startOver}
          onDismiss={voice.dismissPartial}
          onExitVoice={onExitVoice}
        />
      )}

      {pickerOpen ? (
        <ArtefactPicker
          chatId={chat?.id ?? activeChatId ?? ''}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {documentPickerOpen ? (
        <DocumentPicker
          chatId={chat?.id ?? activeChatId ?? ''}
          onClose={() => setDocumentPickerOpen(false)}
        />
      ) : null}

      {openArtefactId !== null && artefactIndex >= 0 ? (
        <Lightbox
          items={artefactItems}
          index={artefactIndex}
          getOriginRect={(id) =>
            document
              .querySelector<HTMLElement>(`[data-artefact-pill="${CSS.escape(id)}"]`)
              ?.getBoundingClientRect() ?? null
          }
          tagSuggestions={collectTags(chatArtefacts)}
          onSetTags={(id, tags) => setArtefactTags.mutate({ id, tags })}
          onRename={(id, patch) => renameArtefact.mutate({ id, patch })}
          onRemove={() => {}}
          onEditText={(id, text) => editArtefactContent.mutate({ id, content: text })}
          onDelete={(id) => {
            removeArtefact.mutate(id);
            closeArtefact();
          }}
          onClose={closeArtefact}
        />
      ) : null}

      {branchPointId ? (
        <BranchSheet
          onConfirm={(title) => {
            // Swallow the rejection for the unhandled-promise lint only — the
            // failure is captured in branchChat.isError and surfaced below.
            void onConfirmBranch(title).catch(() => {});
          }}
          onClose={() => {
            setBranchPointId(null);
            branchChat.reset();
          }}
          error={branchChat.isError ? 'Could not branch — please try again.' : undefined}
        />
      ) : null}

      <SeedTemplatePicker
        open={seedPickerOpen}
        onClose={() => setSeedPickerOpen(false)}
        onSelect={(t) => void applyTemplate(t)}
      />

      {/*
        DimOverlay lives here, always mounted, rather than inside
        InteractionMode. Driven by `isInteractionMode && inputFocused`, it
        keeps darkening the chat behind a focused cockpit — but because it
        outlives InteractionMode's unmount-on-close, the un-dim transition
        actually runs (opacity 1→0 over 200ms) instead of the overlay
        vanishing instantly when the cockpit closes.

        Suppressed while pinned: a pinned cockpit means the user is set on full
        interaction, so the chat stays bright (the dimming is the zen-mode
        affordance of the unpinned, read-heavy cockpit).
      */}
      <DimOverlay active={isInteractionMode && inputFocused && !isPinned} />

      {/* MCP tool-call approval — explicit modal, not tap-to-dismiss; z-50 renders above the cockpit */}
      <McpApprovalPrompt />

      {isInteractionMode && effectivePersona && (!isLiveVoice || isPinned) ? (
        <InteractionMode
          persona={effectivePersona}
          chatId={chat?.id ?? activeChatId ?? ''}
          chat={chat}
          offering={offering}
          usedTokens={usedTokens}
          draftValue={draft}
          onDraftChange={setDraft}
          onSend={(t) => void onSend(t)}
          editingMessageId={editingMessageId}
          canReplace={canReplace}
          editAttachments={editAttachments}
          onReplace={() => void onReplace()}
          onBranchEdit={() => void onBranchEdit()}
          onCancelEdit={() => void cancelEdit()}
          onStop={() =>
            void useStreamManagerStore.getState().abortPreserve(chat?.id ?? activeChatId ?? '')
          }
          isStreamLive={isStreamLive}
          onExit={onExitToEntranceHall}
          onRenameChat={onRenameChat}
          onOpenPersonaEditor={onOpenPersonaEditor}
          onAttachFromTreasury={() => setPickerOpen(true)}
          onAttachFromLibrary={() => setDocumentPickerOpen(true)}
          dictation={dictation}
          autoReadAloud={autoReadAloud}
          onToggleAutoRead={onToggleAutoRead}
          voiceUnavailable={voiceUnavailable}
          onEnterLiveVoice={onEnterLiveVoice}
          compactable={compactable}
          onCompact={() => setShowCompactConfirm(true)}
        />
      ) : null}

      {showCompactConfirm ? (
        <CompactConfirmCard
          busy={isCompacting}
          onConfirm={() => void onConfirmCompact()}
          onCancel={() => setShowCompactConfirm(false)}
        />
      ) : null}

      {compactingState === 'blocking' ? <CompactingOverlay /> : null}

      {diagnosticsReport ? (
        <PickerOverlay open={diagOpen} title="Diagnostics" onClose={() => setDiagOpen(false)}>
          <div className="p-4">
            <ModelDebugReport report={diagnosticsReport} />
          </div>
        </PickerOverlay>
      ) : null}
    </div>
  );
}
