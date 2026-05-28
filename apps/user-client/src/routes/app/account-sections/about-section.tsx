// SPDX-License-Identifier: AGPL-3.0-only

import { copy } from '../../../lib/copy.js';
import { THIRD_PARTY_LICENCES } from '../../../lib/third-party-licences.js';
import { APP_VERSION } from '../../../lib/version.js';

/**
 * About accordion body.
 *
 * Mono-box (Version + sha + built-at) is the existing alpha-prep display.
 * Below it, two native <details> disclosures (Privacy, Third-party) and a
 * flat licence-and-links footer. See spec
 * `superpowers/specs/2026-05-28-about-disclaimer-licences-design.md`.
 */
export function AboutSection() {
  return (
    <div className="space-y-4">
      <VersionMonoBox />
      <PrivacyDisclosure />
      <ThirdPartyDisclosure />
      <LicenceFooter />
    </div>
  );
}

function VersionMonoBox() {
  return (
    <div className="rounded-md border border-paper-soft/20 bg-black/20 p-3 font-mono text-xs text-paper-soft">
      <div>
        Version <span className="text-paper">{APP_VERSION.version}</span>
      </div>
      <div>
        sha <span className="text-paper">{APP_VERSION.sha}</span>
      </div>
      <div>
        built <span className="text-paper">{APP_VERSION.builtAt}</span>
      </div>
    </div>
  );
}

function PrivacyDisclosure() {
  const p = copy.settings.about.privacy;
  return (
    <details
      data-about-privacy
      className="group border-t border-white/5 pt-3 [&>summary]:list-none"
    >
      <summary className="flex cursor-pointer items-center justify-between font-display text-sm text-paper">
        <span>{p.label}</span>
        <span aria-hidden className="text-paper-soft transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="space-y-3 pt-3 text-sm text-paper-soft">
        <p>
          <strong className="text-paper">{p.whereTitle}</strong> {p.whereBody}
        </p>
        <p>
          <strong className="text-paper">{p.cannotSeeTitle}</strong> {p.cannotSeeBody}
        </p>
        <p>
          <strong className="text-paper">{p.externalTitle}</strong> {p.externalBody}
        </p>
      </div>
    </details>
  );
}

function LicenceFooter() {
  const l = copy.settings.about.licence;
  return (
    <div
      data-about-licence-footer
      className="space-y-3 border-t border-white/5 pt-3 text-sm text-paper-soft"
    >
      <p>
        {l.copyright} {l.noWarranty}
      </p>
      <dl className="space-y-1.5">
        <FooterLink
          rowAttr="data-about-licence-row"
          label={l.licenceLabel}
          value={l.licenceValue}
          href={l.licenceHref}
        />
        <FooterLink
          rowAttr="data-about-source-row"
          label={l.sourceLabel}
          value={l.sourceValue}
          href={l.sourceHref}
        />
        <FooterLink
          rowAttr="data-about-policy-row"
          label={l.policyLabel}
          value={l.policyValue}
          href={l.policyHref}
        />
        <FooterLink
          rowAttr="data-about-docs-row"
          label={l.docsLabel}
          value={l.docsValue}
          href={l.docsHref}
        />
      </dl>
    </div>
  );
}

function FooterLink({
  rowAttr,
  label,
  value,
  href,
}: {
  rowAttr: string;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <div {...{ [rowAttr]: '' }} className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">{label}</dt>
      <dd>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-aurora-300 underline-offset-2 hover:underline"
        >
          {value}
        </a>
      </dd>
    </div>
  );
}

function ThirdPartyDisclosure() {
  const tp = copy.settings.about.thirdParty;
  return (
    <details
      data-about-third-party
      className="group border-t border-white/5 pt-3 [&>summary]:list-none"
    >
      <summary className="flex cursor-pointer items-center justify-between font-display text-sm text-paper">
        <span>{tp.label}</span>
        <span aria-hidden className="text-paper-soft transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="space-y-3 pt-3 text-sm text-paper-soft">
        <p>{tp.intro}</p>
        <ul className="space-y-2">
          {THIRD_PARTY_LICENCES.map((entry) => (
            <li
              key={entry.name}
              data-third-party-row
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
            >
              <span className="font-display text-sm text-paper">{entry.name}</span>
              <span className="font-mono text-xs text-paper-soft">
                {tp.versionPrefix}
                {entry.version}
              </span>
              <span aria-hidden className="font-mono text-xs text-paper-soft">
                ·
              </span>
              <span className="font-mono text-xs text-paper-soft">{entry.licence}</span>
              <span aria-hidden className="font-mono text-xs text-paper-soft">
                ·
              </span>
              <a
                href={entry.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-aurora-300 underline-offset-2 hover:underline"
              >
                {entry.homepage.replace(/^https?:\/\//, '')}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
