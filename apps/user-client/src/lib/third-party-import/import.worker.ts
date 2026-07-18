// SPDX-License-Identifier: AGPL-3.0-only

import { UnrecognisedExportError, parseExportBytes } from './parse-export.js';

/** Worker protocol: receives an ArrayBuffer, posts {ok:true,result}|{ok:false,kind,message}. */
self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    const result = parseExportBytes(new Uint8Array(e.data));
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({
      ok: false,
      kind: err instanceof UnrecognisedExportError ? 'unrecognised' : 'parse-failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
