// SPDX-License-Identifier: AGPL-3.0-only
import { artefactIntegration } from './artefact/artefact-integration.js';
import type { Integration } from './types.js';
import { webIntegration } from './web/web-integration.js';

/** Every registered integration. Each contributes 0..n tools per context. */
export const INTEGRATIONS: readonly Integration[] = [webIntegration, artefactIntegration];
