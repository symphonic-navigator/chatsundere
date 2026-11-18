# Privacy & data handling

## Where is my data stored?

All your data — conversations, companions, settings — stays on **your device**, encrypted with a key derived from your passphrase. Nothing is uploaded unless you explicitly link a server for sync, and even then the server only ever stores ciphertext.

## Can Chatsundere see my conversations?

No. Your messages are encrypted with a key only you hold. The server, and anyone running it, sees ciphertext and nothing more. It cannot decrypt your data, see your passphrase, or derive your keys.

## Can third-party services see my data?

Only with your explicit permission, on a per-provider basis. When you send a message to an AI provider you have configured, that message goes to that provider so it can reply. You choose which providers to use; Chatsundere adds no hidden recipients.

## Which provider sees what?

- **Your companion's provider** sees the conversation, so it can reply.
- **A background helper**, if you set one on a persona, sends what it works on to its own provider: chat titles, memory, compaction of long conversations, and summaries of long tool results (the first 48,000 characters of each result, including output from integrations and Ask an expert). If you let the helper write the greeting, that goes to its provider too. Without a helper, the companion's own provider does this work.
- **After you change a persona's model** in the middle of a chat, the new provider receives the earlier conversation, tool results included.

Our server keeps none of it. A provider that can only be reached through your linked server's relay gets its requests passed on by that relay, which neither logs nor stores them.

## What if I lose my recovery key?

You lose access to your data. There is no back door and no "forgot password" — that absence is the point. Keep your recovery key somewhere safe.
