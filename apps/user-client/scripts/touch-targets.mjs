// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Touch-target sweep for the user client (dev tool, not run in CI).
 *
 * Drives a running dev server in a 380 × 800 touch viewport with the iPhone
 * safe-area insets emulated, walks the onboarding wizards (each with its Back
 * link) and the recovery-key hold, onboards a throwaway local account, mocks
 * OpenRouter (key check and a streamed chat reply), creates a persona with a
 * model, a chat with two replies, a bookmark and a knowledge library with one
 * document, then visits every screen it can reach (the first-run state between
 * a provider and a persona, the chat's cockpit and quick menus, the voice
 * notes of an account without a voice provider and, last, the login screen
 * asking for the passphrase, with its recovery and start-over pages) and
 * reports. A second chat asks to add an MCP server: the mocked reply calls
 * `add_mcp_connector` with the user's link, so the connector card renders
 * (proposed, then dismissed with *Not now*), and *Check & add* opens the
 * prefilled Add-server screen against a mocked server that asks for an OAuth
 * sign-in (checking, then the sign-in settings, their *More settings* and
 * *Use a key instead*, the prefilled form).
 * The sweep then reports:
 *
 *   - undersized targets: every interactive element whose hit area is below
 *     44 px on either side. The hit area is the element's box united with its
 *     `::before`/`::after` box when that pseudo-element is absolutely
 *     positioned (the `.cs-hit` pattern), both cut by every overflow-clipping
 *     ancestor (a row with `overflow: hidden` clips what spills out of it).
 *     A control wrapped in its `<label>` also takes the label's hit area, and
 *     a point on any label counts as a point on the label's control.
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

/** An OpenAI-style SSE body that streams one call of `name`, its arguments in two deltas. */
function sseToolCall(name, args) {
  const json = JSON.stringify(args);
  const half = Math.ceil(json.length / 2);
  const delta = (tc) => ({
    id: 'gen-sweep',
    object: 'chat.completion.chunk',
    model: 'openai/gpt-4o',
    choices: [{ index: 0, delta: { tool_calls: [tc] } }],
  });
  const chunks = [
    delta({
      index: 0,
      id: 'call_sweep_connector',
      type: 'function',
      function: { name, arguments: json.slice(0, half) },
    }),
    delta({ index: 0, function: { arguments: json.slice(half) } }),
    {
      id: 'gen-sweep',
      object: 'chat.completion.chunk',
      model: 'openai/gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    },
  ];
  return `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
}

// The MCP server the connector chat proposes, and the authorisation server it names.
const CONNECTOR_URL = 'https://mcp.sweep-tools.com/mcp';
const CONNECTOR_ORIGIN = 'https://mcp.sweep-tools.com';
const AUTH_ORIGIN = 'https://auth.sweep-tools.com';

/** True when the last message of a chat request is the user's and carries the connector link. */
function asksForConnector(body) {
  const last = Array.isArray(body.messages) ? body.messages.at(-1) : null;
  return last?.role === 'user' && JSON.stringify(last.content ?? '').includes(CONNECTOR_URL);
}

let replyCount = 0;
async function mockOpenRouter(ctx) {
  await ctx.route('https://openrouter.ai/**', (route) => {
    const req = route.request();
    if (req.method() === 'POST' && /\/chat\/completions/.test(req.url())) {
      const body = JSON.parse(req.postData() || '{}');
      // The reply's first round calls the tool; the round after its result answers in words.
      if (body.stream !== false && asksForConnector(body)) {
        return route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
          body: sseToolCall('add_mcp_connector', { url: CONNECTOR_URL }),
        });
      }
      replyCount++;
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

/**
 * A public MCP server that asks for an OAuth sign-in (MCP authorisation spec): a 401 with
 * a protected-resource-metadata pointer, that document, and the authorisation server's
 * metadata, all with the CORS headers a direct browser check needs. The probe answers
 * after a pause, so the check's own screen can be measured while it runs.
 */
async function mockMcpServer(ctx) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-expose-headers': 'WWW-Authenticate',
  };
  const json = (route, value) =>
    route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  await ctx.route(`${CONNECTOR_ORIGIN}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.url().includes('/.well-known/oauth-protected-resource')) {
      return json(route, {
        resource: CONNECTOR_URL,
        authorization_servers: [AUTH_ORIGIN],
        resource_name: 'Sweep Tools',
      });
    }
    await new Promise((r) => setTimeout(r, 2500));
    return route.fulfill({
      status: 401,
      headers: {
        ...cors,
        'content-type': 'application/json',
        'www-authenticate': `Bearer resource_metadata="${CONNECTOR_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
      },
      body: '{}',
    });
  });
  await ctx.route(`${AUTH_ORIGIN}/**`, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.url().includes('/.well-known/oauth-authorization-server')) {
      return json(route, {
        issuer: AUTH_ORIGIN,
        authorization_endpoint: `${AUTH_ORIGIN}/authorize`,
        token_endpoint: `${AUTH_ORIGIN}/token`,
        registration_endpoint: `${AUTH_ORIGIN}/register`,
        code_challenge_methods_supported: ['S256'],
      });
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
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
    // A tap on a <label> is a tap on its control, so a control wrapped in its
    // label (a checkbox row) is hit wherever the label is.
    const label = el.tagName === 'INPUT' ? el.closest('label') : null;
    if (label) {
      const lb = hitArea(label, clipOwn);
      box = {
        l: Math.min(box.l, lb.l),
        t: Math.min(box.t, lb.t),
        r: Math.max(box.r, lb.r),
        b: Math.max(box.b, lb.b),
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
  // The control a point belongs to; a point on a label (wrapping or `for`)
  // belongs to the label's control.
  const owner = (node) => {
    for (let n = node; n; n = n.parentElement) {
      if (set.has(n)) return n;
      if (n.tagName === 'LABEL' && n.control && set.has(n.control)) return n.control;
    }
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

/**
 * Opens the app and walks the onboarding before setting up the local account:
 * the welcome screen, each wizard page with a Back link (the confirm pages need
 * a probed server, so they are expected to send the sweep elsewhere), the three
 * local steps and the recovery-key hold, which brings a user who leaves the
 * reveal straight back to it.
 */
async function boot(baseUrl, screens, notes) {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 380, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  await mockOpenRouter(ctx);
  await mockMcpServer(ctx);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34, top: 47 } });
  await p.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  const path = () => p.url().replace(baseUrl, '');
  const snap = async (key) => {
    screens[key] = await measure(p);
  };
  await snap(`onboarding: ${path()}`);
  for (const r of [
    '/onboarding/invitation',
    '/onboarding/invitation/scan',
    '/onboarding/invitation/confirm',
    '/onboarding/pairing',
    '/onboarding/pairing/scan',
    '/onboarding/pairing/confirm',
    '/onboarding/recovery',
  ]) {
    await go(p, r);
    await snap(`onboarding: ${r}${path() === r ? '' : ` -> ${path()}`}`);
  }
  await go(p, '/onboarding');
  await p.getByText('Just this device').click();
  await p.waitForTimeout(800);
  await snap('onboarding: /onboarding/local (step 1)');
  await p.getByLabel('Username').fill('sweep');
  await p.getByRole('button', { name: /continue/i }).click();
  const pw = p.locator('input[type=password]');
  await pw.nth(0).fill('correct horse battery 42');
  await pw.nth(1).fill('correct horse battery 42');
  await snap('onboarding: /onboarding/local (step 2)');
  await p.getByRole('button', { name: /continue/i }).click();
  await p.locator('input[type=checkbox]').waitFor();
  await snap('onboarding: /onboarding/local (step 3, recovery key)');
  await step(notes, 'recovery-key hold', async () => {
    await go(p, '/onboarding');
    await p.locator('input[type=checkbox]').waitFor({ timeout: 3000 });
    await snap(`onboarding: recovery-key hold (left for /onboarding -> ${path()})`);
  });
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
  const screens = {};
  const notes = [];
  const { b, p } = await boot(baseUrl, screens, notes);
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

  // First run between a provider and a persona: the providers page offers
  // "Next: create your first companion", the Entrance Hall its setup steps.
  await go(p, '/app/settings/providers');
  await snap('/app/settings/providers (provider, no persona)');
  await go(p, '/app');
  await snap('/app (provider, no persona)');

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
    // An id no persona has: the hub's not-found state and its way back.
    '/app/persona/sweep-missing',
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
    // The chat's menus and the voice notes a local account without a voice
    // provider reaches: each is opened, measured and closed again.
    await step(notes, 'cockpit menu', async () => {
      await go(p, chatUrl);
      await p.getByRole('button', { name: 'Open chat menu' }).click();
      await p.waitForTimeout(600);
      await snap('/app/chat/:chatId (cockpit menu)');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
    });
    await step(notes, 'quick menu', async () => {
      // The root header carries a second, hidden "Quick menu" button.
      await p.locator('button[aria-label="Quick menu"]:visible').first().click();
      await p.waitForTimeout(600);
      await snap('/app/chat/:chatId (quick menu)');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
    });
    // Without a voice provider the voice controls are aria-disabled, which
    // Playwright treats as not enabled, but a tap still shows why and the repair.
    await step(notes, 'live voice note', async () => {
      const live = p.getByRole('button', { name: 'Live voice mode' });
      await live.click({ force: true });
      await p.waitForTimeout(600);
      await snap('/app/chat/:chatId (live voice unavailable)');
      await live.click({ force: true });
      await p.waitForTimeout(400);
    });
    await step(notes, 'read note', async () => {
      await p.locator('.msg .msg-text').last().click();
      await p.waitForTimeout(800);
      await p
        .locator('.msg.expanded .ctrl-btn')
        .filter({ hasText: 'Read' })
        .last()
        .click({ force: true });
      // The note makes the reply taller; the stream does not follow, and the
      // floating "Scroll to end" would cover the row being measured.
      await p.evaluate(() => {
        const s = document.querySelector('.chat-stream');
        if (s) s.scrollTop = s.scrollHeight;
      });
      await p.waitForTimeout(800);
      await snap('/app/chat/:chatId (read unavailable note)');
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

  // A chat that asks to add an MCP server: the card, then the Add-server screens it opens.
  await step(notes, 'connector card', async () => {
    await go(p, `/app/persona/${pid}`);
    await p.getByRole('button', { name: 'New Chat' }).click();
    await p.waitForTimeout(2000);
    await p
      .locator('textarea.cockpit-input')
      .fill(`Please add this MCP server so you can use its tools: ${CONNECTOR_URL}`);
    await p.getByRole('button', { name: 'Send', exact: true }).click();
    await p.locator('.connector-pill').waitFor({ timeout: 15000 });
    await p.getByRole('button', { name: /check & add/i }).waitFor({ timeout: 5000 });
    await p.waitForTimeout(1500);
    await p.locator('.connector-pill').scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await snap('/app/chat/:chatId (connector card)');
    await p.getByRole('button', { name: 'Not now', exact: true }).click();
    await p.getByRole('button', { name: /add anyway/i }).waitFor({ timeout: 5000 });
    await p.waitForTimeout(400);
    await snap('/app/chat/:chatId (connector card, not now)');
    await p.getByRole('button', { name: /add anyway/i }).click();
    await p.getByRole('button', { name: /^checking /i }).waitFor({ timeout: 5000 });
    await snap('/app/integrations/new (from the card, checking)');
    await p.getByRole('button', { name: 'More settings' }).waitFor({ timeout: 15000 });
    await p.waitForTimeout(600);
    await snap('/app/integrations/new (from the card, sign-in required)');
    await p.getByRole('button', { name: 'More settings' }).click();
    await p.waitForTimeout(600);
    await snap('/app/integrations/new (from the card, more settings)');
    await p.getByRole('button', { name: 'Use a key instead' }).click();
    await p.getByRole('button', { name: 'Test connection' }).waitFor({ timeout: 5000 });
    await p.waitForTimeout(600);
    await snap('/app/integrations/new (from the card, key form)');
  });

  // Last, since unlocking would replace the session: the login screen the app
  // sends a session without a master key to, with "Not now" for a signed-in user.
  await step(notes, 'login (need passphrase)', async () => {
    await go(p, '/login?need=passphrase');
    await snap(`/login?need=passphrase${path().startsWith('/login') ? '' : ` -> ${path()}`}`);
  });
  // The login page's side trips, each with its own way back to sign-in.
  for (const r of ['/login/recovery', '/login/start-over']) {
    await go(p, r);
    await snap(r + (path() === r ? '' : ` -> ${path()}`));
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
