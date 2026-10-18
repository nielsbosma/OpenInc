import { formatMoney } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton, Field, Spinner } from '@/components/common';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useCan, useClientConfig, useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { exportUrl, fmt, StatusBadge, today } from './common';
import { Documents } from './Documents';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-2 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || '—'}</dd>
    </div>
  );
}

function ReverseDialog({
  transactionId,
  open,
  onOpenChange,
}: {
  transactionId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today());
  const reverse = useMutation(
    trpc.registry.reverse.mutationOptions({
      onSuccess: async () => {
        toast.success('Transaction reversed');
        onOpenChange(false);
        await queryClient.invalidateQueries({ queryKey: trpc.registry.pathKey() });
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse This Transaction</DialogTitle>
          <DialogDescription>
            The transaction stays in the ledger, marked reversed, and the register is replayed without it. If a later transaction depends on
            it, the reversal is refused and the conflict is named.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="reverse-reason">
          <Textarea id="reverse-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Date of the Correction" htmlFor="reverse-date">
          <Input id="reverse-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || reverse.isPending}
            onClick={() => reverse.mutate({ transactionId, reason, effectiveDate: date })}
          >
            Reverse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TransactionPage() {
  const { id = '' } = useParams();
  const trpc = useTRPC();
  const can = useCan();
  const format = useFormat();
  const config = useClientConfig();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reversing, setReversing] = useState(false);
  const tx = useQuery(trpc.registry.getTransaction.queryOptions({ transactionId: id }));
  const isDraft = !!tx.data && tx.data.seq === null;
  const check = useQuery({ ...trpc.registry.validate.queryOptions({ transactionId: id }), enabled: isDraft && can('registry.draft') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.registry.pathKey() });
  const commit = useMutation(
    trpc.registry.commit.mutationOptions({
      onSuccess: async () => {
        toast.success('Entered in the register');
        await refresh();
      },
    }),
  );
  const submit = useMutation(
    trpc.registry.submitForApproval.mutationOptions({
      onSuccess: async () => {
        toast.success('Sent for approval');
        await refresh();
      },
    }),
  );
  const remove = useMutation(
    trpc.registry.deleteDraft.mutationOptions({
      onSuccess: async () => {
        await refresh();
        navigate('/registry/transactions');
      },
    }),
  );
  if (tx.isLoading) return <Spinner />;
  if (!tx.data) return null;
  const t = tx.data;
  const currency = config?.currency ?? 'EUR';
  const name = (holderId: string | null) => (holderId ? (t.holderNames[holderId] ?? holderId.slice(0, 8)) : '—');

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/registry/transactions"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Transactions
          </Link>
          <h2 className="text-lg font-semibold">
            {t.seq ? <span className="mr-2 font-mono text-muted-foreground">#{t.seq}</span> : null}
            {t.summary || t.typeLabel}
          </h2>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={t.status} label={t.statusLabel} />
            <span className="text-xs text-muted-foreground">{t.typeLabel}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.type === 'transfer' && t.seq !== null && (
            <Button variant="outline" asChild>
              <a href={exportUrl('settlement-note', { transactionId: t.id, lang: 'en' })} target="_blank" rel="noreferrer">
                Settlement Note
              </a>
            </Button>
          )}
          {t.pendingRegistration && can('registry.draft') && (
            <Button variant="outline" asChild>
              <Link to={`/registry/new/registration?of=${t.id}`}>Enter Registration</Link>
            </Button>
          )}
          {t.status === 'committed' && t.type !== 'reversal' && can('registry.commit') && (
            <Button variant="outline" onClick={() => setReversing(true)}>
              Reverse
            </Button>
          )}
          {isDraft && can('registry.draft') && (
            <>
              <ConfirmButton
                label="Delete Draft"
                title="Delete This Draft?"
                description="It was never entered in the register, so nothing else changes."
                onConfirm={() => remove.mutate({ transactionId: t.id })}
              />
              <Button variant="outline" asChild>
                <Link to={`/registry/transactions/${t.id}/edit`}>Edit</Link>
              </Button>
              {!t.awaitingApproval && (
                <Button
                  variant="outline"
                  disabled={submit.isPending || check.data?.ok === false}
                  onClick={() => submit.mutate({ transactionId: t.id })}
                >
                  Submit for Approval
                </Button>
              )}
              {(can('registry.commit') || can('registry.draft')) && (
                <Button disabled={commit.isPending || check.data?.ok === false} onClick={() => commit.mutate({ transactionId: t.id })}>
                  {t.awaitingApproval ? 'Approve and Commit' : 'Commit'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {isDraft && check.data && !check.data.ok && (
        <Alert variant="destructive">
          <AlertTitle>
            {check.data.conflict ? `Conflicts With Transaction #${check.data.conflict.seq}` : 'Cannot Be Entered Yet'}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {check.data.errors.map((e, i) => (
                <li key={i}>
                  {e.message} <span className="font-mono text-xs opacity-70">{e.rule}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="text-sm">
              <Fact label="Effective Date">
                <span className="font-mono">{t.effectiveDate}</span>
              </Fact>
              <Fact label="Decision Date">{t.decisionDate && <span className="font-mono">{t.decisionDate}</span>}</Fact>
              <Fact label="Registration Date">{t.registrationDate && <span className="font-mono">{t.registrationDate}</span>}</Fact>
              <Fact label="Entered">
                {t.enteredAt ? `${format.dateTime(t.enteredAt)}${t.committedByName ? ` by ${t.committedByName}` : ''}` : ''}
              </Fact>
              <Fact label="Prepared By">
                {[t.createdByName, t.origin && `in ${t.origin.label || t.origin.module}`].filter(Boolean).join(' ')}
              </Fact>
              {t.reversedBy && (
                <Fact label="Reversed By">
                  <Link to={`/registry/transactions/${t.reversedBy.id}`} className="text-primary hover:underline">
                    #{t.reversedBy.seq}
                  </Link>
                </Fact>
              )}
              {t.reversesId && (
                <Fact label="Reverses">
                  <Link to={`/registry/transactions/${t.reversesId}`} className="text-primary hover:underline">
                    Original Transaction
                  </Link>
                </Fact>
              )}
              <Fact label="Rule Pack">{t.rulePackVersion}</Fact>
              <Fact label="Hash">{t.hash && <span className="font-mono text-xs break-all">{t.hash}</span>}</Fact>
              {t.note && <Fact label="Note">{t.note}</Fact>}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <Documents
              transactionId={t.id}
              documents={t.documents}
              editable={isDraft && can('registry.draft')}
              canAttach={can('registry.draft')}
            />
          </CardContent>
        </Card>
      </div>

      {t.movements.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead>Share Numbers</TableHead>
                <TableHead className="text-right">Price per Share</TableHead>
                <TableHead className="text-right">Consideration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.classCode}</TableCell>
                  <TableCell>{m.fromHolderId ? name(m.fromHolderId) : <span className="text-muted-foreground">Company</span>}</TableCell>
                  <TableCell>{m.toHolderId ? name(m.toHolderId) : <span className="text-muted-foreground">Cancelled</span>}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(m.count)}</TableCell>
                  <TableCell className="font-mono text-xs">{m.rangeFrom !== null ? `${m.rangeFrom}–${m.rangeTo}` : ''}</TableCell>
                  <TableCell className="text-right font-mono">{m.pricePerShare ? fmt(m.pricePerShare) : ''}</TableCell>
                  <TableCell className="text-right font-mono">
                    {m.consideration !== null ? formatMoney(m.consideration, currency) : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Stored Content</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted/60 p-3 font-mono">{JSON.stringify(t.transaction, null, 2)}</pre>
      </details>
      <ReverseDialog transactionId={t.id} open={reversing} onOpenChange={setReversing} />
    </div>
  );
}
