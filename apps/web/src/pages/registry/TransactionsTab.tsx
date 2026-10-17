import { TX_STATUS_LABELS, TX_STATUSES, type TxStatus } from '@openinc/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ListOrdered } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { StatusBadge } from './common';

const PAGE = 50;
const ANY = '__any';

export function TransactionsTab() {
  const trpc = useTRPC();
  const format = useFormat();
  const [status, setStatus] = useState<string>(ANY);
  const [offset, setOffset] = useState(0);
  const list = useQuery(
    trpc.registry.listTransactions.queryOptions(
      { status: status === ANY ? undefined : (status as TxStatus), limit: PAGE, offset },
      { placeholderData: (prev) => prev },
    ),
  );
  const total = list.data?.total ?? 0;
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-56" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All Statuses</SelectItem>
            {TX_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TX_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.items.length ? (
        <EmptyState icon={<ListOrdered />} title="No Transactions">
          Every change to the register is a transaction. They show up here as drafts and, once entered, with a number.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">#</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Entered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.seq ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{t.effectiveDate}</TableCell>
                  <TableCell>{t.typeLabel}</TableCell>
                  <TableCell className="max-w-96">
                    <Link to={`/registry/transactions/${t.id}`} className="hover:underline">
                      {t.summary || t.typeLabel}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} label={t.statusLabel} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.enteredAt ? format.dateTime(t.enteredAt) : ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {total > PAGE && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
          <Button variant="outline" size="icon" disabled={offset === 0} onClick={() => setOffset(offset - PAGE)} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
            aria-label="Next"
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
