// SPDX-License-Identifier: AGPL-3.0-only
import { useModelProgressStore } from '../../state/model-progress.store.js';

/**
 * One-time notice while the on-device embedding model downloads/compiles. Hidden
 * once the engine is ready (it stays cached for future sessions).
 */
export function ModelDownloadBanner(): JSX.Element | null {
  const loading = useModelProgressStore((s) => s.loading);
  const ready = useModelProgressStore((s) => s.ready);
  const progress = useModelProgressStore((s) => s.progress);
  if (ready || !loading) return null;
  const pct = progress === null ? null : Math.round(progress * 100);
  return (
    <output className="model-download-banner">
      Preparing the on-device knowledge engine{pct === null ? '' : ` … ${pct}%`} (downloads once,
      then cached).
    </output>
  );
}
