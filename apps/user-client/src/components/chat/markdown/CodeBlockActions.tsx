// SPDX-License-Identifier: AGPL-3.0-only
import { CopyButton } from './CopyButton.js';
import { SaveArtefactButton } from './SaveArtefactButton.js';
import { useArtefactSave } from './artefact-save-context.js';

/** Top-right action cluster for a fenced code block: an optional Save (when a
 *  chat-message save context is present) plus the always-present Copy. */
export function CodeBlockActions({
  codeStr,
  lang,
}: {
  codeStr: string;
  lang: string;
}): JSX.Element {
  const save = useArtefactSave();
  return (
    <div className="absolute right-2 top-2 z-10 flex gap-1">
      {save ? (
        <SaveArtefactButton onSave={() => save.saveCodeBlock({ content: codeStr, lang })} />
      ) : null}
      <CopyButton text={codeStr} />
    </div>
  );
}
