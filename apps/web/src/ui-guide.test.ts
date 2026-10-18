import { readFileSync } from 'node:fs';
import { createInviteInput } from '@openinc/shared';
import { describe, expect, it } from 'vitest';
import { uiGuide } from '../../../packages/core/src/ai/ui-guide.ts';
import { validate } from './components/common.tsx';
import { MAIN_NAV, SETTINGS_NAV, SETTINGS_SECTIONS } from './components/layout/nav.ts';

// The assistant answers "how do I..." from packages/core/src/ai/ui-guide.ts. A page without an entry
// there is a page the assistant cannot explain.
describe('assistant UI guide', () => {
  it('has an entry for every sidebar item, titled as the sidebar shows it', () => {
    for (const item of [...MAIN_NAV.flatMap((m) => [m, ...(m.children ?? [])]), SETTINGS_NAV, ...SETTINGS_SECTIONS]) {
      const entry = uiGuide.find((e) => e.path === item.path);
      expect(entry, `no guide entry for ${item.path}`).toBeTruthy();
      expect(entry!.title).toBe(item.title);
    }
  });

  it('has an entry for every top-level route in App.tsx', () => {
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const routes = app
      .split(/\r?\n/)
      .filter((line) => !line.includes('<Navigate'))
      .flatMap((line) => [...line.matchAll(/path="(\/(?:settings)[^"/:]*(?:\/[^"/:]+)?)/g)].map((m) => m[1]!));
    for (const path of routes)
      expect(
        uiGuide.some((e) => e.path === path),
        path,
      ).toBe(true);
  });
});

describe('validate', () => {
  it('returns parsed data or the first error per field', () => {
    expect(validate(createInviteInput, { email: 'A@Example.com' })).toEqual({
      data: { email: 'a@example.com', role: 'member' },
      errors: null,
    });
    expect(validate(createInviteInput, { email: 'nope' }).errors).toEqual({ email: 'Enter a valid email address' });
  });
});
