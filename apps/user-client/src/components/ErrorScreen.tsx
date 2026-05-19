// SPDX-License-Identifier: AGPL-3.0-only
import { InlineMarker } from './InlineMarker.js';

export interface ErrorScreenProps {
  title: string;
  body: string;
  detail?: string[];
}

export function ErrorScreen({ title, body, detail }: ErrorScreenProps) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-[34rem] text-center">
        <h1 className="font-display text-4xl italic tracking-tight text-paper lg:text-5xl">
          {title}
        </h1>
        <p className="mt-4 text-paper-soft">{body}</p>
        {detail && detail.length > 0 && (
          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {detail.map((d) => (
              <li key={d}>
                <InlineMarker tone="danger">{d}</InlineMarker>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
