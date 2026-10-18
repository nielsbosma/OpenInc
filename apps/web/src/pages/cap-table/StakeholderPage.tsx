import { unpricedProfile } from '@openinc/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Field, Spinner } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTRPC } from '@/lib/trpc';
import { fmt, money, pct, today } from './common';

export function StakeholderPage() {
  const { id = '' } = useParams();
  const trpc = useTRPC();
  const [asOf, setAsOf] = useState(today());
  const detail = useQuery(trpc.captable.stakeholder.queryOptions({ stakeholderId: id, asOf }, { placeholderData: (prev) => prev }));
  if (detail.isLoading) return <Spinner />;
  const d = detail.data;
  if (!d) return null;
  const row = d.row;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/cap-table" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> Overview
          </Link>
          <h2 className="text-lg font-semibold">{d.stakeholder.name}</h2>
          <p className="text-muted-foreground">
            {d.stakeholder.inRegister ? 'Holder in the share register' : 'Cap table stakeholder, not in the share register'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="As of Date" htmlFor="stakeholder-as-of" className="w-44">
            <Input id="stakeholder-as-of" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
          </Field>
          {d.stakeholder.inRegister && (
            <Button variant="outline" asChild>
              <Link to={`/registry/holders/${id}`}>Open in Register</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="shadow-none">
          <CardHeader>
            <p className="text-sm text-muted-foreground">Fully Diluted</p>
            <CardTitle className="font-mono text-2xl">{row ? pct(row.fullyDilutedPct) : '0%'}</CardTitle>
            {row && <p className="font-mono text-xs text-muted-foreground">{fmt(row.fullyDiluted)} units</p>}
          </CardHeader>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <p className="text-sm text-muted-foreground">Votes</p>
            <CardTitle className="font-mono text-2xl">{row ? pct(row.votesPct) : '0%'}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <p className="text-sm text-muted-foreground">Value at the Last Price</p>
            <CardTitle className="font-mono text-2xl">{row?.value ? money(row.value, d.currency) : '–'}</CardTitle>
            {d.price && (
              <p className="text-xs text-muted-foreground">
                {d.price.pricePerShare} {d.currency} per share on {d.price.date}
              </p>
            )}
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shares</CardTitle>
        </CardHeader>
        <CardContent>
          {d.holdings.length === 0 ? (
            <p className="text-muted-foreground">No shares on this date.</p>
          ) : (
            <div className="grid gap-2">
              {d.holdings.map((h) => (
                <div key={h.classCode} className="flex justify-between border-b pb-2 last:border-0">
                  <span>Class {h.classCode}</span>
                  <span className="font-mono">{fmt(h.units)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {d.grants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Grants and Vesting</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Strike</TableHead>
                  <TableHead className="text-right">Vested</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Exercised</TableHead>
                  <TableHead>Next Vesting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.grants.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      {g.planName}
                      {g.terminatedOn && (
                        <Badge variant="outline" className="ml-2">
                          {g.leaver === 'bad' ? 'Bad Leaver' : 'Good Leaver'} {g.terminatedOn}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{g.grantDate}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(g.units)}</TableCell>
                    <TableCell className="text-right font-mono">{g.strikePrice}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(g.vested)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(g.outstanding)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(g.exercised)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {g.upcoming[0]
                        ? `${g.upcoming[0].date}: ${fmt(g.upcoming[0].vestedTotal)} in total`
                        : g.scheduleName
                          ? 'Fully vested'
                          : 'No vesting'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {d.unpriced.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Convertibles</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {d.unpriced.map((u) => (
              <div key={u.id} className="flex justify-between border-b pb-2 last:border-0">
                <span>{unpricedProfile(u.profile)?.label ?? u.profile}</span>
                <span className="font-mono">
                  {money(u.amount, d.currency)}
                  {u.accrued !== u.amount && <span className="text-muted-foreground"> ({money(u.accrued, d.currency)} with interest)</span>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
