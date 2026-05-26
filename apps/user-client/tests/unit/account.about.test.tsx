// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
