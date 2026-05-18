# Security — @chatsundere/crypto

> _This file is a skeleton. TBD — fill before merging the real crypto implementation in the crypto unit._

## Threat model

To be defined when the implementation lands. The library's purpose is to make
plaintext keys, passphrases, and recovery keys *inexpressible* on the server
side; the threat model section will document the trust boundary, the attacker
capabilities considered, and the explicitly-out-of-scope attacks.

## Key zeroing

JavaScript cannot guarantee buffer zeroing. The library will overwrite known
buffers on session close, but readers should understand this is best-effort.

## Reporting issues

Email Chris until a public disclosure process exists.
