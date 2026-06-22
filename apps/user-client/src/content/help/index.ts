// SPDX-License-Identifier: AGPL-3.0-only
import agpl from '../about/agpl-3.0.md?raw';
import privacy from '../about/privacy.md?raw';
import about from './about.md?raw';
import biometric from './biometric.md?raw';
import changePassphrase from './change-passphrase.md?raw';
import logout from './logout.md?raw';
import myAccount from './my-account.md?raw';
import recovery from './recovery.md?raw';
import serverLinking from './server-linking.md?raw';

export type HelpKey =
  | 'my-account'
  | 'biometric'
  | 'recovery'
  | 'server-linking'
  | 'about'
  | 'change-passphrase'
  | 'logout';

export const HELP_DOCS: Record<HelpKey, { title: string; markdown: string }> = {
  'my-account': { title: 'My Account — help', markdown: myAccount },
  biometric: { title: 'Biometric — help', markdown: biometric },
  recovery: { title: 'Recovery Key — help', markdown: recovery },
  'server-linking': { title: 'Server linking — help', markdown: serverLinking },
  about: { title: 'About — help', markdown: about },
  'change-passphrase': { title: 'Change passphrase — help', markdown: changePassphrase },
  logout: { title: 'Logout — help', markdown: logout },
};

export const PRIVACY_MD: string = privacy;
export const AGPL_MD: string = agpl;
