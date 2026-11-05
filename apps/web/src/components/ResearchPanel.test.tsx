import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ResearchPanel } from './ResearchPanel';
import { researchWorldFixture } from '../research.fixture';

it('reveals discovered branches, explains prerequisites, and hides uncharted technology', () => {
  const world = researchWorldFixture();
  const html = renderToStaticMarkup(<ResearchPanel world={world} connected onResearch={() => {}} />);
  expect(html).toContain('Amber Shoal archive');
  expect(html.match(/Uncharted archive/g)).toHaveLength(2);
  expect(html).not.toContain('Streamlined hulls');
  expect(html).toContain('Requires: Reinforced foundations');
  expect(html).toContain('Complete the prerequisite technology');
  expect(html).toMatch(/<button aria-describedby="reinforced_foundations-status">Research Reinforced foundations — 40 Salvage/);
  expect(html).toMatch(/<button disabled="" aria-describedby="modular_fittings-status">/);
});

it('shows completed research and disables purchases while disconnected or unaffordable', () => {
  const world = researchWorldFixture();
  world.research!.completed.push('reinforced_foundations');
  world.research!.catalog[0].available = false;
  world.research!.catalog[0].blocked_reason = 'Already researched';
  world.research!.catalog[1].blocked_reason = 'Not enough Salvage for research';
  const html = renderToStaticMarkup(<ResearchPanel world={world} connected onResearch={() => {}} />);
  expect(html).toContain('Researched: Reinforced foundations');
  expect(html).toContain('Not enough Salvage for research');
  const offline = renderToStaticMarkup(<ResearchPanel world={researchWorldFixture()} connected={false} onResearch={() => {}} />);
  expect(offline).toContain('Reconnect to research.');
  expect(offline).toMatch(/<button disabled="" aria-describedby="reinforced_foundations-status">/);
  world.research = null;
  expect(renderToStaticMarkup(<ResearchPanel world={world} connected onResearch={() => {}} />)).toBe('');
});
