# My Integrations

Integrations connect your Circle to tools that live outside Chatsundere. Today
that means **MCP servers** — small services that expose tools (search a wiki,
query a database, control your homelab) a persona can call mid-conversation.

## Adding a server

Tap **Add MCP server**, give it a name and its URL, and — if it needs one — an
authentication key. Tap **Test connection** to check it answers and to see the
tools it offers. The result is only kept once you tap **Save**.

## Signing in to a server

Some servers ask you to sign in instead of pasting a key. Paste the server's link
and tap **Check server**; if it supports sign-in, you can continue to the sign-in. It
opens in its own window, and when you approve it there, this app picks it up
by itself. The connection is shared with your other devices, so you only do this
once. Prefer a key? Tap **Use a key instead**.

If the two windows cannot talk to each other (this happens on some phones), the
sign-in page shows a **copied code** starting with `csm1.`. Come back to Chatsundere
and paste it into the box. The code works for about a minute on some servers, so be
quick; if it has expired, simply start again, which is always fine.

If a server stops accepting your sign-in, it shows **Sign in again**. Tap it and
approve at the server once more.

If a device receives an older copy of your sign-in than the one it already has, it shows **Sign-in paused here** and stops using it to keep it safe. Tap **Sign in again**, or wait: it carries on by itself once your devices catch up.

## On your other devices

A server you added on another device appears here too, marked **Connects on first
use**: this device finds its own route the first time a persona calls one of its
tools, and if that fails, the tool call says why. A **Local network** server depends
on where the device is, so tap **Test connection** and **Save** on each device that
should use it.

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

The first time a device contacts a server, Chatsundere asks **Use this server
here?** and shows where the call is going. Say yes once and it is remembered for
that device; **Not now** answers that one call only.

## Removing a server

Open the server and tap **Remove server**. Its stored key or sign-in is deleted and
your personas lose access to its tools. For a server you signed in to, this signs
you out at the server on all your devices.
