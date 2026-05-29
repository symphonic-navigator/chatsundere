// SPDX-License-Identifier: LGPL-3.0-only

/** The dimension a probe is designed to reveal. */
export type ProbeDimension =
  | 'reasoning-on'
  | 'reasoning-off'
  | 'effort-high'
  | 'effort-max'
  | 'tool-call'
  | 'reasoning-and-tools'
  | 'contradiction';

/** One probe: the dimension under test and the exact raw body to POST. */
export interface Probe {
  id: string;
  dimension: ProbeDimension;
  body: Record<string, unknown>;
}

/** What came back when a probe was run live. */
export interface CapturedFixture {
  probeId: string;
  dimension: ProbeDimension;
  requestBody: Record<string, unknown>;
  status: number;
  /** Raw response body verbatim — SSE text for 2xx streams, JSON/text for errors. */
  rawResponse: string;
}
