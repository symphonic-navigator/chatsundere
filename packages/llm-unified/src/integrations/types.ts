// SPDX-License-Identifier: LGPL-3.0-only

/** A side-effect an integration asks the client to play. `kind` selects the renderer. */
export interface EffectTrigger {
  kind: string;
}

/** What an integration returns for a matched tag. */
export interface IntegrationResult {
  /** Inline text to render (soft-glowing). '' renders nothing inline. */
  display: string;
  /** Optional side-effect dispatched to the overlay; absent = display only. */
  effect?: EffectTrigger;
}

/** A first-party integration: a registered tag prefix plus a pure handler. */
export interface Integration {
  /** Registered namespace, e.g. 'sfx'. Unique across integrations. */
  readonly prefix: string;
  /** Resolve a matched tag. Returns null for an unknown command (tag left literal). */
  handle(command: string, rawArgs: string): IntegrationResult | null;
  /** Prompt fragment, injected by the composition layer only when the feature is enabled. */
  readonly systemPrompt: string;
}

/** A located integration tag occurrence in some text. */
export interface ParsedIntegrationTag {
  prefix: string;
  command: string;
  rawArgs: string;
  /** The full matched text including brackets, e.g. '[sfx:emoji-shower 🔥]'. */
  raw: string;
  /** Index of the opening '[' in the source text. */
  index: number;
}
