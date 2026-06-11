// SPDX-License-Identifier: AGPL-3.0-only
import type { Element, ElementContent, Root, Text } from 'hast';
import { TEAL_MARK_END, TEAL_MARK_START } from './preprocess-teal.js';
import { resolveTealWrap } from './teal-render-map.js';

/**
 * Rehype plugin: converts TEAL sentinel markers (emitted by preprocessTeal)
 * into styled spans. Walks text nodes in document order with ONE active-class
 * stack for the whole tree, so a wrap spanning paragraphs styles every
 * paragraph and an unclosed wrap styles progressively to the end — which is
 * exactly the live-streaming semantic. Skips code/pre subtrees. Orphan or
 * mismatched markers are removed without effect.
 */

// Matches a sentinel marker: START + optional '/' + tag-name + END
const MARKER_SOURCE = `${TEAL_MARK_START}(/?)([a-z-]+)${TEAL_MARK_END}`;

function makeMarker(): RegExp {
  return new RegExp(MARKER_SOURCE, 'g');
}

function wrapSegment(value: string, active: ReadonlyArray<string>): ElementContent {
  if (active.length === 0) {
    return { type: 'text', value } satisfies Text;
  }
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [...new Set(active)] },
    children: [{ type: 'text', value }],
  } satisfies Element;
}

function transformText(node: Text, active: string[]): ElementContent[] {
  const out: ElementContent[] = [];
  let last = 0;
  const marker = makeMarker();
  for (let m = marker.exec(node.value); m !== null; m = marker.exec(node.value)) {
    const before = node.value.slice(last, m.index);
    if (before.length > 0) out.push(wrapSegment(before, active));
    last = m.index + m[0].length;

    const slash = m[1];
    const name = m[2];
    if (slash === undefined || name === undefined) continue;

    const closing = slash === '/';
    const action = resolveTealWrap(name);
    // Unknown tag (null) or silent tag: marker simply vanishes
    if (action === null || action.kind !== 'wrap') continue;

    if (closing) {
      const idx = active.lastIndexOf(action.className);
      if (idx >= 0) active.splice(idx, 1);
    } else {
      active.push(action.className);
    }
  }
  const rest = node.value.slice(last);
  if (rest.length > 0) out.push(wrapSegment(rest, active));
  return out;
}

type VisitableNode = Root | Element;

function visit(node: VisitableNode, active: string[]): void {
  if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return;

  const next: ElementContent[] = [];
  for (const child of node.children) {
    if (child.type === 'text') {
      next.push(...transformText(child, active));
    } else if (child.type === 'element') {
      visit(child, active);
      next.push(child);
    } else {
      // Preserve doctype / comment / raw nodes unchanged
      next.push(child as ElementContent);
    }
  }
  // Splice in place so the assignment is type-compatible in both Root and Element
  node.children.splice(0, node.children.length, ...next);
}

export function rehypeTeal() {
  return (tree: Root): void => {
    const active: string[] = [];
    visit(tree, active);
  };
}
