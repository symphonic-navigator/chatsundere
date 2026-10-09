// SPDX-License-Identifier: AGPL-3.0-only

export type ProjectFsErrorCode =
  | 'NotFound'
  | 'AlreadyExists'
  | 'VersionConflict'
  | 'InvalidPath'
  | 'EscapesRoot'
  | 'IsDirectory'
  | 'NotDirectory'
  | 'QuotaExceeded';

export type InvalidPathReason =
  | 'not-absolute'
  | 'control-character'
  | 'too-long'
  | 'root'
  | 'into-self'
  | 'extension';

export interface ProjectFsErrorDetail {
  path?: string;
  current?: string;
  passed?: string;
  reason?: InvalidPathReason;
  others?: number;
}

/** Typed failure of a project filesystem operation; `code` is the stable discriminator. */
export class ProjectFsError extends Error {
  readonly code: ProjectFsErrorCode;
  readonly detail: ProjectFsErrorDetail;

  constructor(code: ProjectFsErrorCode, message: string, detail: ProjectFsErrorDetail) {
    super(message);
    this.name = 'ProjectFsError';
    this.code = code;
    this.detail = detail;
  }
}

/** True when `e` is a ProjectFsError, optionally of the given code. */
export function isProjectFsError(e: unknown, code?: ProjectFsErrorCode): e is ProjectFsError {
  return e instanceof ProjectFsError && (code === undefined || e.code === code);
}

const REASON_TEXT: Record<InvalidPathReason, string> = {
  'not-absolute': 'paths must start with "/"',
  'control-character': 'paths must not contain control characters',
  'too-long': 'the path is longer than 1024 characters or a name is longer than 255',
  root: 'the project root "/" cannot be used here',
  'into-self': 'a folder cannot be moved into itself',
  extension: 'only Markdown files (.md or .markdown) are supported',
};

/** Builds a ProjectFsError whose message starts with its code and says what to do next. */
export function fsError(code: ProjectFsErrorCode, detail: ProjectFsErrorDetail): ProjectFsError {
  const path = detail.path ?? '(unknown path)';
  let message: string;
  switch (code) {
    case 'VersionConflict':
      message = `VersionConflict: ${path} is at version ${detail.current}, you passed ${detail.passed}; re-read the file before writing.`;
      break;
    case 'NotFound':
      message = `NotFound: ${path} does not exist.`;
      break;
    case 'AlreadyExists':
      message = `AlreadyExists: ${path} already exists.`;
      break;
    case 'QuotaExceeded':
      message =
        'QuotaExceeded: this device is out of space for projects; export a project to keep a copy, then free some space.';
      break;
    case 'InvalidPath': {
      const why = detail.reason ? REASON_TEXT[detail.reason] : 'the path is not valid';
      message = `InvalidPath: ${path} is not a valid path (${why}).`;
      break;
    }
    case 'EscapesRoot':
      message = `EscapesRoot: ${path} leaves the project root; use a path inside the project.`;
      break;
    case 'IsDirectory':
      message = `IsDirectory: ${path} is a folder, not a file; choose a file path.`;
      break;
    case 'NotDirectory':
      message = `NotDirectory: ${path} is a file, not a folder; choose a folder path.`;
      break;
  }
  return new ProjectFsError(code, message, detail);
}

/** `NotFound` naming a missing project rather than a path inside it. */
export function projectNotFound(projectId: string): ProjectFsError {
  return fsError('NotFound', { path: `project ${projectId}` });
}
