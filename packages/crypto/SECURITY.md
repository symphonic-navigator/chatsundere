# Security — @chatsundere/crypto

## Threat Model

### What a server-DB leak does not yield

The server stores only ciphertext blobs and HKDF-derived verifier keys. A database dump gives an attacker no plaintext keys, passphrases, or master keys. OPAQUE prevents offline brute force against the passphrase because the server-side credentials are blinded by the protocol and useless without the client's contribution.

The recovery verifier key (`HMAC(recovery_key, fixed-info)`) enables the challenge-response recovery protocol but cannot be replayed: the server issues a fresh random challenge each time, signs it with the verifier key, and the client must produce a valid response in the same round. A stolen DB snapshot therefore cannot impersonate the user in a recovery flow.

### What the IndexedDB integrity HMAC defends against

Every wrapped-MK bundle stored in IndexedDB carries an HMAC keyed under a key derived from the same AMK that wraps the master key. An XSS payload that overwrites the ciphertext before the user unlocks will be caught on the next login attempt — the HMAC check fails before decryption is attempted, preventing a chosen-ciphertext attack from learning oracle information about the AMK.

### What we deliberately do not protect against

- **Forgotten passphrase and lost recovery key:** unrecoverable by design. There is no server-assisted reset path; the recovery key is the only fallback.
- **XSS post-unlock:** once the user is logged in the master key is held in browser memory. A script executing on the application origin after unlock can read it. Content-Security-Policy and the absence of `eval` reduce the attack surface but cannot eliminate it entirely.
- **Coerced unlock:** a user under duress who is compelled to enter their passphrase or present their biometric is outside the threat model.
- **Centrally-hosted PWA trust:** operators are recommended to host the user-client and admin-client themselves on the same origin as their `base_url`. A user who fetches the PWA from a third-party central host (e.g., `app.chatsundere.org`) places full trust in that host's ability to serve an honest client. SRI and update signatures would mitigate this; both are deferred.
- **Cross-server user correlation:** if a user links the same recovery key to two operators, both servers store the same `HMAC(recovery_key, fixed-info)`. Two cooperating operators could detect "same user". This is accepted because making the verifier per-operator would break the account-migration story, which depends on the recovery key working unchanged on a new operator.

## Key Zeroing

JavaScript cannot guarantee buffer zeroing because the runtime may copy typed arrays during GC compaction. The library overwrites known key buffers on `MasterKeySession.close()` as a best-effort measure. Callers must not retain references to key material after closing the session.

## Reporting Issues

Contact Chris directly until a public disclosure process is established.
