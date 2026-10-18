import { isApTitleCase } from '@openinc/shared';
import { describe, expect, it } from 'vitest';
import { uiGuide } from '../../../packages/core/src/ai/ui-guide.ts';
import { MAIN_NAV, SETTINGS_NAV, SETTINGS_SECTIONS } from './components/layout/nav.ts';
import { CHECKLIST } from './components/layout/SetupChecklist.tsx';

// UI labels use AP-style Title Case (CLAUDE.md). These are the labels that live in data; JSX labels are reviewed by hand.
describe('AP Title Case labels', () => {
  it.each([
    ...[...MAIN_NAV.flatMap((m) => [m, ...(m.children ?? [])]), SETTINGS_NAV, ...SETTINGS_SECTIONS].map((n) => n.title),
    ...Object.values(CHECKLIST).map((c) => c.title),
    ...uiGuide.map((e) => e.title),
  ])('%s', (label) => {
    expect(isApTitleCase(label)).toBe(true);
  });
});
