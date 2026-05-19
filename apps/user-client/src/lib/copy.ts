// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Central catalogue of user-facing copy. Pull from here; never inline
 * strings into components. Keeps the language audit tractable.
 */
export const copy = {
  onboarding: {
    title: 'Welcome.',
    body: 'Create a Chatsundere account on this device, or load one already here.',
    createHeading: 'Create new account',
    createBody: 'Set up a fresh account with a passphrase and recovery key.',
    createCta: 'Get started',
    loadHeading: 'Load existing account',
    loadBody: 'Load an account you already set up on another device.',
    loadCta: 'Load account',
    loadDisabledTooltip: 'Loading an existing account is coming in a later phase.',
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
    biometricCta: 'Unlock with biometric',
    passphraseLabel: 'Passphrase',
    unlockCta: 'Unlock',
    unlockingCta: 'Unlocking…',
    forgotLink: 'Forgot passphrase?',
    errors: {
      // Spec §5.6: single non-specific message — no distinction between
      // wrong passphrase and missing account to prevent information leakage.
      wrongPassphrase: 'Wrong passphrase.',
      biometricFailed: 'Biometric unlock failed. Try your passphrase.',
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
        'Sign out and sign back in with your passphrase to regenerate the recovery key. Biometric sessions cannot rotate it.',
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
      versionLabel: 'Version',
      licenceLabel: 'Licence',
      licenceValue: 'GNU AGPL v3.0',
      docsLabel: 'Documentation',
      docsValue: 'chatsune.me',
    },
  },
  linking: {
    scan: {
      title: 'Link this device to a server',
      body: 'Point your camera at the invitation QR code from your operator.',
      permissionDeniedTitle: "Camera access isn't available",
      permissionDeniedBody: "We can't open the camera. Use the paste option instead.",
      pasteFallbackCta: 'Paste invitation URL instead',
      cancelCta: 'Cancel',
    },
    paste: {
      title: 'Paste your invitation',
      body: 'Paste the URL or token your operator sent you.',
      label: 'Invitation URL or token',
      placeholder: 'https://… or invitation token',
      continueCta: 'Continue',
      cancelCta: 'Cancel',
      parseError:
        "This doesn't look like a valid Chatsundere invitation. Make sure it's from a trusted source.",
    },
    confirm: {
      title: 'Confirm this link',
      body: 'You are about to link your account on this device to a Chatsundere server. Review the details below before continuing.',
      issuerLabel: 'Operator',
      serverLabel: 'Server',
      roleLabel: 'Your role on this server',
      usernameLabel: 'Your username',
      confirmCta: 'Link this device',
      cancelCta: 'Cancel',
      workingCta: 'Linking…',
      successTitle: 'Linked.',
      successBody: 'You are now linked to this server. We have also recorded your account there.',
      biometricSyncTitle: 'Set up biometric on this server too?',
      biometricSyncBody:
        'Your local biometric will be mirrored to the server so you can unlock on any device you link.',
      biometricSyncCta: 'Set up biometric on this server',
      biometricSyncSkipCta: 'Skip for now',
      finishCta: 'Open Chatsundere',
      errors: {
        usernameTaken: 'That username is already in use on this server.',
        usernameTakenRenameCta: 'Rename and retry',
        usernameTakenCancelCta: 'Cancel',
        tokenExpired: 'This invitation has expired or has already been used.',
        tokenInvalid: "That invitation isn't valid on this server.",
        serverUnreachable: "We couldn't reach this server. Check your connection and try again.",
        unknown: "Couldn't complete linking. Please try again.",
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
  update: {
    message: 'A new version is ready.',
    refreshCta: 'Refresh now',
  },
} as const;
