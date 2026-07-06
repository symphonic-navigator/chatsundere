// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createPairingCode = vi.fn();
const listPairingCodes = vi.fn();
const revokePairingCode = vi.fn();
vi.mock('../../src/lib/pairing-codes.js', () => ({
  createPairingCode: (...a: unknown[]) => createPairingCode(...a),
  listPairingCodes: (...a: unknown[]) => listPairingCodes(...a),
  revokePairingCode: (...a: unknown[]) => revokePairingCode(...a),
}));
// qrcode draws to canvas — stub it (jsdom has no canvas).
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn().mockResolvedValue(undefined) } }));

import { copy } from '../../src/lib/copy.js';
import { AddDeviceSection } from '../../src/routes/app/account/add-device-section.js';

const ACTIVE = {
  id: 'pc-1',
  code: null,
  qr_url: null,
  created_at: '2026-07-02T10:00:00Z',
  expires_at: '2026-07-02T10:15:00Z',
  state: 'active' as const,
};

describe('AddDeviceSection', () => {
  beforeEach(() => {
    createPairingCode.mockReset();
    listPairingCodes.mockReset().mockResolvedValue([ACTIVE]);
    revokePairingCode.mockReset().mockResolvedValue(undefined);
  });

  it('lists active codes with the standing shown-once explainer and a revoke control', async () => {
    render(<AddDeviceSection baseUrl="https://srv.example" />);
    await screen.findByText(copy.addDevice.standingNote);
    expect(await screen.findByRole('button', { name: copy.addDevice.revokeCta })).toBeDefined();
  });

  it('creates a code and reveals it once with the shown-once notice', async () => {
    createPairingCode.mockResolvedValue({
      ...ACTIVE,
      code: 'ABCDE-FGHJK',
      qr_url: 'https://srv.example/join#ABCDEFGHJK',
    });
    render(<AddDeviceSection baseUrl="https://srv.example" />);
    await userEvent.click(await screen.findByRole('button', { name: copy.addDevice.createCta }));
    await screen.findByText('ABCDE-FGHJK');
    await screen.findByText(copy.addDevice.shownOnce);
  });

  it('revokes from the list', async () => {
    render(<AddDeviceSection baseUrl="https://srv.example" />);
    await userEvent.click(await screen.findByRole('button', { name: copy.addDevice.revokeCta }));
    expect(revokePairingCode).toHaveBeenCalledWith('https://srv.example', 'pc-1');
  });
});
