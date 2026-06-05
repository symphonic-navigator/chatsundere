// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { copy } from '../../src/lib/copy.js';
import { THIRD_PARTY_LICENCES } from '../../src/lib/third-party-licences.js';
import { APP_VERSION } from '../../src/lib/version.js';
import { AboutSection } from '../../src/routes/app/account-sections/about-section.js';

describe('AboutSection version block', () => {
  it('renders Version, sha, and built-at', () => {
    const { container } = render(<AboutSection />);
    const text = container.textContent ?? '';
    expect(text).toContain('Version');
    expect(text).toContain(APP_VERSION.version);
    expect(text).toContain('sha');
    expect(text).toContain(APP_VERSION.sha);
    expect(text).toContain('built');
    expect(text).toContain(APP_VERSION.builtAt);
  });
});

describe('AboutSection privacy disclosure', () => {
  it('renders a closed <details> with all three privacy paragraphs inside', () => {
    const { container } = render(<AboutSection />);
    const details = container.querySelector('details[data-about-privacy]');
    expect(details).not.toBeNull();
    // Closed by default — `open` attribute absent.
    expect(details?.hasAttribute('open')).toBe(false);
    // Summary label
    expect(details?.querySelector('summary')?.textContent ?? '').toContain(
      copy.settings.about.privacy.label,
    );
    // Body content (rendered inside the disclosure regardless of open state in jsdom).
    expect(details?.textContent ?? '').toContain(copy.settings.about.privacy.whereTitle);
    expect(details?.textContent ?? '').toContain(copy.settings.about.privacy.cannotSeeTitle);
    expect(details?.textContent ?? '').toContain(copy.settings.about.privacy.externalTitle);
  });

  it('opens when the summary is clicked', () => {
    const { container } = render(<AboutSection />);
    const details = container.querySelector('details[data-about-privacy]') as HTMLDetailsElement;
    const summary = details.querySelector('summary') as HTMLElement;
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });
});

describe('AboutSection third-party disclosure', () => {
  it('renders one row per THIRD_PARTY_LICENCES entry', () => {
    const { container } = render(<AboutSection />);
    const rows = container.querySelectorAll('[data-third-party-row]');
    expect(rows.length).toBe(THIRD_PARTY_LICENCES.length);
  });

  it('spot-checks that React and Tailwind appear with their licence', () => {
    const { container } = render(<AboutSection />);
    const text = container.textContent ?? '';
    expect(text).toContain('React');
    expect(text).toContain('Tailwind CSS');
    expect(text).toMatch(/MIT/);
  });

  it('renders the intro paragraph above the row list', () => {
    const { container } = render(<AboutSection />);
    const details = container.querySelector('details[data-about-third-party]');
    expect(details).not.toBeNull();
    expect(details?.textContent ?? '').toContain(copy.settings.about.thirdParty.intro);
  });

  it('renders homepage links with target=_blank and rel=noopener', () => {
    const { container } = render(<AboutSection />);
    const links = container.querySelectorAll<HTMLAnchorElement>('[data-third-party-row] a');
    expect(links.length).toBe(THIRD_PARTY_LICENCES.length);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});

describe('AboutSection licence footer', () => {
  it('renders the copyright line and no-warranty sentence as plain text', () => {
    const { container } = render(<AboutSection />);
    const footer = container.querySelector('[data-about-licence-footer]');
    expect(footer).not.toBeNull();
    expect(footer?.textContent ?? '').toContain(copy.settings.about.licence.copyright);
    expect(footer?.textContent ?? '').toContain(copy.settings.about.licence.noWarranty);
  });

  it('renders four external links in document order: Licence, Source, Policy, Documentation', () => {
    const { container } = render(<AboutSection />);
    const links = container.querySelectorAll<HTMLAnchorElement>('[data-about-licence-footer] a');
    expect(links.length).toBe(4);

    const c = copy.settings.about.licence;
    expect(links[0]?.getAttribute('href')).toBe(c.licenceHref);
    expect(links[1]?.getAttribute('href')).toBe(c.sourceHref);
    expect(links[2]?.getAttribute('href')).toBe(c.policyHref);
    expect(links[3]?.getAttribute('href')).toBe(c.docsHref);

    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('spot-checks the Policy link label reads "Our Provider Integration Policy" verbatim', () => {
    const { container } = render(<AboutSection />);
    const policyRow = container.querySelector('[data-about-policy-row]');
    expect(policyRow).not.toBeNull();
    expect(policyRow?.textContent ?? '').toContain('Our Provider Integration Policy');
  });

  it('points the licence link at the FSF-hosted AGPL text', () => {
    const { container } = render(<AboutSection />);
    const licenceLink = container.querySelector<HTMLAnchorElement>('[data-about-licence-row] a');
    expect(licenceLink?.getAttribute('href')).toBe('https://www.gnu.org/licenses/agpl-3.0.html');
    expect(licenceLink?.textContent ?? '').toContain('GNU AGPL v3.0');
  });
});
