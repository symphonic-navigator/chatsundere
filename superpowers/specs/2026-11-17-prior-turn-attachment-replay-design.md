# Prior-turn attachment replay — design

**Date:** 2026-11-17 · **Target:** 0.4.1 on `maintenance/0.4`, forward-ported to `master` the same day · **Size:** small change (short design)

## Why

Only the current user turn's attachments reach the model. Every earlier user turn is replayed as plain text, so an image the model described one turn ago is gone in the next one, and the model complains there is nothing there. Chris found this on 2026-11-16 while testing 0.4.0. It has been deferred since the June attachment work (`resolveUserContent` in `state/stream-manager.store.ts`, spec `2026-06-07-knowledgebase-chunk-b2-attach-document-design.md` §255). It is a fault in the released version, so it belongs in a maintenance release.

## Goals

- Prior user turns that are still in the replayed history (not folded into a compaction summary) carry their attachments on the wire again.
- The context meter and the overflow estimate count what is actually sent.

## Non-goals

- Describing old images after the fact (no new vision calls just because an image ages out of the window).
- Copying attachments on Branch or edit→Branch (a separate deferred item).
- Any UI change. Nothing new to see; the model simply keeps seeing what was attached.

## Anti-goals

- A prior-turn resolution failure must never block or break the send. It degrades to a placeholder, as the current turn does.
- No silent drop: an image that is not sent in full is named in a placeholder, so the model knows it existed.

## Approaches

1. **Replay everything in full.** Simple, but every old image costs vision tokens on every turn, and a long screenshot chat grows without bound.
2. **Recent images in full, older ones as a cached description, with descriptions produced after the fact for vision models.** The most faithful option, but it needs extra describe calls and a configured substitute model. Too much movement for a maintenance release.
3. **Recent images in full, older ones as a cached description if one exists, else a placeholder.** **Picked.**

Decided by Chris (2026-11-17): a placeholder for older images is enough ("Platzhalter reicht, auf jeden Fall"). The point is that the model knows the image was there. Full fidelity for old images is not worth extra calls in 0.4.1.

## Design

- **Text attachments** (uploaded documents, artefact snapshots, knowledge-base references; `kind === 'text'`) are always replayed in full, in every prior turn still in the history. They use the same `Attachment: <name>` fence as the current turn.
- **Image window:** the most recent **3** prior user turns *that carry images* replay their images exactly as the current turn would: `direct` for a vision model, or the substitute description. *(N = 3 is Liz's call; Chris did not object. Keep it a named constant.)* The current turn does not count towards the 3.
  - Within the window with disposition `substitute`, an uncached image is described and cached through the same path as the current turn, including its live `describe_image` pill. *(Liz's call: within the window the model should see what the user sees. This only happens after a switch from a vision model to a blind one.)*
- **Older images** (outside the window) never trigger a vision call:
  - a cached `visionDescription` (from any model) → replayed as the usual `[Image description for …]` text;
  - otherwise → placeholder `[Image: <fileName> — shown earlier, no longer attached]`.
- **Blob missing** (e.g. not yet hydrated on this device, or corrupt) → the same placeholder instead of today's silent skip, for prior turns. *(Liz's call, per the no-silent-drop anti-goal.)*
- **Wire shape:** a prior user turn with attachments becomes a multimodal `WireContentPart[]`, built by the existing `buildUserWireContent`. A turn without attachments stays a plain string, so nothing changes for text-only chats.
- **Where:** resolve prior attachments once per send, next to `resolveUserContent`. Feed them into `replayHistory` / `buildEngineWireMessages` as a map from message id to resolved content. `lib/tool-replay.ts` stays free of IndexedDB access.
- **Counting:** `estimateReplayTokens` for a user row adds its attachments: text attachments by `estimateTokens` of the rendered part, a direct image at a fixed estimate (a named constant, ~1000 tokens), a description or placeholder by its text. The meter (`ChatStream`) and the overflow failsafe in `start` use it, and so does the current turn's attachments in the overflow estimate. The meter loads attachments alongside the replay pills.
- **Compaction:** unchanged. Messages folded into a summary are not replayed, so neither are their attachments. The compaction transcript keeps its existing per-block hints.

## Audit gates

- Larissa: not touched (no `auth-service`, `sync-service`, `proxy-service` or `packages/crypto` change).
- Laura: skipped. No user-reachable flow, state or affordance changes.

## Left to the builder

The exact function boundaries, test layout and the precise image token constant.

## Manual verification (Chris, on device)

1. Open a chat with a **vision** model. Attach a screenshot and ask "What do you see?". **Pass:** it describes the image.
2. In the next turn, ask "What colour was the button in the top right?" (or similar, about a detail it did not mention). **Pass:** it answers from the image and does not say there is no image.
3. Send three more turns, each with a different image. Then ask about the very first screenshot. **Pass:** the model says it can no longer see that image (or answers only vaguely), but it knows a screenshot was there. It must not claim nothing was ever attached.
4. Attach a text document (or save an artefact as an attachment). Two turns later, ask for a quote from it. **Pass:** it quotes correctly.
5. Switch the persona to a **blind** model with a substitute vision model configured. Ask about one of the last three images. **Pass:** a `describe_image` pill may appear once; the answer refers to the image's content.
6. Watch the context meter in a chat with several images. **Pass:** it rises noticeably with each image turn, rather than staying flat as before.
