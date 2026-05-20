// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Centralised British-English UI strings for admin-client. Pages add their
 * own keys as they are built; do not inline literal strings anywhere except
 * here.
 */
export const copy = {
  appName: 'Chatsundere Admin',
  signOut: 'Sign out',
  loading: 'Loading…',
  genericError: 'Something went wrong. Please try again.',
  login: {
    title: 'Sign in to Chatsundere Admin',
    passphraseLabel: 'Passphrase',
    submit: 'Sign in',
    failures: {
      noAccount: {
        title: 'No account on this device',
        body: 'Set up a Chatsundere account in user-client first, then come back here.',
        cta: 'Open user-client',
      },
      noLink: {
        title: 'Account is not linked to a server',
        body: 'Admin features require a server connection. Link your account in user-client first.',
        cta: 'Open user-client',
      },
      offline: {
        title: 'Server connection required',
        body: 'Admin-client requires an active server connection. Check your network and try again.',
        cta: 'Retry',
      },
      notAdmin: {
        title: 'Admin permissions required',
        body: 'Your account does not have admin permissions on this server. If you believe this is wrong, contact your operator.',
        cta: 'Open user-client',
      },
    },
    errors: {
      invalidPassphrase: 'Incorrect passphrase.',
      integrityFailure: "Couldn't verify your local data. Try clearing site data and re-linking.",
      authFailed: 'Authentication failed.',
      serverUnreachable: 'Could not reach the server.',
      genericError: 'Something went wrong. Please try again.',
      prfRequired: 'Your passkey does not support PRF — needed for biometric login.',
      passkeyCancelled: '',
    },
  } as const,
} as const;
