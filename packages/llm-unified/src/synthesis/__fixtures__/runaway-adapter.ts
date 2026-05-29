// SPDX-License-Identifier: LGPL-3.0-only
export const adapter = {
  buildRequest() {
    while (true) {
      /* deliberate infinite loop for the watchdog test */
    }
  },
  parseChunk(_raw: unknown, state: unknown) {
    return { events: [], state };
  },
  profile: {},
};
