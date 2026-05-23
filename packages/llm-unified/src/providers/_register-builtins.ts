// SPDX-License-Identifier: LGPL-3.0-only

import { registerNanoGpt } from './nano-gpt.js';
import { registerNovita } from './novita.js';
import { registerOllamaCloud } from './ollama-cloud.js';

/**
 * Register all Block-1 built-in providers. Called once at package import
 * (see ../index.ts). Tests reset and re-call after _resetRegistryForTests.
 */
export function registerBuiltinProviders(): void {
  registerNanoGpt();
  registerNovita();
  registerOllamaCloud();
}
