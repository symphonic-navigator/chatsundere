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
import settingsExpert from './settings-expert.md?raw';
import settingsImages from './settings-images.md?raw';
import settingsProviders from './settings-providers.md?raw';
import settingsVoice from './settings-voice.md?raw';
import settingsWeb from './settings-web.md?raw';
import settingsYou from './settings-you.md?raw';
import settings from './settings.md?raw';

export type HelpKey =
  | 'my-account'
  | 'biometric'
  | 'recovery'
  | 'server-linking'
  | 'about'
  | 'change-passphrase'
  | 'logout'
  | 'settings'
  | 'settings-you'
  | 'settings-providers'
  | 'settings-web'
  | 'settings-voice'
  | 'settings-images'
  | 'settings-expert';

export const HELP_DOCS: Record<HelpKey, { title: string; markdown: string }> = {
  'my-account': { title: 'My Account — help', markdown: myAccount },
  biometric: { title: 'Biometric — help', markdown: biometric },
  recovery: { title: 'Recovery Key — help', markdown: recovery },
  'server-linking': { title: 'Server linking — help', markdown: serverLinking },
  about: { title: 'About — help', markdown: about },
  'change-passphrase': { title: 'Change passphrase — help', markdown: changePassphrase },
  logout: { title: 'Logout — help', markdown: logout },
  settings: { title: 'My Settings — help', markdown: settings },
  'settings-you': { title: 'You — help', markdown: settingsYou },
  'settings-providers': { title: 'AI Providers — help', markdown: settingsProviders },
  'settings-web': { title: 'Web Access — help', markdown: settingsWeb },
  'settings-voice': { title: 'Voice — help', markdown: settingsVoice },
  'settings-images': { title: 'Images — help', markdown: settingsImages },
  'settings-expert': { title: '"Ask an Expert" — help', markdown: settingsExpert },
};

export const PRIVACY_MD: string = privacy;
export const AGPL_MD: string = agpl;
