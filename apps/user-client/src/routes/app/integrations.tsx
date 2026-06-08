// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate } from 'react-router-dom';
import { AccordionCard } from '../../components/AccordionCard.js';
import { EditorSticky } from '../../components/EditorSticky.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { McpServersSection } from '../../components/mcp/McpServersSection.js';

/**
 * My Integrations — external service & tool integrations. MCP servers are the
 * first inhabitant; web search/fetch, the expert uplink, and upstream-provider
 * configuration still live under My Settings for now.
 */
export function Integrations(): JSX.Element {
  const navigate = useNavigate();
  return (
    <section className="flex flex-col gap-3 px-4 pb-32 pt-4">
      <EditorSticky>
        <EditorTopbar
          title="My Integrations"
          isDirty={false}
          onBack={() => navigate('/app')}
          onSaveAndBack={() => {}}
          hideSaveAndBack
        />
      </EditorSticky>

      <AccordionCard icon="⧉" label="MCP Servers" meta="External tool servers">
        <McpServersSection />
      </AccordionCard>
    </section>
  );
}
