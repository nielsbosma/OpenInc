import {
  type HolderDetails,
  RULE_PACKS,
  type RulePackId,
  registryTransaction,
  TRANSACTION_LABELS,
  TRANSACTION_TYPES,
  type TransactionType,
} from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader, Spinner, validate } from '@/components/common';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useCan, useClientConfig } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { parseRanges, today, useHolderOptions, useRegistryStatus } from '../common';
import { Documents } from '../Documents';
import type { Draft, FormContext } from './fields';
import { NEW_CLASS, StepFields } from './forms';
import { Preview } from './Preview';

const restrictionsOff = { consent: false, preEmption: false, firstRefusal: false };

function blank(type: TransactionType, search: URLSearchParams): Draft {
  const base = { type, effectiveDate: today(), decisionDate: null, registrationDate: null, note: '', holders: [] };
  const classes = [{ ...NEW_CLASS, code: 'A', restrictions: restrictionsOff }];
  switch (type) {
    case 'incorporation':
      return { ...base, shareCapital: undefined, classes, allocations: [{ holderId: '', classCode: 'A', count: '' }] };
    case 'opening_balance':
      return { ...base, shareCapital: undefined, classes, lots: [{ holderId: '', classCode: 'A', count: '' }], pledges: [] };
    case 'transfer':
      return { ...base, kind: 'sale', fromHolderId: '', toHolderId: '', lines: [{ classCode: '', count: '' }], restrictionSteps: {} };
    case 'holder_change':
      return { ...base };
    case 'new_issue':
      return {
        ...base,
        form: 'cash',
        allocation: 'directed',
        classCode: '',
        pricePerShare: '',
        subscriptionDate: null,
        paymentDate: null,
        inKindDescription: '',
        subscriptions: [{ holderId: '', count: '', paidOn: null }],
      };
    case 'registration':
      return { ...base, ofTransactionId: search.get('of') ?? '', registrationDate: today() };
    case 'bonus_issue':
      return { ...base, mode: 'new_shares', capitalIncrease: undefined, ratio: { newShares: '1', perShares: '1' }, rounding: 'down' };
    case 'split':
      return { ...base, ratio: 2 };
    case 'reverse_split':
      return { ...base, ratio: 2, fractions: 'round', rounding: 'down' };
    case 'pledge':
      return {
        ...base,
        holderId: '',
        lines: [{ classCode: '', count: '' }],
        pledgee: { name: '', nationalId: '', address: '' },
        terms: '',
      };
    case 'pledge_release':
      return { ...base, pledgeId: '' };
    case 'class_change':
      return { ...base, classes: [] };
    case 'reversal':
      return { ...base, reversesId: search.get('of') ?? '', reason: '' };
  }
}

/** Drops what only the form uses and turns empty optional fields into "left out". */
function normalize(tx: Draft): Draft {
  const out = JSON.parse(JSON.stringify(tx));
  if (out.type === 'opening_balance')
    out.lots = out.lots.map(({ rangesText, ...lot }: Draft) => {
      const ranges = rangesText ? parseRanges(rangesText) : null;
      return ranges?.length ? { ...lot, ranges } : lot;
    });
  for (const key of ['pricePerShare', 'capitalIncrease', 'buyOutPricePerShare', 'poolHolderId', 'shareCapital'])
    if (out[key] === '' || out[key] === null) delete out[key];
  if (out.type === 'new_issue' && out.pricePerShare === undefined) out.pricePerShare = '';
  if (out.lines) out.lines = out.lines.map((l: Draft) => (l.ranges?.length ? l : { classCode: l.classCode, count: l.count }));
  return out;
}

export function TransactionWizard() {
  const params = useParams();
  const [search] = useSearchParams();
  const trpc = useTRPC();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = useClientConfig();
  const status = useRegistryStatus();
  const register = useQuery(trpc.registry.getRegister.queryOptions({ asOf: '9999-12-31' }));
  const existing = useQuery({ ...trpc.registry.getTransaction.queryOptions({ transactionId: params.id ?? '' }), enabled: !!params.id });
  const type = (params.type ?? existing.data?.type) as TransactionType | undefined;

  const [tx, setTx] = useState<Draft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(params.id ?? null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (tx || !type) return;
    if (params.id) {
      if (existing.data) setTx(existing.data.transaction);
    } else if (TRANSACTION_TYPES.includes(type)) setTx(blank(type, search));
  }, [tx, type, params.id, existing.data, search]);

  const holders = useHolderOptions((tx?.holders ?? []) as HolderDetails[]);
  const normalized = useMemo(() => (tx ? normalize(tx) : null), [tx]);
  const clientCheck = normalized ? validate(registryTransaction, normalized) : null;

  if (status.isLoading || register.isLoading || !tx || !type || !status.data?.setUp || !normalized || !clientCheck) return <Spinner />;

  const rulePack = status.data.settings.rulePack as RulePackId;
  const pack = RULE_PACKS[rulePack];
  const steps = pack.steps(type);
  const step = steps[Math.min(index, steps.length - 1)]!;
  const ctx: FormContext = {
    tx,
    set: (patch) => setTx((t: Draft) => ({ ...t, ...patch })),
    register: register.data ?? null,
    holders,
    addHolder: (h) =>
      setTx((t: Draft) => ({ ...t, holders: [...(t.holders ?? []).filter((x: HolderDetails) => x.holderId !== h.holderId), h] })),
    currency: config?.currency ?? 'EUR',
    numbering: status.data.settings.numbering,
    nominalMode: status.data.settings.capitalMode === 'nominal',
    rulePack,
    errors: index === steps.length - 1 && clientCheck.errors ? clientCheck.errors : {},
  };
  const waitSteps = steps.filter((s) => s.waitStatus);

  return (
    <>
      <PageHeader
        title={`${params.id ? 'Edit' : 'New'} ${TRANSACTION_LABELS[type]}`}
        description={
          <>
            <Link
              to={draftId ? `/registry/transactions/${draftId}` : '/registry'}
              className="inline-flex items-center gap-1 text-xs hover:text-foreground"
            >
              <ArrowLeft className="size-3" /> Share Register
            </Link>
            {existing.data?.origin && (
              <span className="ml-3 text-xs">Prepared in {existing.data.origin.label || existing.data.origin.module}</span>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[12rem_1fr]">
        <ol className="flex gap-1 overflow-x-auto lg:flex-col">
          {steps.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap',
                  i === index ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border text-[10px]',
                    i < index && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {i < index ? <Check className="size-3" /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        <div className="grid min-w-0 content-start gap-5">
          <h2 className="text-base font-semibold">{step.label}</h2>
          {step.key === 'documents' ? (
            <DocumentsStep draftId={draftId} />
          ) : step.key === 'review' ? (
            <ReviewStep transaction={clientCheck.data} clientErrors={clientCheck.errors} draftId={draftId} />
          ) : (
            <StepFields type={type} step={step.key} ctx={ctx} />
          )}
          <WizardActions
            first={index === 0}
            last={index === steps.length - 1}
            onBack={() => setIndex(index - 1)}
            onNext={() => setIndex(index + 1)}
            transaction={clientCheck.data}
            draftId={draftId}
            onSaved={setDraftId}
            waitStatuses={waitSteps.map((s) => ({ status: s.waitStatus!, label: s.label }))}
            canCommit={can('registry.commit') || (can('registry.draft') && status.data.settings.drafterCanCommit)}
            fourEyes={status.data.settings.fourEyes}
            onDone={async (id) => {
              await queryClient.invalidateQueries({ queryKey: trpc.registry.pathKey() });
              navigate(`/registry/transactions/${id}`);
            }}
          />
        </div>
      </div>
    </>
  );
}

function DocumentsStep({ draftId }: { draftId: string | null }) {
  const trpc = useTRPC();
  const can = useCan();
  const tx = useQuery({ ...trpc.registry.getTransaction.queryOptions({ transactionId: draftId ?? '' }), enabled: !!draftId });
  if (!draftId)
    return (
      <p className="text-muted-foreground">
        Attach the evidence: the decision, minutes, subscription list, proof of payment or the registration certificate. Click Save Draft
        below first; the documents are kept with the transaction.
      </p>
    );
  if (!tx.data) return <Spinner />;
  return <Documents transactionId={draftId} documents={tx.data.documents} editable canAttach={can('registry.draft')} />;
}

function ReviewStep({
  transaction,
  clientErrors,
  draftId,
}: {
  transaction: Draft | null;
  clientErrors: Record<string, string> | null;
  draftId: string | null;
}) {
  const trpc = useTRPC();
  const check = useQuery({
    ...trpc.registry.validate.queryOptions({ transaction: transaction ?? undefined, transactionId: draftId ?? undefined }),
    enabled: !!transaction,
  });
  if (clientErrors)
    return (
      <Alert variant="destructive">
        <AlertTitle>Some Fields Need Attention</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-4">
            {Object.entries(clientErrors).map(([field, message]) => (
              <li key={field}>
                <span className="font-mono text-xs">{field}</span>: {message}
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    );
  if (check.isLoading || !check.data) return <Spinner />;
  return <Preview result={check.data} />;
}

function WizardActions(props: {
  first: boolean;
  last: boolean;
  onBack: () => void;
  onNext: () => void;
  transaction: Draft | null;
  draftId: string | null;
  onSaved: (id: string) => void;
  waitStatuses: { status: 'awaiting_decision' | 'awaiting_registration'; label: string }[];
  canCommit: boolean;
  fourEyes: boolean;
  onDone: (id: string) => Promise<void>;
}) {
  const trpc = useTRPC();
  const create = useMutation(trpc.registry.draftTransaction.mutationOptions());
  const update = useMutation(trpc.registry.updateDraft.mutationOptions());
  const park = useMutation(trpc.registry.parkTransaction.mutationOptions());
  const commit = useMutation(trpc.registry.commit.mutationOptions());
  const submit = useMutation(trpc.registry.submitForApproval.mutationOptions());
  const busy = create.isPending || update.isPending || park.isPending || commit.isPending || submit.isPending;

  const save = async () => {
    if (!props.transaction) return null;
    const row = props.draftId
      ? await update.mutateAsync({ transactionId: props.draftId, transaction: props.transaction })
      : await create.mutateAsync({ transaction: props.transaction });
    props.onSaved(row.id);
    return row.id;
  };
  const then = (action: (id: string) => Promise<unknown>) => async () => {
    const id = await save();
    if (!id) return;
    await action(id);
    await props.onDone(id);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      {!props.first && (
        <Button variant="outline" onClick={props.onBack}>
          Back
        </Button>
      )}
      <div className="ml-auto flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy || !props.transaction} onClick={() => save()}>
          Save Draft
        </Button>
        {props.last &&
          props.waitStatuses.map((w) => (
            <Button
              key={w.status}
              variant="outline"
              disabled={busy || !props.transaction}
              onClick={then((id) => park.mutateAsync({ transactionId: id, status: w.status }))}
            >
              {w.status === 'awaiting_decision' ? 'Park as Awaiting Decision' : 'Park as Awaiting Registration'}
            </Button>
          ))}
        {props.last && (props.fourEyes || !props.canCommit) && (
          <Button
            variant={props.canCommit ? 'outline' : 'default'}
            disabled={busy || !props.transaction}
            onClick={then((id) => submit.mutateAsync({ transactionId: id }))}
          >
            Submit for Approval
          </Button>
        )}
        {props.last && props.canCommit && !props.fourEyes && (
          <Button disabled={busy || !props.transaction} onClick={then((id) => commit.mutateAsync({ transactionId: id }))}>
            Commit to the Register
          </Button>
        )}
        {!props.last && <Button onClick={props.onNext}>Next</Button>}
      </div>
    </div>
  );
}
