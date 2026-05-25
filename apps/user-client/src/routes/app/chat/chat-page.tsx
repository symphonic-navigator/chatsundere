import { composeSystemPrompt, getProvider } from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PersonaRow } from '../../../boot/client-data-db.js';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { BottomAffordance } from '../../../components/chat/BottomAffordance.js';
import { ChatStream } from '../../../components/chat/ChatStream.js';
import { InteractionMode } from '../../../components/chat/InteractionMode.js';
import { PersonaGreeting } from '../../../components/chat/PersonaGreeting.js';
import { StreamInterruptedFooter } from '../../../components/chat/StreamInterruptedFooter.js';
import { useChat, useUpdateChat } from '../../../data/chats.js';
import { useSendMessage } from '../../../data/send-message.js';
import { useDisplayName } from '../../../data/settings.js';
import { clearLazyDraft, loadLazyDraft, saveLazyDraft } from '../../../lib/cockpit-draft.js';
import { initialReasoningState } from '../../../lib/reasoning-resolver.js';
import { estimateTokens } from '../../../lib/token-estimator.js';
import { useCurrentChatStore } from '../../../state/current-chat.store.js';
import { useStreamManagerStore } from '../../../state/stream-manager.store.js';

const DRAFT_DEBOUNCE_MS = 250;

export function ChatPage(): JSX.Element {
  const { chatId } = useParams<{ chatId?: string }>();
  const [search] = useSearchParams();
  const personaIdFromQuery = search.get('personaId');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isLazy = !chatId;
  const activeChatId = chatId ?? null;

  const chatQuery = useChat(activeChatId);
  const sendMessage = useSendMessage();
  const updateChat = useUpdateChat();

  const setChatId = useCurrentChatStore((s) => s.setChatId);
  const setLazy = useCurrentChatStore((s) => s.setLazy);
  const setInteractionMode = useCurrentChatStore((s) => s.setInteractionMode);
  const togglePin = useCurrentChatStore((s) => s.togglePin);
  const isInteractionMode = useCurrentChatStore((s) => s.isInteractionMode);
  const autoFollowEnabled = useCurrentChatStore((s) => s.autoFollowEnabled);
  const setAutoFollow = useCurrentChatStore((s) => s.setAutoFollow);
  const setReasoning = useCurrentChatStore((s) => s.setReasoning);
  const reasoning = useCurrentChatStore((s) => s.reasoning);

  // Sync store with route. Mount auto-opens Interaction Mode in lazy mode + pins cockpit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally one-shot per chatId/personaId — store setters are stable Zustand references that do not need to be in the dep array
  useEffect(() => {
    if (isLazy && personaIdFromQuery) {
      setLazy(personaIdFromQuery);
      setInteractionMode(true);
      // Pin on mount — idempotent guard avoids double-toggle on strict-mode re-renders.
      if (!useCurrentChatStore.getState().isPinned) togglePin();
    } else if (chatId) {
      setChatId(chatId);
    }
  }, [chatId, personaIdFromQuery]);

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

  // Resolve KnownModel via provider lookup keyed to the effective persona.
  const modelQuery = useQuery({
    queryKey: ['known-model-for-persona', effectivePersona?.id],
    enabled: !!effectivePersona,
    queryFn: async () => {
      if (!effectivePersona) return null;
      const provider = await getClientDataDb().providers.get(effectivePersona.providerId);
      if (!provider) return null;
      const def = getProvider(provider.templateId);
      return def?.knownModels.find((m) => m.id === effectivePersona.modelId) ?? null;
    },
  });
  const model = modelQuery.data ?? null;

  // Initialise reasoning state once the model resolves.
  useEffect(() => {
    if (model) setReasoning(initialReasoningState(model));
  }, [model, setReasoning]);

  // Settings (for displayName and token estimate).
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await getClientDataDb().settings.get(1)) ?? null,
  });
  const displayName = useDisplayName();

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
    if (!model || !effectivePersona || !settingsQuery.data) return 0;
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
  }, [model, effectivePersona, settingsQuery.data, chatQuery.data?.messages]);

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

  const onExitToEntranceHall = (): void => {
    setInteractionMode(false);
    navigate('/app');
  };

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
        BottomAffordance is the "open the cockpit" cue — only makes sense
        when the cockpit is closed and auto-follow is active. ScrollToEnd
        is now rendered inside ChatStream so it lives at the bottom of the
        scrollable viewport regardless of cockpit height.
      */}
      {!isInteractionMode && hasMessages && autoFollowEnabled ? (
        <BottomAffordance
          onTap={() => {
            // Opening the cockpit always lands the user at the end of the
            // chat ("you reply from the bottom"). setAutoFollow(true) is
            // usually a no-op since the affordance only shows when already
            // following, but it's explicit insurance — and ChatStream's
            // ResizeObserver will lock the bottom alignment as the layout
            // shifts under the new cockpit.
            setAutoFollow(true);
            setInteractionMode(true);
          }}
        />
      ) : null}

      {isInteractionMode && effectivePersona && model ? (
        <InteractionMode
          persona={effectivePersona}
          model={model}
          usedTokens={usedTokens}
          draftValue={draft}
          onDraftChange={setDraft}
          onSend={(t) => void onSend(t)}
          isStreamLive={isStreamLive}
          onExit={onExitToEntranceHall}
        />
      ) : null}
    </div>
  );
}
