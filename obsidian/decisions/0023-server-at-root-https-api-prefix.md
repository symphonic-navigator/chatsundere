# ADR 0023: Chatsundere servers are hosted at domain root, over HTTPS, with `/api/` prefix

**Date:** 2026-05-20
**Status:** Proposed
**Related:** ADR 0021 (OPAQUE-first linking), ADR 0024 (single-server-per-account), `obsidian/briefs/phase 0/cross-device-identity.md`

## Context

Self-hosted Chatsundere instances must agree on a small set of hosting
constraints so that:

- The user-client can construct API URLs from a hostname alone (e.g.,
  `bobs-server.de`), without operator-supplied path prefixes.
- The QR-code payload format (`CHATSUNDERE|<version>|<type>|<host>|<token>|...`)
  carries only `<host>` and assumes the rest.
- WebAuthn ceremonies, which require a secure context except on
  loopback, do not need per-instance exceptions.
- Confused-deputy attacks via sub-path collisions are eliminated by
  construction.

Three hosting variables can be locked down without loss of legitimate
flexibility for self-hosters: hosting location (root vs sub-path),
transport (HTTPS vs HTTP), and API prefix.

## Decision

Chatsundere imposes three hosting constraints on every server instance:

1. **Server hosted at domain root.** Sub-path hosting
   (`https://example.com/chatsundere/`) is not supported. Self-hosters
   dedicate a full subdomain or domain to a Chatsundere instance
   (e.g., `chatsundere.example.com` or `example.com` itself).
2. **API prefix is `/api/...` off the root.** All Chatsundere API
   endpoints live under `/api/`.
3. **HTTPS required, loopback excepted.** `localhost:*` and `127.0.0.1:*`
   accept HTTP (matching WebAuthn's secure-context exception for
   loopback). All other hosts must serve HTTPS. The user-client refuses
   to connect over plain HTTP to non-loopback hosts.

## Consequences

Positive:

- The user-client URL-construction logic is trivial: given a hostname
  (and optional port) from a QR or manual entry, build
  `https://<host[:port]>/api/...` (or `http://` for loopback). No
  operator-supplied path prefix to wrangle.
- WebAuthn's secure-context rules align with our HTTPS rule without
  special-casing. WebAuthn refuses to run on plain HTTP to non-loopback
  hosts anyway; we make that constraint explicit at the user-client
  level instead of getting a confusing failure deep in the WebAuthn
  ceremony.
- Sub-path collision attacks (an operator running another service at
  `/api/...` on the same host, then later installing Chatsundere at
  `/chatsundere/`) are impossible by construction.
- Operator-side documentation has one canonical setup pattern:
  "Point a subdomain at the Chatsundere container, run Traefik in
  front, done."

Negative / accepted trade-offs:

- Operators who would prefer to host Chatsundere as a sub-path on an
  existing domain (e.g., consolidating multiple services under one
  hostname) cannot do so. They must allocate a subdomain. The cost is
  one DNS record plus one Traefik routing rule — low.
- Operators in air-gapped or LAN-only environments must either use
  loopback or stand up a local certificate authority for HTTPS. The
  latter is well-documented elsewhere; the former is the dev/test
  pattern.

## Alternatives considered

1. **Allow sub-path hosting via operator-supplied API prefix.** Rejected:
   adds a configuration variable to every QR code and every API URL,
   complicates the user-client routing, opens sub-path collision attack
   surface. The benefit (operator convenience) does not outweigh the
   cost.
2. **Allow HTTP on non-loopback for legacy/air-gapped use.** Rejected:
   WebAuthn refuses to run anyway, so the user would get a worse
   experience (deep error in the WebAuthn flow) than a clean refusal
   at the link step. Loopback covers legitimate dev/test cases.
3. **Require an explicit `/chatsundere/` prefix (vendor-prefixed instead
   of generic `/api/`).** Rejected: redundant given the dedicated-subdomain
   rule, and `/api/` is the more conventional choice.

## References

- [`obsidian/briefs/phase 0/cross-device-identity.md`](../briefs/phase%200/cross-device-identity.md) — Self-hosting Constraints section.
- [ADR 0021](0021-phase0-opaque-first-linking.md) — auth-service routing assumes `/api/v1/...` per this ADR's prefix rule.
- WebAuthn Level 2 spec, §5.1.3 — secure-context requirement and loopback exception.

## Amendment — 2026-05-22 (cross-device-identity)

The "server hosted at domain root" constraint is **relaxed** to permit
*transparent reverse-proxy sub-path hosting*. The auth-service still mounts
at `/api/v1/...` from its own perspective; deployers may front it with a
path-rewriting reverse proxy that strips an external prefix before
forwarding to the instance.

The motivating use case is the Baalnet-style relay model: a single relay
host at `https://relay.baalnet.io/` may proxy multiple Chatsundere
operator instances at sub-paths such as `https://relay.baalnet.io/t4524.../`,
where the relay rewrites the request before forwarding so the instance
sees the request as if it lived at root. The QR fragment URL embedded by
the operator's invitation (`${API_BASE_URL}/join#CODE`) naturally encodes
the public-facing prefix because `API_BASE_URL` is operator-configurable.

Sub-path hosting *without* a path-rewriting proxy (i.e., the instance
itself serving from `/chatsundere/api/v1/...`) **remains unsupported** —
the auth-service does not parse an operator-supplied API prefix, and the
WebAuthn relying-party ID derivation in `apps/auth-service/src/webauthn/server.ts`
still assumes the hostname matches the API origin.

The original alternative "Allow sub-path hosting via operator-supplied
API prefix" (in the Alternatives Considered section above) stays rejected;
this amendment does *not* reverse that decision — it only acknowledges
that a *transparent* sub-path proxy (URL rewriting at the relay edge) is
a deployer concern, not a server concern.

Driven by the cross-device-identity spec
([`superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md`](../../superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md))
and the Web-of-Trust use case requiring path-routed relays.
