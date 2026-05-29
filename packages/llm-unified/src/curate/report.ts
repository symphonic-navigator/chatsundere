// SPDX-License-Identifier: LGPL-3.0-only
import { effectiveFreedom } from '../catalogue/freedom.js';
import type { CanonicalModel, Offering, ReasoningControl } from '../catalogue/types.js';

function caps(c: CanonicalModel['requiredCaps']): string {
  return [c.tools && 'tools', c.reasoning && 'reasoning', c.vision && 'vision']
    .filter(Boolean)
    .join(', ');
}

function reasoningSummary(r: ReasoningControl): string {
  switch (r.mode) {
    case 'none':
      return 'none';
    case 'fixed-on':
      return 'always on';
    case 'toggle':
      return 'on/off toggle';
    case 'steps':
      return `steps (${r.steps.join('/')})`;
  }
}

/** Deterministic Markdown report for one curated model. No LLM — pure render. */
export function renderReport(canonical: CanonicalModel, offerings: Offering[]): string {
  const lines: string[] = [];
  lines.push(`# ${canonical.displayName}`);
  lines.push('');
  lines.push(`- **Canonical id:** \`${canonical.id}\``);
  lines.push(`- **Family:** ${canonical.family}`);
  lines.push(`- **Capabilities:** ${caps(canonical.requiredCaps)}`);
  const modelFreedom =
    canonical.freedomOriented === null
      ? 'unassessed'
      : canonical.freedomOriented
        ? 'free'
        : 'restricted';
  lines.push(
    `- **Model freedom:** ${modelFreedom}${canonical.freedomNote ? ` — ${canonical.freedomNote}` : ''}`,
  );
  lines.push('');
  lines.push('## Offerings');
  lines.push('');
  for (const o of offerings) {
    const freedom = effectiveFreedom(canonical.freedomOriented, o.freedomOrientedDeployment);
    const privacy =
      o.trust.tee || o.trust.zdr
        ? `🔒 ${[o.trust.tee && 'TEE', o.trust.zdr && 'ZDR'].filter(Boolean).join('+')}`
        : '—';
    const tools = o.profile.toolCalls.supported
      ? o.profile.toolCalls.streaming
        ? 'streamed'
        : 'block'
      : 'unsupported';
    lines.push(`### ${o.providerId} · \`${o.upstreamSlug}\``);
    lines.push(`- Tool calls: ${tools}`);
    lines.push(`- Reasoning: ${reasoningSummary(o.profile.reasoning)}`);
    lines.push(`- Context: ${o.context.recommended} recommended / ${o.context.max} max`);
    lines.push(`- Privacy: ${privacy}`);
    lines.push(`- 🕊️ Freedom: ${freedom}`);
    lines.push(`- Confidence: ${o.confidence}`);
    lines.push('');
  }
  return lines.join('\n');
}
