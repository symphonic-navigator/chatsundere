# My Integrations

Integrations connect your Circle to tools that live outside Chatsundere. Today
that means **MCP servers** — small services that expose tools (search a wiki,
query a database, control your homelab) a persona can call mid-conversation.

## Adding a server

Tap **Add MCP server**, give it a name and its URL, and — if it needs one — an
authentication key. Tap **Test connection** to check it answers and to see the
tools it offers. When you are happy, tap **Save**.

## How a call reaches the server

By default the request travels through your configured CORS proxy. If the server
is on your own network and allows direct browser access, turn on **Local
network** to connect straight to it instead.

## Trust and approval

Tool calls send their arguments — which may include parts of your conversation —
to the server, so they wait for your approval each time. Mark a server as
**Trusted** to let its tools run without asking. **On by default** decides
whether a server's tools are armed in new chats; you can still override this per
persona.

## Removing a server

Open the server and tap **Remove server**. Its stored key is deleted and your
personas lose access to its tools.
