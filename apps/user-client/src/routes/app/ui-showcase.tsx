// SPDX-License-Identifier: AGPL-3.0-only
import { FolderKanban, Gem, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { MindspacePickerOverlay } from '../../components/MindspacePickerOverlay.js';
import type { MindspaceSelection } from '../../components/MindspacePickerOverlay.js';
import { ModelPickerOverlay } from '../../components/ModelPickerOverlay.js';
import { WebPickerOverlay } from '../../components/WebPickerOverlay.js';
import type { WebPickerValue } from '../../components/WebPickerOverlay.js';
import type { ModelSelection } from '../../components/model-picker/model-picker-data.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { ListRow } from '../../components/ui/ListRow.js';
import { ListScaffold } from '../../components/ui/ListScaffold.js';
import { NavTile } from '../../components/ui/NavTile.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { PickerField } from '../../components/ui/PickerField.js';
import { PickerOverlay } from '../../components/ui/PickerOverlay.js';
import { Pill } from '../../components/ui/Pill.js';
import { ReadingOverlay } from '../../components/ui/ReadingOverlay.js';
import type { WebBackendOption } from '../../lib/web-backend-options.js';

const SHOWCASE_PALETTE_A = {
  bg: '#0a0414',
  surfaceBase: '#150b26',
  surfaceRaised: '#1e1133',
  surfaceInput: '#271840',
  accent: '#c084fc',
  accentSubtle: '#a855f7',
  accentBorder: '#9333ea',
  accentBorderActive: '#7c3aed',
  accentGlow: '#d8b4fe',
  text: { primary: '#faf5ff', secondary: '#e9d5ff', muted: '#c084fc', ghost: '#7e22ce' },
};
const SHOWCASE_PALETTE_B = {
  bg: '#001a1a',
  surfaceBase: '#002626',
  surfaceRaised: '#003333',
  surfaceInput: '#004040',
  accent: '#22d3ee',
  accentSubtle: '#06b6d4',
  accentBorder: '#0891b2',
  accentBorderActive: '#0e7490',
  accentGlow: '#67e8f9',
  text: { primary: '#ecfeff', secondary: '#cffafe', muted: '#22d3ee', ghost: '#0e7490' },
};
const SHOWCASE_MINDSPACES = [
  {
    id: 'm1',
    displayName: 'Aurora',
    palette: SHOWCASE_PALETTE_A,
    texture: 'aurora' as const,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'm2',
    displayName: 'Grain',
    palette: SHOWCASE_PALETTE_B,
    texture: 'grain' as const,
    builtIn: true,
    createdAt: 0,
  },
];

const SHOWCASE_WEB_OPTIONS: WebBackendOption[] = [
  {
    providerId: 'p1',
    providerName: 'nano-gpt',
    upstreamSlug: 'web-brave-search',
    label: 'Brave',
    canSearch: true,
    canFetch: false,
    traits: ['recommended'],
    requiresProxy: false,
  },
  {
    providerId: 'p1',
    providerName: 'nano-gpt',
    upstreamSlug: 'web-fetch',
    label: 'nano-gpt',
    canSearch: false,
    canFetch: true,
    traits: [],
    requiresProxy: false,
  },
];

const SHOWCASE_SEARCH_TIERS = [
  { id: 'neural', label: 'Neural', params: {} },
  { id: 'deep', label: 'Deep', params: {} },
];

/**
 * Internal showcase of every design-language primitive — the live successor to
 * chatsundere-prototype.html. Reached at /app/ui-showcase. Not user-facing; the
 * device-test surface for the makeover foundation.
 */
const SAMPLE_MARKDOWN = `
# Privacy & Data Handling

Chatsundere is designed to be **zero-knowledge**: the server stores only ciphertext
and never sees your messages, passphrase, or keys.

## What we collect

- A randomly generated username (never your real name or email)
- Encrypted conversation blobs — unreadable without your master key

## What we never collect

- Your passphrase (OPAQUE means it never crosses the wire)
- Any plaintext message content
- IP-derived identity

## Your rights

You may delete your account at any time. Deletion is permanent and irreversible —
we cannot recover data we cannot read.

[Read the full licence →](https://github.com/chatsundere)
`;

export function UiShowcase(): JSX.Element {
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDirty, setPickerDirty] = useState(false);
  const [filter, setFilter] = useState('all');
  const [mindspacePickerOpen, setMindspacePickerOpen] = useState(false);
  const [mindspaceSelection, setMindspaceSelection] = useState<MindspaceSelection>({
    mindspaceId: 'm1',
    texture: 'aurora',
    font: 'serif',
  });
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [imageModelPickerOpen, setImageModelPickerOpen] = useState(false);
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null);
  const [imageModelSelection, setImageModelSelection] = useState<ModelSelection | null>(null);
  const [webPickerOpen, setWebPickerOpen] = useState(false);
  const [expertWebPickerOpen, setExpertWebPickerOpen] = useState(false);
  const [webPickerValue, setWebPickerValue] = useState<WebPickerValue>({
    search: null,
    fetch: null,
    searchTierId: null,
  });
  const [expertWebPickerValue, setExpertWebPickerValue] = useState<WebPickerValue>({
    search: null,
    fetch: null,
    searchTierId: 'neural',
  });
  const modelPickerTriggerRef = useRef<HTMLElement | null>(null);
  const imageModelPickerTriggerRef = useRef<HTMLElement | null>(null);
  const mindspaceTriggerRef = useRef<HTMLElement | null>(null);
  const webPickerTriggerRef = useRef<HTMLElement | null>(null);
  const expertWebPickerTriggerRef = useRef<HTMLElement | null>(null);
  const saveTrigger = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const readerTrigger = useRef<HTMLButtonElement>(null);

  return (
    <main className="mx-auto max-w-[420px] p-4">
      <h1 className="mb-4">UI primitives</h1>

      <section className="mb-6">
        <h3 className="mb-2">Buttons</h3>
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" priority>
            Save (gold)
          </Button>
          <Button tone="neutral">Cancel</Button>
          <Button tone="destructive">Delete</Button>
          <Button tone="primary">Primary</Button>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">Badges</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>13 personas</Badge>
          <Badge tone="success">Connected</Badge>
          <Badge tone="warning">Reconnecting</Badge>
          <Badge tone="danger">Offline</Badge>
          <Badge tone="new">NEW</Badge>
          <Badge count={3}>Inbox</Badge>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">Pills</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </Pill>
          <Pill active={filter === 'personas'} onClick={() => setFilter('personas')}>
            Personas
          </Pill>
          <Pill variant="tag" onRemove={() => {}}>
            #fiction
          </Pill>
          <Pill variant="add">+ Tag</Pill>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">Dialogs</h3>
        <div className="flex flex-wrap gap-2">
          <Button ref={saveTrigger} tone="primary" priority onClick={() => setSaveOpen(true)}>
            Open save dialog
          </Button>
          <Button ref={deleteTrigger} tone="destructive" onClick={() => setDeleteOpen(true)}>
            Open delete dialog
          </Button>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">Navigation tiles</h3>
        <div className="grid grid-cols-2 gap-3">
          <NavTile
            colour="pink"
            icon={Users}
            label="My Circle"
            meta="7 personas"
            to="/app/circle"
          />
          <NavTile
            colour="green"
            icon={FolderKanban}
            label="Projects"
            meta="3 active"
            to="/app/projects"
          />
          <NavTile colour="pink" icon={Gem} label="Continue" gold wide to="/app/chat" />
          <NavTile
            colour="purple"
            icon={Users}
            label="Archive"
            disabled
            disabledReason="Coming after the alpha"
          />
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">List (only the rows scroll)</h3>
        <div className="h-[280px] overflow-hidden rounded-2xl border border-white/10">
          <ListScaffold
            title="My Circle"
            count={3}
            onBack={() => {}}
            onHelp={() => {}}
            footer={
              <Button tone="primary" priority className="w-full">
                + New persona
              </Button>
            }
          >
            <ListRow
              leading={
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-aurora-700">
                  F
                </span>
              }
              title="Fable"
              subtitle="flagship companion"
              trailing={<Badge tone="success">active</Badge>}
              onOpen={() => {}}
              overflow={[
                { label: 'New chat' },
                { label: 'New incognito chat' },
                { label: 'Pin', disabled: true, disabledReason: 'Pinning lands next round' },
                { label: 'Delete', tone: 'destructive' },
              ]}
            />
            <ListRow
              leading={
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-aurora-700">
                  L
                </span>
              }
              title="Lyra"
              subtitle="design sparring"
              trailing={<Badge>8 chats</Badge>}
              onOpen={() => {}}
            />
            <ListRow
              leading={
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-aurora-700">
                  N
                </span>
              }
              title="Nova"
              subtitle="research analyst"
              trailing={<Badge>12 chats</Badge>}
              onOpen={() => {}}
            />
          </ListScaffold>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">PageBar / PageScaffold</h3>
        <PageScaffold
          back="/app/ui-showcase"
          crumbs={[{ label: 'My Account', to: '/app/ui-showcase' }, { label: 'Biometric' }]}
          onHelp={(_el) => alert('help opens the reading overlay (Plan 2)')}
        >
          <p className="text-paper-soft">Page content scrolls; the bar above stays put.</p>
        </PageScaffold>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">ReadingOverlay</h3>
        <Button ref={readerTrigger} tone="neutral" onClick={() => setReaderOpen(true)}>
          Open privacy reader
        </Button>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">PickerOverlay</h3>
        <Button tone="neutral" onClick={() => setPickerOpen(true)}>
          Open picker shell demo
        </Button>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">PickerField</h3>
        <div className="flex flex-col gap-2">
          <PickerField
            label="Mindspace"
            value="Aurora"
            onOpen={(el) => console.log('PickerField onOpen', el)}
          />
          <PickerField
            label="Search backend"
            value="Brave"
            stale={{ reason: 'Currently unavailable — add nano-gpt or pick another' }}
            onOpen={(el) => console.log('PickerField onOpen', el)}
          />
          <PickerField
            label="Expert web"
            value="—"
            disabled
            disabledReason="Set an expert model first"
            onOpen={(el) => console.log('PickerField onOpen', el)}
          />
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">ModelPickerOverlay</h3>
        <div className="flex flex-col gap-2">
          <PickerField
            label="Model"
            value={modelSelection ? modelSelection.canonicalId : '—'}
            onOpen={(el) => {
              modelPickerTriggerRef.current = el;
              setModelPickerOpen(true);
            }}
          />
          <PickerField
            label="Image model"
            value={imageModelSelection ? imageModelSelection.canonicalId : '—'}
            onOpen={(el) => {
              imageModelPickerTriggerRef.current = el;
              setImageModelPickerOpen(true);
            }}
          />
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2">MindspacePickerOverlay</h3>
        <PickerField
          label="Default Mindspace"
          value={
            SHOWCASE_MINDSPACES.find((m) => m.id === mindspaceSelection.mindspaceId)?.displayName ??
            'Aurora'
          }
          onOpen={(el) => {
            mindspaceTriggerRef.current = el;
            setMindspacePickerOpen(true);
          }}
        />
      </section>

      <section className="mb-6">
        <h3 className="mb-2">WebPickerOverlay</h3>
        <div className="flex flex-col gap-2">
          <PickerField
            label="Web search"
            value={
              webPickerValue.search === null
                ? 'Auto'
                : webPickerValue.search === 'off'
                  ? 'Off'
                  : webPickerValue.search.upstreamSlug
            }
            onOpen={(el) => {
              webPickerTriggerRef.current = el;
              setWebPickerOpen(true);
            }}
          />
          <PickerField
            label="Expert web"
            value={
              expertWebPickerValue.search === null
                ? 'Auto'
                : expertWebPickerValue.search === 'off'
                  ? 'Off'
                  : expertWebPickerValue.search.upstreamSlug
            }
            onOpen={(el) => {
              expertWebPickerTriggerRef.current = el;
              setExpertWebPickerOpen(true);
            }}
          />
        </div>
      </section>

      <ConfirmDialog
        open={saveOpen}
        title="Save changes?"
        body="Your edit to Fable will be applied."
        confirmLabel="Save"
        onConfirm={() => setSaveOpen(false)}
        onCancel={() => setSaveOpen(false)}
        triggerRef={saveTrigger}
      />
      <ConfirmDialog
        open={deleteOpen}
        destructive
        title="Delete Fable?"
        body="All chats and memories are lost for good."
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={() => setDeleteOpen(false)}
        onCancel={() => setDeleteOpen(false)}
        triggerRef={deleteTrigger}
      />
      <ReadingOverlay
        open={readerOpen}
        title="Privacy & Data Handling"
        markdown={SAMPLE_MARKDOWN}
        onClose={() => setReaderOpen(false)}
        triggerRef={readerTrigger}
      />
      <PickerOverlay
        open={pickerOpen}
        title="Shell demo"
        onClose={() => setPickerOpen(false)}
        onSave={() => setPickerOpen(false)}
        saveDisabled={!pickerDirty}
        dirty={pickerDirty}
      >
        <div className="p-4">
          <label className="flex items-center gap-2 text-sm text-paper">
            <input
              type="checkbox"
              checked={pickerDirty}
              onChange={(e) => setPickerDirty(e.target.checked)}
            />
            Mark dirty (to see the Save light up and the discard guard)
          </label>
        </div>
      </PickerOverlay>
      <ModelPickerOverlay
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelect={(sel) => {
          // ModelPickerOverlay auto-closes via onClose — only store the selection here.
          setModelSelection(sel);
        }}
        providers={[]}
        configuredTemplateIds={[]}
        triggerRef={modelPickerTriggerRef}
      />
      <ModelPickerOverlay
        open={imageModelPickerOpen}
        onClose={() => setImageModelPickerOpen(false)}
        onSelect={(sel) => {
          // ModelPickerOverlay auto-closes via onClose — only store the selection here.
          setImageModelSelection(sel);
        }}
        providers={[]}
        configuredTemplateIds={[]}
        filter="vision"
        triggerRef={imageModelPickerTriggerRef}
      />
      <MindspacePickerOverlay
        open={mindspacePickerOpen}
        onClose={() => setMindspacePickerOpen(false)}
        triggerRef={mindspaceTriggerRef}
        mindspaces={SHOWCASE_MINDSPACES}
        previewName="Fable"
        initial={mindspaceSelection}
        onSave={(next) => {
          setMindspaceSelection(next);
          setMindspacePickerOpen(false);
        }}
      />
      <WebPickerOverlay
        open={webPickerOpen}
        onClose={() => setWebPickerOpen(false)}
        triggerRef={webPickerTriggerRef}
        title="Web search"
        mode="general"
        options={SHOWCASE_WEB_OPTIONS}
        searchTiers={[]}
        initial={webPickerValue}
        onSave={(next) => {
          setWebPickerValue(next);
          setWebPickerOpen(false);
        }}
      />
      <WebPickerOverlay
        open={expertWebPickerOpen}
        onClose={() => setExpertWebPickerOpen(false)}
        triggerRef={expertWebPickerTriggerRef}
        title="Expert web"
        mode="expert"
        options={SHOWCASE_WEB_OPTIONS}
        searchTiers={SHOWCASE_SEARCH_TIERS}
        initial={expertWebPickerValue}
        onSave={(next) => {
          setExpertWebPickerValue(next);
          setExpertWebPickerOpen(false);
        }}
      />
    </main>
  );
}
