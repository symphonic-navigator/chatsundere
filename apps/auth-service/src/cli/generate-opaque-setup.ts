// SPDX-License-Identifier: AGPL-3.0-only

// Prints a fresh OPAQUE server setup string for the OPAQUE_SERVER_SETUP env
// var. Run ONCE per instance and keep the value stable forever — every
// registration record is bound to it, and regenerating it permanently bricks
// every registered account's passphrase auth.
//
//   bun run generate-opaque-setup

import { ready, server } from '@serenity-kit/opaque';

await ready;
console.log(server.createSetup());
