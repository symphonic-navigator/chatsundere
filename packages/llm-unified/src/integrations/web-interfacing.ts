// SPDX-License-Identifier: LGPL-3.0-only

/** A coarse, curated geographic hint passed to web backends that localise
 *  results. Shape only; its source on the client is a deferred follow-up. */
export interface WebLocation {
  country?: string;
  region?: string;
  city?: string;
}

/** The per-call context a web backend may use: NSFW permission, an optional
 *  location hint, and whether this call must route through the account's
 *  authenticated proxy. */
export interface WebContext {
  nsfwAllowed: boolean;
  location: WebLocation | null;
  /** True when this web call must route through the account's authenticated
   *  proxy (the backend sends no CORS headers); false when the adapter may go
   *  direct (e.g. the Bun live-suite). */
  useProxy: boolean;
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

/** The outcome of fetching a single URL. `content` is model-ready text,
 *  markdown when the backend provides it. */
export interface WebFetchResult {
  url: string;
  content: string;
}

/** A curated display trait for a web backend, shown as a badge in the backend
 *  picker. `ai` replaces the old `ai-friendly` quality class; Brave is
 *  human-oriented and carries `privacy` instead. */
export type WebTrait = 'recommended' | 'ai' | 'neural' | 'privacy';

/** One curated search-depth tier surfaced in the cockpit. The first tier in an
 *  offering's list is the default (cheapest). `params` are merged verbatim into
 *  the search request body. `label`/`tooltip` are user-facing British English. */
export interface SearchTier {
  id: string;
  label: string;
  tooltip?: string;
  params: { depth?: string; numResults?: number };
}

/** Resolved per-call search options (a tier's `params`) — kept structurally
 *  tied to `SearchTier['params']` so the two cannot drift. */
export type WebSearchOpts = SearchTier['params'];

/** Curated capability metadata for a `web` offering. */
export interface WebOfferingMeta {
  canSearch: boolean;
  canFetch: boolean;
  traits: WebTrait[];
  /** True when the backend's endpoints send no CORS headers and must route
   *  through the user's CORS proxy (all nano-gpt web endpoints today). */
  requiresProxy: boolean;
  /** Search-only: the curated depth tiers (first = default). Omitted for fetch. */
  searchTiers?: SearchTier[];
}

/** Behavioural contract a web-interfacing adapter implements. A backend exposes
 *  only the methods it supports; capability flags live on the offering's
 *  `web` metadata, not here. The key is supplied per call (never stored). */
export interface WebInterfacingProvider {
  search?(
    query: string,
    ctx: WebContext,
    key: string,
    opts: WebSearchOpts,
    signal?: AbortSignal,
  ): Promise<WebSearchResult>;
  fetch?(url: string, ctx: WebContext, key: string, signal?: AbortSignal): Promise<WebFetchResult>;
}
