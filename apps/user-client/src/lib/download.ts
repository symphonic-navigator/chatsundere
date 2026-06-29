// SPDX-License-Identifier: AGPL-3.0-only

/** Produces a URL-safe slug from a display name: lowercase, spaces→hyphens, strip non-`[a-z0-9-]`. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Triggers a browser file download by creating a temporary object URL,
 * programmatically clicking a hidden anchor element, and revoking the URL.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
