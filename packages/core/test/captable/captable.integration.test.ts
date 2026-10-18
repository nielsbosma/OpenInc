import type { RegistryTransactionInput } from '@openinc/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as captableExports from '../../src/captable/exports.ts';
import { type Ctx, closeDb } from '../../src/context.ts';
import { stopJobs } from '../../src/jobs.ts';
import { services } from '../../src/registry.ts';
import { invoke } from '../../src/service.ts';
import { freshInstall, LIMITS, reachable, userCtx } from '../registry/db.ts';
import { H, people } from '../registry/helpers.ts';

const draft = (ctx: Ctx, transaction: RegistryTransactionInput) => invoke(services.registry.draftTransaction, ctx, { transaction });
const commit = (ctx: Ctx, transactionId: string) => invoke(services.registry.commit, ctx, { transactionId });

describe.runIf(await reachable())('cap table (database)', () => {
  let admin: Ctx;
  let board: Ctx;
  let member: Ctx;
  let auditor: Ctx;
  let planId: string;
  let employeeId: string;
  let grantId: string;
  let safeHolderId: string;
  let scenarioId: string;

  beforeAll(async () => {
    admin = await freshInstall();
    board = await userCtx('board', 'board@example.com');
    member = await userCtx('member', 'member@example.com');
    auditor = await userCtx('auditor', 'auditor@example.com');
    await invoke(services.registry.setup, admin, LIMITS);
    const d = await draft(board, {
      type: 'incorporation',
      effectiveDate: '2024-01-15',
      shareCapital: '2500000',
      holders: [people.anna, people.bjorn],
      classes: [{ code: 'A', votesPerShare: '10' }, { code: 'B' }],
      allocations: [
        { holderId: H.anna, classCode: 'A', count: 1000, pricePerShare: '1' },
        { holderId: H.bjorn, classCode: 'B', count: 24000, pricePerShare: '1' },
      ],
    });
    await commit(board, d.id);
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  it('shows the register as the cap table', async () => {
    const t = await invoke(services.captable.get, auditor, { asOf: '2024-06-01' });
    expect(t.totals.fullyDiluted).toBe('25000');
    expect(t.rows.map((r) => [r.name, r.fullyDilutedPct])).toEqual([
      ['Björn Berg', '96'],
      ['Anna Andersson', '4'],
    ]);
    expect(t.rows.find((r) => r.name === 'Anna Andersson')?.votesPct).toBe('29.411765');
  });

  it('groups holders', async () => {
    const group = await invoke(services.captable.saveGroup, board, { name: 'Founders' });
    await invoke(services.captable.assignGroup, board, { stakeholderId: H.anna, groupId: group.id });
    await expect(invoke(services.captable.saveGroup, member, { name: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const t = await invoke(services.captable.get, auditor, {});
    expect(t.rows.find((r) => r.stakeholderId === H.anna)?.groupId).toBe(group.id);
  });

  it('adds a plan, a grant, and counts them fully diluted', async () => {
    const plan = await invoke(services.captable.savePlan, board, {
      name: 'Employee Warrants 2024',
      profile: 'se_warrants',
      classCode: 'B',
      poolSize: '5000',
      approvedOn: '2024-02-01',
    });
    planId = plan.id;
    expect(plan.kind).toBe('warrant');
    const schedule = await invoke(services.captable.saveSchedule, board, { name: 'Four Years, One-Year Cliff' });
    const employee = await invoke(services.captable.saveStakeholder, board, { name: 'Erik Employee' });
    employeeId = employee.id;
    const grant = await invoke(services.captable.saveGrant, board, {
      planId,
      stakeholderId: employeeId,
      units: '1000',
      strikePrice: '1',
      grantDate: '2024-02-01',
      vestingStart: '2024-02-01',
      scheduleId: schedule.id,
    });
    grantId = grant.id;
    await expect(
      invoke(services.captable.saveGrant, board, {
        planId,
        stakeholderId: employeeId,
        units: '9000',
        grantDate: '2024-02-01',
        vestingStart: '2024-02-01',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const t = await invoke(services.captable.get, auditor, { asOf: '2025-02-01' });
    expect(t.totals.fullyDiluted).toBe('30000');
    expect(t.rows.find((r) => r.stakeholderId === employeeId)).toMatchObject({ awards: '1000', vestedAwards: '250' });
    const plans = await invoke(services.captable.listPlans, auditor, { asOf: '2025-02-01' });
    expect(plans.plans[0]).toMatchObject({ unallocated: '4000', vested: '250' });
  });

  it('exercises vested warrants through a register draft', async () => {
    await expect(invoke(services.captable.exerciseGrant, board, { grantId, units: '500', date: '2025-02-01' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const { draft: d } = await invoke(services.captable.exerciseGrant, board, { grantId, units: '250', date: '2025-02-01' });
    expect(d.status).toBe('draft');
    expect(d.url).toContain('/registry/transactions/');
    const before = await invoke(services.captable.get, auditor, { asOf: '2025-03-01' });
    expect(before.rows.find((r) => r.stakeholderId === employeeId)?.issued).toBe('0');
    await commit(board, d.id);
    const after = await invoke(services.captable.get, auditor, { asOf: '2025-03-01' });
    expect(after.rows.find((r) => r.stakeholderId === employeeId)).toMatchObject({ issued: '250', awards: '750' });
    expect(after.totals.fullyDiluted).toBe('30000');
  });

  it('keeps a SAFE apart and converts it in a modelled round', async () => {
    const angel = await invoke(services.captable.saveStakeholder, board, { name: 'Angel Investor', kind: 'person' });
    safeHolderId = angel.id;
    await invoke(services.captable.saveUnpriced, board, {
      stakeholderId: safeHolderId,
      profile: 'safe_post',
      amount: '10000000',
      valuationCap: '100000000',
      signedOn: '2025-01-10',
    });
    const list = await invoke(services.captable.listUnpriced, auditor, {});
    expect(list.instruments[0]).toMatchObject({ status: 'outstanding', atCap: { units: expect.any(String) } });
    const model = await invoke(services.captable.modelRound, member, {
      name: 'Seed',
      date: '2025-06-01',
      classCode: 'Seed',
      preMoney: '300000000',
      investments: [{ newInvestor: { name: 'Seed Fund AB', kind: 'company', country: 'SE' }, amount: '50000000' }],
    });
    expect(model.round.conversions).toHaveLength(1);
    expect(model.round.conversions[0]!.basis).toBe('cap');
    expect(model.after.rows.some((r) => r.name === 'Seed Fund AB')).toBe(true);
  });

  it('saves, runs and promotes a scenario into register drafts', async () => {
    const steps = [
      {
        kind: 'priced_round' as const,
        name: 'Seed',
        date: '2025-06-01',
        classCode: 'Seed',
        className: 'Seed Preference',
        preMoney: '300000000',
        liqPrefMultiple: '1',
        poolTargetPct: 15,
        poolPlanId: planId,
        investments: [{ newInvestor: { name: 'Seed Fund AB', kind: 'company' as const, country: 'SE' }, amount: '50000000' }],
      },
      { kind: 'exit' as const, exitValue: '2000000000' },
    ];
    await expect(invoke(services.captable.saveScenario, auditor, { name: 'Seed', steps })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const saved = await invoke(services.captable.saveScenario, member, { name: 'Seed Round', baseDate: '2025-05-01', steps });
    scenarioId = saved.id;
    expect(saved.stale).toBe(false);
    const listed = await invoke(services.captable.listScenarios, board, {});
    expect(listed.items).toEqual([]);
    const shown = await invoke(services.captable.getScenario, member, { id: scenarioId });
    const exit = shown.result.steps[1]!.result;
    expect(exit.kind).toBe('exit');
    if (exit.kind === 'exit') expect(exit.waterfall.rows.reduce((s, r) => s + BigInt(r.total), 0n)).toBe(2000000000n);

    await invoke(services.captable.saveScenario, member, {
      id: scenarioId,
      name: 'Seed Round',
      baseDate: '2025-05-01',
      steps,
      sharedWith: [board.actor!.userId],
    });
    const promoted = await invoke(services.captable.promoteScenario, board, { scenarioId });
    expect(promoted.drafts.map((d) => d.type)).toEqual(['class_change', 'new_issue', 'new_issue']);
    for (const d of promoted.drafts) {
      if (d.type === 'class_change') {
        const { transaction } = await invoke(services.registry.getTransaction, board, { transactionId: d.id });
        await invoke(services.registry.updateDraft, board, {
          transactionId: d.id,
          transaction: { ...transaction, registrationDate: '2025-06-01' },
        });
      }
      await commit(board, d.id);
    }

    const after = await invoke(services.captable.get, auditor, { asOf: '2025-06-01' });
    const end = shown.result.steps[0]!.table;
    const pick = (t: typeof after) =>
      t.rows
        .filter((r) => r.stakeholderId)
        .map((r) => [r.name, r.issued])
        .sort();
    expect(pick(after)).toEqual(pick(end as typeof after));
    const unpriced = await invoke(services.captable.listUnpriced, auditor, {});
    expect(unpriced.instruments[0]?.status).toBe('converted');
    await expect(invoke(services.captable.promoteScenario, board, { scenarioId })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('runs a waterfall and the fair value helper', async () => {
    const w = await invoke(services.captable.waterfall, member, { exitValue: '1000000000', chartMax: '2000000000', asOf: '2025-07-01' });
    expect(w.waterfall.rows.reduce((s, r) => s + BigInt(r.total), 0n)).toBe(1000000000n);
    expect(w.chart?.points).toHaveLength(41);
    const fv = await invoke(services.captable.fairValue, board, {
      sharePrice: '20',
      strikePrice: '25',
      years: 3,
      volatilityPct: 40,
      riskFreePct: 2,
      saveOn: '2025-07-01',
    });
    expect(Number(fv.value)).toBeGreaterThan(0);
    await expect(
      invoke(services.captable.fairValue, member, {
        sharePrice: '20',
        strikePrice: '25',
        years: 3,
        volatilityPct: 40,
        saveOn: '2025-07-01',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const vals = await invoke(services.captable.listValuations, auditor, {});
    expect(vals.items.map((v) => v.source)).toContain('fair_value');
    expect(vals.items.map((v) => v.source)).toContain('round');
  });

  it('exports the cap table and draws its history', async () => {
    const pdf = await captableExports.captableExport(auditor, { format: 'pdf' });
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const a = await captableExports.captableExport(auditor, { format: 'json', asOf: '2025-07-01' });
    const b = await captableExports.captableExport(auditor, { format: 'json', asOf: '2025-07-01' });
    expect(a.body.equals(b.body)).toBe(true);
    const xlsx = await captableExports.scenarioExport(board, { scenarioId, format: 'xlsx' });
    expect(xlsx.body.length).toBeGreaterThan(1000);
    const history = await invoke(services.captable.history, auditor, {});
    expect(history.points.length).toBeGreaterThan(3);
    expect(history.points.some((p) => p.roundTxId)).toBe(true);
  });
});
