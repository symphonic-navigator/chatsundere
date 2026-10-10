// SPDX-License-Identifier: AGPL-3.0-only
import type { FileMeta } from './fs.js';
import { isHiddenPath } from './path.js';

export interface TreeNode {
  type: 'dir' | 'file';
  name: string;
  path: string;
  /** True when any segment of the path starts with a dot (dimmed in the UI). */
  hidden: boolean;
  children?: TreeNode[];
  meta?: FileMeta;
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

function sortDeep(nodes: TreeNode[]): void {
  nodes.sort(compareNodes);
  for (const n of nodes) if (n.children) sortDeep(n.children);
}

/** Builds the nested tree from flat file metadata; directories first, then names by code point. */
export function buildTree(files: FileMeta[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  for (const meta of files) {
    const segments = meta.path.split('/').filter((s) => s !== '');
    let siblings = roots;
    let current = '';
    segments.forEach((name, i) => {
      current = `${current}/${name}`;
      if (i === segments.length - 1) {
        siblings.push({ type: 'file', name, path: current, hidden: isHiddenPath(current), meta });
        return;
      }
      let dir = dirs.get(current);
      if (!dir) {
        dir = { type: 'dir', name, path: current, hidden: isHiddenPath(current), children: [] };
        dirs.set(current, dir);
        siblings.push(dir);
      }
      siblings = dir.children ?? [];
    });
  }
  sortDeep(roots);
  return roots;
}
