# ADR 0043: Native players for MCP media, not MCP Apps

## Status

Accepted (2026-11-21, Chris approved the spec `superpowers/specs/2026-11-21-mcp-media-playback-design.md`).

## Context

MCP servers that generate audio and video (ElevenLabs, Higgsfield) follow "control channel MCP, data channel HTTP": tool results carry JSON with signed, short-lived HTTPS links to a CDN; neither uses `resource_link` or inline `audio` blocks for generated media. Both also ship an MCP Apps view (a `ui://` HTML resource the host renders in a sandboxed iframe). The player card claude.ai shows for ElevenLabs is that provider view, not claude.ai's own rendering.

Until 0.6.0 our MCP client kept only `text` content and dropped everything else.

## Decision

1. **Native players.** The user-client finds media in a tool result (typed blocks, `resource_link`, HTTPS URLs inside JSON), saves the bytes as `audio`/`video` artefacts as soon as the result arrives, and renders its own players in the chat, the Treasury and the lightbox.
2. **No MCP Apps rendering for now.** Executing provider HTML inside the client needs an iframe sandbox, a postMessage bridge, proxying of tool calls and its own CSP. That is a separate decision with a Larissa audit, taken only if native players turn out not to be enough.
3. **Bytes are kept, links are not trusted to last.** Signed links expire within hours, so a chat that kept only the link would show dead players the next day. Saved media sync like images (up to 32 MiB per file; larger files stay on the saving device).

## Consequences

- No third-party code runs in the client; playback is `blob:` URLs in `<audio>`/`<video>` after a mime allow-list and a magic-byte sniff.
- Provider-specific extras of the MCP Apps views (e.g. "Open flow") are not shown; the model can still link to them in prose.
- Media count against the 2 GiB sync quota. The storage policy for media (what syncs, what expires) is an open discussion.
