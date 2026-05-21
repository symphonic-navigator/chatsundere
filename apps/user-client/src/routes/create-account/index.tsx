// SPDX-License-Identifier: AGPL-3.0-only
import { CryptoError, createLocalAccount } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../../boot/open-db.js';
import { copy } from '../../lib/copy.js';
import { StepPassphrase } from './step-passphrase.js';
import { StepRecoveryReveal } from './step-recovery-reveal.js';
import { StepUsername } from './step-username.js';

/**
 * Three-step wizard: username → passphrase → recovery-key reveal.
 * Account creation (and IDB write) happens on transition from step 2 to step 3
 * so the user sees the key the moment it first exists in memory.
 */
export function CreateAccount() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  async function generate() {
    setCreateError(null);
    try {
      const result = await createLocalAccount({ db: getDb(), username, passphrase });
      useSessionStore.getState().setSession(result.session, result.mk);
      setRecoveryKey(result.recoveryKeyString);
      setStep(3);
    } catch (err) {
      // CryptoError messages are internal and not guaranteed British-English
      // user copy — translate them to the copy catalogue. Reserved-word
      // collisions surface as 'invalid_input' from validateUsername inside the
      // crypto call, and 'conflict' is what an existing local account throws.
      if (err instanceof CryptoError) {
        if (err.code === 'conflict') setCreateError(copy.errors.accountExists);
        else setCreateError(copy.errors.accountCreation);
      } else {
        setCreateError(copy.errors.accountCreation);
      }
    }
  }

  if (step === 1) {
    return <StepUsername value={username} setValue={setUsername} onNext={() => setStep(2)} />;
  }

  if (step === 2) {
    return (
      <StepPassphrase
        value={passphrase}
        setValue={setPassphrase}
        error={createError}
        onBack={() => setStep(1)}
        onNext={() => void generate()}
      />
    );
  }

  return (
    <StepRecoveryReveal
      recoveryKey={recoveryKey ?? ''}
      onDone={() => navigate('/app', { replace: true })}
    />
  );
}
