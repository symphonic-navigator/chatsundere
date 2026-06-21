// SPDX-License-Identifier: AGPL-3.0-only
import { type ButtonHTMLAttributes, forwardRef } from 'react';

export type ButtonTone = 'primary' | 'neutral' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Semantic intent on the action plane. Defaults to 'neutral'. */
  tone?: ButtonTone;
  /** Gold priority overlay ("what you came for"). Ignored for destructive tone. */
  priority?: boolean;
}

/**
 * The action-plane button primitive. Three tones (primary / neutral / destructive)
 * plus a separable gold `priority` overlay. Destructive never wears gold — the
 * safety rule "gold protects, never invites" (spec §4, §5).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = 'neutral', priority, className, type, ...rest },
  ref,
): JSX.Element {
  const isGold = priority === true && tone !== 'destructive';
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      data-tone={tone}
      data-priority={isGold ? 'true' : undefined}
      className={`cs-btn${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
});
