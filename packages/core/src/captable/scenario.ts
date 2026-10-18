import type { ScenarioStep } from '@openinc/shared';
import { parseDec } from '../registry/decimal.ts';
import { amountAt } from './math.ts';
import { addHolding, applyRound, ensureParty, type RoundResult } from './round.ts';
import { type CapState, cloneState, unallocated } from './state.ts';
import { buildTable, type CapTable } from './table.ts';
import { runWaterfall, type Waterfall } from './waterfall.ts';

export class ScenarioError extends Error {
  constructor(
    readonly step: number,
    message: string,
  ) {
    super(`Step ${step + 1}: ${message}`);
  }
}

export type StepResult =
  | { kind: 'priced_round'; round: RoundResult }
  | { kind: 'pool_change'; planId: string; size: string; unallocated: string }
  | { kind: 'grant_batch'; planId: string; granted: string; unallocated: string }
  | { kind: 'secondary'; units: string; amount: string }
  | { kind: 'exercise'; units: string; grants: number }
  | { kind: 'exit'; waterfall: Waterfall };

export interface ScenarioRun {
  base: CapTable;
  steps: { kind: ScenarioStep['kind']; result: StepResult; table: CapTable }[];
  end: CapTable;
  warnings: string[];
}

/** Placeholder ids for people a scenario adds; promotion swaps them for real ids. */
export const newPartyId = (step: number, i: number) => `new:${step}:${i}`;
export const isNewPartyId = (id: string) => id.startsWith('new:');

function poolFor(s: CapState, planId: string | undefined, step: number) {
  const pool = planId
    ? s.pools.find((p) => p.planId === planId)
    : (s.pools.find((p) => p.kind === 'option') ?? s.pools.find((p) => p.kind !== 'virtual'));
  if (!pool)
    throw new ScenarioError(
      step,
      planId ? 'The equity plan was not found.' : 'There is no equity plan yet. Add one under Equity Plans first.',
    );
  return pool;
}

export function applyStep(s: CapState, step: ScenarioStep, index: number, warnings: string[]): StepResult {
  switch (step.kind) {
    case 'priced_round': {
      const ids = step.investments.map((_, i) => newPartyId(index, i));
      return { kind: 'priced_round', round: applyRound(s, step, ids) };
    }
    case 'pool_change': {
      const pool = poolFor(s, step.planId, index);
      pool.size += BigInt(step.delta);
      if (pool.size < pool.used) throw new ScenarioError(index, `${pool.name} cannot shrink below the ${pool.used} units already granted.`);
      return { kind: 'pool_change', planId: pool.planId, size: pool.size.toString(), unallocated: unallocated(pool).toString() };
    }
    case 'grant_batch': {
      const pool = poolFor(s, step.planId, index);
      let granted = 0n;
      step.grants.forEach((g, i) => {
        const id = g.stakeholderId ?? newPartyId(index, i);
        ensureParty(s, id, g.newStakeholder ? { name: g.newStakeholder.name, kind: g.newStakeholder.kind } : undefined);
        if (g.newStakeholder) s.parties.get(id)!.kind = g.newStakeholder.kind;
        const units = BigInt(g.units);
        granted += units;
        s.awards.push({
          id: `grant:${index}:${i}`,
          planId: pool.planId,
          stakeholderId: id,
          kind: pool.kind,
          classCode: pool.classCode,
          outstanding: units,
          vested: 0n,
          strike: parseDec(String(g.strikePrice)),
          acceleration: 'none',
        });
      });
      pool.used += granted;
      if (pool.used > pool.size) warnings.push(`Step ${index + 1}: the grants exceed ${pool.name} by ${pool.used - pool.size} units.`);
      return { kind: 'grant_batch', planId: pool.planId, granted: granted.toString(), unallocated: unallocated(pool).toString() };
    }
    case 'secondary': {
      const units = BigInt(step.units);
      const from = s.holdings.find((h) => h.stakeholderId === step.fromStakeholderId && h.classCode === step.classCode);
      if (!from || from.units < units) throw new ScenarioError(index, `The seller holds fewer than ${units} ${step.classCode} units.`);
      const to = step.toStakeholderId ?? newPartyId(index, 0);
      ensureParty(s, to, step.newBuyer ? { name: step.newBuyer.name, kind: step.newBuyer.kind } : undefined);
      from.units -= units;
      addHolding(s, to, step.classCode, units);
      const amount = amountAt(units, parseDec(String(step.pricePerShare)), s.digits);
      return { kind: 'secondary', units: units.toString(), amount: amount.toString() };
    }
    case 'exercise': {
      let units = 0n;
      let grants = 0;
      for (const a of s.awards) {
        if (a.kind === 'virtual' || a.vested === 0n || (step.grantIds && !step.grantIds.includes(a.id))) continue;
        if (!s.classes.has(a.classCode))
          throw new ScenarioError(index, `The plan delivers class ${a.classCode || '(none)'}, which the register does not have.`);
        addHolding(s, a.stakeholderId, a.classCode, a.vested);
        units += a.vested;
        grants++;
        a.outstanding -= a.vested;
        a.vested = 0n;
      }
      s.awards = s.awards.filter((a) => a.outstanding > 0n);
      return { kind: 'exercise', units: units.toString(), grants };
    }
    case 'exit':
      return { kind: 'exit', waterfall: runWaterfall(s, step) };
  }
}

export function runScenario(base: CapState, steps: ScenarioStep[], includePool: boolean): ScenarioRun & { state: CapState } {
  const s = cloneState(base);
  const warnings: string[] = [];
  const opts = { includePool, view: 'fully_diluted' as const };
  const results = steps.map((step, i) => {
    const result = applyStep(s, step, i, warnings);
    return { kind: step.kind, result, table: buildTable(s, opts) };
  });
  return {
    base: buildTable(base, opts),
    steps: results,
    end: buildTable(s, opts),
    warnings: [...s.warnings.slice(base.warnings.length), ...warnings],
    state: s,
  };
}
