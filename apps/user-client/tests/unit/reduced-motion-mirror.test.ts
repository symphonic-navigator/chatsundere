// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { mirrorReducedMotion, reducedMotionMirror } from '../../build/reduced-motion-mirror';

const REDUCED = ":where(:root[data-motion='reduced'])";
const ALLOWED = ":where(:root:not([data-motion='reduced']))";

/** Top-level selector rules of a stylesheet, in source order. */
function topLevelSelectors(css: string): string[] {
  return postcss
    .parse(css)
    .nodes.filter((n): n is Rule => n.type === 'rule')
    .map((r) => r.selector);
}

describe('mirrorReducedMotion', () => {
  it('mirrors every rule of a reduce block right after the block', () => {
    const css = [
      '.a { animation: spin 1s; }',
      '@media (prefers-reduced-motion: reduce) {',
      '  .a { animation: none; }',
      '  .b::after { opacity: 1; }',
      '}',
      '.c { color: red; }',
    ].join('\n');
    const out = mirrorReducedMotion(css, 'fixture.css');
    expect(topLevelSelectors(out)).toEqual(['.a', `${REDUCED} .a`, `${REDUCED} .b::after`, '.c']);
    // The original block is left as it was.
    const root = postcss.parse(out);
    const media = root.nodes.find((n) => n.type === 'atrule');
    expect(media?.type === 'atrule' && media.params).toBe('(prefers-reduced-motion: reduce)');
    expect(out).toContain('.a { animation: none; }');
  });

  it('prefixes every selector of a selector list', () => {
    const css = '@media (prefers-reduced-motion: reduce) { .x, .y .z { transition: none; } }';
    const out = mirrorReducedMotion(css, 'fixture.css');
    expect(topLevelSelectors(out)).toEqual([`${REDUCED} .x, ${REDUCED} .y .z`]);
  });

  it('keeps the declarations of the mirrored rule', () => {
    const css =
      '@media (prefers-reduced-motion: reduce) { .x { animation: none !important; opacity: 1; } }';
    const out = mirrorReducedMotion(css, 'fixture.css');
    const mirrored = postcss
      .parse(out)
      .nodes.find((n): n is Rule => n.type === 'rule' && n.selector.startsWith(REDUCED));
    expect(mirrored?.nodes.map((d) => d.toString())).toEqual([
      'animation: none !important',
      'opacity: 1',
    ]);
  });

  it('narrows no-preference rules in place and keeps their keyframes', () => {
    const css = [
      '@media (prefers-reduced-motion: no-preference) {',
      '  @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }',
      '  .p { animation: pulse 1s infinite; }',
      '  .q, .r { animation: pulse 2s; }',
      '}',
    ].join('\n');
    const out = mirrorReducedMotion(css, 'fixture.css');
    const root = postcss.parse(out);
    expect(root.nodes).toHaveLength(1);
    const media = root.first;
    if (media?.type !== 'atrule') throw new Error('expected the media block');
    const rules = media.nodes?.filter((n): n is Rule => n.type === 'rule') ?? [];
    expect(rules.map((r) => r.selector)).toEqual([`${ALLOWED} .p`, `${ALLOWED} .q, ${ALLOWED} .r`]);
    expect(out).toContain('@keyframes pulse');
  });

  it('accepts a keyframes redefinition when the block names its users', () => {
    const css = [
      '@media (prefers-reduced-motion: reduce) {',
      '  @keyframes step-in { from { opacity: 1; } to { opacity: 1; } }',
      "  [style*='step-in'] { opacity: 1 !important; }",
      '}',
    ].join('\n');
    const out = mirrorReducedMotion(css, 'fixture.css');
    expect(topLevelSelectors(out)).toEqual([`${REDUCED} [style*='step-in']`]);
  });

  it('accepts a keyframes redefinition when the block covers every stylesheet user', () => {
    const css = [
      '.spinner { animation: spin 1s linear infinite; }',
      '.loader, .dot { animation-name: spin; }',
      '@media (prefers-reduced-motion: reduce) {',
      '  @keyframes spin { to { transform: none; } }',
      '  .spinner, .loader { animation: none; }',
      '  .dot { animation: none; }',
      '}',
    ].join('\n');
    expect(() => mirrorReducedMotion(css, 'fixture.css')).not.toThrow();
  });

  it('leaves a stylesheet without reduced-motion blocks unchanged', () => {
    const css = '.a { color: red; }\n@media (min-width: 1024px) { .a { color: blue; } }\n';
    expect(mirrorReducedMotion(css, 'fixture.css')).toBe(css);
  });

  describe('fails loudly', () => {
    it('on a keyframes-only reduce block, naming the keyframes line', () => {
      const css = [
        '.a { color: red; }',
        '@media (prefers-reduced-motion: reduce) {',
        '  @keyframes fade { from { opacity: 1; } to { opacity: 1; } }',
        '}',
      ].join('\n');
      expect(() => mirrorReducedMotion(css, 'src/index.css')).toThrow(/^src\/index\.css:3: .*fade/);
    });

    it('when the block misses one of the stylesheet users', () => {
      const css = [
        '.spinner { animation: spin 1s; }',
        '.loader { animation: spin 2s; }',
        '@media (prefers-reduced-motion: reduce) {',
        '  @keyframes spin { to { transform: none; } }',
        '  .spinner { animation: none; }',
        '}',
      ].join('\n');
      expect(() => mirrorReducedMotion(css, 'f.css')).toThrow(/^f\.css:4: .*\.loader/);
    });

    it('on a nested at-rule inside a reduce block', () => {
      const css = [
        '@media (prefers-reduced-motion: reduce) {',
        '  .a { animation: none; }',
        '  @media (min-width: 1024px) {',
        '    .b { animation: none; }',
        '  }',
        '}',
      ].join('\n');
      expect(() => mirrorReducedMotion(css, 'f.css')).toThrow(/^f\.css:3: /);
    });

    it('on an at-rule nested inside a rule of a reduce block', () => {
      const css = [
        '@media (prefers-reduced-motion: reduce) {',
        '  .a {',
        '    @apply opacity-100;',
        '  }',
        '}',
      ].join('\n');
      expect(() => mirrorReducedMotion(css, 'f.css')).toThrow(/^f\.css:3: /);
    });

    it('on a nested at-rule inside a no-preference block', () => {
      const css = [
        '@media (prefers-reduced-motion: no-preference) {',
        '  @supports (animation-timeline: view()) {',
        '    .a { animation: fade 1s; }',
        '  }',
        '}',
      ].join('\n');
      expect(() => mirrorReducedMotion(css, 'f.css')).toThrow(/^f\.css:2: /);
    });

    it('on a combined media query it cannot mirror faithfully', () => {
      const css = [
        '.a { color: red; }',
        '@media (prefers-reduced-motion: reduce) and (min-width: 1024px) {',
        '  .a { animation: none; }',
        '}',
      ].join('\n');
      expect(() => mirrorReducedMotion(css, 'f.css')).toThrow(/^f\.css:2: /);
    });

    it('on a selector that targets the root element itself', () => {
      const css = '@media (prefers-reduced-motion: reduce) {\n  html { scroll-behavior: auto; }\n}';
      expect(() => mirrorReducedMotion(css, 'f.css')).toThrow(/^f\.css:2: /);
    });

    it('on a parse error', () => {
      const css =
        '.a { color: red; }\n\n@media (prefers-reduced-motion: reduce) {\n  .b { color: blue;\n';
      expect(() => mirrorReducedMotion(css, 'f.css')).toThrow(/^f\.css:\d+: /);
    });

    it('on a parse error, with the line of the fault', () => {
      const css = '.a { color: red; }\n.b { color: blue; }}\n';
      expect(() => mirrorReducedMotion(css, 'f.css')).toThrow(/^f\.css:2: /);
    });
  });
});

describe('reducedMotionMirror plugin', () => {
  const plugin = reducedMotionMirror();
  type TransformFn = (code: string, id: string) => { code: string } | null | undefined;
  const transform = plugin.transform as unknown as TransformFn;

  it('runs before the other CSS plugins in serve and build alike', () => {
    expect(plugin.enforce).toBe('pre');
    expect(plugin.apply).toBeUndefined();
  });

  it('transforms only src/index.css, with or without a query', () => {
    const css = '@media (prefers-reduced-motion: reduce) { .a { animation: none; } }';
    expect(transform(css, '/repo/apps/user-client/src/index.css')?.code).toContain(REDUCED);
    expect(transform(css, '/repo/apps/user-client/src/index.css?direct')?.code).toContain(REDUCED);
    expect(transform(css, '/repo/apps/user-client/src/other.css')).toBeNull();
    expect(transform(css, '/repo/apps/user-client/src/app/index.css')).toBeNull();
  });
});

describe('the real src/index.css', () => {
  const file = fileURLToPath(new URL('../../src/index.css', import.meta.url));
  const source = readFileSync(file, 'utf-8');

  it('transforms without error and gives every reduce rule its twin', () => {
    const out = mirrorReducedMotion(source, 'src/index.css');
    const root = postcss.parse(out);
    const twins = new Set(
      root.nodes
        .filter((n): n is Rule => n.type === 'rule' && n.selector.startsWith(REDUCED))
        .map((r) => r.selectors.join(' | ')),
    );
    let reduceRules = 0;
    root.walkAtRules('media', (media) => {
      if (media.params !== '(prefers-reduced-motion: reduce)') return;
      for (const node of media.nodes ?? []) {
        if (node.type !== 'rule') continue;
        reduceRules += 1;
        const expected = node.selectors.map((s) => `${REDUCED} ${s}`).join(' | ');
        expect(twins, `twin of ${node.selector}`).toContain(expected);
      }
    });
    expect(reduceRules).toBeGreaterThan(20);
  });

  it('narrows every no-preference rule', () => {
    const root = postcss.parse(mirrorReducedMotion(source, 'src/index.css'));
    let narrowed = 0;
    root.walkAtRules('media', (media) => {
      if (media.params !== '(prefers-reduced-motion: no-preference)') return;
      for (const node of media.nodes ?? []) {
        if (node.type !== 'rule') continue;
        narrowed += 1;
        for (const s of node.selectors) expect(s.startsWith(`${ALLOWED} `)).toBe(true);
      }
    });
    expect(narrowed).toBeGreaterThan(0);
  });
});
