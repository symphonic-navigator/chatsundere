// SPDX-License-Identifier: AGPL-3.0-only
import postcss, {
  type AtRule,
  type ChildNode,
  type Node as CssNode,
  CssSyntaxError,
  type Root,
  type Rule,
} from 'postcss';
import type { Plugin } from 'vite';

/*
 * The in-app "Reduce animations" switch sets `data-motion="reduced"` on the
 * root element. Rather than keep a second list of motion rules in step with
 * the per-component `prefers-reduced-motion` blocks, this transform derives
 * the switch's CSS from those blocks at build time:
 *
 * - every rule of a `reduce` block is mirrored right after the block under
 *   `:where(:root[data-motion='reduced'])` (`:where` keeps the original
 *   specificity, the position keeps its place in the cascade);
 * - every rule of a `no-preference` block is narrowed in place to
 *   `:where(:root:not([data-motion='reduced']))`, so motion the system allows
 *   stays off under the switch.
 *
 * It is the one piece of machinery between the stylesheet and the switch, so
 * whatever it cannot mirror faithfully fails the build with the file and line
 * instead of being skipped.
 */

const REDUCED_SCOPE = ":where(:root[data-motion='reduced'])";
const ALLOWED_SCOPE = ":where(:root:not([data-motion='reduced']))";
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';
const NO_PREFERENCE_QUERY = '(prefers-reduced-motion: no-preference)';

function fail(file: string, node: ChildNode | Root, message: string): never {
  const line = node.source?.start?.line ?? 0;
  throw new Error(`${file}:${line}: ${message}`);
}

function normaliseQuery(params: string): string {
  return params.replace(/\s+/g, ' ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').trim();
}

/** Whether `name` occurs in `text` as a whole CSS identifier. */
function mentionsIdent(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])${escaped}([^\\w-]|$)`).test(text);
}

function isInsideMotionBlock(node: ChildNode): boolean {
  let p: CssNode | undefined = node.parent;
  while (p && p.type !== 'root' && p.type !== 'document') {
    if (p.type === 'atrule' && /prefers-reduced-motion/.test((p as AtRule).params)) return true;
    p = p.parent;
  }
  return false;
}

/** Selectors of rules outside the motion blocks that run `@keyframes name`. */
function keyframeUsers(root: Root, name: string): string[] {
  const users: string[] = [];
  root.walkDecls(/^animation(-name)?$/, (decl) => {
    const rule = decl.parent;
    if (rule?.type !== 'rule' || isInsideMotionBlock(rule as Rule)) return;
    if (mentionsIdent(decl.value, name)) users.push(...(rule as Rule).selectors);
  });
  return users;
}

/**
 * Checks a block holds only what can be mirrored: selector rules (CSS nesting
 * inside them included) and, directly under the block, `@keyframes`.
 */
function assertMirrorable(block: AtRule, file: string): void {
  for (const child of block.nodes ?? []) {
    if (child.type === 'atrule' && child.name !== 'keyframes') {
      fail(file, child, `@${child.name} nested in a reduced-motion block cannot be mirrored`);
    }
    if (child.type === 'rule') {
      child.walkAtRules((nested) => {
        fail(file, nested, `@${nested.name} nested in a reduced-motion rule cannot be mirrored`);
      });
      for (const selector of child.selectors) {
        if (/^(:root|html)(?![\w-])/i.test(selector.trim())) {
          fail(
            file,
            child,
            `"${selector.trim()}" targets the root element, which the mirror cannot scope`,
          );
        }
      }
    }
  }
}

/**
 * `@keyframes` cannot be scoped to a selector, so a reduce block that only
 * redefines keyframes would leave the switch with nothing to mirror. Each
 * redefinition needs a selector rule in the same block: one that names the
 * animation (for users that set it inline) or one for every stylesheet rule
 * that runs it.
 */
function assertKeyframesHaveTwins(block: AtRule, root: Root, file: string): void {
  const rules = (block.nodes ?? []).filter((n): n is Rule => n.type === 'rule');
  const covered = new Set(rules.flatMap((r) => r.selectors.map((s) => s.trim())));
  for (const child of block.nodes ?? []) {
    if (child.type !== 'atrule' || child.name !== 'keyframes') continue;
    const name = child.params.trim();
    if (rules.some((r) => mentionsIdent(r.selector, name))) continue;
    const users = keyframeUsers(root, name);
    const missing = users.filter((s) => !covered.has(s.trim()));
    if (users.length > 0 && missing.length === 0) continue;
    const detail =
      missing.length > 0
        ? `no selector rule for ${missing.join(', ')}`
        : 'no selector rule naming its users';
    fail(
      file,
      child,
      `@keyframes ${name} is redefined for reduced motion with ${detail}; add one with the static end state to the same block`,
    );
  }
}

function scoped(rule: Rule, scope: string): string[] {
  return rule.selectors.map((s) => `${scope} ${s.trim()}`);
}

/**
 * Rewrites the reduced-motion blocks of a stylesheet so the root attribute
 * `data-motion="reduced"` behaves like the system's reduced-motion setting.
 * Throws `Error('<file>:<line>: …')` on anything it cannot mirror.
 */
export function mirrorReducedMotion(css: string, file: string): string {
  let root: Root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (error) {
    if (error instanceof CssSyntaxError) {
      throw new Error(`${file}:${error.line ?? 0}: ${error.reason}`);
    }
    throw error;
  }

  const blocks: AtRule[] = [];
  root.walkAtRules('media', (media) => {
    if (/prefers-reduced-motion/i.test(media.params)) blocks.push(media);
  });
  if (blocks.length === 0) return css;

  for (const block of blocks) {
    const query = normaliseQuery(block.params);
    if (query !== REDUCE_QUERY && query !== NO_PREFERENCE_QUERY) {
      fail(file, block, `@media ${block.params} cannot be mirrored; use ${REDUCE_QUERY} alone`);
    }
    if (isInsideMotionBlock(block)) {
      fail(file, block, 'a reduced-motion block nested in another cannot be mirrored');
    }
    assertMirrorable(block, file);

    if (query === NO_PREFERENCE_QUERY) {
      for (const child of block.nodes ?? []) {
        if (child.type === 'rule') child.selectors = scoped(child, ALLOWED_SCOPE);
      }
      continue;
    }

    assertKeyframesHaveTwins(block, root, file);
    let anchor: ChildNode = block;
    for (const child of block.nodes ?? []) {
      if (child.type !== 'rule') continue;
      const twin = child.clone();
      twin.selectors = scoped(child, REDUCED_SCOPE);
      anchor.after(twin);
      anchor = twin;
    }
  }

  return root.toString();
}

/**
 * Vite plugin applying {@link mirrorReducedMotion} to `src/index.css`. It runs
 * before Tailwind and in both `vite` (dev) and `vite build`, so the switch
 * behaves the same in either.
 */
export function reducedMotionMirror(): Plugin {
  return {
    name: 'chatsundere-reduced-motion-mirror',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0] ?? id;
      if (!path.endsWith('/src/index.css')) return null;
      return { code: mirrorReducedMotion(code, path), map: null };
    },
  };
}
