import {
  and,
  asc,
  chainVerifications,
  desc,
  encumbrances,
  holders,
  holderVersions,
  inArray,
  isNotNull,
  lots,
  movements,
  registrySettings,
  registryTransactions,
  shareClasses,
  sql,
} from '@openinc/db';
import {
  currencyDigits,
  type RegistrySettingsView,
  type RegistryTransaction,
  RULE_PACKS,
  type RulePack,
  type RulePackId,
  registryTransaction,
  TRANSACTION_LABELS,
  type Violation,
} from '@openinc/shared';
import type { Ctx } from '../context.ts';
import { type AppError, preconditionFailed } from '../errors.ts';
import { getSettings } from '../settings.ts';
import { formatDec } from './decimal.ts';
import { type EngineConfig, type Ledger, type LedgerTx, type ReplayFailed, replay } from './engine.ts';
import { GENESIS_HASH, transactionHash } from './hash.ts';

/** One register per install: every commit takes this lock so commits apply one at a time. */
export const REGISTRY_LOCK = 73_500_101;

export type TxRow = typeof registryTransactions.$inferSelect;
export type SettingsRow = typeof registrySettings.$inferSelect;

export async function readRegistrySettings(ctx: Ctx): Promise<SettingsRow | null> {
  const [row] = await ctx.db.select().from(registrySettings);
  return row ?? null;
}

export function settingsView(row: SettingsRow): RegistrySettingsView {
  return {
    country: row.country,
    legalForm: row.legalForm,
    rulePack: row.rulePack as RulePackId,
    nationalNumber: row.nationalNumber,
    euid: row.euid,
    lei: row.lei,
    numbering: row.numbering,
    capitalMode: row.capitalMode,
    minShareCapital: row.minShareCapital,
    maxShareCapital: row.maxShareCapital,
    minShares: row.minShares,
    maxShares: row.maxShares,
  };
}

export async function companyCurrency(): Promise<string> {
  return (await getSettings('company'))?.currency ?? 'EUR';
}

export function engineConfig(view: RegistrySettingsView, currency: string): EngineConfig {
  return { settings: view, rulePack: RULE_PACKS[view.rulePack], currency, currencyDigits: currencyDigits(currency) };
}

export interface RegistryContext {
  row: SettingsRow;
  view: RegistrySettingsView;
  rulePack: RulePack;
  config: EngineConfig;
}

export async function requireRegistry(ctx: Ctx): Promise<RegistryContext> {
  const row = await readRegistrySettings(ctx);
  if (!row) throw preconditionFailed('The share register is not set up yet. Open Share Register and choose the country and legal form.');
  const view = settingsView(row);
  const config = engineConfig(view, await companyCurrency());
  return { row, view, rulePack: config.rulePack, config };
}

export function parseStored(row: Pick<TxRow, 'payload'>): RegistryTransaction {
  return registryTransaction.parse(row.payload);
}

export function toLedgerTx(row: TxRow, seq = row.seq ?? Number.MAX_SAFE_INTEGER): LedgerTx {
  return { id: row.id, seq, tx: parseStored(row) };
}

export async function committedRows(ctx: Ctx): Promise<TxRow[]> {
  return ctx.db.select().from(registryTransactions).where(isNotNull(registryTransactions.seq)).orderBy(asc(registryTransactions.seq));
}

/**
 * What the ledger replays: committed transactions minus reversed ones. With `knownAt`, only what had
 * been entered by then, so the register can be shown as it looked at that moment.
 */
export function effectiveItems(rows: TxRow[], knownAt?: Date): LedgerTx[] {
  const visible = knownAt ? rows.filter((r) => r.enteredAt && r.enteredAt <= knownAt) : rows;
  const reversed = new Set(visible.filter((r) => r.type === 'reversal' && r.reversesId).map((r) => r.reversesId!));
  return visible.filter((r) => r.type !== 'reversal' && !reversed.has(r.id)).map((r) => toLedgerTx(r));
}

export async function loadItems(ctx: Ctx, knownAt?: Date): Promise<LedgerTx[]> {
  return effectiveItems(await committedRows(ctx), knownAt);
}

export function describeTx(row: Pick<TxRow, 'seq' | 'type' | 'effectiveDate'>): string {
  return `#${row.seq ?? 'draft'} ${TRANSACTION_LABELS[row.type as RegistryTransaction['type']] ?? row.type} on ${row.effectiveDate}`;
}

/** Turns a failed replay into a message that names the transaction the change conflicts with. */
export function conflictError(failure: ReplayFailed, candidateId: string, rows: TxRow[]): AppError {
  const reasons = failure.errors.map((e) => e.message).join('; ');
  if (failure.failedAt.id === candidateId) return preconditionFailed(reasons);
  const row = rows.find((r) => r.id === failure.failedAt.id);
  const name = row ? describeTx(row) : failure.failedAt.id;
  return preconditionFailed(`This conflicts with transaction ${name}: ${reasons}`);
}

export interface ValidationOutcome {
  ok: boolean;
  errors: Violation[];
  warnings: Violation[];
  conflict: { transactionId: string; seq: number | null; type: string; effectiveDate: string } | null;
}

export function outcome(result: ReturnType<typeof replay>, candidateId: string | null, rows: TxRow[]): ValidationOutcome {
  if (result.ok) {
    const warnings = candidateId ? result.warnings.filter((w) => !w.transactionId || w.transactionId === candidateId) : result.warnings;
    return { ok: true, errors: [], warnings, conflict: null };
  }
  const row = rows.find((r) => r.id === result.failedAt.id);
  const isCandidate = result.failedAt.id === candidateId;
  return {
    ok: false,
    errors: result.errors,
    warnings: result.warnings.filter((w) => w.transactionId === candidateId),
    conflict: isCandidate
      ? null
      : {
          transactionId: result.failedAt.id,
          seq: row?.seq ?? null,
          type: result.failedAt.tx.type,
          effectiveDate: result.failedAt.tx.effectiveDate,
        },
  };
}

export async function lockRegistry(ctx: Ctx): Promise<void> {
  await ctx.db.execute(sql`select pg_advisory_xact_lock(${REGISTRY_LOCK})`);
}

export async function chainHead(ctx: Ctx): Promise<{ seq: number; hash: string }> {
  const [last] = await ctx.db
    .select({ seq: registryTransactions.seq, hash: registryTransactions.hash })
    .from(registryTransactions)
    .where(isNotNull(registryTransactions.seq))
    .orderBy(desc(registryTransactions.seq))
    .limit(1);
  return { seq: last?.seq ?? 0, hash: last?.hash ?? GENESIS_HASH };
}

export function hashFields(
  row: Pick<
    TxRow,
    'id' | 'type' | 'decisionDate' | 'effectiveDate' | 'registrationDate' | 'reversesId' | 'rulePackVersion' | 'committedBy' | 'payload'
  > & { seq: number; enteredAt: Date },
) {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type,
    decisionDate: row.decisionDate,
    effectiveDate: row.effectiveDate,
    registrationDate: row.registrationDate,
    enteredAt: row.enteredAt,
    reversesId: row.reversesId,
    rulePackVersion: row.rulePackVersion,
    committedBy: row.committedBy,
    payload: row.payload,
  };
}

/** Assigns the next sequence number and chains the hash. The caller holds the registry lock. */
export async function sealTransaction(
  ctx: Ctx,
  row: TxRow,
  extra: { approvedBy?: string | null; rulePackVersion: string },
): Promise<TxRow> {
  const head = await chainHead(ctx);
  const enteredAt = new Date();
  const sealed = {
    ...row,
    seq: head.seq + 1,
    enteredAt,
    rulePackVersion: extra.rulePackVersion,
    committedBy: ctx.actor?.userId ?? null,
  };
  const hash = transactionHash(head.hash, hashFields(sealed));
  const [updated] = await ctx.db
    .update(registryTransactions)
    .set({
      status: 'committed',
      seq: sealed.seq,
      enteredAt,
      rulePackVersion: extra.rulePackVersion,
      committedBy: sealed.committedBy,
      approvedBy: extra.approvedBy ?? null,
      prevHash: head.hash,
      hash,
    })
    .where(sql`${registryTransactions.id} = ${row.id}`)
    .returning();
  return updated!;
}

const CHUNK = 500;

async function insertChunks<T>(values: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < values.length; i += CHUNK) await insert(values.slice(i, i + CHUNK));
}

/** Replaces the derived tables with what the ledger computed. */
export async function writeCache(ctx: Ctx, ledger: Ledger): Promise<void> {
  const db = ctx.db;
  await db.delete(lots);
  await db.delete(movements);
  await db.delete(encumbrances);
  await db.delete(shareClasses);
  await db.delete(holderVersions);

  const holderIds = [...new Set(ledger.holderVersions.map((v) => v.holderId))];
  await insertChunks(holderIds, (chunk) =>
    db
      .insert(holders)
      .values(chunk.map((id) => ({ id })))
      .onConflictDoNothing(),
  );
  await insertChunks(ledger.holderVersions, (chunk) =>
    db.insert(holderVersions).values(
      chunk.map((v) => ({
        holderId: v.holderId,
        txId: v.txId,
        validFrom: v.validFrom,
        validTo: v.validTo,
        kind: v.details.kind,
        name: v.details.name,
        nationalId: v.details.nationalId,
        country: v.details.country,
        address: v.details.address,
        email: v.details.email,
        members: v.details.members,
      })),
    ),
  );
  const classes = [...ledger.classes.values()];
  await insertChunks(classes, (chunk) =>
    db.insert(shareClasses).values(
      chunk.map((c) => ({
        code: c.def.code,
        name: c.def.name,
        votesPerShare: String(c.def.votesPerShare),
        nominalPerShare: c.nominal === null ? null : formatDec(c.nominal),
        dividendTerms: c.def.dividendTerms,
        liquidationTerms: c.def.liquidationTerms,
        conversionClause: c.def.conversionClause,
        redemptionClause: c.def.redemptionClause,
        restrictions: c.def.restrictions,
        issued: c.issued,
        validFromTx: c.fromTx,
      })),
    ),
  );
  const allLots = [...ledger.closed, ...ledger.open];
  await insertChunks(allLots, (chunk) =>
    db.insert(lots).values(
      chunk.map((l) => ({
        key: l.key,
        holderId: l.holderId,
        classCode: l.classCode,
        count: l.count,
        rangeFrom: l.from,
        rangeTo: l.to,
        interim: l.interim,
        validFromTx: l.fromTx,
        validToTx: l.toTx,
        validFromDate: l.fromDate,
        validToDate: l.toDate,
      })),
    ),
  );
  await insertChunks(ledger.movements, (chunk) =>
    db.insert(movements).values(
      chunk.map((m) => ({
        txId: m.txId,
        classCode: m.classCode,
        fromHolderId: m.fromHolderId,
        toHolderId: m.toHolderId,
        count: m.count,
        rangeFrom: m.from,
        rangeTo: m.to,
        nominalAmount: m.nominalAmount,
        pricePerShare: m.pricePerShare,
        consideration: m.consideration,
      })),
    ),
  );
  await insertChunks(ledger.pledges, (chunk) =>
    db.insert(encumbrances).values(
      chunk.map((p) => ({
        id: p.id,
        holderId: p.holderId,
        classCode: p.classCode,
        count: p.count,
        ranges: p.ranges.map((r) => ({ from: r.from.toString(), to: r.to.toString() })),
        pledgee: p.pledgee,
        validFromTx: p.fromTx,
        validToTx: p.toTx,
        validFromDate: p.fromDate,
        validToDate: p.toDate,
      })),
    ),
  );
}

/** Replays every committed transaction and rewrites the cache. Fails if the stored history no longer replays. */
export async function rebuild(ctx: Ctx, registry: RegistryContext): Promise<Ledger> {
  const rows = await committedRows(ctx);
  const result = replay(effectiveItems(rows), registry.config);
  if (!result.ok) throw conflictError(result, '', rows);
  await writeCache(ctx, result.ledger);
  return result.ledger;
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  message: string;
}

/** Recomputes every hash from the stored rows. Any edit to a committed row breaks the chain from there on. */
export async function verifyChain(ctx: Ctx): Promise<ChainCheck> {
  const rows = await committedRows(ctx);
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of rows) {
    if (row.seq !== expectedSeq)
      return { ok: false, checked: expectedSeq - 1, brokenAtSeq: row.seq, message: `Transaction #${expectedSeq} is missing` };
    if (row.prevHash !== prev)
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAtSeq: row.seq,
        message: `Transaction #${row.seq} does not point to the one before it`,
      };
    const hash = transactionHash(prev, hashFields({ ...row, seq: row.seq!, enteredAt: row.enteredAt! }));
    if (hash !== row.hash)
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAtSeq: row.seq,
        message: `Transaction #${row.seq} was changed after it was entered`,
      };
    prev = hash;
    expectedSeq++;
  }
  return { ok: true, checked: rows.length, brokenAtSeq: null, message: rows.length ? 'Every hash matches' : 'No transactions yet' };
}

export async function recordChainCheck(ctx: Ctx, check: ChainCheck) {
  const [row] = await ctx.db.insert(chainVerifications).values(check).returning();
  return row!;
}

export async function holderNames(ctx: Ctx, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await ctx.db
    .select({ holderId: holderVersions.holderId, name: holderVersions.name, validTo: holderVersions.validTo })
    .from(holderVersions)
    .where(and(inArray(holderVersions.holderId, ids)));
  const out = new Map<string, string>();
  for (const r of rows) if (r.validTo === null || !out.has(r.holderId)) out.set(r.holderId, r.name);
  return out;
}
