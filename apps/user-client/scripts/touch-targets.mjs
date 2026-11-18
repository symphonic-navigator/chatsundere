// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Touch-target sweep for the user client (dev tool, not run in CI).
 *
 * Drives a running dev server in a 380 × 800 touch viewport with the iPhone
 * safe-area insets emulated, onboards a throwaway local account, mocks
 * OpenRouter (key check and a streamed chat reply), creates a persona with a
 * model, a chat with two replies, a bookmark and a knowledge library with one
 * document, then visits every screen it can reach and reports:
 *
 *   - undersized targets: every interactive element whose hit area is below
 *     44 px on either side. The hit area is the element's box united with its
 *     `::before`/`::after` box when that pseudo-element is absolutely
 *     positioned (the `.cs-hit` pattern), both cut by every overflow-clipping
 *     ancestor (a row with `overflow: hidden` clips what spills out of it).
 *   - overlaps: points of a 4 px grid over each hit area at which
 *     `document.elementFromPoint` lands on a different interactive element.
 *
 * Navigation is client-side only (`history.pushState` + `popstate`): a reload
 * would drop the session's in-memory master key.
 *
 * Usage (Playwright must be resolvable, e.g. installed globally):
 *
 *   NODE_PATH=$(npm root -g) node apps/user-client/scripts/touch-targets.mjs \
 *     [--url http://localhost:5173] [--out /tmp/touch] [--allow-overlap]
 *
 * `--out <prefix>` writes `<prefix>.json` and `<prefix>.txt`; without it the
 * text table goes to stdout only. Exits 1 when overlaps exist, unless
 * `--allow-overlap` is given.
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter } from 'node:path';

// Resolved through `require` with NODE_PATH searched first: ESM `import`
// ignores NODE_PATH, and a workspace copy of Playwright may lack its browsers.
const require = createRequire(import.meta.url);
const nodePath = (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean);
const { chromium } = require(
  require.resolve('playwright', { paths: [...nodePath, import.meta.dirname] }),
);

const MIN = 44;
const GRID = 4;

function parseArgs(argv) {
  const args = { url: 'http://localhost:5173', out: null, allowOverlap: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--allow-overlap') args.allowOverlap = true;
    else if (a === '--help' || a === '-h') {
      console.log('touch-targets.mjs [--url <base>] [--out <prefix>] [--allow-overlap]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  args.url = args.url.replace(/\/$/, '');
  return args;
}

/** An OpenAI-style SSE body that streams `text` in a few chunks. */
function sseBody(text) {
  const words = text.split(' ');
  const chunks = words.map((w, i) => ({
    id: 'gen-sweep',
    object: 'chat.completion.chunk',
    model: 'openai/gpt-4o',
    choices: [{ index: 0, delta: { content: (i ? ' ' : '') + w } }],
  }));
  chunks.push({
    id: 'gen-sweep',
    object: 'chat.completion.chunk',
    model: 'openai/gpt-4o',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: words.length, total_tokens: 12 + words.length },
  });
  return `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
}

let replyCount = 0;
async function mockOpenRouter(ctx) {
  await ctx.route('https://openrouter.ai/**', (route) => {
    const req = route.request();
    if (req.method() === 'POST' && /\/chat\/completions/.test(req.url())) {
      replyCount++;
      const body = JSON.parse(req.postData() || '{}');
      if (body.stream === false) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'gen-sweep',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Sweep title' },
                finish_reason: 'stop',
              },
            ],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: sseBody(
          `This is reply number ${replyCount}, long enough to wrap onto a second line so the message actions sit where they would in a real chat.`,
        ),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'openai/gpt-4o' }], credits: 1 }),
    });
  });
}

async function go(p, path) {
  await p.evaluate((u) => {
    history.pushState({}, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await p.waitForTimeout(1200);
}

/** Runs in the page: measures hit areas and samples overlaps. */
function measureInPage({ min, grid }) {
  const sel =
    'button, a[href], [role=button], [role=tab], [role=menuitem], [role=switch], [role=radio], [role=checkbox], input:not([type=hidden]), select, textarea, summary';
  const els = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // Takes no taps at all (e.g. a fading-out "Scroll to end").
    if (cs.pointerEvents === 'none') continue;
    if (r.bottom < 0 || r.top > innerHeight * 4) continue;
    els.push(el);
  }
  const set = new Set(els);
  const px = (v) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  // The rectangle beyond which `el`'s overflow-clipping ancestors cut off `el`
  // itself, or (`pseudo`) a pseudo-element of `el`, which `el`'s own overflow
  // clips too. A hidden or clipped axis cuts at the padding box. A
  // scrolling axis cuts a pseudo-element only before its scroll origin, since
  // one spilling past the far edge just extends the scroll area, and never
  // cuts `el` itself, which scrolls into view. An absolutely positioned box
  // escapes the clippers below its containing block, a fixed one all of them.
  const clipRect = (el, pseudo) => {
    const c = { l: Number.NEGATIVE_INFINITY, t: Number.NEGATIVE_INFINITY };
    c.r = Number.POSITIVE_INFINITY;
    c.b = Number.POSITIVE_INFINITY;
    let escaping = false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const ns = getComputedStyle(n);
      if (n !== el && escaping && ns.position !== 'static') escaping = false;
      if (n === el ? pseudo : !escaping) {
        const nr = n.getBoundingClientRect();
        const pl = nr.left + n.clientLeft;
        const pt = nr.top + n.clientTop;
        const axis = (ov, lo, hi, start, size, scroll) => {
          if (ov === 'visible') return;
          if (ov === 'hidden' || ov === 'clip') {
            c[lo] = Math.max(c[lo], start);
            c[hi] = Math.min(c[hi], start + size);
          } else if (pseudo) c[lo] = Math.max(c[lo], start - scroll);
        };
        axis(ns.overflowX, 'l', 'r', pl, n.clientWidth, n.scrollLeft);
        axis(ns.overflowY, 't', 'b', pt, n.clientHeight, n.scrollTop);
      }
      if (ns.position === 'fixed') break;
      if (ns.position === 'absolute') escaping = true;
    }
    return c;
  };
  // `clipOwn` false leaves the element's own box whole (for the size check: a
  // row half scrolled out of a sheet is not a small target); pseudo-elements
  // are always clipped.
  const hitArea = (el, clipOwn = true) => {
    const r = el.getBoundingClientRect();
    const own = clipOwn ? clipRect(el, false) : { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
    let box = {
      l: Math.max(r.left, own.l),
      t: Math.max(r.top, own.t),
      r: Math.min(r.right, own.r),
      b: Math.min(r.bottom, own.b),
    };
    const clip = clipRect(el, true);
    for (const which of ['::before', '::after']) {
      const ps = getComputedStyle(el, which);
      if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
      if (ps.position !== 'absolute' || ps.pointerEvents === 'none') continue;
      // An absolutely positioned pseudo-element resolves against the element
      // when the element is positioned; `.cs-hit` guarantees that.
      const w = px(ps.width);
      const h = px(ps.height);
      if (w === null || h === null) continue;
      const left = px(ps.left);
      const top = px(ps.top);
      const tx = new DOMMatrixReadOnly(ps.transform === 'none' ? undefined : ps.transform);
      const x = r.left + (left ?? (r.width - w) / 2) + tx.m41 + el.clientLeft;
      const y = r.top + (top ?? (r.height - h) / 2) + tx.m42 + el.clientTop;
      // A clipped pseudo-element takes no taps outside the clip.
      const pl = Math.max(x, clip.l);
      const pt = Math.max(y, clip.t);
      const pr = Math.min(x + w, clip.r);
      const pb = Math.min(y + h, clip.b);
      if (pr <= pl || pb <= pt) continue;
      box = {
        l: Math.min(box.l, pl),
        t: Math.min(box.t, pt),
        r: Math.max(box.r, pr),
        b: Math.max(box.b, pb),
      };
    }
    return box;
  };
  const nameOf = (el) =>
    (
      el.getAttribute('aria-label') ||
      el.innerText ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('type') ||
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
  const clsOf = (el) =>
    (typeof el.className === 'string' ? el.className : '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 3)
      .join('.');
  const owner = (node) => {
    for (let n = node; n; n = n.parentElement) if (set.has(n)) return n;
    return null;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const hit = hitArea(el, false);
    return {
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      cls: clsOf(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      hitW: Math.round(hit.r - hit.l),
      hitH: Math.round(hit.b - hit.t),
      x: Math.round(r.left),
      y: Math.round(r.top),
      fs: getComputedStyle(el).fontSize,
    };
  };
  // Occlusion is not overlap: a target hidden under a sheet, backdrop or
  // sticky bar is not reachable, so only targets that receive a tap at their
  // own box somewhere take part, and a clash where one box swallows the other
  // whole (a backdrop under a sheet) is layering, not overlap.
  const hittable = (el) => {
    const r = el.getBoundingClientRect();
    for (let y = r.top + grid / 2; y < r.bottom; y += grid) {
      if (y < 0 || y >= innerHeight) continue;
      for (let x = r.left + grid / 2; x < r.right; x += grid) {
        if (x < 0 || x >= innerWidth) continue;
        const at = document.elementFromPoint(x, y);
        if (at && (el === at || el.contains(at))) return true;
      }
    }
    return false;
  };
  const swallows = (outer, inner) => {
    const o = outer.getBoundingClientRect();
    const i = inner.getBoundingClientRect();
    // Compared within the viewport: a sheet's rows may run past its bottom.
    const ib = Math.min(i.bottom, innerHeight);
    const ir = Math.min(i.right, innerWidth);
    return o.left <= i.left && o.top <= Math.max(i.top, 0) && o.right >= ir && o.bottom >= ib;
  };
  const small = [];
  const overlaps = [];
  for (const el of els) {
    const own = hitArea(el);
    // Wholly clipped away by an ancestor: not on screen, not a target.
    if (own.r <= own.l || own.b <= own.t) continue;
    const d = describe(el);
    if (d.hitW < min || d.hitH < min) small.push(d);
    if (!hittable(el)) continue;
    const hit = hitArea(el);
    const clashes = new Map();
    for (let y = hit.t + grid / 2; y < hit.b; y += grid) {
      if (y < 0 || y >= innerHeight) continue;
      for (let x = hit.l + grid / 2; x < hit.r; x += grid) {
        if (x < 0 || x >= innerWidth) continue;
        const at = document.elementFromPoint(x, y);
        if (!at) continue;
        const o = owner(at);
        if (
          !o ||
          o === el ||
          el.contains(o) ||
          o.contains(el) ||
          swallows(o, el) ||
          swallows(el, o)
        )
          continue;
        clashes.set(o, (clashes.get(o) || 0) + 1);
      }
    }
    for (const [o, points] of clashes) overlaps.push({ a: d, b: describe(o), points });
  }
  return { small, overlaps };
}

async function measure(p) {
  return p.evaluate(measureInPage, { min: MIN, grid: GRID });
}

async function boot(baseUrl) {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 380, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  await mockOpenRouter(ctx);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34, top: 47 } });
  await p.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await p.getByText('Just this device').click();
  await p.getByLabel('Username').fill('sweep');
  await p.getByRole('button', { name: /continue/i }).click();
  const pw = p.locator('input[type=password]');
  await pw.nth(0).fill('correct horse battery 42');
  await pw.nth(1).fill('correct horse battery 42');
  await p.getByRole('button', { name: /continue/i }).click();
  await p.locator('input[type=checkbox]').check();
  await p.getByRole('button', { name: /open chatsundere/i }).click();
  await p.waitForURL(/\/app/);
  await p.waitForTimeout(1500);
  return { b, p };
}

/** Runs one setup step; a failure is recorded, not fatal. */
async function step(notes, label, fn) {
  try {
    await fn();
  } catch (err) {
    notes.push(`${label}: ${String(err?.message ?? err).split('\n')[0]}`);
  }
}

async function sendAndWait(p, text, expectedReplies) {
  await p.locator('textarea.cockpit-input').fill(text);
  await p.getByRole('button', { name: 'Send', exact: true }).click();
  await p.waitForFunction(
    (n) => document.body.innerText.includes(`reply number ${n},`),
    expectedReplies,
    {
      timeout: 15000,
    },
  );
  await p.waitForTimeout(1500);
}

async function sweep(baseUrl) {
  const { b, p } = await boot(baseUrl);
  const screens = {};
  const notes = [];
  const path = () => p.url().replace(baseUrl, '');
  const snap = async (key) => {
    screens[key] = await measure(p);
  };

  // Provider and persona with a model.
  await go(p, '/app/settings/providers');
  await step(notes, 'add-provider sheet', async () => {
    await p.getByRole('button', { name: /add provider/i }).click();
    await p.waitForTimeout(800);
    await snap('sheet:add-provider');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  });
  await go(p, '/app/settings/providers/openrouter');
  await p.locator('input[placeholder="sk-..."]').fill('sk-or-v1-0000000000000000000000000000');
  await snap('/app/settings/providers/openrouter (unsaved)');
  await p.getByRole('button', { name: /test & save/i }).click();
  await p.waitForTimeout(2500);
  await snap('/app/settings/providers/openrouter (saved)');

  await go(p, '/app/circle');
  await p.getByRole('button', { name: 'New persona' }).click();
  await p.waitForTimeout(800);
  await p.locator('input[type=text]').first().fill('Aiko');
  await p.getByRole('button', { name: 'Create persona' }).click();
  await p.waitForTimeout(1500);
  const pid = p.url().split('/').pop();
  await p.getByText('Choose a model').click();
  await p.waitForTimeout(1000);
  await snap('sheet:model-picker');
  await p.locator('[role=dialog] button').filter({ hasText: 'ChatGPT 4o' }).first().click();
  await p.waitForTimeout(800);
  await p.locator('[role=dialog] button').filter({ hasText: 'OpenRouter' }).first().click();
  await p.waitForTimeout(800);

  // A knowledge library with one document.
  let libraryUrl = null;
  await step(notes, 'knowledge library', async () => {
    await go(p, '/app/knowledge/new');
    await p.locator('input[placeholder="e.g. Worldbuilding"]').fill('Sweep library');
    await p.getByRole('button', { name: 'Create library' }).click();
    await p.waitForTimeout(1200);
    libraryUrl = path();
    await go(p, `${libraryUrl}/new`);
    await p.locator('input[placeholder="Untitled"]').fill('Sweep document');
    await p
      .locator('textarea')
      .first()
      .fill('A short document so the library has a row to measure.');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await p.waitForTimeout(1200);
  });

  // Static routes.
  const routes = [
    '/app',
    '/app/circle',
    `/app/persona/${pid}`,
    ...[
      'font-voice',
      'instructions',
      'integrations',
      'knowledge',
      'mindspace',
      'model',
      'roleplay',
      'memory',
    ].map((s) => `/app/persona/${pid}/${s}`),
    '/app/history',
    '/app/treasury',
    '/app/treasury/templates',
    '/app/treasury/templates/new',
    '/app/knowledge',
    '/app/knowledge/new',
    '/app/integrations',
    '/app/integrations/new',
    '/app/settings',
    '/app/settings/you',
    '/app/settings/providers',
    '/app/settings/web',
    '/app/settings/voice',
    '/app/settings/images',
    '/app/settings/expert',
    '/app/settings/previews',
    '/app/account',
    '/app/account/biometric',
    '/app/account/recovery',
    '/app/account/server-linking',
    '/app/account/recently-deleted',
    '/app/account/about',
    '/app/account/devtools',
  ];
  for (const r of routes) {
    await go(p, r);
    await snap(r + (path() === r ? '' : ` -> ${path()}`));
  }

  // Content screens: the library and its document.
  if (libraryUrl) {
    await go(p, '/app/knowledge');
    await snap('/app/knowledge (one library)');
    await go(p, libraryUrl);
    await snap('/app/knowledge/:libraryId (one document)');
    await step(notes, 'knowledge document', async () => {
      await p.getByText('Sweep document').first().click();
      await p.waitForTimeout(1000);
      await snap('/app/knowledge/:libraryId/:documentId');
    });
  }

  // A chat with two replies.
  await go(p, `/app/persona/${pid}`);
  await p.getByRole('button', { name: 'New Chat' }).click();
  await p.waitForTimeout(2000);
  await snap('/app/chat/new (cockpit)');
  let chatUrl = null;
  await step(notes, 'chat with two replies', async () => {
    await sendAndWait(p, 'Hello there, this is the first message of the sweep.', 1);
    await sendAndWait(p, 'And a second one so there are two replies.', 2);
    chatUrl = path();
    await snap('/app/chat/:chatId (two replies)');
  });
  if (chatUrl) {
    // Tapping a message expands it and shows its action row.
    await step(notes, 'message actions', async () => {
      await p.locator('.msg .msg-text').first().click();
      await p.waitForTimeout(800);
      await snap('/app/chat/:chatId (user message actions)');
      await p.locator('.msg .msg-text').last().click();
      await p.waitForTimeout(800);
      await snap('/app/chat/:chatId (reply actions)');
    });
    await step(notes, 'bookmark', async () => {
      await p.locator('.msg.expanded [title="Bookmark this message"]').last().click();
      await p.waitForTimeout(1000);
      await snap('/app/chat/:chatId (after bookmark)');
      await go(p, `${chatUrl}/bookmarks`);
      await snap('/app/chat/:chatId/bookmarks');
    });
    await go(p, '/app/history');
    await snap('/app/history (one chat)');
    await step(notes, 'history bookmarks', async () => {
      const tab = p
        .getByRole('tab', { name: /bookmarks/i })
        .or(p.getByRole('button', { name: /bookmarks/i }));
      await tab.first().click();
      await p.waitForTimeout(1000);
      await snap('/app/history (bookmarks)');
    });
  }

  await b.close();
  return { screens, notes };
}

function table(result) {
  const lines = [];
  for (const [screen, { small, overlaps }] of Object.entries(result.screens)) {
    lines.push(`## ${screen}`);
    for (const e of small) {
      const hit = e.hitW !== e.w || e.hitH !== e.h ? ` (hit ${e.hitW}x${e.hitH})` : '';
      lines.push(
        `  ${`${e.w}x${e.h}`.padStart(8)}${hit.padEnd(16)} ${e.tag.padEnd(8)} ${e.name.slice(0, 36).padEnd(36)} ${e.cls}`,
      );
    }
    for (const o of overlaps) {
      lines.push(
        `  OVERLAP ${o.a.tag} "${o.a.name.slice(0, 28)}" -> ${o.b.tag} "${o.b.name.slice(0, 28)}" (${o.points} pts)`,
      );
    }
  }
  const overlapCount = Object.values(result.screens).reduce((n, s) => n + s.overlaps.length, 0);
  const smallCount = Object.values(result.screens).reduce((n, s) => n + s.small.length, 0);
  lines.push('');
  lines.push(
    `Screens: ${Object.keys(result.screens).length}  Undersized: ${smallCount}  Overlaps: ${overlapCount}`,
  );
  for (const n of result.notes) lines.push(`Not reached: ${n}`);
  return { text: `${lines.join('\n')}\n`, overlapCount };
}

const args = parseArgs(process.argv.slice(2));
const result = await sweep(args.url);
const { text, overlapCount } = table(result);
if (args.out) {
  writeFileSync(`${args.out}.json`, JSON.stringify(result, null, 1));
  writeFileSync(`${args.out}.txt`, text);
}
process.stdout.write(text);
if (overlapCount > 0 && !args.allowOverlap) process.exit(1);
