// SPDX-License-Identifier: AGPL-3.0-only
import { Link, useLocation } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { Switch } from '../../../components/ui/Switch.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { useProjects } from '../../../projects/hooks.js';
import { toastStore } from '../../../state/toast.store.js';

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
    update.mutateAsync({ previews: { ...previews, projects: !on } }).catch((e: unknown) => {
      console.warn('Saving the preview setting failed', e);
      toastStore.show({
        message: 'Could not save the setting. Please try again.',
        tone: 'warn',
        durationMs: 8000,
      });
    });
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Previews' }]}
      back="/app/settings"
    >
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        {notice ? (
          <p className="rounded-md border border-paper-soft/20 bg-white/[0.02] p-3 text-[11px] text-paper-soft">
            {on ? (
              <>
                Projects is on.{' '}
                <Link to="/app/projects" className="text-paper underline">
                  Open Projects
                </Link>
              </>
            ) : (
              notice
            )}
          </p>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div>
            <label
              htmlFor="preview-projects-switch"
              className="block text-sm text-paper"
              id="preview-projects-label"
            >
              Projects (preview)
            </label>
            <p className="text-[11px] text-paper-soft">
              An early look at project files. Projects live on this device only for now.
            </p>
            {on && count > 0 ? (
              <p className="mt-1 text-[11px] text-paper-soft">
                {count === 1
                  ? 'Turning this off hides Projects; your 1 project stays on this device and returns when you turn it back on.'
                  : `Turning this off hides Projects; your ${count} projects stay on this device and return when you turn it back on.`}
              </p>
            ) : null}
          </div>
          <Switch
            id="preview-projects-switch"
            checked={on}
            onChange={toggle}
            labelledBy="preview-projects-label"
            disabled={settings.data === undefined}
          />
        </div>
      </div>
    </PageScaffold>
  );
}
