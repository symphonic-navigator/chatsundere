// SPDX-License-Identifier: LGPL-3.0-only

// Polyfill IndexedDB and the IDB key range/event types for Bun test runs.
// Browser tests in apps/user-client rely on the real platform IndexedDB.
import 'fake-indexeddb/auto';
