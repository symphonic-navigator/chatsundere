// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { EncryptExportSection } from '../../src/components/transfer/EncryptExportSection.js';
import {
  type EncryptFormState,
  INITIAL_ENCRYPT_FORM,
} from '../../src/lib/chatsundere-transfer/encryption-form.js';

function Harness(): JSX.Element {
  const [state, setState] = useState<EncryptFormState>(INITIAL_ENCRYPT_FORM);
  return <EncryptExportSection state={state} onChange={setState} />;
}

describe('EncryptExportSection', () => {
  it('is off by default and hides the password fields', () => {
    render(<Harness />);
    expect((screen.getByLabelText(/encrypt with a password/i) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
  });

  it('reveals password + confirm and the no-recovery notice when ticked', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/encrypt with a password/i));
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm password/i)).toBeTruthy();
    expect(screen.getByText(/there is no recovery/i)).toBeTruthy();
  });
});
