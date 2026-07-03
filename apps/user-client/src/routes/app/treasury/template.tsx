// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SeedTemplateRow } from '../../../boot/client-data-db.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { OverflowMenu } from '../../../components/ui/OverflowMenu.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import {
  useCreateSeedTemplate,
  useDeleteSeedTemplate,
  useSeedTemplate,
  useUpdateSeedTemplate,
} from '../../../data/seed-templates.js';
import { useAdultMode } from '../../../data/settings.js';
import { endsOnPersona, isApplyable, normaliseBody, roleAt } from '../../../lib/seed-template.js';
import { useClass2Gate } from '../../../sync/gate.js';

const TEMPLATES_PATH = '/app/treasury/templates';

/** Outer shell — resolves loading / not-found before rendering the editor form. */
export function TreasuryTemplatePage(): JSX.Element {
  const { templateId } = useParams();
  const isCreate = templateId === undefined; // /new route has no :templateId
  const query = useSeedTemplate(isCreate ? undefined : templateId);

  if (!isCreate && query.isLoading) {
    return (
      <PageScaffold
        crumbs={[{ label: 'Templates', to: TEMPLATES_PATH }, { label: '…' }]}
        back={TEMPLATES_PATH}
      >
        <p className="px-4 pt-2 text-sm text-paper-soft">Loading…</p>
      </PageScaffold>
    );
  }

  if (!isCreate && !query.data) {
    return (
      <PageScaffold
        crumbs={[{ label: 'Templates', to: TEMPLATES_PATH }, { label: 'Not found' }]}
        back={TEMPLATES_PATH}
      >
        <p className="px-4 pt-2 text-sm text-paper-soft">
          We can&apos;t find that template — it may have been deleted.
        </p>
      </PageScaffold>
    );
  }

  return <TemplateForm key={query.data?.id ?? 'new'} existing={query.data} />;
}

// ---- Inner form ----

interface BodyDraft {
  text: string;
}

function TemplateForm({ existing }: { existing: SeedTemplateRow | undefined }): JSX.Element {
  const navigate = useNavigate();
  const create = useCreateSeedTemplate();
  const update = useUpdateSeedTemplate();
  const del = useDeleteSeedTemplate();
  const class2 = useClass2Gate();
  const { mode } = useAdultMode();
  const { onHelp, helpOverlay } = useHelp('treasury-templates');

  const isCreate = existing === undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [nsfw, setNsfw] = useState(existing?.nsfw ?? false);
  const [greetingEnabled, setGreetingEnabled] = useState((existing?.greeting ?? null) !== null);
  const [greeting, setGreeting] = useState(existing?.greeting ?? '');
  const [body, setBody] = useState<BodyDraft[]>(
    (existing?.body ?? []).map((t) => ({ text: t.text })),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function mark(): void {
    setDirty(true);
  }

  // Turning NSFW on while browsing in SFW mode would hide the very row being
  // edited — disable that direction with a reason rather than letting it vanish.
  const nsfwLockOn = mode === 'sfw' && !nsfw;

  const draftGreeting = greetingEnabled ? greeting : null;
  const normalisedBody = normaliseBody(body);
  const applyable = isApplyable({ greeting: draftGreeting, body: normalisedBody });
  const lastTurnIsUser = body.length > 0 && !endsOnPersona(normalisedBody);

  function updateTurn(index: number, text: string): void {
    setBody((prev) => prev.map((t, i) => (i === index ? { text } : t)));
    mark();
  }
  function appendTurn(): void {
    setBody((prev) => [...prev, { text: '' }]);
    mark();
  }
  function deleteTurn(index: number): void {
    setBody((prev) => prev.filter((_, i) => i !== index));
    mark();
  }
  function moveTurn(index: number, dir: -1 | 1): void {
    setBody((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[index];
      const b = next[target];
      if (a === undefined || b === undefined) return prev;
      next[index] = b;
      next[target] = a;
      return next;
    });
    mark();
  }

  async function onSave(): Promise<void> {
    setSaveError(null);
    setSaving(true);
    const payload = {
      name: name.trim() || 'Untitled template',
      description: description.trim(),
      nsfw,
      greeting: draftGreeting,
      body: normalisedBody,
    };
    try {
      if (isCreate) {
        await create.mutateAsync(payload);
      } else {
        await update.mutateAsync({ id: existing.id, patch: payload });
      }
      setDirty(false);
      navigate(TEMPLATES_PATH);
    } catch {
      setSaveError('Could not save — your changes are kept. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const crumbLabel = isCreate ? 'New template' : existing.name || 'Template';

  return (
    <PageScaffold
      crumbs={[{ label: 'Templates', to: TEMPLATES_PATH }, { label: crumbLabel }]}
      back={TEMPLATES_PATH}
      onHelp={onHelp}
      dirty={dirty}
    >
      {helpOverlay}
      <div className="flex flex-col gap-5 px-4 pb-8 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span>{dirty ? <Badge tone="warning">● Unsaved</Badge> : null}</span>
          {existing ? (
            <OverflowMenu
              items={[
                {
                  label: 'Delete template',
                  tone: 'destructive',
                  onSelect: () => setConfirmDelete(true),
                  disabled: class2.disabled,
                  disabledReason: class2.tooltip ?? undefined,
                },
              ]}
            />
          ) : null}
        </div>

        {/* Signpost: author here, apply from an empty chat (spec §6). */}
        <p className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-paper-soft">
          You build a primer here. To use it, open a <strong>new, empty chat</strong> and choose
          “Seed from template” near the composer.
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">Name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              mark();
            }}
            placeholder="Untitled template"
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">
            Description (optional)
          </span>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              mark();
            }}
            placeholder="What this primer sets up"
            className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
          />
        </label>

        {/* NSFW toggle with the vanish-guard. */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-paper">Adult (NSFW)</div>
            {nsfwLockOn ? (
              <p className="text-[11px] text-paper-soft">
                Turn on adult mode first — otherwise this template would be hidden the moment you
                mark it adult.
              </p>
            ) : (
              <p className="text-[11px] text-paper-soft">
                Adult templates only appear while adult mode is on.
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Adult (NSFW)"
            aria-pressed={nsfw}
            disabled={nsfwLockOn}
            aria-disabled={nsfwLockOn}
            onClick={() => {
              if (nsfwLockOn) return;
              setNsfw((v) => !v);
              mark();
            }}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              nsfw ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
            } ${nsfwLockOn ? 'opacity-40' : ''}`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                nsfw ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Greeting */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-paper">Opening greeting</span>
            <button
              type="button"
              aria-label="Opening greeting"
              aria-pressed={greetingEnabled}
              onClick={() => {
                setGreetingEnabled((v) => !v);
                mark();
              }}
              className={`h-6 w-12 shrink-0 rounded-full border ${
                greetingEnabled ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                  greetingEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {greetingEnabled ? (
            <textarea
              aria-label="Greeting text"
              value={greeting}
              onChange={(e) => {
                setGreeting(e.target.value);
                mark();
              }}
              rows={3}
              placeholder="What the persona says first…"
              className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
            />
          ) : null}
        </div>

        {/* Body turns */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-paper-soft">
            Conversation (you first, then alternating)
          </span>
          {body.map((turn, i) => {
            const role = roleAt(i);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: turns are position-defined; a stable id would duplicate the role logic
              <div key={i} className="flex flex-col gap-1 rounded-md border border-white/10 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-paper-soft">
                    {role === 'user' ? 'You' : 'Persona'}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => moveTurn(i, -1)}
                      className="rounded px-2 py-0.5 text-paper-soft disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={i === body.length - 1}
                      onClick={() => moveTurn(i, 1)}
                      className="rounded px-2 py-0.5 text-paper-soft disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="Delete turn"
                      onClick={() => deleteTurn(i)}
                      className="rounded px-2 py-0.5 text-paper-soft"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <textarea
                  aria-label={`${role === 'user' ? 'You' : 'Persona'} turn ${i + 1}`}
                  value={turn.text}
                  onChange={(e) => updateTurn(i, e.target.value)}
                  rows={2}
                  className="rounded-md border border-paper-soft/30 bg-white/5 px-3 py-2 text-sm text-paper"
                />
              </div>
            );
          })}
          <div>
            <Button tone="neutral" onClick={appendTurn}>
              + Add {roleAt(body.length) === 'user' ? 'your' : 'persona'} turn
            </Button>
          </div>
          {lastTurnIsUser ? (
            <p className="text-[11px] text-paper-soft">
              The last turn is yours — the persona will reply to it as your chat begins. Add a
              persona turn if you want the primer to end on the persona.
            </p>
          ) : null}
        </div>

        <div>
          <Button tone="primary" onClick={() => void onSave()} disabled={saving || !applyable}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {!applyable ? (
            <p className="mt-2 text-[11px] text-paper-soft">
              Add a greeting or at least one filled-in turn to save.
            </p>
          ) : null}
          {saveError ? <p className="mt-2 text-[11px] text-amber-300/80">{saveError}</p> : null}
        </div>
      </div>

      {existing ? (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete ${existing.name || 'this template'}?`}
          body="This primer template is removed. Chats already seeded from it are untouched."
          confirmLabel="Delete"
          cancelLabel="Keep"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            del.mutate(existing.id);
            navigate(TEMPLATES_PATH);
          }}
        />
      ) : null}
    </PageScaffold>
  );
}
