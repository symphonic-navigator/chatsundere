// SPDX-License-Identifier: LGPL-3.0-only
// Worker-loadable wrapper: re-exports the baseline adapter under the name the
// worker entry expects (`adapter`).
import { deepseekBaselineAdapter } from './nano-gpt-deepseek.baseline.js';
export const adapter = deepseekBaselineAdapter;
