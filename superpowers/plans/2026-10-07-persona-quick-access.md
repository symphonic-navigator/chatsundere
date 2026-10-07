# Persona Quick Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give new personas a default instruction that clears on focus, replace the persona hub's History button with a "Recent chats" accordion, and add a quick menu to the chat opened from the brand logo and the interaction-mode hamburger.

**Architecture:** Three frontend-only units in `apps/user-client`. (1) A default-instruction constant plus an opt-in clear-on-focus mode on the shared `InlineEditTextarea`. (2) A self-contained `RecentChatsAccordion` component on the hub, persisting its open state in `localStorage`, linking to the History page with `?personaId`, `?q` and `?return`. (3) A `ChatQuickMenu` portal rendered once by `chat-page.tsx` (which knows the persona even in a lazy, unsent chat), opened from `root.tsx`'s logo and `InteractionTopbar`'s hamburger through a small `quickMenuAnchor` field in the current-chat Zustand store. Destination pages gain `?return=` via the existing `safeReturnPath` validator.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 18, React Router, Zustand, TanStack Query, Tailwind v4, lucide-react, Vitest + Testing Library, Biome, pnpm + Turborepo.

**Spec:** `superpowers/specs/2026-10-07-persona-quick-access-design.md` — read it before Task 1. Where this plan and the spec differ, **this plan wins**; the deliberate refinements are listed under "Spec refinements".

## Global Constraints

- Every text artefact is **British English** (code, identifiers, comments, test names, commit messages, user-facing copy, Markdown).
- Default instruction text, verbatim: `You are a friendly assistant.`
- `localStorage` key, verbatim: `chatsundere.hub.recentChatsOpen`, values `'1'` / `'0'`; absent or unreadable → collapsed. Every read and write wrapped in `try/catch`.
- Accordion shows at most **10** chats, newest first by `lastMessageAt`.
- Copy, verbatim: `Recent chats`, `History →`, `All in History →`, `Filter chats…`, `No chats yet`, `No chats match "<text>"`, `Quick menu`, `Entrance Hall`, `New chat with <name>`, `You're in a new chat`, `Loading persona…`, `Memories`, `History`, `Knowledge`, `Image settings`, `Pick a model, then <name> can chat.`, `Add an instruction, then <name> can chat.`, `Add an instruction and pick a model, then <name> can chat.`, `Default · ` (prefix).
- Mobile-first at 380 px; tap targets ≥ 44 px in the quick menu.
- **Do not touch** any file the parallel unified-image-models work owns: `packages/llm-unified/**`, `apps/user-client/src/components/image-gen/**`, `apps/user-client/src/data/send-message.ts`, `apps/user-client/src/tools/generate-image.ts`, `apps/user-client/src/boot/client-data-db.ts`, `apps/user-client/src/data/artefacts.ts`, `apps/user-client/src/attachments/**`, `apps/user-client/tests/components/image-gen-section.test.tsx`, `apps/user-client/tests/component/settings-images.test.tsx`. No Dexie version bump.
- No non-null assertion operator (`!` postfix) — Biome rejects it. No `any` without an inline comment.
- Every new component file starts with `// SPDX-License-Identifier: AGPL-3.0-only`.
- Every exported function/component carries at least a one-line JSDoc.

## Spec refinements (this plan wins)

1. **Constant location.** `DEFAULT_PERSONA_INSTRUCTIONS` lives in a new `src/lib/persona-defaults.ts` (not `persona-draft.ts`), because `src/lib/persona-hub.ts` needs it too and `lib/` must not import from `routes/`. `persona-draft.ts` imports it.
2. **Clear-on-focus location.** The spec put the behaviour "in the instructions page, not in the shared `InlineEditTextarea`". The draft state is internal to `InlineEditTextarea`, so the behaviour is an **opt-in prop** `clearOnFocusValue` on that component; only the Custom Instructions field passes it. Other fields are unaffected (the spec's intent).
3. **Incomplete cue.** `missingRequirement()` returns only the *first* missing item, so it cannot express "both missing". A new `incompleteCue(persona)` helper in `persona-hub.ts` computes the three-way copy.
4. **Hub import fallback.** The hub's own import-with-overwrite path (`hub.tsx` ~line 289) gets the same empty-instructions → default fallback as the create form, so an import never makes a persona incomplete on instructions.
5. **Memories target.** In a saved chat the quick menu links `…/memory?chat=<chatId>` (the existing cockpit convention, which also enables the memory page's chat-path actions); in a lazy, unsent chat it links `…/memory?return=<chat>`. The memory page honours `?return=` with precedence over `?chat=`.
6. **Action row.** With History gone, the hub's 2-column action row holds three buttons; `New Incognito` spans both columns (`col-span-2`) so no button sits alone half-width.

## Review Focus

1. **A tap inside the quick menu while an unpinned cockpit is open** must navigate on the first tap and must not collapse the cockpit — pinned by the cockpit-interplay test in Task 6.
2. **Escape while the quick menu is open in interaction mode** must close only the menu, not the cockpit or anything else listening for Escape — pinned in Task 5 (capture-phase listener + `stopPropagation`) and Task 6.
3. **Return paths carrying their own query strings** (a lazy chat `/app/chat/new?personaId=p1`, a hub with its own `?return=`) must survive encoding and come back intact — pinned in Tasks 3 and 5.
4. **History page URL mirroring** must not drop `return` / `q` when it rewrites `personaId` — pinned in Task 3.
5. **Chats still loading on the hub** (`chats === undefined`) must never flash the disabled "No chats yet" state — pinned in Task 4.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/persona-defaults.ts` (new) | Default instruction constant + import fallback helper | 1 |
| `src/routes/app/persona/persona-draft.ts` | New drafts start with the default | 1 |
| `src/lib/persona-hub.ts` | `Default · ` meta prefix; `incompleteCue()` | 1 |
| `src/routes/app/persona/create.tsx`, `hub.tsx` (import + cue only) | Import fallback; derived cue | 1 |
| `src/routes/app/settings/InlineEditTextarea.tsx` | Opt-in `clearOnFocusValue` | 2 |
| `src/routes/app/persona/instructions.tsx` | Passes `clearOnFocusValue` | 2 |
| `src/routes/app/history.tsx` | `?q=` initial search; `?return=` back; mirroring keeps params | 3 |
| `src/routes/app/persona/knowledge.tsx`, `settings/images.tsx`, `persona-memory.tsx` | `?return=` back | 3 |
| `src/components/persona-hub/RecentChatsAccordion.tsx` (new) | The accordion | 4 |
| `src/routes/app/persona/hub.tsx` (action row) | Remove History button, mount accordion | 4 |
| `src/state/current-chat.store.ts` | `quickMenuAnchor` + open/close | 5 |
| `src/components/chat/ChatQuickMenu.tsx` (new) | The quick menu portal | 5 |
| `src/index.css` | Quick-menu entry animation | 5 |
| `src/routes/root.tsx` | Logo → quick-menu button on the chat route | 6 |
| `src/components/chat/InteractionTopbar.tsx`, `InteractionMode.tsx` | Hamburger → quick menu; exemption selector | 6 |
| `src/routes/app/chat/chat-page.tsx` | Renders the menu; closes it on route change | 6 |
| `src/content/help/*.md`, `obsidian/insights/ux-deferrals.md` | Copy + follow-up | 7 |

All paths below are relative to `apps/user-client/` unless they start with `obsidian/` or `superpowers/`.

**Commands** (from the repo root):
- One test file: `cd apps/user-client && pnpm exec vitest run <path>`
- Full user-client suite: `cd apps/user-client && pnpm exec vitest run`
- Typecheck (covers tests): `pnpm --filter @chatsundere/user-client typecheck`
- Lint: `pnpm exec biome check apps/user-client`

---

### Task 1: Default instruction, derived cue, `Default ·` meta

**Files:**
- Create: `src/lib/persona-defaults.ts`
- Modify: `src/routes/app/persona/persona-draft.ts:27`
- Modify: `src/lib/persona-hub.ts:18-22` (and add `incompleteCue`)
- Modify: `src/routes/app/persona/create.tsx` (`onApplyImport`, ~line 88)
- Modify: `src/routes/app/persona/hub.tsx` (import ~line 289; cue ~lines 407-412)
- Test: `tests/unit/persona-hub.test.ts` (extend), `tests/lib/persona-defaults.test.ts` (new), `tests/routes/app/persona-hub.test.tsx` (extend)

**Interfaces:**
- Produces: `DEFAULT_PERSONA_INSTRUCTIONS: string` and `instructionsOrDefault(raw: string): string` from `src/lib/persona-defaults.ts`; `incompleteCue(p: PersonaRow): string | null` from `src/lib/persona-hub.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/persona-defaults.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DEFAULT_PERSONA_INSTRUCTIONS, instructionsOrDefault } from '../../src/lib/persona-defaults.js';
import { defaultDraft } from '../../src/routes/app/persona/persona-draft.js';

describe('persona defaults', () => {
  it('the default instruction is the friendly-assistant line', () => {
    expect(DEFAULT_PERSONA_INSTRUCTIONS).toBe('You are a friendly assistant.');
  });

  it('a new draft starts with the default instruction', () => {
    expect(defaultDraft(undefined, undefined, undefined).instructions).toBe(
      DEFAULT_PERSONA_INSTRUCTIONS,
    );
  });

  it('instructionsOrDefault keeps real imported instructions', () => {
    expect(instructionsOrDefault('Be a pirate.')).toBe('Be a pirate.');
  });

  it('instructionsOrDefault falls back to the default for empty or blank imports', () => {
    expect(instructionsOrDefault('')).toBe(DEFAULT_PERSONA_INSTRUCTIONS);
    expect(instructionsOrDefault('   \n ')).toBe(DEFAULT_PERSONA_INSTRUCTIONS);
  });
});
```

Append to `tests/unit/persona-hub.test.ts` (add `incompleteCue` to the existing import from `../../src/lib/persona-hub.js`, and add `import { DEFAULT_PERSONA_INSTRUCTIONS } from '../../src/lib/persona-defaults.js';`). Inside the existing top-level `describe` (or a new one at the end of the file):

```ts
describe('instructionsMeta — default instruction', () => {
  it('prefixes Default · when the instruction is exactly the default', () => {
    expect(instructionsMeta({ ...base, instructions: DEFAULT_PERSONA_INSTRUCTIONS })).toBe(
      'Default · Chatsundere voice',
    );
  });

  it('keeps the adult suffix after the prefix', () => {
    expect(
      instructionsMeta({ ...base, instructions: DEFAULT_PERSONA_INSTRUCTIONS, adultPersona: true }),
    ).toBe('Default · Chatsundere voice · Adult');
  });

  it('does not prefix an edited default', () => {
    expect(
      instructionsMeta({ ...base, instructions: `${DEFAULT_PERSONA_INSTRUCTIONS} And funny.` }),
    ).toBe('Chatsundere voice');
  });
});

describe('incompleteCue', () => {
  const named = { ...base, name: 'Fable' };

  it('returns null for a complete persona', () => {
    expect(incompleteCue(named)).toBeNull();
  });

  it('names only the model when only the model is missing', () => {
    expect(incompleteCue({ ...named, canonicalId: null })).toBe('Pick a model, then Fable can chat.');
  });

  it('names only the instruction when only the instruction is missing', () => {
    expect(incompleteCue({ ...named, instructions: '  ' })).toBe(
      'Add an instruction, then Fable can chat.',
    );
  });

  it('names both when both are missing', () => {
    expect(incompleteCue({ ...named, instructions: '', modelId: '' })).toBe(
      'Add an instruction and pick a model, then Fable can chat.',
    );
  });

  it('falls back to "this persona" without a name', () => {
    expect(incompleteCue({ ...named, name: '', modelId: '' })).toBe(
      'Pick a model, then this persona can chat.',
    );
  });
});
```

If `base` in that file has no `name` field typed, the spread `{ ...base, name: 'Fable' }` still type-checks because `base` is used as a `PersonaRow`; if the file declares `base` with `as PersonaRow`, keep that pattern.

Append to `tests/routes/app/persona-hub.test.tsx` (add `import { DEFAULT_PERSONA_INSTRUCTIONS } from '../../../src/lib/persona-defaults.js';` at the top):

```tsx
describe('PersonaHub — fresh persona with the default instruction and no model', () => {
  const FRESH = {
    ...INCOMPLETE_PERSONA,
    id: 'p-fresh',
    name: 'Fable',
    instructions: DEFAULT_PERSONA_INSTRUCTIONS,
  };

  it('the cue asks only for a model', async () => {
    state.persona = FRESH;
    state.chats = [];
    renderHub('p-fresh');
    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());
    expect(screen.getByText('Pick a model, then Fable can chat.')).toBeInTheDocument();
    expect(screen.queryByText(/add an instruction/i)).toBeNull();
  });

  it('the Instructions tile shows the Default prefix', async () => {
    state.persona = FRESH;
    state.chats = [];
    renderHub('p-fresh');
    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());
    expect(screen.getByText('Default · Chatsundere voice')).toBeInTheDocument();
  });
});
```

`state.persona`'s declared type is a union of the two fixture types; `FRESH` is structurally `typeof INCOMPLETE_PERSONA`, so it assigns.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm exec vitest run tests/lib/persona-defaults.test.ts tests/unit/persona-hub.test.ts tests/routes/app/persona-hub.test.tsx`
Expected: FAIL — `persona-defaults.js` cannot be resolved; `incompleteCue` is not exported; the hub still renders the combined cue.

- [ ] **Step 3: Implement**

Create `src/lib/persona-defaults.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** The instruction every new persona starts with: chat-ready out of the box,
 *  and cleared the moment the user focuses the field to write their own. */
export const DEFAULT_PERSONA_INSTRUCTIONS = 'You are a friendly assistant.';

/** Imported instructions, or the default when the import carries none — an
 *  import must never leave a persona incomplete on instructions. */
export function instructionsOrDefault(raw: string): string {
  return raw.trim() ? raw : DEFAULT_PERSONA_INSTRUCTIONS;
}
```

In `src/routes/app/persona/persona-draft.ts`, add the import and replace `instructions: '',`:

```ts
import { DEFAULT_PERSONA_INSTRUCTIONS } from '../../../lib/persona-defaults.js';
// …
    instructions: DEFAULT_PERSONA_INSTRUCTIONS,
```

In `src/lib/persona-hub.ts`, add `import { DEFAULT_PERSONA_INSTRUCTIONS } from './persona-defaults.js';`, replace `instructionsMeta`, and add `incompleteCue` directly below `missingRequirement`:

```ts
/** The hub's calm cue for an incomplete persona, naming only what is actually
 *  missing; null when the persona can chat. */
export function incompleteCue(p: PersonaRow): string | null {
  const noModel = !p.canonicalId || !p.providerId || !p.modelId;
  const noInstructions = !p.instructions.trim();
  const name = p.name || 'this persona';
  if (noModel && noInstructions) return `Add an instruction and pick a model, then ${name} can chat.`;
  if (noModel) return `Pick a model, then ${name} can chat.`;
  if (noInstructions) return `Add an instruction, then ${name} can chat.`;
  return null;
}

export function instructionsMeta(p: PersonaRow): string {
  if (!p.instructions.trim()) return 'Needs setup';
  const voice = p.chatsundereTonality ? 'Chatsundere voice' : 'Plain voice';
  const meta = p.adultPersona ? `${voice} · Adult` : voice;
  // A persona still on the default instruction is flagged quietly — an
  // invitation to personalise, not a nag.
  return p.instructions === DEFAULT_PERSONA_INSTRUCTIONS ? `Default · ${meta}` : meta;
}
```

In `src/routes/app/persona/create.tsx` `onApplyImport`, add `import { instructionsOrDefault } from '../../../lib/persona-defaults.js';` and change the overwrite line:

```ts
            instructions: instructionsOrDefault(a.persona.instructions),
```

In `src/routes/app/persona/hub.tsx`:
- add `import { instructionsOrDefault } from '../../../lib/persona-defaults.js';`
- add `incompleteCue` to the import list from `../../../lib/persona-hub.js`
- in the import handler (~line 289) change `instructions: a.persona.instructions,` to `instructions: instructionsOrDefault(a.persona.instructions),`
- replace the incomplete-cue block (~lines 407-412):

```tsx
        {/* Incomplete persona cue — names only what is missing (spec §4.3) */}
        {incomplete ? (
          <p className="text-[11px] text-paper-soft">{incompleteCue(persona)}</p>
        ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/lib/persona-defaults.test.ts tests/unit/persona-hub.test.ts tests/routes/app/persona-hub.test.tsx tests/routes/app/persona-create.test.tsx tests/routes/persona-draft-background.test.ts`
Expected: PASS. The existing hub test `renders the calm incomplete-persona sentence` (both missing) still matches `/add an instruction and pick a model/i`.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/persona-defaults.ts apps/user-client/src/routes/app/persona/persona-draft.ts apps/user-client/src/lib/persona-hub.ts apps/user-client/src/routes/app/persona/create.tsx apps/user-client/src/routes/app/persona/hub.tsx apps/user-client/tests/lib/persona-defaults.test.ts apps/user-client/tests/unit/persona-hub.test.ts apps/user-client/tests/routes/app/persona-hub.test.tsx
git commit -m "Give new personas a default instruction"
```

---

### Task 2: Clear the default on focus, restore it on an empty blur

**Files:**
- Modify: `src/routes/app/settings/InlineEditTextarea.tsx`
- Modify: `src/routes/app/persona/instructions.tsx` (~line 136, the Custom Instructions field)
- Test: `tests/routes/app/persona-instructions.test.tsx` (extend)

**Interfaces:**
- Consumes: `DEFAULT_PERSONA_INSTRUCTIONS` (Task 1).
- Produces: optional prop `clearOnFocusValue?: string` on `InlineEditTextareaProps`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/routes/app/persona-instructions.test.tsx` (add `import { DEFAULT_PERSONA_INSTRUCTIONS } from '../../../src/lib/persona-defaults.js';`):

```tsx
describe('PersonaInstructions — default instruction clears on focus', () => {
  it('focusing the exact default clears the field', async () => {
    state.persona = { ...BASE_PERSONA, instructions: DEFAULT_PERSONA_INSTRUCTIONS };
    renderPage('p-1');
    const textarea = (await screen.findByRole('textbox', {
      name: /custom instructions/i,
    })) as HTMLTextAreaElement;
    expect(textarea.value).toBe(DEFAULT_PERSONA_INSTRUCTIONS);
    fireEvent.focus(textarea);
    expect(textarea.value).toBe('');
  });

  it('blurring while still empty restores the default without a write', async () => {
    state.persona = { ...BASE_PERSONA, instructions: DEFAULT_PERSONA_INSTRUCTIONS };
    renderPage('p-1');
    const textarea = (await screen.findByRole('textbox', {
      name: /custom instructions/i,
    })) as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    fireEvent.blur(textarea);
    expect(textarea.value).toBe(DEFAULT_PERSONA_INSTRUCTIONS);
    expect(state.patch).not.toHaveBeenCalled();
  });

  it('typing after the clear saves the new text', async () => {
    state.persona = { ...BASE_PERSONA, instructions: DEFAULT_PERSONA_INSTRUCTIONS };
    renderPage('p-1');
    const textarea = await screen.findByRole('textbox', { name: /custom instructions/i });
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: 'Speak like a pirate.' } });
    fireEvent.blur(textarea);
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith({ instructions: 'Speak like a pirate.' }),
    );
  });

  it('an edited default is not cleared on focus', async () => {
    const edited = `${DEFAULT_PERSONA_INSTRUCTIONS} And funny.`;
    state.persona = { ...BASE_PERSONA, instructions: edited };
    renderPage('p-1');
    const textarea = (await screen.findByRole('textbox', {
      name: /custom instructions/i,
    })) as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    expect(textarea.value).toBe(edited);
  });

  it('a non-default value cleared by hand still saves empty (unchanged behaviour)', async () => {
    state.persona = { ...BASE_PERSONA, instructions: 'Be wise.' };
    renderPage('p-1');
    const textarea = await screen.findByRole('textbox', { name: /custom instructions/i });
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.blur(textarea);
    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ instructions: '' }));
  });

  it('the About Me field never clears on focus, even with the default text', async () => {
    state.persona = { ...BASE_PERSONA, aboutMeOverride: DEFAULT_PERSONA_INSTRUCTIONS };
    renderPage('p-1');
    const about = (await screen.findByRole('textbox', {
      name: /what the model knows about you/i,
    })) as HTMLTextAreaElement;
    fireEvent.focus(about);
    expect(about.value).toBe(DEFAULT_PERSONA_INSTRUCTIONS);
  });
});
```

`BASE_PERSONA.aboutMeOverride` is typed `null`; if the spread `aboutMeOverride: DEFAULT_PERSONA_INSTRUCTIONS` fails to type-check, widen the fixture with `aboutMeOverride: null as string | null` in `BASE_PERSONA`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm exec vitest run tests/routes/app/persona-instructions.test.tsx`
Expected: FAIL — the first two cases (value stays the default on focus).

- [ ] **Step 3: Implement**

In `src/routes/app/settings/InlineEditTextarea.tsx`, add to `InlineEditTextareaProps`:

```ts
  /** When the field holds exactly this value, focusing clears it; leaving it
   *  empty restores the value without a write. For placeholder-like defaults
   *  that are real stored values (the default persona instruction). */
  clearOnFocusValue?: string;
```

Destructure `clearOnFocusValue` in the component signature, add a ref beside the others:

```ts
  // True while the field was cleared on focus — an empty blur then restores
  // the stored value instead of saving an empty one.
  const clearedOnFocusRef = useRef(false);
```

and replace the textarea's `onFocus` / `onBlur`:

```tsx
        onFocus={() => {
          focusedRef.current = true;
          if (clearOnFocusValue !== undefined && draft === clearOnFocusValue) {
            clearedOnFocusRef.current = true;
            setDraft('');
          }
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          if (clearedOnFocusRef.current) {
            clearedOnFocusRef.current = false;
            if (draft.trim() === '') {
              // Back to the stored value: commit() then sees no change, so no write.
              setDraft(valueRef.current);
              return;
            }
          }
          void commit();
        }}
```

In `src/routes/app/persona/instructions.tsx`, add `import { DEFAULT_PERSONA_INSTRUCTIONS } from '../../../lib/persona-defaults.js';` and pass the prop on the Custom Instructions field only:

```tsx
          <InlineEditTextarea
            label="Custom Instructions"
            value={persona.instructions}
            helper="Who this persona is."
            minRows={5}
            clearOnFocusValue={DEFAULT_PERSONA_INSTRUCTIONS}
            onSave={(v) => patch({ instructions: v })}
          />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/routes/app/persona-instructions.test.tsx`
Expected: PASS (all old and new cases).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/settings/InlineEditTextarea.tsx apps/user-client/src/routes/app/persona/instructions.tsx apps/user-client/tests/routes/app/persona-instructions.test.tsx
git commit -m "Clear the default instruction on focus"
```

---

### Task 3: Return paths and the History search parameter

**Files:**
- Modify: `src/routes/app/history.tsx` (~lines 21-72 and the `PageScaffold` `back`, ~line 123)
- Modify: `src/routes/app/persona/knowledge.tsx`
- Modify: `src/routes/app/settings/images.tsx` (imports + `back` only — do not touch anything else in this file)
- Modify: `src/routes/app/persona-memory.tsx` (~line 59)
- Test: `tests/unit/history-route.test.tsx` (extend), `tests/routes/app/persona-knowledge.test.tsx` (extend), `tests/routes/persona-memory.test.tsx` (extend), `tests/routes/settings-images-return.test.tsx` (new)

**Interfaces:**
- Consumes: `safeReturnPath(raw, fallback)` from `src/lib/safe-return.ts` (existing).
- Produces: the URL contract `?return=<site-relative path>` on `/app/history`, `/app/persona/:id/knowledge`, `/app/persona/:id/memory`, `/app/settings/images`; `?q=<text>` on `/app/history`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/history-route.test.tsx` (inside or after `describe('HistoryPage', …)`; its `beforeEach` resets the DB). Add a route for the return target to `renderHistory` first: inside `<Routes>` add

```tsx
          <Route path="/app/persona/:id" element={<div data-testid="hub" />} />
```

and add a location probe so mirroring can be asserted. At the top of the file add `useLocation` to the `react-router-dom` import and:

```tsx
function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}
```

Render `<LocationProbe />` inside `<MemoryRouter>` next to `<Routes>`. Then the tests:

```tsx
describe('HistoryPage — q and return parameters', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('?q= pre-fills the search field and filters', async () => {
    await seed();
    renderHistory('/app/history?q=book');
    await screen.findByText('about books');
    const input = document.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input.value).toBe('book');
    expect(screen.queryByText('private chat')).toBeNull();
  });

  it('?return= drives the back control', async () => {
    const { sfwId } = await seed();
    renderHistory(`/app/history?personaId=${sfwId}&return=${encodeURIComponent(`/app/persona/${sfwId}`)}`);
    await screen.findByText('about books');
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('hub')).toBeInTheDocument());
  });

  it('an off-origin ?return= falls back to /app', async () => {
    await seed();
    renderHistory(`/app/history?return=${encodeURIComponent('//evil.example')}`);
    await screen.findByText('about books');
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('entrance')).toBeInTheDocument());
  });

  it('clearing the persona filter keeps return and q in the URL', async () => {
    const { sfwId } = await seed();
    const ret = encodeURIComponent('/app/persona/x');
    renderHistory(`/app/history?personaId=${sfwId}&q=book&return=${ret}`);
    await screen.findByText('about books');
    fireEvent.click(screen.getByRole('button', { name: 'Filter by persona' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => {
      const loc = screen.getByTestId('location').textContent ?? '';
      expect(loc).not.toContain('personaId=');
      expect(loc).toContain('q=book');
      expect(loc).toContain(`return=${ret}`);
    });
  });
});
```

Before relying on the `'All'` option name, open `src/components/history/PersonaFilterDropdown.tsx` and use the exact accessible name of its "all personas" option (adjust the test string to match; do not change the component).

Append to `tests/routes/app/persona-knowledge.test.tsx`. Its existing render helper hard-codes the URL; add a second helper in the file:

```tsx
function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/persona/:id/knowledge" element={<PersonaKnowledge />} />
          <Route path="/app/persona/:id" element={<div data-testid="hub-sentinel" />} />
          <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PersonaKnowledge — return path', () => {
  it('?return= drives the back control', async () => {
    state.persona = BASE_PERSONA;
    renderAt(`/app/persona/p-1/knowledge?return=${encodeURIComponent('/app/chat/c1')}`);
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument());
  });

  it('without ?return= back goes to the persona hub', async () => {
    state.persona = BASE_PERSONA;
    renderAt('/app/persona/p-1/knowledge');
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('hub-sentinel')).toBeInTheDocument());
  });

  it('an off-origin ?return= falls back to the persona hub', async () => {
    state.persona = BASE_PERSONA;
    renderAt(`/app/persona/p-1/knowledge?return=${encodeURIComponent('https://evil.example')}`);
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('hub-sentinel')).toBeInTheDocument());
  });
});
```

Append to `tests/routes/persona-memory.test.tsx` inside `describe('PersonaMemory — shell', …)` (its `setup(path)` helper already exists; add a route `<Route path="/app/chat/new" element={<div data-testid="lazy-chat-sentinel" />} />` to its `<Routes>`):

```tsx
  it('?return= beats ?chat= for the back control', async () => {
    setup(`/app/persona/p1/memory?chat=c1&return=${encodeURIComponent('/app/chat/new?personaId=p1')}`);
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('lazy-chat-sentinel')).toBeInTheDocument());
  });

  it('an off-origin ?return= falls back to the ?chat= target', async () => {
    setup(`/app/persona/p1/memory?chat=c1&return=${encodeURIComponent('//evil.example')}`);
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument());
  });
```

Note: `/app/chat/new` must be declared **before** `/app/chat/:chatId` is irrelevant in React Router v6 (static segments rank higher), so order does not matter.

Create `tests/routes/settings-images-return.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SettingsImagesPage } from '../../src/routes/app/settings/images.js';

// The page's heavy children are irrelevant to the back control.
vi.mock('../../src/components/image-gen/ImageGenerationSection.js', () => ({
  ImageGenerationSection: () => <div data-testid="image-gen-section" />,
}));
vi.mock('../../src/components/ModelSlotPicker.js', () => ({
  ModelSlotPicker: () => <div data-testid="model-slot-picker" />,
}));
vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { substituteVisionModel: null } }),
  useUpdateSettings: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock('../../src/lib/server-gate.js', () => ({ useServerGate: () => ({ enabled: false }) }));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/settings/images" element={<SettingsImagesPage />} />
          <Route path="/app/settings" element={<div data-testid="settings-sentinel" />} />
          <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsImagesPage — return path', () => {
  it('?return= drives the back control', async () => {
    renderAt(`/app/settings/images?return=${encodeURIComponent('/app/chat/c1')}`);
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument());
  });

  it('without ?return= back goes to My Settings', async () => {
    renderAt('/app/settings/images');
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('settings-sentinel')).toBeInTheDocument());
  });
});
```

If the page imports another hook that fails under these mocks (the parallel image work may have changed the page's imports by the time this runs), mock that module the same way — never edit the page beyond its `back`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm exec vitest run tests/unit/history-route.test.tsx tests/routes/app/persona-knowledge.test.tsx tests/routes/persona-memory.test.tsx tests/routes/settings-images-return.test.tsx`
Expected: FAIL — `?q=` ignored, back controls ignore `?return=`, mirroring drops parameters only if it rebuilt them (it currently copies `search`, so that case may already pass; that is fine — it pins the behaviour).

- [ ] **Step 3: Implement**

`src/routes/app/history.tsx`:
- add `import { safeReturnPath } from '../../lib/safe-return.js';`
- replace `const [searchQuery, setSearchQuery] = useState('');` with

```ts
  // `?q=` seeds the search once (the hub's Recent chats filter carries its text
  // here); the field is not mirrored back into the URL.
  const [searchQuery, setSearchQuery] = useState(() => search.get('q') ?? '');
  const backPath = safeReturnPath(search.get('return'), '/app');
```

- change `back="/app"` on the `PageScaffold` to `back={backPath}`.
- leave both URL-mirroring effects as they are: they build `next` from the current `search`, so `return` and `q` survive. The new test pins that.

`src/routes/app/persona/knowledge.tsx`:
- change the router import to `import { Link, useParams, useSearchParams } from 'react-router-dom';` and add `import { safeReturnPath } from '../../../lib/safe-return.js';`
- right after `const { persona, patch } = usePersonaEditing(id ?? null);` add

```ts
  const [search] = useSearchParams();
  const back = safeReturnPath(search.get('return'), `/app/persona/${id ?? ''}`);
```

- delete the two local `const back = …` declarations (inside the not-found guard and before the render) and use this `back` everywhere, including the loading guard's `back={…}`. Breadcrumb `to` values stay as they are (`/app/persona/${id}` for the persona crumb).

`src/routes/app/settings/images.tsx`:
- add `import { useSearchParams } from 'react-router-dom';` and `import { safeReturnPath } from '../../../lib/safe-return.js';`
- inside `SettingsImagesPage`, first line: `const [search] = useSearchParams();`
- change `back="/app/settings"` to `back={safeReturnPath(search.get('return'), '/app/settings')}`.

`src/routes/app/persona-memory.tsx` (~line 59): add `import { safeReturnPath } from '../../lib/safe-return.js';` (check the relative depth: the file is `src/routes/app/persona-memory.tsx`, so it is `../../lib/safe-return.js`) and replace the `backPath` line:

```ts
  // `?return=` (the chat quick menu, incl. a lazy unsent chat) wins over the
  // cockpit's `?chat=` convention; both fall back to the persona hub.
  const backPath = safeReturnPath(
    search.get('return'),
    chatId ? `/app/chat/${chatId}` : `/app/persona/${personaId}`,
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/unit/history-route.test.tsx tests/routes/app/persona-knowledge.test.tsx tests/routes/persona-memory.test.tsx tests/routes/settings-images-return.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/history.tsx apps/user-client/src/routes/app/persona/knowledge.tsx apps/user-client/src/routes/app/settings/images.tsx apps/user-client/src/routes/app/persona-memory.tsx apps/user-client/tests/unit/history-route.test.tsx apps/user-client/tests/routes/app/persona-knowledge.test.tsx apps/user-client/tests/routes/persona-memory.test.tsx apps/user-client/tests/routes/settings-images-return.test.tsx
git commit -m "Honour return paths on History, Knowledge, Memory and Images"
```

---

### Task 4: Recent chats accordion on the persona hub

**Files:**
- Create: `src/components/persona-hub/RecentChatsAccordion.tsx`
- Modify: `src/routes/app/persona/hub.tsx` (action row ~lines 367-405)
- Test: `tests/components/persona-hub/RecentChatsAccordion.test.tsx` (new), `tests/routes/app/persona-hub.test.tsx` (extend + fix the action-label list)

**Interfaces:**
- Consumes: `ChatRow` from `src/boot/client-data-db.js` (type only); `displayTitle(chat)` from `src/lib/chat-title.js`; `relativeTimeLabel(ts)` from `src/lib/relative-time.js`.
- Produces: `RecentChatsAccordion(props: { personaId: string; chats: ChatRow[] | undefined; returnTo: string }): JSX.Element`; exported constant `RECENT_CHATS_OPEN_KEY = 'chatsundere.hub.recentChatsOpen'`.

- [ ] **Step 1: Write the failing component tests**

Create `tests/components/persona-hub/RecentChatsAccordion.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRow } from '../../../src/boot/client-data-db.js';
import {
  RECENT_CHATS_OPEN_KEY,
  RecentChatsAccordion,
} from '../../../src/components/persona-hub/RecentChatsAccordion.js';

function chat(n: number, personaId = 'p1', title: string | null = `Chat ${n}`): ChatRow {
  return {
    id: `c${n}`,
    personaId,
    title,
    resolvedMindspaceId: 'ms',
    createdAt: n,
    updatedAt: n,
    lastMessageAt: 1000 + n,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  } as ChatRow;
}

// useChats() returns chats ordered newest first; mirror that.
const fifteen = Array.from({ length: 15 }, (_, i) => chat(i + 1)).reverse();

function Probe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAcc(chats: ChatRow[] | undefined, returnTo = '/app/persona/p1') {
  return render(
    <MemoryRouter initialEntries={['/app/persona/p1']}>
      <Routes>
        <Route
          path="/app/persona/:id"
          element={<RecentChatsAccordion personaId="p1" chats={chats} returnTo={returnTo} />}
        />
        <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel" />} />
        <Route path="/app/history" element={<div data-testid="history-sentinel" />} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
}

const toggle = () => screen.getByRole('button', { name: /recent chats/i });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('RecentChatsAccordion', () => {
  it('is collapsed by default with a History link and no list', () => {
    renderAcc(fifteen);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'History →' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /chat 15/i })).toBeNull();
  });

  it('expanding persists "1"; a remount reads it back; collapsing writes "0"', () => {
    const { unmount } = renderAcc(fifteen);
    fireEvent.click(toggle());
    expect(localStorage.getItem(RECENT_CHATS_OPEN_KEY)).toBe('1');
    unmount();
    renderAcc(fifteen);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle());
    expect(localStorage.getItem(RECENT_CHATS_OPEN_KEY)).toBe('0');
  });

  it('still toggles when storage throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderAcc(fifteen);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('expanded: the 10 newest chats, newest first, and All in History', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    const list = screen.getByRole('list', { name: 'Recent chats' });
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toContain('Chat 15');
    expect(rows[9]?.textContent).toContain('Chat 6');
    expect(screen.getByRole('link', { name: 'All in History →' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'History →' })).toBeNull();
  });

  it('ignores chats of other personas', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc([chat(99, 'p2', 'Foreign chat'), chat(1)]);
    expect(screen.queryByText('Foreign chat')).toBeNull();
    expect(screen.getByText('Chat 1')).toBeInTheDocument();
  });

  it('the filter searches all chats, case-insensitively', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    const chats = [...fifteen];
    // Chat 2 is outside the newest ten; give it a distinctive title.
    const idx = chats.findIndex((c) => c.id === 'c2');
    chats[idx] = { ...chat(2), title: 'Bach evening' } as ChatRow;
    renderAcc(chats);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter chats' }), {
      target: { value: 'BACH' },
    });
    const rows = within(screen.getByRole('list', { name: 'Recent chats' })).getAllByRole('link');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Bach evening');
  });

  it('no matches: an empty line, and All in History stays', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter chats' }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No chats match "zzz"')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All in History →' })).toBeInTheDocument();
  });

  it('zero chats (loaded): disabled toggle and a visible No chats yet', () => {
    renderAcc([]);
    expect(toggle()).toBeDisabled();
    expect(screen.getByText('No chats yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'History →' })).toBeNull();
  });

  it('chats loading (undefined): never shows the disabled state', () => {
    renderAcc(undefined);
    expect(toggle()).not.toBeDisabled();
    expect(screen.queryByText('No chats yet')).toBeNull();
    expect(screen.getByRole('link', { name: 'History →' })).toBeInTheDocument();
  });

  it('History link carries personaId and return, but no q when the filter is empty', () => {
    renderAcc(fifteen, '/app/persona/p1?return=%2Fapp%2Fchat%2Fc9');
    fireEvent.click(screen.getByRole('link', { name: 'History →' }));
    const loc = screen.getByTestId('location').textContent ?? '';
    const params = new URLSearchParams(loc.split('?')[1]);
    expect(loc.startsWith('/app/history?')).toBe(true);
    expect(params.get('personaId')).toBe('p1');
    expect(params.get('q')).toBeNull();
    expect(params.get('return')).toBe('/app/persona/p1?return=%2Fapp%2Fchat%2Fc9');
  });

  it('All in History carries the trimmed filter as q', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter chats' }), {
      target: { value: '  chat 1 ' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'All in History →' }));
    const params = new URLSearchParams((screen.getByTestId('location').textContent ?? '').split('?')[1]);
    expect(params.get('q')).toBe('chat 1');
  });

  it('a row opens its chat', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    fireEvent.click(screen.getByRole('link', { name: /chat 15/i }));
    expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument();
  });

  it('collapsing clears the filter', () => {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, '1');
    renderAcc(fifteen);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter chats' }), {
      target: { value: 'zzz' },
    });
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect((screen.getByRole('searchbox', { name: 'Filter chats' }) as HTMLInputElement).value).toBe('');
  });
});
```

In `tests/routes/app/persona-hub.test.tsx`:
- change the action-label list in `no action button carries the gold marker` to `['Continue', 'New Chat', 'New Incognito']`;
- add a `beforeEach(() => localStorage.clear());` at file level (import `beforeEach` from vitest);
- append:

```tsx
describe('PersonaHub — Recent chats accordion', () => {
  it('the action row no longer has a History button', async () => {
    state.persona = COMPLETE_PERSONA;
    state.chats = [RECENT_CHAT];
    renderHub('p-complete');
    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
    expect(screen.getByRole('button', { name: /recent chats/i })).toBeInTheDocument();
  });

  it('the History link opens the History page for this persona', async () => {
    state.persona = COMPLETE_PERSONA;
    state.chats = [RECENT_CHAT];
    renderHub('p-complete');
    await waitFor(() => expect(screen.getByTestId('persona-hub')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('link', { name: 'History →' }));
    expect(screen.getByTestId('history-sentinel')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/persona-hub/RecentChatsAccordion.test.tsx tests/routes/app/persona-hub.test.tsx`
Expected: FAIL — module not found; hub still renders a `History` button.

- [ ] **Step 3: Implement the component**

Create `src/components/persona-hub/RecentChatsAccordion.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { ChevronRight } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChatRow } from '../../boot/client-data-db.js';
import { displayTitle } from '../../lib/chat-title.js';
import { relativeTimeLabel } from '../../lib/relative-time.js';

/** Device-local, persona-global open/closed state of the accordion. */
export const RECENT_CHATS_OPEN_KEY = 'chatsundere.hub.recentChatsOpen';

const LIMIT = 10;

function readOpen(): boolean {
  try {
    return localStorage.getItem(RECENT_CHATS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(RECENT_CHATS_OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage unavailable (private mode, blocked site data) — in-memory only.
  }
}

interface Props {
  personaId: string;
  /** All chats, newest first (as `useChats()` returns them); `undefined` while loading. */
  chats: ChatRow[] | undefined;
  /** The hub's own path incl. search, so the History page's back returns here. */
  returnTo: string;
}

/**
 * "Recent chats" on the persona hub (spec §2): the ten newest chats of this
 * persona, filterable by title across all of them, with one link into the full
 * History page — `History →` while collapsed, `All in History →` at the list end.
 */
export function RecentChatsAccordion({ personaId, chats, returnTo }: Props): JSX.Element {
  const listId = useId();
  const [open, setOpen] = useState(readOpen);
  const [filter, setFilter] = useState('');

  const personaChats = useMemo(
    () => (chats ?? []).filter((c) => c.personaId === personaId),
    [chats, personaId],
  );
  const q = filter.trim();
  const matches = useMemo(() => {
    const needle = q.toLowerCase();
    const hits =
      needle === ''
        ? personaChats
        : personaChats.filter((c) => displayTitle(c).toLowerCase().includes(needle));
    return hits.slice(0, LIMIT);
  }, [personaChats, q]);

  // "No chats" only once loaded — loading must never flash the disabled state.
  const empty = chats !== undefined && personaChats.length === 0;

  const historyParams = new URLSearchParams({ personaId });
  if (q !== '') historyParams.set('q', q);
  historyParams.set('return', returnTo);
  const historyHref = `/app/history?${historyParams.toString()}`;

  function toggle(): void {
    const next = !open;
    setOpen(next);
    writeOpen(next);
    if (!next) setFilter('');
  }

  const expanded = open && !empty;

  return (
    <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          disabled={empty}
          onClick={toggle}
          className="flex min-h-[44px] flex-1 items-center gap-1 text-left text-sm text-paper disabled:text-paper-soft/60"
        >
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          Recent chats
        </button>
        {empty ? (
          <span className="text-xs text-paper-soft/70">No chats yet</span>
        ) : !expanded ? (
          <Link to={historyHref} className="text-xs text-paper-soft hover:text-paper">
            History →
          </Link>
        ) : null}
      </div>

      {expanded ? (
        <div id={listId} className="mt-2 flex flex-col gap-2">
          <input
            type="search"
            aria-label="Filter chats"
            placeholder="Filter chats…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          />
          {matches.length === 0 && q !== '' ? (
            <p className="px-1 text-xs text-paper-soft">{`No chats match "${q}"`}</p>
          ) : (
            <ul aria-label="Recent chats" className="flex flex-col">
              {matches.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/app/chat/${c.id}`}
                    className="flex min-h-[40px] items-center justify-between gap-3 px-1 text-sm text-paper hover:text-paper"
                  >
                    <span className="min-w-0 truncate">{displayTitle(c)}</span>
                    <span className="shrink-0 text-xs text-paper-soft">
                      {relativeTimeLabel(c.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Link to={historyHref} className="text-xs text-paper-soft hover:text-paper">
              All in History →
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
```

Note: `aria-controls` points at an element only rendered while expanded; that is acceptable ARIA practice for disclosure widgets. While loading (`chats === undefined`) the list renders empty with no "no match" line because `q === ''`.

- [ ] **Step 4: Mount it in the hub**

In `src/routes/app/persona/hub.tsx`:
- add `import { RecentChatsAccordion } from '../../../components/persona-hub/RecentChatsAccordion.js';`
- delete the whole `History` `<Button>` (the one navigating to `/app/history?personaId=…`, ~lines 397-405);
- give `New Incognito` the full row: add `className="col-span-2"` to its `<Button>`;
- directly after the action row's closing `</div>` and **before** the incomplete-cue block, insert:

```tsx
        {/* A2. Recent chats — the persona's history without leaving it (spec §2) */}
        <RecentChatsAccordion
          personaId={persona.id}
          chats={chats.data}
          returnTo={`${location.pathname}${location.search}`}
        />
```

`location` is already in scope (`useLocation()` at the top of `PersonaHub`). `recentChat` stays — `Continue` still uses it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/persona-hub/RecentChatsAccordion.test.tsx tests/routes/app/persona-hub.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/persona-hub/RecentChatsAccordion.tsx apps/user-client/src/routes/app/persona/hub.tsx apps/user-client/tests/components/persona-hub/RecentChatsAccordion.test.tsx apps/user-client/tests/routes/app/persona-hub.test.tsx
git commit -m "Replace the hub's History button with a Recent chats accordion"
```

---

### Task 5: Quick-menu state and the `ChatQuickMenu` component

**Files:**
- Modify: `src/state/current-chat.store.ts`
- Create: `src/components/chat/ChatQuickMenu.tsx`
- Modify: `src/index.css` (append one block at the end)
- Test: `tests/components/chat/ChatQuickMenu.test.tsx` (new), `tests/state/current-chat-quick-menu.test.ts` (new)

**Interfaces:**
- Produces (store): `QuickMenuAnchor = { top: number; left: number; bottom: number }`; fields `quickMenuAnchor: QuickMenuAnchor | null`, `openQuickMenu(anchor: QuickMenuAnchor): void`, `closeQuickMenu(): void`.
- Produces (component): `anchorFrom(el: Element): QuickMenuAnchor`; `ChatQuickMenu(props: ChatQuickMenuProps): JSX.Element | null` with

```ts
export interface ChatQuickMenuProps {
  /** Null = closed. */
  anchor: QuickMenuAnchor | null;
  /** The chat's persona; null while it is still resolving. */
  persona: { id: string; name: string; colour: string } | null;
  /** The persisted chat id; null for a lazy, not-yet-sent chat. */
  activeChatId: string | null;
  /** `pathname + search` of the chat, used as every `?return=`. */
  returnTo: string;
  onClose: () => void;
  /** Leave to the Entrance Hall (resets interaction mode first). */
  onEntranceHall: () => void;
  onNavigate: (to: string) => void;
}
```

- [ ] **Step 1: Write the failing tests**

Create `tests/state/current-chat-quick-menu.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

describe('current-chat store — quick menu', () => {
  beforeEach(() => useCurrentChatStore.getState().reset());

  it('starts closed, opens with an anchor, closes again', () => {
    expect(useCurrentChatStore.getState().quickMenuAnchor).toBeNull();
    useCurrentChatStore.getState().openQuickMenu({ top: 1, left: 2, bottom: 3 });
    expect(useCurrentChatStore.getState().quickMenuAnchor).toEqual({ top: 1, left: 2, bottom: 3 });
    useCurrentChatStore.getState().closeQuickMenu();
    expect(useCurrentChatStore.getState().quickMenuAnchor).toBeNull();
  });

  it('reset closes it', () => {
    useCurrentChatStore.getState().openQuickMenu({ top: 1, left: 2, bottom: 3 });
    useCurrentChatStore.getState().reset();
    expect(useCurrentChatStore.getState().quickMenuAnchor).toBeNull();
  });
});
```

Create `tests/components/chat/ChatQuickMenu.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatQuickMenu, type ChatQuickMenuProps } from '../../../src/components/chat/ChatQuickMenu.js';

// PersonaAvatar reads the avatar store from the DB; a stub keeps this test pure.
vi.mock('../../../src/components/PersonaAvatar.js', () => ({
  PersonaAvatar: ({ name }: { name: string }) => <span data-testid="avatar">{name.slice(0, 1)}</span>,
}));

const persona = { id: 'p1', name: 'Fable', colour: '#c9a84c' };

function setup(over: Partial<ChatQuickMenuProps> = {}) {
  const props: ChatQuickMenuProps = {
    anchor: { top: 10, left: 12, bottom: 40 },
    persona,
    activeChatId: 'c1',
    returnTo: '/app/chat/c1',
    onClose: vi.fn(),
    onEntranceHall: vi.fn(),
    onNavigate: vi.fn(),
    ...over,
  };
  render(<ChatQuickMenu {...props} />);
  return props;
}

const item = (name: string | RegExp) => screen.getByRole('menuitem', { name });
const enc = encodeURIComponent;

describe('ChatQuickMenu', () => {
  it('renders nothing while closed', () => {
    setup({ anchor: null });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lists the seven entries in order', () => {
    setup();
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(labels).toEqual([
      'Entrance Hall',
      'FFable',
      'New chat with Fable',
      'Memories',
      'History',
      'Knowledge',
      'Image settings',
    ]);
  });

  it('focuses the first item on open', () => {
    setup();
    expect(item('Entrance Hall')).toHaveFocus();
  });

  it('Entrance Hall uses the exit handler, then closes', () => {
    const p = setup();
    fireEvent.click(item('Entrance Hall'));
    expect(p.onEntranceHall).toHaveBeenCalledTimes(1);
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it.each([
    [/^(F\s?)?Fable$/, `/app/persona/p1?return=${enc('/app/chat/c1')}`],
    ['New chat with Fable', '/app/chat/new?personaId=p1'],
    ['Memories', '/app/persona/p1/memory?chat=c1'],
    ['History', `/app/history?personaId=p1&return=${enc('/app/chat/c1')}`],
    ['Knowledge', `/app/persona/p1/knowledge?return=${enc('/app/chat/c1')}`],
    ['Image settings', `/app/settings/images?return=${enc('/app/chat/c1')}`],
  ])('%s navigates to %s and closes', (name, to) => {
    const p = setup();
    fireEvent.click(item(name));
    expect(p.onNavigate).toHaveBeenCalledWith(to);
    expect(p.onClose).toHaveBeenCalled();
  });

  it('in a lazy chat: entries enabled, New chat disabled with a visible reason, return keeps personaId', () => {
    const returnTo = '/app/chat/new?personaId=p1';
    const p = setup({ activeChatId: null, returnTo });
    expect(item(/new chat with fable/i)).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText("You're in a new chat")).toBeInTheDocument();
    fireEvent.click(item(/new chat with fable/i));
    expect(p.onNavigate).not.toHaveBeenCalled();
    fireEvent.click(item('Memories'));
    expect(p.onNavigate).toHaveBeenCalledWith(`/app/persona/p1/memory?return=${enc(returnTo)}`);
    fireEvent.click(item('Knowledge'));
    expect(p.onNavigate).toHaveBeenCalledWith(`/app/persona/p1/knowledge?return=${enc(returnTo)}`);
  });

  it('while the persona resolves: persona group disabled with Loading persona…', () => {
    const p = setup({ persona: null });
    expect(screen.getByText('Loading persona…')).toBeInTheDocument();
    expect(item('Memories')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Entrance Hall')).not.toHaveAttribute('aria-disabled');
    expect(item('Image settings')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(item('Memories'));
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it('backdrop tap closes', () => {
    const p = setup();
    fireEvent.click(screen.getByTestId('quick-menu-backdrop'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes and does not reach other listeners', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    const p = setup();
    fireEvent.keyDown(item('Entrance Hall'), { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
  });

  it('ArrowDown and ArrowUp move focus over enabled items, wrapping', () => {
    setup();
    fireEvent.keyDown(item('Entrance Hall'), { key: 'ArrowDown' });
    expect(item(/^(F\s?)?Fable$/)).toHaveFocus();
    fireEvent.keyDown(item(/^(F\s?)?Fable$/), { key: 'ArrowUp' });
    expect(item('Entrance Hall')).toHaveFocus();
    fireEvent.keyDown(item('Entrance Hall'), { key: 'ArrowUp' });
    expect(item('Image settings')).toHaveFocus();
  });

  it('the portal root carries the cockpit-exemption class', () => {
    setup();
    expect(document.querySelector('.chat-quick-menu-root')).not.toBeNull();
  });
});
```

The persona entry's accessible name is its avatar stub's letter plus the name (`FFable` or `F Fable`); the regex `/^(F\s?)?Fable$/` tolerates either way the avatar contributes. If the real `PersonaAvatar` is `aria-hidden`, the accessible name is `Fable`, which the regex also matches — do not change the regex.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm exec vitest run tests/state/current-chat-quick-menu.test.ts tests/components/chat/ChatQuickMenu.test.tsx`
Expected: FAIL — `openQuickMenu` is not a function; `ChatQuickMenu.js` not found.

- [ ] **Step 3: Implement the store fields**

In `src/state/current-chat.store.ts`:

```ts
/** Where the chat quick menu anchors (the trigger's viewport rect). */
export interface QuickMenuAnchor {
  top: number;
  left: number;
  bottom: number;
}
```

Add to `CurrentChatStore` (fields):

```ts
  /** Open chat quick menu, anchored to its trigger; null = closed. Opened from
   *  the brand logo (root.tsx) or the interaction-mode hamburger; rendered by
   *  chat-page, which owns the persona. */
  quickMenuAnchor: QuickMenuAnchor | null;
```

and (actions):

```ts
  openQuickMenu: (anchor: QuickMenuAnchor) => void;
  closeQuickMenu: () => void;
```

Add `| 'openQuickMenu' | 'closeQuickMenu'` to the `InitialState` `Omit` list, `quickMenuAnchor: null,` to `initial`, and to the store body:

```ts
  openQuickMenu: (anchor) => set({ quickMenuAnchor: anchor }),
  closeQuickMenu: () => set({ quickMenuAnchor: null }),
```

- [ ] **Step 4: Implement the component**

Create `src/components/chat/ChatQuickMenu.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { QuickMenuAnchor } from '../../state/current-chat.store.js';
import { PersonaAvatar } from '../PersonaAvatar.js';

/** Viewport anchor for the quick menu from its trigger element. */
export function anchorFrom(el: Element): QuickMenuAnchor {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom };
}

export interface ChatQuickMenuProps {
  /** Null = closed. */
  anchor: QuickMenuAnchor | null;
  /** The chat's persona; null while it is still resolving. */
  persona: { id: string; name: string; colour: string } | null;
  /** The persisted chat id; null for a lazy, not-yet-sent chat. */
  activeChatId: string | null;
  /** `pathname + search` of the chat, used as every `?return=`. */
  returnTo: string;
  onClose: () => void;
  /** Leave to the Entrance Hall (resets interaction mode first). */
  onEntranceHall: () => void;
  onNavigate: (to: string) => void;
}

interface Entry {
  key: string;
  label: React.ReactNode;
  /** Visible secondary line (a disabled reason never hides in a tooltip). */
  note?: string;
  disabled: boolean;
  run: () => void;
}

const GUTTER = 16;
const MIN_WIDTH = 224; // 14rem

/**
 * The chat's quick menu (spec §3): one surface, opened from the brand logo or
 * the interaction-mode hamburger. Portalled to <body>; the root carries
 * `.chat-quick-menu-root`, which InteractionMode exempts from its outside-tap
 * close so a tap here never collapses an unpinned cockpit.
 */
export function ChatQuickMenu(p: ChatQuickMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = p.anchor !== null;
  const { onClose } = p;
  // Dismissal without navigation hands focus back to the trigger.
  const dismiss = useCallback((): void => {
    onClose();
    returnFocusRef.current?.focus();
  }, [onClose]);

  // Escape is caught in the capture phase on window so it closes only this menu
  // and never reaches the cockpit or any other Escape listener.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, dismiss]);

  // Background inert while open; focus the first enabled item.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    return () => root?.removeAttribute('inert');
  }, [open]);

  if (!p.anchor) return null;

  const enc = encodeURIComponent(p.returnTo);
  const persona = p.persona;
  const go = (to: string) => () => {
    onClose();
    p.onNavigate(to);
  };
  const noop = (): void => undefined;

  const personaEntries: Entry[] = persona
    ? [
        {
          key: 'persona',
          label: (
            <span className="flex items-center gap-2">
              <PersonaAvatar personaId={persona.id} name={persona.name} colour={persona.colour} size={24} />
              <span>{persona.name}</span>
            </span>
          ),
          disabled: false,
          run: go(`/app/persona/${persona.id}?return=${enc}`),
        },
        {
          key: 'new-chat',
          label: `New chat with ${persona.name}`,
          note: p.activeChatId === null ? "You're in a new chat" : undefined,
          disabled: p.activeChatId === null,
          run: go(`/app/chat/new?personaId=${persona.id}`),
        },
        {
          key: 'memories',
          label: 'Memories',
          disabled: false,
          // A saved chat keeps the cockpit's `?chat=` convention (also enables
          // the memory page's chat-path actions); a lazy chat returns via `?return=`.
          run: go(
            p.activeChatId
              ? `/app/persona/${persona.id}/memory?chat=${p.activeChatId}`
              : `/app/persona/${persona.id}/memory?return=${enc}`,
          ),
        },
        {
          key: 'history',
          label: 'History',
          disabled: false,
          run: go(`/app/history?personaId=${persona.id}&return=${enc}`),
        },
        {
          key: 'knowledge',
          label: 'Knowledge',
          disabled: false,
          run: go(`/app/persona/${persona.id}/knowledge?return=${enc}`),
        },
      ]
    : [
        { key: 'persona', label: 'Persona', note: 'Loading persona…', disabled: true, run: noop },
        { key: 'memories', label: 'Memories', disabled: true, run: noop },
        { key: 'history', label: 'History', disabled: true, run: noop },
        { key: 'knowledge', label: 'Knowledge', disabled: true, run: noop },
      ];

  const groups: Entry[][] = [
    [
      {
        key: 'entrance',
        label: 'Entrance Hall',
        disabled: false,
        run: () => {
          onClose();
          p.onEntranceHall();
        },
      },
    ],
    personaEntries,
    [
      {
        key: 'images',
        label: 'Image settings',
        disabled: false,
        run: go(`/app/settings/images?return=${enc}`),
      },
    ],
  ];

  const left = Math.max(GUTTER, Math.min(p.anchor.left, window.innerWidth - GUTTER - MIN_WIDTH));
  const top = p.anchor.bottom + 6;

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [],
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div className="chat-quick-menu-root fixed inset-0 z-50">
      <div
        data-testid="quick-menu-backdrop"
        aria-hidden="true"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={dismiss}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Quick menu"
        tabIndex={-1}
        onKeyDown={onMenuKey}
        className="chat-quick-menu-card absolute flex min-w-[14rem] flex-col rounded-card border border-white/10 bg-black/80 py-1 shadow-lg"
        style={{ top, left }}
      >
        {groups.map((group, gi) => (
          <div key={group[0]?.key ?? gi} className={gi > 0 ? 'border-t border-white/10' : undefined}>
            {group.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                aria-disabled={entry.disabled || undefined}
                onClick={entry.disabled ? undefined : entry.run}
                className={`flex min-h-[44px] w-full flex-col items-start justify-center px-4 py-2 text-left text-sm ${
                  entry.disabled ? 'cursor-default text-paper-soft/50' : 'text-paper hover:bg-white/5'
                }`}
              >
                {entry.label}
                {entry.note ? <span className="text-[11px] text-paper-soft">{entry.note}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
```

Notes for the implementer:
- `aria-disabled` (not `disabled`) keeps disabled items readable and lets the visible note be part of the item. Clicks on them are no-ops.
- Biome may flag the backdrop `onClick` without a key handler; Escape is handled on `window`, so add the same suppression comment the codebase uses in `src/components/ui/PickerOverlay.tsx` (~line 140): `{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to dismiss; Escape is handled on window */}` directly above the backdrop `<div>`.
- `React.ReactNode` / `React.KeyboardEvent` need `import type React from 'react';` if the file does not otherwise have the `React` namespace in scope — follow whatever other `.tsx` files in `src/components/chat/` do.

Append to `src/index.css`:

```css
/* Chat quick menu — a short drop-in; still under reduced motion. */
.chat-quick-menu-card {
  animation: chat-quick-menu-in 140ms ease-out;
}
@keyframes chat-quick-menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .chat-quick-menu-card {
    animation: none;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/state/current-chat-quick-menu.test.ts tests/components/chat/ChatQuickMenu.test.tsx`
Expected: PASS. If the entry-order test's persona label differs only by how the avatar stub contributes text, adjust that **one expected string** to the rendered text, not the component.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/state/current-chat.store.ts apps/user-client/src/components/chat/ChatQuickMenu.tsx apps/user-client/src/index.css apps/user-client/tests/state/current-chat-quick-menu.test.ts apps/user-client/tests/components/chat/ChatQuickMenu.test.tsx
git commit -m "Add the chat quick menu component"
```

---

### Task 6: Wire the quick menu to the logo, the hamburger and the chat page

**Files:**
- Modify: `src/routes/root.tsx` (imports; logo ~lines 140-160)
- Modify: `src/components/chat/InteractionTopbar.tsx` (`Props.onExit` → `onOpenQuickMenu`; hamburger ~lines 67-75)
- Modify: `src/components/chat/InteractionMode.tsx` (`Props.onExit` ~line 48; pass-through ~line 186; exemption selector ~line 132)
- Modify: `src/routes/app/chat/chat-page.tsx` (store selectors ~line 99; `onExitToEntranceHall` ~line 521; `InteractionMode` props ~line 1162; render the menu inside the root `.chat-page` div)
- Test: `tests/routes/root.chat-chrome.test.tsx` (fix + extend), `tests/unit/interaction-topbar.test.tsx`, `tests/compaction/interaction-topbar-gauge.test.tsx`, `tests/unit/interaction-mode.test.tsx`, `tests/components/chat/InteractionMode.test.tsx` (prop rename + new cases)

**Interfaces:**
- Consumes: `QuickMenuAnchor`, `openQuickMenu`, `closeQuickMenu`, `quickMenuAnchor` (Task 5 store); `ChatQuickMenu`, `anchorFrom` (Task 5).
- Produces: `InteractionTopbar` / `InteractionMode` prop `onOpenQuickMenu: (trigger: HTMLElement) => void` (replaces `onExit`).

- [ ] **Step 1: Write the failing tests**

In `tests/routes/root.chat-chrome.test.tsx`, replace the test `renders exit affordance with correct aria-label in reading-chat mode` with:

```tsx
  it('in reading-chat mode the logo is a Quick menu button that opens the menu', () => {
    useCurrentChatStore.getState().setChatHeader({
      personaId: 'p1',
      name: 'Laura',
      colour: '#c44e8e',
      title: 'Evening at the harbour',
    });
    useCurrentChatStore.getState().setInteractionMode(false);
    renderAt('/app/chat/c1');
    expect(screen.queryByLabelText('Leave chat')).toBeNull();
    const logo = screen.getByRole('button', { name: 'Quick menu' });
    expect(logo).toHaveAttribute('aria-haspopup', 'menu');
    expect(logo).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(logo);
    expect(useCurrentChatStore.getState().quickMenuAnchor).not.toBeNull();
  });
```

and append inside `describe('Root brand-bar chrome trims inside a chat', …)`:

```tsx
  it('in interaction mode the logo is also the Quick menu button', () => {
    useCurrentChatStore.getState().setInteractionMode(true);
    renderAt('/app/chat/abc');
    fireEvent.click(screen.getByRole('button', { name: 'Quick menu' }));
    expect(useCurrentChatStore.getState().quickMenuAnchor).not.toBeNull();
  });

  it('outside a chat the logo stays a home link', () => {
    renderAt('/app');
    expect(screen.queryByRole('button', { name: 'Quick menu' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Chatsundere home' })).toBeInTheDocument();
  });
```

(`fireEvent` is already imported in that file.)

In `tests/unit/interaction-topbar.test.tsx`, `tests/compaction/interaction-topbar-gauge.test.tsx`, `tests/unit/interaction-mode.test.tsx` and `tests/components/chat/InteractionMode.test.tsx`: rename every `onExit={…}` passed to `<InteractionTopbar>` / `<InteractionMode>` to `onOpenQuickMenu={…}` (do **not** touch `onExit` on `LiveVoiceBar` or any other component). Mechanically:

```bash
cd apps/user-client
sed -i 's/onExit={/onOpenQuickMenu={/' tests/unit/interaction-topbar.test.tsx tests/compaction/interaction-topbar-gauge.test.tsx tests/unit/interaction-mode.test.tsx tests/components/chat/InteractionMode.test.tsx
rg -n "onExit|onOpenQuickMenu" tests/unit/interaction-topbar.test.tsx tests/compaction/interaction-topbar-gauge.test.tsx tests/unit/interaction-mode.test.tsx tests/components/chat/InteractionMode.test.tsx
```

Inspect the `rg` output: every hit must be on an `InteractionTopbar`/`InteractionMode` element. Then in `tests/unit/interaction-topbar.test.tsx` rewrite the first test:

```tsx
  it('hamburger opens the quick menu with itself as the trigger', () => {
    const onOpenQuickMenu = vi.fn();
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onOpenQuickMenu={onOpenQuickMenu}
        onRenameChat={vi.fn()}
      />,
    );
    const btn = container.querySelector('.hamburger-btn') as HTMLButtonElement;
    expect(btn).toHaveAttribute('aria-label', 'Quick menu');
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(onOpenQuickMenu).toHaveBeenCalledWith(btn);
  });
```

In `tests/components/chat/InteractionMode.test.tsx`, change `screen.getByLabelText('Exit to Entrance Hall')` (~line 235) to `screen.getByLabelText('Quick menu')` and update that test's comment to "quick menu + persona avatar". Then append the cockpit-interplay test (it uses the file's existing `renderInteractionMode` helper and `installMatchMedia(false)` = mobile, unpinned):

```tsx
it('a tap inside the quick menu does not collapse an unpinned cockpit (spec §3.5)', () => {
  installMatchMedia(false);
  renderInteractionMode();
  const root = document.createElement('div');
  root.className = 'chat-quick-menu-root';
  const entry = document.createElement('button');
  root.appendChild(entry);
  document.body.appendChild(root);
  const onClick = vi.fn();
  entry.addEventListener('click', onClick);

  fireEvent.pointerDown(entry);
  fireEvent.click(entry);

  expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
  expect(onClick).toHaveBeenCalledTimes(1);
  root.remove();
});
```

Before relying on the helper, confirm `renderInteractionMode` and `installMatchMedia` are the names used in that file (they are used at ~lines 220-235); `vi` and `useCurrentChatStore` are already imported there — add them to the imports if not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm exec vitest run tests/routes/root.chat-chrome.test.tsx tests/unit/interaction-topbar.test.tsx tests/components/chat/InteractionMode.test.tsx`
Expected: FAIL — no `Quick menu` button; `onOpenQuickMenu` unknown; the cockpit collapses on the menu tap.

- [ ] **Step 3: Implement `InteractionTopbar` and `InteractionMode`**

`src/components/chat/InteractionTopbar.tsx` — in `Props` replace `onExit: () => void;` with:

```ts
  /** Opens the chat quick menu anchored to the hamburger (spec §3.1). */
  onOpenQuickMenu: (trigger: HTMLElement) => void;
```

and the hamburger button:

```tsx
        <button
          type="button"
          className="hamburger-btn"
          aria-label="Quick menu"
          aria-haspopup="menu"
          aria-expanded={quickMenuOpen}
          onClick={(e) => p.onOpenQuickMenu(e.currentTarget)}
        >
```

with, at the top of `InteractionTopbar`'s body, `const quickMenuOpen = useCurrentChatStore((s) => s.quickMenuAnchor !== null);` and the import `import { useCurrentChatStore } from '../../state/current-chat.store.js';`.

`src/components/chat/InteractionMode.tsx` — in `Props` replace `onExit: () => void;` with the same `onOpenQuickMenu` declaration and JSDoc; in the `<InteractionTopbar …>` element replace `onExit={p.onExit}` with `onOpenQuickMenu={p.onOpenQuickMenu}`. Extend the exemption selector (~line 132):

```ts
      if (
        target instanceof Element &&
        target.closest(
          '.branch-sheet-root, .artefact-picker-root, .document-picker-root, .chat-quick-menu-root',
        )
      )
        return;
```

and extend the comment above it with one sentence: "The chat quick menu is portalled to <body> too; a tap there must navigate, not collapse the cockpit (spec §3.5)."

- [ ] **Step 4: Implement `root.tsx`**

Imports: replace `import { ArrowLeft } from 'lucide-react';` with `import { ChevronDown } from 'lucide-react';` and add `import { anchorFrom } from '../components/chat/ChatQuickMenu.js';`.

Inside `Root()` after `const chatHeader = …`:

```ts
  const quickMenuOpen = useCurrentChatStore((s) => s.quickMenuAnchor !== null);
  const openQuickMenu = useCurrentChatStore((s) => s.openQuickMenu);
```

Replace the whole `<Link to={isReadingChat ? '/app' : '/'} …>…</Link>` element with:

```tsx
            {isChatRoute ? (
              // Inside a chat the logo opens the quick menu (spec §3.1) in both
              // reading and interaction mode; leaving is its first entry.
              <button
                type="button"
                className={`brand-logo${isReadingChat ? ' brand-logo-small' : ''} flex items-center gap-1`}
                style={{ opacity: topbarLogoVisible ? 1 : 0 }}
                aria-label="Quick menu"
                aria-haspopup="menu"
                aria-expanded={quickMenuOpen}
                onClick={(e) => openQuickMenu(anchorFrom(e.currentTarget))}
              >
                <span
                  ref={(el) => {
                    topbarLogoRef.current = el;
                  }}
                  className="brand-logo-text"
                >
                  Chatsundere
                </span>
                <ChevronDown size={14} aria-hidden="true" className="text-paper-soft" />
              </button>
            ) : (
              <Link
                to="/"
                className="brand-logo flex items-center gap-1"
                style={{ opacity: topbarLogoVisible ? 1 : 0 }}
                aria-label="Chatsundere home"
              >
                <span
                  ref={(el) => {
                    topbarLogoRef.current = el;
                  }}
                  className="brand-logo-text"
                >
                  Chatsundere
                </span>
                <span className="brand-logo-twinkle" aria-hidden="true">
                  ✦
                </span>
              </Link>
            )}
```

Update the left-cluster comment above it: the logo is no longer a "leave chat" tap; in a chat it opens the quick menu. Off the chat route nothing changes (`/` link with twinkle, as before — `isReadingChat` was always false there).

- [ ] **Step 5: Implement `chat-page.tsx`**

Add `import { ChatQuickMenu } from '../../../components/chat/ChatQuickMenu.js';`. Next to the other store selectors (~line 99):

```ts
  const quickMenuAnchor = useCurrentChatStore((s) => s.quickMenuAnchor);
  const openQuickMenu = useCurrentChatStore((s) => s.openQuickMenu);
  const closeQuickMenu = useCurrentChatStore((s) => s.closeQuickMenu);
```

After `onExitToEntranceHall` / `onOpenPersonaEditor` (~line 530):

```ts
  const onOpenQuickMenu = (trigger: HTMLElement): void => {
    openQuickMenu(anchorFrom(trigger));
  };

  // The quick menu never outlives its route: close it on any navigation
  // (incl. chat → chat, where this page may stay mounted) and on unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on every location change by design
  useEffect(() => {
    closeQuickMenu();
  }, [location.pathname, location.search, closeQuickMenu]);
  useEffect(() => () => closeQuickMenu(), [closeQuickMenu]);
```

(Import `anchorFrom` alongside `ChatQuickMenu`. If Biome does not flag the first effect, drop the `biome-ignore` line — never leave an unused suppression.)

In the `<InteractionMode …>` props (~line 1162) replace `onExit={onExitToEntranceHall}` with `onOpenQuickMenu={onOpenQuickMenu}`. `onExitToEntranceHall` stays — the menu uses it.

Render the menu as the last child of the root `<div className="chat-page" …>` (just before its closing `</div>`, after the diagnostics `PickerOverlay` block):

```tsx
      <ChatQuickMenu
        anchor={quickMenuAnchor}
        persona={
          effectivePersona
            ? {
                id: effectivePersona.id,
                name: effectivePersona.name,
                colour: effectivePersona.colour,
              }
            : null
        }
        activeChatId={activeChatId}
        returnTo={`${location.pathname}${location.search}`}
        onClose={closeQuickMenu}
        onEntranceHall={onExitToEntranceHall}
        onNavigate={(to) => navigate(to)}
      />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/routes/root.chat-chrome.test.tsx tests/routes/root.brand-logo.test.tsx tests/unit/interaction-topbar.test.tsx tests/compaction/interaction-topbar-gauge.test.tsx tests/unit/interaction-mode.test.tsx tests/components/chat/InteractionMode.test.tsx tests/unit/chat-page.test.tsx tests/unit/chat-route.test.tsx`
Expected: PASS. If anything fails, run the same file on `master` in a throwaway worktree (`git worktree add /tmp/qa-master master`) before calling it pre-existing — never assume.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: exit 0. A leftover `onExit` on `InteractionMode`/`InteractionTopbar` anywhere shows up here.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/routes/root.tsx apps/user-client/src/components/chat/InteractionTopbar.tsx apps/user-client/src/components/chat/InteractionMode.tsx apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/tests/routes/root.chat-chrome.test.tsx apps/user-client/tests/unit/interaction-topbar.test.tsx apps/user-client/tests/compaction/interaction-topbar-gauge.test.tsx apps/user-client/tests/unit/interaction-mode.test.tsx apps/user-client/tests/components/chat/InteractionMode.test.tsx
git commit -m "Open the chat quick menu from the logo and the hamburger"
```

---

### Task 7: Help copy, follow-up log, full gates

**Files:**
- Modify: `src/content/help/persona.md`, `src/content/help/persona-instructions.md`, `src/content/help/history.md` (only where the copy is now wrong)
- Modify: `obsidian/insights/ux-deferrals.md`

- [ ] **Step 1: Update help copy**

`src/content/help/persona-instructions.md`, section "Custom Instructions" — replace the sentence "This field is required before the persona can start a chat." with:

```markdown
A new persona starts with a simple default — *You are a friendly assistant.* — so it can chat straight away. Tap the field and the default clears so you can write your own; leave it empty and the default comes back.
```

`src/content/help/persona.md`, section "After you create" — replace the "**Chat** — …" bullet with:

```markdown
- **Chat** — start a new conversation, continue the most recent one, or open **Recent chats** to see and filter this persona's last ten chats without leaving the page.
```

and make the last line read: `The persona is ready to chat as soon as it has a name and a model selected — it starts with a default instruction you can rewrite any time.`

`src/content/help/history.md` — read it; if it says History is reached from the persona's "History" button, change that to "from **Recent chats** on the persona page, or from the quick menu in a chat (tap the Chatsundere logo)". If it does not mention entry points, leave it unchanged.

- [ ] **Step 2: Log the follow-up**

Append to `obsidian/insights/ux-deferrals.md`, following the existing entry format in that file (read it first and mirror its heading/fields):

```markdown
### Hub "My Circle" crumb follows `?return=` (2026-10-07, Laura spec-pass on persona quick access)

- **Finding (soft, pre-existing):** `hub.tsx` (~line 341) uses `returnPath` for the "My Circle" breadcrumb. Arriving with `?return=<chat>` — now also from the chat quick menu — the crumb labelled "My Circle" leads to the chat.
- **Why deferred:** pre-existing; the spec keeps breadcrumbs unchanged. Fix with the next hub pass: the crumb should always go to `/app/circle`, only the back control should follow `?return=`.
```

- [ ] **Step 3: Full gates**

Run, in order, from the repo root:

```bash
pnpm --filter @chatsundere/user-client exec vitest run
pnpm turbo run typecheck --force --filter=@chatsundere/user-client
pnpm --filter @chatsundere/user-client build
pnpm exec biome check apps/user-client
```

Expected: vitest all green; if any failure appears, run the same file on `master` in a throwaway worktree before calling it pre-existing. Typecheck, build and Biome exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/content/help obsidian/insights/ux-deferrals.md
git commit -m "Document Recent chats, the quick menu and the default instruction"
```

---

## Manual verification (Chris, after integration)

Spec §6 steps 1–12, on a 380 px device and on desktop.
