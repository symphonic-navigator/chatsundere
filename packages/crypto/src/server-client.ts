// SPDX-License-Identifier: LGPL-3.0-only

import type {
  JoinFinishRequest,
  JoinFinishResponse,
  JoinStartRequest,
  JoinStartResponse,
  LinkPasskeyFinishRequest,
  LinkPasskeyFinishResponse,
  LinkPasskeyStartRequest,
  LinkPasskeyStartResponse,
  OpaqueLoginFinishRequest,
  OpaqueLoginFinishResponse,
  OpaqueLoginStartRequest,
  OpaqueLoginStartResponse,
  PassphraseChangeFinishRequest,
  PassphraseChangeFinishResponse,
  PassphraseChangeStartRequest,
  PassphraseChangeStartResponse,
  RecoveryFinishRequest,
  RecoveryFinishResponse,
  RecoveryStartRequest,
  RecoveryStartResponse,
  StepUpFinishRequest,
  StepUpFinishResponse,
  StepUpStartRequest,
  StepUpStartResponse,
} from '@chatsundere/shared-types';

/**
 * Adapter interface implemented by user-client (squash D). The crypto
 * package never opens HTTP itself — callers inject a concrete implementation.
 */
export interface ServerClient {
  joinStart(req: JoinStartRequest, baseUrl: string): Promise<JoinStartResponse>;
  joinFinish(req: JoinFinishRequest, baseUrl: string): Promise<JoinFinishResponse>;
  linkPasskeyStart(
    req: LinkPasskeyStartRequest,
    baseUrl: string,
    accessToken: string,
  ): Promise<LinkPasskeyStartResponse>;
  linkPasskeyFinish(
    req: LinkPasskeyFinishRequest,
    baseUrl: string,
    accessToken: string,
  ): Promise<LinkPasskeyFinishResponse>;
  loginOpaqueStart(
    req: OpaqueLoginStartRequest,
    baseUrl: string,
  ): Promise<OpaqueLoginStartResponse>;
  loginOpaqueFinish(
    req: OpaqueLoginFinishRequest,
    baseUrl: string,
  ): Promise<OpaqueLoginFinishResponse>;
  recoveryStart(req: RecoveryStartRequest, baseUrl: string): Promise<RecoveryStartResponse>;
  recoveryFinish(req: RecoveryFinishRequest, baseUrl: string): Promise<RecoveryFinishResponse>;
  deleteMe(baseUrl: string, accessToken: string): Promise<void>;
  passphraseChangeStart(
    req: PassphraseChangeStartRequest,
    baseUrl: string,
    accessToken: string,
  ): Promise<PassphraseChangeStartResponse>;
  passphraseChangeFinish(
    req: PassphraseChangeFinishRequest,
    baseUrl: string,
    accessToken: string,
  ): Promise<PassphraseChangeFinishResponse>;
  stepUpStart(
    req: StepUpStartRequest,
    baseUrl: string,
    accessToken: string,
  ): Promise<StepUpStartResponse>;
  stepUpFinish(req: StepUpFinishRequest, baseUrl: string): Promise<StepUpFinishResponse>;
}
