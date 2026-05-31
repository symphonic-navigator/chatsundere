// SPDX-License-Identifier: LGPL-3.0-only

import { registerChutes } from './chutes.js';
import { registerMistral } from './mistral.js';
import { registerNanoGpt } from './nano-gpt.js';
import { registerNovita } from './novita.js';
import { registerOllamaCloud } from './ollama-cloud.js';
import { registerOpenRouter } from './openrouter.js';
import { registerTensorix } from './tensorix.js';
import { registerWafer } from './wafer.js';

/**
 * Register all built-in providers. Called once at package import
 * (see ../index.ts). Tests reset and re-call after _resetRegistryForTests.
 */
export function registerBuiltinProviders(): void {
  registerChutes();
  registerTensorix();
  registerMistral();
  registerWafer();
  registerNovita();
  registerOllamaCloud();
  registerNanoGpt();
  registerOpenRouter();
}
