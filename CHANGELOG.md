# Changelog

What changed for Chatsundere's users, per release. Written from the version diary at release time; the process is [`obsidian/RELEASE-PROCESS.md`](obsidian/RELEASE-PROCESS.md).

## 0.4.0 — 2026-11-16

### New

- **ElevenLabs as a voice provider** (#39). Personas can read aloud with Eleven v4, or with Eleven v4 Turbo for faster live voice, and dictation can use Scribe. One ElevenLabs key covers both directions. The voice picker lists the voices on your ElevenLabs account, your own clones included, with search and filters for own or predefined voices and for female or male voices. Voices for children or teenagers are always filtered out, and the picker says how many it hid.
- **Personas show their mood** (#40). They can now sound teasing, shy, sarcastic, sad, playful or affectionate, and around 30 moods in all. In the chat each mood appears as an emoji; with ElevenLabs you hear it, along with new sounds such as a yawn, a gulp or a scoff. Personas stay natural about it: most paragraphs carry no mood at all. Copy, bookmarks and the table of contents show the emojis too, never a raw tag.
- **ElevenLabs through nano-gpt** (#40). With just a nano-gpt key you can have personas read aloud with Eleven v4 or v4 Turbo and pick from ElevenLabs' standard voices, no ElevenLabs account needed. It is a little slower than the direct path; your own cloned voices need the direct ElevenLabs path.

### Fixed

- **Sign-ins to MCP servers with OAuth are harder to tamper with** (#42, from #36). A sync server can no longer hand a device an older sign-in than the one it already has, and stored sign-ins no longer give away by their size which kind of token they hold. When a device has to hold a sign-in back, it says so in the connection's status, its detail page, the chat and Test connection, and the sign-in screen says when the details came through your own server.
