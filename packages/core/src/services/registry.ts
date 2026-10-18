import { createHash } from 'node:crypto';
import {
  and,
  asc,
  chainVerifications,
  count,
  desc,
  eq,
  files,
  holderVersions,
  ilike,
  inArray,
  isNull,
  movements,
  or,
  registrySettings,
  registryTransactions,
  type SQL,
  sql,
  txDocuments,
  users,
} from '@openinc/db';
import {
  asOfInput,
  attachDocumentInput,
  checkArticleLimits,
  draftTransactionInput,
  empty,
  holderIdInput,
  legalFormsFor,
  listTransactionsInput,
  parkTransactionInput,
  type RegistryTransaction,
  ROLE_INFO,
  ROLES,
  RULE_PACKS,
  registrySetupInput,
  reverseTransactionInput,
  rulePackFor,
  searchHoldersInput,
  TRANSACTION_LABELS,
  TX_STATUS_LABELS,
  transactionIdInput,
  updateDraftInput,
  validateTransactionInput,
} from '@openinc/shared';
import { z } from 'zod';
import { audit } from '../audit.ts';
import { type Ctx, can } from '../context.ts';
import { badRequest, conflict, forbidden, notFound, preconditionFailed } from '../errors.ts';
import { getObjectBuffer } from '../lib/storage.ts';
import { replay } from '../registry/engine.ts';
import {
  committedRows,
  companyCurrency,
  conflictError,
  effectiveItems,
  engineConfig,
  holderNames,
  lockRegistry,
  outcome,
  parseStored,
  type RegistryContext,
  readRegistrySettings,
  rebuild,
  recordChainCheck,
  requireRegistry,
  sealTransaction,
  settingsView,
  type TxRow,
  verifyChain,
  writeCache,
} from '../registry/store.ts';
import { holderIdsOf, summarize } from '../registry/summary.ts';
import { changedHolders, registerView } from '../registry/views.ts';
import { defineService } from '../service.ts';
import { getSettings } from '../settings.ts';
import { notify } from './notifications.ts';

async function today(): Promise<string> {
  const timeZone = (await getSettings('company'))?.timeZone ?? 'UTC';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function settingsDto(row: typeof registrySettings.$inferSelect) {
  const pack = RULE_PACKS[row.rulePack as keyof typeof RULE_PACKS];
  return {
    ...settingsView(row),
    fourEyes: row.fourEyes,
    drafterCanCommit: row.drafterCanCommit,
    commitOverMcp: row.commitOverMcp,
    tokenizeImportIds: row.tokenizeImportIds,
    rulePackInfo: {
      id: pack.id,
      version: pack.version,
      label: pack.label,
      summary: pack.summary,
      countrySpecific: pack.countrySpecific,
      terms: pack.terms,
    },
    updatedAt: row.updatedAt,
  };
}

async function loadTx(ctx: Ctx, id: string): Promise<TxRow> {
  const [row] = await ctx.db.select().from(registryTransactions).where(eq(registryTransactions.id, id));
  if (!row) throw notFound('Transaction');
  return row;
}

const isDraftStatus = (status: TxRow['status']) => status !== 'committed' && status !== 'reversed';

function txDto(row: TxRow, extra: { names?: Map<string, string>; documents?: number; pendingRegistration?: Set<string> } = {}) {
  const pendingRegistration = row.status === 'committed' && !!extra.pendingRegistration?.has(row.id);
  const awaitingApproval = isDraftStatus(row.status) && row.submittedAt !== null;
  return {
    id: row.id,
    seq: row.seq,
    type: row.type as RegistryTransaction['type'],
    typeLabel: TRANSACTION_LABELS[row.type as RegistryTransaction['type']] ?? row.type,
    status: row.status,
    statusLabel: awaitingApproval
      ? 'Awaiting Approval'
      : pendingRegistration
        ? 'Interim, Awaiting Registration'
        : TX_STATUS_LABELS[row.status],
    awaitingApproval,
    pendingRegistration,
    decisionDate: row.decisionDate,
    effectiveDate: row.effectiveDate,
    registrationDate: row.registrationDate,
    enteredAt: row.enteredAt,
    reversesId: row.reversesId,
    summary: row.summary,
    note: row.note,
    hash: row.hash,
    prevHash: row.prevHash,
    rulePackVersion: row.rulePackVersion,
    createdBy: row.createdBy,
    createdByName: row.createdBy ? (extra.names?.get(row.createdBy) ?? null) : null,
    committedBy: row.committedBy,
    committedByName: row.committedBy ? (extra.names?.get(row.committedBy) ?? null) : null,
    approvedBy: row.approvedBy,
    submittedAt: row.submittedAt,
    documents: extra.documents ?? 0,
    origin: row.origin ?? null,
    /** Where a person reviews and commits it: the wizard while it is a draft. */
    url: isDraftStatus(row.status) ? `/registry/transactions/${row.id}/edit` : `/registry/transactions/${row.id}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function userNames(ctx: Ctx, rows: TxRow[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.createdBy, r.committedBy, r.approvedBy]).filter((x): x is string => !!x))];
  if (!ids.length) return new Map<string, string>();
  const list = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(list.map((u) => [u.id, u.name]));
}

function columnsFor(tx: RegistryTransaction) {
  return {
    type: tx.type,
    decisionDate: tx.decisionDate,
    effectiveDate: tx.effectiveDate,
    registrationDate: tx.registrationDate,
    note: tx.note,
    reversesId: tx.type === 'reversal' ? tx.reversesId : null,
    payload: JSON.parse(JSON.stringify(tx)) as Record<string, unknown>,
  };
}

/** Validates a transaction against the committed history, as if it were entered now. */
async function simulate(ctx: Ctx, registry: RegistryContext, tx: RegistryTransaction, candidateId: string) {
  const rows = await committedRows(ctx);
  const items = effectiveItems(rows);
  const candidate = { id: candidateId, seq: Number.MAX_SAFE_INTEGER, tx };
  let next = [...items, candidate];
  if (tx.type === 'reversal') {
    const target = rows.find((r) => r.id === tx.reversesId);
    if (!target || target.seq === null) throw badRequest('Only committed transactions can be reversed');
    if (target.type === 'reversal') throw badRequest('A reversal cannot be reversed. Enter the transaction again instead.');
    if (rows.some((r) => r.reversesId === tx.reversesId)) throw conflict('That transaction is already reversed');
    next = items.filter((i) => i.id !== tx.reversesId);
  }
  const result = replay(next, registry.config);
  return { rows, items, next, result };
}

export const registryStatus = defineService({
  name: 'registry.status',
  description:
    'Whether the share register is set up, which rule pack applies (country-specific checks or the generic EU pack), how many transactions are committed or waiting, and the last hash-chain check.',
  kind: 'query',
  access: 'registry.read',
  input: empty,
  async handler(ctx) {
    const row = await readRegistrySettings(ctx);
    const company = companyIdentity(await getSettings('company'), row);
    if (!row) return { setUp: false as const, company };
    const counts = await ctx.db
      .select({ status: registryTransactions.status, value: count() })
      .from(registryTransactions)
      .groupBy(registryTransactions.status);
    const [check] = await ctx.db.select().from(chainVerifications).orderBy(desc(chainVerifications.ranAt)).limit(1);
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.value])) as Partial<Record<TxRow['status'], number>>;
    const warnings = RULE_PACKS[row.rulePack as keyof typeof RULE_PACKS].checkSettings(settingsView(row));
    return { setUp: true as const, company, settings: settingsDto(row), counts: byStatus, lastChainCheck: check ?? null, warnings };
  },
});

export const registryLegalForms = defineService({
  name: 'registry.legalForms',
  description: 'The legal forms the share register supports for a country, and which rule pack each one uses.',
  kind: 'query',
  access: 'registry.read',
  input: z.object({ country: z.string().trim().toUpperCase().length(2) }),
  handler: async (_ctx, input) => legalFormsFor(input.country),
});

type CompanySettings = NonNullable<Awaited<ReturnType<typeof getSettings<'company'>>>>;
type SettingsRow = typeof registrySettings.$inferSelect;

/**
 * The company's country, legal form and IDs, which Settings → Company owns. The register keeps a copy in its settings
 * row so the rule pack and exports read it directly; a legal form not chosen yet falls back to the register's, then
 * to the country's first.
 */
export function companyIdentity(
  company: Pick<CompanySettings, 'country' | 'legalForm' | 'registrationNumber' | 'euid' | 'lei'> | null,
  row?: SettingsRow | null,
) {
  const country = company?.country ?? row?.country ?? 'SE';
  const forms = legalFormsFor(country);
  const known = (code: string | undefined) => !!code && forms.some((f) => f.code === code);
  const legalForm = known(company?.legalForm) ? company!.legalForm : known(row?.legalForm) ? row!.legalForm : (forms[0]?.code ?? '');
  return {
    country,
    legalForm,
    nationalNumber: company?.registrationNumber ?? row?.nationalNumber ?? '',
    euid: company?.euid ?? row?.euid ?? '',
    lei: company?.lei ?? row?.lei ?? '',
  };
}

type RegisterOwnSettings = Omit<
  SettingsRow,
  'id' | 'country' | 'legalForm' | 'rulePack' | 'nationalNumber' | 'euid' | 'lei' | 'updatedBy' | 'createdAt' | 'updatedAt'
>;

/** Writes the register's settings, checking that every committed transaction still holds under them. */
async function applyRegistrySettings(ctx: Ctx, company: CompanySettings | null, own: RegisterOwnSettings, before: SettingsRow | null) {
  const identity = companyIdentity(company, before);
  const pack = rulePackFor(identity.country, identity.legalForm);
  const values = { ...identity, ...own, rulePack: pack.id, updatedBy: ctx.actor?.userId ?? before?.updatedBy ?? null };
  const errors = pack.checkSettings(values).filter((v) => v.severity === 'error');
  if (errors.length) throw badRequest(errors.map((e) => e.message).join('; '));
  await lockRegistry(ctx);
  const rows = await committedRows(ctx);
  if (rows.length) {
    const result = replay(effectiveItems(rows), engineConfig(values, company?.currency ?? (await companyCurrency())));
    if (!result.ok) throw conflictError(result, '', rows);
  }
  const [row] = before
    ? await ctx.db.update(registrySettings).set(values).where(eq(registrySettings.id, 1)).returning()
    : await ctx.db
        .insert(registrySettings)
        .values({ id: 1, ...values })
        .returning();
  if (rows.length) await rebuild(ctx, await requireRegistry(ctx));
  await audit(ctx, { action: 'registry.setup', entityType: 'registry_settings', entityId: '1', before, after: row });
  return row!;
}

const ownSettings = (row: SettingsRow): RegisterOwnSettings => ({
  numbering: row.numbering,
  capitalMode: row.capitalMode,
  minShareCapital: row.minShareCapital,
  maxShareCapital: row.maxShareCapital,
  minShares: row.minShares,
  maxShares: row.maxShares,
  fourEyes: row.fourEyes,
  drafterCanCommit: row.drafterCanCommit,
  commitOverMcp: row.commitOverMcp,
  tokenizeImportIds: row.tokenizeImportIds,
});

/**
 * Called when Settings → Company is saved, in the same transaction: the register picks up a new country, legal form
 * or ID, or the save fails if committed transactions would no longer hold under the new rule pack.
 */
export async function syncRegistryWithCompany(ctx: Ctx, company: CompanySettings) {
  const before = await readRegistrySettings(ctx);
  if (!before) return;
  const next = companyIdentity(company, before);
  const same = (['country', 'legalForm', 'nationalNumber', 'euid', 'lei'] as const).every((k) => next[k] === before[k]);
  if (!same) await applyRegistrySettings(ctx, company, ownSettings(before), before);
}

export const setupRegistry = defineService({
  name: 'registry.setup',
  description:
    "Set up or change the share register: share numbering, capital mode and limits from the articles, four-eyes approval, and whether commits are allowed over MCP. The company's country, legal form (which pick the rule pack) and IDs come from Settings → Company (settings.update, group company).",
  kind: 'mutation',
  access: 'registry.manage',
  input: registrySetupInput,
  async handler(ctx, input) {
    const before = await readRegistrySettings(ctx);
    const company = await getSettings('company');
    const identity = companyIdentity(company, before);
    const issues = checkArticleLimits({ ...identity, currency: company?.currency ?? 'EUR' }, input);
    if (issues.length) throw badRequest(issues.map((i) => i.message).join('; '));
    const big = (v: string | number | null) => (v === null ? null : BigInt(v));
    const row = await applyRegistrySettings(
      ctx,
      company,
      {
        numbering: input.numbering ?? before?.numbering ?? rulePackFor(identity.country, identity.legalForm).defaults.numbering,
        capitalMode: input.capitalMode,
        minShareCapital: big(input.minShareCapital),
        maxShareCapital: big(input.maxShareCapital),
        minShares: big(input.minShares),
        maxShares: big(input.maxShares),
        fourEyes: input.fourEyes,
        drafterCanCommit: input.drafterCanCommit,
        commitOverMcp: input.commitOverMcp,
        tokenizeImportIds: input.tokenizeImportIds,
      },
      before,
    );
    return settingsDto(row);
  },
});

export const getRegister = defineService({
  name: 'registry.getRegister',
  description:
    'The share register as of a date (default today): every holder with their shares per class, share numbers, votes and percentages of capital and votes, the classes, share capital, quota value and open pledges. Set knownAt to see it as it was recorded at that moment, before later corrections or backdated entries.',
  kind: 'query',
  access: 'registry.read',
  input: asOfInput,
  async handler(ctx, input) {
    const registry = await requireRegistry(ctx);
    const asOf = input.asOf ?? (await today());
    const items = effectiveItems(await committedRows(ctx), input.knownAt ? new Date(input.knownAt) : undefined);
    const result = replay(items, registry.config, { until: asOf });
    if (!result.ok) throw preconditionFailed(`The register does not replay: ${result.errors.map((e) => e.message).join('; ')}`);
    return {
      ...registerView(result.ledger, registry.config, asOf),
      knownAt: input.knownAt ?? null,
      currency: registry.config.currency,
      rulePack: registry.rulePack.id,
      numbering: registry.view.numbering,
      warnings: result.warnings,
    };
  },
});

export const searchHolders = defineService({
  name: 'registry.searchHolders',
  description: 'Find holders in the share register by name or national ID. Returns their current details.',
  kind: 'query',
  access: 'registry.read',
  input: searchHoldersInput,
  async handler(ctx, input) {
    const filters: SQL[] = [isNull(holderVersions.validTo)];
    if (input.search)
      filters.push(or(ilike(holderVersions.name, `%${input.search}%`), ilike(holderVersions.nationalId, `%${input.search}%`))!);
    return ctx.db
      .select({
        holderId: holderVersions.holderId,
        kind: holderVersions.kind,
        name: holderVersions.name,
        nationalId: holderVersions.nationalId,
        country: holderVersions.country,
        address: holderVersions.address,
        email: holderVersions.email,
        members: holderVersions.members,
      })
      .from(holderVersions)
      .where(and(...filters))
      .orderBy(asc(holderVersions.name))
      .limit(100);
  },
});

export const getHolder = defineService({
  name: 'registry.getHolder',
  description:
    'One holder: their details and how they changed over time, their shares, share numbers, votes and pledges as of a date, and every committed transaction they took part in.',
  kind: 'query',
  access: 'registry.read',
  input: holderIdInput,
  async handler(ctx, input) {
    const registry = await requireRegistry(ctx);
    const versions = await ctx.db
      .select()
      .from(holderVersions)
      .where(eq(holderVersions.holderId, input.holderId))
      .orderBy(asc(holderVersions.validFrom), asc(holderVersions.id));
    if (!versions.length) throw notFound('Holder');
    const asOf = input.asOf ?? (await today());
    const result = replay(effectiveItems(await committedRows(ctx)), registry.config, { until: asOf });
    if (!result.ok) throw preconditionFailed('The register does not replay');
    const view = registerView(result.ledger, registry.config, asOf);
    const txIds = await ctx.db
      .selectDistinct({ txId: movements.txId })
      .from(movements)
      .where(or(eq(movements.fromHolderId, input.holderId), eq(movements.toHolderId, input.holderId)));
    const ids = [...new Set([...txIds.map((t) => t.txId), ...versions.map((v) => v.txId)])];
    const rows = ids.length
      ? await ctx.db
          .select()
          .from(registryTransactions)
          .where(inArray(registryTransactions.id, ids))
          .orderBy(asc(registryTransactions.effectiveDate), asc(registryTransactions.seq))
      : [];
    const holderMovements = await ctx.db
      .select()
      .from(movements)
      .where(or(eq(movements.fromHolderId, input.holderId), eq(movements.toHolderId, input.holderId)))
      .orderBy(asc(movements.id));
    return {
      holderId: input.holderId,
      asOf,
      current: versions.at(-1)!,
      versions,
      position: view.holders.find((h) => h.holderId === input.holderId) ?? null,
      pledges: view.pledges.filter((p) => p.holderId === input.holderId),
      transactions: rows.map((r) => txDto(r)),
      movements: holderMovements,
      currency: registry.config.currency,
    };
  },
});

export const listTransactions = defineService({
  name: 'registry.listTransactions',
  description:
    'The share register ledger: transactions with their status (draft, awaiting decision, awaiting registration, committed, reversed), dates, summary and sequence number. Filter by status, type or holder.',
  kind: 'query',
  access: 'registry.read',
  input: listTransactionsInput,
  async handler(ctx, input) {
    const filters: SQL[] = [];
    if (input.status) filters.push(eq(registryTransactions.status, input.status));
    if (input.type) filters.push(eq(registryTransactions.type, input.type));
    if (!input.includeDrafts || !can(ctx, 'registry.draft')) filters.push(sql`${registryTransactions.seq} is not null`);
    if (input.holderId) {
      const txIds = ctx.db
        .select({ id: movements.txId })
        .from(movements)
        .where(or(eq(movements.fromHolderId, input.holderId), eq(movements.toHolderId, input.holderId)));
      filters.push(or(inArray(registryTransactions.id, txIds), sql`${registryTransactions.payload}::text like ${`%${input.holderId}%`}`)!);
    }
    const where = filters.length ? and(...filters) : undefined;
    const [rows, [total], docCounts, committed] = await Promise.all([
      ctx.db
        .select()
        .from(registryTransactions)
        .where(where)
        .orderBy(sql`${registryTransactions.seq} desc nulls first`, desc(registryTransactions.updatedAt))
        .limit(input.limit)
        .offset(input.offset),
      ctx.db.select({ value: count() }).from(registryTransactions).where(where),
      ctx.db.select({ txId: txDocuments.txId, value: count() }).from(txDocuments).groupBy(txDocuments.txId),
      committedRows(ctx),
    ]);
    const names = await userNames(ctx, rows);
    const pending = await pendingRegistrations(ctx, committed);
    const docs = new Map(docCounts.map((d) => [d.txId, d.value]));
    return {
      items: rows.map((r) => txDto(r, { names, documents: docs.get(r.id) ?? 0, pendingRegistration: pending })),
      total: total?.value ?? 0,
    };
  },
});

async function pendingRegistrations(ctx: Ctx, rows: TxRow[]): Promise<Set<string>> {
  const registry = await requireRegistry(ctx).catch(() => null);
  if (!registry || !rows.length) return new Set();
  const result = replay(effectiveItems(rows), registry.config);
  return result.ok ? result.ledger.interimIssues : new Set();
}

export const getTransaction = defineService({
  name: 'registry.getTransaction',
  description: 'One share register transaction: its full content, status, movements of shares, attached documents and hash.',
  kind: 'query',
  access: 'registry.read',
  input: transactionIdInput,
  async handler(ctx, input) {
    const row = await loadTx(ctx, input.transactionId);
    if (row.seq === null && !can(ctx, 'registry.draft')) throw notFound('Transaction');
    const [docs, moves, committed] = await Promise.all([
      ctx.db.select().from(txDocuments).where(eq(txDocuments.txId, row.id)).orderBy(asc(txDocuments.createdAt)),
      ctx.db.select().from(movements).where(eq(movements.txId, row.id)).orderBy(asc(movements.id)),
      committedRows(ctx),
    ]);
    const tx = parseStored(row);
    const names = await holderNames(ctx, holderIdsOf(tx));
    for (const h of tx.holders) names.set(h.holderId, h.name);
    const reversedBy = committed.find((r) => r.reversesId === row.id) ?? null;
    return {
      ...txDto(row, {
        names: await userNames(ctx, [row]),
        documents: docs.length,
        pendingRegistration: await pendingRegistrations(ctx, committed),
      }),
      transaction: tx,
      holderNames: Object.fromEntries(names),
      movements: moves,
      documents: docs.map((d) => ({ ...d, url: `/api/files/${d.fileId}/content` })),
      reversedBy: reversedBy ? { id: reversedBy.id, seq: reversedBy.seq } : null,
    };
  },
});

export const validateTransaction = defineService({
  name: 'registry.validate',
  description:
    'Check a share register transaction against the rule pack and the whole history without saving it. Returns broken rules (by name), warnings, any later transaction a backdated entry conflicts with, and the register before and after on the effective date with the changed holders.',
  kind: 'query',
  access: 'registry.draft',
  input: validateTransactionInput,
  async handler(ctx, input) {
    const registry = await requireRegistry(ctx);
    const tx = input.transaction ?? (input.transactionId ? parseStored(await loadTx(ctx, input.transactionId)) : null);
    if (!tx) throw badRequest('Give a transaction or a transactionId');
    const candidateId = input.transactionId ?? '00000000-0000-4000-8000-000000000000';
    const { rows, items, result } = await simulate(ctx, registry, tx, candidateId);
    const result2 = outcome(result, candidateId, rows);
    const date = tx.type === 'reversal' ? (rows.find((r) => r.id === tx.reversesId)?.effectiveDate ?? tx.effectiveDate) : tx.effectiveDate;
    const beforeReplay = replay(items, registry.config, { until: date });
    const before = beforeReplay.ok || beforeReplay.ledger.initialized ? registerView(beforeReplay.ledger, registry.config, date) : null;
    let after = null;
    let changed: string[] = [];
    let candidateMovements: unknown[] = [];
    if (result.ok) {
      const afterReplay = replay(
        tx.type === 'reversal'
          ? items.filter((i) => i.id !== tx.reversesId)
          : [...items, { id: candidateId, seq: Number.MAX_SAFE_INTEGER, tx }],
        registry.config,
        { until: date },
      );
      if (afterReplay.ok) {
        after = registerView(afterReplay.ledger, registry.config, date);
        changed = before ? changedHolders(before, after) : after.holders.map((h) => h.holderId);
        candidateMovements = afterReplay.ledger.movements.filter((m) => m.txId === candidateId);
      }
    }
    return { ...result2, before, after, changedHolderIds: changed, movements: candidateMovements, currency: registry.config.currency };
  },
});

async function checkHolderList(tx: RegistryTransaction) {
  const seen = new Set<string>();
  for (const h of tx.holders) {
    if (seen.has(h.holderId)) throw badRequest(`${h.name} is listed twice`);
    seen.add(h.holderId);
  }
}

export const createDraft = defineService({
  name: 'registry.draftTransaction',
  description:
    'Save a share register transaction as a draft (incorporation, opening balance, transfer, holder details change, new issue, registration, bonus issue, split, reverse split, pledge, pledge release, class terms change or reversal). Drafts change nothing; validate shows what it would do and a person commits it in the wizard at the returned url. Other modules (e.g. the cap table) pass origin so the draft shows where it came from.',
  kind: 'mutation',
  access: 'registry.draft',
  input: draftTransactionInput,
  async handler(ctx, input) {
    await requireRegistry(ctx);
    await checkHolderList(input.transaction);
    const names = await holderNames(ctx, holderIdsOf(input.transaction));
    const [row] = await ctx.db
      .insert(registryTransactions)
      .values({
        ...columnsFor(input.transaction),
        status: 'draft',
        summary: input.summary ?? summarize(input.transaction, names),
        origin: input.origin ?? null,
        createdBy: ctx.actor!.userId,
      })
      .returning();
    await audit(ctx, {
      action: 'registry.draft_create',
      entityType: 'registry_transaction',
      entityId: row!.id,
      after: { type: row!.type, summary: row!.summary, effectiveDate: row!.effectiveDate, origin: row!.origin },
    });
    return txDto(row!);
  },
});

async function editableDraft(ctx: Ctx, id: string) {
  const row = await loadTx(ctx, id);
  if (!isDraftStatus(row.status)) throw conflict('Committed transactions cannot change. Reverse it and enter a new one instead.');
  return row;
}

export const updateDraft = defineService({
  name: 'registry.updateDraft',
  description: 'Replace the content of a draft share register transaction. Committed transactions cannot be changed.',
  kind: 'mutation',
  access: 'registry.draft',
  input: updateDraftInput,
  async handler(ctx, input) {
    const before = await editableDraft(ctx, input.transactionId);
    await checkHolderList(input.transaction);
    const names = await holderNames(ctx, holderIdsOf(input.transaction));
    const [row] = await ctx.db
      .update(registryTransactions)
      .set({
        ...columnsFor(input.transaction),
        summary: input.summary ?? summarize(input.transaction, names),
        submittedAt: null,
        submittedBy: null,
      })
      .where(eq(registryTransactions.id, before.id))
      .returning();
    await audit(ctx, {
      action: 'registry.draft_update',
      entityType: 'registry_transaction',
      entityId: row!.id,
      before: { summary: before.summary, effectiveDate: before.effectiveDate, payload: before.payload },
      after: { summary: row!.summary, effectiveDate: row!.effectiveDate, payload: row!.payload },
    });
    return txDto(row!);
  },
});

export const parkDraft = defineService({
  name: 'registry.parkTransaction',
  description:
    'Park a draft at a waiting step: awaiting decision (the board or general meeting has not decided yet) or awaiting registration (waiting for the registration authority, e.g. Bolagsverket). Or set it back to draft.',
  kind: 'mutation',
  access: 'registry.draft',
  input: parkTransactionInput,
  async handler(ctx, input) {
    const before = await editableDraft(ctx, input.transactionId);
    const [row] = await ctx.db
      .update(registryTransactions)
      .set({ status: input.status })
      .where(eq(registryTransactions.id, before.id))
      .returning();
    await audit(ctx, {
      action: 'registry.draft_park',
      entityType: 'registry_transaction',
      entityId: row!.id,
      before: { status: before.status },
      after: { status: row!.status },
    });
    return txDto(row!);
  },
});

export const deleteDraft = defineService({
  name: 'registry.deleteDraft',
  description: 'Delete a draft share register transaction that was never committed. Committed transactions are never deleted.',
  kind: 'mutation',
  access: 'registry.draft',
  input: transactionIdInput,
  async handler(ctx, input) {
    const before = await editableDraft(ctx, input.transactionId);
    await ctx.db.delete(txDocuments).where(eq(txDocuments.txId, before.id));
    await ctx.db.delete(registryTransactions).where(eq(registryTransactions.id, before.id));
    await audit(ctx, {
      action: 'registry.draft_delete',
      entityType: 'registry_transaction',
      entityId: before.id,
      before: { type: before.type, summary: before.summary, payload: before.payload },
    });
    return { ok: true };
  },
});

function committerRoles() {
  return ROLES.filter((r) => ROLE_INFO[r].permissions.includes('registry.commit'));
}

export const submitDraft = defineService({
  name: 'registry.submitForApproval',
  description:
    'Ask the board to approve and commit a draft share register transaction. Everyone who can commit is notified. Needed when four-eyes approval is on, or when the person preparing it cannot commit.',
  kind: 'mutation',
  access: 'registry.draft',
  input: transactionIdInput,
  async handler(ctx, input) {
    const before = await editableDraft(ctx, input.transactionId);
    const registry = await requireRegistry(ctx);
    const { rows, result } = await simulate(ctx, registry, parseStored(before), before.id);
    if (!result.ok) throw conflictError(result, before.id, rows);
    const [row] = await ctx.db
      .update(registryTransactions)
      .set({ submittedAt: new Date(), submittedBy: ctx.actor!.userId })
      .where(eq(registryTransactions.id, before.id))
      .returning();
    const approvers = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, committerRoles()), eq(users.active, true)));
    await notify(
      ctx.db,
      approvers.map((a) => a.id).filter((id) => id !== ctx.actor!.userId),
      {
        type: 'registry.approval_requested',
        title: 'A share register transaction needs approval',
        body: `${ctx.actor!.name} asks you to approve: ${row!.summary}`,
        link: `/registry/transactions/${row!.id}`,
        email: true,
      },
    );
    await audit(ctx, { action: 'registry.submit', entityType: 'registry_transaction', entityId: row!.id });
    return txDto(row!);
  },
});

function assertCanCommit(ctx: Ctx, registry: RegistryContext, row: TxRow) {
  if ((ctx.surface === 'mcp' || ctx.surface === 'ai') && !registry.row.commitOverMcp)
    throw forbidden('Committing from MCP clients or the assistant is turned off in Share Register settings. Commit it in the app.');
  const mayCommit = can(ctx, 'registry.commit') || (registry.row.drafterCanCommit && can(ctx, 'registry.draft'));
  if (!mayCommit) throw forbidden('Only the board or CEO can enter transactions in the register. Submit it for approval instead.');
  if (registry.row.fourEyes) {
    if (!can(ctx, 'registry.commit')) throw forbidden('Four-eyes approval is on: a board member must approve it');
    if (row.createdBy === ctx.actor!.userId || row.submittedBy === ctx.actor!.userId)
      throw forbidden('Four-eyes approval is on: someone other than the person who prepared it must approve it');
  }
}

export const commitTransaction = defineService({
  name: 'registry.commit',
  description:
    'Enter a draft transaction in the share register. It is validated against the full history (backdated entries re-check every later transaction), sealed with a sequence number and hash, and can never change afterwards. Off over MCP and the assistant unless an Admin allows it.',
  kind: 'mutation',
  access: 'registry.draft',
  input: transactionIdInput,
  async handler(ctx, input) {
    const registry = await requireRegistry(ctx);
    await lockRegistry(ctx);
    const row = await editableDraft(ctx, input.transactionId);
    assertCanCommit(ctx, registry, row);
    const tx = parseStored(row);
    const { rows, result } = await simulate(ctx, registry, tx, row.id);
    if (!result.ok) throw conflictError(result, row.id, rows);
    const sealed = await sealTransaction(ctx, row, {
      approvedBy: registry.row.fourEyes ? ctx.actor!.userId : null,
      rulePackVersion: registry.rulePack.version,
    });
    if (tx.type === 'reversal')
      await ctx.db.update(registryTransactions).set({ status: 'reversed' }).where(eq(registryTransactions.id, tx.reversesId));
    await writeCache(ctx, result.ledger);
    await audit(ctx, {
      action: 'registry.commit',
      entityType: 'registry_transaction',
      entityId: sealed.id,
      after: { seq: sealed.seq, type: sealed.type, summary: sealed.summary, effectiveDate: sealed.effectiveDate, hash: sealed.hash },
    });
    return txDto(sealed);
  },
});

export const reverseTransaction = defineService({
  name: 'registry.reverse',
  description:
    'Correct a committed share register transaction by entering a reversing transaction. The original stays in the ledger marked reversed; the register is replayed without it, and the reversal is refused if a later transaction depends on it.',
  kind: 'mutation',
  access: 'registry.commit',
  input: reverseTransactionInput,
  async handler(ctx, input) {
    const registry = await requireRegistry(ctx);
    await lockRegistry(ctx);
    if (registry.row.fourEyes)
      throw forbidden('Four-eyes approval is on: save a reversal as a draft and have another board member approve it');
    const target = await loadTx(ctx, input.transactionId);
    if (target.status !== 'committed') throw conflict('Only committed transactions can be reversed');
    const tx: RegistryTransaction = {
      type: 'reversal',
      effectiveDate: input.effectiveDate ?? (await today()),
      decisionDate: null,
      registrationDate: null,
      note: '',
      holders: [],
      reversesId: target.id,
      reason: input.reason,
    };
    const [draft] = await ctx.db
      .insert(registryTransactions)
      .values({ ...columnsFor(tx), status: 'draft', summary: `Reversal of ${target.summary}`, createdBy: ctx.actor!.userId })
      .returning();
    assertCanCommit(ctx, registry, { ...draft!, createdBy: null });
    const { rows, result } = await simulate(ctx, registry, tx, draft!.id);
    if (!result.ok) throw conflictError(result, draft!.id, rows);
    const sealed = await sealTransaction(ctx, draft!, { rulePackVersion: registry.rulePack.version });
    await ctx.db.update(registryTransactions).set({ status: 'reversed' }).where(eq(registryTransactions.id, target.id));
    await writeCache(ctx, result.ledger);
    await audit(ctx, {
      action: 'registry.reverse',
      entityType: 'registry_transaction',
      entityId: target.id,
      before: { status: 'committed' },
      after: { status: 'reversed', reversalId: sealed.id, reversalSeq: sealed.seq, reason: input.reason },
    });
    return txDto(sealed);
  },
});

export const attachDocument = defineService({
  name: 'registry.attachDocument',
  description:
    'Attach an uploaded file as evidence to a share register transaction (board decision, minutes, subscription list, proof of payment, registration certificate, agreement, consent). Its SHA-256 is recorded. Works on drafts and committed transactions.',
  kind: 'mutation',
  access: 'registry.draft',
  input: attachDocumentInput,
  async handler(ctx, input) {
    const row = await loadTx(ctx, input.transactionId);
    const [file] = await ctx.db
      .select()
      .from(files)
      .where(and(eq(files.id, input.fileId), isNull(files.deletedAt)));
    if (!file) throw notFound('File');
    if (file.kind !== 'registry-document') throw badRequest('Upload the file as a share register document');
    const sha256 = createHash('sha256')
      .update(await getObjectBuffer(file.storageKey))
      .digest('hex');
    const [doc] = await ctx.db
      .insert(txDocuments)
      .values({
        txId: row.id,
        fileId: file.id,
        storageKey: file.storageKey,
        kind: input.kind,
        name: file.name,
        sha256,
        createdBy: ctx.actor!.userId,
      })
      .returning();
    await audit(ctx, {
      action: 'registry.document_attach',
      entityType: 'registry_transaction',
      entityId: row.id,
      after: { documentId: doc!.id, kind: doc!.kind, name: doc!.name, sha256 },
    });
    return doc!;
  },
});

export const detachDocument = defineService({
  name: 'registry.detachDocument',
  description: 'Remove a document from a draft share register transaction. Documents on committed transactions stay.',
  kind: 'mutation',
  access: 'registry.draft',
  input: z.object({ documentId: z.uuid() }),
  async handler(ctx, input) {
    const [doc] = await ctx.db.select().from(txDocuments).where(eq(txDocuments.id, input.documentId));
    if (!doc) throw notFound('Document');
    await editableDraft(ctx, doc.txId);
    await ctx.db.delete(txDocuments).where(eq(txDocuments.id, doc.id));
    await audit(ctx, { action: 'registry.document_detach', entityType: 'registry_transaction', entityId: doc.txId, before: doc });
    return { ok: true };
  },
});

export const verifyRegistryChain = defineService({
  name: 'registry.verifyChain',
  description:
    'Recompute the SHA-256 hash chain over every committed share register transaction and record the result. It fails if any committed transaction was altered or removed. Also runs nightly.',
  kind: 'mutation',
  access: 'registry.read',
  input: empty,
  async handler(ctx) {
    const check = await verifyChain(ctx);
    const row = await recordChainCheck(ctx, check);
    await audit(ctx, { action: 'registry.verify_chain', entityType: 'registry_chain', after: check });
    return row;
  },
});

export const rebuildRegistry = defineService({
  name: 'registry.rebuild',
  description:
    'Rebuild the derived holdings, movements and holder history from the committed transactions. Use it if the derived data looks wrong.',
  kind: 'mutation',
  access: 'registry.manage',
  input: empty,
  async handler(ctx) {
    const registry = await requireRegistry(ctx);
    await lockRegistry(ctx);
    const ledger = await rebuild(ctx, registry);
    await audit(ctx, { action: 'registry.rebuild', entityType: 'registry', after: { lots: ledger.open.length + ledger.closed.length } });
    return { ok: true, openLots: ledger.open.length, holders: ledger.holders.size };
  },
});

export const registryHistory = defineService({
  name: 'registry.history',
  description:
    'Every committed share register transaction in effective order with its share movements, for a full history or an export. Reversed transactions are included and marked.',
  kind: 'query',
  access: 'registry.read',
  input: empty,
  async handler(ctx) {
    const registry = await requireRegistry(ctx);
    const rows = await committedRows(ctx);
    const moves = await ctx.db.select().from(movements).orderBy(asc(movements.id));
    const items = rows.map((r) => ({ ...txDto(r), transaction: parseStored(r), movements: moves.filter((m) => m.txId === r.id) }));
    items.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : a.seq! - b.seq!));
    return { currency: registry.config.currency, rulePack: registry.rulePack.version, items };
  },
});
