# Changelog

What changed for Chatsundere's users, per release. Written from the version diary at release time; the process is [`obsidian/RELEASE-PROCESS.md`](obsidian/RELEASE-PROCESS.md).

## 0.5.0 — 2026-11-18

A release of small comforts and a smoother phone. It is the last large one before the Eidolon work. Until then, new models and fixes follow as 0.5.x.

### New

- **Search inside your chats** (#56). Type what you remember in My History and get the messages that contain it, grouped by chat, newest first, with your words highlighted. Tap one to land on that message. Your search text never goes into the address bar or into storage.
- **Your companion knows what time it is** (#57). It sees when each of your messages was sent, so it knows the time of day and how long you were away. This is on by default, except for role-play characters, so a fantasy world stays timeless. There is one switch per persona, under Model behaviour. Your AI provider sees these times too.
- **Export a chat** (#57). *Export chat* in the chat's quick menu gives you the conversation as a Markdown file. On a phone, the share sheet opens with it.
- **Reduce animations** (#57). A switch under My Settings › You stops the drifting background, the breathing orbs and other motion on this device. It also follows your system's reduced-motion setting.
- **Add an MCP server from the chat** (#62). Give your companion a server's link and it shows a card with the full link. One tap checks the server and leads you through the sign-in, then you are back in the chat. Only a link you wrote yourself is accepted.
- **The screen stays on while your companion talks** (#59), during live voice, read-aloud and the inner monologue.
- **My Circle and Voice settings in the chat's quick menu** (#58). The ⋯ menu also names the model that answers, and the Entrance Hall has help.

### Better

- **Back goes back** (#61). The `‹` in the page bar takes you to where you came from, exactly like your phone's Back button, and the crumbs take you up. Once a form is finished (a saved provider, a new persona), Back no longer returns to it.
- **Easier taps everywhere on a phone** (#59, #65). Buttons, tabs, switches and small icons all have a full thumb-sized touch area, and switches also toggle from their label. Pinch-zoom works again, and the composer stays clear of the iPhone's home bar.
- **Repair links lead to the right place and bring you back** (#58). "Set up voice" opens the page where that is done and returns you to the chat. The first-run card goes straight to AI Providers, then offers "create your first companion".
- **A failed key test says what is wrong** (#58) instead of showing a raw error.
- **History keeps your place** (#56). The tab, your search and the scroll position are still there when you come back. The Bookmarks tab also finds a bookmark by the text of its message.
- **Privacy notes say which provider sees what** (#58): your companion's provider, the background helper's provider, and what happens when you change the model mid-chat.
- **MCP servers that answer with a redirect say so** (#62). Chatsundere doesn't follow redirects, and such a server now asks for its final link instead of failing without a reason. A link with a trailing slash is checked exactly as entered.

### Fixed

- **After unlocking with a passkey, everything works again** (#60). After a passkey unlock from a cold start, sending, memory, saving keys and voice had stopped working, and so had sync for a linked account, without any message. Linking a local account to a server now checks your passphrase before anything is sent.
- **A message that could not be sent no longer fails in silence** (#58). If a saved provider key can't be opened, the chat says so and offers *Re-enter key*. Retrying an interrupted reply no longer risks losing your message.
- **Tapping Retry very early no longer deletes the interrupted reply without resending it** (#61).
- **Back never reopens what was closed** (#61), whether after signing out, after the first run or after switching adult mode off. An adult chat is never shown in SFW mode, not through Forward or an old tab either. The recovery key can no longer be lost by pressing Back.
- **Four snags in MCP sign-in are fixed** (#58): an approval hidden behind the sign-in overlay, *Sign in again* not continuing a sign-in that was waiting, a missing *Link a server* action, and the Add-server form forgetting what you had typed.
- **The memory page's credential error offers a way forward** (#58).
- **The trash empties itself without a server too** (#58).
- **A branched chat keeps its greeting's role** (#57), and the pill in the chat's top bar that always showed 0 is gone (#58).
- **A wrong passphrase on the sign-in page says "Wrong passphrase"** (#61) instead of "unknown".
- **Your companion remembers what you attached earlier in a chat** (#51, already in 0.4.1).

## 0.4.1 — 2026-11-17

### Fixed

- **Your companion remembers what you attached earlier in a chat** (#50). Before, it only saw the current message's attachments, so a screenshot it had just described was gone in the next turn. Documents and saved artefacts now stay in full, and images from your last three image messages stay visible. Older images remain known by their description, or at least by their name, so your companion knows they were there. The context meter now counts attachments too.

## 0.4.0 — 2026-11-16

### New

- **ElevenLabs as a voice provider** (#39). Personas can read aloud with Eleven v4, or with Eleven v4 Turbo for faster live voice, and dictation can use Scribe. One ElevenLabs key covers both directions. The voice picker lists the voices on your ElevenLabs account, your own clones included, with search and filters for own or predefined voices and for female or male voices. Voices for children or teenagers are always filtered out, and the picker says how many it hid.
- **Personas show their mood** (#40). They can now sound teasing, shy, sarcastic, sad, playful or affectionate, and around 30 moods in all. In the chat each mood appears as an emoji; with ElevenLabs you hear it, along with new sounds such as a yawn, a gulp or a scoff. Personas stay natural about it: most paragraphs carry no mood at all. Copy, bookmarks and the table of contents show the emojis too, never a raw tag.
- **ElevenLabs through nano-gpt** (#40). With just a nano-gpt key you can have personas read aloud with Eleven v4 or v4 Turbo and pick from ElevenLabs' standard voices, no ElevenLabs account needed. It is a little slower than the direct path; your own cloned voices need the direct ElevenLabs path.

### Fixed

- **Sign-ins to MCP servers with OAuth are harder to tamper with** (#42, from #36). A sync server can no longer hand a device an older sign-in than the one it already has, and stored sign-ins no longer give away by their size which kind of token they hold. When a device has to hold a sign-in back, it says so in the connection's status, its detail page, the chat and Test connection, and the sign-in screen says when the details came through your own server.
