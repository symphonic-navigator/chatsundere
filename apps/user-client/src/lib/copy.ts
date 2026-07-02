// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Central catalogue of user-facing copy. Pull from here; never inline
 * strings into components. Keeps the language audit tractable.
 */
export const copy = {
  serverGate: {
    localOnly:
      'This comes alive once you link an account. Link one under Account → Server linking.',
    localOnlyWithInvite:
      'This comes alive once you link an account. Link one under Account → Server linking — or request an invitation.',
    offline:
      "Your server isn't reachable right now. This wakes up again the moment the connection returns.",
    authAction:
      'The server stopped recognising this session. Sync your passphrase under Account → Server linking to restore the link.',
    serverOdd:
      'Your server is answering unexpectedly. This usually resolves itself — if it keeps happening, your operator will want to know.',
    featureMissing:
      "Your server doesn't offer this yet. Operators can enable it — nothing is missing on your side.",
    checking: 'Checking what your server offers…',
  },
  create: {
    usernameStep: {
      title: 'Pick a username.',
      hint: '3–32 characters. Start with a letter, then lowercase letters, digits, underscores, or hyphens.',
      label: 'Username',
      placeholder: 'e.g. aria_bell',
      nextCta: 'Continue',
    },
    passphraseStep: {
      title: 'Choose a passphrase.',
      hint: 'Eight characters or more. Pick something memorable to you, hard to guess for anyone else. No composition rules — that is your call.',
      passphraseLabel: 'Passphrase',
      confirmLabel: 'Confirm passphrase',
      backCta: 'Back',
      nextCta: 'Continue',
    },
    recoveryStep: {
      title: 'Save your recovery key.',
      body: 'This is the only way back if you forget your passphrase. We cannot see it and we cannot recover it — once you leave this screen it is gone. Copy it now and store it somewhere safe: on paper, in a password manager, anywhere only you can reach.',
      confirmLabel: "I've saved my recovery key somewhere safe.",
      finishCta: 'Open Chatsundere',
      copyLabel: 'Copy to clipboard',
      copiedLabel: 'Copied',
    },
  },
  login: {
    headingPrefix: 'Welcome back,',
    // ADR 0022: under UV='preferred' the unlock ceremony is not guaranteed
    // to be biometric (Bitwarden Desktop with unlocked vault, Yubikey-no-PIN
    // are all valid passkey unlocks). Copy uses method-agnostic "passkey".
    passkeyUnlockCta: 'Sign in with passkey',
    passphraseLabel: 'Passphrase',
    unlockCta: 'Unlock',
    unlockingCta: 'Unlocking…',
    forgotLink: 'Forgot passphrase?',
    errors: {
      // Spec §5.6: single non-specific message — no distinction between
      // wrong passphrase and missing account to prevent information leakage.
      wrongPassphrase: 'Wrong passphrase.',
      passkeyUnlockFailed: 'Could not verify with passkey. Try your passphrase.',
      unknown: "Couldn't sign in. Please try again.",
    },
  },
  errors: {
    accountCreation: "Couldn't create the account. Please try again.",
    accountExists:
      'A Chatsundere account already exists on this device. Return to the welcome screen to use it.',
    usernameInvalid:
      'That username is not valid. Start with a lowercase letter, then use only lowercase letters, digits, underscores, or hyphens (3–32 characters total). Reserved words are not allowed.',
    copyFailed: 'Copy failed — please select the key above and copy it manually.',
  },
  settings: {
    nav: {
      account: 'Account',
      authMethods: 'Authentication methods',
      serverLinking: 'Server linking',
      about: 'About',
    },
    account: {
      title: 'Account',
      usernameLabel: 'Username',
      editCta: 'Edit',
      saveCta: 'Save',
      cancelCta: 'Cancel',
      createdAtLabel: 'Account created',
      signOutSection: 'Sign out',
      signOutBody:
        'Lock this device. Your encrypted data stays here; you will need your passphrase or biometric to come back in.',
      signOutCta: 'Sign out',
      deleteSection: 'Delete local data',
      deleteBody:
        'This wipes every byte of your account on this device: your local passphrase, your biometric setups, every encrypted note, and the link to any server you joined. There is no undo. Make sure you have your recovery key somewhere safe if you ever want to come back.',
      deleteCta: 'Delete everything on this device',
      confirmDeleteTitle: 'Delete everything on this device?',
      confirmDeleteBody: 'Type your username to confirm. There is no undo.',
      confirmTokenLabel: 'your username',
      confirmDeleteCta: 'Delete forever',
      confirmCancelCta: 'Keep my data',
    },
    authMethods: {
      title: 'Authentication methods',
      passphraseLabel: 'Passphrase',
      passphraseDescription: 'Always present. Cannot be removed.',
      biometricSectionLabel: 'Biometric on this device',
      recoveryKeyLabel: 'Recovery key',
      recoveryKeyDescription: 'Set up when you created the account.',
      addBiometricCta: 'Set up biometric on this device',
      addBiometricBusyCta: 'Setting up biometric…',
      addBiometricDefaultLabel: 'This device',
      addBiometricUnsupported: 'Your browser does not support biometric authentication.',
      addBiometricPrfRequired:
        'This authenticator does not support the PRF extension. A PRF-capable passkey is required to protect your master key. Try a different authenticator.',
      addBiometricGenericError: 'Could not add biometric. Please try again.',
      regenerateRecoveryCta: 'Generate a new recovery key',
      regenerateRecoveryDisabledHint:
        'Available after you sign in with your passphrase or recovery key.',
      renameCta: 'Rename',
      removeCta: 'Remove',
      renameSaveCta: 'Save',
      confirmRemoveTitle: 'Remove this method?',
      confirmRemoveBody: 'This biometric will no longer unlock Chatsundere on this device.',
      confirmRemoveToken: 'remove',
      confirmRemoveCta: 'Remove',
      confirmLockoutTitle: 'This is your only remaining unlock method.',
      confirmLockoutBody:
        'Removing this leaves the recovery key as your only way in. If you lose both, the account on this device is gone forever.',
    },
    serverLinking: {
      title: 'Server linking',
      notLinkedTitle: 'Not linked to any server',
      notLinkedBody:
        'Link to a Chatsundere instance to enable chat, persistence, and cross-device sync. You will need an invitation from the operator.',
      scanCta: 'Scan QR',
      pasteCta: 'Paste invitation URL',
      linkedTitle: 'Linked',
      serverLabel: 'Server',
      issuerLabel: 'Operator',
      roleLabel: 'Role',
      changePassphraseCta: 'Change passphrase',
      changePassphraseDisabledTooltip: 'Available when the server is reachable again.',
      disconnectCta: 'Disconnect from server',
      confirmDisconnectTitle: 'Disconnect from this server?',
      confirmDisconnectBody:
        'Your account on the server is removed. Your local data stays on this device but no longer syncs anywhere.',
      confirmDisconnectToken: 'disconnect',
      syncBiometricBanner:
        'One or more biometrics on this device are not synced to the server yet.',
      serverUnreachableBanner:
        "We can't reach the server right now. Settings is available; chat and sync resume when the connection comes back.",
      serverAuthFailedBanner:
        'The server stopped recognising this session. Sync your passphrase to restore the link.',
      syncPassphraseCta: 'Sync passphrase',
    },
    about: {
      title: 'About',
      privacy: {
        label: 'Privacy & data handling',
        whereTitle: 'Where your data lives.',
        whereBody:
          "Chatsundere stores everything on this device. Your chats, personas, drafts, and provider credentials live in the browser's local storage (IndexedDB). Nothing is uploaded.",
        cannotSeeTitle: 'What we cannot see.',
        cannotSeeBody:
          'This alpha runs entirely in your browser. There is no Chatsundere server in the picture — we receive no telemetry, no analytics, and no account data. Clearing your browser storage wipes everything irrecoverably.',
        externalTitle: 'When you talk to external providers.',
        externalBody:
          'Models live with their providers (nano-gpt, Novita AI, Ollama Cloud, or any custom endpoint you configure). Your prompts, attachments, and replies travel directly from your browser to that provider — their privacy policy and terms of service apply to that traffic. Chatsundere never sees it; we also cannot enforce anything against it.',
      },
      thirdParty: {
        label: 'Third-party libraries',
        intro:
          'Chatsundere bundles the following open-source projects. Their licences govern their respective code; full licence texts are available at the homepage of each project.',
        versionPrefix: 'v',
      },
      licence: {
        copyright: 'Copyright © 2026 Chatsundere contributors.',
        noWarranty: 'No warranty — see the licence for details.',
        licenceLabel: 'Licence',
        licenceValue: 'GNU AGPL v3.0',
        licenceHref: 'https://www.gnu.org/licenses/agpl-3.0.html',
        sourceLabel: 'Source code',
        sourceValue: 'github.com/symphonic-navigator/chatsundere',
        sourceHref: 'https://github.com/symphonic-navigator/chatsundere',
        policyLabel: 'Our Provider Integration Policy',
        policyValue: 'teaser.chatsundere.me/policy',
        policyHref: 'https://teaser.chatsundere.me/policy',
        docsLabel: 'Documentation',
        docsValue: 'chatsune.me',
        docsHref: 'https://chatsune.me',
      },
    },
  },
  recovery: {
    step1Title: 'Sign in with your recovery key.',
    step1Body: 'Enter the recovery key you saved when you set up Chatsundere.',
    recoveryKeyLabel: 'Recovery key',
    scopeTitle: 'How should we recover?',
    scopeLocalOption: 'Local only',
    scopeLocalBody:
      'Quickest. Your account on the server stays signed out until you set up again from there.',
    scopeFullOption: 'Local and server',
    scopeFullBody: 'Resets the server-side wrapping too. Requires a working connection.',
    continueCta: 'Continue',
    step2Title: 'Choose a new passphrase.',
    step2Body: 'Replace the passphrase you forgot. Eight characters or more.',
    newPassphraseLabel: 'New passphrase',
    confirmPassphraseLabel: 'Confirm passphrase',
    regenerateLabel: 'Generate a new recovery key as well',
    regenerateHint:
      'Use this if you think your old recovery key may have been seen by someone else.',
    finishCta: 'Set new passphrase',
    newKeyTitle: 'Save your new recovery key.',
    newKeyBody:
      'Your previous recovery key is now invalid. Store this one safely — once you leave this screen it is gone.',
    newKeyConfirmLabel: "I've saved my new recovery key somewhere safe.",
    newKeyFinishCta: 'Open Chatsundere',
    errors: {
      keyInvalid: "That recovery key doesn't match.",
      serverUnreachable: 'The server is unreachable. Try local-only recovery, or try again later.',
      unknown: "Couldn't complete recovery. Please try again.",
    },
  },
  changePassphrase: {
    title: 'Change your passphrase',
    body: 'You will need your new passphrase to sign in next time.',
    newLabel: 'New passphrase',
    confirmLabel: 'Confirm new passphrase',
    submitCta: 'Update passphrase',
    workingCta: 'Updating…',
    successTitle: 'Passphrase updated.',
    successBody: 'Use your new passphrase next time you sign in.',
    successCta: 'Back to settings',
    offlineTitle: "We can't change your passphrase while offline",
    offlineBody: 'Reach a server, then try again. Your local data is safe in the meantime.',
    offlineBackCta: 'Back to settings',
    errors: {
      mismatch: 'The two passphrases do not match.',
      tooShort: 'A passphrase must be at least eight characters.',
      // {seconds} is replaced at render time.
      rateLimited:
        'You changed your passphrase recently. Please wait {seconds} seconds before trying again.',
      unknown: "Couldn't update the passphrase. Please try again.",
    },
  },
  stagingBanner: {
    rolledBack: "Your previous passphrase change didn't complete. Please try again when ready.",
    dismissCta: 'Dismiss',
  },
  biometricPrompt: {
    title: 'Set up biometric unlock?',
    body: "Future unlocks can use your device's biometric instead of typing your passphrase.",
    setupCta: 'Set up now',
    laterCta: 'Maybe later',
    busyCta: 'Setting up…',
    prfRequired:
      'This authenticator does not support the PRF extension. A PRF-capable passkey is required to protect your master key. Try a different authenticator.',
    genericError: 'Could not add biometric. Please try again.',
    defaultLabel: 'This device',
  },
} as const;
