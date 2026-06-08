// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import type { ComponentPropsWithoutRef } from 'react';
import { describe, expect, it } from 'vitest';
import { createMarkdownComponents } from '../../src/components/chat/markdown/markdown-components';

describe('markdown table override', () => {
  it('wraps a table in a horizontal-scroll container', () => {
    const comps = createMarkdownComponents(null);
    const Table = comps.table as (p: ComponentPropsWithoutRef<'table'>) => JSX.Element;
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </Table>,
    );
    const wrap = container.querySelector('.msg-table-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('table')).not.toBeNull();
  });
});
