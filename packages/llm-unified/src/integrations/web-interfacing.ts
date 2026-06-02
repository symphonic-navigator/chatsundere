// SPDX-License-Identifier: LGPL-3.0-only

/** A coarse, curated geographic hint passed to web backends that localise
 *  results. Shape only; its source on the client is a deferred follow-up. */
export interface WebLocation {
  country?: string;
  region?: string;
  city?: string;
}

/** The per-call context a web backend may use: whether explicit content is
 *  permitted (driven by the active persona) and an optional location hint. */
export interface WebContext {
  nsfwAllowed: boolean;
  location: WebLocation | null;
}

/** One result row from a web search. */
export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** The outcome of a web search, serialised by the tool for the model. */
export interface WebSearchResult {
  query: string;
  hits: WebSearchHit[];
}

/** The outcome of fetching a single URL. `content` is model-ready text
 *  (markdown for `ai-friendly` backends, plainer text for `classic`). */
export interface WebFetchResult {
  url: string;
  content: string;
}

/** Quality tier of a web backend: `classic` is 2002-style keyword search
 *  (Kagi, Brave); `ai-friendly` returns model-optimised content (Exa, Linkup). */
export type WebQualityClass = 'classic' | 'ai-friendly';

/** Curated capability metadata for a `web` offering — the single source of
 *  truth for what a backend can do and how good it is for an LLM. Lives on the
 *  offering (catalogue knowledge), not on the adapter. */
export interface WebOfferingMeta {
  canSearch: boolean;
  canFetch: boolean;
  qualityClass: WebQualityClass;
}

/** Behavioural contract a web-interfacing adapter implements. A backend exposes
 *  only the methods it supports; capability flags live on the offering's
 *  `web` metadata, not here. The key is supplied per call (never stored). */
export interface WebInterfacingProvider {
  search?(
    query: string,
    ctx: WebContext,
    key: string,
    signal?: AbortSignal,
  ): Promise<WebSearchResult>;
  fetch?(url: string, ctx: WebContext, key: string, signal?: AbortSignal): Promise<WebFetchResult>;
}
