// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button.js';
import { OverflowMenu } from '../../../components/ui/OverflowMenu.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { move, renameProject, writeText } from '../../../projects/fs.js';
import { useProject, useProjectTree } from '../../../projects/hooks.js';
import { normalisePath } from '../../../projects/path.js';
import { deletePath } from '../../../projects/trash.js';
import { type TreeNode, buildTree } from '../../../projects/tree-model.js';
import { toastStore } from '../../../state/toast.store.js';
import { showCardDeleteToast } from '../../../trash/delete-toast.js';
import { PathDialog, describeProjectError } from './PathDialog.js';
import { deleteProjectWithUndo, exportProjectZip } from './list.js';

type Dialog =
  | { kind: 'new'; initial: string }
  | { kind: 'move'; node: TreeNode }
  | { kind: 'rename-project' };

const storageKey = (projectId: string): string => `projects.tree.${projectId}`;

function loadCollapsed(projectId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(storageKey(projectId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(projectId: string, collapsed: Set<string>): void {
  try {
    sessionStorage.setItem(storageKey(projectId), JSON.stringify([...collapsed]));
  } catch {
    // Collapse state is a convenience; private windows may refuse storage.
  }
}

const asName = (input: string): string => input.trim();

/** `/app/projects/:projectId` — collapsible file tree with create, move and delete (spec §6.3). */
export function ProjectTreePage(): JSX.Element {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const files = useProjectTree(projectId);
  const tree = useMemo(() => buildTree(files ?? []), [files]);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(projectId));
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const fileUrl = (path: string, edit = false): string =>
    `/app/projects/${projectId}/file?path=${encodeURIComponent(path)}${edit ? '&edit=1' : ''}`;

  function toggle(path: string): void {
    const next = new Set(collapsed);
    if (!next.delete(path)) next.add(path);
    setCollapsed(next);
    saveCollapsed(projectId, next);
  }

  async function remove(node: TreeNode): Promise<void> {
    try {
      const { cardKey, handle, message } = await deletePath(projectId, node.path);
      showCardDeleteToast(cardKey, handle, () => undefined, message);
    } catch (e) {
      console.warn('Project delete failed', e);
      toastStore.show({
        message: describeProjectError(e) ?? 'Could not delete this. Please try again.',
        tone: 'warn',
        durationMs: 8000,
      });
    }
  }

  function renderNode(node: TreeNode, depth: number): JSX.Element {
    const isDir = node.type === 'dir';
    const open = isDir && !collapsed.has(node.path);
    return (
      <li key={node.path}>
        <div
          className={`cs-row ${node.hidden ? 'opacity-50' : ''}`}
          style={{ paddingLeft: `${depth * 16}px` }}
          data-testid={`tree-row-${node.path}`}
        >
          <button
            type="button"
            className="cs-row-main"
            aria-expanded={isDir ? open : undefined}
            onClick={() => (isDir ? toggle(node.path) : navigate(fileUrl(node.path)))}
          >
            <span className="cs-row-body">
              <span className="cs-row-title">
                {isDir ? (open ? '▾ ' : '▸ ') : ''}
                {node.name}
                {isDir ? '/' : ''}
              </span>
            </span>
          </button>
          <span className="cs-row-trailing">
            <OverflowMenu
              triggerLabel={`Actions for ${node.path}`}
              items={[
                ...(isDir
                  ? [
                      {
                        label: 'New file here',
                        onSelect: () => setDialog({ kind: 'new', initial: `${node.path}/` }),
                      },
                    ]
                  : []),
                { label: 'Rename / Move', onSelect: () => setDialog({ kind: 'move', node }) },
                { label: 'Delete', tone: 'destructive', onSelect: () => void remove(node) },
              ]}
            />
          </span>
        </div>
        {isDir && open && node.children ? (
          <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  const name = project?.name ?? 'Project';
  return (
    <PageScaffold
      crumbs={[{ label: 'Projects', to: '/app/projects' }, { label: name }]}
      back="/app/projects"
    >
      {dialog?.kind === 'new' ? (
        <PathDialog
          title="New file"
          initial={dialog.initial}
          placeholder="e.g. /notes/plan.md — folders are created for you."
          confirmLabel="Create"
          onClose={() => setDialog(null)}
          onSubmit={async (path) => {
            await writeText(projectId, path, '', { createOnly: true });
            setDialog(null);
            navigate(fileUrl(path, true));
          }}
        />
      ) : null}
      {dialog?.kind === 'move' ? (
        <PathDialog
          title="Rename / Move"
          initial={dialog.node.path}
          confirmLabel="Move"
          {...(dialog.node.type === 'dir' ? { normalise: normalisePath } : {})}
          onClose={() => setDialog(null)}
          onSubmit={async (to) => {
            await move(projectId, dialog.node.path, to);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'rename-project' && project ? (
        <PathDialog
          title="Rename project"
          initial={project.name}
          confirmLabel="Rename"
          normalise={asName}
          onClose={() => setDialog(null)}
          onSubmit={async (next) => {
            await renameProject(projectId, next);
            setDialog(null);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate font-display text-xl text-paper">{name}</h1>
          {project ? (
            <OverflowMenu
              triggerLabel="Project actions"
              items={[
                { label: 'Rename', onSelect: () => setDialog({ kind: 'rename-project' }) },
                { label: 'Export as .zip', onSelect: () => void exportProjectZip(project) },
                {
                  label: 'Delete',
                  tone: 'destructive',
                  onSelect: () => {
                    navigate('/app/projects');
                    void deleteProjectWithUndo(project.id);
                  },
                },
              ]}
            />
          ) : null}
        </div>
        {project === null ? (
          <p className="text-sm text-paper-soft">This project no longer exists.</p>
        ) : files === undefined ? null : (
          <>
            <div>
              <Button tone="primary" onClick={() => setDialog({ kind: 'new', initial: '/' })}>
                New file
              </Button>
            </div>
            {tree.length === 0 ? (
              <p className="text-sm text-paper-soft">No files yet</p>
            ) : (
              <ul className="flex flex-col gap-1">{tree.map((n) => renderNode(n, 0))}</ul>
            )}
          </>
        )}
      </div>
    </PageScaffold>
  );
}
