// SPDX-License-Identifier: AGPL-3.0-only
import agpl from '../about/agpl-3.0.md?raw';
import privacy from '../about/privacy.md?raw';
import about from './about.md?raw';
import biometric from './biometric.md?raw';
import changePassphrase from './change-passphrase.md?raw';
import chatArtefacts from './chat-artefacts.md?raw';
import chatBookmarks from './chat-bookmarks.md?raw';
import chatKnowledge from './chat-knowledge.md?raw';
import circle from './circle.md?raw';
import history from './history.md?raw';
import integrations from './integrations.md?raw';
import knowledgeDocument from './knowledge-document.md?raw';
import knowledgeLibrary from './knowledge-library.md?raw';
import knowledge from './knowledge.md?raw';
import logout from './logout.md?raw';
import myAccount from './my-account.md?raw';
import personaFontVoice from './persona-font-voice.md?raw';
import personaInstructions from './persona-instructions.md?raw';
import personaIntegrations from './persona-integrations.md?raw';
import personaKnowledge from './persona-knowledge.md?raw';
import personaMemory from './persona-memory.md?raw';
import personaMindspace from './persona-mindspace.md?raw';
import personaModel from './persona-model.md?raw';
import personaRoleplay from './persona-roleplay.md?raw';
import persona from './persona.md?raw';
import recovery from './recovery.md?raw';
import serverLinking from './server-linking.md?raw';
import settingsExpert from './settings-expert.md?raw';
import settingsImages from './settings-images.md?raw';
import settingsProviders from './settings-providers.md?raw';
import settingsVoice from './settings-voice.md?raw';
import settingsWeb from './settings-web.md?raw';
import settingsYou from './settings-you.md?raw';
import settings from './settings.md?raw';
import treasury from './treasury.md?raw';

export type HelpKey =
  | 'my-account'
  | 'biometric'
  | 'recovery'
  | 'server-linking'
  | 'about'
  | 'change-passphrase'
  | 'history'
  | 'logout'
  | 'integrations'
  | 'knowledge'
  | 'knowledge-library'
  | 'knowledge-document'
  | 'persona'
  | 'persona-font-voice'
  | 'persona-instructions'
  | 'persona-memory'
  | 'persona-integrations'
  | 'persona-mindspace'
  | 'persona-knowledge'
  | 'persona-model'
  | 'persona-roleplay'
  | 'settings'
  | 'settings-you'
  | 'settings-providers'
  | 'settings-web'
  | 'settings-voice'
  | 'settings-images'
  | 'settings-expert'
  | 'treasury'
  | 'circle'
  | 'chat-bookmarks'
  | 'chat-artefacts'
  | 'chat-knowledge';

export const HELP_DOCS: Record<HelpKey, { title: string; markdown: string }> = {
  'my-account': { title: 'My Account — help', markdown: myAccount },
  biometric: { title: 'Biometric — help', markdown: biometric },
  recovery: { title: 'Recovery Key — help', markdown: recovery },
  'server-linking': { title: 'Server linking — help', markdown: serverLinking },
  about: { title: 'About — help', markdown: about },
  'change-passphrase': { title: 'Change passphrase — help', markdown: changePassphrase },
  history: { title: 'My History — help', markdown: history },
  logout: { title: 'Logout — help', markdown: logout },
  integrations: { title: 'My Integrations — help', markdown: integrations },
  knowledge: { title: 'My Knowledge — help', markdown: knowledge },
  'knowledge-library': { title: 'Knowledge Library — help', markdown: knowledgeLibrary },
  'knowledge-document': { title: 'Knowledge Document — help', markdown: knowledgeDocument },
  persona: { title: 'Persona — help', markdown: persona },
  'persona-font-voice': { title: 'Font & Voice — help', markdown: personaFontVoice },
  'persona-instructions': { title: 'Instructions — help', markdown: personaInstructions },
  'persona-memory': { title: 'Memory — help', markdown: personaMemory },
  'persona-integrations': { title: 'Integrations — help', markdown: personaIntegrations },
  'persona-mindspace': { title: 'Mindspace — help', markdown: personaMindspace },
  'persona-knowledge': { title: 'Knowledge — help', markdown: personaKnowledge },
  'persona-model': { title: 'Model behaviour — help', markdown: personaModel },
  'persona-roleplay': { title: 'Roleplay — help', markdown: personaRoleplay },
  settings: { title: 'My Settings — help', markdown: settings },
  'settings-you': { title: 'You — help', markdown: settingsYou },
  'settings-providers': { title: 'AI Providers — help', markdown: settingsProviders },
  'settings-web': { title: 'Web Access — help', markdown: settingsWeb },
  'settings-voice': { title: 'Voice — help', markdown: settingsVoice },
  'settings-images': { title: 'Images — help', markdown: settingsImages },
  'settings-expert': { title: '"Ask an Expert" — help', markdown: settingsExpert },
  treasury: { title: 'My Treasury — help', markdown: treasury },
  circle: { title: 'My Circle — help', markdown: circle },
  'chat-bookmarks': { title: 'Chat Bookmarks — help', markdown: chatBookmarks },
  'chat-artefacts': { title: 'Chat Artefacts — help', markdown: chatArtefacts },
  'chat-knowledge': { title: 'Chat Knowledge — help', markdown: chatKnowledge },
};

export const PRIVACY_MD: string = privacy;
export const AGPL_MD: string = agpl;
