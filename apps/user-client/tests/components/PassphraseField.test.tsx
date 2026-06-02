// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { PassphraseField } from '../../src/components/PassphraseField.js';

describe('PassphraseField', () => {
  it('forwards inputRef to the underlying input so callers can focus it', () => {
    const ref = createRef<HTMLInputElement>();
    const { container } = render(
      <PassphraseField
        id="login-passphrase"
        label="Passphrase"
        value=""
        onChange={() => {}}
        inputRef={ref}
      />,
    );
    const input = container.querySelector('#login-passphrase') as HTMLInputElement;
    expect(ref.current).toBe(input);
    ref.current?.focus();
    expect(document.activeElement).toBe(input);
  });
});
