import { ANTI_DILUTION_LABELS, PARTICIPATION_LABELS } from '@openinc/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Spinner } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { fmt, today, useRegistryStatus } from './common';

const describe = (t: Record<string, unknown>) =>
  Object.entries(t)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('; ');

export function ClassesTab() {
  const trpc = useTRPC();
  const can = useCan();
  const status = useRegistryStatus();
  const register = useQuery(trpc.registry.getRegister.queryOptions({ asOf: today() }));
  if (register.isLoading || !register.data) return <Spinner />;
  const terms = status.data?.setUp ? status.data.settings.rulePackInfo.terms : null;
  const nominal = register.data.classes.some((c) => c.nominalPerShare);
  return (
    <div className="grid gap-3">
      {can('registry.draft') && register.data.initialized && (
        <div className="flex justify-end">
          <Button variant="outline" asChild>
            <Link to="/registry/new/class_change">Change Class Terms</Link>
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead className="text-right">Votes per Share</TableHead>
              {nominal && <TableHead className="text-right">Nominal Value</TableHead>}
              <TableHead className="text-right">Issued</TableHead>
              <TableHead className="text-right">Capital %</TableHead>
              <TableHead className="text-right">Votes %</TableHead>
              <TableHead className="text-right">Seniority</TableHead>
              <TableHead>Liquidation Preference</TableHead>
              <TableHead>Anti-dilution</TableHead>
              <TableHead>Restrictions</TableHead>
              <TableHead>Other Terms</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {register.data.classes.map((c) => (
              <TableRow key={c.code}>
                <TableCell>
                  <div className="font-medium">{c.code}</div>
                  {c.name && <div className="text-xs text-muted-foreground">{c.name}</div>}
                </TableCell>
                <TableCell className="text-right font-mono">{fmt(c.votesPerShare)}</TableCell>
                {nominal && <TableCell className="text-right font-mono">{c.nominalPerShare ? fmt(c.nominalPerShare) : ''}</TableCell>}
                <TableCell className="text-right font-mono">{fmt(c.issued)}</TableCell>
                <TableCell className="text-right font-mono">{c.capitalPct}</TableCell>
                <TableCell className="text-right font-mono">{c.votesPct}</TableCell>
                <TableCell className="text-right font-mono">{c.seniorityRank}</TableCell>
                <TableCell>
                  <span className="font-mono">{fmt(c.liqPrefMultiple)}x</span>
                  <div className="text-xs text-muted-foreground">
                    {PARTICIPATION_LABELS[c.participation]}
                    {c.liqPrefCapMultiple && <span className="font-mono">, cap {fmt(c.liqPrefCapMultiple)}x</span>}
                  </div>
                </TableCell>
                <TableCell className="text-xs">{ANTI_DILUTION_LABELS[c.antiDilution]}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.restrictions.consent && <Badge variant="secondary">{terms?.consent ?? 'Consent Clause'}</Badge>}
                    {c.restrictions.preEmption && <Badge variant="secondary">{terms?.preEmption ?? 'Pre-emption Right'}</Badge>}
                    {c.restrictions.firstRefusal && <Badge variant="secondary">{terms?.firstRefusal ?? 'Right of First Refusal'}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="max-w-80 text-xs text-muted-foreground">
                  {[describe(c.dividendTerms), describe(c.liquidationTerms), c.conversionClause, c.redemptionClause]
                    .filter(Boolean)
                    .join(' · ')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
