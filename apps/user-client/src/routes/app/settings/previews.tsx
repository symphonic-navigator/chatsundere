// SPDX-License-Identifier: AGPL-3.0-only
import { useLocation } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { useProjects } from '../../../projects/hooks.js';

function noticeFrom(state: unknown): string | null {
  if (state === null || typeof state !== 'object') return null;
  const notice = (state as Record<string, unknown>).notice;
  return typeof notice === 'string' ? notice : null;
}

/** My Settings › Previews — opt-in switches for early features (spec §6.1). */
export function SettingsPreviewsPage(): JSX.Element {
  const location = useLocation();
  const settings = useSettings();
  const update = useUpdateSettings();
  const projects = useProjects();

  const previews = settings.data?.previews ?? {};
  const on = previews.projects === true;
  const count = projects?.length ?? 0;
  const notice = noticeFrom(location.state);

  function toggle(): void {
    if (settings.data === undefined) return;
    void update.mutateAsync({ previews: { ...previews, projects: !on } });
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Previews' }]}
      back="/app/settings"
    >
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        {notice ? (
          <p className="rounded-md border border-paper-soft/20 bg-white/[0.02] p-3 text-[11px] text-paper-soft">
            {notice}
          </p>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-paper" id="preview-projects-label">
              Projects (preview)
            </div>
            <p className="text-[11px] text-paper-soft">
              An early look at project files. Projects live on this device only for now.
            </p>
            {on && count > 0 ? (
              <p className="mt-1 text-[11px] text-paper-soft">
                {`Turning this off hides Projects; your ${count} ${count === 1 ? 'project' : 'projects'} stay on this device and return when you turn it back on.`}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="preview-projects-label"
            disabled={settings.data === undefined}
            onClick={toggle}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              on ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                on ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </PageScaffold>
  );
}
