import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  captableSettings,
  desc,
  eq,
  equityPlans,
  exercises,
  grants,
  inArray,
  isNull,
  max,
  poolChanges,
  registryTransactions,
  scenarios,
  sql,
  stakeholderGroups,
  stakeholders,
  unpricedInstruments,
  valuations,
  vestingSchedules,
} from '@openinc/db';
import {
  assignGroupInput,
  captableAsOfInput,
  captableSettingsInput,
  compareScenariosInput,
  currencyDigits,
  empty,
  exerciseGrantInput,
  fairValueInput,
  grantInput,
  groupInput,
  type HolderDetails,
  idInput,
  listScenariosInput,
  modelRoundInput,
  ownershipHistoryInput,
  PLAN_KIND_LABELS,
  PLAN_PROFILES,
  planInput,
  planProfile,
  poolChangeInput,
  promoteScenarioInput,
  type RegistryTransactionInput,
  rebaseScenarioInput,
  registryTransaction,
  runScenarioInput,
  type ScenarioStep,
  scenarioInput,
  scenarioStep,
  stakeholderDetailInput,
  stakeholderInput,
  terminateGrantInput,
  UNPRICED_PROFILES,
  unpricedInput,
  unpricedProfile,
  valuationInput,
  vestingScheduleInput,
  waterfallInput,
} from '@openinc/shared';
import { z } from 'zod';
import { audit } from '../audit.ts';
import { blackScholes } from '../captable/fair-value.ts';
import { addMonths, daysBetween, discounted, pctOf, priceOf, unitsFor } from '../captable/math.ts';
import { withMfn } from '../captable/round.ts';
import { newPartyId, runScenario, ScenarioError, type StepResult } from '../captable/scenario.ts';
import { accrued, buildState, type CapData, type CapState, cloneState, currentPrice, unallocated, vestedUnits } from '../captable/state.ts';
import { buildTable, fullyDilutedTotal, positions } from '../captable/table.ts';
import { runWaterfall, waterfallChart } from '../captable/waterfall.ts';
import { type Ctx, can } from '../context.ts';
import { badRequest, conflict, forbidden, notFound, preconditionFailed } from '../errors.ts';
import { formatDec, parseDec } from '../registry/decimal.ts';
import { replay } from '../registry/engine.ts';
import { committedRows, companyCurrency, effectiveItems, engineConfig, readRegistrySettings, settingsView } from '../registry/store.ts';
import { registerView } from '../registry/views.ts';
import { defineService, run } from '../service.ts';
import { createDraft, today } from './registry.ts';

async function loadData(ctx: Ctx): Promise<CapData> {
  const currency = await companyCurrency();
  const registry = await readRegistrySettings(ctx);
  const [settings, groups, people, schedules, plans, changes, grantRows, exerciseRows, unpriced, valuationRows, txRows] = await Promise.all(
    [
      ctx.db.select().from(captableSettings).where(eq(captableSettings.id, 1)),
      ctx.db.select().from(stakeholderGroups).orderBy(asc(stakeholderGroups.sortOrder), asc(stakeholderGroups.name)),
      ctx.db.select().from(stakeholders),
      ctx.db.select().from(vestingSchedules).orderBy(asc(vestingSchedules.name)),
      ctx.db.select().from(equityPlans).orderBy(asc(equityPlans.createdAt)),
      ctx.db.select().from(poolChanges).where(isNull(poolChanges.scenarioId)),
      ctx.db.select().from(grants).orderBy(asc(grants.grantDate)),
      ctx.db.select().from(exercises),
      ctx.db.select().from(unpricedInstruments).orderBy(asc(unpricedInstruments.signedOn)),
      ctx.db.select().from(valuations),
      registry ? committedRows(ctx) : Promise.resolve([]),
    ],
  );
  return {
    currency,
    digits: currencyDigits(currency),
    config: registry ? engineConfig(settingsView(registry), currency) : null,
    items: effectiveItems(txRows),
    settings: { includeUnallocatedPool: settings[0]?.includeUnallocatedPool ?? true },
    groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
    stakeholders: people.map((p) => ({ id: p.id, name: p.name, kind: p.kind, groupId: p.groupId })),
    schedules,
    plans: plans.map((p) => ({ id: p.id, name: p.name, kind: p.kind, classCode: p.classCode })),
    poolChanges: changes.map((c) => ({ planId: c.planId, date: c.date, delta: c.delta })),
    grants: grantRows,
    exercises: exerciseRows,
    unpriced: unpriced.map((u) => ({
      ...u,
      kind: u.kind,
      discountPct: u.discountPct,
      interestRatePct: u.interestRatePct,
    })),
    // A fair value helper result prices one option, not a share.
    valuations: valuationRows
      .filter((v) => v.source !== 'fair_value')
      .map((v) => ({ date: v.date, pricePerShare: v.pricePerShare, source: v.source })),
  };
}

async function stateAt(ctx: Ctx, asOf?: string) {
  const data = await loadData(ctx);
  const date = asOf ?? (await today());
  try {
    return { data, state: buildState(data, date) };
  } catch (error) {
    throw preconditionFailed(`The share register does not replay as of ${date}: ${(error as Error).message}`);
  }
}

const FD_DEFINITION = (includePool: boolean) =>
  `Fully diluted: issued shares as converted, plus outstanding options and warrants (vested and unvested)${includePool ? ', plus the unallocated pool' : ''}. Unpriced instruments and virtual shares are listed apart.`;

async function tableAt(ctx: Ctx, asOf: string | undefined, view: 'fully_diluted' | 'issued') {
  const { data, state } = await stateAt(ctx, asOf);
  const table = buildTable(state, { includePool: data.settings.includeUnallocatedPool, view });
  const reconciliation: { classCode: string; register: string; capTable: string; ok: boolean }[] = [];
  if (data.config) {
    const replayed = replay(data.items, data.config, { until: state.asOf });
    if (replayed.ok)
      for (const c of registerView(replayed.ledger, data.config, state.asOf).classes) {
        const units = BigInt(table.classes.find((x) => x.code === c.code)?.issued ?? '0');
        const shares = units / (state.classes.get(c.code)?.unitsPerShare ?? 1n);
        reconciliation.push({
          classCode: c.code,
          register: String(c.issued),
          capTable: shares.toString(),
          ok: String(c.issued) === shares.toString(),
        });
      }
  }
  return {
    ...table,
    view,
    registerSetUp: data.config !== null,
    groups: data.groups,
    definition: FD_DEFINITION(data.settings.includeUnallocatedPool),
    reconciliation,
  };
}

/* Settings */

export const getCaptableSettings = defineService({
  name: 'captable.settings',
  description:
    'The cap table settings: whether the unallocated pool counts in fully diluted, and whether shareholders see the whole table.',
  kind: 'query',
  access: 'captable.read',
  input: empty,
  async handler(ctx) {
    const [row] = await ctx.db.select().from(captableSettings).where(eq(captableSettings.id, 1));
    return { includeUnallocatedPool: row?.includeUnallocatedPool ?? true, holdersSeeFullTable: row?.holdersSeeFullTable ?? false };
  },
});

export const updateCaptableSettings = defineService({
  name: 'captable.updateSettings',
  description:
    'Change the cap table settings: include the unallocated pool in fully diluted counts, and let shareholders see the whole table.',
  kind: 'mutation',
  access: 'captable.manage',
  input: captableSettingsInput,
  async handler(ctx, input) {
    const [before] = await ctx.db.select().from(captableSettings).where(eq(captableSettings.id, 1));
    const values = { ...input, updatedBy: ctx.actor!.userId };
    await ctx.db
      .insert(captableSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: captableSettings.id, set: values });
    await audit(ctx, {
      action: 'captable.settings_update',
      entityType: 'captable_settings',
      before: before ? { includeUnallocatedPool: before.includeUnallocatedPool, holdersSeeFullTable: before.holdersSeeFullTable } : null,
      after: input,
    });
    return input;
  },
});

/* The table */

export const getCaptable = defineService({
  name: 'captable.get',
  description:
    'The cap table as of a date (default today): per stakeholder their units per share class, outstanding options and warrants, virtual shares, issued and fully diluted counts and percentages, votes, and value at the last price; the unallocated pool rows; unpriced instruments (SAFEs, convertible loans) listed apart; the share classes and the price used. view "issued" leaves out options and the pool. Always reconciles to the share register.',
  kind: 'query',
  access: 'captable.read',
  input: captableAsOfInput,
  async handler(ctx, input) {
    return tableAt(ctx, input.asOf, input.view);
  },
});

export const ownershipHistory = defineService({
  name: 'captable.history',
  description:
    'Fully diluted ownership per stakeholder group after every share register transaction, grant, exercise and pool change, for an ownership-over-time chart. Points that are priced issues carry their register transaction id.',
  kind: 'query',
  access: 'captable.read',
  input: ownershipHistoryInput,
  async handler(ctx, input) {
    const data = await loadData(ctx);
    const until = input.until ?? (await today());
    const issues = new Map<string, string>();
    for (const i of data.items)
      if (i.tx.type === 'new_issue' && parseDec(String(i.tx.pricePerShare)) > 0n) issues.set(i.tx.effectiveDate, i.id);
    const dates = [
      ...new Set([
        ...data.items.map((i) => i.tx.effectiveDate),
        ...data.grants.map((g) => g.grantDate),
        ...data.grants.flatMap((g) => (g.terminatedOn ? [g.terminatedOn] : [])),
        ...data.poolChanges.map((c) => c.date),
        ...data.exercises.map((e) => e.date),
      ]),
    ]
      .filter((d) => d <= until)
      .sort()
      .slice(-120);
    const points = dates.map((date) => {
      const s = buildState(data, date);
      const { rows, pools } = positions(s, data.settings.includeUnallocatedPool);
      const total = fullyDilutedTotal(s, data.settings.includeUnallocatedPool);
      const byGroup: Record<string, string> = {};
      const sums = new Map<string, bigint>();
      for (const [id, r] of rows) {
        const key = s.parties.get(id)?.groupId ?? 'ungrouped';
        sums.set(key, (sums.get(key) ?? 0n) + r.converted + r.awards);
      }
      const poolUnits = pools.reduce((t, p) => t + unallocated(p), 0n);
      if (poolUnits > 0n) sums.set('pool', poolUnits);
      for (const [k, v] of sums) byGroup[k] = formatDec(pctOf(v, total), 4);
      return { date, fullyDiluted: total.toString(), byGroup, roundTxId: issues.get(date) ?? null };
    });
    return {
      series: [
        ...data.groups.map((g) => ({ key: g.id, name: g.name, color: g.color })),
        { key: 'ungrouped', name: 'Ungrouped', color: 'slate' },
        { key: 'pool', name: 'Unallocated Pool', color: 'teal' },
      ].filter((s) => points.some((p) => p.byGroup[s.key] !== undefined)),
      points,
    };
  },
});

/* Stakeholders and groups */

export const listStakeholders = defineService({
  name: 'captable.listStakeholders',
  description:
    'Everyone on the cap table with their id: holders in the share register and people who only hold options, virtual shares or SAFEs, with their stakeholder group. Use the ids for grants, instruments and scenarios.',
  kind: 'query',
  access: 'captable.read',
  input: empty,
  async handler(ctx) {
    const { data, state } = await stateAt(ctx);
    const extra = new Map((await ctx.db.select().from(stakeholders)).map((s) => [s.id, { email: s.email, country: s.country }]));
    return {
      groups: data.groups,
      stakeholders: [...state.parties.values()]
        .map((p) => ({ ...p, email: extra.get(p.id)?.email ?? '', country: extra.get(p.id)?.country ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

export const saveStakeholder = defineService({
  name: 'captable.saveStakeholder',
  description:
    'Add or edit a cap table stakeholder who is not (yet) in the share register, such as an employee with options or a SAFE investor. Holders in the register are edited there; use assignGroup to group them.',
  kind: 'mutation',
  access: 'captable.manage',
  input: stakeholderInput,
  async handler(ctx, input) {
    const id = input.id ?? randomUUID();
    const [before] = await ctx.db.select().from(stakeholders).where(eq(stakeholders.id, id));
    const values = { name: input.name, kind: input.kind, email: input.email, country: input.country, groupId: input.groupId };
    const [row] = await ctx.db
      .insert(stakeholders)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: stakeholders.id, set: values })
      .returning();
    await audit(ctx, {
      action: before ? 'captable.stakeholder_update' : 'captable.stakeholder_create',
      entityType: 'captable_stakeholder',
      entityId: id,
      before: before ?? null,
      after: row,
    });
    return row!;
  },
});

export const assignGroup = defineService({
  name: 'captable.assignGroup',
  description:
    'Put a stakeholder (a share register holder or a cap table stakeholder) in a stakeholder group such as Founders, Employees or Investors, or take them out with null.',
  kind: 'mutation',
  access: 'captable.manage',
  input: assignGroupInput,
  async handler(ctx, input) {
    const { state } = await stateAt(ctx);
    const party = state.parties.get(input.stakeholderId);
    if (!party) throw notFound('Stakeholder');
    const [before] = await ctx.db.select().from(stakeholders).where(eq(stakeholders.id, input.stakeholderId));
    await ctx.db
      .insert(stakeholders)
      .values({ id: input.stakeholderId, name: party.name, kind: party.kind, groupId: input.groupId })
      .onConflictDoUpdate({ target: stakeholders.id, set: { groupId: input.groupId } });
    await audit(ctx, {
      action: 'captable.group_assign',
      entityType: 'captable_stakeholder',
      entityId: input.stakeholderId,
      before: { groupId: before?.groupId ?? null },
      after: { groupId: input.groupId },
    });
    return { stakeholderId: input.stakeholderId, groupId: input.groupId };
  },
});

export const saveGroup = defineService({
  name: 'captable.saveGroup',
  description:
    'Create or rename a stakeholder group (for example Founders, Employees, Investors, Advisors). Every cap table view rolls up by group.',
  kind: 'mutation',
  access: 'captable.manage',
  input: groupInput,
  async handler(ctx, input) {
    if (input.id) {
      const [before] = await ctx.db.select().from(stakeholderGroups).where(eq(stakeholderGroups.id, input.id));
      if (!before) throw notFound('Group');
      const [row] = await ctx.db
        .update(stakeholderGroups)
        .set({ name: input.name, color: input.color })
        .where(eq(stakeholderGroups.id, input.id))
        .returning();
      await audit(ctx, { action: 'captable.group_update', entityType: 'captable_group', entityId: input.id, before, after: row });
      return row!;
    }
    const [row] = await ctx.db.insert(stakeholderGroups).values({ name: input.name, color: input.color }).returning();
    await audit(ctx, { action: 'captable.group_create', entityType: 'captable_group', entityId: row!.id, after: row });
    return row!;
  },
});

export const deleteGroup = defineService({
  name: 'captable.deleteGroup',
  description: 'Delete a stakeholder group. Its members become ungrouped; nothing else changes.',
  kind: 'mutation',
  access: 'captable.manage',
  input: idInput,
  async handler(ctx, input) {
    const [before] = await ctx.db.delete(stakeholderGroups).where(eq(stakeholderGroups.id, input.id)).returning();
    if (!before) throw notFound('Group');
    await audit(ctx, { action: 'captable.group_delete', entityType: 'captable_group', entityId: input.id, before });
    return { ok: true };
  },
});

export const stakeholderDetail = defineService({
  name: 'captable.stakeholder',
  description:
    "One stakeholder's position as of a date: shares per class, grants with vesting (vested, unvested, exercised, next vesting dates), virtual shares, unpriced instruments with accrued interest, fully diluted percentage and value at the last price.",
  kind: 'query',
  access: 'captable.read',
  input: stakeholderDetailInput,
  async handler(ctx, input) {
    const { data, state } = await stateAt(ctx, input.asOf);
    const party = state.parties.get(input.stakeholderId);
    if (!party) throw notFound('Stakeholder');
    const table = buildTable(state, { includePool: data.settings.includeUnallocatedPool, view: 'fully_diluted' });
    const schedules = new Map(data.schedules.map((s) => [s.id, s]));
    const plans = new Map(data.plans.map((p) => [p.id, p]));
    const grantRows = data.grants
      .filter((g) => g.stakeholderId === input.stakeholderId)
      .map((g) => {
        const schedule = g.scheduleId ? (schedules.get(g.scheduleId) ?? null) : null;
        const award = state.awards.find((a) => a.id === g.id);
        const exercised = data.exercises.filter((e) => e.grantId === g.id).reduce((s, e) => s + e.units, 0n);
        const upcoming = schedule
          ? Array.from({ length: 12 }, (_, i) => addMonths(state.asOf, i + 1))
              .map((date) => ({ date, vested: vestedUnits(g, schedule, date) }))
              .filter((p, i, all) => p.vested > (i === 0 ? vestedUnits(g, schedule, state.asOf) : all[i - 1]!.vested))
              .map((p) => ({ date: p.date, vestedTotal: p.vested.toString() }))
          : [];
        return {
          id: g.id,
          planId: g.planId,
          planName: plans.get(g.planId)?.name ?? '',
          kind: plans.get(g.planId)?.kind ?? 'option',
          units: g.units.toString(),
          strikePrice: g.strikePrice,
          grantDate: g.grantDate,
          vestingStart: g.vestingStart,
          scheduleName: schedule?.name ?? null,
          outstanding: (award?.outstanding ?? 0n).toString(),
          vested: (award?.vested ?? 0n).toString(),
          exercised: exercised.toString(),
          terminatedOn: g.terminatedOn,
          leaver: g.leaver,
          upcoming,
        };
      });
    const price = currentPrice(state);
    return {
      asOf: state.asOf,
      currency: state.currency,
      stakeholder: party,
      row: table.rows.find((r) => r.stakeholderId === input.stakeholderId) ?? null,
      holdings: state.holdings
        .filter((h) => h.stakeholderId === input.stakeholderId && h.units > 0n)
        .map((h) => ({ classCode: h.classCode, units: h.units.toString() })),
      grants: grantRows,
      unpriced: state.unpriced
        .filter((u) => u.stakeholderId === input.stakeholderId)
        .map((u) => ({ id: u.id, profile: u.profile, amount: u.principal.toString(), accrued: accrued(u, state.asOf).toString() })),
      price: price ? { pricePerShare: formatDec(price.price), date: price.date, source: price.source } : null,
    };
  },
});

/* Equity plans */

export const listPlans = defineService({
  name: 'captable.listPlans',
  description:
    'Equity plans (options, warrants, virtual shares and the country profiles such as Swedish warrants, KPO, VSOP, BSPCE, EMI) with their pool size, granted, vested, exercised, forfeited and unallocated units, every grant, the vesting schedules, and a 12-month vesting calendar.',
  kind: 'query',
  access: 'captable.read',
  input: captableAsOfInput.pick({ asOf: true }),
  async handler(ctx, input) {
    const { data, state } = await stateAt(ctx, input.asOf);
    const planRows = await ctx.db.select().from(equityPlans).orderBy(asc(equityPlans.createdAt));
    const names = new Map([...state.parties.values()].map((p) => [p.id, p.name]));
    const schedules = new Map(data.schedules.map((s) => [s.id, s]));
    const months = Array.from({ length: 12 }, (_, i) => addMonths(state.asOf, i + 1));
    const calendar = months.map((date, i) => {
      const prev = i === 0 ? state.asOf : months[i - 1]!;
      let units = 0n;
      for (const g of data.grants) {
        if (g.terminatedOn || g.grantDate > date) continue;
        const sch = g.scheduleId ? (schedules.get(g.scheduleId) ?? null) : null;
        if (!sch) continue;
        units += vestedUnits(g, sch, date) - vestedUnits(g, sch, prev);
      }
      return { month: date.slice(0, 7), units: units.toString() };
    });
    return {
      asOf: state.asOf,
      profiles: PLAN_PROFILES,
      kindLabels: PLAN_KIND_LABELS,
      schedules: data.schedules,
      calendar,
      plans: planRows.map((p) => {
        const pool = state.pools.find((x) => x.planId === p.id)!;
        const planGrants = data.grants.filter((g) => g.planId === p.id && g.grantDate <= state.asOf);
        const awards = state.awards.filter((a) => a.planId === p.id);
        const exercised = data.exercises.filter((e) => planGrants.some((g) => g.id === e.grantId)).reduce((s, e) => s + e.units, 0n);
        const granted = planGrants.reduce((s, g) => s + g.units, 0n);
        const outstanding = awards.reduce((s, a) => s + a.outstanding, 0n);
        return {
          ...p,
          profileLabel: planProfile(p.profile)?.label ?? p.profile,
          poolSize: pool.size.toString(),
          granted: granted.toString(),
          outstanding: outstanding.toString(),
          vested: awards.reduce((s, a) => s + a.vested, 0n).toString(),
          exercised: exercised.toString(),
          forfeited: (granted - outstanding - exercised).toString(),
          unallocated: unallocated(pool).toString(),
          grants: planGrants.map((g) => {
            const a = awards.find((x) => x.id === g.id);
            return {
              ...g,
              units: g.units.toString(),
              stakeholderName: names.get(g.stakeholderId) ?? 'Unknown',
              scheduleName: g.scheduleId ? (schedules.get(g.scheduleId)?.name ?? null) : null,
              outstanding: (a?.outstanding ?? 0n).toString(),
              vested: (a?.vested ?? 0n).toString(),
            };
          }),
        };
      }),
    };
  },
});

export const savePlan = defineService({
  name: 'captable.savePlan',
  description:
    'Create or edit an equity plan: a profile (options, warrants, virtual or phantom shares, or a country profile such as Swedish warrants or KPO, German VSOP, French BSPCE, UK EMI), the share class an exercise delivers, and on creation the pool size. Change the pool later with changePool.',
  kind: 'mutation',
  access: 'captable.manage',
  input: planInput,
  async handler(ctx, input) {
    const profile = planProfile(input.profile);
    const kind = profile?.kind ?? input.kind;
    if (kind !== 'virtual' && !input.classCode) throw badRequest('Pick the share class an exercise delivers');
    const values = {
      name: input.name,
      profile: input.profile,
      kind,
      classCode: input.classCode,
      approvedOn: input.approvedOn,
      notes: input.notes,
    };
    if (input.id) {
      const [before] = await ctx.db.select().from(equityPlans).where(eq(equityPlans.id, input.id));
      if (!before) throw notFound('Equity plan');
      const [row] = await ctx.db.update(equityPlans).set(values).where(eq(equityPlans.id, input.id)).returning();
      await audit(ctx, { action: 'captable.plan_update', entityType: 'captable_plan', entityId: input.id, before, after: row });
      return row!;
    }
    const [row] = await ctx.db.insert(equityPlans).values(values).returning();
    const size = BigInt(input.poolSize);
    if (size > 0n)
      await ctx.db.insert(poolChanges).values({
        planId: row!.id,
        date: input.approvedOn ?? (await today()),
        delta: size,
        note: 'Initial pool',
        createdBy: ctx.actor!.userId,
      });
    await audit(ctx, {
      action: 'captable.plan_create',
      entityType: 'captable_plan',
      entityId: row!.id,
      after: { ...row, poolSize: size.toString() },
    });
    return row!;
  },
});

export const changePool = defineService({
  name: 'captable.changePool',
  description:
    'Top up (positive delta) or shrink (negative) an equity plan pool from a date, with a note such as the board decision. A pool cannot shrink below what is granted.',
  kind: 'mutation',
  access: 'captable.manage',
  input: poolChangeInput,
  async handler(ctx, input) {
    const { state } = await stateAt(ctx, input.date);
    const pool = state.pools.find((p) => p.planId === input.planId);
    if (!pool) throw notFound('Equity plan');
    const delta = BigInt(input.delta);
    if (pool.size + delta < pool.used) throw badRequest(`The pool cannot shrink below the ${pool.used} units already granted`);
    const [row] = await ctx.db
      .insert(poolChanges)
      .values({ planId: input.planId, date: input.date, delta, note: input.note, createdBy: ctx.actor!.userId })
      .returning();
    await audit(ctx, {
      action: 'captable.pool_change',
      entityType: 'captable_plan',
      entityId: input.planId,
      before: { size: pool.size.toString() },
      after: { size: (pool.size + delta).toString(), date: input.date, note: input.note },
    });
    return { ...row!, delta: row!.delta.toString() };
  },
});

export const saveSchedule = defineService({
  name: 'captable.saveSchedule',
  description:
    'Create or edit a vesting schedule template: cliff, total months, how often it vests, and single- or double-trigger acceleration on an exit.',
  kind: 'mutation',
  access: 'captable.manage',
  input: vestingScheduleInput,
  async handler(ctx, input) {
    const { id, ...values } = input;
    if (id) {
      const [before] = await ctx.db.select().from(vestingSchedules).where(eq(vestingSchedules.id, id));
      if (!before) throw notFound('Vesting schedule');
      const [row] = await ctx.db.update(vestingSchedules).set(values).where(eq(vestingSchedules.id, id)).returning();
      await audit(ctx, { action: 'captable.schedule_update', entityType: 'captable_schedule', entityId: id, before, after: row });
      return row!;
    }
    const [row] = await ctx.db.insert(vestingSchedules).values(values).returning();
    await audit(ctx, { action: 'captable.schedule_create', entityType: 'captable_schedule', entityId: row!.id, after: row });
    return row!;
  },
});

export const saveGrant = defineService({
  name: 'captable.saveGrant',
  description:
    'Grant options, warrants or virtual shares from an equity plan to a stakeholder, with strike price, grant date, vesting start and schedule; or edit a grant. The pool must have room. Shares only reach the register when the grant is exercised.',
  kind: 'mutation',
  access: 'captable.manage',
  input: grantInput,
  async handler(ctx, input) {
    const { state } = await stateAt(ctx, input.grantDate);
    if (!state.parties.has(input.stakeholderId)) throw notFound('Stakeholder');
    const pool = state.pools.find((p) => p.planId === input.planId);
    if (!pool) throw notFound('Equity plan');
    const units = BigInt(input.units);
    const [before] = input.id ? await ctx.db.select().from(grants).where(eq(grants.id, input.id)) : [];
    if (input.id && !before) throw notFound('Grant');
    const room = unallocated(pool) + (before && before.planId === input.planId ? before.units : 0n);
    if (units > room) throw badRequest(`The pool has ${room} units left; top it up first`);
    await ensureStakeholderRow(ctx, state, input.stakeholderId);
    const values = {
      planId: input.planId,
      stakeholderId: input.stakeholderId,
      units,
      strikePrice: String(input.strikePrice),
      grantDate: input.grantDate,
      vestingStart: input.vestingStart,
      scheduleId: input.scheduleId,
      notes: input.notes,
    };
    const [row] = before
      ? await ctx.db.update(grants).set(values).where(eq(grants.id, before.id)).returning()
      : await ctx.db.insert(grants).values(values).returning();
    await audit(ctx, {
      action: before ? 'captable.grant_update' : 'captable.grant_create',
      entityType: 'captable_grant',
      entityId: row!.id,
      before: before ? { ...before, units: before.units.toString() } : null,
      after: { ...row!, units: row!.units.toString() },
    });
    return { ...row!, units: row!.units.toString() };
  },
});

export const terminateGrant = defineService({
  name: 'captable.terminateGrant',
  description:
    'Record that a grant holder left on a date. A good leaver keeps what had vested; a bad leaver forfeits everything not yet exercised. Forfeited units go back to the pool.',
  kind: 'mutation',
  access: 'captable.manage',
  input: terminateGrantInput,
  async handler(ctx, input) {
    const [before] = await ctx.db.select().from(grants).where(eq(grants.id, input.grantId));
    if (!before) throw notFound('Grant');
    if (input.date < before.grantDate) throw badRequest('The leaving date is before the grant date');
    const [row] = await ctx.db
      .update(grants)
      .set({ terminatedOn: input.date, leaver: input.leaver })
      .where(eq(grants.id, input.grantId))
      .returning();
    await audit(ctx, {
      action: 'captable.grant_terminate',
      entityType: 'captable_grant',
      entityId: input.grantId,
      before: { terminatedOn: before.terminatedOn, leaver: before.leaver },
      after: { terminatedOn: input.date, leaver: input.leaver },
    });
    return { ...row!, units: row!.units.toString() };
  },
});

async function ensureStakeholderRow(ctx: Ctx, state: CapState, id: string) {
  const p = state.parties.get(id);
  if (!p) return;
  await ctx.db.insert(stakeholders).values({ id, name: p.name, kind: p.kind, groupId: p.groupId }).onConflictDoNothing();
}

async function holderDetailsFor(ctx: Ctx, state: CapState, ids: string[]): Promise<HolderDetails[]> {
  const fresh = [...new Set(ids)].filter((id) => !state.parties.get(id)?.inRegister);
  if (!fresh.length) return [];
  const rows = await ctx.db.select().from(stakeholders).where(inArray(stakeholders.id, fresh));
  return fresh.map((id) => {
    const r = rows.find((x) => x.id === id);
    const p = state.parties.get(id);
    return {
      holderId: id,
      kind: r?.kind ?? p?.kind ?? 'person',
      name: r?.name || p?.name || 'New Holder',
      nationalId: '',
      country: r?.country ?? '',
      address: '',
      email: r?.email ?? '',
      members: [],
    };
  });
}

function sharesFor(state: CapState, classCode: string, units: bigint) {
  const per = state.classes.get(classCode)?.unitsPerShare ?? 1n;
  return units / per;
}

export const exerciseGrant = defineService({
  name: 'captable.exerciseGrant',
  description:
    'Exercise vested options or warrants: drafts a new issue in the share register at the strike price (a person commits it in the register wizard at the returned url) and records the exercise, which counts once that transaction is committed. Virtual shares cannot be exercised; they pay cash at an exit.',
  kind: 'mutation',
  access: 'captable.manage',
  input: exerciseGrantInput,
  async handler(ctx, input) {
    const { state } = await stateAt(ctx, input.date);
    const [grant] = await ctx.db.select().from(grants).where(eq(grants.id, input.grantId));
    if (!grant) throw notFound('Grant');
    const award = state.awards.find((a) => a.id === grant.id);
    if (!award) throw badRequest('Nothing is outstanding on this grant on that date');
    if (award.kind === 'virtual') throw badRequest('Virtual shares are settled in cash and cannot be exercised');
    const units = BigInt(input.units);
    if (units > award.vested) throw badRequest(`Only ${award.vested} units are vested and not yet exercised`);
    const cls = state.classes.get(award.classCode);
    if (!cls) throw preconditionFailed(`The register has no class ${award.classCode}. Create it with a class terms change first.`);
    const count = sharesFor(state, award.classCode, units);
    const holders = await holderDetailsFor(ctx, state, [grant.stakeholderId]);
    const tx: RegistryTransactionInput = {
      type: 'new_issue',
      effectiveDate: input.date,
      form: 'cash',
      allocation: 'directed',
      classCode: award.classCode,
      pricePerShare: formatDec(award.strike * cls.unitsPerShare),
      subscriptions: [{ holderId: grant.stakeholderId, count: count.toString() }],
      holders,
      note: `Exercise of ${units} ${PLAN_KIND_LABELS[award.kind].toLowerCase()}`,
    };
    const draft = await run(createDraft, ctx, {
      transaction: registryTransaction.parse(tx),
      origin: { module: 'captable', reference: grant.id, label: 'Exercise' },
    });
    const [row] = await ctx.db
      .insert(exercises)
      .values({ grantId: grant.id, date: input.date, units, registryTxId: draft.id, createdBy: ctx.actor!.userId })
      .returning();
    await audit(ctx, {
      action: 'captable.grant_exercise',
      entityType: 'captable_grant',
      entityId: grant.id,
      after: { units: units.toString(), date: input.date, registryTxId: draft.id },
    });
    return { exerciseId: row!.id, draft };
  },
});

/* Unpriced instruments */

export const listUnpriced = defineService({
  name: 'captable.listUnpriced',
  description:
    'SAFEs, convertible loans and the European profiles (Swedish convertible loan agreement, Wandeldarlehen, BSA AIR, ASA) not yet converted: amount, cap, discount, interest accrued to the date, and what each would convert into at its cap and at the discounted current price.',
  kind: 'query',
  access: 'captable.read',
  input: captableAsOfInput.pick({ asOf: true }),
  async handler(ctx, input) {
    const { state } = await stateAt(ctx, input.asOf);
    const rows = await ctx.db.select().from(unpricedInstruments).orderBy(asc(unpricedInstruments.signedOn));
    const fd = fullyDilutedTotal(state, true);
    const price = currentPrice(state);
    return {
      asOf: state.asOf,
      currency: state.currency,
      profiles: UNPRICED_PROFILES,
      price: price ? { pricePerShare: formatDec(price.price), date: price.date, source: price.source } : null,
      instruments: rows.map((r) => {
        const live = state.unpriced.find((u) => u.id === r.id);
        const terms = live ? withMfn(state, live) : null;
        const amount = live ? accrued(live, state.asOf) : r.amount;
        const capPrice = terms?.valuationCap && fd > 0n ? priceOf(terms.valuationCap, fd, state.digits) : null;
        const discountPrice = price && terms && terms.discountPct > 0n ? discounted(price.price, terms.discountPct) : null;
        return {
          ...r,
          amount: r.amount.toString(),
          originalAmount: r.originalAmount?.toString() ?? null,
          valuationCap: r.valuationCap?.toString() ?? null,
          stakeholderName: state.parties.get(r.stakeholderId)?.name ?? 'Unknown',
          profileLabel: unpricedProfile(r.profile)?.label ?? r.profile,
          status: r.cancelledOn ? 'cancelled' : !live ? 'converted' : 'outstanding',
          accrued: amount.toString(),
          days: live ? daysBetween(live.signedOn, state.asOf) : 0,
          mfnFrom: terms?.mfnFrom ?? null,
          atCap: capPrice ? { pricePerShare: formatDec(capPrice), units: unitsFor(amount, capPrice, state.digits).toString() } : null,
          atDiscount: discountPrice
            ? { pricePerShare: formatDec(discountPrice), units: unitsFor(amount, discountPrice, state.digits).toString() }
            : null,
        };
      }),
    };
  },
});

export const saveUnpriced = defineService({
  name: 'captable.saveUnpriced',
  description:
    'Add or edit an unpriced instrument: a SAFE (pre- or post-money), a convertible loan or a European profile (Swedish konvertibelt lån agreement, German Wandeldarlehen, French BSA AIR, UK ASA, Dutch convertible loan). Amounts are minor units of the company currency; keep the original amount and currency when the money came in another one.',
  kind: 'mutation',
  access: 'captable.manage',
  input: unpricedInput,
  async handler(ctx, input) {
    const { state } = await stateAt(ctx);
    if (!state.parties.has(input.stakeholderId)) throw notFound('Stakeholder');
    await ensureStakeholderRow(ctx, state, input.stakeholderId);
    const profile = unpricedProfile(input.profile);
    const values = {
      stakeholderId: input.stakeholderId,
      profile: input.profile,
      kind: profile?.kind ?? 'safe',
      amount: BigInt(input.amount),
      originalAmount: input.originalAmount === null ? null : BigInt(input.originalAmount),
      originalCurrency: input.originalCurrency,
      valuationCap: input.valuationCap === null ? null : BigInt(input.valuationCap),
      discountPct: String(input.discountPct),
      interestRatePct: String(input.interestRatePct),
      interest: input.interest,
      postMoney: profile?.postMoney ?? input.postMoney,
      mfn: input.mfn,
      signedOn: input.signedOn,
      maturityDate: input.maturityDate,
      notes: input.notes,
      fileId: input.fileId,
    };
    const [before] = input.id ? await ctx.db.select().from(unpricedInstruments).where(eq(unpricedInstruments.id, input.id)) : [];
    if (input.id && !before) throw notFound('Instrument');
    if (before?.conversionTxId) throw conflict('This instrument has converted and can no longer change');
    const [row] = before
      ? await ctx.db.update(unpricedInstruments).set(values).where(eq(unpricedInstruments.id, before.id)).returning()
      : await ctx.db.insert(unpricedInstruments).values(values).returning();
    const plain = (r: typeof row) =>
      r && {
        ...r,
        amount: r.amount.toString(),
        originalAmount: r.originalAmount?.toString() ?? null,
        valuationCap: r.valuationCap?.toString() ?? null,
      };
    await audit(ctx, {
      action: before ? 'captable.unpriced_update' : 'captable.unpriced_create',
      entityType: 'captable_unpriced',
      entityId: row!.id,
      before: plain(before) ?? null,
      after: plain(row),
    });
    return plain(row)!;
  },
});

export const cancelUnpriced = defineService({
  name: 'captable.cancelUnpriced',
  description: 'Mark an unpriced instrument as cancelled or repaid from a date, so it no longer counts or converts.',
  kind: 'mutation',
  access: 'captable.manage',
  input: idInput.extend({ date: z.iso.date() }),
  async handler(ctx, input) {
    const [before] = await ctx.db.select().from(unpricedInstruments).where(eq(unpricedInstruments.id, input.id));
    if (!before) throw notFound('Instrument');
    if (before.conversionTxId) throw conflict('This instrument has converted');
    await ctx.db.update(unpricedInstruments).set({ cancelledOn: input.date }).where(eq(unpricedInstruments.id, input.id));
    await audit(ctx, {
      action: 'captable.unpriced_cancel',
      entityType: 'captable_unpriced',
      entityId: input.id,
      before: { cancelledOn: before.cancelledOn },
      after: { cancelledOn: input.date },
    });
    return { ok: true };
  },
});

/* Valuations */

export const listValuations = defineService({
  name: 'captable.listValuations',
  description:
    'The price per share history: priced rounds from the share register and recorded valuations (internal, external reports, fair value helper results), newest first.',
  kind: 'query',
  access: 'captable.read',
  input: empty,
  async handler(ctx) {
    const data = await loadData(ctx);
    const rows = await ctx.db.select().from(valuations).orderBy(desc(valuations.date));
    const rounds = data.items
      .filter((i) => i.tx.type === 'new_issue' && parseDec(String(i.tx.pricePerShare)) > 0n)
      .map((i) => ({
        id: i.id,
        date: i.tx.effectiveDate,
        pricePerShare: formatDec(parseDec(String((i.tx as { pricePerShare: string }).pricePerShare))),
        source: 'round' as const,
        method: '',
        notes: '',
        registryTxId: i.id,
      }));
    return {
      currency: data.currency,
      items: [
        ...rows.map((r) => ({
          id: r.id,
          date: r.date,
          pricePerShare: formatDec(parseDec(r.pricePerShare)),
          source: r.source,
          method: r.method,
          notes: r.notes,
          registryTxId: null,
          inputs: r.inputs,
        })),
        ...rounds.map((r) => ({ ...r, inputs: {} })),
      ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    };
  },
});

export const saveValuation = defineService({
  name: 'captable.saveValuation',
  description:
    'Record a valuation: the price per share on a date, its source (internal, external report or fair value helper) and method. The latest of these and the last priced round values holdings.',
  kind: 'mutation',
  access: 'captable.manage',
  input: valuationInput,
  async handler(ctx, input) {
    const { id, ...rest } = input;
    const values = { ...rest, pricePerShare: String(input.pricePerShare), createdBy: ctx.actor!.userId };
    if (id) {
      const [before] = await ctx.db.select().from(valuations).where(eq(valuations.id, id));
      if (!before) throw notFound('Valuation');
      const [row] = await ctx.db.update(valuations).set(values).where(eq(valuations.id, id)).returning();
      await audit(ctx, { action: 'captable.valuation_update', entityType: 'captable_valuation', entityId: id, before, after: row });
      return row!;
    }
    const [row] = await ctx.db.insert(valuations).values(values).returning();
    await audit(ctx, { action: 'captable.valuation_create', entityType: 'captable_valuation', entityId: row!.id, after: row });
    return row!;
  },
});

export const deleteValuation = defineService({
  name: 'captable.deleteValuation',
  description: 'Delete a recorded valuation. Priced rounds come from the share register and cannot be deleted here.',
  kind: 'mutation',
  access: 'captable.manage',
  input: idInput,
  async handler(ctx, input) {
    const [before] = await ctx.db.delete(valuations).where(eq(valuations.id, input.id)).returning();
    if (!before) throw notFound('Valuation');
    await audit(ctx, { action: 'captable.valuation_delete', entityType: 'captable_valuation', entityId: input.id, before });
    return { ok: true };
  },
});

export const fairValue = defineService({
  name: 'captable.fairValue',
  description:
    'Black-Scholes market value of one option or warrant (for Swedish or Danish warrants, French BSA, EMI and similar), from share price, strike, years, volatility, risk-free rate and dividend yield. Not a formal valuation. With saveOn it is recorded in the valuation log with its inputs (needs cap table manage rights).',
  kind: 'mutation',
  access: 'captable.model',
  input: fairValueInput,
  async handler(ctx, input) {
    const n = (v: string | number) => Number(v);
    const result = blackScholes({
      share: n(input.sharePrice),
      strike: n(input.strikePrice),
      years: n(input.years),
      volatility: n(input.volatilityPct) / 100,
      riskFree: n(input.riskFreePct) / 100,
      dividend: n(input.dividendPct) / 100,
    });
    const value = result.value.toFixed(6);
    if (input.saveOn) {
      if (!can(ctx, 'captable.manage')) throw forbidden('Saving a valuation needs cap table manage rights');
      const { saveOn, ...inputs } = input;
      const [row] = await ctx.db
        .insert(valuations)
        .values({
          date: saveOn,
          pricePerShare: value,
          source: 'fair_value',
          method: 'Black-Scholes (option value per unit)',
          notes: 'Fair value helper estimate, not a formal valuation.',
          inputs,
          createdBy: ctx.actor!.userId,
        })
        .returning();
      await audit(ctx, { action: 'captable.fair_value_save', entityType: 'captable_valuation', entityId: row!.id, after: row });
    }
    return {
      value,
      intrinsic: result.intrinsic.toFixed(6),
      d1: result.d1,
      d2: result.d2,
      note: 'An estimate from the Black-Scholes model, not a formal valuation.',
    };
  },
});

/* Modelling */

function scenarioError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ScenarioError) throw badRequest(error.message);
    throw error;
  }
}

export const modelRound = defineService({
  name: 'captable.modelRound',
  description:
    'Model one priced round on the current cap table without saving: give the pre-money valuation or the price per share (minor units / major units), the investments, the new class terms, an optional pool target (percent of post- or pre-money) and which SAFEs and loans convert. Returns the price, new units per investor, each conversion (at cap or discount, with interest), the pool top-up, pro rata amounts and the cap table before and after. Save it as a scenario with saveScenario to keep it.',
  kind: 'query',
  access: 'captable.model',
  input: modelRoundInput,
  async handler(ctx, input) {
    const { asOf, ...step } = input;
    const { data, state } = await stateAt(ctx, asOf ?? input.date);
    const run = scenarioError(() => runScenario(state, [{ kind: 'priced_round', ...step }], data.settings.includeUnallocatedPool));
    const result = run.steps[0]!.result as Extract<StepResult, { kind: 'priced_round' }>;
    return { round: result.round, before: run.base, after: run.end, warnings: run.warnings, currency: state.currency };
  },
});

export const waterfall = defineService({
  name: 'captable.waterfall',
  description:
    'Exit waterfall: what every stakeholder receives at an exit value (minor units) after transaction costs and debt, paying liquidation preferences by seniority, participation up to caps, preferred converting when that pays more, and options and virtual shares net of strike. Runs on the real cap table at a date, or on the end of a saved scenario. With chartMax it also returns payouts across exit values from zero for a breakpoint chart.',
  kind: 'query',
  access: 'captable.model',
  input: waterfallInput,
  async handler(ctx, input) {
    let { state } = await stateAt(ctx, input.asOf);
    if (input.scenarioId) {
      const scenario = await visibleScenario(ctx, input.scenarioId);
      const base = await stateAt(ctx, scenario.baseDate);
      state = scenarioError(
        () =>
          runScenario(
            base.state,
            stepsOf(scenario).filter((s) => s.kind !== 'exit'),
            true,
          ).state,
      );
    }
    const terms = { exitValue: input.exitValue, transactionCosts: input.transactionCosts, debt: input.debt, unvested: input.unvested };
    return {
      currency: state.currency,
      waterfall: runWaterfall(state, terms),
      chart: input.chartMax ? waterfallChart(state, terms, BigInt(input.chartMax)) : null,
    };
  },
});

type ScenarioRow = typeof scenarios.$inferSelect;
const stepsOf = (row: ScenarioRow): ScenarioStep[] => z.array(scenarioStep).parse(row.steps);

async function visibleScenario(ctx: Ctx, id: string): Promise<ScenarioRow> {
  const [row] = await ctx.db.select().from(scenarios).where(eq(scenarios.id, id));
  if (!row) throw notFound('Scenario');
  const me = ctx.actor!.userId;
  if (row.createdBy !== me && !row.sharedWith.includes(me) && ctx.actor!.role !== 'admin') throw notFound('Scenario');
  return row;
}

async function registerHead(ctx: Ctx): Promise<number> {
  const [row] = await ctx.db.select({ seq: max(registryTransactions.seq) }).from(registryTransactions);
  return Number(row?.seq ?? 0);
}

const scenarioDto = (row: ScenarioRow, head: number) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  baseDate: row.baseDate,
  status: row.status,
  steps: row.steps,
  sharedWith: row.sharedWith,
  promotedTxIds: row.promotedTxIds,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  stale: row.baseSeq !== head,
});

export const listScenarios = defineService({
  name: 'captable.listScenarios',
  description:
    'Saved cap table scenarios the caller may see (their own and those shared with them): name, base date, steps, status, and whether the register changed since the scenario was based.',
  kind: 'query',
  access: 'captable.model',
  input: listScenariosInput,
  async handler(ctx, input) {
    const me = ctx.actor!.userId;
    const visible =
      ctx.actor!.role === 'admin'
        ? sql`true`
        : sql`(${scenarios.createdBy} = ${me} or ${scenarios.sharedWith} @> ${JSON.stringify([me])}::jsonb)`;
    const where = input.includeArchived ? visible : and(visible, sql`${scenarios.status} <> 'archived'`);
    const [rows, head] = await Promise.all([
      ctx.db.select().from(scenarios).where(where).orderBy(desc(scenarios.updatedAt)).limit(input.limit).offset(input.offset),
      registerHead(ctx),
    ]);
    return { items: rows.map((r) => scenarioDto(r, head)) };
  },
});

export const getScenario = defineService({
  name: 'captable.getScenario',
  description:
    'One saved scenario with its steps and the result of running it: the cap table after each step, round results, the exit waterfall and warnings.',
  kind: 'query',
  access: 'captable.model',
  input: idInput,
  async handler(ctx, input) {
    const row = await visibleScenario(ctx, input.id);
    const { data, state } = await stateAt(ctx, row.baseDate);
    const result = scenarioError(() => runScenario(state, stepsOf(row), data.settings.includeUnallocatedPool));
    const { state: _end, ...rest } = result;
    return { scenario: scenarioDto(row, await registerHead(ctx)), result: rest, currency: state.currency };
  },
});

export const runScenarioService = defineService({
  name: 'captable.runScenario',
  description:
    'Run a saved scenario, or unsaved steps on a base date, and return the cap table after each step without saving anything. Use it to try out steps before saveScenario.',
  kind: 'query',
  access: 'captable.model',
  input: runScenarioInput,
  async handler(ctx, input) {
    const row = input.scenarioId ? await visibleScenario(ctx, input.scenarioId) : null;
    const { data, state } = await stateAt(ctx, input.baseDate ?? row?.baseDate);
    const steps = input.steps ?? (row ? stepsOf(row) : []);
    const { state: _end, ...rest } = scenarioError(() => runScenario(state, steps, data.settings.includeUnallocatedPool));
    return { ...rest, currency: state.currency };
  },
});

export const saveScenario = defineService({
  name: 'captable.saveScenario',
  description:
    'Save a scenario: a name, a base date (default today) and ordered steps (priced round, pool change, grant batch, secondary sale, exercise, and an exit last). It never changes the cap table or register; promoteScenario turns it into register drafts. Shared users may view it.',
  kind: 'mutation',
  access: 'captable.model',
  input: scenarioInput,
  async handler(ctx, input) {
    const baseDate = input.baseDate ?? (await today());
    const { data, state } = await stateAt(ctx, baseDate);
    scenarioError(() => runScenario(state, input.steps, data.settings.includeUnallocatedPool));
    const values = {
      name: input.name,
      description: input.description,
      baseDate,
      baseSeq: await registerHead(ctx),
      steps: input.steps as Record<string, unknown>[],
      sharedWith: input.sharedWith,
    };
    if (input.id) {
      const before = await visibleScenario(ctx, input.id);
      if (before.createdBy !== ctx.actor!.userId) throw forbidden('Only the author can change a scenario');
      if (before.status === 'promoted') throw conflict('This scenario has been promoted. Duplicate it to change it.');
      const [row] = await ctx.db.update(scenarios).set(values).where(eq(scenarios.id, input.id)).returning();
      await audit(ctx, {
        action: 'captable.scenario_update',
        entityType: 'captable_scenario',
        entityId: input.id,
        before: { name: before.name, steps: before.steps },
        after: { name: row!.name, steps: row!.steps },
      });
      return scenarioDto(row!, values.baseSeq);
    }
    const [row] = await ctx.db
      .insert(scenarios)
      .values({ ...values, createdBy: ctx.actor!.userId })
      .returning();
    await audit(ctx, {
      action: 'captable.scenario_create',
      entityType: 'captable_scenario',
      entityId: row!.id,
      after: { name: row!.name, steps: row!.steps },
    });
    return scenarioDto(row!, values.baseSeq);
  },
});

export const archiveScenario = defineService({
  name: 'captable.archiveScenario',
  description: 'Archive a scenario (hidden from the list; still readable with includeArchived). Only its author can.',
  kind: 'mutation',
  access: 'captable.model',
  input: idInput,
  async handler(ctx, input) {
    const before = await visibleScenario(ctx, input.id);
    if (before.createdBy !== ctx.actor!.userId) throw forbidden('Only the author can archive a scenario');
    await ctx.db.update(scenarios).set({ status: 'archived' }).where(eq(scenarios.id, input.id));
    await audit(ctx, {
      action: 'captable.scenario_archive',
      entityType: 'captable_scenario',
      entityId: input.id,
      before: { status: before.status },
      after: { status: 'archived' },
    });
    return { ok: true };
  },
});

export const rebaseScenario = defineService({
  name: 'captable.rebaseScenario',
  description:
    'Move a scenario onto the current share register (or another base date), after the register changed since it was saved. Its steps stay the same.',
  kind: 'mutation',
  access: 'captable.model',
  input: rebaseScenarioInput,
  async handler(ctx, input) {
    const before = await visibleScenario(ctx, input.scenarioId);
    if (before.createdBy !== ctx.actor!.userId) throw forbidden('Only the author can rebase a scenario');
    const baseDate = input.baseDate ?? (await today());
    const { data, state } = await stateAt(ctx, baseDate);
    scenarioError(() => runScenario(state, stepsOf(before), data.settings.includeUnallocatedPool));
    const head = await registerHead(ctx);
    const [row] = await ctx.db.update(scenarios).set({ baseDate, baseSeq: head }).where(eq(scenarios.id, before.id)).returning();
    await audit(ctx, {
      action: 'captable.scenario_rebase',
      entityType: 'captable_scenario',
      entityId: before.id,
      before: { baseDate: before.baseDate, baseSeq: before.baseSeq },
      after: { baseDate, baseSeq: head },
    });
    return scenarioDto(row!, head);
  },
});

export const compareScenarios = defineService({
  name: 'captable.compareScenarios',
  description: 'Two scenarios side by side: each stakeholder fully diluted percentage at the end of each, and the difference.',
  kind: 'query',
  access: 'captable.model',
  input: compareScenariosInput,
  async handler(ctx, input) {
    const end = async (id: string) => {
      const row = await visibleScenario(ctx, id);
      const { data, state } = await stateAt(ctx, row.baseDate);
      return { row, table: scenarioError(() => runScenario(state, stepsOf(row), data.settings.includeUnallocatedPool)).end };
    };
    const [left, right] = await Promise.all([end(input.leftId), end(input.rightId)]);
    const key = (r: { stakeholderId: string | null; planId: string | null; name: string }) => r.stakeholderId ?? r.planId ?? r.name;
    const keys = [...new Set([...left.table.rows.map(key), ...right.table.rows.map(key)])];
    const rows = keys.map((k) => {
      const l = left.table.rows.find((r) => key(r) === k);
      const r = right.table.rows.find((x) => key(x) === k);
      return {
        key: k,
        name: (l ?? r)!.name,
        left: l?.fullyDilutedPct ?? '0',
        right: r?.fullyDilutedPct ?? '0',
        difference: formatDec(parseDec(r?.fullyDilutedPct ?? '0') - parseDec(l?.fullyDilutedPct ?? '0'), 6),
      };
    });
    return {
      left: { id: left.row.id, name: left.row.name, totals: left.table.totals },
      right: { id: right.row.id, name: right.row.name, totals: right.table.totals },
      rows,
    };
  },
});

type NewPerson = { name: string; kind: HolderDetails['kind']; country: string; email: string };

function newPeople(step: ScenarioStep): (NewPerson | undefined)[] {
  if (step.kind === 'priced_round') return step.investments.map((i) => i.newInvestor);
  if (step.kind === 'grant_batch') return step.grants.map((g) => g.newStakeholder);
  if (step.kind === 'secondary') return [step.newBuyer];
  return [];
}

/** Gives the people a promoted step adds real ids and stakeholder rows, and renames them in the state. */
async function materialize(ctx: Ctx, s: CapState, people: (NewPerson | undefined)[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [i, person] of people.entries()) {
    const placeholder = newPartyId(0, i);
    const party = s.parties.get(placeholder);
    if (!person || !party) continue;
    const id = randomUUID();
    ids.set(placeholder, id);
    await ctx.db.insert(stakeholders).values({ id, name: person.name, kind: person.kind, country: person.country, email: person.email });
    s.parties.delete(placeholder);
    s.parties.set(id, { ...party, id });
    for (const h of s.holdings) if (h.stakeholderId === placeholder) h.stakeholderId = id;
    for (const a of s.awards) if (a.stakeholderId === placeholder) a.stakeholderId = id;
  }
  return ids;
}

export const promoteScenario = defineService({
  name: 'captable.promoteScenario',
  description:
    'Turn a saved scenario into real work: each priced round becomes share register drafts (a class terms change for a new class, a new issue for cash, a new issue by set-off for converting SAFEs and loans), each secondary sale a transfer draft, and pool changes and grant batches are recorded in the cap table. People the scenario added become stakeholders. Nothing is committed: a person commits each draft in the register wizard at the returned urls. Refuses if the register changed since the scenario was based; rebase it first.',
  kind: 'mutation',
  access: 'captable.manage',
  // A person promotes from the Scenarios screen; the assistant and MCP only model.
  tool: false,
  input: promoteScenarioInput,
  async handler(ctx, input) {
    const row = await visibleScenario(ctx, input.scenarioId);
    if (row.status === 'promoted') throw conflict('This scenario was already promoted');
    if (row.baseSeq !== (await registerHead(ctx)))
      throw conflict('The share register changed since this scenario was based. Rebase it and check the numbers first.');
    const steps = stepsOf(row);
    if (steps.some((s) => s.kind === 'exercise'))
      throw badRequest('Exercise steps cannot be promoted; exercise each grant from Equity Plans');
    const { state } = await stateAt(ctx, row.baseDate);
    const origin = { module: 'captable', reference: row.id, label: row.name };
    const drafts: { id: string; type: string; summary: string; url: string }[] = [];
    const draft = async (tx: RegistryTransactionInput) => {
      const d = await run(createDraft, ctx, { transaction: registryTransaction.parse(tx), origin });
      drafts.push({ id: d.id, type: d.type, summary: d.summary, url: d.url });
      return d;
    };
    const nominalClass = state.capitalMode === 'nominal' ? '1' : null;

    let working = cloneState(state);
    for (const step of steps) {
      if (step.kind === 'exit') continue;
      const result = scenarioError(() => runScenario(working, [step], true));
      const after = result.state;
      const ids = await materialize(ctx, after, newPeople(step));
      const real = (id: string) => ids.get(id) ?? id;
      const outcome = result.steps[0]!.result;
      const per = (code: string) => after.classes.get(code)?.unitsPerShare ?? 1n;

      if (outcome.kind === 'priced_round' && step.kind === 'priced_round') {
        const { round } = outcome;
        const unit = per(step.classCode);
        const pricePerShare = formatDec(parseDec(round.pricePerShare) * unit);
        if (!working.classes.has(step.classCode))
          await draft({
            type: 'class_change',
            effectiveDate: step.date,
            classes: [
              {
                code: step.classCode,
                name: step.className,
                votesPerShare: String(step.votesPerShare),
                nominalPerShare: nominalClass,
                seniorityRank: step.seniorityRank,
                liqPrefMultiple: String(step.liqPrefMultiple),
                liqPrefCapMultiple: step.liqPrefCapMultiple === null ? null : String(step.liqPrefCapMultiple),
                participation: step.participation,
                antiDilution: step.antiDilution,
              },
            ],
            note: `${step.name}: new share class`,
          });
        const cash = round.investments
          .map((inv) => ({ holderId: real(inv.stakeholderId), count: (BigInt(inv.units) / unit).toString() }))
          .filter((x) => x.count !== '0');
        if (cash.length)
          await draft({
            type: 'new_issue',
            effectiveDate: step.date,
            form: 'cash',
            allocation: 'directed',
            classCode: step.classCode,
            pricePerShare,
            subscriptions: cash,
            holders: await holderDetailsFor(
              ctx,
              after,
              cash.map((x) => x.holderId),
            ),
            note: step.name,
          });
        const conversions = round.conversions.filter((c) => BigInt(c.units) / unit > 0n);
        if (conversions.length) {
          const tx = await draft({
            type: 'new_issue',
            effectiveDate: step.date,
            form: 'set_off',
            allocation: 'directed',
            classCode: step.classCode,
            pricePerShare,
            subscriptions: conversions.map((c) => ({ holderId: c.stakeholderId, count: (BigInt(c.units) / unit).toString() })),
            holders: await holderDetailsFor(
              ctx,
              after,
              conversions.map((c) => c.stakeholderId),
            ),
            note: `${step.name}: conversion of SAFEs and loans by set-off`,
          });
          await ctx.db
            .update(unpricedInstruments)
            .set({ conversionTxId: tx.id })
            .where(
              inArray(
                unpricedInstruments.id,
                conversions.map((c) => c.id),
              ),
            );
        }
        if (round.pool && BigInt(round.pool.topUp) > 0n) {
          let planId = round.pool.planId;
          if (planId === 'pool:new') {
            const pool = after.pools.find((p) => p.planId === planId)!;
            const [plan] = await ctx.db
              .insert(equityPlans)
              .values({ name: pool.name, profile: 'options', kind: 'option', classCode: pool.classCode })
              .returning();
            planId = plan!.id;
            pool.planId = planId;
          }
          await ctx.db.insert(poolChanges).values({
            planId,
            date: step.date,
            delta: BigInt(round.pool.topUp),
            note: `${step.name}: pool top-up`,
            createdBy: ctx.actor!.userId,
          });
        }
      } else if (outcome.kind === 'pool_change' && step.kind === 'pool_change') {
        await ctx.db.insert(poolChanges).values({
          planId: outcome.planId,
          date: row.baseDate,
          delta: BigInt(step.delta),
          note: `${row.name}: pool change`,
          createdBy: ctx.actor!.userId,
        });
      } else if (outcome.kind === 'grant_batch' && step.kind === 'grant_batch') {
        for (const [i, g] of step.grants.entries()) {
          const id = real(g.stakeholderId ?? newPartyId(0, i));
          await ensureStakeholderRow(ctx, after, id);
          await ctx.db.insert(grants).values({
            planId: outcome.planId,
            stakeholderId: id,
            units: BigInt(g.units),
            strikePrice: String(g.strikePrice),
            grantDate: row.baseDate,
            vestingStart: row.baseDate,
            notes: `From scenario ${row.name}`,
          });
        }
      } else if (outcome.kind === 'secondary' && step.kind === 'secondary') {
        const to = real(step.toStakeholderId ?? newPartyId(0, 0));
        const unit = per(step.classCode);
        await draft({
          type: 'transfer',
          effectiveDate: row.baseDate,
          kind: 'sale',
          fromHolderId: step.fromStakeholderId,
          toHolderId: to,
          lines: [{ classCode: step.classCode, count: (BigInt(step.units) / unit).toString() }],
          pricePerShare: formatDec(parseDec(String(step.pricePerShare)) * unit),
          holders: await holderDetailsFor(ctx, after, [to]),
        });
      }
      working = after;
    }
    const [updated] = await ctx.db
      .update(scenarios)
      .set({ status: 'promoted', promotedTxIds: drafts.map((d) => d.id) })
      .where(eq(scenarios.id, row.id))
      .returning();
    await audit(ctx, {
      action: 'captable.scenario_promote',
      entityType: 'captable_scenario',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'promoted', drafts: drafts.map((d) => d.id) },
    });
    return { scenario: scenarioDto(updated!, row.baseSeq), drafts };
  },
});
