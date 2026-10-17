import { allServices } from '@openinc/core';
import { describe, expect, it } from 'vitest';
import { appRouter } from './router.ts';

describe('router', () => {
  it('exposes every service over tRPC', () => {
    const procedures = Object.keys(appRouter._def.procedures);
    const missing = allServices.map((s) => s.name).filter((name) => !procedures.includes(name) && name !== 'auth.me');
    expect(missing).toEqual([]);
  });
});
