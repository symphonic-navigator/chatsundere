// SPDX-License-Identifier: AGPL-3.0-only
import { FolderKanban, Gem, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { ListRow } from '../../components/ui/ListRow.js';
import { ListScaffold } from '../../components/ui/ListScaffold.js';
import { NavTile } from '../../components/ui/NavTile.js';
import { Pill } from '../../components/ui/Pill.js';

/**
 * Internal showcase of every design-language primitive — the live successor to
 * chatsundere-prototype.html. Reached at /app/ui-showcase. Not user-facing; the
 * device-test surface for the makeover foundation.
 */
export function UiShowcase(): JSX.Element {
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const saveTrigger = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

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
    </main>
  );
}
