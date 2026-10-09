// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectRow } from '../../../boot/client-data-db.js';
import { Button } from '../../../components/ui/Button.js';
import { ListRow } from '../../../components/ui/ListRow.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { relativeTimeLabel } from '../../../lib/relative-time.js';
import { createProject, renameProject } from '../../../projects/fs.js';
import { useProjectFileCounts, useProjects } from '../../../projects/hooks.js';
import { requestPersistence } from '../../../projects/persistence.js';
import { deleteProject } from '../../../projects/trash.js';
import { exportZip, importZip } from '../../../projects/zip.js';
import { toastStore } from '../../../state/toast.store.js';
import { showCardDeleteToast } from '../../../trash/delete-toast.js';
import { PathDialog, describeProjectError } from './PathDialog.js';
import { StorageCard } from './StorageCard.js';

const asName = (input: string): string => input.trim();

/** Saves a Blob through a temporary download link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking in the same task can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function warn(message: string): void {
  toastStore.show({ message, tone: 'warn', durationMs: 8000 });
}

/** Exports a project as `<name>.zip`; failures become a warning toast. */
export async function exportProjectZip(project: ProjectRow): Promise<void> {
  try {
    downloadBlob(await exportZip(project.id), `${project.name}.zip`);
  } catch (e) {
    console.warn('Project export failed', e);
    warn(describeProjectError(e) ?? 'Could not export this project. Please try again.');
  }
}

/** Moves a project into Recently deleted and shows the undo toast. */
export async function deleteProjectWithUndo(projectId: string): Promise<void> {
  try {
    const { cardKey, handle, message } = await deleteProject(projectId);
    // Live queries refresh on their own after restore or purge.
    showCardDeleteToast(cardKey, handle, () => undefined, message);
  } catch (e) {
    console.warn('Project delete failed', e);
    warn(describeProjectError(e) ?? 'Could not delete this project. Please try again.');
  }
}

type Dialog = { kind: 'new' } | { kind: 'rename'; project: ProjectRow };

/** `/app/projects` — storage card, project list, new and import (spec §6.2). */
export function ProjectsListPage(): JSX.Element {
  const navigate = useNavigate();
  const projects = useProjects();
  const counts = useProjectFileCounts();
  const importRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImport(file: File): Promise<void> {
    setImporting(true);
    try {
      const { imported, skipped } = await importZip(file);
      await requestPersistence();
      toastStore.show({
        message: `Imported ${imported} files${skipped.length > 0 ? ` · skipped ${skipped.length}` : ''}`,
        tone: 'success',
        durationMs: 4000,
      });
    } catch (e) {
      console.warn('Project import failed', e);
      const known = describeProjectError(e);
      warn(
        known === null
          ? 'That file could not be read as a .zip — nothing was imported.'
          : `That .zip could not be imported — nothing was added. ${known}`,
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Projects' }]}
      back="/app/settings"
    >
      <input
        ref={importRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        data-testid="project-import-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImport(f);
          e.target.value = '';
        }}
      />
      {dialog?.kind === 'new' ? (
        <PathDialog
          title="New project"
          initial=""
          placeholder="Project name"
          confirmLabel="Create"
          normalise={asName}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const row = await createProject(name);
            await requestPersistence();
            setDialog(null);
            navigate(`/app/projects/${row.id}`);
          }}
        />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <PathDialog
          title="Rename project"
          initial={dialog.project.name}
          confirmLabel="Rename"
          normalise={asName}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await renameProject(dialog.project.id, name);
            setDialog(null);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <StorageCard />
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" onClick={() => setDialog({ kind: 'new' })}>
            New project
          </Button>
          <Button tone="neutral" disabled={importing} onClick={() => importRef.current?.click()}>
            Import .zip
          </Button>
        </div>
        {projects === undefined ? null : projects.length === 0 ? (
          <p className="text-sm text-paper-soft">No projects yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((p) => {
              const n = counts.get(p.id) ?? 0;
              return (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={`${n} ${n === 1 ? 'file' : 'files'} · ${relativeTimeLabel(p.updatedAt)}`}
                  onOpen={() => navigate(`/app/projects/${p.id}`)}
                  overflow={[
                    { label: 'Rename', onSelect: () => setDialog({ kind: 'rename', project: p }) },
                    { label: 'Export as .zip', onSelect: () => void exportProjectZip(p) },
                    {
                      label: 'Delete',
                      tone: 'destructive',
                      onSelect: () => void deleteProjectWithUndo(p.id),
                    },
                  ]}
                />
              );
            })}
          </div>
        )}
      </div>
    </PageScaffold>
  );
}

/** Placeholder for project routes until their pages land. */
export function ProjectsPlaceholderPage(): JSX.Element {
  return (
    <PageScaffold
      crumbs={[{ label: 'Projects', to: '/app/projects' }, { label: 'Project' }]}
      back="/app/projects"
    >
      <p className="px-4 pt-2 text-sm text-paper-soft">Coming in the next task.</p>
    </PageScaffold>
  );
}
