import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { EmptyState, Spinner } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';

const PAGE = 50;
const SURFACES = ['web', 'mcp', 'ai', 'worker', 'system'] as const;
const ANY = '__any';

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Settings → Audit Log. */
export function AuditSection() {
  const trpc = useTRPC();
  const format = useFormat();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<string>(ANY);
  const [surface, setSurface] = useState<string>(ANY);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const facets = useQuery(trpc.audit.facets.queryOptions());
  const list = useQuery(
    trpc.audit.list.queryOptions(
      {
        search: search || undefined,
        action: action === ANY ? undefined : action,
        surface: surface === ANY ? undefined : (surface as (typeof SURFACES)[number]),
        limit: PAGE,
        offset,
      },
      { placeholderData: (prev) => prev },
    ),
  );
  const total = list.data?.total ?? 0;

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          placeholder="Search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          className="max-w-xs"
        />
        <Select
          value={action}
          onValueChange={(v) => {
            setAction(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-52" aria-label="Action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All Actions</SelectItem>
            {facets.data?.actions.map((a) => (
              <SelectItem key={a} value={a} className="font-mono text-xs">
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={surface}
          onValueChange={(v) => {
            setSurface(v);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-36" aria-label="Surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All Surfaces</SelectItem>
            {SURFACES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.items.length ? (
        <EmptyState title="No Entries" />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="hidden md:table-cell">Entity</TableHead>
                <TableHead className="hidden sm:table-cell">Via</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((e) => (
                <Fragment key={e.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{format.dateTime(e.occurredAt)}</TableCell>
                    <TableCell className="max-w-48 truncate">{e.actorName ?? e.actorLabel}</TableCell>
                    <TableCell className="font-mono text-xs">{e.action}</TableCell>
                    <TableCell className="hidden max-w-56 truncate font-mono text-xs text-muted-foreground md:table-cell">
                      {e.entityType}
                      {e.entityId && `:${e.entityId.slice(0, 8)}`}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {e.surface}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {open === e.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="bg-muted/20">
                        <div className="grid gap-3 py-2 md:grid-cols-3">
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Before</div>
                            <Json value={e.before} />
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">After</div>
                            <Json value={e.after} />
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Details</div>
                            <Json value={{ entityId: e.entityId, actor: e.actorLabel, ...(e.metadata as object) }} />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-muted-foreground">
          <span className="font-mono text-xs">
            {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={offset === 0}
            onClick={() => setOffset(offset - PAGE)}
            aria-label="Previous Page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
            aria-label="Next Page"
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </>
  );
}
