// SPDX-License-Identifier: AGPL-3.0-only

/** Wire-format types for chatsune's `.tar.gz` exports (format/version in the manifest). */

export interface ChatsuneManifest {
  format: string;
  version: number;
  exported_at?: string;
  include_content?: boolean;
  source_persona_name?: string;
  source_library_name?: string;
}

export interface ChatsuneProfileCrop {
  /** Pixel offset from the 280px canvas centre. */
  x: number;
  y: number;
  /** Multiplier on the natural image size (1 = unscaled). */
  zoom: number;
  /** Natural dimensions of chatsune's normalised image (<=1024). */
  width: number;
  height: number;
}

export interface ChatsunePersonaJson {
  name: string;
  tagline: string;
  system_prompt: string;
  nsfw: boolean;
  use_memory?: boolean;
  colour_scheme?: string;
  monogram?: string;
  profile_crop?: ChatsuneProfileCrop;
  has_avatar?: boolean;
}

export interface ChatsuneMessage {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string | null;
  created_at?: string;
  status?: string;
  refusal_text?: string | null;
  attachments?: unknown[] | null;
  tool_calls?: unknown[] | null;
  image_refs?: unknown[] | null;
  knowledge_context?: unknown[] | null;
  artefact_refs?: unknown[] | null;
  /** New-shape chronological timeline. Newer chatsune docs carry images,
   *  tool calls, knowledge lookups, attachments and artefacts here as
   *  `{ kind, ... }` entries — sometimes instead of, sometimes in parallel
   *  with, the legacy top-level fields above. */
  events?: unknown[] | null;
}

export interface ChatsuneSessionExport {
  original_id: string;
  session_fields: {
    title?: string | null;
    created_at?: string;
    updated_at?: string;
    deleted_at?: string | null;
    pinned?: boolean;
  };
  messages: ChatsuneMessage[];
}

export interface ChatsuneSessionsBundle {
  sessions: ChatsuneSessionExport[];
}

export interface ChatsuneLibraryJson {
  name: string;
  description?: string | null;
  nsfw?: boolean;
  default_refresh?: string;
}

export interface ChatsuneDocumentJson {
  title: string;
  content: string;
  media_type?: string;
  trigger_phrases?: string[];
  refresh?: string | null;
}
