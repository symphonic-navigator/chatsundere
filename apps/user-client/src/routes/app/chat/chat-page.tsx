import { composeSystemPrompt, getOffering } from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PersonaRow } from '../../../boot/client-data-db.js';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { BottomAffordance } from '../../../components/chat/BottomAffordance.js';
import { ChatStream } from '../../../components/chat/ChatStream.js';
import { InteractionMode } from '../../../components/chat/InteractionMode.js';
import { PersonaGreeting } from '../../../components/chat/PersonaGreeting.js';
import { StreamInterruptedFooter } from '../../../components/chat/StreamInterruptedFooter.js';
import { useChat, useUpdateChat } from '../../../data/chats.js';
import { useMindspaces } from '../../../data/mindspaces.js';
import { useRegenerate, useSendMessage } from '../../../data/send-message.js';
import { useDisplayName } from '../../../data/settings.js';
import { clearLazyDraft, loadLazyDraft, saveLazyDraft } from '../../../lib/cockpit-draft.js';
import { initialReasoningState } from '../../../lib/reasoning-resolver.js';
import { estimateTokens } from '../../../lib/token-estimator.js';
import { useCurrentChatStore } from '../../../state/current-chat.store.js';
import { useMindspaceStore } from '../../../state/mindspace.store.js';
import { useStreamManagerStore } from '../../../state/stream-manager.store.js';

const DRAFT_DEBOUNCE_MS = 250;

export function ChatPage(): JSX.Element {
  const { chatId } = useParams<{ chatId?: string }>();
  const [search] = useSearchParams();
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

  const setChatId = useCurrentChatStore((s) => s.setChatId);
  const setLazy = useCurrentChatStore((s) => s.setLazy);
  const setInteractionMode = useCurrentChatStore((s) => s.setInteractionMode);
  const togglePin = useCurrentChatStore((s) => s.togglePin);
  const isInteractionMode = useCurrentChatStore((s) => s.isInteractionMode);
  const setAutoFollow = useCurrentChatStore((s) => s.setAutoFollow);
  const setReasoning = useCurrentChatStore((s) => s.setReasoning);
  const reasoning = useCurrentChatStore((s) => s.reasoning);

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
      setInteractionMode(true);
      // Pin on mount — idempotent guard avoids double-toggle on strict-mode re-renders.
      if (!useCurrentChatStore.getState().isPinned) togglePin();
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

  // Resolve Offering via provider lookup keyed to the effective persona.
  const modelQuery = useQuery({
    queryKey: ['offering-for-persona', effectivePersona?.id],
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
  useEffect(() => {
    if (isLazy) {
      if (!personaIdFromQuery) return;
      const t = setTimeout(() => saveLazyDraft(personaIdFromQuery, draft), DRAFT_DEBOUNCE_MS);
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
  const isStreamLive = !!streamHandle;

  // Token estimate for the context gauge.
  const usedTokens = useMemo(() => {
    if (!offering || !effectivePersona || !settingsQuery.data) return 0;
    // Guard against personas with empty instructions — composeSystemPrompt throws on empty.
    if (!effectivePersona.instructions.trim()) return 0;
    const sys = composeSystemPrompt({
      globalUnlocker: settingsQuery.data.globalUnlockerPrompt,
      aboutMe: settingsQuery.data.globalAboutMe,
      personaInstructions: effectivePersona.instructions,
      projectInstructions: '',
      memoryContext: '',
    });
    const msgTexts = (chatQuery.data?.messages ?? []).map((m) =>
      m.contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(''),
    );
    return estimateTokens([sys, ...msgTexts]);
  }, [offering, effectivePersona, settingsQuery.data, chatQuery.data?.messages]);

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

  const onSend = async (text: string): Promise<void> => {
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

  return (
    <div className="chat-page" data-mode={isInteractionMode ? 'interaction' : 'reading'}>
      {isLazy && !hasMessages && effectivePersona ? (
        <PersonaGreeting
          name={effectivePersona.name}
          font={effectivePersona.font}
          colour={effectivePersona.colour}
        />
      ) : activeChatId ? (
        <ChatStream
          chatId={activeChatId}
          messages={messages}
          pills={pills}
          persona={effectivePersona}
          displayName={displayName}
          streamHandle={streamHandle}
          onRegenerate={onRegenerate}
        />
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
              if (incomplete) await db.messages.delete(incomplete.id);
              if (priorUser && effectivePersona) {
                const text = priorUser.contentBlocks
                  .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                  .map((b) => b.text)
                  .join('');
                // Delete the prior user-message too so useSendMessage's insert doesn't duplicate it.
                await db.messages.delete(priorUser.id);
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
      */}
      {!isInteractionMode && hasMessages ? (
        <BottomAffordance
          onTap={() => {
            // Tap on the affordance both opens the cockpit and re-anchors
            // to the latest message — "you reply from the bottom".
            setAutoFollow(true);
            setInteractionMode(true);
          }}
        />
      ) : null}

      {isInteractionMode && effectivePersona && offering ? (
        <InteractionMode
          persona={effectivePersona}
          chat={chat}
          offering={offering}
          usedTokens={usedTokens}
          draftValue={draft}
          onDraftChange={setDraft}
          onSend={(t) => void onSend(t)}
          isStreamLive={isStreamLive}
          onExit={onExitToEntranceHall}
          onRenameChat={onRenameChat}
          onOpenPersonaEditor={onOpenPersonaEditor}
        />
      ) : null}
    </div>
  );
}
