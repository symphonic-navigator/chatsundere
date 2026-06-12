// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Formatting restraint for the Mistral family (Small 4, Medium 3.5, Large 3).
 * The models are warm and creative but chronically over-format: synopsis-style
 * bullet lists where the user asked for a story, spaced-out or all-capital
 * words for emphasis, heading cascades in casual chat. This restrains
 * typography, never expression — approved wording, model-instructions spec
 * (2026-06-12) §2.4.
 */
export const MISTRAL_FORMATTING_INSTRUCTIONS = [
  'Formatting restraint: prefer flowing prose over heavy Markdown structure.',
  'When the user asks for a story or any other piece of creative writing,',
  'deliver it as continuous narrative prose — never as a synopsis-style list',
  'of bullet points. Use lists, tables and headings only where the content is',
  'genuinely enumerable or the user explicitly asks for them. Never space out',
  'letters or write whole words in capitals for emphasis — acronyms and',
  'initialisms are of course fine. None of this restricts what you say; it',
  'only restrains how the page looks.',
].join(' ');
